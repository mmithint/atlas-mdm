/* =====================================================================
   0005_evidence.sql         APP-1, migration 5 of 7
   Tables: app.field_verification, app.file_index, app.ai_extraction
   Columns and meanings: FINAL PLAN/09_Data_Dictionary.md section 5.
   Re-runnable: yes (IF OBJECT_ID ... IS NULL). Never edit after it has run.
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL 0005 wrong editor: connected to "' + DB_NAME() + '". Open the item named ATLAS_SQL_DB whose type is SQL database. Nothing was changed.';
    RETURN;
END
IF OBJECT_ID(N'app.change_request', N'U') IS NULL OR OBJECT_ID(N'app.field_catalog', N'U') IS NULL
BEGIN
    PRINT 'FAIL 0005 app.change_request or app.field_catalog is missing: run 0002 and 0004 first. Nothing was changed.';
    RETURN;
END

DECLARE @failed int = 0;

/* ---- 5.1 app.field_verification --------------------------------------------- */
BEGIN TRY
    IF OBJECT_ID(N'app.field_verification', N'U') IS NULL
        CREATE TABLE app.field_verification
        (
            verification_id bigint IDENTITY(1,1) NOT NULL,
            submission_id   uniqueidentifier NOT NULL,
            equipment_id    int            NOT NULL,
            field_code      nvarchar(64)   NOT NULL,
            mark            nvarchar(24)   NOT NULL,
            observed_value  nvarchar(400)  NULL,
            reason_code     nvarchar(30)   NULL,
            comment         nvarchar(1000) NULL,
            request_id      bigint         NULL,
            verified_by     nvarchar(256)  NOT NULL,
            verified_at_utc datetime2(3)   NOT NULL CONSTRAINT df_field_verification_at DEFAULT (SYSUTCDATETIME()),
            CONSTRAINT pk_field_verification PRIMARY KEY (verification_id),
            CONSTRAINT fk_field_verification_field FOREIGN KEY (field_code) REFERENCES app.field_catalog (field_code),
            CONSTRAINT fk_field_verification_request FOREIGN KEY (request_id) REFERENCES app.change_request (request_id),
            CONSTRAINT ck_field_verification_mark CHECK (mark IN (N'VERIFIED_CORRECT', N'CORRECTION_REQUIRED', N'DID_NOT_VERIFY')),
            CONSTRAINT ck_field_verification_reason CHECK (reason_code IS NULL OR reason_code IN (N'ILLEGIBLE', N'NOT_FOUND'))
        );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_field_verification_equipment' AND object_id = OBJECT_ID(N'app.field_verification'))
        CREATE INDEX ix_field_verification_equipment ON app.field_verification (equipment_id, field_code, verified_at_utc);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_field_verification_submission' AND object_id = OBJECT_ID(N'app.field_verification'))
        CREATE INDEX ix_field_verification_submission ON app.field_verification (submission_id);
    PRINT 'OK  0005 app.field_verification ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0005 app.field_verification, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- 5.2 app.file_index ------------------------------------------------------ */
BEGIN TRY
    IF OBJECT_ID(N'app.file_index', N'U') IS NULL
        CREATE TABLE app.file_index
        (
            file_id              bigint IDENTITY(1,1) NOT NULL,
            file_type            nvarchar(10)  NOT NULL,
            storage_area         nvarchar(20)  NOT NULL,
            file_path            nvarchar(400) NOT NULL,
            file_name            nvarchar(200) NOT NULL,
            content_type         nvarchar(100) NOT NULL,
            size_bytes           bigint        NOT NULL,
            equipment_id         int           NULL,
            functional_location  nvarchar(40)  NULL,
            equipment_tag_number nvarchar(30)  NULL,
            request_id           bigint        NULL,
            submission_id        uniqueidentifier NULL,
            document_number      nvarchar(60)  NULL,
            sheet                nvarchar(10)  NULL,
            revision             nvarchar(10)  NULL,
            link_basis           nvarchar(20)  NOT NULL,
            captured_at_utc      datetime2(3)  NULL,
            uploaded_by          nvarchar(256) NOT NULL,
            uploaded_at_utc      datetime2(3)  NOT NULL CONSTRAINT df_file_index_uploaded_at DEFAULT (SYSUTCDATETIME()),
            is_active            bit           NOT NULL CONSTRAINT df_file_index_is_active DEFAULT (1),
            CONSTRAINT pk_file_index PRIMARY KEY (file_id),
            CONSTRAINT fk_file_index_request FOREIGN KEY (request_id) REFERENCES app.change_request (request_id),
            CONSTRAINT ck_file_index_type CHECK (file_type IN (N'PHOTO', N'PID', N'DOCUMENT')),
            CONSTRAINT ck_file_index_area CHECK (storage_area IN (N'APP_STORAGE', N'LAKEHOUSE_FILES')),
            CONSTRAINT ck_file_index_basis CHECK (link_basis IN (N'EQUIPMENT', N'TAG_VERIFIED', N'FACILITY_RELATED'))
        );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_file_index_equipment' AND object_id = OBJECT_ID(N'app.file_index'))
        CREATE INDEX ix_file_index_equipment ON app.file_index (equipment_id, file_type) WHERE equipment_id IS NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_file_index_request' AND object_id = OBJECT_ID(N'app.file_index'))
        CREATE INDEX ix_file_index_request ON app.file_index (request_id) WHERE request_id IS NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_file_index_submission' AND object_id = OBJECT_ID(N'app.file_index'))
        CREATE INDEX ix_file_index_submission ON app.file_index (submission_id) WHERE submission_id IS NOT NULL;
    PRINT 'OK  0005 app.file_index ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0005 app.file_index, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- 5.3 app.ai_extraction ----------------------------------------------------- */
BEGIN TRY
    IF OBJECT_ID(N'app.ai_extraction', N'U') IS NULL
        CREATE TABLE app.ai_extraction
        (
            extraction_id          bigint IDENTITY(1,1) NOT NULL,
            file_id                bigint        NOT NULL,
            equipment_id           int           NULL,
            status                 nvarchar(12)  NOT NULL,
            extracted_manufacturer nvarchar(100) NULL,
            extracted_model        nvarchar(100) NULL,
            extracted_serial       nvarchar(100) NULL,
            extracted_tag          nvarchar(60)  NULL,
            confidence             decimal(5,4)  NULL,
            raw_text               nvarchar(max) NULL,
            candidates_json        nvarchar(max) NULL,
            agent_model_id         nvarchar(100) NULL,
            error_category         nvarchar(60)  NULL,
            requested_by           nvarchar(256) NOT NULL,
            requested_at_utc       datetime2(3)  NOT NULL CONSTRAINT df_ai_extraction_at DEFAULT (SYSUTCDATETIME()),
            CONSTRAINT pk_ai_extraction PRIMARY KEY (extraction_id),
            CONSTRAINT fk_ai_extraction_file FOREIGN KEY (file_id) REFERENCES app.file_index (file_id),
            CONSTRAINT ck_ai_extraction_status CHECK (status IN (N'SUCCEEDED', N'FAILED', N'TIMEOUT')),
            CONSTRAINT ck_ai_extraction_json CHECK (candidates_json IS NULL OR ISJSON(candidates_json) = 1)
        );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_ai_extraction_file' AND object_id = OBJECT_ID(N'app.ai_extraction'))
        CREATE INDEX ix_ai_extraction_file ON app.ai_extraction (file_id);
    PRINT 'OK  0005 app.ai_extraction ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0005 app.ai_extraction, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

IF @failed = 0 PRINT '0005_evidence RESULT: ALL 3 TABLES READY';
ELSE PRINT '0005_evidence RESULT: ' + CAST(@failed AS varchar(12)) + ' TABLE(S) FAILED';
