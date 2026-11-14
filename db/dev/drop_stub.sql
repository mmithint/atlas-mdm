/* =====================================================================
   drop_stub.sql             APP-1, removes the synthetic gold stub
   Database : the ATLAS Fabric SQL database (item of type SQL database)
   Run      : Fabric portal > SQL database > New query > paste > Run
              when the data engineer's real gold views are in place
              (or whenever the stub should be rebuilt from scratch)
   Re-runnable: yes (it only drops what is still there)

   What it drops, in this order:
     1. the five gold contract views, ONLY when the view definition contains
        the marker "ATLAS-STUB" (a real view by the data engineer is left alone)
     2. every table in schema dev whose name starts with stub_
        (stub_equipment, stub_floc, stub_defect)
     3. the procedure gold.usp_apply_approved_change, ONLY when its definition
        contains "ATLAS-STUB" (the merge stub from db/dev/merge_stub.sql)
   It never touches the schemas, the spike objects (dev.spike, dev.spike_data)
   or any other gold object.
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL DROP.0 wrong editor: connected to "' + DB_NAME() + '" on engine ' + ISNULL(CAST(SERVERPROPERTY('EngineEdition') AS varchar(20)), '?') + ' (11 = the warehouse-style engine, which the SQL analytics endpoint uses). Open the item named ATLAS_SQL_DB whose type is SQL database and run this from New query there. Nothing was changed.';
    RETURN;
END
PRINT 'OK  connected to database "' + DB_NAME() + '"';

DECLARE @steps int = 0, @failed int = 0;
DECLARE @i int, @max int, @name sysname;
DECLARE @views TABLE (seq int IDENTITY(1,1) NOT NULL PRIMARY KEY, view_name sysname NOT NULL);
DECLARE @tables TABLE (seq int IDENTITY(1,1) NOT NULL PRIMARY KEY, table_name sysname NOT NULL);

INSERT INTO @views (view_name) VALUES
    (N'vw_equipment_current'),
    (N'vw_equipment_field_current'),
    (N'vw_floc_current'),
    (N'vw_verification_score'),
    (N'vw_verification_by_business_unit');

/* ---- DROP.1 stub views (only those that carry the ATLAS-STUB marker) ------- */
SET @i = 1;
SELECT @max = MAX(seq) FROM @views;
WHILE @i <= @max
BEGIN
    SELECT @name = view_name FROM @views WHERE seq = @i;
    BEGIN TRY
        IF OBJECT_ID(N'gold.' + @name, N'V') IS NULL
            PRINT 'INFO DROP.1 gold.' + @name + ' does not exist as a view: nothing to drop';
        ELSE IF OBJECT_DEFINITION(OBJECT_ID(N'gold.' + @name, N'V')) LIKE N'%ATLAS-STUB%'
        BEGIN
            EXEC (N'DROP VIEW gold.' + @name);
            PRINT 'OK  DROP.1 dropped stub view gold.' + @name;
        END
        ELSE
            PRINT 'INFO DROP.1 gold.' + @name + ' is not the stub (no ATLAS-STUB marker; the data engineer''s real view): skipped';
        SET @steps += 1;
    END TRY
    BEGIN CATCH
        SET @steps += 1; SET @failed += 1;
        PRINT 'FAIL DROP.1 gold.' + @name + ', error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    END CATCH;
    SET @i += 1;
END

/* ---- DROP.2 stub tables in schema dev -------------------------------------- */
INSERT INTO @tables (table_name)
SELECT t.name
FROM sys.tables AS t
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
WHERE s.name = N'dev' AND t.name LIKE N'stub[_]%'
ORDER BY t.name;

SET @i = 1;
SET @max = (SELECT MAX(seq) FROM @tables);
IF @max IS NULL
BEGIN
    SET @steps += 1;
    PRINT 'INFO DROP.2 no dev.stub_* tables found: nothing to drop';
END
ELSE
WHILE @i <= @max
BEGIN
    SELECT @name = table_name FROM @tables WHERE seq = @i;
    BEGIN TRY
        EXEC (N'DROP TABLE dev.' + @name);
        SET @steps += 1;
        PRINT 'OK  DROP.2 dropped table dev.' + @name;
    END TRY
    BEGIN CATCH
        SET @steps += 1; SET @failed += 1;
        PRINT 'FAIL DROP.2 dev.' + @name + ', error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    END CATCH;
    SET @i += 1;
END

/* ---- DROP.3 merge stub (only if it is the stub) ----------------------------- */
BEGIN TRY
    IF OBJECT_ID(N'gold.usp_apply_approved_change', N'P') IS NULL
        PRINT 'INFO DROP.3 gold.usp_apply_approved_change does not exist: nothing to drop';
    ELSE IF OBJECT_DEFINITION(OBJECT_ID(N'gold.usp_apply_approved_change', N'P')) LIKE N'%ATLAS-STUB%'
    BEGIN
        EXEC (N'DROP PROCEDURE gold.usp_apply_approved_change');
        PRINT 'OK  DROP.3 dropped the merge stub gold.usp_apply_approved_change';
    END
    ELSE
        PRINT 'INFO DROP.3 gold.usp_apply_approved_change is not the stub (no ATLAS-STUB marker; the data engineer''s real merge procedure): skipped';
    SET @steps += 1;
END TRY
BEGIN CATCH
    SET @steps += 1; SET @failed += 1;
    PRINT 'FAIL DROP.3 gold.usp_apply_approved_change, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

IF @failed = 0
    PRINT 'drop_stub RESULT: ALL ' + CAST(@steps AS varchar(12)) + ' CHECKS PASS';
ELSE
    PRINT 'drop_stub RESULT: ' + CAST(@failed AS varchar(12)) + ' CHECK(S) FAILED';
