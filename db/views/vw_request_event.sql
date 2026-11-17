/* =====================================================================
   app.vw_request_event         APP-3; FINAL PLAN/09 section 9; screens S-3 (Audit and routing tab), S-5 (history)
   Single statement per file; CREATE OR ALTER, safe to run again.
   Read through a read function and procedure (D-17; built with the screens in APP-4).

   One row per event of app.change_request_event, oldest first by occurred_at_utc and event_id. The long
   JSON column (event_details_json) is left out on purpose: it is nvarchar(max) and is read through a
   function when a screen needs the check results or the evidence snapshot (getRequestEvidence).
   Key: event_id.
   ===================================================================== */
CREATE OR ALTER VIEW app.vw_request_event
AS
SELECT
    ev.event_id,
    ev.request_id,
    ev.event_type,
    ev.approval_stage,
    ev.actor,
    ev.actor_group,
    ev.occurred_at_utc,
    ev.comments,
    ev.status_from,
    ev.status_to
FROM app.change_request_event AS ev;
