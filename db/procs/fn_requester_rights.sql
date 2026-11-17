/* =====================================================================
   app.fn_requester_rights      APP-3 helper (used by app.usp_request_create)
   Single statement per file; CREATE OR ALTER, safe to run again.

   Input : a person's e-mail.
   Output: exactly one row
     is_registered        1 = an active row in app.principal_identity (an admin linked the
                          person's sign-in id to this e-mail, FINAL PLAN/01 section 6.8)
     can_submit_requests  1 = registered and some role the person holds has can_submit_requests
     can_manage_admin     1 = registered and some role the person holds has can_manage_admin

   Roles a person holds: assigned to the person (USER), assigned to a group the person is an
   active member of (GROUP), and, for every registered person, GeneralViewer ("All OXY Users"
   [REF-46:L0204]), the same reading as app.usp_principal_profile. An inactive role or
   assignment never counts. Scope is not needed here: it matters for approving, not submitting
   (see app.fn_stage_eligibility).
   ===================================================================== */
CREATE OR ALTER FUNCTION app.fn_requester_rights
(
    @user_email nvarchar(256)
)
RETURNS TABLE
AS
RETURN
(
    SELECT
        CAST(g.reg AS bit) AS is_registered,
        CAST(CASE WHEN g.reg = 1 AND h.submit = 1 THEN 1 ELSE 0 END AS bit) AS can_submit_requests,
        CAST(CASE WHEN g.reg = 1 AND h.adm = 1 THEN 1 ELSE 0 END AS bit)    AS can_manage_admin
    FROM (SELECT LOWER(LTRIM(RTRIM(@user_email))) AS e) AS x
    CROSS APPLY
    (
        SELECT CASE WHEN EXISTS (SELECT 1 FROM app.principal_identity AS i
                                 WHERE i.user_email = x.e AND i.is_active = 1) THEN 1 ELSE 0 END AS reg
    ) AS g
    CROSS APPLY
    (
        SELECT ISNULL(MAX(CAST(ro.can_submit_requests AS int)), 0) AS submit,
               ISNULL(MAX(CAST(ro.can_manage_admin AS int)), 0)    AS adm
        FROM app.role AS ro
        WHERE ro.is_active = 1
          AND (   (g.reg = 1 AND ro.role_name = N'GeneralViewer')
               OR EXISTS (SELECT 1
                          FROM app.principal_role_assignment AS a
                          WHERE a.is_active = 1
                            AND a.role_name = ro.role_name
                            AND (   (a.principal_type = N'USER' AND a.principal_key = x.e)
                                 OR (a.principal_type = N'GROUP'
                                     AND EXISTS (SELECT 1 FROM app.group_membership AS m
                                                 WHERE m.is_active = 1 AND m.user_email = x.e AND m.group_key = a.principal_key)))))
    ) AS h
);
