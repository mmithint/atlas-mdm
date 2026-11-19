/* =====================================================================
   app.usp_request_cancel       APP-3; FINAL PLAN/03 APP-3 step 5 ("requester withdraws")
   Single statement per file; CREATE OR ALTER, safe to run again.

   Withdraws an open request (PENDING_RESPONSIBLE, PENDING_ACCOUNTABLE, RETURNED or DRAFT): status
   CANCELLED, one CANCELLED event. The row stays (nothing is ever deleted). Closing it frees its
   de-duplication key, so the same change can be raised again by a person; a RULE source stays
   suppressed after a cancellation (app.usp_request_create, REF-52 [L0187]).

   Who may (changed 18 Nov 2026: a request can now be returned to people other than its submitter, and the
   agreed rule is "the recipient fixes it, the submitter keeps it"):
     - the person who raised it (requested_by), in any open status;
     - an admin (can_manage_admin, app.fn_requester_rights), in any open status;
     - while it is RETURNED to a GROUP (a request the system raised, which has no person as submitter), an
       active member of that group, who stands in for the submitter [INFERRED].
   A person it was returned to personally may correct and resubmit it but NOT withdraw it.
   A refusal is a THROW; nothing is written:
     50171 no such request        50172 the request is already closed (APPROVED, REJECTED or CANCELLED)
     50173 not the requester, not an admin, and not a member of the group a system request was returned to
     50149 somebody else changed the request at the same moment
   No notification is queued (the notification topics of 09 section 7.1 have none for a withdrawal).

   Result: ONE row (request_id, request_ref, previous_status, new_status) when @emit_result = 1,
   and always @o_new_status.
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_request_cancel
    @request_id   bigint,
    @actor_email  nvarchar(256),
    @comment      nvarchar(1000) = NULL,
    @emit_result  bit            = 1,
    @o_new_status nvarchar(24)   = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @msg nvarchar(2048);
    DECLARE @actor nvarchar(256) = LOWER(LTRIM(RTRIM(@actor_email)));
    DECLARE @cmt nvarchar(1000) = NULLIF(LTRIM(RTRIM(@comment)), N'');

    DECLARE @status nvarchar(24), @by nvarchar(256), @rtype nvarchar(10), @rrec nvarchar(256), @ref nvarchar(12), @rowver binary(8);
    SELECT @status = r.request_status, @by = r.requested_by, @rtype = r.return_recipient_type, @rrec = r.return_recipient,
           @ref = r.request_ref, @rowver = r.row_version
    FROM app.change_request AS r
    WHERE r.request_id = @request_id;
    IF @status IS NULL
        THROW 50171, N'That request does not exist.', 1;
    IF @status IN (N'APPROVED', N'REJECTED', N'CANCELLED')
    BEGIN
        SET @msg = N'The request is already ' + @status + N'; it cannot be withdrawn.';
        THROW 50172, @msg, 1;
    END

    IF @actor IS NULL OR @actor = N'' OR LEFT(@actor, 7) = N'system:'
       OR NOT (   LOWER(@by) = @actor
               OR EXISTS (SELECT 1 FROM app.fn_requester_rights(@actor) AS ad WHERE ad.can_manage_admin = 1)
               OR (@status = N'RETURNED' AND @rtype = N'GROUP'
                   AND EXISTS (SELECT 1 FROM app.group_membership AS m
                               WHERE m.group_key = @rrec AND m.is_active = 1 AND m.user_email = @actor)))
        THROW 50173, N'Only the person who raised the request, or an admin, may withdraw it.', 1;

    DECLARE @own bit = CASE WHEN @@TRANCOUNT = 0 THEN 1 ELSE 0 END;
    BEGIN TRY
        IF @own = 1 BEGIN TRANSACTION;

        UPDATE app.change_request
        SET request_status = N'CANCELLED',
            updated_at_utc = SYSUTCDATETIME()
        WHERE request_id = @request_id AND request_status = @status AND row_version = @rowver;
        IF @@ROWCOUNT <> 1
            THROW 50149, N'Somebody else changed this request at the same moment: reload it and try again.', 1;

        INSERT INTO app.change_request_event
            (request_id, event_type, approval_stage, actor, actor_group, comments, status_from, status_to, event_details_json)
        VALUES
            (@request_id, N'CANCELLED', NULL, @actor, NULL, @cmt, @status, N'CANCELLED', NULL);

        IF @own = 1 COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @own = 1 AND @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SET @o_new_status = N'CANCELLED';
    IF @emit_result = 1
        SELECT @request_id AS request_id, @ref AS request_ref, @status AS previous_status, N'CANCELLED' AS new_status;
END
