/* =====================================================================
   app.fn_request_checks        APP-3; FINAL PLAN/03 APP-3 step 2, REF-52 [L0189-L0190]
                                (used by app.usp_request_checks and app.usp_request_decide)
   Single statement per file; CREATE OR ALTER, safe to run again.
   Needs the gold views (the synthetic stub or the data engineer's): gold.vw_equipment_current,
   gold.vw_equipment_field_current, gold.vw_floc_current; and app.fn_stage_eligibility,
   app.fn_value_check.

   The approval checks of one request, live, as the approver would see them. Six rows, always in
   this order, each with PASS, FAIL or NOT_CHECKED, a plain-English message and the time:

     1 ASSOCIATION_MATCH            the heater is still at the functional location (FLOC) the request
                                    was raised at (for a FLOC request: the FLOC still exists)
     2 OLD_VALUE_CURRENT            the golden value is still the value the requester saw (numbers
                                    compare as numbers, text compares exactly, blank equals blank)
     3 VALUE_ALLOWED                the proposed value is still acceptable (app.fn_value_check)
     4 UNITS_EXPLICIT               a numeric field must carry its unit in the catalogue [INFERRED
                                    reading of "units explicit"]
     5 NO_CONFLICTING_OPEN_REQUEST  no other open request proposes a different value for the same field
                                    of the same heater (or FLOC)
     6 USER_ELIGIBLE_FOR_STAGE      the person named in @actor_email may decide this stage: flag, scope
                                    and group (app.fn_stage_eligibility), and, at the accountable stage
                                    with SAME_PERSON_BOTH_STAGES = 0, did not approve the first stage

   A request that is not waiting for a decision (status other than PENDING_RESPONSIBLE or
   PENDING_ACCOUNTABLE) gets NOT_CHECKED on every row: the checks mean something only while a person
   is about to decide, and a merged request would otherwise "fail" check 2 because the value changed.
   A blank @actor_email gives NOT_CHECKED on row 6 (the detail screen can show checks without a user).
   An unknown request id returns no rows.

   Input : @request_id, @actor_email (the person who is about to decide; may be NULL)
   Output: request_id, request_status, check_order, check_code, check_status, message, checked_at_utc

   The approval procedure blocks only on FAIL of rows 1 to 5 (row 6 it enforces itself, with its own
   refusal). NOT_CHECKED never blocks.
   ===================================================================== */
CREATE OR ALTER FUNCTION app.fn_request_checks
(
    @request_id  bigint,
    @actor_email nvarchar(256)
)
RETURNS TABLE
AS
RETURN
(
    SELECT
        r.request_id,
        r.request_status,
        c.check_order,
        CAST(c.check_code   AS nvarchar(40))  AS check_code,
        CAST(c.check_status AS nvarchar(12))  AS check_status,
        CAST(c.message      AS nvarchar(400)) AS message,
        SYSUTCDATETIME() AS checked_at_utc
    FROM app.change_request AS r
    LEFT JOIN app.field_catalog AS fc ON fc.field_code = r.field_code
    OUTER APPLY (SELECT TOP (1) 1 AS ok, e.functional_location AS floc
                 FROM gold.vw_equipment_current AS e
                 WHERE r.entity_type = N'EQUIPMENT' AND e.equipment_id = r.equipment_id) AS ge
    OUTER APPLY (SELECT TOP (1) f.current_value AS val
                 FROM gold.vw_equipment_field_current AS f
                 WHERE r.entity_type = N'EQUIPMENT' AND f.equipment_id = r.equipment_id AND f.field_code = r.field_code) AS gv
    OUTER APPLY (SELECT TOP (1) 1 AS ok, l.floc_class AS floc_class
                 FROM gold.vw_floc_current AS l
                 WHERE r.entity_type = N'FLOC' AND l.functional_location = r.functional_location) AS gl
    CROSS APPLY (SELECT CASE r.request_status WHEN N'PENDING_RESPONSIBLE' THEN N'RESPONSIBLE'
                                              WHEN N'PENDING_ACCOUNTABLE' THEN N'ACCOUNTABLE'
                                              ELSE NULL END AS stage) AS st
    CROSS APPLY (SELECT CASE st.stage WHEN N'RESPONSIBLE' THEN r.responsible_group
                                      WHEN N'ACCOUNTABLE' THEN r.accountable_group
                                      ELSE NULL END AS grp) AS sg
    CROSS APPLY (SELECT LOWER(LTRIM(RTRIM(@actor_email))) AS a) AS ac
    CROSS APPLY (SELECT CASE WHEN r.entity_type = N'EQUIPMENT' OR r.field_code = N'FLOC_CLASS' THEN 1 ELSE 0 END AS supported,
                         CASE WHEN r.entity_type = N'EQUIPMENT' THEN ge.ok ELSE gl.ok END AS known,
                         CASE WHEN r.entity_type = N'EQUIPMENT' THEN gv.val ELSE gl.floc_class END AS cur) AS k
    CROSS APPLY (SELECT ISNULL(LTRIM(RTRIM(r.old_value)), N'') AS oldv,
                         ISNULL(LTRIM(RTRIM(k.cur)), N'')       AS curv,
                         ISNULL(LTRIM(RTRIM(r.new_value)), N'') AS newv) AS t
    CROSS APPLY (SELECT CASE WHEN t.oldv COLLATE Latin1_General_BIN2 = t.curv COLLATE Latin1_General_BIN2 THEN 1
                             WHEN fc.data_type = N'DECIMAL'
                                  AND TRY_CONVERT(decimal(18,4), NULLIF(t.oldv, N'')) = TRY_CONVERT(decimal(18,4), NULLIF(t.curv, N'')) THEN 1
                             ELSE 0 END AS eq) AS q
    OUTER APPLY app.fn_value_check(r.field_code, r.new_value) AS vc
    OUTER APPLY (SELECT TOP (1) o.request_ref AS ref
                 FROM app.change_request AS o
                 WHERE o.request_id <> r.request_id
                   AND o.request_status <> N'APPROVED' AND o.request_status <> N'REJECTED' AND o.request_status <> N'CANCELLED'
                   AND o.field_code = r.field_code
                   AND (   (r.entity_type = N'EQUIPMENT' AND o.equipment_id = r.equipment_id)
                        OR (r.entity_type = N'FLOC' AND o.entity_type = N'FLOC' AND o.functional_location = r.functional_location))
                   AND ISNULL(o.new_value, N'') COLLATE Latin1_General_BIN2 <> t.newv COLLATE Latin1_General_BIN2
                 ORDER BY o.request_id) AS cf
    OUTER APPLY (SELECT TOP (1) s.setting_value AS v
                 FROM app.app_setting AS s
                 WHERE s.setting_key = N'SAME_PERSON_BOTH_STAGES') AS sp
    OUTER APPLY app.fn_stage_eligibility(ac.a, st.stage, sg.grp, r.profit_center_name) AS el
    CROSS APPLY (SELECT CASE WHEN st.stage = N'ACCOUNTABLE'
                              AND ISNULL(sp.v, N'0') = N'0'
                              AND EXISTS (SELECT 1 FROM app.change_request_event AS ev
                                          WHERE ev.request_id = r.request_id
                                            AND ev.event_type = N'RESPONSIBLE_APPROVED'
                                            AND ev.actor = ac.a) THEN 1 ELSE 0 END AS blocked) AS sgr
    CROSS APPLY
    (
        SELECT
            N'the request is ' + r.request_status + N': checks apply only while it waits for a decision' AS notpending,

            -- 1 ASSOCIATION_MATCH
            CASE WHEN st.stage IS NULL THEN N'NOT_CHECKED'
                 WHEN r.entity_type = N'EQUIPMENT' AND ge.ok IS NULL THEN N'FAIL'
                 WHEN r.entity_type = N'EQUIPMENT' AND r.functional_location IS NULL THEN N'NOT_CHECKED'
                 WHEN r.entity_type = N'EQUIPMENT'
                      AND ISNULL(ge.floc, N'') COLLATE Latin1_General_BIN2 = r.functional_location COLLATE Latin1_General_BIN2 THEN N'PASS'
                 WHEN r.entity_type = N'EQUIPMENT' THEN N'FAIL'
                 WHEN r.entity_type = N'FLOC' AND gl.ok IS NULL THEN N'FAIL'
                 WHEN r.entity_type = N'FLOC' THEN N'PASS'
                 ELSE N'NOT_CHECKED' END AS c1s,
            CASE WHEN st.stage IS NULL THEN NULL
                 WHEN r.entity_type = N'EQUIPMENT' AND ge.ok IS NULL THEN N'the heater is no longer in gold'
                 WHEN r.entity_type = N'EQUIPMENT' AND r.functional_location IS NULL THEN N'no location was stored with the request'
                 WHEN r.entity_type = N'EQUIPMENT'
                      AND ISNULL(ge.floc, N'') COLLATE Latin1_General_BIN2 = r.functional_location COLLATE Latin1_General_BIN2
                      THEN N'the heater is still at the location the request was raised at'
                 WHEN r.entity_type = N'EQUIPMENT'
                      THEN N'the heater is now at ' + LEFT(ISNULL(ge.floc, N'(none)'), 60) + N', the request was raised at ' + LEFT(r.functional_location, 60)
                 WHEN r.entity_type = N'FLOC' AND gl.ok IS NULL THEN N'the functional location is no longer in gold'
                 WHEN r.entity_type = N'FLOC' THEN N'the functional location still exists'
                 ELSE N'not applicable' END AS c1m,

            -- 2 OLD_VALUE_CURRENT
            CASE WHEN st.stage IS NULL THEN N'NOT_CHECKED'
                 WHEN k.supported = 0 THEN N'NOT_CHECKED'
                 WHEN k.known IS NULL THEN N'FAIL'
                 WHEN q.eq = 1 THEN N'PASS'
                 ELSE N'FAIL' END AS c2s,
            CASE WHEN st.stage IS NULL THEN NULL
                 WHEN k.supported = 0 THEN N'the current value of this field is not read from gold yet'
                 WHEN k.known IS NULL THEN N'the heater or location is no longer in gold'
                 WHEN q.eq = 1 THEN N'the current value is still the one the request expected'
                 ELSE N'the current value is "' + LEFT(t.curv, 100) + N'", the request expected "' + LEFT(t.oldv, 100) + N'"' END AS c2m,

            -- 3 VALUE_ALLOWED
            CASE WHEN st.stage IS NULL OR r.field_code IS NULL THEN N'NOT_CHECKED'
                 WHEN vc.problem IS NULL THEN N'PASS'
                 ELSE N'FAIL' END AS c3s,
            CASE WHEN st.stage IS NULL THEN NULL
                 WHEN r.field_code IS NULL THEN N'no catalogue field to check against'
                 WHEN vc.problem IS NULL THEN N'the proposed value is allowed'
                 ELSE vc.problem END AS c3m,

            -- 4 UNITS_EXPLICIT
            CASE WHEN st.stage IS NULL OR r.field_code IS NULL THEN N'NOT_CHECKED'
                 WHEN fc.data_type = N'DECIMAL' AND fc.unit IS NULL THEN N'FAIL'
                 ELSE N'PASS' END AS c4s,
            CASE WHEN st.stage IS NULL THEN NULL
                 WHEN r.field_code IS NULL THEN N'no catalogue field to check against'
                 WHEN fc.data_type = N'DECIMAL' AND fc.unit IS NULL THEN N'this numeric field has no unit in the catalogue, so the unit is not explicit'
                 WHEN fc.data_type = N'DECIMAL' THEN N'the unit is ' + fc.unit + N', from the catalogue'
                 ELSE N'no unit applies to this field' END AS c4m,

            -- 5 NO_CONFLICTING_OPEN_REQUEST
            CASE WHEN st.stage IS NULL OR r.field_code IS NULL THEN N'NOT_CHECKED'
                 WHEN cf.ref IS NOT NULL THEN N'FAIL'
                 ELSE N'PASS' END AS c5s,
            CASE WHEN st.stage IS NULL THEN NULL
                 WHEN r.field_code IS NULL THEN N'no catalogue field to check against'
                 WHEN cf.ref IS NOT NULL THEN N'request ' + cf.ref + N' is also open on this field with a different value'
                 ELSE N'no other open request proposes a different value' END AS c5m,

            -- 6 USER_ELIGIBLE_FOR_STAGE
            CASE WHEN st.stage IS NULL THEN N'NOT_CHECKED'
                 WHEN ac.a IS NULL OR ac.a = N'' THEN N'NOT_CHECKED'
                 WHEN el.is_group_member = 0 OR el.has_flag_in_scope = 0 THEN N'FAIL'
                 WHEN sgr.blocked = 1 THEN N'FAIL'
                 ELSE N'PASS' END AS c6s,
            CASE WHEN st.stage IS NULL THEN NULL
                 WHEN ac.a IS NULL OR ac.a = N'' THEN N'no approver was named, so eligibility was not checked'
                 WHEN el.is_group_member = 0 THEN N'not an active member of the group for this stage (' + ISNULL(sg.grp, N'none') + N')'
                 WHEN el.has_flag_in_scope = 0 THEN N'no role of this person allows the ' + st.stage + N' stage for ' + LEFT(r.profit_center_name, 40)
                 WHEN sgr.blocked = 1 THEN N'the same person may not approve both stages of one request (setting SAME_PERSON_BOTH_STAGES)'
                 ELSE N'allowed to decide the ' + st.stage + N' stage' END AS c6m
    ) AS x
    CROSS APPLY (VALUES
        (1, N'ASSOCIATION_MATCH',           x.c1s, ISNULL(x.c1m, x.notpending)),
        (2, N'OLD_VALUE_CURRENT',           x.c2s, ISNULL(x.c2m, x.notpending)),
        (3, N'VALUE_ALLOWED',               x.c3s, ISNULL(x.c3m, x.notpending)),
        (4, N'UNITS_EXPLICIT',              x.c4s, ISNULL(x.c4m, x.notpending)),
        (5, N'NO_CONFLICTING_OPEN_REQUEST', x.c5s, ISNULL(x.c5m, x.notpending)),
        (6, N'USER_ELIGIBLE_FOR_STAGE',     x.c6s, ISNULL(x.c6m, x.notpending))
    ) AS c (check_order, check_code, check_status, message)
    WHERE r.request_id = @request_id
);
