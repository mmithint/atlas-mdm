/* =====================================================================
   spike_s2_setup.sql        APP-0, spike S2 (setup)
   Database : the ATLAS Fabric SQL database (item of type SQL database)
   Run once : Fabric portal > SQL database > New query > paste > Run
   Re-runnable: yes (nothing is dropped, nothing is duplicated)

   Why: the function `sqlPing` opens a transaction, writes two rows into
   dev.spike, reads them back, then ROLLS BACK. Acceptance for S2 is that
   dev.spike is empty afterwards. This script only creates the empty table.

   Contains no client data. `dev` is the schema for temporary spike and stub
   objects; APP-1 migration 0001 also creates it with IF NOT EXISTS.

   History: 13 Nov, 1st run was in the SQL analytics endpoint (Msg 24584, wrong
   editor). 2nd run, in the right editor, failed on CREATE SCHEMA with Msg 37353
   (the server identity may not read Microsoft Entra). This version creates the
   schema with an explicit owner (AUTHORIZATION dbo) so the database does not
   have to look up the caller's Entra account.
   ===================================================================== */
SET NOCOUNT ON;

/* Guard: this must run in the SQL database item, not in a warehouse or in the
   SQL analytics endpoint (engine 11, "SQL Data Warehouse"). Those reject
   PRIMARY KEY with Msg 24584. RETURN ends the batch before anything changes. */
IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL S2.0 wrong editor: connected to "' + DB_NAME() + '" on engine ' + ISNULL(CAST(SERVERPROPERTY('EngineEdition') AS varchar(20)), '?') + ' (11 = the warehouse-style engine, which the SQL analytics endpoint uses). Open the item named ATLAS_SQL_DB whose type is SQL database and run this from New query there. Nothing was changed.';
    RETURN;
END
PRINT 'OK  connected to database "' + DB_NAME() + '" (this is the value for SQL_DATABASE in packages/functions/src/config.ts)';

/* ---- S2.1 schema --------------------------------------------------------- */
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'dev')
        EXEC (N'CREATE SCHEMA dev AUTHORIZATION dbo');
    PRINT 'OK  S2.1 schema dev ready';
END TRY
BEGIN CATCH
    PRINT 'FAIL S2.1 CREATE SCHEMA dev AUTHORIZATION dbo, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    IF ERROR_NUMBER() = 37353 OR ERROR_MESSAGE() LIKE N'%Directory Readers%'
        PRINT 'HINT Msg 37353: the database tried to look up a Microsoft Entra account and the server identity is not allowed to read the directory. Run db/dev/probe_engine.sql in this same editor and paste its Messages tab; it shows which forms work. Nothing else was changed.';
    RETURN;
END CATCH;

/* ---- S2.2 table (through EXEC so a rejected statement is reported, not fatal) */
BEGIN TRY
    IF OBJECT_ID(N'dev.spike', N'U') IS NULL
        EXEC (N'CREATE TABLE dev.spike
        (
            id          int IDENTITY(1,1) NOT NULL PRIMARY KEY,
            note        nvarchar(100)     NOT NULL,
            created_utc datetime2(3)      NOT NULL CONSTRAINT df_spike_created_utc DEFAULT (SYSUTCDATETIME())
        )');

    DECLARE @rowCount int;
    EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dev.spike', N'@n int OUTPUT', @n = @rowCount OUTPUT;
    PRINT 'OK  S2.2 dev.spike exists (rows now: ' + CAST(@rowCount AS varchar(12)) + '; expected 0 before and after the sqlPing spike)';
END TRY
BEGIN CATCH
    PRINT 'FAIL S2.2 CREATE TABLE dev.spike, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;
