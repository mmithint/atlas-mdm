/* =====================================================================
   t_route_resolve.sql       APP-1 test: who approves what (app.usp_route_resolve)
   Needs : migrations 0001-0007, seeds 0101-0105, procs fn_group_for_role,
           usp_route_resolve, views vw_route_check and vw_group_member_count.
   Reads only. Needs no local seed (no people) and leaves nothing behind.
   Final line: `t_route_resolve RESULT: ...`

   Cases: one per Operations-IOC region (all ten profit centres), a PSV class, a
   pump class, the OEM_BSFC field route, precedence (field beats class), FLOC routes,
   the alias "Operations-IOC - NMD", no route at all, and an unknown profit centre.
   Expected groups follow REF-46 [REF-46:L0211-L0223, L0235-L0245].
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL t_route_resolve wrong editor: connected to "' + DB_NAME() + '". Open the item named ATLAS_SQL_DB whose type is SQL database. Nothing was run.';
    RETURN;
END
IF OBJECT_ID(N'app.usp_route_resolve', N'P') IS NULL OR OBJECT_ID(N'app.fn_group_for_role') IS NULL
   OR OBJECT_ID(N'app.vw_route_check', N'V') IS NULL OR OBJECT_ID(N'app.vw_group_member_count', N'V') IS NULL
BEGIN
    PRINT 'FAIL t_route_resolve a procedure, function or view is missing: run the procs and views stage first. Nothing was run.';
    RETURN;
END
IF (SELECT COUNT(*) FROM app.approval_route) = 0 OR (SELECT COUNT(*) FROM app.principal_role_assignment WHERE principal_type = N'GROUP') = 0
BEGIN
    PRINT 'FAIL t_route_resolve the routes or assignments are not loaded: run seeds 0101-0105 first. Nothing was run.';
    RETURN;
END

DECLARE @checks int = 0, @fails int = 0;

CREATE TABLE #r
(
    route_id int NULL, route_used nvarchar(12) NOT NULL,
    responsible_role nvarchar(64) NULL, responsible_group nvarchar(64) NOT NULL,
    accountable_role nvarchar(64) NULL, accountable_group nvarchar(64) NOT NULL
);

CREATE TABLE #cases
(
    id int NOT NULL, label nvarchar(80) NOT NULL,
    entity nvarchar(10) NOT NULL, act nvarchar(10) NOT NULL, pc nvarchar(40) NOT NULL,
    field nvarchar(64) NULL, class nvarchar(30) NULL,
    exp_used nvarchar(12) NOT NULL, exp_resp_role nvarchar(64) NULL,
    exp_resp nvarchar(64) NOT NULL, exp_acc nvarchar(64) NOT NULL
);

INSERT INTO #cases (id, label, entity, act, pc, field, class, exp_used, exp_resp_role, exp_resp, exp_acc) VALUES
 (1,  N'Carlsbad: OP RES DB NM, heater (alias resolved)', N'EQUIPMENT', N'UPDATE', N'OP RES DB NM',        N'FIRED_UNFIRED', N'HEATER', N'WILDCARD', N'Operations-IOC', N'Operations-IOC-Carlsbad',   N'SAPBusinessSupport'),
 (2,  N'Midland: OP RES MB',                              N'EQUIPMENT', N'UPDATE', N'OP RES MB',           N'HEAT_DUTY',     N'HEATER', N'WILDCARD', NULL,             N'Operations-IOC-Midland',    N'SAPBusinessSupport'),
 (3,  N'Midland: OP RES DB TX',                           N'EQUIPMENT', N'UPDATE', N'OP RES DB TX',        N'HEAT_DUTY',     N'HEATER', N'WILDCARD', NULL,             N'Operations-IOC-Midland',    N'SAPBusinessSupport'),
 (4,  N'Midland: OP RES MB CROWNROCK',                    N'EQUIPMENT', N'UPDATE', N'OP RES MB CROWNROCK', N'HEAT_DUTY',     N'HEATER', N'WILDCARD', NULL,             N'Operations-IOC-Midland',    N'SAPBusinessSupport'),
 (5,  N'DenverCity: OP EOR',                              N'EQUIPMENT', N'UPDATE', N'OP EOR',              N'HEAT_DUTY',     N'HEATER', N'WILDCARD', NULL,             N'Operations-IOC-DenverCity', N'SAPBusinessSupport'),
 (6,  N'DenverCity: OP EOR GAS PLANT',                    N'EQUIPMENT', N'UPDATE', N'OP EOR GAS PLANT',    N'HEAT_DUTY',     N'HEATER', N'WILDCARD', NULL,             N'Operations-IOC-DenverCity', N'SAPBusinessSupport'),
 (7,  N'DenverCity: OP EOR CO2 OPS',                      N'EQUIPMENT', N'UPDATE', N'OP EOR CO2 OPS',      N'HEAT_DUTY',     N'HEATER', N'WILDCARD', NULL,             N'Operations-IOC-DenverCity', N'SAPBusinessSupport'),
 (8,  N'Platteville: ROCKIES-DJ BASIN',                   N'EQUIPMENT', N'UPDATE', N'ROCKIES-DJ BASIN',    N'HEAT_DUTY',     N'HEATER', N'WILDCARD', NULL,             N'Operations-IOC-Platteville', N'SAPBusinessSupport'),
 (9,  N'Platteville: ROCKIES-OTHER',                      N'EQUIPMENT', N'UPDATE', N'ROCKIES-OTHER',       N'HEAT_DUTY',     N'HEATER', N'WILDCARD', NULL,             N'Operations-IOC-Platteville', N'SAPBusinessSupport'),
 (10, N'Platteville: ROCKIES-PRB',                        N'EQUIPMENT', N'UPDATE', N'ROCKIES-PRB',         N'HEAT_DUTY',     N'HEATER', N'WILDCARD', NULL,             N'Operations-IOC-Platteville', N'SAPBusinessSupport'),
 (11, N'PSV class (equipment): asset integrity',          N'EQUIPMENT', N'UPDATE', N'OP RES DB NM',        N'MODEL_NUMBER',  N'PRDV_PRV',        N'CLASS', N'AssetIntegrity',             N'AssetIntegrity',            N'SAPBusinessSupport'),
 (12, N'Pump class (equipment): reliability',             N'EQUIPMENT', N'UPDATE', N'OP EOR',              N'MODEL_NUMBER',  N'PUMP_CENTRIF',    N'CLASS', N'ReliabilityandMaintenance',  N'ReliabilityandMaintenance', N'SAPBusinessSupport'),
 (13, N'OEM_BSFC field route: air quality accountable',   N'EQUIPMENT', N'UPDATE', N'OP RES DB NM',        N'OEM_BSFC',      N'HEATER',          N'FIELD', N'ReliabilityandMaintenance',  N'ReliabilityandMaintenance', N'AirQuality - RES'),
 (14, N'Precedence: field route beats class route',       N'EQUIPMENT', N'UPDATE', N'ROCKIES-PRB',         N'OEM_BSFC',      N'PUMP_CENTRIF',    N'FIELD', NULL,                          N'ReliabilityandMaintenance', N'AirQuality - RK'),
 (15, N'FLOC update, wildcard route',                     N'FLOC',      N'UPDATE', N'ROCKIES-DJ BASIN',    N'FLOC_CLASS',    N'VESSEL_HEATER_TRTR', N'WILDCARD', NULL,                       N'Operations-IOC-Platteville', N'SAPBusinessSupport'),
 (16, N'FLOC update, PSV class',                          N'FLOC',      N'UPDATE', N'OP EOR GAS PLANT',    N'FLOC_CLASS',    N'PRDV',            N'CLASS', NULL,                          N'AssetIntegrity',            N'SAPBusinessSupport'),
 (17, N'Equipment CREATE, heater',                        N'EQUIPMENT', N'CREATE', N'OP RES DB NM',        NULL,             N'HEATER',          N'WILDCARD', NULL,                       N'Operations-IOC-Carlsbad',   N'SAPBusinessSupport'),
 (18, N'No field and no class (new characteristic)',      N'EQUIPMENT', N'UPDATE', N'OP RES MB',           NULL,             NULL,               N'WILDCARD', NULL,                       N'Operations-IOC-Midland',    N'SAPBusinessSupport'),
 (19, N'No route exists (action DELETE)',                 N'EQUIPMENT', N'DELETE', N'OP RES MB',           N'HEAT_DUTY',     N'HEATER',          N'NONE',     NULL,                       N'UNROUTED',                  N'UNROUTED'),
 (20, N'Unknown profit centre: route found, no group',    N'EQUIPMENT', N'UPDATE', N'NOWHERE',             N'HEAT_DUTY',     N'HEATER',          N'WILDCARD', NULL,                       N'UNROUTED',                  N'UNROUTED');

DECLARE @id int, @label nvarchar(80), @entity nvarchar(10), @act nvarchar(10), @pc nvarchar(40), @field nvarchar(64), @class nvarchar(30),
        @exp_used nvarchar(12), @exp_resp_role nvarchar(64), @exp_resp nvarchar(64), @exp_acc nvarchar(64);
DECLARE @got_used nvarchar(12), @got_resp_role nvarchar(64), @got_resp nvarchar(64), @got_acc nvarchar(64), @rows int, @bad nvarchar(400);

DECLARE case_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT id, label, entity, act, pc, field, class, exp_used, exp_resp_role, exp_resp, exp_acc FROM #cases ORDER BY id;
OPEN case_cursor;
FETCH NEXT FROM case_cursor INTO @id, @label, @entity, @act, @pc, @field, @class, @exp_used, @exp_resp_role, @exp_resp, @exp_acc;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @checks += 1;
    BEGIN TRY
        DELETE FROM #r;
        INSERT INTO #r (route_id, route_used, responsible_role, responsible_group, accountable_role, accountable_group)
        EXEC app.usp_route_resolve @entity_type = @entity, @request_action = @act, @profit_center_name = @pc, @field_code = @field, @class_code = @class;

        SELECT @rows = COUNT(*) FROM #r;
        SELECT @got_used = route_used, @got_resp_role = responsible_role, @got_resp = responsible_group, @got_acc = accountable_group FROM #r;
        SET @bad = NULL;
        IF @rows <> 1 SET @bad = N'returned ' + CAST(@rows AS nvarchar(10)) + N' rows, expected exactly 1';
        ELSE IF @got_used <> @exp_used SET @bad = N'route_used ' + @got_used + N', expected ' + @exp_used;
        ELSE IF @got_resp <> @exp_resp SET @bad = N'responsible_group ' + @got_resp + N', expected ' + @exp_resp;
        ELSE IF @got_acc <> @exp_acc SET @bad = N'accountable_group ' + @got_acc + N', expected ' + @exp_acc;
        ELSE IF @exp_resp_role IS NOT NULL AND ISNULL(@got_resp_role, N'') <> @exp_resp_role
            SET @bad = N'responsible_role ' + ISNULL(@got_resp_role, N'NULL') + N', expected ' + @exp_resp_role + N' (alias not resolved?)';

        IF @bad IS NULL
            PRINT 'OK  case ' + CAST(@id AS varchar(10)) + ' ' + @label + ': ' + @got_used + ' -> ' + @got_resp + ' / ' + @got_acc;
        ELSE
        BEGIN
            SET @fails += 1;
            PRINT 'FAIL case ' + CAST(@id AS varchar(10)) + ' ' + @label + ': ' + @bad;
        END
    END TRY
    BEGIN CATCH
        SET @fails += 1;
        PRINT 'FAIL case ' + CAST(@id AS varchar(10)) + ' ' + @label + ': error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    END CATCH;
    FETCH NEXT FROM case_cursor INTO @id, @label, @entity, @act, @pc, @field, @class, @exp_used, @exp_resp_role, @exp_resp, @exp_acc;
END
CLOSE case_cursor;
DEALLOCATE case_cursor;

/* ---- the Admin views ----------------------------------------------------- */
DECLARE @n int, @n2 int;

BEGIN TRY
    SET @checks += 1;
    SELECT @n = COUNT(*), @n2 = COUNT(DISTINCT route_check_key) FROM app.vw_route_check;
    IF @n = 130 AND @n2 = 130 PRINT 'OK  vw_route_check: 130 rows (13 routes x 10 profit centres), key unique';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL vw_route_check: ' + CAST(@n AS varchar(10)) + ' rows, ' + CAST(@n2 AS varchar(10)) + ' distinct keys; expected 130 and 130'; END

    SET @checks += 1;
    SELECT @n = COUNT(*) FROM app.vw_route_check WHERE is_resolved = 0;
    IF @n = 0 PRINT 'OK  vw_route_check: every route resolves to a first-stage and a second-stage group for every profit centre';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL vw_route_check: ' + CAST(@n AS varchar(10)) + ' route x profit centre pair(s) resolve to UNROUTED'; END

    SET @checks += 1;
    SELECT @n = COUNT(*) FROM sys.dm_exec_describe_first_result_set(N'SELECT * FROM app.vw_route_check', NULL, 0) WHERE system_type_name LIKE N'%(max)%';
    SELECT @n2 = COUNT(*) FROM sys.dm_exec_describe_first_result_set(N'SELECT * FROM app.vw_group_member_count', NULL, 0) WHERE system_type_name LIKE N'%(max)%';
    IF @n = 0 AND @n2 = 0 PRINT 'OK  both views have no nvarchar(max) column (the connector needs explicit lengths)';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL a view exposes a (max) column'; END

    SET @checks += 1;
    SELECT @n = COUNT(*), @n2 = COUNT(DISTINCT group_key) FROM app.vw_group_member_count;
    IF @n = 19 AND @n2 = 19 PRINT 'OK  vw_group_member_count: 19 groups, key unique';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL vw_group_member_count: ' + CAST(@n AS varchar(10)) + ' rows, ' + CAST(@n2 AS varchar(10)) + ' distinct keys; expected 19 and 19'; END

    SELECT @n = COUNT(*) FROM app.vw_group_member_count WHERE active_member_count < 2;
    PRINT 'INFO groups with fewer than two active members: ' + CAST(@n AS varchar(10)) + ' of 19 (expected: most of them, the client file lists one member per group [REF-46:L0249-L0256])';
    SELECT @n = COUNT(*) FROM app.vw_route_check WHERE has_two_members = 0;
    PRINT 'INFO route x profit centre rows where a stage has fewer than two members: ' + CAST(@n AS varchar(10)) + ' of 130 (POC-DE-27: flag, not an error)';
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL views: error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

DROP TABLE #cases;
DROP TABLE #r;

IF @fails = 0 PRINT 't_route_resolve RESULT: ALL ' + CAST(@checks AS varchar(10)) + ' CHECKS PASS';
ELSE PRINT 't_route_resolve RESULT: ' + CAST(@fails AS varchar(10)) + ' OF ' + CAST(@checks AS varchar(10)) + ' CHECK(S) FAILED';
