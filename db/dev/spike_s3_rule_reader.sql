/* =====================================================================
   spike_s3_rule_reader.sql        APP-0, spike S3
   Database : the ATLAS Fabric SQL database (ATLAS_SQL_DB)
   Run once : Fabric portal > SQL database > New query > paste > Run
   Then     : copy the whole Messages tab into the Claude chat.
   Re-runnable: yes. Leaves dev.spike_data and user atlas_rule_reader in
   place (APP-5 reuses the same user and grants it SELECT on schema gold).

   Question answered: can a stored procedure run a rule author's draft SQL as
   a database user that can only READ (SELECT), so that a bad or malicious
   draft cannot change data?

   How: a user with no login (atlas_rule_reader) is given SELECT on schema
   `dev` only. We switch into that user with EXECUTE AS USER, then check
   that reading works, writing is denied, reading outside `dev` is denied,
   and the engine can describe a query's output columns (the app uses that
   to check a rule returns the agreed columns without running it).

   Contains no client data. Every row is synthetic.
   Output lines start with PASS, FAIL, SKIP or OK.
   ===================================================================== */
SET NOCOUNT ON;

/* Guard: this must run in the SQL database item, not in a warehouse or in the
   lakehouse's SQL analytics endpoint (they reject PRIMARY KEY, Msg 24584, and
   do not support these user and permission statements). RETURN ends the batch
   before anything is changed. */
IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL S3.0 wrong editor: connected to "' + DB_NAME() + '" on engine ' + ISNULL(CAST(SERVERPROPERTY('EngineEdition') AS varchar(20)), '?') + ' (11 = the warehouse-style engine, which the SQL analytics endpoint uses). Open the item named ATLAS_SQL_DB whose type is SQL database and run this from New query there. Nothing was changed.';
    RETURN;
END
PRINT 'OK   connected to database "' + DB_NAME() + '"';

DECLARE @fail int = 0;
DECLARE @n    int;
DECLARE @err  int;

/* ---- S3.0a schema and synthetic data (idempotent) ----------------------- */
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'dev')
        EXEC (N'CREATE SCHEMA dev AUTHORIZATION dbo');   -- explicit owner: avoids an Entra lookup (Msg 37353)

    IF OBJECT_ID(N'dev.spike_data', N'U') IS NULL
        EXEC (N'CREATE TABLE dev.spike_data (id int IDENTITY(1,1) NOT NULL PRIMARY KEY, label nvarchar(40) NOT NULL)');

    IF NOT EXISTS (SELECT 1 FROM dev.spike_data)
        INSERT INTO dev.spike_data (label) VALUES (N'synthetic A'), (N'synthetic B'), (N'synthetic C');

    PRINT 'OK   S3.0a schema dev and table dev.spike_data ready';
END TRY
BEGIN CATCH
    PRINT 'FAIL S3.0a setup error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    IF ERROR_NUMBER() = 37353 OR ERROR_MESSAGE() LIKE N'%Directory Readers%'
        PRINT 'HINT Msg 37353: the database tried to look up a Microsoft Entra account and the server identity is not allowed to read the directory. Run db/dev/probe_engine.sql in this same editor and paste its Messages tab.';
    PRINT 'S3 RESULT: setup failed before the reader user was tried. Copy this whole Messages tab to Claude.';
    RETURN;
END CATCH;

/* ---- S3.0b the read-only user -------------------------------------------
   13 Nov, 1st run: CREATE USER ... WITHOUT LOGIN is "not supported on the
   'Microsoft Fabric' platform" (error 22607). This version tries it, then a
   contained user with a throw-away random password (EXECUTE AS USER never needs
   the password; nobody sees it). If neither is accepted the script stops with a
   clear verdict instead of running tests against a user that does not exist. */
DECLARE @readerOk  bit = 0;
DECLARE @readerHow varchar(60) = NULL;
DECLARE @pw        nvarchar(120);

IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'atlas_rule_reader')
BEGIN
    SET @readerOk = 1;
    SET @readerHow = 'already existed';
END
ELSE
BEGIN
    BEGIN TRY
        EXEC (N'CREATE USER atlas_rule_reader WITHOUT LOGIN');
        SET @readerOk = 1;
        SET @readerHow = 'WITHOUT LOGIN';
    END TRY
    BEGIN CATCH
        PRINT 'INFO S3.0b CREATE USER ... WITHOUT LOGIN not available, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    END CATCH;

    IF @readerOk = 0
    BEGIN
        BEGIN TRY
            SET @pw = CONVERT(nvarchar(36), NEWID()) + N'-aA1!' + CONVERT(nvarchar(36), NEWID());
            EXEC (N'CREATE USER atlas_rule_reader WITH PASSWORD = N''' + @pw + N'''');
            SET @readerOk = 1;
            SET @readerHow = 'WITH PASSWORD (random, never shown)';
        END TRY
        BEGIN CATCH
            PRINT 'INFO S3.0b CREATE USER ... WITH PASSWORD not available, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
        END CATCH;
    END
END

IF @readerOk = 0
BEGIN
    PRINT 'FAIL S3.0b no form of CREATE USER that can be impersonated was accepted here.';
    PRINT 'S3 RESULT: PRIMARY APPROACH NOT AVAILABLE on this platform. Use the fallback in FINAL PLAN/03 APP-0 (spike S3, "If it goes wrong"). Copy this whole Messages tab to Claude.';
    RETURN;
END

BEGIN TRY
    EXEC (N'GRANT SELECT ON SCHEMA::dev TO atlas_rule_reader');
    PRINT 'OK   S3.0b reader user ready (' + @readerHow + '); SELECT granted on schema dev only';
END TRY
BEGIN CATCH
    PRINT 'FAIL S3.0b GRANT SELECT on schema dev, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    PRINT 'S3 RESULT: the reader user exists but cannot be given SELECT. Copy this whole Messages tab to Claude.';
    RETURN;
END CATCH;

/* ---- S3.1 SELECT is allowed inside the schema ------------------------- */
SET @n = NULL;
BEGIN TRY
    EXECUTE AS USER = N'atlas_rule_reader';
    SELECT @n = COUNT(*) FROM dev.spike_data;
    REVERT;
    IF @n >= 1
        PRINT 'PASS S3.1 SELECT on dev.spike_data allowed as atlas_rule_reader (rows=' + CAST(@n AS varchar(12)) + ')';
    ELSE
    BEGIN
        PRINT 'FAIL S3.1 SELECT ran but returned no rows';
        SET @fail += 1;
    END
END TRY
BEGIN CATCH
    SET @err = ERROR_NUMBER();
    WHILE USER_NAME() = N'atlas_rule_reader' REVERT;
    PRINT 'FAIL S3.1 SELECT failed with error ' + CAST(@err AS varchar(12)) + ': ' + ERROR_MESSAGE();
    SET @fail += 1;
END CATCH;

/* ---- S3.2 INSERT is denied --------------------------------------------- */
SET @err = NULL;
BEGIN TRY
    EXECUTE AS USER = N'atlas_rule_reader';
    INSERT INTO dev.spike_data (label) VALUES (N'must-not-exist');
    REVERT;
    PRINT 'FAIL S3.2 INSERT was ALLOWED for atlas_rule_reader';
    SET @fail += 1;
END TRY
BEGIN CATCH
    SET @err = ERROR_NUMBER();
    WHILE USER_NAME() = N'atlas_rule_reader' REVERT;
    IF @err = 229
        PRINT 'PASS S3.2 INSERT denied as atlas_rule_reader (error 229)';
    ELSE
    BEGIN
        PRINT 'FAIL S3.2 INSERT failed for another reason, error ' + CAST(@err AS varchar(12)) + ': ' + ERROR_MESSAGE();
        SET @fail += 1;
    END
END CATCH;
DELETE FROM dev.spike_data WHERE label = N'must-not-exist';   -- clean up if S3.2 failed open

/* ---- S3.3 SELECT outside the granted schema is denied ------------------ */
IF OBJECT_ID(N'dbo.TestNote', N'U') IS NULL
    PRINT 'SKIP S3.3 dbo.TestNote not found; no table outside schema dev to test against';
ELSE
BEGIN
    SET @err = NULL;
    BEGIN TRY
        EXECUTE AS USER = N'atlas_rule_reader';
        SELECT @n = COUNT(*) FROM dbo.TestNote;
        REVERT;
        PRINT 'FAIL S3.3 SELECT on dbo.TestNote was ALLOWED for atlas_rule_reader';
        SET @fail += 1;
    END TRY
    BEGIN CATCH
        SET @err = ERROR_NUMBER();
        WHILE USER_NAME() = N'atlas_rule_reader' REVERT;
        IF @err = 229
            PRINT 'PASS S3.3 SELECT on dbo.TestNote denied as atlas_rule_reader (error 229)';
        ELSE
        BEGIN
            PRINT 'FAIL S3.3 unexpected error ' + CAST(@err AS varchar(12)) + ': ' + ERROR_MESSAGE();
            SET @fail += 1;
        END
    END CATCH;
END

/* ---- S3.4 the engine can describe a query's output columns ------------- */
SET @n = NULL;
BEGIN TRY
    EXECUTE AS USER = N'atlas_rule_reader';
    SELECT @n = COUNT(*)
    FROM sys.dm_exec_describe_first_result_set(N'SELECT id, label FROM dev.spike_data', NULL, 0)
    WHERE error_number IS NULL;
    REVERT;
    IF @n = 2
        PRINT 'PASS S3.4 describe_first_result_set returned 2 columns (id, label) without running the query';
    ELSE
    BEGIN
        PRINT 'FAIL S3.4 expected 2 columns, got ' + ISNULL(CAST(@n AS varchar(12)), 'NULL');
        SET @fail += 1;
    END
END TRY
BEGIN CATCH
    SET @err = ERROR_NUMBER();
    WHILE USER_NAME() = N'atlas_rule_reader' REVERT;
    PRINT 'FAIL S3.4 describe failed with error ' + CAST(@err AS varchar(12)) + ': ' + ERROR_MESSAGE();
    SET @fail += 1;
END CATCH;

/* ---- S3.5 describing a query on a table the reader cannot see ----------- */
IF OBJECT_ID(N'dbo.TestNote', N'U') IS NULL
    PRINT 'SKIP S3.5 dbo.TestNote not found';
ELSE
BEGIN
    SET @err = NULL;
    BEGIN TRY
        EXECUTE AS USER = N'atlas_rule_reader';
        SELECT @err = MAX(error_number)
        FROM sys.dm_exec_describe_first_result_set(N'SELECT id FROM dbo.TestNote', NULL, 0);
        REVERT;
        IF @err = 229
            PRINT 'PASS S3.5 describing a query on dbo.TestNote as the reader reports a permission error (229)';
        ELSE IF @err IS NOT NULL
        BEGIN
            PRINT 'FAIL S3.5 describe reported error ' + CAST(@err AS varchar(12)) + ', not a permission error (229)';
            SET @fail += 1;
        END
        ELSE
        BEGIN
            PRINT 'FAIL S3.5 the reader could describe a query on dbo.TestNote (source check must then use result-set metadata)';
            SET @fail += 1;
        END
    END TRY
    BEGIN CATCH
        SET @err = ERROR_NUMBER();
        WHILE USER_NAME() = N'atlas_rule_reader' REVERT;
        IF @err = 229
            PRINT 'PASS S3.5 describing a query on dbo.TestNote as the reader raised a permission error (229)';
        ELSE
        BEGIN
            -- Any other error (for example a missing user) proves nothing about permissions.
            PRINT 'FAIL S3.5 describe raised error ' + CAST(@err AS varchar(12)) + ', not a permission error (229): ' + ERROR_MESSAGE();
            SET @fail += 1;
        END
    END CATCH;
END

/* ---- S3.6 show the column metadata grid (for the record) ---------------- */
BEGIN TRY
    EXEC sp_describe_first_result_set @tsql = N'SELECT id, label FROM dev.spike_data';
    PRINT 'OK   S3.6 sp_describe_first_result_set grid is in the Results tab';
END TRY
BEGIN CATCH
    PRINT 'FAIL S3.6 sp_describe_first_result_set error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    SET @fail += 1;
END CATCH;

/* ---- summary ------------------------------------------------------------ */
IF @fail = 0
    PRINT 'S3 RESULT: ALL STEPS PASS';
ELSE
    PRINT 'S3 RESULT: ' + CAST(@fail AS varchar(12)) + ' STEP(S) FAILED. Copy this whole Messages tab to Claude.';
