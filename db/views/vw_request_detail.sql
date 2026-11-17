/* =====================================================================
   app.vw_request_detail        APP-3; FINAL PLAN/09 section 9; screen S-3 (request detail)
   Single statement per file; CREATE OR ALTER, safe to run again.
   Needs app.vw_request_queue (create it first). Read through a read function and procedure
   (D-17; built with the screens in APP-4).

   One row per request: every column of app.vw_request_queue (q.*, the same names, types and order) plus what
   the detail screen adds from the request and its events. Key: request_id. No nvarchar(max) column.

     class_code, route_id     as stored on the request
     creation_comment         the comment of the CREATED event
     last_decision_by / _at   actor and time of the latest decision event (RESPONSIBLE_APPROVED,
                              ACCOUNTABLE_APPROVED, REJECTED or RETURNED); NULL while none
     merge_outcome            APPLIED, STALE, ALREADY_APPLIED, NOT_ELIGIBLE or ERROR, from the latest merge
                              event (MERGED, MERGE_STALE) or merge-failure COMMENTED event; NULL before a merge
                              was tried
     merged_at_utc            time of the MERGED event (NULL until applied)
     golden_version_id        the golden version the merge produced (from the merge event); NULL otherwise
     exported_at_utc, evolve_batch_id, evolve_row_number   from the EXPORTED event; NULL until exported

   The merge and export facts come out of event_details_json with JSON_VALUE (the column itself stays inside
   the database, it is nvarchar(max)).
   ===================================================================== */
CREATE OR ALTER VIEW app.vw_request_detail
AS
SELECT
    q.*,
    r.class_code,
    r.route_id,
    cr.comments                                                    AS creation_comment,
    dc.actor                                                       AS last_decision_by,
    dc.occurred_at_utc                                             AS last_decision_at_utc,
    CAST(JSON_VALUE(mg.event_details_json, '$.outcome') AS nvarchar(16))               AS merge_outcome,
    mdone.occurred_at_utc                                          AS merged_at_utc,
    TRY_CONVERT(int, JSON_VALUE(mg.event_details_json, '$.golden_version_id'))         AS golden_version_id,
    ex.occurred_at_utc                                             AS exported_at_utc,
    TRY_CONVERT(bigint, JSON_VALUE(ex.event_details_json, '$.batch_id'))               AS evolve_batch_id,
    TRY_CONVERT(int, JSON_VALUE(ex.event_details_json, '$.row_number'))                AS evolve_row_number
FROM app.vw_request_queue AS q
JOIN app.change_request AS r ON r.request_id = q.request_id
OUTER APPLY (SELECT TOP (1) e.comments
             FROM app.change_request_event AS e
             WHERE e.request_id = r.request_id AND e.event_type = N'CREATED'
             ORDER BY e.event_id) AS cr
OUTER APPLY (SELECT TOP (1) e.actor, e.occurred_at_utc
             FROM app.change_request_event AS e
             WHERE e.request_id = r.request_id
               AND e.event_type IN (N'RESPONSIBLE_APPROVED', N'ACCOUNTABLE_APPROVED', N'REJECTED', N'RETURNED')
             ORDER BY e.event_id DESC) AS dc
OUTER APPLY (SELECT TOP (1) e.event_details_json
             FROM app.change_request_event AS e
             WHERE e.request_id = r.request_id
               AND (e.event_type IN (N'MERGED', N'MERGE_STALE')
                    OR (e.event_type = N'COMMENTED' AND e.actor LIKE N'system:%' AND JSON_VALUE(e.event_details_json, '$.outcome') IS NOT NULL))
             ORDER BY e.event_id DESC) AS mg
OUTER APPLY (SELECT TOP (1) e.occurred_at_utc
             FROM app.change_request_event AS e
             WHERE e.request_id = r.request_id AND e.event_type = N'MERGED'
             ORDER BY e.event_id DESC) AS mdone
OUTER APPLY (SELECT TOP (1) e.occurred_at_utc, e.event_details_json
             FROM app.change_request_event AS e
             WHERE e.request_id = r.request_id AND e.event_type = N'EXPORTED'
             ORDER BY e.event_id DESC) AS ex;
