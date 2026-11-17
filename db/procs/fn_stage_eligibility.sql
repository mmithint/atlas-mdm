/* =====================================================================
   app.fn_stage_eligibility     APP-3 helper (used by the request procedures and
                                app.fn_request_checks, so the rule lives in ONE place)
   Single statement per file; CREATE OR ALTER, safe to run again.

   FINAL PLAN/01 section 3, "Approval eligibility": a person may decide a request at a stage
   when ALL of these hold:
     1. the stage's flag is on in a role the person holds (can_responsible_approve for the
        RESPONSIBLE stage, can_accountable_approve for the ACCOUNTABLE stage), and
     2. the scope of that same role assignment covers the request's profit centre (ALL_ORCM, or
        a list that contains it), and
     3. the person is an active member of the group the request was routed to for that stage.

   Input : the person's e-mail, the stage (RESPONSIBLE or ACCOUNTABLE), the routed group's key
           and the request's profit centre.
   Output: exactly one row
     is_group_member     3. (the group must also be active)
     has_flag_in_scope   1. and 2. together, on the same role assignment
     is_eligible         both

   A role is held when it is assigned to the person (USER) or to a group the person is an active
   member of (GROUP). An unknown stage, a missing group or a blank e-mail gives 0, never an error.
   Segregation of duties (one person may not approve both stages) is a different rule and is
   checked where it is used (app.usp_request_decide, setting SAME_PERSON_BOTH_STAGES).
   ===================================================================== */
CREATE OR ALTER FUNCTION app.fn_stage_eligibility
(
    @user_email         nvarchar(256),
    @stage              nvarchar(12),
    @group_key          nvarchar(64),
    @profit_center_name nvarchar(40)
)
RETURNS TABLE
AS
RETURN
(
    SELECT
        CAST(z.mem  AS bit) AS is_group_member,
        CAST(z.flag AS bit) AS has_flag_in_scope,
        CAST(CASE WHEN z.mem = 1 AND z.flag = 1 THEN 1 ELSE 0 END AS bit) AS is_eligible
    FROM (SELECT LOWER(LTRIM(RTRIM(@user_email))) AS e) AS q
    CROSS APPLY
    (
        SELECT
            CASE WHEN EXISTS (SELECT 1
                              FROM app.group_membership AS m
                              JOIN app.security_group AS sg ON sg.group_key = m.group_key AND sg.is_active = 1
                              WHERE m.is_active = 1 AND m.group_key = @group_key AND m.user_email = q.e) THEN 1 ELSE 0 END AS mem,
            CASE WHEN EXISTS (SELECT 1
                              FROM app.principal_role_assignment AS a
                              JOIN app.role AS ro ON ro.role_name = a.role_name AND ro.is_active = 1
                              WHERE a.is_active = 1
                                AND (CASE WHEN @stage = N'RESPONSIBLE' THEN ro.can_responsible_approve
                                          WHEN @stage = N'ACCOUNTABLE' THEN ro.can_accountable_approve
                                          ELSE 0 END) = 1
                                AND (   (a.principal_type = N'USER' AND a.principal_key = q.e)
                                     OR (a.principal_type = N'GROUP'
                                         AND EXISTS (SELECT 1 FROM app.group_membership AS m2
                                                     WHERE m2.is_active = 1 AND m2.user_email = q.e AND m2.group_key = a.principal_key)))
                                AND (   a.scope_type = N'ALL_ORCM'
                                     OR EXISTS (SELECT 1 FROM app.principal_role_assignment_scope AS s
                                                WHERE s.assignment_id = a.assignment_id AND s.profit_center_name = @profit_center_name))) THEN 1 ELSE 0 END AS flag
    ) AS z
);
