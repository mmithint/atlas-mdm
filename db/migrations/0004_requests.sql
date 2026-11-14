/* =====================================================================
   0004_requests.sql         APP-1, migration 4 of 7
   Tables: app.change_request, app.change_request_event,
           app.characteristic_request
   Columns and meanings: FINAL PLAN/09_Data_Dictionary.md section 4.
   Re-runnable: yes (IF OBJECT_ID ... IS NULL). Never edit after it has run.

   Key facts
   - request_ref is computed from request_id ('CR-000123'); typed nvarchar(12).
   - Only one OPEN request per deduplication_key: a filtered unique index over
     the open statuses (DRAFT, PENDING_RESPONSIBLE, PENDING_ACCOUNTABLE, RETURNED).
     A filtered index predicate may not use OR or IN (Msg 156), so "open" is
     written as "not one of the three closed statuses" (APPROVED, REJECTED,
     CANCELLED). ck_change_request_status allows exactly seven values, so this
     is the same set. A new status added later would count as open.
   - app.change_request_event is append-only by convention: only procedures
     write it, and none updates or deletes a row (see 09 section 4.2).
   - source_rule_id / source_rule_version get their foreign key to
     app.business_rules in 0006 (the rules tables do not exist yet here).
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL 0004 wrong editor: connected to "' + DB_NAME() + '". Open the item named ATLAS_SQL_DB whose type is SQL database. Nothing was changed.';
    RETURN;
END
IF OBJECT_ID(N'app.field_catalog', N'U') IS NULL OR OBJECT_ID(N'app.approval_route', N'U') IS NULL
BEGIN
    PRINT 'FAIL 0004 app.field_catalog or app.approval_route is missing: run 0002 and 0003 first. Nothing was changed.';
    RETURN;
END

DECLARE @failed int = 0;

/* ---- 4.1 app.change_request ---------------------------------------------- */
BEGIN TRY
    IF OBJECT_ID(N'app.change_request', N'U') IS NULL
        CREATE TABLE app.change_request
        (
            request_id            bigint IDENTITY(1,1) NOT NULL,
            request_ref           AS ISNULL(CONVERT(nvarchar(12), N'CR-' + CASE WHEN request_id < 1000000 THEN RIGHT(N'000000' + CONVERT(nvarchar(20), request_id), 6) ELSE CONVERT(nvarchar(20), request_id) END), N''),
            entity_type           nvarchar(10)  NOT NULL,
            equipment_id          int           NULL,
            equipment_number      nvarchar(18)  NULL,
            functional_location   nvarchar(40)  NULL,
            profit_center_name    nvarchar(40)  NOT NULL,
            class_code            nvarchar(30)  NULL,
            request_action        nvarchar(10)  NOT NULL CONSTRAINT df_change_request_action DEFAULT (N'UPDATE'),
            source_type           nvarchar(20)  NOT NULL,
            source_result_id      bigint        NULL,
            source_rule_id        nvarchar(64)  NULL,
            source_rule_version   int           NULL,
            field_code            nvarchar(64)  NULL,
            old_value             nvarchar(400) NULL,
            new_value             nvarchar(400) NULL,
            reason                nvarchar(400) NOT NULL,
            note                  nvarchar(200) NULL,
            requested_by          nvarchar(256) NOT NULL,
            requested_at_utc      datetime2(3)  NOT NULL CONSTRAINT df_change_request_requested_at DEFAULT (SYSUTCDATETIME()),
            request_status        nvarchar(24)  NOT NULL CONSTRAINT df_change_request_status DEFAULT (N'PENDING_RESPONSIBLE'),
            responsible_group     nvarchar(64)  NOT NULL,
            accountable_group     nvarchar(64)  NOT NULL,
            route_id              int           NULL,
            return_recipient_type nvarchar(10)  NULL,
            return_recipient      nvarchar(256) NULL,
            deduplication_key     char(64)      NOT NULL,
            updated_at_utc        datetime2(3)  NOT NULL CONSTRAINT df_change_request_updated_at DEFAULT (SYSUTCDATETIME()),
            row_version           rowversion    NOT NULL,
            CONSTRAINT pk_change_request PRIMARY KEY (request_id),
            CONSTRAINT fk_change_request_field FOREIGN KEY (field_code) REFERENCES app.field_catalog (field_code),
            CONSTRAINT fk_change_request_route FOREIGN KEY (route_id) REFERENCES app.approval_route (route_id),
            CONSTRAINT ck_change_request_entity CHECK (entity_type IN (N'EQUIPMENT', N'FLOC')),
            CONSTRAINT ck_change_request_action CHECK (request_action IN (N'UPDATE', N'CREATE')),
            CONSTRAINT ck_change_request_source CHECK (source_type IN (N'BUSINESS_RULE', N'FIELD', N'MANUAL', N'CORRECTION_IMPORT', N'NEW_CHARACTERISTIC', N'NEW_RECORD')),
            CONSTRAINT ck_change_request_status CHECK (request_status IN (N'DRAFT', N'PENDING_RESPONSIBLE', N'PENDING_ACCOUNTABLE', N'RETURNED', N'APPROVED', N'REJECTED', N'CANCELLED')),
            CONSTRAINT ck_change_request_field_code CHECK (field_code IS NOT NULL OR source_type = N'NEW_CHARACTERISTIC'),
            CONSTRAINT ck_change_request_rule_pair CHECK ((source_rule_id IS NULL AND source_rule_version IS NULL) OR (source_rule_id IS NOT NULL AND source_rule_version IS NOT NULL)),
            CONSTRAINT ck_change_request_return_pair CHECK ((return_recipient_type IS NULL AND return_recipient IS NULL) OR (return_recipient_type IN (N'USER', N'GROUP') AND return_recipient IS NOT NULL))
        );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ux_change_request_open_dedup' AND object_id = OBJECT_ID(N'app.change_request'))
        CREATE UNIQUE INDEX ux_change_request_open_dedup ON app.change_request (deduplication_key)
            WHERE request_status <> N'APPROVED' AND request_status <> N'REJECTED' AND request_status <> N'CANCELLED';
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_change_request_queue' AND object_id = OBJECT_ID(N'app.change_request'))
        CREATE INDEX ix_change_request_queue ON app.change_request (request_status, responsible_group, requested_at_utc);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_change_request_accountable' AND object_id = OBJECT_ID(N'app.change_request'))
        CREATE INDEX ix_change_request_accountable ON app.change_request (request_status, accountable_group, requested_at_utc);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_change_request_equipment' AND object_id = OBJECT_ID(N'app.change_request'))
        CREATE INDEX ix_change_request_equipment ON app.change_request (equipment_id, field_code) INCLUDE (request_status);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_change_request_requested_by' AND object_id = OBJECT_ID(N'app.change_request'))
        CREATE INDEX ix_change_request_requested_by ON app.change_request (requested_by, requested_at_utc);
    PRINT 'OK  0004 app.change_request ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0004 app.change_request, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- 4.2 app.change_request_event ------------------------------------------ */
BEGIN TRY
    IF OBJECT_ID(N'app.change_request_event', N'U') IS NULL
        CREATE TABLE app.change_request_event
        (
            event_id           bigint IDENTITY(1,1) NOT NULL,
            request_id         bigint        NOT NULL,
            event_type         nvarchar(24)  NOT NULL,
            approval_stage     nvarchar(12)  NULL,
            actor              nvarchar(256) NOT NULL,
            actor_group        nvarchar(64)  NULL,
            occurred_at_utc    datetime2(3)  NOT NULL CONSTRAINT df_change_request_event_at DEFAULT (SYSUTCDATETIME()),
            comments           nvarchar(1000) NULL,
            status_from        nvarchar(24)  NULL,
            status_to          nvarchar(24)  NULL,
            event_details_json nvarchar(max) NULL,
            CONSTRAINT pk_change_request_event PRIMARY KEY (event_id),
            CONSTRAINT fk_change_request_event_request FOREIGN KEY (request_id) REFERENCES app.change_request (request_id),
            CONSTRAINT ck_change_request_event_type CHECK (event_type IN (N'CREATED', N'RESPONSIBLE_APPROVED', N'ACCOUNTABLE_APPROVED', N'REJECTED', N'RETURNED', N'RESUBMITTED', N'CANCELLED', N'COMMENTED', N'MERGED', N'MERGE_STALE', N'EXPORTED')),
            CONSTRAINT ck_change_request_event_stage CHECK (approval_stage IS NULL OR approval_stage IN (N'RESPONSIBLE', N'ACCOUNTABLE')),
            CONSTRAINT ck_change_request_event_json CHECK (event_details_json IS NULL OR ISJSON(event_details_json) = 1)
        );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_change_request_event_request' AND object_id = OBJECT_ID(N'app.change_request_event'))
        CREATE INDEX ix_change_request_event_request ON app.change_request_event (request_id, occurred_at_utc);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_change_request_event_type' AND object_id = OBJECT_ID(N'app.change_request_event'))
        CREATE INDEX ix_change_request_event_type ON app.change_request_event (event_type, occurred_at_utc);
    PRINT 'OK  0004 app.change_request_event ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0004 app.change_request_event, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- 4.3 app.characteristic_request ----------------------------------------- */
BEGIN TRY
    IF OBJECT_ID(N'app.characteristic_request', N'U') IS NULL
        CREATE TABLE app.characteristic_request
        (
            characteristic_request_id int IDENTITY(1,1) NOT NULL,
            request_id                bigint         NOT NULL,
            object_type               nvarchar(10)   NOT NULL,
            applicable_classes        nvarchar(400)  NOT NULL,
            proposed_name             nvarchar(30)   NOT NULL,
            description               nvarchar(400)  NOT NULL,
            data_type                 nvarchar(20)   NOT NULL,
            unit                      nvarchar(20)   NULL,
            allowed_values            nvarchar(2000) NULL,
            requirement               nvarchar(20)   NOT NULL,
            justification             nvarchar(1000) NOT NULL,
            sample_data               nvarchar(400)  NULL,
            CONSTRAINT pk_characteristic_request PRIMARY KEY (characteristic_request_id),
            CONSTRAINT ux_characteristic_request_request UNIQUE (request_id),
            CONSTRAINT fk_characteristic_request_request FOREIGN KEY (request_id) REFERENCES app.change_request (request_id),
            CONSTRAINT ck_characteristic_request_object CHECK (object_type IN (N'EQUIPMENT', N'FLOC')),
            CONSTRAINT ck_characteristic_request_type CHECK (data_type IN (N'FREE_TEXT', N'DROPDOWN', N'NUMBER')),
            CONSTRAINT ck_characteristic_request_requirement CHECK (requirement IN (N'REQUIRED', N'OPTIONAL')),
            CONSTRAINT ck_characteristic_request_name CHECK (proposed_name NOT LIKE N'%[^A-Za-z0-9_]%')
        );
    PRINT 'OK  0004 app.characteristic_request ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0004 app.characteristic_request, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

IF @failed = 0 PRINT '0004_requests RESULT: ALL 3 TABLES READY';
ELSE PRINT '0004_requests RESULT: ' + CAST(@failed AS varchar(12)) + ' TABLE(S) FAILED';
