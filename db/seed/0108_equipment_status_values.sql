/* =====================================================================
   0108_equipment_status_values.sql    APP-3 stage 0 seed: the equipment status list
   Source    : FINAL PLAN/06_Client_Inputs_and_Assumptions.md section 5, gap 2, and
               decision D-18 (16 Nov 2026); FINAL PLAN/01 section 6.2.
   Why       : the EVOLVE equipment header accepts only AVFS / NOPE / OPER / DECM
               [REF-47:L0002]. POC-DE-25 requires exported status values from that list,
               and POC-DE-16 applies value checks to values entered in the app. So the app
               offers and accepts only these four codes.
   Writes to : app.field_allowed_value (4 rows); app.field_catalog (allowed_values_source
               of the one row EQUIPMENT_USER_STATUS)
   Database  : the ATLAS Fabric SQL database (item of type SQL database)
   Re-runnable: yes. A value is inserted only if it is missing (a value an admin retired
   stays retired). The field is switched from NONE to LIST only while it is still NONE,
   the 0106 default, so an admin's later choice is never overwritten.
   Not here  : the check itself. app.usp_request_create (APP-3) refuses a new value outside
   the list; t_request_lifecycle scenario 15 proves it. Values already in gold outside the
   list (OOSR, SOLD, "AVFS DECM" [REF-51:L0394]) stay visible; only new values are checked.
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL 0108.0 wrong editor: connected to "' + DB_NAME() + '". Open the item named ATLAS_SQL_DB whose type is SQL database. Nothing was changed.';
    RETURN;
END
IF OBJECT_ID(N'app.field_catalog', N'U') IS NULL OR OBJECT_ID(N'app.field_allowed_value', N'U') IS NULL
BEGIN
    PRINT 'FAIL 0108.1 app.field_catalog or app.field_allowed_value not found: run migration 0002_settings_catalog.sql first. Nothing was changed.';
    RETURN;
END
IF NOT EXISTS (SELECT 1 FROM app.field_catalog WHERE field_code = N'EQUIPMENT_USER_STATUS')
BEGIN
    PRINT 'FAIL 0108.2 field EQUIPMENT_USER_STATUS not found: run seed 0106_field_catalog_v1.sql first. Nothing was changed.';
    RETURN;
END

BEGIN TRY
    -- Order = how the drop-down lists them; meanings from the SAP dictionary [REF-51:L0395]
    DECLARE @v TABLE (allowed_value nvarchar(70) NOT NULL PRIMARY KEY, display_order int NOT NULL);
    INSERT INTO @v (allowed_value, display_order) VALUES
        (N'OPER', 1),   -- operating
        (N'NOPE', 2),   -- non-operating
        (N'AVFS', 3),   -- available for service
        (N'DECM', 4);   -- decommissioned

    DECLARE @new_values int, @switched int;

    BEGIN TRANSACTION;

    INSERT INTO app.field_allowed_value (field_code, allowed_value, display_order, is_active)
    SELECT N'EQUIPMENT_USER_STATUS', v.allowed_value, v.display_order, 1
    FROM @v AS v
    WHERE NOT EXISTS (SELECT 1 FROM app.field_allowed_value AS a
                      WHERE a.field_code = N'EQUIPMENT_USER_STATUS' AND a.allowed_value = v.allowed_value);
    SET @new_values = @@ROWCOUNT;

    UPDATE app.field_catalog
    SET    allowed_values_source = N'LIST'
    WHERE  field_code = N'EQUIPMENT_USER_STATUS'
      AND  allowed_values_source = N'NONE';
    SET @switched = @@ROWCOUNT;

    COMMIT TRANSACTION;

    -- PRINT accepts only plain values (Msg 1046 for a subquery), so read into variables first
    DECLARE @source nvarchar(30) = (SELECT allowed_values_source FROM app.field_catalog WHERE field_code = N'EQUIPMENT_USER_STATUS');
    DECLARE @active_four int = (SELECT COUNT(*) FROM app.field_allowed_value
                                WHERE field_code = N'EQUIPMENT_USER_STATUS' AND is_active = 1
                                  AND allowed_value IN (N'AVFS', N'NOPE', N'OPER', N'DECM'));
    DECLARE @active_other int = (SELECT COUNT(*) FROM app.field_allowed_value
                                 WHERE field_code = N'EQUIPMENT_USER_STATUS' AND is_active = 1
                                   AND allowed_value NOT IN (N'AVFS', N'NOPE', N'OPER', N'DECM'));

    IF ISNULL(@source, N'') = N'LIST' AND @active_four = 4 AND @active_other = 0
        PRINT 'OK  0108 equipment status list: ' + CAST(@new_values AS varchar(12)) + ' new value(s), '
            + CAST(@switched AS varchar(12)) + ' field switched to LIST; active values AVFS, NOPE, OPER, DECM (4 of 4)';
    ELSE
        PRINT 'WARN 0108 equipment status list differs from the decision: source ' + ISNULL(@source, N'(none)')
            + ' (expected LIST), ' + CAST(@active_four AS varchar(12)) + ' of the 4 codes active, '
            + CAST(@active_other AS varchar(12)) + ' other active value(s) (expected 0). An admin may have changed it; tell Claude.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 0108.9 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;
