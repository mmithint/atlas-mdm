/* =====================================================================
   0109_admin_only_fields.sql   APP-3 stage 0 seed: which catalogue fields only an admin
                                (or a rule / the data engineer) may ask to change
   Source    : FINAL PLAN/01 section 6.2 (the four classification fields are marked
               "yes (admin / rule)") and the APP-1 finding that the catalogue has no column
               for it (FINAL PLAN/08, 14 Nov: "APP-3 must enforce it").
   Why a setting: no schema change is needed (09 first, then a migration, would be), and an
               admin can change the list on the Admin screen later without code.
   Writes to : app.app_setting (one row, ADMIN_ONLY_FIELDS)
   Database  : the ATLAS Fabric SQL database (item of type SQL database)
   Re-runnable: yes, INSERT-ONLY. A value an admin changed is never overwritten.
   Used by   : app.usp_request_create. A person (source FIELD or MANUAL) needs the flag
               can_manage_admin to request a change to these fields; rule runs (system:rule-run)
               and the data engineer's import (system:de) are not restricted.
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL 0109.0 wrong editor: connected to "' + DB_NAME() + '". Open the item named ATLAS_SQL_DB whose type is SQL database. Nothing was changed.';
    RETURN;
END
IF OBJECT_ID(N'app.app_setting', N'U') IS NULL
BEGIN
    PRINT 'FAIL 0109.1 app.app_setting not found: run migration 0002_settings_catalog.sql first. Nothing was changed.';
    RETURN;
END

BEGIN TRY
    DECLARE @new int;

    INSERT INTO app.app_setting (setting_key, setting_value, description, is_assumption, related_question, updated_by, updated_at_utc)
    SELECT N'ADMIN_ONLY_FIELDS',
           N'EQUIP_CLASS,CLASS_TYPE,OBJECT_TYPE,FLOC_CLASS',
           N'Comma-separated field codes that only an admin may ask to change by hand. Rules and the data engineer''s import may still propose them (01 section 6.2: "yes (admin / rule)").',
           0, NULL, N'system:seed', SYSUTCDATETIME()
    WHERE NOT EXISTS (SELECT 1 FROM app.app_setting AS a WHERE a.setting_key = N'ADMIN_ONLY_FIELDS');
    SET @new = @@ROWCOUNT;

    -- PRINT accepts only plain values (Msg 1046 for a subquery), so read into a variable first
    DECLARE @value nvarchar(400) = (SELECT setting_value FROM app.app_setting WHERE setting_key = N'ADMIN_ONLY_FIELDS');
    PRINT 'OK  0109 ADMIN_ONLY_FIELDS: ' + CAST(@new AS varchar(12)) + ' new; value is ' + ISNULL(@value, N'(missing)');
END TRY
BEGIN CATCH
    PRINT 'FAIL 0109.9 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;
