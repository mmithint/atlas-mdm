/* =====================================================================
   app.usp_request_resubmit     APP-3; FINAL PLAN/03 APP-3 step 5; workflow POC_Final/04, step 3 of the
                                return loop ("recipient corrects the proposed value ... and resubmits")
   Single statement per file; CREATE OR ALTER, safe to run again.
   Needs: app.fn_value_check, app.usp_notification_enqueue.

   Sends a RETURNED request back to the first stage (PENDING_RESPONSIBLE), optionally with a corrected
   proposed value. Who may do it is app.fn_return_rights (client, 18 Nov 2026): the person it was returned to
   (any of the people app.fn_return_candidates allowed, not only the submitter), an active member of the group
   when it went to a GROUP; and, when that recipient can no longer act on it (orphaned), also the submitter, a
   member of the responsible group or an admin. "Raised by" never changes. A refusal is a THROW; nothing is written:

     50161 no such request                       50162 the request is not RETURNED
     50163 the person may not resubmit it (app.fn_return_rights)
     50120 the corrected value equals the old value
     50121 the corrected value is not acceptable (app.fn_value_check)
     50164 another open request already proposes that change (same de-duplication key)
     50165 another open request proposes a different value for the same field
     50149 somebody else changed the request at the same moment

   With a corrected value the de-duplication key is computed again (same formula as
   app.usp_request_create: rule id, entity type, entity key, field, old value, new value). Both approval
   stages start again; an earlier approval stays in the history and still counts for the segregation rule.
   One transaction: status, value, key, return recipient cleared, RESUBMITTED event (comment, old and new
   proposed value), notification to the responsible group.

   Result: ONE row (request_id, request_ref, previous_status, new_status, new_value) when @emit_result = 1,
   and always @o_new_status.
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_request_resubmit
    @request_id   bigint,
    @actor_email  nvarchar(256),
    @new_value    nvarchar(400)  = NULL,
    @comment      nvarchar(1000) = NULL,
    @emit_result  bit            = 1,
    @o_new_status nvarchar(24)   = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @msg nvarchar(2048);
    DECLARE @actor nvarchar(256) = LOWER(LTRIM(RTRIM(@actor_email)));
    DECLARE @cmt nvarchar(1000) = NULLIF(LTRIM(RTRIM(@comment)), N'');
    DECLARE @nv nvarchar(400) = NULLIF(LTRIM(RTRIM(@new_value)), N'');

    DECLARE @status nvarchar(24), @etype nvarchar(10), @eqid int, @eqnum nvarchar(18), @floc nvarchar(40), @field nvarchar(64);
    DECLARE @oldv nvarchar(400), @curv nvarchar(400), @rule nvarchar(64), @rg nvarchar(64), @rtype nvarchar(10), @rrec nvarchar(256);
    DECLARE @ref nvarchar(12), @rowver binary(8);
    SELECT @status = r.request_status, @etype = r.entity_type, @eqid = r.equipment_id, @eqnum = r.equipment_number,
           @floc = r.functional_location, @field = r.field_code, @oldv = r.old_value, @curv = r.new_value,
           @rule = r.source_rule_id, @rg = r.responsible_group, @rtype = r.return_recipient_type, @rrec = r.return_recipient,
           @ref = r.request_ref, @rowver = r.row_version
    FROM app.change_request AS r
    WHERE r.request_id = @request_id;
    IF @status IS NULL
        THROW 50161, N'That request does not exist.', 1;
    IF @status <> N'RETURNED'
    BEGIN
        SET @msg = N'The request is ' + @status + N'; only a returned request can be resubmitted.';
        THROW 50162, @msg, 1;
    END

    IF NOT EXISTS (SELECT 1 FROM app.fn_return_rights(@request_id, @actor) AS rr WHERE rr.can_resubmit = 1)
        THROW 50163, N'Only the person or group the request was returned to may resubmit it (or, when that person can no longer act on it, the submitter, a member of the responsible group or an admin).', 1;

    /* ---- a corrected value ----------------------------------------------------------- */
    DECLARE @newv nvarchar(400) = @curv;
    DECLARE @key char(64) = NULL;
    IF @nv IS NOT NULL AND @nv COLLATE Latin1_General_BIN2 <> ISNULL(@curv, N'') COLLATE Latin1_General_BIN2
    BEGIN
        DECLARE @ftype nvarchar(10) = (SELECT c.data_type FROM app.field_catalog AS c WHERE c.field_code = @field);
        DECLARE @problem nvarchar(400) = (SELECT v.problem FROM app.fn_value_check(@field, @nv) AS v);
        IF @problem IS NOT NULL
        BEGIN
            SET @msg = N'The corrected value is not acceptable: ' + @problem + N'.';
            THROW 50121, @msg, 1;
        END
        DECLARE @same bit = 0;
        IF @ftype = N'DECIMAL' AND TRY_CONVERT(decimal(18,4), @nv) IS NOT NULL AND TRY_CONVERT(decimal(18,4), @oldv) IS NOT NULL
            SET @same = CASE WHEN TRY_CONVERT(decimal(18,4), @nv) = TRY_CONVERT(decimal(18,4), @oldv) THEN 1 ELSE 0 END;
        ELSE
            SET @same = CASE WHEN ISNULL(@oldv, N'') COLLATE Latin1_General_BIN2 = @nv COLLATE Latin1_General_BIN2 THEN 1 ELSE 0 END;
        IF @same = 1
            THROW 50120, N'The corrected value is the same as the old value.', 1;

        DECLARE @entity_key nvarchar(40) = CASE WHEN @etype = N'EQUIPMENT' THEN @eqnum ELSE @floc END;
        SET @key = CONVERT(char(64), HASHBYTES('SHA2_256',
            CONCAT(ISNULL(@rule, N''), NCHAR(31), @etype, NCHAR(31), @entity_key, NCHAR(31),
                   @field, NCHAR(31), ISNULL(@oldv, N''), NCHAR(31), @nv)), 2);

        IF EXISTS (SELECT 1 FROM app.change_request AS d
                   WHERE d.deduplication_key = @key AND d.request_id <> @request_id
                     AND d.request_status <> N'APPROVED' AND d.request_status <> N'REJECTED' AND d.request_status <> N'CANCELLED')
            THROW 50164, N'Another open request already proposes that change.', 1;
        IF EXISTS (SELECT 1 FROM app.change_request AS o
                   WHERE o.request_id <> @request_id AND o.field_code = @field
                     AND o.request_status <> N'APPROVED' AND o.request_status <> N'REJECTED' AND o.request_status <> N'CANCELLED'
                     AND (   (@etype = N'EQUIPMENT' AND o.equipment_id = @eqid)
                          OR (@etype = N'FLOC' AND o.entity_type = N'FLOC' AND o.functional_location = @floc))
                     AND ISNULL(o.new_value, N'') COLLATE Latin1_General_BIN2 <> @nv COLLATE Latin1_General_BIN2)
            THROW 50165, N'Another open request proposes a different value for the same field.', 1;
        SET @newv = @nv;
    END

    /* ---- write ----------------------------------------------------------------------- */
    DECLARE @details nvarchar(max) =
        (SELECT @curv AS previous_new_value, @newv AS new_value FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
    DECLARE @what nvarchar(400) = (SELECT TOP (1) ISNULL(fc.label, r.field_code) + N' of ' + ISNULL(r.equipment_number, r.functional_location)
                                   FROM app.change_request AS r
                                   LEFT JOIN app.field_catalog AS fc ON fc.field_code = r.field_code
                                   WHERE r.request_id = @request_id);
    DECLARE @own bit = CASE WHEN @@TRANCOUNT = 0 THEN 1 ELSE 0 END;
    DECLARE @event_id bigint, @ek nvarchar(60), @t nvarchar(200), @b nvarchar(1000);

    BEGIN TRY
        IF @own = 1 BEGIN TRANSACTION;

        UPDATE app.change_request
        SET request_status = N'PENDING_RESPONSIBLE',
            new_value = @newv,
            deduplication_key = ISNULL(@key, deduplication_key),
            return_recipient_type = NULL,
            return_recipient = NULL,
            updated_at_utc = SYSUTCDATETIME()
        WHERE request_id = @request_id AND request_status = N'RETURNED' AND row_version = @rowver;
        IF @@ROWCOUNT <> 1
            THROW 50149, N'Somebody else changed this request at the same moment: reload it and try again.', 1;

        INSERT INTO app.change_request_event
            (request_id, event_type, approval_stage, actor, actor_group, comments, status_from, status_to, event_details_json)
        VALUES
            (@request_id, N'RESUBMITTED', NULL, @actor, NULL, @cmt, N'RETURNED', N'PENDING_RESPONSIBLE', @details);
        SET @event_id = SCOPE_IDENTITY();
        SET @ek = N'E' + CAST(@event_id AS nvarchar(20));

        SET @t = N'Request ' + @ref + N' needs your approval again';
        SET @b = LEFT(@ref + N': ' + @what + N' was resubmitted with the proposed value "' + @newv + N'".', 1000);
        EXEC app.usp_notification_enqueue @topic = N'REQUEST_PENDING_RESPONSIBLE', @request_id = @request_id, @event_key = @ek,
                                          @title = @t, @body = @b, @recipient_group = @rg;

        IF @own = 1 COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @own = 1 AND @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SET @o_new_status = N'PENDING_RESPONSIBLE';
    IF @emit_result = 1
        SELECT @request_id AS request_id, @ref AS request_ref, N'RETURNED' AS previous_status,
               N'PENDING_RESPONSIBLE' AS new_status, @newv AS new_value;
END
