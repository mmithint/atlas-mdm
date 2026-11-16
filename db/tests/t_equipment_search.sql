/* =====================================================================
   t_equipment_search.sql    APP-2 test: app.vw_equipment_search
   Needs : migrations 0001-0007, seeds 0101-0107, the gold views (the synthetic stub
           db/dev/gold_stub.sql or the data engineer's real views) and the view
           app.vw_equipment_search.
   Inserts three synthetic change requests inside a transaction and ROLLS THEM BACK, so
   nothing is left behind (if app.change_request was empty before, the request-id counter
   is reset to 0 afterwards, so the first real request is still CR-000001).
   Final line: `t_equipment_search RESULT: ...`

   Checks
     E1  the view exists and carries the 26 columns of gold.vw_equipment_current (same
         names, same types) plus open_request_count int, invalid_rule_count int,
         verification_pct decimal(5,2); no (max) column; equipment_id is reported as not
         nullable (the connector's declared key)
     E2  one row per heater: as many rows as gold.vw_equipment_current, equipment_id unique
         (a join that multiplied rows would show here)
     E3  open_request_count: an open request on a heater counts, a closed one does not, an
         open request on the heater's FLOC counts   (synthetic heaters only)
     E4  verification_pct equals gold.vw_verification_score   (synthetic heaters only)
     E5  invalid_rule_count is still NULL for every heater (APP-5 replaces this check when
         the rules engine fills it)
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL t_equipment_search wrong editor: connected to "' + DB_NAME() + '". Open the item named ATLAS_SQL_DB whose type is SQL database. Nothing was run.';
    RETURN;
END
IF OBJECT_ID(N'app.vw_equipment_search', N'V') IS NULL
BEGIN
    PRINT 'FAIL t_equipment_search app.vw_equipment_search is missing: run the APP-2 views stage first. Nothing was run.';
    RETURN;
END
IF OBJECT_ID(N'gold.vw_equipment_current', N'V') IS NULL OR OBJECT_ID(N'gold.vw_verification_score', N'V') IS NULL OR OBJECT_ID(N'app.change_request', N'U') IS NULL
BEGIN
    PRINT 'FAIL t_equipment_search a gold view or app.change_request is missing: run the gold stub (or the real gold) and the migrations first. Nothing was run.';
    RETURN;
END

DECLARE @checks int = 0, @fails int = 0;
DECLARE @n int, @n2 int, @problems nvarchar(2000);

DECLARE @g TABLE (column_ordinal int NULL, name sysname NULL, system_type_name nvarchar(256) NULL, is_nullable bit NULL, error_message nvarchar(4000) NULL);
DECLARE @s TABLE (column_ordinal int NULL, name sysname NULL, system_type_name nvarchar(256) NULL, is_nullable bit NULL, error_message nvarchar(4000) NULL);

/* ---- E1 columns and types --------------------------------------------------- */
BEGIN TRY
    INSERT INTO @g (column_ordinal, name, system_type_name, is_nullable, error_message)
    SELECT column_ordinal, name, system_type_name, is_nullable, error_message
    FROM sys.dm_exec_describe_first_result_set(N'SELECT * FROM gold.vw_equipment_current', NULL, 0);
    INSERT INTO @s (column_ordinal, name, system_type_name, is_nullable, error_message)
    SELECT column_ordinal, name, system_type_name, is_nullable, error_message
    FROM sys.dm_exec_describe_first_result_set(N'SELECT * FROM app.vw_equipment_search', NULL, 0);

    SET @checks += 1;
    SET @problems = NULL;
    IF EXISTS (SELECT 1 FROM @s WHERE error_message IS NOT NULL) OR EXISTS (SELECT 1 FROM @g WHERE error_message IS NOT NULL)
        SELECT TOP (1) @problems = N'SQL Server cannot describe a view: ' + error_message FROM (SELECT error_message FROM @s UNION ALL SELECT error_message FROM @g) AS m WHERE error_message IS NOT NULL;
    ELSE
        SELECT @problems = STRING_AGG(CAST(x.msg AS nvarchar(max)), N'; ')
        FROM
        (
            -- every gold contract column must be in the search view, same type, same place
            SELECT g.name + N': ' + CASE WHEN s.name IS NULL THEN N'missing from the search view'
                                         WHEN s.system_type_name <> g.system_type_name THEN N'type ' + s.system_type_name + N' in the search view, ' + g.system_type_name + N' in gold'
                                         ELSE N'position ' + CAST(s.column_ordinal AS nvarchar(10)) + N' in the search view, ' + CAST(g.column_ordinal AS nvarchar(10)) + N' in gold' END AS msg
            FROM @g AS g
            LEFT JOIN @s AS s ON s.name COLLATE Latin1_General_BIN2 = g.name COLLATE Latin1_General_BIN2
            WHERE g.name IN (N'equipment_id', N'equipment_number', N'equipment_description', N'functional_location', N'floc_description',
                             N'superior_functional_location', N'equipment_tag_number', N'equip_class', N'class_type', N'object_type',
                             N'floc_class', N'tech_object_type', N'manufacturer', N'model_number', N'manufacturer_serial_number',
                             N'fired_unfired', N'heat_duty_mmbtu_hr', N'heat_duty_source', N'equipment_user_status', N'floc_user_status',
                             N'profit_center_name', N'planner_group', N'heater_population_method', N'golden_version_id',
                             N'last_changed_at_utc', N'baseline_as_of_utc')
              AND (s.name IS NULL OR s.system_type_name <> g.system_type_name OR s.column_ordinal <> g.column_ordinal)
            UNION ALL
            -- the three counters
            SELECT c.col_name + N': ' + CASE WHEN s.name IS NULL THEN N'missing' ELSE N'type is ' + s.system_type_name + N', expected ' + c.col_type END
            FROM (VALUES (N'open_request_count', N'int'), (N'invalid_rule_count', N'int'), (N'verification_pct', N'decimal(5,2)')) AS c (col_name, col_type)
            LEFT JOIN @s AS s ON s.name COLLATE Latin1_General_BIN2 = c.col_name COLLATE Latin1_General_BIN2
            WHERE s.name IS NULL OR s.system_type_name <> c.col_type
        ) AS x;
    IF @problems IS NULL PRINT 'OK  E1 the search view has the 26 gold columns (same names, types, order) and the 3 counters with the right types';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL E1 columns: ' + LEFT(@problems, 1500); END

    SET @checks += 1;
    SELECT @n = COUNT(*) FROM @s WHERE column_ordinal IS NOT NULL;
    IF @n = 29 PRINT 'OK  E1 exactly 29 columns (26 + 3)';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL E1 the search view has ' + CAST(@n AS varchar(10)) + ' columns, expected 29 (09 section 9)'; END

    SET @checks += 1;
    SELECT @n = COUNT(*) FROM @s WHERE system_type_name LIKE N'%(max)%';
    IF @n = 0 PRINT 'OK  E1 no (max) column (the connector needs explicit lengths)';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL E1 the view exposes ' + CAST(@n AS varchar(10)) + ' (max) column(s)'; END

    SET @checks += 1;
    SELECT @n = COUNT(*) FROM @s WHERE name = N'equipment_id' AND is_nullable = 0;
    IF @n = 1 PRINT 'OK  E1 the key equipment_id is reported as not nullable (a declared key must not be)';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL E1 equipment_id is reported as nullable or is missing'; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL E1 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- E2 one row per heater --------------------------------------------------- */
BEGIN TRY
    SET @checks += 1;
    SELECT @n = COUNT(*) FROM gold.vw_equipment_current;
    SELECT @n2 = COUNT(*) FROM app.vw_equipment_search;
    IF @n = @n2 PRINT 'OK  E2 as many rows as gold.vw_equipment_current: ' + CAST(@n2 AS varchar(10));
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL E2 the search view has ' + CAST(@n2 AS varchar(10)) + ' rows, gold.vw_equipment_current has ' + CAST(@n AS varchar(10)) + ' (a join multiplied or dropped rows)'; END

    SET @checks += 1;
    SELECT @n = COUNT(DISTINCT equipment_id) FROM app.vw_equipment_search;
    IF @n = @n2 PRINT 'OK  E2 equipment_id is unique';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL E2 equipment_id has ' + CAST(@n AS varchar(10)) + ' distinct values in ' + CAST(@n2 AS varchar(10)) + ' rows'; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL E2 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- E3 open_request_count (synthetic heaters only) -------------------------- */
DECLARE @idA int, @idB int, @flocB nvarchar(40), @baseA int, @baseB int, @gotA int, @gotB int, @was_empty bit;

SELECT @idA = equipment_id FROM gold.vw_equipment_current WHERE equipment_number = N'SYN-EQ-0004';
SELECT @idB = equipment_id, @flocB = functional_location FROM gold.vw_equipment_current WHERE equipment_number = N'SYN-EQ-0005';

IF @idA IS NULL OR @idB IS NULL
    PRINT 'INFO E3 the synthetic heaters SYN-EQ-0004 and SYN-EQ-0005 are not in gold (the real gold is loaded): the request-counter check is skipped. Re-create the stub or test counters with real requests after APP-3.';
ELSE
BEGIN
    BEGIN TRY
        SET @checks += 1;
        SELECT @baseA = open_request_count FROM app.vw_equipment_search WHERE equipment_id = @idA;
        SELECT @baseB = open_request_count FROM app.vw_equipment_search WHERE equipment_id = @idB;
        SET @was_empty = CASE WHEN EXISTS (SELECT 1 FROM app.change_request) THEN 0 ELSE 1 END;

        BEGIN TRANSACTION;

        -- 1: an open request on heater A
        INSERT INTO app.change_request
            (entity_type, equipment_id, equipment_number, functional_location, profit_center_name, source_type, field_code,
             old_value, new_value, reason, requested_by, request_status, responsible_group, accountable_group, deduplication_key)
        VALUES
            (N'EQUIPMENT', @idA, N'SYN-EQ-0004', N'SYN-FL-0004', N'ROCKIES-PRB', N'MANUAL', N'HEAT_DUTY',
             N'1.5000', N'1.7500', N'SYNTHETIC test request (t_equipment_search)', N'test.person@example.test', N'PENDING_RESPONSIBLE',
             N'Operations-IOC-Platteville', N'SAPBusinessSupport', REPLICATE(N'1', 64));
        -- 2: a closed (approved) request on heater A: must not count
        INSERT INTO app.change_request
            (entity_type, equipment_id, equipment_number, functional_location, profit_center_name, source_type, field_code,
             old_value, new_value, reason, requested_by, request_status, responsible_group, accountable_group, deduplication_key)
        VALUES
            (N'EQUIPMENT', @idA, N'SYN-EQ-0004', N'SYN-FL-0004', N'ROCKIES-PRB', N'MANUAL', N'HEAT_DUTY',
             N'1.2500', N'1.5000', N'SYNTHETIC test request (t_equipment_search)', N'test.person@example.test', N'APPROVED',
             N'Operations-IOC-Platteville', N'SAPBusinessSupport', REPLICATE(N'3', 64));
        -- 3: an open request on the FLOC of heater B (no equipment id): counts for B
        INSERT INTO app.change_request
            (entity_type, equipment_id, equipment_number, functional_location, profit_center_name, source_type, field_code,
             old_value, new_value, reason, requested_by, request_status, responsible_group, accountable_group, deduplication_key)
        VALUES
            (N'FLOC', NULL, NULL, @flocB, N'ROCKIES-PRB', N'MANUAL', N'FLOC_CLASS',
             N'VESSEL_HEATER_TRTR', N'HEATER', N'SYNTHETIC test request (t_equipment_search)', N'test.person@example.test', N'PENDING_RESPONSIBLE',
             N'Operations-IOC-Platteville', N'SAPBusinessSupport', REPLICATE(N'2', 64));

        SELECT @gotA = open_request_count FROM app.vw_equipment_search WHERE equipment_id = @idA;
        SELECT @gotB = open_request_count FROM app.vw_equipment_search WHERE equipment_id = @idB;

        ROLLBACK TRANSACTION;

        IF @gotA = @baseA + 1 AND @gotB = @baseB + 1
            PRINT 'OK  E3 open_request_count: an open request counts (heater A ' + CAST(@baseA AS varchar(10)) + ' -> ' + CAST(@gotA AS varchar(10)) + '), a closed one does not, an open request on the FLOC counts (heater B ' + CAST(@baseB AS varchar(10)) + ' -> ' + CAST(@gotB AS varchar(10)) + ')';
        ELSE
        BEGIN
            SET @fails += 1;
            PRINT 'FAIL E3 open_request_count: heater A ' + CAST(@baseA AS varchar(10)) + ' -> ' + CAST(@gotA AS varchar(10)) + ' (expected +1), heater B ' + CAST(@baseB AS varchar(10)) + ' -> ' + CAST(@gotB AS varchar(10)) + ' (expected +1)';
        END

        IF @was_empty = 1
        BEGIN
            BEGIN TRY
                DBCC CHECKIDENT (N'app.change_request', RESEED, 0) WITH NO_INFOMSGS;
            END TRY
            BEGIN CATCH
                PRINT 'INFO E3 could not reset the request-id counter (error ' + CAST(ERROR_NUMBER() AS varchar(12)) + '); the next real request may not be CR-000001.';
            END CATCH;
        END
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @fails += 1;
        PRINT 'FAIL E3 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE() + ' (the transaction was rolled back)';
    END CATCH;
END

/* ---- E4 verification_pct (synthetic heaters only) ---------------------------- */
BEGIN TRY
    IF @idA IS NULL OR @idB IS NULL
        PRINT 'INFO E4 synthetic heaters not found: the verification check is skipped';
    ELSE
    BEGIN
        SET @checks += 1;
        SELECT @n = COUNT(*)
        FROM app.vw_equipment_search AS s
        JOIN gold.vw_verification_score AS v ON v.equipment_id = s.equipment_id
        WHERE s.equipment_id IN (@idA, @idB) AND s.verification_pct = v.verification_pct;
        IF @n = 2 PRINT 'OK  E4 verification_pct equals gold.vw_verification_score for the two sample heaters';
        ELSE BEGIN SET @fails += 1; PRINT 'FAIL E4 verification_pct differs from gold.vw_verification_score for a sample heater (matches: ' + CAST(@n AS varchar(10)) + ' of 2)'; END
    END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL E4 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- E5 invalid_rule_count is not computed yet -------------------------------- */
BEGIN TRY
    SET @checks += 1;
    SELECT @n = COUNT(*) FROM app.vw_equipment_search WHERE invalid_rule_count IS NOT NULL;
    IF @n = 0 PRINT 'OK  E5 invalid_rule_count is NULL for every heater (APP-5 fills it; this check is replaced then)';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL E5 ' + CAST(@n AS varchar(10)) + ' heater(s) have an invalid_rule_count: if APP-5 has delivered the real count, update this check'; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL E5 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

IF @fails = 0 PRINT 't_equipment_search RESULT: ALL ' + CAST(@checks AS varchar(10)) + ' CHECKS PASS';
ELSE PRINT 't_equipment_search RESULT: ' + CAST(@fails AS varchar(10)) + ' OF ' + CAST(@checks AS varchar(10)) + ' CHECK(S) FAILED';
