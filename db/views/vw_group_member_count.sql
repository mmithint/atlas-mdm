/* =====================================================================
   app.vw_group_member_count    APP-1; FINAL PLAN/09 section 9; screen S-13 (Admin)
   Single statement per file; CREATE OR ALTER, safe to run again.

   One row per defined group (app.security_group): its roles and how many active
   people belong to it. Key: group_key. Exposed through the connector: explicit
   types, no nvarchar(max). E-mail addresses are never part of this view.
   ===================================================================== */
CREATE OR ALTER VIEW app.vw_group_member_count
AS
SELECT
    CAST(g.group_key     AS nvarchar(64))  AS group_key,
    CAST(g.display_name  AS nvarchar(100)) AS display_name,
    CAST(ISNULL(ro.roles, N'') AS nvarchar(400)) AS roles,
    CAST((SELECT COUNT(*) FROM app.group_membership AS m WHERE m.group_key = g.group_key AND m.is_active = 1) AS int) AS active_member_count
FROM app.security_group AS g
OUTER APPLY
(
    SELECT STRING_AGG(x.role_name, N', ') WITHIN GROUP (ORDER BY x.role_name) AS roles
    FROM (SELECT DISTINCT a.role_name
          FROM app.principal_role_assignment AS a
          WHERE a.principal_type = N'GROUP' AND a.principal_key = g.group_key AND a.is_active = 1) AS x
) AS ro
WHERE g.is_active = 1;
