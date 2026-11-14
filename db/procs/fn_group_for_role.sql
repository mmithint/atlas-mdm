/* =====================================================================
   app.fn_group_for_role        APP-1 helper (used by app.usp_route_resolve and
                                app.vw_route_check, so the rule lives in ONE place)
   Single statement per file; CREATE OR ALTER, safe to run again.

   Input : a role name or an alias from app.role_alias (routes may name an alias,
           for example "Operations-IOC - NMD"), and a profit centre.
   Output: exactly one row: role_name (alias resolved) and group_key (NULL when no
           group holds that role for that profit centre).

   Group choice (03 APP-1 step 5): the group is the GROUP assignment of that role whose
   scope contains the profit centre; an explicit profit-centre list beats ALL_ORCM; on a
   tie the lowest assignment_id wins. An inactive role or assignment never matches.
   ===================================================================== */
CREATE OR ALTER FUNCTION app.fn_group_for_role
(
    @role_or_alias      nvarchar(64),
    @profit_center_name nvarchar(40)
)
RETURNS TABLE
AS
RETURN
(
    SELECT x.role_name, g.group_key
    FROM (SELECT COALESCE((SELECT al.role_name FROM app.role_alias AS al WHERE al.alias_name = @role_or_alias), @role_or_alias) AS role_name) AS x
    OUTER APPLY
    (
        SELECT TOP (1) a.principal_key AS group_key
        FROM app.principal_role_assignment AS a
        JOIN app.role AS ro ON ro.role_name = a.role_name AND ro.is_active = 1
        WHERE a.is_active = 1
          AND a.principal_type = N'GROUP'
          AND a.role_name = x.role_name
          AND (a.scope_type = N'ALL_ORCM'
               OR EXISTS (SELECT 1 FROM app.principal_role_assignment_scope AS s
                          WHERE s.assignment_id = a.assignment_id AND s.profit_center_name = @profit_center_name))
        ORDER BY CASE WHEN a.scope_type = N'ALL_ORCM' THEN 1 ELSE 0 END, a.assignment_id
    ) AS g
);
