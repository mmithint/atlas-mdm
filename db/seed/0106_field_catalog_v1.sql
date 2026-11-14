/* =====================================================================
   0106_field_catalog_v1.sql    APP-1 seed: the 13 fields of catalogue version 1
   Source    : FINAL PLAN/01_Architecture_and_Contracts.md section 6.2 (version 1,
               Mon 16 Nov); column meanings: 09_Data_Dictionary.md section 2.2-2.3.
   Writes to : app.field_catalog, app.field_allowed_value
   Database  : the ATLAS Fabric SQL database (item of type SQL database)
   Re-runnable: yes, INSERT-ONLY. A row that already exists is never changed, so
   re-running cannot undo an admin's edit or overwrite the SAP mapping columns the
   data engineer fills later (sap_object, sap_table, sap_column, characteristic_name,
   gold_column). To change a seeded field, use the Admin screen or a new seed file.

   Choices made here [INFERRED: design, ours]
   - max_length = the length of the matching column in the gold contract (01 section
     6.1). The SAP lengths in REF-51 are confirmed by the data engineer (DE-3).
   - FIRED_UNFIRED is the only LIST field: FIRED and UNFIRED. The client's third value
     UNKNOWN is "a temporary cleanup exception" [REF-46:L0003], so users are not offered it.
   - All other fields are free (allowed_values_source = NONE) in version 1. CLASS_CHARACTERISTIC
     values arrive with gold.class_characteristic (DE-3).
   - EQUIP_CLASS, CLASS_TYPE, OBJECT_TYPE and FLOC_CLASS are "yes (admin / rule)" in 01
     section 6.2: only an admin or a rule may change them. The catalogue has no column
     for that restriction, so it is enforced by app.usp_request_create (APP-3) [OPEN].
   - Five key fields count toward the verification percentage [DBF-DOC:L0074].
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL 0106.0 wrong editor: connected to "' + DB_NAME() + '". Open the item named ATLAS_SQL_DB whose type is SQL database. Nothing was changed.';
    RETURN;
END
IF OBJECT_ID(N'app.field_catalog', N'U') IS NULL OR OBJECT_ID(N'app.field_allowed_value', N'U') IS NULL
BEGIN
    PRINT 'FAIL 0106.1 app.field_catalog or app.field_allowed_value not found: run migration 0002_settings_catalog.sql first. Nothing was changed.';
    RETURN;
END

BEGIN TRY
    DECLARE @f TABLE
    (
        field_code nvarchar(64) NOT NULL PRIMARY KEY, label nvarchar(100) NOT NULL, entity_type nvarchar(10) NOT NULL,
        data_type nvarchar(10) NOT NULL, max_length int NULL, unit nvarchar(20) NULL, allowed_values_source nvarchar(30) NOT NULL,
        is_key bit NOT NULL, display_group nvarchar(12) NOT NULL, display_order int NOT NULL
    );
    INSERT INTO @f (field_code, label, entity_type, data_type, max_length, unit, allowed_values_source, is_key, display_group, display_order) VALUES
        (N'MANUFACTURER',          N'Manufacturer',                N'EQUIPMENT', N'TEXT',    30,   NULL,        N'NONE', 1, N'KEY',        1),
        (N'MODEL_NUMBER',          N'Model number',                N'EQUIPMENT', N'TEXT',    20,   NULL,        N'NONE', 1, N'KEY',        2),
        (N'SERIAL_NUMBER',         N'Serial number',               N'EQUIPMENT', N'TEXT',    30,   NULL,        N'NONE', 1, N'KEY',        3),
        (N'FIRED_UNFIRED',         N'Fired / unfired (fuel type)', N'EQUIPMENT', N'CODE',    30,   NULL,        N'LIST', 1, N'KEY',        4),
        (N'HEAT_DUTY',             N'Heat duty (MMBTU/hr)',        N'EQUIPMENT', N'DECIMAL', NULL, N'MMBTU/hr', N'NONE', 1, N'KEY',        5),
        (N'EQUIPMENT_TAG_NUMBER',  N'Engineering tag',             N'EQUIPMENT', N'TEXT',    30,   NULL,        N'NONE', 0, N'ADDITIONAL', 6),
        (N'EQUIPMENT_DESCRIPTION', N'Description',                 N'EQUIPMENT', N'TEXT',    40,   NULL,        N'NONE', 0, N'ADDITIONAL', 7),
        (N'EQUIP_CLASS',           N'Equipment class',             N'EQUIPMENT', N'CODE',    30,   NULL,        N'NONE', 0, N'ADDITIONAL', 8),
        (N'CLASS_TYPE',            N'Class type',                  N'EQUIPMENT', N'CODE',    30,   NULL,        N'NONE', 0, N'ADDITIONAL', 9),
        (N'OBJECT_TYPE',           N'Object type',                 N'EQUIPMENT', N'CODE',    30,   NULL,        N'NONE', 0, N'ADDITIONAL', 10),
        (N'EQUIPMENT_USER_STATUS', N'User status',                 N'EQUIPMENT', N'CODE',    30,   NULL,        N'NONE', 0, N'ADDITIONAL', 11),
        (N'FUNCTIONAL_LOCATION',   N'Installed at FLOC',           N'EQUIPMENT', N'TEXT',    40,   NULL,        N'NONE', 0, N'ADDITIONAL', 12),
        (N'FLOC_CLASS',            N'FLOC class',                  N'FLOC',      N'CODE',    30,   NULL,        N'NONE', 0, N'ADDITIONAL', 13);

    DECLARE @v TABLE (field_code nvarchar(64) NOT NULL, allowed_value nvarchar(70) NOT NULL, display_order int NOT NULL, PRIMARY KEY (field_code, allowed_value));
    INSERT INTO @v (field_code, allowed_value, display_order) VALUES
        (N'FIRED_UNFIRED', N'FIRED',   1),
        (N'FIRED_UNFIRED', N'UNFIRED', 2);

    DECLARE @new_fields int, @new_values int;

    BEGIN TRANSACTION;

    INSERT INTO app.field_catalog
        (field_code, label, entity_type, data_type, max_length, unit, allowed_values_source,
         is_key_verification_field, is_editable, display_group, display_order, is_mandatory_for_submission, is_active)
    SELECT f.field_code, f.label, f.entity_type, f.data_type, f.max_length, f.unit, f.allowed_values_source,
           f.is_key, 1, f.display_group, f.display_order, 0, 1
    FROM @f AS f
    WHERE NOT EXISTS (SELECT 1 FROM app.field_catalog AS c WHERE c.field_code = f.field_code);
    SET @new_fields = @@ROWCOUNT;

    INSERT INTO app.field_allowed_value (field_code, allowed_value, display_order, is_active)
    SELECT v.field_code, v.allowed_value, v.display_order, 1
    FROM @v AS v
    WHERE NOT EXISTS (SELECT 1 FROM app.field_allowed_value AS a WHERE a.field_code = v.field_code AND a.allowed_value = v.allowed_value);
    SET @new_values = @@ROWCOUNT;

    COMMIT TRANSACTION;

    -- PRINT accepts only plain values (Msg 1046 for a subquery), so count first
    DECLARE @total_fields int = (SELECT COUNT(*) FROM app.field_catalog);
    DECLARE @total_values int = (SELECT COUNT(*) FROM app.field_allowed_value);
    PRINT 'OK  0106 field catalogue: ' + CAST(@new_fields AS varchar(12)) + ' new field(s), '
        + CAST(@total_fields AS varchar(12)) + ' in total (expected 13); '
        + CAST(@new_values AS varchar(12)) + ' new allowed value(s), '
        + CAST(@total_values AS varchar(12)) + ' in total (expected 2)';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 0106.9 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;
