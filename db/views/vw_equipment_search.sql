/* =====================================================================
   app.vw_equipment_search      APP-2; FINAL PLAN/09 section 9; screens S-4 (search),
                                S-6 (field view finds a heater with it)
   Single statement per file; CREATE OR ALTER, safe to run again.

   One row per heater: every column of gold.vw_equipment_current (FINAL PLAN/01 section
   6.1, in the same order, same names, same types) plus three counters for the result list:

     open_request_count  change requests on this heater that are still open (status not
                         APPROVED, REJECTED or CANCELLED), counting requests on the heater
                         itself and requests on its functional location (FLOC)
     invalid_rule_count  NULL until APP-5. It will count the published rules whose latest
                         successful run flags this heater (app.vw_equipment_rule_status).
                         NULL means "not computed yet", not zero: the screen shows a dash
                         ("blank values show as blank, never as zero", REF-13 to 21).
                         APP-5 replaces this one line with the real count.
     verification_pct    gold.vw_verification_score.verification_pct (0 to 100), NULL when
                         the heater has no score row

   The gold columns are listed without a CAST on purpose: they keep exactly the types the
   contract gives them (db/tests/t_gold_contract.sql guards that), so a longer value from
   the data engineer can never be cut short here. t_equipment_search.sql checks the types.

   Key: equipment_id (ISNULL makes the view report it as never NULL, which the connector
   needs for a declared key). Exposed through the connector: no nvarchar(max).
   Reads gold.vw_equipment_current, gold.vw_verification_score and app.change_request.
   ===================================================================== */
CREATE OR ALTER VIEW app.vw_equipment_search
AS
SELECT
    ISNULL(e.equipment_id, 0) AS equipment_id,
    e.equipment_number,
    e.equipment_description,
    e.functional_location,
    e.floc_description,
    e.superior_functional_location,
    e.equipment_tag_number,
    e.equip_class,
    e.class_type,
    e.object_type,
    e.floc_class,
    e.tech_object_type,
    e.manufacturer,
    e.model_number,
    e.manufacturer_serial_number,
    e.fired_unfired,
    e.heat_duty_mmbtu_hr,
    e.heat_duty_source,
    e.equipment_user_status,
    e.floc_user_status,
    e.profit_center_name,
    e.planner_group,
    e.heater_population_method,
    e.golden_version_id,
    e.last_changed_at_utc,
    e.baseline_as_of_utc,
    CAST(ISNULL(oc.n, 0) AS int)  AS open_request_count,
    CAST(NULL AS int)             AS invalid_rule_count,
    v.verification_pct            AS verification_pct
FROM gold.vw_equipment_current AS e
OUTER APPLY
(
    SELECT COUNT(*) AS n
    FROM app.change_request AS r
    WHERE r.request_status <> N'APPROVED'
      AND r.request_status <> N'REJECTED'
      AND r.request_status <> N'CANCELLED'
      AND (r.equipment_id = e.equipment_id
           OR (r.entity_type = N'FLOC' AND r.functional_location = e.functional_location))
) AS oc
LEFT JOIN gold.vw_verification_score AS v ON v.equipment_id = e.equipment_id;
