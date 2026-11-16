/* =====================================================================
   app.vw_field_ownership       APP-2 step 0 (left over from APP-1, decided 14 Nov);
                                FINAL PLAN/09 section 9; screens S-5 and S-13
   Single statement per file; CREATE OR ALTER, safe to run again.

   One row per active catalogue field: which role answers first (responsible) and which
   role signs off second (accountable) when someone changes that field. S-5 shows these
   next to every field ("show the responsible and accountable owner next to each editable
   field", POC-APP-03); S-13's Field governance tab reads the same rows later (APP-9).

   Why a view and not a table: the owners follow from the routes in app.approval_route.
   A second table could disagree with them (09 section 10).

   Which route a field uses: the same choice as app.usp_route_resolve when no class is
   known. Among the active UPDATE routes for the field's entity type that cover any class
   (class_scope = 'ANY'), a route naming this field beats the wildcard route ('*'); on a
   tie the lowest route_id wins. Routes limited to a list of classes (for example PSV or
   pump classes) are left out on purpose: they depend on the class of the item being
   changed, which a catalogue field does not have. For a heater none of the client's
   class routes applies [REF-46:L0210-L0223]. If the client ever adds a HEATER class
   route, this view has to take the class as an input (then it becomes a function).

   Roles, not groups: the group that answers depends on the profit centre of the heater,
   so it is chosen at request time (app.fn_group_for_role). An alias such as
   "Operations-IOC - NMD" is shown as the role it stands for (app.role_alias).

   responsible_role, accountable_role and route_id are NULL when no route matches (the
   field is then UNROUTED and admins see it on S-13).

   Key: field_ownership_key = entity_type + '|' + field_code, never NULL. ISNULL is the
   OUTERMOST function on purpose: SQL Server reports a column as not nullable only then
   (found 14 Nov, B2: ISNULL inside a CAST was reported as nullable). Exposed through
   the connector: explicit lengths everywhere, no nvarchar(max).
   ===================================================================== */
CREATE OR ALTER VIEW app.vw_field_ownership
AS
SELECT
    ISNULL(CAST(c.entity_type + N'|' + c.field_code AS nvarchar(80)), N'') AS field_ownership_key,
    CAST(c.entity_type  AS nvarchar(10))  AS entity_type,
    CAST(c.field_code   AS nvarchar(64))  AS field_code,
    CAST(c.label        AS nvarchar(100)) AS label,
    CAST(COALESCE(ra.role_name, rt.responsible_role) AS nvarchar(64)) AS responsible_role,
    CAST(COALESCE(aa.role_name, rt.accountable_role) AS nvarchar(64)) AS accountable_role,
    CAST(rt.route_id    AS int)           AS route_id
FROM app.field_catalog AS c
OUTER APPLY
(
    SELECT TOP (1) r.route_id, r.responsible_role, r.accountable_role
    FROM app.approval_route AS r
    WHERE r.is_active = 1
      AND r.entity_type = c.entity_type
      AND r.request_action = N'UPDATE'
      AND r.class_scope = N'ANY'
      AND (r.field_or_characteristic = N'*' OR r.field_or_characteristic = c.field_code)
    ORDER BY CASE WHEN r.field_or_characteristic <> N'*' THEN 1 ELSE 0 END DESC, r.route_id
) AS rt
LEFT JOIN app.role_alias AS ra ON ra.alias_name = rt.responsible_role
LEFT JOIN app.role_alias AS aa ON aa.alias_name = rt.accountable_role
WHERE c.is_active = 1;
