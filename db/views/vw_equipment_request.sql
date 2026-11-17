/* =====================================================================
   app.vw_equipment_request     APP-3; FINAL PLAN/09 section 9; screens S-3 (related requests), S-5 (related requests)
   Single statement per file; CREATE OR ALTER, safe to run again.
   Read through a read function and procedure (D-17; built with the screens in APP-4).

   Requests by heater and by functional location (FLOC), one row per request, with an overlap flag:

     equipment_id            the heater (NULL for a FLOC request)
     functional_location     the FLOC the request is about (a FLOC request) or the heater's FLOC at creation
     is_open                 1 while the status is not APPROVED, REJECTED or CANCELLED
     other_open_requests_same_field  how many OTHER open requests target the same field of the same heater
                             (or of the same FLOC); 0 for a closed request. More than 0 is the overlap flag
                             S-3 and S-5 show.
   Screens ask for the rows of one heater: its own requests (equipment_id), plus the FLOC requests at its
   functional_location. Key: request_id.
   ===================================================================== */
CREATE OR ALTER VIEW app.vw_equipment_request
AS
SELECT
    r.request_id,
    r.equipment_id,
    r.functional_location,
    r.field_code,
    fc.label                                                                       AS field_label,
    r.request_ref,
    r.request_status,
    CAST(CASE WHEN r.request_status = N'APPROVED' OR r.request_status = N'REJECTED' OR r.request_status = N'CANCELLED'
              THEN 0 ELSE 1 END AS bit)                                            AS is_open,
    CAST(CASE r.source_type
             WHEN N'BUSINESS_RULE'      THEN N'Rule ' + ISNULL(r.source_rule_id, N'?') + N' v' + ISNULL(CAST(r.source_rule_version AS nvarchar(10)), N'?')
             WHEN N'FIELD'              THEN N'Field submission'
             WHEN N'MANUAL'             THEN N'Manual request'
             WHEN N'CORRECTION_IMPORT'  THEN N'Correction import'
             WHEN N'NEW_CHARACTERISTIC' THEN N'New field request'
             WHEN N'NEW_RECORD'         THEN N'New heater request'
             ELSE r.source_type END AS nvarchar(120))                              AS source_label,
    r.requested_at_utc,
    CAST(CASE WHEN r.request_status = N'APPROVED' OR r.request_status = N'REJECTED' OR r.request_status = N'CANCELLED'
              THEN 0 ELSE ISNULL(ov.n, 0) END AS int)                              AS other_open_requests_same_field
FROM app.change_request AS r
LEFT JOIN app.field_catalog AS fc ON fc.field_code = r.field_code
OUTER APPLY
(
    SELECT COUNT(*) AS n
    FROM app.change_request AS o
    WHERE o.request_id <> r.request_id
      AND o.field_code = r.field_code
      AND o.request_status <> N'APPROVED' AND o.request_status <> N'REJECTED' AND o.request_status <> N'CANCELLED'
      AND (   (r.entity_type = N'EQUIPMENT' AND o.equipment_id = r.equipment_id)
           OR (r.entity_type = N'FLOC' AND o.entity_type = N'FLOC' AND o.functional_location = r.functional_location))
) AS ov;
