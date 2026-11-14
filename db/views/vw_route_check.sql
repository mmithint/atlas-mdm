/* =====================================================================
   app.vw_route_check           APP-1; FINAL PLAN/09 section 9; screen S-13 (Admin)
   Single statement per file; CREATE OR ALTER, safe to run again.

   One row per approval route x profit centre: the groups it resolves to and how many
   active members each has. This is the POC-DE-27 acceptance check: a stage with fewer
   than two members stops work when one person is away [DBF-DOC:L0039]. The client's
   own file has one member in most groups, so most rows show has_two_members = 0.

   Key: route_check_key (route_id + '|' + profit centre). Exposed through the connector:
   every column has an explicit type and there is no nvarchar(max).
   Profit centres are the ones named in the scope lists of the assignments (the ten
   ORCM values of 01 section 3). Group choice is app.fn_group_for_role, the same code
   app.usp_route_resolve uses.
   ===================================================================== */
CREATE OR ALTER VIEW app.vw_route_check
AS
SELECT
    CAST(CONVERT(nvarchar(20), r.route_id) + N'|' + pc.profit_center_name AS nvarchar(80)) AS route_check_key,
    CAST(r.route_id                  AS int)           AS route_id,
    CAST(r.entity_type               AS nvarchar(10))  AS entity_type,
    CAST(r.request_action            AS nvarchar(10))  AS request_action,
    CAST(r.field_or_characteristic   AS nvarchar(64))  AS field_or_characteristic,
    CAST(r.class_scope               AS nvarchar(10))  AS class_scope,
    CAST(pc.profit_center_name       AS nvarchar(40))  AS profit_center_name,
    CAST(rg.role_name                AS nvarchar(64))  AS responsible_role,
    CAST(ISNULL(rg.group_key, N'UNROUTED') AS nvarchar(64)) AS responsible_group,
    CAST(rc.n                        AS int)           AS responsible_member_count,
    CAST(ag.role_name                AS nvarchar(64))  AS accountable_role,
    CAST(ISNULL(ag.group_key, N'UNROUTED') AS nvarchar(64)) AS accountable_group,
    CAST(ac.n                        AS int)           AS accountable_member_count,
    CAST(CASE WHEN rg.group_key IS NOT NULL AND ag.group_key IS NOT NULL THEN 1 ELSE 0 END AS bit) AS is_resolved,
    CAST(CASE WHEN rc.n >= 2 AND ac.n >= 2 THEN 1 ELSE 0 END AS bit) AS has_two_members
FROM app.approval_route AS r
CROSS JOIN (SELECT DISTINCT s.profit_center_name FROM app.principal_role_assignment_scope AS s) AS pc
CROSS APPLY app.fn_group_for_role(r.responsible_role, pc.profit_center_name) AS rg
CROSS APPLY app.fn_group_for_role(r.accountable_role, pc.profit_center_name) AS ag
CROSS APPLY (SELECT COUNT(*) AS n FROM app.group_membership AS m WHERE m.group_key = rg.group_key AND m.is_active = 1) AS rc
CROSS APPLY (SELECT COUNT(*) AS n FROM app.group_membership AS m WHERE m.group_key = ag.group_key AND m.is_active = 1) AS ac
WHERE r.is_active = 1;
