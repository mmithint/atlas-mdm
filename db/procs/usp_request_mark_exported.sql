/* =====================================================================
   app.usp_request_mark_exported  APP-3; FINAL PLAN/01 section 6.6 (export contract; the data engineer calls it)
   Single statement per file; CREATE OR ALTER, safe to run again.

   The data engineer's export notebook (NB-5) calls this once for each request whose change it wrote into an
   EVOLVE template row:
     EXEC app.usp_request_mark_exported @request_id = 42, @batch_id = 7, @template_code = N'EQUIPMENT_UPDATE', @row_number = 15;
   It adds one EXPORTED event (details: batch, template, row). Nothing else changes: the request stays APPROVED.

   Eligible: the request is APPROVED and has a MERGED event (the change is in the golden record), and has no
   EXPORTED event yet. A second call for the same request answers ALREADY_RECORDED and adds nothing, so a
   notebook that re-runs does not duplicate the history.
   Refusals: 50191 no such request, 50192 not APPROVED or not merged yet, 50193 no template code or row number.
   Result: ONE row (request_id, request_ref, recorded) with recorded = EXPORTED or ALREADY_RECORDED.
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_request_mark_exported
    @request_id    bigint,
    @batch_id      bigint,
    @template_code nvarchar(40),
    @row_number    int,
    @actor         nvarchar(256) = N'system:de'
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @tpl nvarchar(40) = NULLIF(LTRIM(RTRIM(@template_code)), N'');
    DECLARE @who nvarchar(256) = LOWER(LTRIM(RTRIM(ISNULL(@actor, N'system:de'))));

    DECLARE @status nvarchar(24), @ref nvarchar(12);
    SELECT @status = r.request_status, @ref = r.request_ref
    FROM app.change_request AS r
    WHERE r.request_id = @request_id;
    IF @status IS NULL
        THROW 50191, N'That request does not exist.', 1;
    IF @tpl IS NULL OR @batch_id IS NULL OR @row_number IS NULL
        THROW 50193, N'A batch, a template code and a row number are required.', 1;
    IF @status <> N'APPROVED'
       OR NOT EXISTS (SELECT 1 FROM app.change_request_event AS e WHERE e.request_id = @request_id AND e.event_type = N'MERGED')
        THROW 50192, N'Only an approved request whose change has been merged can be marked as exported.', 1;

    DECLARE @recorded nvarchar(16);
    IF EXISTS (SELECT 1 FROM app.change_request_event AS e WHERE e.request_id = @request_id AND e.event_type = N'EXPORTED')
        SET @recorded = N'ALREADY_RECORDED';
    ELSE
    BEGIN
        DECLARE @details nvarchar(max) = (SELECT @batch_id AS batch_id, @tpl AS template_code, @row_number AS [row_number]
                                          FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
        INSERT INTO app.change_request_event
            (request_id, event_type, approval_stage, actor, actor_group, comments, status_from, status_to, event_details_json)
        VALUES
            (@request_id, N'EXPORTED', NULL, @who, NULL, NULL, NULL, NULL, @details);
        SET @recorded = N'EXPORTED';
    END

    SELECT @request_id AS request_id, @ref AS request_ref, @recorded AS recorded;
END
