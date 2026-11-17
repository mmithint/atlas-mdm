/* =====================================================================
   app.vw_request_queue         APP-3; FINAL PLAN/09 section 9; screens S-1 (home counts), S-2 (approvals)
   Single statement per file; CREATE OR ALTER, safe to run again.
   Read through a read function and procedure (D-17; they are built with the screens in APP-4: the
   queue procedure takes the caller's e-mail because "my queue" depends on who is asking).

   One row per change request, with everything a queue row shows. No nvarchar(max) column. Key: request_id.

     approval_stage     RESPONSIBLE or ACCOUNTABLE while the request waits for a decision, NULL otherwise
     field_label        the catalogue label (NULL for a request without a field)
     sap_field          the catalogue's sap_column (NULL until the data engineer fills the mapping, DE-3)
     source_label       "Rule <id> v<version>" for a rule request; "Field submission", "Manual request",
                        "Correction import", "New field request", "New heater request" otherwise
     detected_at_utc    when the rule found it (the start of the cycle-time clock); NULL for a person's request
     age_hours          whole hours since requested while the request is open; NULL once it is closed
     photo_count        active files of type PHOTO linked to the request in app.file_index
     equipment_tag_number  the heater's tag now (gold.vw_equipment_current); NULL for a FLOC request
   ===================================================================== */
CREATE OR ALTER VIEW app.vw_request_queue
AS
SELECT
    r.request_id,
    r.request_ref,
    r.request_status,
    CAST(CASE r.request_status WHEN N'PENDING_RESPONSIBLE' THEN N'RESPONSIBLE'
                               WHEN N'PENDING_ACCOUNTABLE' THEN N'ACCOUNTABLE'
                               ELSE NULL END AS nvarchar(12))                         AS approval_stage,
    r.entity_type,
    r.equipment_id,
    r.equipment_number,
    r.functional_location,
    e.equipment_tag_number,
    r.profit_center_name,
    r.field_code,
    fc.label                                                                          AS field_label,
    fc.sap_column                                                                     AS sap_field,
    r.old_value,
    r.new_value,
    r.reason,
    r.note,
    r.source_type,
    r.source_rule_id,
    r.source_rule_version,
    CAST(CASE r.source_type
             WHEN N'BUSINESS_RULE'      THEN N'Rule ' + ISNULL(r.source_rule_id, N'?') + N' v' + ISNULL(CAST(r.source_rule_version AS nvarchar(10)), N'?')
             WHEN N'FIELD'              THEN N'Field submission'
             WHEN N'MANUAL'             THEN N'Manual request'
             WHEN N'CORRECTION_IMPORT'  THEN N'Correction import'
             WHEN N'NEW_CHARACTERISTIC' THEN N'New field request'
             WHEN N'NEW_RECORD'         THEN N'New heater request'
             ELSE r.source_type END AS nvarchar(120))                                 AS source_label,
    r.requested_by,
    r.requested_at_utc,
    rs.detected_at_utc,
    r.responsible_group,
    r.accountable_group,
    r.return_recipient_type,
    r.return_recipient,
    CAST(CASE WHEN r.request_status = N'APPROVED' OR r.request_status = N'REJECTED' OR r.request_status = N'CANCELLED'
              THEN NULL
              ELSE DATEDIFF(hour, r.requested_at_utc, SYSUTCDATETIME()) END AS int)   AS age_hours,
    CAST(ISNULL(ph.n, 0) AS int)                                                      AS photo_count,
    r.updated_at_utc
FROM app.change_request AS r
LEFT JOIN app.field_catalog AS fc ON fc.field_code = r.field_code
LEFT JOIN gold.vw_equipment_current AS e ON e.equipment_id = r.equipment_id
LEFT JOIN app.business_rule_result AS rs ON rs.result_id = r.source_result_id
OUTER APPLY
(
    SELECT COUNT(*) AS n
    FROM app.file_index AS f
    WHERE f.request_id = r.request_id AND f.file_type = N'PHOTO' AND f.is_active = 1
) AS ph;
