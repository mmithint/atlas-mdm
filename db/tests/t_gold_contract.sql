/* =====================================================================
   t_gold_contract.sql       APP-1, contract test for the gold views
   Database : the ATLAS Fabric SQL database (item of type SQL database)
   Run      : Fabric portal > SQL database > New query > paste > Run
   Who runs : the app track against the stub (db/dev/gold_stub.sql), the data
              engineer after every gold load. THE SAME FILE, both must pass.
   Read-only: yes (it only reads metadata and counts rows)

   What it checks, for each of the five contract views of
   01_Architecture_and_Contracts.md section 6.1
   (gold.vw_equipment_current, gold.vw_equipment_field_current,
    gold.vw_floc_current, gold.vw_verification_score,
    gold.vw_verification_by_business_unit):
     C<n>.1 the view exists
     C<n>.2 EVERY contract column is present with exactly the contract name
            (spelling and case) and exactly the contract type; a missing,
            misnamed or wrongly typed column is named in the FAIL line.
            Extra columns are allowed and are listed as INFO.
     C<n>.3 no column is typed (max) (nvarchar(max) must never reach the connector)
     C<n>.4 the key column exists, is never NULL and is unique

   Types: 01 section 6.1 states the types of gold.vw_equipment_current and
   gold.vw_equipment_field_current. For gold.vw_floc_current and the two
   verification views it lists names only, so the types below are the ones the
   stub uses [INFERRED]. If the real view needs another type, change 01 section
   6.1 first, then this file and gold_stub.sql.

   Reference tables gold.class_characteristic and
   gold.ref_heater_allowed_combination (data engineer, DE-3): their column names
   are not fixed in the plan, so only existence is checked, plus the column
   is_used_in_poc on the allowed-combination table (named in 02, DE-3).
   While @require_reference_tables = 0 a missing table is an INFO, not a FAIL.
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL C0 wrong editor: connected to "' + DB_NAME() + '" on engine ' + ISNULL(CAST(SERVERPROPERTY('EngineEdition') AS varchar(20)), '?') + ' (11 = the warehouse-style engine, which the SQL analytics endpoint uses). Open the item named ATLAS_SQL_DB whose type is SQL database and run this from New query there. Nothing was changed.';
    RETURN;
END
PRINT 'OK  connected to database "' + DB_NAME() + '"';

/* DATA ENGINEER: set this to 1 once gold.class_characteristic and
   gold.ref_heater_allowed_combination are delivered (DE-3). */
DECLARE @require_reference_tables bit = 0;

DECLARE @checks int = 0, @fails int = 0;
DECLARE @i int, @max int, @v sysname, @key sysname, @sql nvarchar(1000), @tag varchar(12);
DECLARE @problems nvarchar(4000), @extras nvarchar(4000), @ncols int;
DECLARE @t bigint, @dk bigint, @nl bigint;

/* contract: view, column, exact type as reported by sys.dm_exec_describe_first_result_set */
DECLARE @exp TABLE
(
    view_name sysname      NOT NULL,
    col_name  sysname      NOT NULL,
    col_type  nvarchar(40) NOT NULL,
    PRIMARY KEY (view_name, col_name)
);

INSERT INTO @exp (view_name, col_name, col_type) VALUES
    (N'vw_equipment_current', N'equipment_id',                 N'int'),
    (N'vw_equipment_current', N'equipment_number',             N'nvarchar(18)'),
    (N'vw_equipment_current', N'equipment_description',        N'nvarchar(40)'),
    (N'vw_equipment_current', N'functional_location',          N'nvarchar(40)'),
    (N'vw_equipment_current', N'floc_description',             N'nvarchar(40)'),
    (N'vw_equipment_current', N'superior_functional_location', N'nvarchar(40)'),
    (N'vw_equipment_current', N'equipment_tag_number',         N'nvarchar(30)'),
    (N'vw_equipment_current', N'equip_class',                  N'nvarchar(30)'),
    (N'vw_equipment_current', N'class_type',                   N'nvarchar(30)'),
    (N'vw_equipment_current', N'object_type',                  N'nvarchar(30)'),
    (N'vw_equipment_current', N'floc_class',                   N'nvarchar(30)'),
    (N'vw_equipment_current', N'tech_object_type',             N'nvarchar(30)'),
    (N'vw_equipment_current', N'manufacturer',                 N'nvarchar(30)'),
    (N'vw_equipment_current', N'model_number',                 N'nvarchar(20)'),
    (N'vw_equipment_current', N'manufacturer_serial_number',   N'nvarchar(30)'),
    (N'vw_equipment_current', N'fired_unfired',                N'nvarchar(30)'),
    (N'vw_equipment_current', N'heat_duty_mmbtu_hr',           N'decimal(18,4)'),
    (N'vw_equipment_current', N'heat_duty_source',             N'nvarchar(20)'),
    (N'vw_equipment_current', N'equipment_user_status',        N'nvarchar(30)'),
    (N'vw_equipment_current', N'floc_user_status',             N'nvarchar(30)'),
    (N'vw_equipment_current', N'profit_center_name',           N'nvarchar(40)'),
    (N'vw_equipment_current', N'planner_group',                N'nvarchar(40)'),
    (N'vw_equipment_current', N'heater_population_method',     N'nvarchar(10)'),
    (N'vw_equipment_current', N'golden_version_id',            N'int'),
    (N'vw_equipment_current', N'last_changed_at_utc',          N'datetime2(3)'),
    (N'vw_equipment_current', N'baseline_as_of_utc',           N'datetime2(3)'),

    (N'vw_equipment_field_current', N'equipment_field_key',    N'nvarchar(80)'),
    (N'vw_equipment_field_current', N'equipment_id',           N'int'),
    (N'vw_equipment_field_current', N'field_code',             N'nvarchar(64)'),
    (N'vw_equipment_field_current', N'current_value',          N'nvarchar(400)'),
    (N'vw_equipment_field_current', N'baseline_value',         N'nvarchar(400)'),
    (N'vw_equipment_field_current', N'unit',                   N'nvarchar(20)'),
    (N'vw_equipment_field_current', N'value_source',           N'nvarchar(20)'),
    (N'vw_equipment_field_current', N'last_request_id',        N'bigint'),
    (N'vw_equipment_field_current', N'last_changed_at_utc',    N'datetime2(3)'),

    (N'vw_floc_current', N'functional_location',               N'nvarchar(40)'),
    (N'vw_floc_current', N'floc_description',                  N'nvarchar(40)'),
    (N'vw_floc_current', N'superior_functional_location',      N'nvarchar(40)'),
    (N'vw_floc_current', N'floc_class',                        N'nvarchar(30)'),
    (N'vw_floc_current', N'tech_object_type',                  N'nvarchar(30)'),
    (N'vw_floc_current', N'floc_user_status',                  N'nvarchar(30)'),
    (N'vw_floc_current', N'profit_center_name',                N'nvarchar(40)'),
    (N'vw_floc_current', N'level1_id',                         N'nvarchar(40)'),
    (N'vw_floc_current', N'level2_id',                         N'nvarchar(40)'),
    (N'vw_floc_current', N'level3_id',                         N'nvarchar(40)'),
    (N'vw_floc_current', N'level4_id',                         N'nvarchar(40)'),
    (N'vw_floc_current', N'level5_id',                         N'nvarchar(40)'),
    (N'vw_floc_current', N'level6_id',                         N'nvarchar(40)'),
    (N'vw_floc_current', N'golden_version_id',                 N'int'),
    (N'vw_floc_current', N'last_changed_at_utc',               N'datetime2(3)'),

    (N'vw_verification_score', N'equipment_id',                N'int'),
    (N'vw_verification_score', N'key_fields_total',            N'int'),
    (N'vw_verification_score', N'key_fields_verified',         N'int'),
    (N'vw_verification_score', N'verification_pct',            N'decimal(5,2)'),
    (N'vw_verification_score', N'last_verified_at_utc',        N'datetime2(3)'),
    (N'vw_verification_score', N'profit_center_name',          N'nvarchar(40)'),

    (N'vw_verification_by_business_unit', N'profit_center_name',          N'nvarchar(40)'),
    (N'vw_verification_by_business_unit', N'heaters',                     N'int'),
    (N'vw_verification_by_business_unit', N'avg_verification_pct',        N'decimal(5,2)'),
    (N'vw_verification_by_business_unit', N'heaters_fully_verified',      N'int'),
    (N'vw_verification_by_business_unit', N'pct_heaters_fully_verified',  N'decimal(5,2)');

DECLARE @views TABLE (seq int NOT NULL PRIMARY KEY, view_name sysname NOT NULL, key_col sysname NOT NULL);
INSERT INTO @views (seq, view_name, key_col) VALUES
    (1, N'vw_equipment_current',               N'equipment_id'),
    (2, N'vw_equipment_field_current',         N'equipment_field_key'),
    (3, N'vw_floc_current',                    N'functional_location'),
    (4, N'vw_verification_score',              N'equipment_id'),
    (5, N'vw_verification_by_business_unit',   N'profit_center_name');

DECLARE @d TABLE
(
    column_ordinal   int            NULL,
    name             sysname        NULL,
    system_type_name nvarchar(256)  NULL,
    error_message    nvarchar(4000) NULL
);

SET @i = 1;
SELECT @max = MAX(seq) FROM @views;

WHILE @i <= @max
BEGIN
    SELECT @v = view_name, @key = key_col FROM @views WHERE seq = @i;
    SET @tag = 'C' + CAST(@i AS varchar(2));
    SELECT @ncols = COUNT(*) FROM @exp WHERE view_name = @v;

    BEGIN TRY
        /* .1 exists */
        SET @checks += 1;
        IF OBJECT_ID(N'gold.' + @v, N'V') IS NULL
        BEGIN
            SET @fails += 1;
            PRINT 'FAIL ' + @tag + '.1 gold.' + @v + ' does not exist as a view (a table of that name does not count: the contract says view). Remaining checks for this view skipped.';
        END
        ELSE
        BEGIN
            PRINT 'OK  ' + @tag + '.1 gold.' + @v + ' exists';

            DELETE FROM @d;
            SET @sql = N'SELECT * FROM gold.' + QUOTENAME(@v);
            INSERT INTO @d (column_ordinal, name, system_type_name, error_message)
            SELECT column_ordinal, name, system_type_name, error_message
            FROM sys.dm_exec_describe_first_result_set(@sql, NULL, 0);

            /* .2 every contract column, exact name and exact type */
            SET @checks += 1;
            SET @problems = NULL;
            IF EXISTS (SELECT 1 FROM @d WHERE error_message IS NOT NULL)
            BEGIN
                SELECT TOP (1) @problems = N'SQL Server cannot describe the view: ' + error_message FROM @d WHERE error_message IS NOT NULL;
            END
            ELSE
            BEGIN
                SELECT @problems = STRING_AGG(
                           CAST(x.msg AS nvarchar(max)), N'; ') WITHIN GROUP (ORDER BY x.msg)
                FROM
                (
                    SELECT e.col_name + N': ' +
                           CASE
                               WHEN d.name IS NULL AND ci.name IS NOT NULL
                                   THEN N'misnamed (found "' + ci.name + N'", the contract spells it "' + e.col_name + N'")'
                               WHEN d.name IS NULL
                                   THEN N'missing (contract type ' + e.col_type + N')'
                               ELSE N'type is ' + ISNULL(d.system_type_name, N'?') + N', contract says ' + e.col_type
                           END AS msg
                    FROM @exp AS e
                    LEFT JOIN @d AS d
                           ON d.name COLLATE Latin1_General_BIN2 = e.col_name COLLATE Latin1_General_BIN2
                    LEFT JOIN @d AS ci
                           ON ci.name COLLATE Latin1_General_CI_AS = e.col_name COLLATE Latin1_General_CI_AS
                    WHERE e.view_name = @v
                      AND (d.name IS NULL OR d.system_type_name <> e.col_type)
                ) AS x;
            END

            IF @problems IS NULL
                PRINT 'OK  ' + @tag + '.2 all ' + CAST(@ncols AS varchar(12)) + ' contract columns of gold.' + @v + ' are present with the contract names and types';
            ELSE
            BEGIN
                SET @fails += 1;
                PRINT 'FAIL ' + @tag + '.2 gold.' + @v + ' breaks the contract: ' + LEFT(@problems, 3500);
            END

            /* extra columns: allowed, listed for information */
            SET @extras = NULL;
            SELECT @extras = STRING_AGG(CAST(d.name AS nvarchar(max)), N', ')
            FROM @d AS d
            WHERE d.name IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM @exp AS e
                              WHERE e.view_name = @v
                                AND e.col_name COLLATE Latin1_General_BIN2 = d.name COLLATE Latin1_General_BIN2);
            IF @extras IS NOT NULL
                PRINT 'INFO ' + @tag + '.2 gold.' + @v + ' also has columns that are not in the contract (allowed): ' + LEFT(@extras, 1500);

            /* .3 no (max) columns */
            SET @checks += 1;
            SET @problems = NULL;
            SELECT @problems = STRING_AGG(CAST(d.name + N' ' + d.system_type_name AS nvarchar(max)), N', ')
            FROM @d AS d
            WHERE d.system_type_name LIKE N'%(max)%';
            IF @problems IS NULL
                PRINT 'OK  ' + @tag + '.3 gold.' + @v + ' has no (max) column';
            ELSE
            BEGIN
                SET @fails += 1;
                PRINT 'FAIL ' + @tag + '.3 gold.' + @v + ' exposes (max) columns, which the connector must never see: ' + LEFT(@problems, 3500);
            END

            /* .4 key column present, never NULL, unique */
            SET @checks += 1;
            IF NOT EXISTS (SELECT 1 FROM @d WHERE name COLLATE Latin1_General_BIN2 = @key COLLATE Latin1_General_BIN2)
            BEGIN
                SET @fails += 1;
                PRINT 'FAIL ' + @tag + '.4 key column ' + @key + ' is not a column of gold.' + @v + ' (the connector needs it as the declared key)';
            END
            ELSE
            BEGIN
                SET @sql = N'SELECT @t = COUNT_BIG(*), @dk = COUNT_BIG(DISTINCT ' + QUOTENAME(@key)
                         + N'), @nl = SUM(CASE WHEN ' + QUOTENAME(@key) + N' IS NULL THEN 1 ELSE 0 END) FROM gold.' + QUOTENAME(@v);
                SET @t = NULL; SET @dk = NULL; SET @nl = NULL;
                EXEC sp_executesql @sql,
                     N'@t bigint OUTPUT, @dk bigint OUTPUT, @nl bigint OUTPUT',
                     @t = @t OUTPUT, @dk = @dk OUTPUT, @nl = @nl OUTPUT;
                SET @nl = ISNULL(@nl, 0);

                IF @nl = 0 AND @dk = @t
                    PRINT 'OK  ' + @tag + '.4 key ' + @key + ' of gold.' + @v + ' is never NULL and unique (' + CAST(@t AS varchar(20)) + ' rows)';
                ELSE
                BEGIN
                    SET @fails += 1;
                    PRINT 'FAIL ' + @tag + '.4 key ' + @key + ' of gold.' + @v + ': ' + CAST(@t AS varchar(20)) + ' rows, ' + CAST(@nl AS varchar(20)) + ' NULL, ' + CAST(@dk AS varchar(20)) + ' distinct non-NULL values (must be 0 NULL and distinct = rows)';
                END
                IF @t = 0
                    PRINT 'INFO ' + @tag + '.4 gold.' + @v + ' has no rows (fine before the first load, not fine afterwards)';
            END
        END
    END TRY
    BEGIN CATCH
        SET @fails += 1;
        PRINT 'FAIL ' + @tag + ' gold.' + @v + ' could not be checked, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    END CATCH;

    SET @i += 1;
END

/* ---- reference tables (data engineer, DE-3) -------------------------------- */
BEGIN TRY
    SET @checks += 1;
    IF OBJECT_ID(N'gold.class_characteristic') IS NOT NULL
        PRINT 'OK  R1 gold.class_characteristic exists';
    ELSE IF @require_reference_tables = 1
    BEGIN
        SET @fails += 1;
        PRINT 'FAIL R1 gold.class_characteristic does not exist (@require_reference_tables = 1)';
    END
    ELSE
        PRINT 'INFO R1 gold.class_characteristic not delivered yet (DE-3), skipped';

    SET @checks += 1;
    IF OBJECT_ID(N'gold.ref_heater_allowed_combination') IS NULL
    BEGIN
        IF @require_reference_tables = 1
        BEGIN
            SET @fails += 1;
            PRINT 'FAIL R2 gold.ref_heater_allowed_combination does not exist (@require_reference_tables = 1)';
        END
        ELSE
            PRINT 'INFO R2 gold.ref_heater_allowed_combination not delivered yet (DE-3), skipped';
    END
    ELSE IF COL_LENGTH(N'gold.ref_heater_allowed_combination', N'is_used_in_poc') IS NULL
    BEGIN
        SET @fails += 1;
        PRINT 'FAIL R2 gold.ref_heater_allowed_combination exists but has no column is_used_in_poc (needed to switch off the UNFIRED combinations, PTD-06)';
    END
    ELSE
        PRINT 'OK  R2 gold.ref_heater_allowed_combination exists and has is_used_in_poc';
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL R reference tables could not be checked, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

IF @fails = 0
    PRINT 't_gold_contract RESULT: ALL ' + CAST(@checks AS varchar(12)) + ' CHECKS PASS';
ELSE
    PRINT 't_gold_contract RESULT: ' + CAST(@fails AS varchar(12)) + ' CHECK(S) FAILED';
