/* =====================================================================
   probe_s7_views_drop.sql        removes what db/dev/probe_s7_views.sql created
   Database : the ATLAS Fabric SQL database (item of type SQL database)
   Run once : Fabric portal > SQL database > New query > paste > Run
   Re-runnable: yes. Drops only objects whose names start with probe_s7 / vw_probe_s7
   in schema dev. Contains no client data.

   Run it after the connector probe is finished and its result is recorded. Until the next
   `npx rayfin up`, the deployed connector may still name one of these objects; nothing in
   the app reads it, and the next deploy replaces that configuration.
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL wrong editor: connected to "' + DB_NAME() + '". Open the item named ATLAS_SQL_DB whose type is SQL database. Nothing was changed.';
    RETURN;
END

BEGIN TRY
    EXEC (N'DROP VIEW  IF EXISTS dev.vw_probe_s7_join');
    EXEC (N'DROP VIEW  IF EXISTS dev.vw_probe_s7_key');
    EXEC (N'DROP VIEW  IF EXISTS dev.vw_probe_s7_types');
    EXEC (N'DROP VIEW  IF EXISTS dev.vw_probe_s7_plain');
    EXEC (N'DROP TABLE IF EXISTS dev.probe_s7_child');
    EXEC (N'DROP TABLE IF EXISTS dev.probe_s7_table');

    DECLARE @left int;
    SELECT @left = COUNT(*)
    FROM sys.objects AS o
    WHERE o.schema_id = SCHEMA_ID(N'dev') AND o.name LIKE N'%probe[_]s7%';

    IF @left = 0
        PRINT 'OK  all probe_s7 objects are gone from schema dev';
    ELSE
        PRINT 'FAIL ' + CAST(@left AS varchar(10)) + ' probe_s7 object(s) are still in schema dev; copy this line to Claude.';
END TRY
BEGIN CATCH
    PRINT 'FAIL drop, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;
