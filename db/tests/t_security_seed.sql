/* =====================================================================
   t_security_seed.sql        APP-1 test: the REF-46 security and routing seed
   Database   : the ATLAS Fabric SQL database (item of type SQL database)
   Run after  : migration 0003_security.sql and seeds 0101-0105.
   Re-runnable: yes (it only reads).

   What it checks: the counts the seed files are expected to produce, and the
   rules the client file states (who may publish, who may approve at which
   stage, which profit centres each regional group covers).

   The people loaded by db/seed/local/pov_members.sql do not change any count
   here: assignments are counted for GROUP rows only, and group members are
   not counted.

   Expected numbers come from the generator's own summary (tools/gen_ref46_seed.py):
   16 roles, 19 groups, 13 routes, 100 route-class rows, 12 group assignments
   (3 ALL_ORCM + 9 PROFIT_CENTER_LIST), 30 scope rows, 1 alias.
   Last line: t_security_seed RESULT: ...
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL t_security_seed.0 wrong editor: connected to "' + DB_NAME() + '" on engine ' + ISNULL(CAST(SERVERPROPERTY('EngineEdition') AS varchar(20)), '?') + ' (11 = the warehouse-style engine, which the SQL analytics endpoint uses). Open the item named ATLAS_SQL_DB whose type is SQL database and run this from New query there.';
    RETURN;
END

IF OBJECT_ID(N'app.role', N'U') IS NULL OR OBJECT_ID(N'app.role_alias', N'U') IS NULL
   OR OBJECT_ID(N'app.security_group', N'U') IS NULL OR OBJECT_ID(N'app.principal_role_assignment', N'U') IS NULL
   OR OBJECT_ID(N'app.principal_role_assignment_scope', N'U') IS NULL OR OBJECT_ID(N'app.approval_route', N'U') IS NULL
   OR OBJECT_ID(N'app.approval_route_class', N'U') IS NULL
BEGIN
    PRINT 'FAIL t_security_seed.1 a security table is missing: run migration 0003_security.sql and seeds 0101-0105 first.';
    RETURN;
END

BEGIN TRY
    DECLARE @c TABLE
    (
        seq      int IDENTITY(1,1) NOT NULL,
        name     nvarchar(200)     NOT NULL,
        expected int               NOT NULL,
        actual   int               NOT NULL
    );

    INSERT INTO @c (name, expected, actual) VALUES
    /* roles [REF-46:L0191-L0207] */
    (N'16 roles loaded',                                  16, (SELECT COUNT(*) FROM app.role)),
    (N'all 16 roles active',                              16, (SELECT COUNT(*) FROM app.role WHERE is_active = 1)),
    (N'every role can view and submit requests',           0, (SELECT COUNT(*) FROM app.role WHERE can_view = 0 OR can_submit_requests = 0)),
    (N'exactly 2 roles can publish rules',                 2, (SELECT COUNT(*) FROM app.role WHERE can_publish_business_rules = 1)),
    (N'Admin and SAPBusinessSupport are the 2 publishers', 2, (SELECT COUNT(*) FROM app.role WHERE can_publish_business_rules = 1 AND role_name IN (N'Admin', N'SAPBusinessSupport'))),
    (N'9 roles approve at both stages',                    9, (SELECT COUNT(*) FROM app.role WHERE can_responsible_approve = 1 AND can_accountable_approve = 1)),
    (N'SCM approves only as responsible',                  1, (SELECT COUNT(*) FROM app.role WHERE role_name = N'SCM' AND can_responsible_approve = 1 AND can_accountable_approve = 0)),
    (N'exactly 1 role can manage the admin screen',        1, (SELECT COUNT(*) FROM app.role WHERE can_manage_admin = 1)),
    (N'that role is Admin',                                1, (SELECT COUNT(*) FROM app.role WHERE can_manage_admin = 1 AND role_name = N'Admin')),
    /* groups [REF-46:L0284-L0303] */
    (N'19 groups loaded',                                 19, (SELECT COUNT(*) FROM app.security_group)),
    /* routes [REF-46:L0210-L0223] */
    (N'13 routes loaded',                                 13, (SELECT COUNT(*) FROM app.approval_route)),
    (N'100 route-class rows (4 x 8 PSV + 4 x 17 pump)',  100, (SELECT COUNT(*) FROM app.approval_route_class)),
    (N'8 routes with a class list',                        8, (SELECT COUNT(*) FROM app.approval_route WHERE class_scope = N'LIST')),
    (N'5 routes for any class',                            5, (SELECT COUNT(*) FROM app.approval_route WHERE class_scope = N'ANY')),
    (N'1 field-specific route (OEM_BSFC)',                 1, (SELECT COUNT(*) FROM app.approval_route WHERE field_or_characteristic <> N'*')),
    (N'every LIST route has classes',                      0, (SELECT COUNT(*) FROM app.approval_route AS rt WHERE rt.class_scope = N'LIST' AND NOT EXISTS (SELECT 1 FROM app.approval_route_class AS c WHERE c.route_id = rt.route_id))),
    (N'no ANY route has classes',                          0, (SELECT COUNT(*) FROM app.approval_route_class AS c JOIN app.approval_route AS rt ON rt.route_id = c.route_id WHERE rt.class_scope = N'ANY')),
    /* group assignments [REF-46:L0231-L0245] */
    (N'12 GROUP assignments',                             12, (SELECT COUNT(*) FROM app.principal_role_assignment WHERE principal_type = N'GROUP')),
    (N'3 GROUP assignments for all of ORCM',               3, (SELECT COUNT(*) FROM app.principal_role_assignment WHERE principal_type = N'GROUP' AND scope_type = N'ALL_ORCM')),
    (N'9 GROUP assignments with a profit-centre list',     9, (SELECT COUNT(*) FROM app.principal_role_assignment WHERE principal_type = N'GROUP' AND scope_type = N'PROFIT_CENTER_LIST')),
    (N'30 scope rows on GROUP assignments',               30, (SELECT COUNT(*) FROM app.principal_role_assignment_scope AS s JOIN app.principal_role_assignment AS a ON a.assignment_id = s.assignment_id WHERE a.principal_type = N'GROUP')),
    (N'ALL_ORCM assignments have no scope rows',           0, (SELECT COUNT(*) FROM app.principal_role_assignment_scope AS s JOIN app.principal_role_assignment AS a ON a.assignment_id = s.assignment_id WHERE a.scope_type = N'ALL_ORCM')),
    (N'no scope row outside the ten profit centres',       0, (SELECT COUNT(*) FROM app.principal_role_assignment_scope AS s WHERE s.profit_center_name NOT IN (N'ROCKIES-DJ BASIN', N'ROCKIES-PRB', N'ROCKIES-OTHER', N'OP RES DB TX', N'OP RES DB NM', N'OP RES MB', N'OP RES MB CROWNROCK', N'OP EOR', N'OP EOR GAS PLANT', N'OP EOR CO2 OPS'))),
    (N'every assignment role exists in app.role',          0, (SELECT COUNT(*) FROM app.principal_role_assignment AS a WHERE NOT EXISTS (SELECT 1 FROM app.role AS r WHERE r.role_name = a.role_name))),
    /* the four Operations-IOC regional groups must cover each profit centre once */
    (N'4 Operations-IOC regional group assignments',       4, (SELECT COUNT(*) FROM app.principal_role_assignment WHERE principal_type = N'GROUP' AND role_name = N'Operations-IOC')),
    (N'the 4 regional group keys exist as groups',         4, (SELECT COUNT(*) FROM app.principal_role_assignment AS a JOIN app.security_group AS g ON g.group_key = a.principal_key WHERE a.principal_type = N'GROUP' AND a.role_name = N'Operations-IOC')),
    (N'Operations-IOC regions hold 10 scope rows',        10, (SELECT COUNT(*) FROM app.principal_role_assignment_scope AS s JOIN app.principal_role_assignment AS a ON a.assignment_id = s.assignment_id WHERE a.principal_type = N'GROUP' AND a.role_name = N'Operations-IOC')),
    (N'Operations-IOC regions hold 10 different centres', 10, (SELECT COUNT(DISTINCT s.profit_center_name) FROM app.principal_role_assignment_scope AS s JOIN app.principal_role_assignment AS a ON a.assignment_id = s.assignment_id WHERE a.principal_type = N'GROUP' AND a.role_name = N'Operations-IOC')),
    (N'all ten profit centres are covered by Operations-IOC', 10,
        (SELECT COUNT(*) FROM (VALUES (N'ROCKIES-DJ BASIN'), (N'ROCKIES-PRB'), (N'ROCKIES-OTHER'), (N'OP RES DB TX'), (N'OP RES DB NM'),
                                      (N'OP RES MB'), (N'OP RES MB CROWNROCK'), (N'OP EOR'), (N'OP EOR GAS PLANT'), (N'OP EOR CO2 OPS')) AS pc(n)
         WHERE EXISTS (SELECT 1 FROM app.principal_role_assignment_scope AS s JOIN app.principal_role_assignment AS a ON a.assignment_id = s.assignment_id
                       WHERE a.principal_type = N'GROUP' AND a.role_name = N'Operations-IOC' AND s.profit_center_name = pc.n))),
    /* aliases [REF-46:L0211-L0214], working assumption WA-02 / Q-496 */
    (N'exactly 1 alias',                                   1, (SELECT COUNT(*) FROM app.role_alias)),
    (N'alias Operations-IOC - NMD -> Operations-IOC, flagged as assumption', 1,
        (SELECT COUNT(*) FROM app.role_alias WHERE alias_name = N'Operations-IOC - NMD' AND role_name = N'Operations-IOC' AND is_assumption = 1 AND related_question = N'Q-496')),
    (N'every route role exists after alias resolution',    0,
        (SELECT COUNT(*) FROM app.approval_route AS rt
         WHERE NOT EXISTS (SELECT 1 FROM app.role AS r WHERE r.role_name = COALESCE((SELECT a.role_name FROM app.role_alias AS a WHERE a.alias_name = rt.responsible_role), rt.responsible_role))
            OR NOT EXISTS (SELECT 1 FROM app.role AS r WHERE r.role_name = COALESCE((SELECT a.role_name FROM app.role_alias AS a WHERE a.alias_name = rt.accountable_role), rt.accountable_role))));

    DECLARE @name nvarchar(200), @expected int, @actual int, @fail int = 0, @total int = 0;
    DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT name, expected, actual FROM @c ORDER BY seq;
    OPEN c;
    FETCH NEXT FROM c INTO @name, @expected, @actual;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @total += 1;
        IF @expected = @actual
            PRINT 'PASS ' + @name + ' (' + CAST(@actual AS varchar(12)) + ')';
        ELSE
        BEGIN
            SET @fail += 1;
            PRINT 'FAIL ' + @name + ': expected ' + CAST(@expected AS varchar(12)) + ', found ' + CAST(@actual AS varchar(12));
        END
        FETCH NEXT FROM c INTO @name, @expected, @actual;
    END
    CLOSE c;
    DEALLOCATE c;

    IF @fail = 0
        PRINT 't_security_seed RESULT: ALL ' + CAST(@total AS varchar(12)) + ' CHECKS PASS';
    ELSE
        PRINT 't_security_seed RESULT: ' + CAST(@fail AS varchar(12)) + ' OF ' + CAST(@total AS varchar(12)) + ' CHECK(S) FAILED';
END TRY
BEGIN CATCH
    PRINT 'FAIL t_security_seed.9 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    PRINT 't_security_seed RESULT: DID NOT FINISH';
END CATCH;
