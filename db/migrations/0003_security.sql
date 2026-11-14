/* =====================================================================
   0003_security.sql         APP-1, migration 3 of 7
   Tables: app.role, app.role_alias, app.security_group,
           app.principal_role_assignment, app.principal_role_assignment_scope,
           app.group_membership, app.approval_route, app.approval_route_class,
           app.principal_identity
   Columns and meanings: FINAL PLAN/09_Data_Dictionary.md section 3.
   Re-runnable: yes (IF OBJECT_ID ... IS NULL). Never edit after it has run.

   Routes name roles, not groups; `responsible_role` may be an alias
   (app.role_alias), so the route columns carry no foreign key to app.role.
   E-mail columns are checked to be lower case with a binary comparison,
   because the database's default comparison ignores case.
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL 0003 wrong editor: connected to "' + DB_NAME() + '". Open the item named ATLAS_SQL_DB whose type is SQL database. Nothing was changed.';
    RETURN;
END
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'app')
BEGIN
    PRINT 'FAIL 0003 schema app does not exist: run 0001_schemas.sql first. Nothing was changed.';
    RETURN;
END

DECLARE @failed int = 0;

/* ---- 3.1 app.role -------------------------------------------------------- */
BEGIN TRY
    IF OBJECT_ID(N'app.role', N'U') IS NULL
        CREATE TABLE app.role
        (
            role_name                          nvarchar(64)  NOT NULL,
            description                        nvarchar(400) NULL,
            can_view                           bit           NOT NULL,
            can_submit_requests                bit           NOT NULL,
            can_request_edit_business_rules    bit           NOT NULL,
            can_publish_business_rules         bit           NOT NULL,
            can_request_edit_evidence_guidance bit           NOT NULL,
            can_publish_evidence_guidance      bit           NOT NULL,
            can_responsible_approve            bit           NOT NULL,
            can_accountable_approve            bit           NOT NULL,
            can_manage_admin                   bit           NOT NULL,
            is_active                          bit           NOT NULL CONSTRAINT df_role_is_active DEFAULT (1),
            CONSTRAINT pk_role PRIMARY KEY (role_name)
        );
    PRINT 'OK  0003 app.role ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0003 app.role, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- 3.2 app.role_alias -------------------------------------------------- */
BEGIN TRY
    IF OBJECT_ID(N'app.role_alias', N'U') IS NULL
        CREATE TABLE app.role_alias
        (
            alias_name       nvarchar(64)  NOT NULL,
            role_name        nvarchar(64)  NOT NULL,
            is_assumption    bit           NOT NULL CONSTRAINT df_role_alias_is_assumption DEFAULT (1),
            related_question nvarchar(40)  NULL,
            note             nvarchar(400) NULL,
            CONSTRAINT pk_role_alias PRIMARY KEY (alias_name),
            CONSTRAINT fk_role_alias_role FOREIGN KEY (role_name) REFERENCES app.role (role_name)
        );
    PRINT 'OK  0003 app.role_alias ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0003 app.role_alias, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- 3.3 app.security_group ---------------------------------------------- */
BEGIN TRY
    IF OBJECT_ID(N'app.security_group', N'U') IS NULL
        CREATE TABLE app.security_group
        (
            group_key       nvarchar(64)  NOT NULL,
            display_name    nvarchar(100) NOT NULL,
            group_source    nvarchar(30)  NULL,
            entra_object_id nvarchar(64)  NULL,
            is_active       bit           NOT NULL CONSTRAINT df_security_group_is_active DEFAULT (1),
            CONSTRAINT pk_security_group PRIMARY KEY (group_key)
        );
    PRINT 'OK  0003 app.security_group ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0003 app.security_group, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- 3.4 app.principal_role_assignment ------------------------------------ */
BEGIN TRY
    IF OBJECT_ID(N'app.principal_role_assignment', N'U') IS NULL
        CREATE TABLE app.principal_role_assignment
        (
            assignment_id             int IDENTITY(1,1) NOT NULL,
            principal_type            nvarchar(10)  NOT NULL,
            principal_key             nvarchar(256) NOT NULL,
            principal_display_name    nvarchar(100) NULL,
            role_name                 nvarchar(64)  NOT NULL,
            scope_type                nvarchar(20)  NOT NULL,
            scope_value               nvarchar(400) NULL,
            planner_group_description nvarchar(100) NULL,
            is_active                 bit           NOT NULL CONSTRAINT df_pra_is_active DEFAULT (1),
            CONSTRAINT pk_principal_role_assignment PRIMARY KEY (assignment_id),
            CONSTRAINT fk_pra_role FOREIGN KEY (role_name) REFERENCES app.role (role_name),
            CONSTRAINT ck_pra_principal_type CHECK (principal_type IN (N'GROUP', N'USER')),
            CONSTRAINT ck_pra_scope_type CHECK (scope_type IN (N'ALL_ORCM', N'PROFIT_CENTER_LIST')),
            CONSTRAINT ck_pra_user_key_lower CHECK (principal_type <> N'USER' OR principal_key COLLATE Latin1_General_BIN2 = LOWER(principal_key) COLLATE Latin1_General_BIN2)
        );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_pra_principal' AND object_id = OBJECT_ID(N'app.principal_role_assignment'))
        CREATE INDEX ix_pra_principal ON app.principal_role_assignment (principal_type, principal_key);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_pra_role' AND object_id = OBJECT_ID(N'app.principal_role_assignment'))
        CREATE INDEX ix_pra_role ON app.principal_role_assignment (role_name);
    PRINT 'OK  0003 app.principal_role_assignment ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0003 app.principal_role_assignment, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- 3.5 app.principal_role_assignment_scope ------------------------------ */
BEGIN TRY
    IF OBJECT_ID(N'app.principal_role_assignment_scope', N'U') IS NULL
        CREATE TABLE app.principal_role_assignment_scope
        (
            assignment_id      int          NOT NULL,
            profit_center_name nvarchar(40) NOT NULL,
            CONSTRAINT pk_pra_scope PRIMARY KEY (assignment_id, profit_center_name),
            CONSTRAINT fk_pra_scope_assignment FOREIGN KEY (assignment_id) REFERENCES app.principal_role_assignment (assignment_id)
        );
    PRINT 'OK  0003 app.principal_role_assignment_scope ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0003 app.principal_role_assignment_scope, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- 3.6 app.group_membership --------------------------------------------- */
BEGIN TRY
    IF OBJECT_ID(N'app.group_membership', N'U') IS NULL
        CREATE TABLE app.group_membership
        (
            group_key      nvarchar(64)  NOT NULL,
            user_email     nvarchar(256) NOT NULL,
            is_active      bit           NOT NULL CONSTRAINT df_group_membership_is_active DEFAULT (1),
            added_by       nvarchar(256) NOT NULL CONSTRAINT df_group_membership_added_by DEFAULT (N'system:seed'),
            added_at_utc   datetime2(3)  NOT NULL CONSTRAINT df_group_membership_added_at DEFAULT (SYSUTCDATETIME()),
            CONSTRAINT pk_group_membership PRIMARY KEY (group_key, user_email),
            CONSTRAINT fk_group_membership_group FOREIGN KEY (group_key) REFERENCES app.security_group (group_key),
            CONSTRAINT ck_group_membership_email_lower CHECK (user_email COLLATE Latin1_General_BIN2 = LOWER(user_email) COLLATE Latin1_General_BIN2)
        );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_group_membership_user' AND object_id = OBJECT_ID(N'app.group_membership'))
        CREATE INDEX ix_group_membership_user ON app.group_membership (user_email);
    PRINT 'OK  0003 app.group_membership ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0003 app.group_membership, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- 3.7 app.approval_route ------------------------------------------------ */
BEGIN TRY
    IF OBJECT_ID(N'app.approval_route', N'U') IS NULL
        CREATE TABLE app.approval_route
        (
            route_id                int IDENTITY(1,1) NOT NULL,
            route_key               nvarchar(64) NULL,
            entity_type             nvarchar(10) NOT NULL,
            request_action          nvarchar(10) NOT NULL,
            field_or_characteristic nvarchar(64) NOT NULL CONSTRAINT df_approval_route_field DEFAULT (N'*'),
            class_scope             nvarchar(10) NOT NULL CONSTRAINT df_approval_route_class_scope DEFAULT (N'ANY'),
            scope_type              nvarchar(20) NOT NULL CONSTRAINT df_approval_route_scope_type DEFAULT (N'ALL_ORCM'),
            responsible_role        nvarchar(64) NOT NULL,
            accountable_role        nvarchar(64) NOT NULL,
            is_active               bit          NOT NULL CONSTRAINT df_approval_route_is_active DEFAULT (1),
            CONSTRAINT pk_approval_route PRIMARY KEY (route_id),
            CONSTRAINT ck_approval_route_entity CHECK (entity_type IN (N'EQUIPMENT', N'FLOC')),
            CONSTRAINT ck_approval_route_action CHECK (request_action IN (N'UPDATE', N'CREATE')),
            CONSTRAINT ck_approval_route_class_scope CHECK (class_scope IN (N'ANY', N'LIST')),
            CONSTRAINT ck_approval_route_scope_type CHECK (scope_type IN (N'ALL_ORCM', N'PROFIT_CENTER_LIST'))
        );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ux_approval_route_key' AND object_id = OBJECT_ID(N'app.approval_route'))
        CREATE UNIQUE INDEX ux_approval_route_key ON app.approval_route (route_key) WHERE route_key IS NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_approval_route_match' AND object_id = OBJECT_ID(N'app.approval_route'))
        CREATE INDEX ix_approval_route_match ON app.approval_route (entity_type, request_action, field_or_characteristic);
    PRINT 'OK  0003 app.approval_route ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0003 app.approval_route, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- 3.8 app.approval_route_class ------------------------------------------ */
BEGIN TRY
    IF OBJECT_ID(N'app.approval_route_class', N'U') IS NULL
        CREATE TABLE app.approval_route_class
        (
            route_id   int          NOT NULL,
            class_code nvarchar(30) NOT NULL,
            CONSTRAINT pk_approval_route_class PRIMARY KEY (route_id, class_code),
            CONSTRAINT fk_approval_route_class_route FOREIGN KEY (route_id) REFERENCES app.approval_route (route_id)
        );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_approval_route_class_code' AND object_id = OBJECT_ID(N'app.approval_route_class'))
        CREATE INDEX ix_approval_route_class_code ON app.approval_route_class (class_code);
    PRINT 'OK  0003 app.approval_route_class ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0003 app.approval_route_class, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- 3.9 app.principal_identity (added 14 Nov, spike S1; 01 section 6.8) ---- */
BEGIN TRY
    IF OBJECT_ID(N'app.principal_identity', N'U') IS NULL
        CREATE TABLE app.principal_identity
        (
            identity_id  int IDENTITY(1,1) NOT NULL,
            external_id  nvarchar(64)  NOT NULL,
            user_email   nvarchar(256) NOT NULL,
            display_name nvarchar(100) NULL,
            is_active    bit           NOT NULL CONSTRAINT df_principal_identity_is_active DEFAULT (1),
            bound_by     nvarchar(256) NOT NULL,
            bound_at_utc datetime2(3)  NOT NULL CONSTRAINT df_principal_identity_bound_at DEFAULT (SYSUTCDATETIME()),
            note         nvarchar(400) NULL,
            CONSTRAINT pk_principal_identity PRIMARY KEY (identity_id),
            CONSTRAINT ux_principal_identity_external UNIQUE (external_id),
            CONSTRAINT ck_principal_identity_id_lower CHECK (external_id COLLATE Latin1_General_BIN2 = LOWER(external_id) COLLATE Latin1_General_BIN2),
            CONSTRAINT ck_principal_identity_email_lower CHECK (user_email COLLATE Latin1_General_BIN2 = LOWER(user_email) COLLATE Latin1_General_BIN2)
        );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_principal_identity_email' AND object_id = OBJECT_ID(N'app.principal_identity'))
        CREATE INDEX ix_principal_identity_email ON app.principal_identity (user_email);
    PRINT 'OK  0003 app.principal_identity ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0003 app.principal_identity, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

IF @failed = 0 PRINT '0003_security RESULT: ALL 9 TABLES READY';
ELSE PRINT '0003_security RESULT: ' + CAST(@failed AS varchar(12)) + ' TABLE(S) FAILED';
