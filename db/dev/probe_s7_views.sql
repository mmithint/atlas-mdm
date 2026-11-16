/* =====================================================================
   probe_s7_views.sql        APP-2, spike S7 follow-up (14-15 Nov): table vs view
   Database : the ATLAS Fabric SQL database (item of type SQL database)
   Run once : Fabric portal > SQL database > New query > paste > Run
   Then     : copy the whole Messages tab into the Claude chat, then run
              tools\probe_view_vs_table.ps1 (FINAL PLAN/your_steps/APP-2.md, B3c).
   Re-runnable: yes (the probe objects are dropped and created again).
   Remove afterwards with db/dev/probe_s7_views_drop.sql.

   Why: on 14 Nov the connector accepted the plain table app.field_catalog and refused all
   five real views ("Source attachment failed"). The five views differ from the table in
   many ways at once, so the cause is unknown. This script builds a small ladder in schema
   dev, one step at a time, so the probe can tell views in general from our views:

     dev.probe_s7_table        CONTROL. Plain table, primary key, four columns. Must be accepted.
     dev.vw_probe_s7_plain     V1. A view over the control: two columns, key passes straight through.
                               If THIS is refused, views are refused in every form.
     dev.vw_probe_s7_types     V2. V1 plus a decimal(18,4) and a datetime2(3) column.
     dev.vw_probe_s7_key       V3. The key pattern of our real views: ISNULL as the outermost
                               function on a string key, CAST on every column.
     dev.vw_probe_s7_join      V4. A join (OUTER APPLY) with a count and a MAX, like
                               app.vw_equipment_search.

   Every view keeps a key the database reports as NOT NULL (checked below): a nullable key
   was what failed our first view test on 14 Nov, and it would make this probe meaningless.

   Contains no client data: three fake parent rows (PROBE-ALPHA, -BETA, -GAMMA) and three
   fake child rows. Prints no e-mail address.
   ===================================================================== */
SET NOCOUNT ON;

/* Guard: the SQL database item, not a warehouse or the SQL analytics endpoint. */
IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL P0 wrong editor: connected to "' + DB_NAME() + '" on engine ' + ISNULL(CAST(SERVERPROPERTY('EngineEdition') AS varchar(20)), '?') + '. Open the item named ATLAS_SQL_DB whose type is SQL database and run this from New query there. Nothing was changed.';
    RETURN;
END
PRINT 'OK  P0 connected to database "' + DB_NAME() + '"';

DECLARE @fails  int = 0;
DECLARE @checks int = 0;

/* ---- P1 schema dev (normally exists since APP-0) -------------------------- */
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'dev')
        EXEC (N'CREATE SCHEMA dev AUTHORIZATION dbo');
    PRINT 'OK  P1 schema dev ready';
END TRY
BEGIN CATCH
    PRINT 'FAIL P1 schema dev, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE() + '. Nothing else was done.';
    RETURN;
END CATCH;

/* ---- P2 drop any earlier probe objects, views first ----------------------- */
BEGIN TRY
    EXEC (N'DROP VIEW  IF EXISTS dev.vw_probe_s7_join');
    EXEC (N'DROP VIEW  IF EXISTS dev.vw_probe_s7_key');
    EXEC (N'DROP VIEW  IF EXISTS dev.vw_probe_s7_types');
    EXEC (N'DROP VIEW  IF EXISTS dev.vw_probe_s7_plain');
    EXEC (N'DROP TABLE IF EXISTS dev.probe_s7_child');
    EXEC (N'DROP TABLE IF EXISTS dev.probe_s7_table');
    PRINT 'OK  P2 earlier probe objects removed (if there were any)';
END TRY
BEGIN CATCH
    PRINT 'FAIL P2 cleanup, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    RETURN;
END CATCH;

/* ---- P3 the two tables and their fake rows -------------------------------- */
BEGIN TRY
    EXEC (N'CREATE TABLE dev.probe_s7_table
    (
        id         int           NOT NULL CONSTRAINT pk_probe_s7_table PRIMARY KEY,
        label      nvarchar(40)  NULL,
        amount     decimal(18,4) NULL,
        changed_at datetime2(3)  NULL
    )');
    EXEC (N'CREATE TABLE dev.probe_s7_child
    (
        child_id int          NOT NULL CONSTRAINT pk_probe_s7_child PRIMARY KEY,
        id       int          NOT NULL,
        note     nvarchar(40) NULL
    )');
    EXEC (N'INSERT INTO dev.probe_s7_table (id, label, amount, changed_at) VALUES
        (1, N''PROBE-ALPHA'', 1.5000, ''2026-01-01T00:00:00''),
        (2, N''PROBE-BETA'',  2.2500, ''2026-01-02T00:00:00''),
        (3, N''PROBE-GAMMA'', NULL,   NULL)');
    EXEC (N'INSERT INTO dev.probe_s7_child (child_id, id, note) VALUES
        (1, 1, N''probe note 1a''),
        (2, 1, N''probe note 1b''),
        (3, 2, N''probe note 2a'')');
    PRINT 'OK  P3 tables dev.probe_s7_table (3 rows) and dev.probe_s7_child (3 rows) created';
END TRY
BEGIN CATCH
    PRINT 'FAIL P3 tables, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    RETURN;
END CATCH;

/* ---- P4 the four views (each through EXEC: CREATE VIEW must be its own batch) */
BEGIN TRY
    EXEC (N'CREATE OR ALTER VIEW dev.vw_probe_s7_plain
    AS
    SELECT id, label
    FROM dev.probe_s7_table');

    EXEC (N'CREATE OR ALTER VIEW dev.vw_probe_s7_types
    AS
    SELECT id, label, amount, changed_at
    FROM dev.probe_s7_table');

    EXEC (N'CREATE OR ALTER VIEW dev.vw_probe_s7_key
    AS
    SELECT
        ISNULL(CAST(t.id AS nvarchar(20)), N''0'') AS probe_key,
        CAST(t.label      AS nvarchar(40))  AS label,
        CAST(t.amount     AS decimal(18,4)) AS amount,
        CAST(t.changed_at AS datetime2(3))  AS changed_at
    FROM dev.probe_s7_table AS t');

    EXEC (N'CREATE OR ALTER VIEW dev.vw_probe_s7_join
    AS
    SELECT
        ISNULL(t.id, 0)                    AS id,
        CAST(t.label       AS nvarchar(40)) AS label,
        CAST(c.child_count AS int)          AS child_count,
        CAST(c.last_note   AS nvarchar(40)) AS last_note
    FROM dev.probe_s7_table AS t
    OUTER APPLY
    (
        SELECT COUNT(*) AS child_count, MAX(ch.note) AS last_note
        FROM dev.probe_s7_child AS ch
        WHERE ch.id = t.id
    ) AS c');
    PRINT 'OK  P4 views vw_probe_s7_plain, _types, _key and _join created';
END TRY
BEGIN CATCH
    PRINT 'FAIL P4 views, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    RETURN;
END CATCH;

/* ---- C: every object returns 3 rows and its key is reported NOT NULL ------- */
DECLARE @objs TABLE (n int IDENTITY(1,1) PRIMARY KEY, obj nvarchar(128) NOT NULL, keycol sysname NOT NULL);
INSERT INTO @objs (obj, keycol) VALUES
    (N'dev.probe_s7_table',    N'id'),
    (N'dev.vw_probe_s7_plain', N'id'),
    (N'dev.vw_probe_s7_types', N'id'),
    (N'dev.vw_probe_s7_key',   N'probe_key'),
    (N'dev.vw_probe_s7_join',  N'id');

DECLARE @i int = 1;
DECLARE @max int = (SELECT COUNT(*) FROM @objs);
DECLARE @obj nvarchar(128), @key sysname, @sql nvarchar(400), @rows int, @nullable int;

WHILE @i <= @max
BEGIN
    SELECT @obj = obj, @key = keycol FROM @objs WHERE n = @i;
    SET @checks += 1;
    BEGIN TRY
        SET @rows = NULL;
        SET @nullable = NULL;

        SET @sql = N'SELECT @r = COUNT(*) FROM ' + @obj;
        EXEC sp_executesql @sql, N'@r int OUTPUT', @r = @rows OUTPUT;

        SET @sql = N'SELECT * FROM ' + @obj;
        SELECT @nullable = CAST(d.is_nullable AS int)
        FROM sys.dm_exec_describe_first_result_set(@sql, NULL, 0) AS d
        WHERE d.name = @key;

        IF @rows = 3 AND @nullable = 0
            PRINT 'OK  C' + CAST(@i AS varchar(3)) + ' ' + @obj + ': 3 rows, key ' + @key + ' is reported as not nullable';
        ELSE
        BEGIN
            SET @fails += 1;
            PRINT 'FAIL C' + CAST(@i AS varchar(3)) + ' ' + @obj + ': rows = ' + ISNULL(CAST(@rows AS varchar(12)), 'NULL')
                + ' (expected 3), key ' + @key + ' is_nullable = ' + ISNULL(CAST(@nullable AS varchar(3)), 'column not found') + ' (expected 0)';
        END
    END TRY
    BEGIN CATCH
        SET @fails += 1;
        PRINT 'FAIL C' + CAST(@i AS varchar(3)) + ' ' + @obj + ': error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    END CATCH;
    SET @i += 1;
END

/* ---- reading ------------------------------------------------------------- */
IF @fails = 0
    PRINT 'PROBE SETUP RESULT: ALL ' + CAST(@checks AS varchar(10)) + ' CHECKS PASS. Next: run tools\probe_view_vs_table.ps1 (your_steps/APP-2.md, B3c). Remove these objects later with db/dev/probe_s7_views_drop.sql.';
ELSE
    PRINT 'PROBE SETUP RESULT: ' + CAST(@fails AS varchar(10)) + ' OF ' + CAST(@checks AS varchar(10)) + ' CHECKS FAILED. Do NOT run the connector probe; copy this whole Messages tab to Claude.';
