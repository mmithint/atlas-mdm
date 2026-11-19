/* =====================================================================
   app.usp_request_decide       APP-3; FINAL PLAN/01 section 2.2 (write path), 03 APP-3 step 3;
                                tests: db/tests/t_request_lifecycle.sql
   Single statement per file; CREATE OR ALTER, safe to run again.
   Needs: app.fn_stage_eligibility, app.fn_request_checks, app.usp_notification_enqueue.

   One approver decides one request: APPROVE, REJECT or RETURN. All the rules live here (the function
   only identifies the caller). In order; a refusal is a THROW and nothing is written:

     50131 the actor must be a person's e-mail (never a system:... name)      50132 unknown decision
     50133 no such request                                                     50134 not waiting for a decision
     50135 @expected_status given and the request has moved on (the screen is out of date)
     50136 REJECT and RETURN need a comment
     50141 not an active member of the group the request was routed to for this stage (an admin is exempt)
     50142 no role of the person has the stage's flag with a scope that covers the profit centre (an admin is
           exempt)
     (50143, "the same person may not approve both stages", is retired: client, 18 Nov 2026, answers Q-479.
      Whoever is eligible at the second stage may approve it, also when they approved the first: an admin, or
      a member of both routed groups. The event records how: decided_as ADMIN or GROUP_MEMBER, and
      same_person_both_stages = true.)
     50144 APPROVE blocked by a FAILED approval check (app.fn_request_checks rows 1 to 5; NOT_CHECKED does
           not block; a stale request can still be REJECTED or RETURNED)
     50137 RETURN to someone who is not allowed (client, 18 Nov 2026, answers Q-465). @return_recipient names
           ONE person, who must be in app.fn_return_candidates for this request and this actor: the submitter,
           an active member of either routed group (registered), or the actor themselves. Without
           @return_recipient the request goes where it went before (the default): the submitter of a field or
           manual request, the rule's resolution group for a rule request, the responsible group for another
           request raised by system:... . @return_recipient_type, when given, must be USER with a person, or
           GROUP with exactly that default group.
     50149 somebody else changed the request between the read and the write (row_version)

   What it writes, in ONE transaction: the new status, the event (type, stage, actor, group, comment,
   status before and after, the check results as JSON), and the notifications:
     APPROVE at RESPONSIBLE   -> PENDING_ACCOUNTABLE, event RESPONSIBLE_APPROVED, group notified
     APPROVE at ACCOUNTABLE   -> APPROVED, event ACCOUNTABLE_APPROVED, requester notified; needs_merge = 1
     REJECT                   -> REJECTED, event REJECTED, requester notified with the comment
     RETURN                   -> RETURNED, event RETURNED, the recipient notified with the comment (not when the
                                 actor returned it to themselves)
   The merge into gold is NOT done here: it is a separate step after the approval commits (01 section 2.2).
   The function calls gold.usp_apply_approved_change when needs_merge = 1 and records the outcome with
   app.usp_request_record_merge.

   Result: ONE row (request_id, request_ref, decision, previous_status, new_status, stage, needs_merge) when
   @emit_result = 1 (the default), and always @o_new_status and @o_needs_merge. app.usp_request_bulk_decide
   passes @emit_result = 0. Do not call this procedure from INSERT ... EXEC; read the OUTPUT parameters.
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_request_decide
    @request_id            bigint,
    @actor_email           nvarchar(256),
    @decision              nvarchar(10),
    @comment               nvarchar(1000) = NULL,
    @expected_status       nvarchar(24)   = NULL,
    @return_recipient_type nvarchar(10)   = NULL,
    @return_recipient      nvarchar(256)  = NULL,
    @emit_result           bit            = 1,
    @o_new_status          nvarchar(24)   = NULL OUTPUT,
    @o_needs_merge         bit            = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @msg nvarchar(2048);
    DECLARE @actor nvarchar(256) = LOWER(LTRIM(RTRIM(@actor_email)));
    DECLARE @dec nvarchar(10) = UPPER(LTRIM(RTRIM(@decision)));
    DECLARE @cmt nvarchar(1000) = NULLIF(LTRIM(RTRIM(@comment)), N'');

    IF @actor IS NULL OR CHARINDEX(N'@', @actor) < 2 OR LEFT(@actor, 7) = N'system:'
        THROW 50131, N'The decision must come from a person (an e-mail address).', 1;
    IF @dec IS NULL OR @dec NOT IN (N'APPROVE', N'REJECT', N'RETURN')
        THROW 50132, N'The decision must be APPROVE, REJECT or RETURN.', 1;

    /* ---- the request -------------------------------------------------------------- */
    DECLARE @status nvarchar(24), @rg nvarchar(64), @ag nvarchar(64), @pc nvarchar(40), @source nvarchar(20);
    DECLARE @rule nvarchar(64), @rv int, @by nvarchar(256), @ref nvarchar(12), @rowver binary(8);
    SELECT @status = r.request_status, @rg = r.responsible_group, @ag = r.accountable_group, @pc = r.profit_center_name,
           @source = r.source_type, @rule = r.source_rule_id, @rv = r.source_rule_version, @by = r.requested_by,
           @ref = r.request_ref, @rowver = r.row_version
    FROM app.change_request AS r
    WHERE r.request_id = @request_id;
    IF @status IS NULL
        THROW 50133, N'That request does not exist.', 1;
    IF @status NOT IN (N'PENDING_RESPONSIBLE', N'PENDING_ACCOUNTABLE')
    BEGIN
        SET @msg = N'The request is ' + @status + N'; only a request that waits for a decision can be decided.';
        THROW 50134, @msg, 1;
    END
    IF @expected_status IS NOT NULL AND @expected_status <> @status
    BEGIN
        SET @msg = N'The request is now ' + @status + N', not ' + @expected_status + N': reload it and decide again.';
        THROW 50135, @msg, 1;
    END

    DECLARE @stage nvarchar(12) = CASE WHEN @status = N'PENDING_RESPONSIBLE' THEN N'RESPONSIBLE' ELSE N'ACCOUNTABLE' END;
    DECLARE @grp nvarchar(64) = CASE WHEN @stage = N'RESPONSIBLE' THEN @rg ELSE @ag END;

    IF @dec IN (N'REJECT', N'RETURN') AND @cmt IS NULL
        THROW 50136, N'A comment is required to reject or return a request.', 1;

    /* ---- who may decide ---------------------------------------------------------- */
    DECLARE @is_member bit, @has_flag bit, @is_admin bit;
    SELECT @is_member = e.is_group_member, @has_flag = e.has_flag_in_scope, @is_admin = e.is_admin
    FROM app.fn_stage_eligibility(@actor, @stage, @grp, @pc) AS e;
    IF ISNULL(@is_admin, 0) = 0 AND @is_member = 0
    BEGIN
        SET @msg = N'You are not an active member of the group for this stage (' + ISNULL(@grp, N'none') + N').';
        THROW 50141, @msg, 1;
    END
    IF ISNULL(@is_admin, 0) = 0 AND @has_flag = 0
    BEGIN
        SET @msg = N'No role of yours allows the ' + @stage + N' stage for ' + ISNULL(@pc, N'this profit centre') + N'.';
        THROW 50142, @msg, 1;
    END
    -- how this person qualified, for the history: a group member with the flag, or an admin who is not
    DECLARE @decided_as nvarchar(12) = CASE WHEN @is_member = 1 AND @has_flag = 1 THEN N'GROUP_MEMBER' ELSE N'ADMIN' END;
    DECLARE @same_person bit = CASE WHEN @dec = N'APPROVE' AND @stage = N'ACCOUNTABLE'
                                     AND EXISTS (SELECT 1 FROM app.change_request_event AS ev
                                                 WHERE ev.request_id = @request_id AND ev.event_type = N'RESPONSIBLE_APPROVED' AND ev.actor = @actor)
                                    THEN 1 ELSE 0 END;

    /* ---- approval checks (a stale or failing request may still be rejected or returned) -- */
    DECLARE @failed nvarchar(max);
    IF @dec = N'APPROVE'
    BEGIN
        SELECT @failed = STRING_AGG(CAST(c.check_code AS nvarchar(max)), N', ')
        FROM app.fn_request_checks(@request_id, @actor) AS c
        WHERE c.check_status = N'FAIL' AND c.check_code <> N'USER_ELIGIBLE_FOR_STAGE';
        IF @failed IS NOT NULL
        BEGIN
            SET @msg = N'Approval is blocked by failed checks: ' + LEFT(@failed, 600) + N'.';
            THROW 50144, @msg, 1;
        END
    END
    DECLARE @checks_json nvarchar(max) =
        (SELECT c.check_code AS code, c.check_status AS status
         FROM app.fn_request_checks(@request_id, @actor) AS c
         ORDER BY c.check_order
         FOR JSON PATH);

    /* ---- who a returned request goes to --------------------------------------------- */
    DECLARE @rtype nvarchar(10) = NULL, @rrec nvarchar(256) = NULL;
    IF @dec = N'RETURN'
    BEGIN
        IF @source = N'BUSINESS_RULE'
        BEGIN
            SET @rtype = N'GROUP';
            SELECT @rrec = br.resolution_group FROM app.business_rules AS br WHERE br.rule_id = @rule AND br.rule_version = @rv;
            IF @rrec IS NULL SET @rrec = @rg;
        END
        ELSE IF LEFT(@by, 7) <> N'system:'
        BEGIN
            SET @rtype = N'USER';
            SET @rrec = @by;
        END
        ELSE
        BEGIN
            SET @rtype = N'GROUP';
            SET @rrec = @rg;
        END

        -- a chosen recipient (client, 18 Nov 2026): one person from app.fn_return_candidates, or the default group
        DECLARE @want_type nvarchar(10) = NULLIF(UPPER(LTRIM(RTRIM(@return_recipient_type))), N'');
        DECLARE @want nvarchar(256) = NULLIF(LOWER(LTRIM(RTRIM(@return_recipient))), N'');
        IF @want IS NOT NULL OR @want_type IS NOT NULL
        BEGIN
            IF @want_type = N'GROUP'
            BEGIN
                IF @rtype <> N'GROUP' OR @want IS NULL OR @want <> LOWER(@rrec)
                BEGIN
                    SET @msg = N'This request can only be returned to a person, or to ' + CASE WHEN @rtype = N'GROUP' THEN @rrec ELSE N'no group' END + N'.';
                    THROW 50137, @msg, 1;
                END
            END
            ELSE
            BEGIN
                IF (@want_type IS NOT NULL AND @want_type <> N'USER')
                   OR @want IS NULL
                   OR NOT EXISTS (SELECT 1 FROM app.fn_return_candidates(@request_id, @actor) AS c WHERE c.user_email = @want)
                    THROW 50137, N'A request can only be returned to its submitter, to a registered member of one of its two approval groups, or to yourself.', 1;
                SET @rtype = N'USER';
                SET @rrec = @want;
            END
        END
    END

    /* ---- write ---------------------------------------------------------------------- */
    DECLARE @new_status nvarchar(24) = CASE WHEN @dec = N'REJECT' THEN N'REJECTED'
                                            WHEN @dec = N'RETURN' THEN N'RETURNED'
                                            WHEN @stage = N'RESPONSIBLE' THEN N'PENDING_ACCOUNTABLE'
                                            ELSE N'APPROVED' END;
    DECLARE @event_type nvarchar(24) = CASE WHEN @dec = N'REJECT' THEN N'REJECTED'
                                            WHEN @dec = N'RETURN' THEN N'RETURNED'
                                            WHEN @stage = N'RESPONSIBLE' THEN N'RESPONSIBLE_APPROVED'
                                            ELSE N'ACCOUNTABLE_APPROVED' END;
    DECLARE @details nvarchar(max) =
        (SELECT @stage AS stage, @dec AS decision, @decided_as AS decided_as,
                CAST(@same_person AS bit) AS same_person_both_stages, JSON_QUERY(@checks_json) AS checks,
                @rtype AS return_recipient_type, @rrec AS return_recipient
         FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
    DECLARE @req_mail nvarchar(256) = CASE WHEN @by = @actor THEN NULL ELSE @by END;
    DECLARE @ret_mail nvarchar(256) = CASE WHEN @rtype = N'USER' AND @rrec <> @actor THEN @rrec ELSE NULL END;
    DECLARE @ret_group nvarchar(64) = CASE WHEN @rtype = N'GROUP' THEN @rrec ELSE NULL END;
    DECLARE @what nvarchar(400) = (SELECT TOP (1) ISNULL(fc.label, r.field_code) + N' of ' + ISNULL(r.equipment_number, r.functional_location)
                                   FROM app.change_request AS r
                                   LEFT JOIN app.field_catalog AS fc ON fc.field_code = r.field_code
                                   WHERE r.request_id = @request_id);
    DECLARE @own bit = CASE WHEN @@TRANCOUNT = 0 THEN 1 ELSE 0 END;
    DECLARE @event_id bigint, @ek nvarchar(60), @t nvarchar(200), @b nvarchar(1000);

    BEGIN TRY
        IF @own = 1 BEGIN TRANSACTION;

        UPDATE app.change_request
        SET request_status = @new_status,
            updated_at_utc = SYSUTCDATETIME(),
            return_recipient_type = @rtype,
            return_recipient = @rrec
        WHERE request_id = @request_id AND request_status = @status AND row_version = @rowver;
        IF @@ROWCOUNT <> 1
            THROW 50149, N'Somebody else changed this request at the same moment: reload it and try again.', 1;

        INSERT INTO app.change_request_event
            (request_id, event_type, approval_stage, actor, actor_group, comments, status_from, status_to, event_details_json)
        VALUES
            (@request_id, @event_type, @stage, @actor, @grp, @cmt, @status, @new_status, @details);
        SET @event_id = SCOPE_IDENTITY();
        SET @ek = N'E' + CAST(@event_id AS nvarchar(20));

        IF @dec = N'APPROVE' AND @stage = N'RESPONSIBLE'
        BEGIN
            SET @t = N'Request ' + @ref + N' needs your approval';
            SET @b = LEFT(@ref + N': ' + @what + N' passed the responsible stage and now waits for the accountable stage.', 1000);
            EXEC app.usp_notification_enqueue @topic = N'REQUEST_PENDING_ACCOUNTABLE', @request_id = @request_id, @event_key = @ek,
                                              @title = @t, @body = @b, @recipient_group = @ag;
        END
        ELSE IF @dec = N'APPROVE'
        BEGIN
            SET @t = N'Request ' + @ref + N' was approved';
            SET @b = LEFT(@ref + N': ' + @what + N' was approved by both stages.', 1000);
            EXEC app.usp_notification_enqueue @topic = N'REQUEST_APPROVED', @request_id = @request_id, @event_key = @ek,
                                              @title = @t, @body = @b, @recipient_email = @req_mail;
        END
        ELSE IF @dec = N'REJECT'
        BEGIN
            SET @t = N'Request ' + @ref + N' was rejected';
            SET @b = LEFT(@ref + N': ' + @what + N' was rejected. Comment: ' + @cmt, 1000);
            EXEC app.usp_notification_enqueue @topic = N'REQUEST_REJECTED', @request_id = @request_id, @event_key = @ek,
                                              @title = @t, @body = @b, @recipient_email = @req_mail;
        END
        ELSE
        BEGIN
            SET @t = N'Request ' + @ref + N' was returned to you';
            SET @b = LEFT(@ref + N': ' + @what + N' was returned. Comment: ' + @cmt, 1000);
            EXEC app.usp_notification_enqueue @topic = N'REQUEST_RETURNED', @request_id = @request_id, @event_key = @ek,
                                              @title = @t, @body = @b, @recipient_email = @ret_mail, @recipient_group = @ret_group;
        END

        IF @own = 1 COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @own = 1 AND @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SET @o_new_status = @new_status;
    SET @o_needs_merge = CASE WHEN @new_status = N'APPROVED' THEN 1 ELSE 0 END;

    IF @emit_result = 1
        SELECT @request_id AS request_id, @ref AS request_ref, @dec AS decision, @status AS previous_status,
               @new_status AS new_status, @stage AS stage, @o_needs_merge AS needs_merge;
END
