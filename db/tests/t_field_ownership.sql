/* =====================================================================
   t_field_ownership.sql     APP-2 test: app.vw_field_ownership
   Needs : migrations 0001-0007, seeds 0101-0107, procs fn_group_for_role and
           usp_route_resolve, view vw_field_ownership.
   Reads only. Needs no local seed (no people) and leaves nothing behind.
   Final line: `t_field_ownership RESULT: ...`

   Checks
     O1  the view exists, has exactly the 7 columns of 09 section 9 with the right types,
         and no (max) column
     O2  one row per active catalogue field, key unique, never NULL (reported as not nullable)
     O3  every catalogue field has a route (the wildcard routes of REF-46 cover all 13)
     O4  the view agrees with app.usp_route_resolve for every field: same route and the
         same two roles (the procedure is asked without a class, as the view assumes)
     O5  two known answers: HEAT_DUTY is answered first by Operations-IOC (the alias
         "Operations-IOC - NMD" resolved) and signed off by SAPBusinessSupport; the FLOC
         field FLOC_CLASS also resolves (FLOC wildcard route)
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL t_field_ownership wrong editor: connected to "' + DB_NAME() + '". Open the item named ATLAS_SQL_DB whose type is SQL database. Nothing was run.';
    RETURN;
END
IF OBJECT_ID(N'app.vw_field_ownership', N'V') IS NULL OR OBJECT_ID(N'app.usp_route_resolve', N'P') IS NULL
BEGIN
    PRINT 'FAIL t_field_ownership app.vw_field_ownership or app.usp_route_resolve is missing: run the APP-2 views stage (and the APP-1 procs) first. Nothing was run.';
    RETURN;
END
IF (SELECT COUNT(*) FROM app.field_catalog) = 0 OR (SELECT COUNT(*) FROM app.approval_route) = 0
BEGIN
    PRINT 'FAIL t_field_ownership the catalogue or the routes are not loaded: run seeds 0103 and 0106 first. Nothing was run.';
    RETURN;
END

DECLARE @checks int = 0, @fails int = 0;
DECLARE @n int, @n2 int, @problems nvarchar(2000), @nullable varchar(10);

/* ---- O1 columns and types -------------------------------------------------- */
DECLARE @exp TABLE (col_name sysname NOT NULL PRIMARY KEY, col_type nvarchar(40) NOT NULL);
INSERT INTO @exp (col_name, col_type) VALUES
    (N'field_ownership_key', N'nvarchar(80)'),
    (N'entity_type',         N'nvarchar(10)'),
    (N'field_code',          N'nvarchar(64)'),
    (N'label',               N'nvarchar(100)'),
    (N'responsible_role',    N'nvarchar(64)'),
    (N'accountable_role',    N'nvarchar(64)'),
    (N'route_id',            N'int');

DECLARE @d TABLE (column_ordinal int NULL, name sysname NULL, system_type_name nvarchar(256) NULL, is_nullable bit NULL, error_message nvarchar(4000) NULL);

BEGIN TRY
    INSERT INTO @d (column_ordinal, name, system_type_name, is_nullable, error_message)
    SELECT column_ordinal, name, system_type_name, is_nullable, error_message
    FROM sys.dm_exec_describe_first_result_set(N'SELECT * FROM app.vw_field_ownership', NULL, 0);

    SET @checks += 1;
    SET @problems = NULL;
    IF EXISTS (SELECT 1 FROM @d WHERE error_message IS NOT NULL)
        SELECT TOP (1) @problems = N'SQL Server cannot describe the view: ' + error_message FROM @d WHERE error_message IS NOT NULL;
    ELSE
        SELECT @problems = STRING_AGG(CAST(x.msg AS nvarchar(max)), N'; ')
        FROM
        (
            SELECT e.col_name + N': ' + CASE WHEN d.name IS NULL THEN N'missing' ELSE N'type is ' + ISNULL(d.system_type_name, N'?') + N', expected ' + e.col_type END AS msg
            FROM @exp AS e
            LEFT JOIN @d AS d ON d.name COLLATE Latin1_General_BIN2 = e.col_name COLLATE Latin1_General_BIN2
            WHERE d.name IS NULL OR d.system_type_name <> e.col_type
            UNION ALL
            SELECT d.name + N': not in 09 section 9' FROM @d AS d
            WHERE NOT EXISTS (SELECT 1 FROM @exp AS e WHERE e.col_name COLLATE Latin1_General_BIN2 = d.name COLLATE Latin1_General_BIN2)
        ) AS x;
    IF @problems IS NULL PRINT 'OK  O1 vw_field_ownership has exactly the 7 columns of 09 section 9, with the right types';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL O1 columns: ' + LEFT(@problems, 1500); END

    SET @checks += 1;
    SELECT @n = COUNT(*) FROM @d WHERE system_type_name LIKE N'%(max)%';
    IF @n = 0 PRINT 'OK  O1 no (max) column (the connector needs explicit lengths)';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL O1 the view exposes ' + CAST(@n AS varchar(10)) + ' (max) column(s)'; END

    SET @checks += 1;
    SELECT @n = COUNT(*) FROM @d WHERE name = N'field_ownership_key' AND is_nullable = 0;
    IF @n = 1 PRINT 'OK  O1 the key field_ownership_key is reported as not nullable (a declared key must not be)';
    ELSE
    BEGIN
        SET @fails += 1;
        SELECT @nullable = CAST(is_nullable AS varchar(3)) FROM @d WHERE name = N'field_ownership_key';
        PRINT 'FAIL O1 field_ownership_key is reported as nullable or is missing (is_nullable = ' + ISNULL(@nullable, 'column not found') + ')';
    END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL O1 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- O2 one row per active catalogue field ---------------------------------- */
BEGIN TRY
    SET @checks += 1;
    SELECT @n = COUNT(*) FROM app.field_catalog WHERE is_active = 1;
    SELECT @n2 = COUNT(*) FROM app.vw_field_ownership;
    IF @n = @n2 PRINT 'OK  O2 one row per active catalogue field: ' + CAST(@n2 AS varchar(10)) + ' of ' + CAST(@n AS varchar(10));
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL O2 the view has ' + CAST(@n2 AS varchar(10)) + ' rows, the catalogue has ' + CAST(@n AS varchar(10)) + ' active fields'; END

    SET @checks += 1;
    SELECT @n = COUNT(DISTINCT field_ownership_key), @n2 = COUNT(*) FROM app.vw_field_ownership;
    IF @n = @n2 AND NOT EXISTS (SELECT 1 FROM app.vw_field_ownership WHERE field_ownership_key = N'')
        PRINT 'OK  O2 the key is unique and never empty';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL O2 the key is not unique or has an empty value (' + CAST(@n AS varchar(10)) + ' distinct of ' + CAST(@n2 AS varchar(10)) + ')'; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL O2 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- O3 every field has a route --------------------------------------------- */
BEGIN TRY
    SET @checks += 1;
    SELECT @n = COUNT(*) FROM app.vw_field_ownership WHERE route_id IS NULL OR responsible_role IS NULL OR accountable_role IS NULL;
    IF @n = 0 PRINT 'OK  O3 every catalogue field has a route and two roles';
    ELSE
    BEGIN
        SET @problems = NULL;
        SELECT @problems = STRING_AGG(field_code, N', ') FROM app.vw_field_ownership WHERE route_id IS NULL OR responsible_role IS NULL OR accountable_role IS NULL;
        SET @fails += 1;
        PRINT 'FAIL O3 ' + CAST(@n AS varchar(10)) + ' field(s) have no route or no role: ' + LEFT(@problems, 1500);
    END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL O3 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- O4 agreement with app.usp_route_resolve -------------------------------- */
CREATE TABLE #r
(
    route_id int NULL, route_used nvarchar(12) NOT NULL,
    responsible_role nvarchar(64) NULL, responsible_group nvarchar(64) NOT NULL,
    accountable_role nvarchar(64) NULL, accountable_group nvarchar(64) NOT NULL
);

DECLARE @entity nvarchar(10), @field nvarchar(64), @v_route int, @v_resp nvarchar(64), @v_acc nvarchar(64);
DECLARE @p_route int, @p_resp nvarchar(64), @p_acc nvarchar(64), @bad nvarchar(400), @compared int = 0;

DECLARE f_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT entity_type, field_code, route_id, responsible_role, accountable_role FROM app.vw_field_ownership ORDER BY field_code;
OPEN f_cursor;
FETCH NEXT FROM f_cursor INTO @entity, @field, @v_route, @v_resp, @v_acc;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @checks += 1;
    BEGIN TRY
        DELETE FROM #r;
        INSERT INTO #r (route_id, route_used, responsible_role, responsible_group, accountable_role, accountable_group)
        EXEC app.usp_route_resolve @entity_type = @entity, @request_action = N'UPDATE', @profit_center_name = N'OP RES MB', @field_code = @field, @class_code = NULL;
        SELECT @p_route = route_id, @p_resp = responsible_role, @p_acc = accountable_role FROM #r;

        SET @bad = NULL;
        IF ISNULL(@p_route, -1) <> ISNULL(@v_route, -1) SET @bad = N'route ' + ISNULL(CAST(@v_route AS nvarchar(12)), N'NULL') + N' in the view, ' + ISNULL(CAST(@p_route AS nvarchar(12)), N'NULL') + N' from the procedure';
        ELSE IF ISNULL(@p_resp, N'') <> ISNULL(@v_resp, N'') SET @bad = N'responsible role ' + ISNULL(@v_resp, N'NULL') + N' in the view, ' + ISNULL(@p_resp, N'NULL') + N' from the procedure';
        ELSE IF ISNULL(@p_acc, N'') <> ISNULL(@v_acc, N'') SET @bad = N'accountable role ' + ISNULL(@v_acc, N'NULL') + N' in the view, ' + ISNULL(@p_acc, N'NULL') + N' from the procedure';

        IF @bad IS NULL SET @compared += 1;
        ELSE BEGIN SET @fails += 1; PRINT 'FAIL O4 ' + @field + ': ' + @bad; END
    END TRY
    BEGIN CATCH
        SET @fails += 1;
        PRINT 'FAIL O4 ' + @field + ': error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    END CATCH;
    FETCH NEXT FROM f_cursor INTO @entity, @field, @v_route, @v_resp, @v_acc;
END
CLOSE f_cursor;
DEALLOCATE f_cursor;
DROP TABLE #r;
PRINT 'INFO O4 fields where the view and app.usp_route_resolve agree: ' + CAST(@compared AS varchar(10));

/* ---- O5 two known answers (REF-46 wildcard routes) -------------------------- */
BEGIN TRY
    SET @checks += 1;
    SELECT @n = COUNT(*) FROM app.vw_field_ownership
    WHERE field_code = N'HEAT_DUTY' AND responsible_role = N'Operations-IOC' AND accountable_role = N'SAPBusinessSupport';
    IF @n = 1 PRINT 'OK  O5 HEAT_DUTY: first answer Operations-IOC (alias resolved), sign-off SAPBusinessSupport';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL O5 HEAT_DUTY is not Operations-IOC / SAPBusinessSupport (alias "Operations-IOC - NMD" not resolved, or the wildcard route changed)'; END

    SET @checks += 1;
    SELECT @n = COUNT(*) FROM app.vw_field_ownership
    WHERE field_code = N'FLOC_CLASS' AND entity_type = N'FLOC' AND route_id IS NOT NULL AND accountable_role = N'SAPBusinessSupport';
    IF @n = 1 PRINT 'OK  O5 FLOC_CLASS (a FLOC field) resolves through the FLOC wildcard route';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL O5 FLOC_CLASS does not resolve to the FLOC wildcard route with SAPBusinessSupport'; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL O5 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

IF @fails = 0 PRINT 't_field_ownership RESULT: ALL ' + CAST(@checks AS varchar(10)) + ' CHECKS PASS';
ELSE PRINT 't_field_ownership RESULT: ' + CAST(@fails AS varchar(10)) + ' OF ' + CAST(@checks AS varchar(10)) + ' CHECK(S) FAILED';
