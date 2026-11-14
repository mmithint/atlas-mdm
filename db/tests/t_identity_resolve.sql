/* =====================================================================
   t_identity_resolve.sql    APP-1 test: id in the token -> e-mail -> what the person may do
   Covers app.usp_identity_resolve (FINAL PLAN/01 section 6.8) and
   app.usp_principal_profile, plus the constraints of app.principal_identity.
   Needs : migrations 0001-0007, seeds 0101-0105, procs usp_identity_resolve and
           usp_principal_profile. Needs no local seed.
   Safe  : everything is inserted INSIDE a transaction that is ALWAYS rolled back;
           the test people are obviously fake (@example.test, id 0000...a1). The last
           check proves nothing was left behind.
   Final line: `t_identity_resolve RESULT: ...`
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL t_identity_resolve wrong editor: connected to "' + DB_NAME() + '". Open the item named ATLAS_SQL_DB whose type is SQL database. Nothing was run.';
    RETURN;
END
IF OBJECT_ID(N'app.usp_identity_resolve', N'P') IS NULL OR OBJECT_ID(N'app.usp_principal_profile', N'P') IS NULL
BEGIN
    PRINT 'FAIL t_identity_resolve a procedure is missing: run the procs and views stage first. Nothing was run.';
    RETURN;
END
IF (SELECT COUNT(*) FROM app.role) < 16 OR (SELECT COUNT(*) FROM app.principal_role_assignment WHERE principal_type = N'GROUP') = 0
BEGIN
    PRINT 'FAIL t_identity_resolve roles or assignments are not loaded: run seeds 0101-0105 first. Nothing was run.';
    RETURN;
END
IF EXISTS (SELECT 1 FROM app.principal_identity WHERE user_email LIKE N'%@example.test')
BEGIN
    PRINT 'FAIL t_identity_resolve a leftover @example.test row exists from an earlier run; delete it first. Nothing was run.';
    RETURN;
END

DECLARE @checks int = 0, @fails int = 0;

CREATE TABLE #who (user_email nvarchar(256) NOT NULL, display_name nvarchar(100) NULL);
CREATE TABLE #p
(
    user_email nvarchar(256) NOT NULL, display_name nvarchar(100) NULL, is_registered bit NOT NULL,
    role_name nvarchar(64) NOT NULL, granted_via nvarchar(10) NOT NULL, group_key nvarchar(64) NULL,
    scope_type nvarchar(20) NOT NULL, profit_center_name nvarchar(40) NULL,
    can_view bit NOT NULL, can_submit_requests bit NOT NULL, can_request_edit_business_rules bit NOT NULL,
    can_publish_business_rules bit NOT NULL, can_request_edit_evidence_guidance bit NOT NULL,
    can_publish_evidence_guidance bit NOT NULL, can_responsible_approve bit NOT NULL,
    can_accountable_approve bit NOT NULL, can_manage_admin bit NOT NULL
);

DECLARE @id_on  nvarchar(64) = N'00000000-0000-4000-8000-0000000000a1';
DECLARE @id_off nvarchar(64) = N'00000000-0000-4000-8000-0000000000a2';
DECLARE @mail   nvarchar(256) = N'test.person@example.test';
DECLARE @mail_off nvarchar(256) = N'test.off@example.test';
DECLARE @n int, @n2 int, @err int;

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO app.principal_identity (external_id, user_email, display_name, is_active, bound_by, note) VALUES
        (@id_on,  @mail,     N'Test Person (synthetic)', 1, N'test:t_identity_resolve', NULL),
        (@id_off, @mail_off, N'Test Off (synthetic)',    0, N'test:t_identity_resolve', N'inactive on purpose');

    INSERT INTO app.group_membership (group_key, user_email, is_active, added_by) VALUES
        (N'Operations-IOC-Carlsbad', @mail, 1, N'test:t_identity_resolve'),
        (N'SAPBusinessSupport',      @mail, 1, N'test:t_identity_resolve');

    INSERT INTO app.principal_role_assignment (principal_type, principal_key, principal_display_name, role_name, scope_type, scope_value, is_active) VALUES
        (N'USER', @mail, N'Test Person (synthetic)', N'DataQualityOwner', N'ALL_ORCM', NULL, 1);

    /* ---- usp_identity_resolve ------------------------------------------- */
    SET @checks += 1;
    DELETE FROM #who; INSERT INTO #who EXEC app.usp_identity_resolve @external_id = @id_on;
    IF (SELECT COUNT(*) FROM #who) = 1 AND (SELECT user_email FROM #who) = @mail AND (SELECT display_name FROM #who) = N'Test Person (synthetic)'
        PRINT 'OK  resolve: an active id returns its e-mail and display name';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL resolve: an active id did not return exactly its e-mail and display name'; END

    SET @checks += 1;
    DELETE FROM #who; INSERT INTO #who EXEC app.usp_identity_resolve @external_id = N'  00000000-0000-4000-8000-0000000000A1  ';
    IF (SELECT COUNT(*) FROM #who) = 1 PRINT 'OK  resolve: capital letters and outer spaces in the id are ignored';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL resolve: an id in capitals / with spaces was not found'; END

    SET @checks += 1;
    DELETE FROM #who; INSERT INTO #who EXEC app.usp_identity_resolve @external_id = @id_off;
    IF (SELECT COUNT(*) FROM #who) = 0 PRINT 'OK  resolve: an inactive id returns no row (the function answers NOT_REGISTERED)';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL resolve: an inactive id returned a row'; END

    SET @checks += 1;
    DELETE FROM #who; INSERT INTO #who EXEC app.usp_identity_resolve @external_id = N'00000000-0000-4000-8000-0000000000ff';
    SELECT @n = COUNT(*) FROM #who;
    DELETE FROM #who; INSERT INTO #who EXEC app.usp_identity_resolve @external_id = N'';
    SELECT @n2 = COUNT(*) FROM #who;
    DELETE FROM #who; INSERT INTO #who EXEC app.usp_identity_resolve @external_id = NULL;
    IF @n = 0 AND @n2 = 0 AND (SELECT COUNT(*) FROM #who) = 0 PRINT 'OK  resolve: an unknown, an empty and a NULL id return no row';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL resolve: an unknown, empty or NULL id returned a row'; END

    /* ---- constraints of app.principal_identity ---------------------------- */
    SET @checks += 1;
    SET @err = NULL;
    BEGIN TRY
        INSERT INTO app.principal_identity (external_id, user_email, display_name, is_active, bound_by)
        VALUES (N'00000000-0000-4000-8000-0000000000B1', N'upper.id@example.test', N'x', 1, N'test:t_identity_resolve');
    END TRY
    BEGIN CATCH
        SET @err = ERROR_NUMBER();
    END CATCH;
    IF @err = 547 PRINT 'OK  constraint: an upper-case id is refused (error 547)';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL constraint: an upper-case external_id was accepted or failed differently (error ' + ISNULL(CAST(@err AS varchar(12)), 'none') + ')'; END

    SET @checks += 1;
    SET @err = NULL;
    BEGIN TRY
        INSERT INTO app.principal_identity (external_id, user_email, display_name, is_active, bound_by)
        VALUES (N'00000000-0000-4000-8000-0000000000b2', N'Mixed.Case@example.test', N'x', 1, N'test:t_identity_resolve');
    END TRY
    BEGIN CATCH
        SET @err = ERROR_NUMBER();
    END CATCH;
    IF @err = 547 PRINT 'OK  constraint: an e-mail that is not lower case is refused (error 547)';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL constraint: a mixed-case e-mail was accepted or failed differently (error ' + ISNULL(CAST(@err AS varchar(12)), 'none') + ')'; END

    SET @checks += 1;
    SET @err = NULL;
    BEGIN TRY
        INSERT INTO app.principal_identity (external_id, user_email, display_name, is_active, bound_by)
        VALUES (@id_on, N'second.person@example.test', N'x', 1, N'test:t_identity_resolve');
    END TRY
    BEGIN CATCH
        SET @err = ERROR_NUMBER();
    END CATCH;
    IF @err IN (2627, 2601) PRINT 'OK  constraint: the same id cannot be bound twice (error ' + CAST(@err AS varchar(12)) + ')';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL constraint: a duplicate external_id was accepted or failed differently (error ' + ISNULL(CAST(@err AS varchar(12)), 'none') + ')'; END

    /* ---- usp_principal_profile ---------------------------------------------- */
    DELETE FROM #p; INSERT INTO #p EXEC app.usp_principal_profile @email = @mail;

    SET @checks += 1;
    SELECT @n = COUNT(*), @n2 = SUM(CAST(is_registered AS int)) FROM #p;
    IF @n > 0 AND @n2 = @n AND (SELECT COUNT(DISTINCT user_email) FROM #p) = 1 AND (SELECT MIN(user_email) FROM #p) = @mail
        PRINT 'OK  profile: the person is registered and every row carries the e-mail (' + CAST(@n AS varchar(10)) + ' rows)';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL profile: expected rows for a registered person, got ' + CAST(@n AS varchar(10)) + ' (registered on ' + ISNULL(CAST(@n2 AS varchar(10)), '0') + ')'; END

    SET @checks += 1;
    SELECT @n = COUNT(*), @n2 = COUNT(DISTINCT profit_center_name) FROM #p WHERE role_name = N'Operations-IOC' AND granted_via = N'GROUP' AND group_key = N'Operations-IOC-Carlsbad';
    IF @n = 1 AND @n2 = 1 AND EXISTS (SELECT 1 FROM #p WHERE role_name = N'Operations-IOC' AND profit_center_name = N'OP RES DB NM')
        PRINT 'OK  profile: Operations-IOC through the Carlsbad group is limited to OP RES DB NM';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL profile: Operations-IOC via Operations-IOC-Carlsbad should be exactly the profit centre OP RES DB NM (rows ' + CAST(@n AS varchar(10)) + ')'; END

    SET @checks += 1;
    SELECT @n = COUNT(DISTINCT profit_center_name) FROM #p WHERE role_name = N'SAPBusinessSupport' AND granted_via = N'GROUP' AND group_key = N'SAPBusinessSupport';
    IF @n = 10 PRINT 'OK  profile: SAPBusinessSupport covers all ten profit centres (the client''s two scope rows together)';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL profile: SAPBusinessSupport should cover 10 profit centres, found ' + CAST(@n AS varchar(10)); END

    SET @checks += 1;
    IF EXISTS (SELECT 1 FROM #p WHERE role_name = N'DataQualityOwner' AND granted_via = N'USER' AND scope_type = N'ALL_ORCM' AND profit_center_name IS NULL)
        PRINT 'OK  profile: a USER assignment (DataQualityOwner, ALL_ORCM) is returned with no profit-centre row';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL profile: the direct DataQualityOwner assignment is missing'; END

    SET @checks += 1;
    IF EXISTS (SELECT 1 FROM #p WHERE role_name = N'GeneralViewer' AND granted_via = N'IMPLICIT')
        PRINT 'OK  profile: a registered person is an implicit GeneralViewer';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL profile: no implicit GeneralViewer row for a registered person'; END

    SET @checks += 1;
    IF (SELECT MAX(CAST(can_view AS int)) FROM #p) = 1
       AND (SELECT MAX(CAST(can_submit_requests AS int)) FROM #p) = 1
       AND (SELECT MAX(CAST(can_request_edit_business_rules AS int)) FROM #p) = 1
       AND (SELECT MAX(CAST(can_publish_business_rules AS int)) FROM #p) = 1
       AND (SELECT MAX(CAST(can_responsible_approve AS int)) FROM #p) = 1
       AND (SELECT MAX(CAST(can_accountable_approve AS int)) FROM #p) = 1
       AND (SELECT MAX(CAST(can_manage_admin AS int)) FROM #p) = 0
        PRINT 'OK  profile: flags combine as expected (view, submit, edit and publish rules, both approvals on; admin off)';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL profile: the combined flags are not what DataQualityOwner + SAPBusinessSupport + Operations-IOC + GeneralViewer should give'; END

    SET @checks += 1;
    DELETE FROM #p; INSERT INTO #p EXEC app.usp_principal_profile @email = N'nobody.at.all@example.test';
    SELECT @n = COUNT(*) FROM #p;
    DELETE FROM #p; INSERT INTO #p EXEC app.usp_principal_profile @email = @mail_off;
    SELECT @n2 = COUNT(*) FROM #p;
    IF @n = 0 AND @n2 = 0 PRINT 'OK  profile: an unknown e-mail and an inactive identity get no rows';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL profile: unknown e-mail gave ' + CAST(@n AS varchar(10)) + ' row(s), inactive identity ' + CAST(@n2 AS varchar(10)); END

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    SET @fails += 1;
    PRINT 'FAIL t_identity_resolve stopped on error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' at line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE() + ' (the transaction was rolled back)';
END CATCH;

/* ---- nothing left behind ---------------------------------------------------- */
SET @checks += 1;
SELECT @n = (SELECT COUNT(*) FROM app.principal_identity WHERE user_email LIKE N'%@example.test')
          + (SELECT COUNT(*) FROM app.group_membership WHERE user_email LIKE N'%@example.test')
          + (SELECT COUNT(*) FROM app.principal_role_assignment WHERE principal_key LIKE N'%@example.test');
IF @n = 0 PRINT 'OK  cleanup: the test rows were rolled back, nothing is left';
ELSE BEGIN SET @fails += 1; PRINT 'FAIL cleanup: ' + CAST(@n AS varchar(10)) + ' @example.test row(s) were left behind; delete them by hand'; END

DROP TABLE #p;
DROP TABLE #who;

IF @fails = 0 PRINT 't_identity_resolve RESULT: ALL ' + CAST(@checks AS varchar(10)) + ' CHECKS PASS';
ELSE PRINT 't_identity_resolve RESULT: ' + CAST(@fails AS varchar(10)) + ' OF ' + CAST(@checks AS varchar(10)) + ' CHECK(S) FAILED';
