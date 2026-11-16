/* =====================================================================
   app.usp_equipment_detail     APP-2, read path C (decided 15 Nov, D-17); screen S-5
   Single statement per file; CREATE OR ALTER, safe to run again.
   Called by the function getEquipmentDetail. Reads only. Needs the gold views
   (gold.vw_equipment_current, gold.vw_floc_current, gold.vw_equipment_field_current;
   the synthetic stub or the data engineer's real views) and app.vw_field_ownership.
   Test: db/tests/t_equipment_read.sql

   Everything the detail screen needs for ONE heater, in one call, so the function pays for
   one connection instead of five round trips. Four result sets, always in this order (an
   empty set when there is nothing to show):

     1  the heater           gold.vw_equipment_current, 0 or 1 row (0 = no such heater)
     2  its location         gold.vw_floc_current, the row of the heater's functional location
     3  its field values     gold.vw_equipment_field_current, one row per catalogue field of the heater
     4  the field owners     app.vw_field_ownership, one row per active catalogue field
                             (the same for every heater; sent with it so the screen needs no second call)

   The catalogue itself (app.field_catalog) is a plain table the browser reads through the
   connector, so it is not repeated here.

   SELECT * is deliberate for the three gold views: they are the data engineer's contract
   (FINAL PLAN/01 section 6.1, guarded by t_gold_contract.sql) and the function picks the
   columns it knows, so a column the engineer adds later changes nothing here.
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_equipment_detail
    @equipment_id int
AS
BEGIN
    SET NOCOUNT ON;

    SELECT e.*
    FROM gold.vw_equipment_current AS e
    WHERE e.equipment_id = @equipment_id;

    SELECT f.*
    FROM gold.vw_floc_current AS f
    WHERE f.functional_location =
          (SELECT e.functional_location FROM gold.vw_equipment_current AS e WHERE e.equipment_id = @equipment_id);

    SELECT x.*
    FROM gold.vw_equipment_field_current AS x
    WHERE x.equipment_id = @equipment_id;

    SELECT o.*
    FROM app.vw_field_ownership AS o;
END
