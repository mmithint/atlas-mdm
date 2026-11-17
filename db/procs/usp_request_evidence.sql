/* =====================================================================
   app.usp_request_evidence     APP-3; FINAL PLAN/03 section 2.2 (function getRequestEvidence)
   Single statement per file; CREATE OR ALTER, safe to run again. Reads only.

   The evidence snapshot of one request: what the requester (or the rule) had in front of them when the
   request was created. It is stored on the CREATED event (event_details_json, nvarchar(max), so it is read
   through a function and never through the connector or a view, 09 section 4.2):

     { "event": "CREATED", "source_type": ..., "entity_type": ..., "entity_key": ..., "route_used": ...,
       "golden_version_id": ..., "baseline_as_of_utc": ..., "evidence": { ...whatever the caller supplied... } }

   Input : @request_id.
   Output: ONE row: request_id, request_ref, created_at_utc, created_by, details_json (the text above).
   Refusal: 50201 when the request does not exist (or has no CREATED event, which no request created by
   app.usp_request_create can lack).
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_request_evidence
    @request_id bigint
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM app.change_request AS r WHERE r.request_id = @request_id)
        THROW 50201, N'That request does not exist.', 1;

    SELECT TOP (1)
        r.request_id,
        r.request_ref,
        e.occurred_at_utc    AS created_at_utc,
        e.actor              AS created_by,
        e.event_details_json AS details_json
    FROM app.change_request AS r
    JOIN app.change_request_event AS e ON e.request_id = r.request_id AND e.event_type = N'CREATED'
    WHERE r.request_id = @request_id
    ORDER BY e.event_id;
END
