/* =====================================================================
   probe_engine.sql        APP-0 diagnostic (run only if a spike script fails)
   Database : the editor you want to test (it runs anywhere on purpose)
   Run once : Fabric portal > item > New query > paste > Run
   Then     : copy the whole Messages tab into the Claude chat.
   Re-runnable: yes. Creates probe objects (names start with probe_) and drops
   them again. Contains no client data and prints no e-mail addresses.

   History
   - 13 Nov, v1: showed the editor was the SQL analytics endpoint (engine 11).
   - 13 Nov, v2: in the right editor CREATE SCHEMA failed with Msg 37353 ("Server
     identity does not have the Microsoft Entra Directory Readers permission").
     This version tests CREATE SCHEMA with and without an explicit owner, then
     tables, a user without a login and EXECUTE AS, so we learn which forms work.

   Every statement under test runs through EXEC so a rejected statement is
   reported as FAIL instead of stopping the script. Probe tables go in dbo, so
   the table tests do not depend on a schema having been created.
   ===================================================================== */
SET NOCOUNT ON;

DECLARE @fail    int = 0;
DECLARE @schemaA int = NULL;   -- error number of CREATE SCHEMA without owner (NULL = passed)
DECLARE @schemaB int = NULL;   -- error number of CREATE SCHEMA ... AUTHORIZATION dbo
DECLARE @userOk  bit = 0;

/* ---- facts about the engine and the caller (no names, no e-mail) -------- */
PRINT 'INFO engine_edition = ' + ISNULL(CAST(SERVERPROPERTY('EngineEdition') AS varchar(20)), '?');
PRINT 'INFO database       = ' + ISNULL(DB_NAME(), '?');
PRINT 'INFO version        = ' + REPLACE(REPLACE(@@VERSION, CHAR(13), ' '), CHAR(10), ' ');
PRINT 'INFO database user  = ' + ISNULL(USER_NAME(), '?');
PRINT 'INFO is db_owner    = ' + ISNULL(CAST(IS_MEMBER('db_owner') AS varchar(5)), 'NULL');
PRINT 'INFO CREATE SCHEMA permission = ' + ISNULL(CAST(HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE SCHEMA') AS varchar(5)), 'NULL');
PRINT 'INFO CREATE TABLE permission  = ' + ISNULL(CAST(HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE TABLE') AS varchar(5)), 'NULL');

BEGIN TRY
    DECLARE @principals nvarchar(1000);
    SELECT @principals = STRING_AGG(CAST(type_desc + '/' + ISNULL(authentication_type_desc, '?') + '=' + CAST(c AS varchar(10)) AS nvarchar(100)), N', ')
    FROM (SELECT type_desc, authentication_type_desc, COUNT(*) AS c
          FROM sys.database_principals
          GROUP BY type_desc, authentication_type_desc) AS x;
    PRINT 'INFO database principals (type/authentication=count) = ' + ISNULL(@principals, '?');
END TRY
BEGIN CATCH
    PRINT 'INFO database principals not readable: error ' + CAST(ERROR_NUMBER() AS varchar(12));
END CATCH;

/* ---- P1 CREATE SCHEMA without an owner (what the project would normally write) */
BEGIN TRY
    EXEC (N'DROP SCHEMA IF EXISTS probe_a');
    EXEC (N'CREATE SCHEMA probe_a');
    PRINT 'PASS P1 CREATE SCHEMA without AUTHORIZATION';
END TRY
BEGIN CATCH
    SET @schemaA = CASE WHEN ERROR_MESSAGE() LIKE N'%Directory Readers%' THEN 37353 ELSE ERROR_NUMBER() END;
    PRINT 'FAIL P1 CREATE SCHEMA without AUTHORIZATION: error ' + CAST(@schemaA AS varchar(12)) + ': ' + ERROR_MESSAGE();
    SET @fail += 1;
END CATCH;

/* ---- P2 CREATE SCHEMA with an explicit owner ----------------------------- */
BEGIN TRY
    EXEC (N'DROP SCHEMA IF EXISTS probe_b');
    EXEC (N'CREATE SCHEMA probe_b AUTHORIZATION dbo');
    PRINT 'PASS P2 CREATE SCHEMA ... AUTHORIZATION dbo';
END TRY
BEGIN CATCH
    SET @schemaB = CASE WHEN ERROR_MESSAGE() LIKE N'%Directory Readers%' THEN 37353 ELSE ERROR_NUMBER() END;
    PRINT 'FAIL P2 CREATE SCHEMA ... AUTHORIZATION dbo: error ' + CAST(@schemaB AS varchar(12)) + ': ' + ERROR_MESSAGE();
    SET @fail += 1;
END CATCH;

/* ---- P3 table with nvarchar, no primary key ------------------------------ */
BEGIN TRY
    EXEC (N'DROP TABLE IF EXISTS dbo.probe_plain');
    EXEC (N'CREATE TABLE dbo.probe_plain (id int NOT NULL, note nvarchar(20) NOT NULL)');
    PRINT 'PASS P3 CREATE TABLE with nvarchar and no primary key';
END TRY
BEGIN CATCH
    PRINT 'FAIL P3 CREATE TABLE with nvarchar and no primary key: error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    SET @fail += 1;
END CATCH;

/* ---- P4 identity column plus inline primary key -------------------------- */
BEGIN TRY
    EXEC (N'DROP TABLE IF EXISTS dbo.probe_identity_pk');
    EXEC (N'CREATE TABLE dbo.probe_identity_pk (id int IDENTITY(1,1) NOT NULL PRIMARY KEY, note nvarchar(20) NOT NULL)');
    PRINT 'PASS P4 CREATE TABLE with IDENTITY and PRIMARY KEY';
END TRY
BEGIN CATCH
    PRINT 'FAIL P4 CREATE TABLE with IDENTITY and PRIMARY KEY: error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    SET @fail += 1;
END CATCH;

/* ---- P5 user without a login (spike S3 needs it) ------------------------- */
BEGIN TRY
    EXEC (N'DROP USER IF EXISTS probe_user');
    EXEC (N'CREATE USER probe_user WITHOUT LOGIN');
    SET @userOk = 1;
    PRINT 'PASS P5 CREATE USER ... WITHOUT LOGIN';
END TRY
BEGIN CATCH
    PRINT 'FAIL P5 CREATE USER ... WITHOUT LOGIN: error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    SET @fail += 1;
END CATCH;

/* ---- P6 switch into that user and back (spike S3 needs it) --------------- */
IF @userOk = 1
BEGIN
    BEGIN TRY
        EXEC (N'GRANT SELECT ON dbo.probe_plain TO probe_user');
        EXECUTE AS USER = N'probe_user';
        DECLARE @who sysname = USER_NAME();
        REVERT;
        PRINT 'PASS P6 EXECUTE AS USER worked (ran as ' + @who + ')';
    END TRY
    BEGIN CATCH
        WHILE USER_NAME() = N'probe_user' REVERT;
        PRINT 'FAIL P6 GRANT / EXECUTE AS USER: error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
        SET @fail += 1;
    END CATCH;
END
ELSE
    PRINT 'SKIP P6 no probe user to switch into';

/* ---- clean up ------------------------------------------------------------ */
BEGIN TRY
    EXEC (N'DROP USER IF EXISTS probe_user');
    EXEC (N'DROP TABLE IF EXISTS dbo.probe_plain');
    EXEC (N'DROP TABLE IF EXISTS dbo.probe_identity_pk');
    EXEC (N'DROP SCHEMA IF EXISTS probe_a');
    EXEC (N'DROP SCHEMA IF EXISTS probe_b');
    PRINT 'OK   probe objects dropped';
END TRY
BEGIN CATCH
    PRINT 'FAIL cleanup: error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE() + '. Probe objects start with probe_; send this line to Claude.';
    SET @fail += 1;
END CATCH;

/* ---- reading ------------------------------------------------------------- */
IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
    PRINT 'HINT This is the warehouse-style engine (engine_edition 11; the version text says SQL Data Warehouse). Open the item of type "SQL database" (there DB_NAME() ends with the item id and the version text says Microsoft SQL Azure) and run this again.';

IF @schemaA = 37353 AND @schemaB IS NULL
    PRINT 'HINT CREATE SCHEMA needs the explicit owner here: write CREATE SCHEMA <name> AUTHORIZATION dbo in every migration.';

IF @schemaA = 37353 AND @schemaB = 37353
    PRINT 'HINT Both CREATE SCHEMA forms hit Msg 37353: the database server identity needs the Microsoft Entra Directory Readers role, which only an Entra administrator of the tenant can grant. Send this Messages tab to Claude.';

IF @fail = 0
    PRINT 'PROBE RESULT: every form is accepted here; the spike scripts should run in this editor.';
ELSE
    PRINT 'PROBE RESULT: ' + CAST(@fail AS varchar(12)) + ' PROBE(S) FAILED. Copy this whole Messages tab to Claude.';
