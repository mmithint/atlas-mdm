/* =====================================================================
   app.usp_request_record_merge  APP-3; FINAL PLAN/01 section 6.5 (merge contract) and 2.2
   Single statement per file; CREATE OR ALTER, safe to run again.

   Records what the merge into gold answered for an APPROVED request. The caller is a function (right
   after the final approval) or the data engineer's re-apply notebook (NB-3); the approval itself is never
   rolled back because a merge failed or found a stale value (01 section 2.2, POC-DE-20).

   Input : @request_id; @outcome as returned by gold.usp_apply_approved_change: APPLIED, STALE,
           ALREADY_APPLIED, NOT_ELIGIBLE or ERROR; its message and golden_version_id; @actor (default
           system:merge).
   Event written (the request status does not change, status_from and status_to stay empty):
     APPLIED, ALREADY_APPLIED  ->  MERGED        (details: outcome, message, golden_version_id)
     STALE                     ->  MERGE_STALE   (the golden value moved on since the request was raised)
     NOT_ELIGIBLE, ERROR       ->  COMMENTED     ("Merge ERROR: <message>"), so the approver sees that the
                                   merge did not happen and why; the request stays APPROVED without a MERGED
                                   event, so the merge can be tried again later
   A request that already has a MERGED event gets no second event: the call answers ALREADY_RECORDED
   (the merge is applied once). Each STALE / ERROR attempt is recorded: it is history.

   Refusals: 50181 no such request, 50182 the request is not APPROVED, 50183 unknown outcome.
   Result: ONE row (request_id, request_ref, recorded) with recorded = MERGED, MERGE_STALE, COMMENTED or
   ALREADY_RECORDED.
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_request_record_merge
    @request_id        bigint,
    @outcome           nvarchar(16),
    @message           nvarchar(400) = NULL,
    @golden_version_id int           = NULL,
    @actor             nvarchar(256) = N'system:merge'
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @out nvarchar(16) = UPPER(LTRIM(RTRIM(@outcome)));
    DECLARE @who nvarchar(256) = LOWER(LTRIM(RTRIM(ISNULL(@actor, N'system:merge'))));
    DECLARE @msg nvarchar(400) = NULLIF(LTRIM(RTRIM(@message)), N'');

    DECLARE @status nvarchar(24), @ref nvarchar(12);
    SELECT @status = r.request_status, @ref = r.request_ref
    FROM app.change_request AS r
    WHERE r.request_id = @request_id;
    IF @status IS NULL
        THROW 50181, N'That request does not exist.', 1;
    IF @status <> N'APPROVED'
        THROW 50182, N'Only an approved request has a merge to record.', 1;
    IF @out IS NULL OR @out NOT IN (N'APPLIED', N'STALE', N'ALREADY_APPLIED', N'NOT_ELIGIBLE', N'ERROR')
        THROW 50183, N'Unknown merge outcome.', 1;

    DECLARE @recorded nvarchar(16);
    IF EXISTS (SELECT 1 FROM app.change_request_event AS e WHERE e.request_id = @request_id AND e.event_type = N'MERGED')
        SET @recorded = N'ALREADY_RECORDED';
    ELSE
    BEGIN
        DECLARE @type nvarchar(24) = CASE WHEN @out IN (N'APPLIED', N'ALREADY_APPLIED') THEN N'MERGED'
                                          WHEN @out = N'STALE' THEN N'MERGE_STALE'
                                          ELSE N'COMMENTED' END;
        DECLARE @comments nvarchar(1000) = CASE WHEN @type = N'COMMENTED' THEN LEFT(N'Merge ' + @out + N': ' + ISNULL(@msg, N'(no message)'), 1000) ELSE @msg END;
        DECLARE @details nvarchar(max) = (SELECT @out AS outcome, @msg AS message, @golden_version_id AS golden_version_id
                                          FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
        INSERT INTO app.change_request_event
            (request_id, event_type, approval_stage, actor, actor_group, comments, status_from, status_to, event_details_json)
        VALUES
            (@request_id, @type, NULL, @who, NULL, @comments, NULL, NULL, @details);
        SET @recorded = @type;
    END

    SELECT @request_id AS request_id, @ref AS request_ref, @recorded AS recorded;
END
