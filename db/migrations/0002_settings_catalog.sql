/* =====================================================================
   0002_settings_catalog.sql   APP-1, migration 2 of 7
   Tables: app.app_setting, app.field_catalog, app.field_allowed_value
   Columns and meanings: FINAL PLAN/09_Data_Dictionary.md section 2.
   Re-runnable: yes (IF OBJECT_ID ... IS NULL). Never edit after it has run.
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL 0002 wrong editor: connected to "' + DB_NAME() + '". Open the item named ATLAS_SQL_DB whose type is SQL database. Nothing was changed.';
    RETURN;
END
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'app')
BEGIN
    PRINT 'FAIL 0002 schema app does not exist: run 0001_schemas.sql first. Nothing was changed.';
    RETURN;
END

DECLARE @failed int = 0;

/* ---- 2.1 app.app_setting ------------------------------------------------ */
BEGIN TRY
    IF OBJECT_ID(N'app.app_setting', N'U') IS NULL
        CREATE TABLE app.app_setting
        (
            setting_key      nvarchar(64)  NOT NULL,
            setting_value    nvarchar(400) NOT NULL,
            description      nvarchar(400) NOT NULL,
            is_assumption    bit           NOT NULL CONSTRAINT df_app_setting_is_assumption DEFAULT (0),
            related_question nvarchar(40)  NULL,
            updated_by       nvarchar(256) NOT NULL CONSTRAINT df_app_setting_updated_by DEFAULT (N'system:seed'),
            updated_at_utc   datetime2(3)  NOT NULL CONSTRAINT df_app_setting_updated_at DEFAULT (SYSUTCDATETIME()),
            CONSTRAINT pk_app_setting PRIMARY KEY (setting_key)
        );
    PRINT 'OK  0002 app.app_setting ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0002 app.app_setting, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- 2.2 app.field_catalog ---------------------------------------------- */
BEGIN TRY
    IF OBJECT_ID(N'app.field_catalog', N'U') IS NULL
        CREATE TABLE app.field_catalog
        (
            field_code                  nvarchar(64)  NOT NULL,
            label                       nvarchar(100) NOT NULL,
            entity_type                 nvarchar(10)  NOT NULL,
            data_type                   nvarchar(10)  NOT NULL,
            max_length                  int           NULL,
            unit                        nvarchar(20)  NULL,
            allowed_values_source       nvarchar(30)  NOT NULL CONSTRAINT df_field_catalog_allowed_src DEFAULT (N'NONE'),
            is_key_verification_field   bit           NOT NULL CONSTRAINT df_field_catalog_is_key DEFAULT (0),
            is_editable                 bit           NOT NULL CONSTRAINT df_field_catalog_is_editable DEFAULT (1),
            display_group               nvarchar(12)  NOT NULL CONSTRAINT df_field_catalog_display_group DEFAULT (N'ADDITIONAL'),
            display_order               int           NOT NULL,
            is_mandatory_for_submission bit           NOT NULL CONSTRAINT df_field_catalog_mandatory DEFAULT (0),
            sap_object                  nvarchar(10)  NULL,
            sap_table                   nvarchar(40)  NULL,
            sap_column                  nvarchar(40)  NULL,
            characteristic_name         nvarchar(30)  NULL,
            gold_column                 nvarchar(64)  NULL,
            is_active                   bit           NOT NULL CONSTRAINT df_field_catalog_is_active DEFAULT (1),
            CONSTRAINT pk_field_catalog PRIMARY KEY (field_code),
            CONSTRAINT ck_field_catalog_entity CHECK (entity_type IN (N'EQUIPMENT', N'FLOC')),
            CONSTRAINT ck_field_catalog_data_type CHECK (data_type IN (N'TEXT', N'DECIMAL', N'CODE')),
            CONSTRAINT ck_field_catalog_allowed_src CHECK (allowed_values_source IN (N'NONE', N'CLASS_CHARACTERISTIC', N'LIST')),
            CONSTRAINT ck_field_catalog_display_group CHECK (display_group IN (N'KEY', N'ADDITIONAL')),
            CONSTRAINT ck_field_catalog_sap_object CHECK (sap_object IS NULL OR sap_object IN (N'EQUI', N'IFLOT', N'CHAR'))
        );
    PRINT 'OK  0002 app.field_catalog ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0002 app.field_catalog, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- 2.3 app.field_allowed_value ---------------------------------------- */
BEGIN TRY
    IF OBJECT_ID(N'app.field_allowed_value', N'U') IS NULL
        CREATE TABLE app.field_allowed_value
        (
            field_code    nvarchar(64) NOT NULL,
            allowed_value nvarchar(70) NOT NULL,
            display_order int          NOT NULL CONSTRAINT df_field_allowed_value_order DEFAULT (0),
            is_active     bit          NOT NULL CONSTRAINT df_field_allowed_value_is_active DEFAULT (1),
            CONSTRAINT pk_field_allowed_value PRIMARY KEY (field_code, allowed_value),
            CONSTRAINT fk_field_allowed_value_field FOREIGN KEY (field_code) REFERENCES app.field_catalog (field_code)
        );
    PRINT 'OK  0002 app.field_allowed_value ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0002 app.field_allowed_value, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

IF @failed = 0 PRINT '0002_settings_catalog RESULT: ALL 3 TABLES READY';
ELSE PRINT '0002_settings_catalog RESULT: ' + CAST(@failed AS varchar(12)) + ' TABLE(S) FAILED';
