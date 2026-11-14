/* =====================================================================
   0001_schemas.sql          APP-1, migration 1 of 7
   Database : the ATLAS Fabric SQL database (item of type SQL database)
   Re-runnable: yes. Never edit after it has run; change = a new file.

   Creates the schemas `app` (the app's tables, procedures, views) and `dev`
   (spike and stub objects, dropped when the real gold lands). `gold` belongs
   to the data engineer (`db/gold/`); the gold stub creates it if absent.

   Every schema is created WITH an explicit owner (AUTHORIZATION dbo): without
   it our Microsoft Entra accounts fail with Msg 37353 (01 section 5).
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL 0001 wrong editor: connected to "' + DB_NAME() + '" on engine ' + ISNULL(CAST(SERVERPROPERTY('EngineEdition') AS varchar(20)), '?') + '. Open the item named ATLAS_SQL_DB whose type is SQL database (not the SQL analytics endpoint) and run this from New query there. Nothing was changed.';
    RETURN;
END
PRINT 'OK  connected to database "' + DB_NAME() + '"';

DECLARE @failed int = 0;

BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'app')
        EXEC (N'CREATE SCHEMA app AUTHORIZATION dbo');
    PRINT 'OK  0001 schema app ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0001 CREATE SCHEMA app AUTHORIZATION dbo, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    IF ERROR_NUMBER() = 37353 OR ERROR_MESSAGE() LIKE N'%Directory Readers%'
        PRINT 'HINT Msg 37353: the database tried to look up a Microsoft Entra account. Run db/dev/probe_engine.sql in this editor and paste its Messages tab to Claude.';
END CATCH;

BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'dev')
        EXEC (N'CREATE SCHEMA dev AUTHORIZATION dbo');
    PRINT 'OK  0001 schema dev ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0001 CREATE SCHEMA dev AUTHORIZATION dbo, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

IF @failed = 0 PRINT '0001_schemas RESULT: ALL 2 SCHEMAS READY';
ELSE PRINT '0001_schemas RESULT: ' + CAST(@failed AS varchar(12)) + ' SCHEMA(S) FAILED';
