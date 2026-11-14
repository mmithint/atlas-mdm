/* =====================================================================
   0006_rules.sql            APP-1, migration 6 of 7
   Tables: app.business_rules, app.business_rule_allowed_target,
           app.business_rule_applicability, app.business_rule_run,
           app.business_rule_result, app.business_rule_publication_log
   Also: sequence app.seq_business_rule_run_id (one number per rule run) and
         the foreign key app.change_request -> app.business_rules.
   Columns and meanings: FINAL PLAN/09_Data_Dictionary.md section 6.
   Re-runnable: yes (IF OBJECT_ID ... IS NULL). Never edit after it has run.

   Key facts
   - AUTO_APPROVE does not exist: routing_mode is CHECKed to MANUAL / AUTO_ROUTE.
   - At most one DRAFT row per rule_id (filtered unique index).
   - A published row must carry its hash and publisher (CHECK).
   - Result grain: one row per run x rule x entity x field (unique index; a NULL
     field_code counts as one value, so a MANUAL result is unique per entity).
   - No-overlap of published periods is enforced by app.usp_rule_publish (APP-5).
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL 0006 wrong editor: connected to "' + DB_NAME() + '". Open the item named ATLAS_SQL_DB whose type is SQL database. Nothing was changed.';
    RETURN;
END
IF OBJECT_ID(N'app.change_request', N'U') IS NULL OR OBJECT_ID(N'app.field_catalog', N'U') IS NULL
BEGIN
    PRINT 'FAIL 0006 app.change_request or app.field_catalog is missing: run 0002 and 0004 first. Nothing was changed.';
    RETURN;
END

DECLARE @failed int = 0;

/* ---- 6.1 app.business_rules -------------------------------------------------- */
BEGIN TRY
    IF OBJECT_ID(N'app.business_rules', N'U') IS NULL
        CREATE TABLE app.business_rules
        (
            rule_id                nvarchar(64)   NOT NULL,
            rule_version           int            NOT NULL,
            rule_name              nvarchar(200)  NOT NULL,
            rule_description       nvarchar(4000) NOT NULL,
            publication_status     nvarchar(10)   NOT NULL CONSTRAINT df_business_rules_status DEFAULT (N'DRAFT'),
            query_language         nvarchar(10)   NOT NULL CONSTRAINT df_business_rules_language DEFAULT (N'TSQL'),
            execution_target       nvarchar(200)  NOT NULL,
            query_text             nvarchar(max)  NOT NULL,
            query_hash             char(64)       NULL,
            routing_mode           nvarchar(12)   NOT NULL CONSTRAINT df_business_rules_routing DEFAULT (N'MANUAL'),
            severity_tier          nvarchar(6)    NOT NULL CONSTRAINT df_business_rules_severity DEFAULT (N'MEDIUM'),
            resolution_group       nvarchar(64)   NOT NULL,
            rule_editor_group      nvarchar(64)   NOT NULL,
            responsible_group      nvarchar(64)   NULL,
            accountable_group      nvarchar(64)   NULL,
            effective_from_utc     datetime2(3)   NULL,
            effective_to_utc       datetime2(3)   NULL,
            created_by             nvarchar(256)  NOT NULL,
            created_at_utc         datetime2(3)   NOT NULL CONSTRAINT df_business_rules_created_at DEFAULT (SYSUTCDATETIME()),
            published_by           nvarchar(256)  NULL,
            published_at_utc       datetime2(3)   NULL,
            version_change_reason  nvarchar(400)  NOT NULL,
            test_status            nvarchar(12)   NOT NULL CONSTRAINT df_business_rules_test_status DEFAULT (N'NOT_TESTED'),
            tested_definition_hash char(64)       NULL,
            tested_at_utc          datetime2(3)   NULL,
            tested_by              nvarchar(256)  NULL,
            test_details_json      nvarchar(max)  NULL,
            row_version            rowversion     NOT NULL,
            CONSTRAINT pk_business_rules PRIMARY KEY (rule_id, rule_version),
            CONSTRAINT ck_business_rules_version CHECK (rule_version >= 1),
            CONSTRAINT ck_business_rules_status CHECK (publication_status IN (N'DRAFT', N'PUBLISHED')),
            CONSTRAINT ck_business_rules_language CHECK (query_language = N'TSQL'),
            CONSTRAINT ck_business_rules_routing CHECK (routing_mode IN (N'MANUAL', N'AUTO_ROUTE')),
            CONSTRAINT ck_business_rules_severity CHECK (severity_tier IN (N'HIGH', N'MEDIUM', N'LOW')),
            CONSTRAINT ck_business_rules_test_status CHECK (test_status IN (N'NOT_TESTED', N'RUNNING', N'PASSED', N'FAILED', N'STALE')),
            CONSTRAINT ck_business_rules_published CHECK (publication_status = N'DRAFT' OR (query_hash IS NOT NULL AND published_by IS NOT NULL AND published_at_utc IS NOT NULL)),
            CONSTRAINT ck_business_rules_period CHECK (effective_from_utc IS NULL OR effective_to_utc IS NULL OR effective_to_utc > effective_from_utc),
            CONSTRAINT ck_business_rules_json CHECK (test_details_json IS NULL OR ISJSON(test_details_json) = 1)
        );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ux_business_rules_one_draft' AND object_id = OBJECT_ID(N'app.business_rules'))
        CREATE UNIQUE INDEX ux_business_rules_one_draft ON app.business_rules (rule_id) WHERE publication_status = N'DRAFT';
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_business_rules_status' AND object_id = OBJECT_ID(N'app.business_rules'))
        CREATE INDEX ix_business_rules_status ON app.business_rules (publication_status, effective_from_utc);
    PRINT 'OK  0006 app.business_rules ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0006 app.business_rules, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- 6.2 app.business_rule_allowed_target --------------------------------------- */
BEGIN TRY
    IF OBJECT_ID(N'app.business_rule_allowed_target', N'U') IS NULL
        CREATE TABLE app.business_rule_allowed_target
        (
            rule_id      nvarchar(64) NOT NULL,
            rule_version int          NOT NULL,
            field_code   nvarchar(64) NOT NULL,
            CONSTRAINT pk_business_rule_allowed_target PRIMARY KEY (rule_id, rule_version, field_code),
            CONSTRAINT fk_brat_rule FOREIGN KEY (rule_id, rule_version) REFERENCES app.business_rules (rule_id, rule_version),
            CONSTRAINT fk_brat_field FOREIGN KEY (field_code) REFERENCES app.field_catalog (field_code)
        );
    PRINT 'OK  0006 app.business_rule_allowed_target ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0006 app.business_rule_allowed_target, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- 6.3 app.business_rule_applicability ----------------------------------------- */
BEGIN TRY
    IF OBJECT_ID(N'app.business_rule_applicability', N'U') IS NULL
        CREATE TABLE app.business_rule_applicability
        (
            rule_id      nvarchar(64) NOT NULL,
            rule_version int          NOT NULL,
            entity_type  nvarchar(10) NOT NULL,
            class_code   nvarchar(30) NOT NULL,
            CONSTRAINT pk_business_rule_applicability PRIMARY KEY (rule_id, rule_version, entity_type, class_code),
            CONSTRAINT fk_bra_rule FOREIGN KEY (rule_id, rule_version) REFERENCES app.business_rules (rule_id, rule_version),
            CONSTRAINT ck_bra_entity CHECK (entity_type IN (N'EQUIPMENT', N'FLOC'))
        );
    PRINT 'OK  0006 app.business_rule_applicability ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0006 app.business_rule_applicability, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- 6.4a sequence for run ids ---------------------------------------------------- */
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = N'seq_business_rule_run_id' AND schema_id = SCHEMA_ID(N'app'))
        CREATE SEQUENCE app.seq_business_rule_run_id AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;
    PRINT 'OK  0006 sequence app.seq_business_rule_run_id ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0006 sequence app.seq_business_rule_run_id, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    PRINT 'HINT if SEQUENCE is not supported on this platform, tell Claude: run ids then come from a one-column identity table instead (09 section 6.4 changes first).';
END CATCH;

/* ---- 6.4 app.business_rule_run ----------------------------------------------------- */
BEGIN TRY
    IF OBJECT_ID(N'app.business_rule_run', N'U') IS NULL
        CREATE TABLE app.business_rule_run
        (
            run_id              bigint        NOT NULL,
            rule_id             nvarchar(64)  NOT NULL,
            rule_version        int           NOT NULL,
            run_trigger         nvarchar(12)  NOT NULL,
            started_by          nvarchar(256) NOT NULL,
            started_at_utc      datetime2(3)  NOT NULL CONSTRAINT df_business_rule_run_started DEFAULT (SYSUTCDATETIME()),
            completed_at_utc    datetime2(3)  NULL,
            source_as_of_utc    datetime2(3)  NULL,
            run_status          nvarchar(12)  NOT NULL CONSTRAINT df_business_rule_run_status DEFAULT (N'RUNNING'),
            violation_count     int           NULL,
            requests_created    int           NULL,
            requests_suppressed int           NULL,
            error_message       nvarchar(2000) NULL,
            CONSTRAINT pk_business_rule_run PRIMARY KEY (run_id, rule_id, rule_version),
            CONSTRAINT fk_brr_rule FOREIGN KEY (rule_id, rule_version) REFERENCES app.business_rules (rule_id, rule_version),
            CONSTRAINT ck_brr_trigger CHECK (run_trigger IN (N'NIGHTLY', N'ON_DEMAND')),
            CONSTRAINT ck_brr_status CHECK (run_status IN (N'RUNNING', N'SUCCEEDED', N'FAILED'))
        );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_business_rule_run_rule' AND object_id = OBJECT_ID(N'app.business_rule_run'))
        CREATE INDEX ix_business_rule_run_rule ON app.business_rule_run (rule_id, run_status, started_at_utc);
    PRINT 'OK  0006 app.business_rule_run ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0006 app.business_rule_run, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- 6.5 app.business_rule_result ---------------------------------------------------- */
BEGIN TRY
    IF OBJECT_ID(N'app.business_rule_result', N'U') IS NULL
        CREATE TABLE app.business_rule_result
        (
            result_id             bigint IDENTITY(1,1) NOT NULL,
            run_id                bigint        NOT NULL,
            rule_id               nvarchar(64)  NOT NULL,
            rule_version          int           NOT NULL,
            entity_type           nvarchar(10)  NOT NULL,
            entity_key            nvarchar(40)  NOT NULL,
            equipment_id          int           NULL,
            profit_center_name    nvarchar(40)  NOT NULL,
            asset_class           nvarchar(30)  NULL,
            detected_at_utc       datetime2(3)  NOT NULL CONSTRAINT df_business_rule_result_detected DEFAULT (SYSUTCDATETIME()),
            violation_description nvarchar(400) NOT NULL,
            evidence_json         nvarchar(4000) NOT NULL,
            resolution_group      nvarchar(64)  NOT NULL,
            field_code            nvarchar(64)  NULL,
            old_value             nvarchar(400) NULL,
            proposed_value        nvarchar(400) NULL,
            note                  nvarchar(200) NULL,
            request_outcome       nvarchar(24)  NULL,
            request_id            bigint        NULL,
            CONSTRAINT pk_business_rule_result PRIMARY KEY (result_id),
            CONSTRAINT fk_brres_run FOREIGN KEY (run_id, rule_id, rule_version) REFERENCES app.business_rule_run (run_id, rule_id, rule_version),
            CONSTRAINT fk_brres_request FOREIGN KEY (request_id) REFERENCES app.change_request (request_id),
            CONSTRAINT ck_brres_entity CHECK (entity_type IN (N'EQUIPMENT', N'FLOC')),
            CONSTRAINT ck_brres_outcome CHECK (request_outcome IS NULL OR request_outcome IN (N'CREATED', N'DUPLICATE_SUPPRESSED', N'BLOCKED_INCOMPATIBLE', N'NONE')),
            CONSTRAINT ck_brres_evidence_json CHECK (ISJSON(evidence_json) = 1)
        );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ux_business_rule_result_grain' AND object_id = OBJECT_ID(N'app.business_rule_result'))
        CREATE UNIQUE INDEX ux_business_rule_result_grain ON app.business_rule_result (run_id, rule_id, rule_version, entity_type, entity_key, field_code);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_business_rule_result_equipment' AND object_id = OBJECT_ID(N'app.business_rule_result'))
        CREATE INDEX ix_business_rule_result_equipment ON app.business_rule_result (equipment_id, rule_id, run_id) WHERE equipment_id IS NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_business_rule_result_request' AND object_id = OBJECT_ID(N'app.business_rule_result'))
        CREATE INDEX ix_business_rule_result_request ON app.business_rule_result (request_id) WHERE request_id IS NOT NULL;
    PRINT 'OK  0006 app.business_rule_result ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0006 app.business_rule_result, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- 6.6 app.business_rule_publication_log ------------------------------------------- */
BEGIN TRY
    IF OBJECT_ID(N'app.business_rule_publication_log', N'U') IS NULL
        CREATE TABLE app.business_rule_publication_log
        (
            log_id                int IDENTITY(1,1) NOT NULL,
            rule_id               nvarchar(64)  NOT NULL,
            rule_version          int           NOT NULL,
            published_by          nvarchar(256) NOT NULL,
            published_at_utc      datetime2(3)  NOT NULL CONSTRAINT df_brpl_published_at DEFAULT (SYSUTCDATETIME()),
            query_hash            char(64)      NOT NULL,
            definition_json       nvarchar(max) NOT NULL,
            version_change_reason nvarchar(400) NOT NULL,
            CONSTRAINT pk_business_rule_publication_log PRIMARY KEY (log_id),
            CONSTRAINT ux_brpl_version UNIQUE (rule_id, rule_version),
            CONSTRAINT ck_brpl_json CHECK (ISJSON(definition_json) = 1)
        );
    PRINT 'OK  0006 app.business_rule_publication_log ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0006 app.business_rule_publication_log, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- foreign key from the requests (0004) to the rule version that created them ---- */
BEGIN TRY
    IF OBJECT_ID(N'app.business_rules', N'U') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'fk_change_request_rule' AND parent_object_id = OBJECT_ID(N'app.change_request'))
        ALTER TABLE app.change_request ADD CONSTRAINT fk_change_request_rule
            FOREIGN KEY (source_rule_id, source_rule_version) REFERENCES app.business_rules (rule_id, rule_version);
    PRINT 'OK  0006 foreign key app.change_request -> app.business_rules ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0006 foreign key fk_change_request_rule, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

IF @failed = 0 PRINT '0006_rules RESULT: ALL 6 TABLES, THE SEQUENCE AND THE FOREIGN KEY READY';
ELSE PRINT '0006_rules RESULT: ' + CAST(@failed AS varchar(12)) + ' ITEM(S) FAILED';
