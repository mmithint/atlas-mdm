/* =====================================================================
   app.usp_principal_profile    APP-1; FINAL PLAN/01 section 3 ("What a user may do")
   Single statement per file; CREATE OR ALTER, safe to run again.

   Input : the person's e-mail (as returned by app.usp_identity_resolve).
   Output: ONE result set, one row per (assignment x profit centre):
     user_email, display_name, is_registered   the person (repeated on every row)
     role_name, granted_via, group_key         the role and where it comes from:
                                               USER (assigned to the person), GROUP (through
                                               a group they belong to), IMPLICIT (see below)
     scope_type, profit_center_name            ALL_ORCM (profit_center_name NULL) or one
                                               row per profit centre of the list
     the ten role flags (can_view ... can_manage_admin)

   The caller combines rows: a flag is on when it is on in ANY row; an approval stage
   is allowed only for the profit centres of the rows that carry that flag.

   IMPLICIT row: every registered person also holds the role GeneralViewer ("All OXY
   Users" [REF-46:L0204]), so a registered person with no assignment can still view and
   submit [INFERRED: reading of that description]. No rows at all = unregistered and
   without assignments.

   Reads only; changes nothing. Never raises for an unknown e-mail.
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_principal_profile
    @email nvarchar(256)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @e nvarchar(256) = LOWER(LTRIM(RTRIM(@email)));
    DECLARE @name nvarchar(100) =
        (SELECT TOP (1) i.display_name FROM app.principal_identity AS i
         WHERE i.user_email = @e AND i.is_active = 1 ORDER BY i.identity_id);
    DECLARE @registered bit =
        CASE WHEN EXISTS (SELECT 1 FROM app.principal_identity AS i WHERE i.user_email = @e AND i.is_active = 1) THEN 1 ELSE 0 END;

    DECLARE @mine TABLE
    (
        assignment_id int           NULL,
        role_name     nvarchar(64)  NOT NULL,
        scope_type    nvarchar(20)  NOT NULL,
        granted_via   nvarchar(10)  NOT NULL,
        group_key     nvarchar(64)  NULL
    );

    -- assigned to the person directly
    INSERT INTO @mine (assignment_id, role_name, scope_type, granted_via, group_key)
    SELECT a.assignment_id, a.role_name, a.scope_type, N'USER', NULL
    FROM app.principal_role_assignment AS a
    WHERE a.is_active = 1 AND a.principal_type = N'USER' AND a.principal_key = @e;

    -- assigned to a group the person belongs to
    INSERT INTO @mine (assignment_id, role_name, scope_type, granted_via, group_key)
    SELECT a.assignment_id, a.role_name, a.scope_type, N'GROUP', m.group_key
    FROM app.group_membership AS m
    JOIN app.principal_role_assignment AS a
         ON a.principal_type = N'GROUP' AND a.principal_key = m.group_key AND a.is_active = 1
    WHERE m.is_active = 1 AND m.user_email = @e;

    -- everyone registered is a general viewer
    INSERT INTO @mine (assignment_id, role_name, scope_type, granted_via, group_key)
    SELECT NULL, N'GeneralViewer', N'ALL_ORCM', N'IMPLICIT', NULL
    WHERE @registered = 1
      AND EXISTS (SELECT 1 FROM app.role AS r WHERE r.role_name = N'GeneralViewer' AND r.is_active = 1);

    SELECT
        CAST(@e          AS nvarchar(256)) AS user_email,
        CAST(@name       AS nvarchar(100)) AS display_name,
        @registered                        AS is_registered,
        CAST(mm.role_name   AS nvarchar(64)) AS role_name,
        CAST(mm.granted_via AS nvarchar(10)) AS granted_via,
        CAST(mm.group_key   AS nvarchar(64)) AS group_key,
        CAST(mm.scope_type  AS nvarchar(20)) AS scope_type,
        CAST(s.profit_center_name AS nvarchar(40)) AS profit_center_name,
        r.can_view,
        r.can_submit_requests,
        r.can_request_edit_business_rules,
        r.can_publish_business_rules,
        r.can_request_edit_evidence_guidance,
        r.can_publish_evidence_guidance,
        r.can_responsible_approve,
        r.can_accountable_approve,
        r.can_manage_admin
    FROM @mine AS mm
    JOIN app.role AS r ON r.role_name = mm.role_name AND r.is_active = 1
    LEFT JOIN app.principal_role_assignment_scope AS s
         ON s.assignment_id = mm.assignment_id AND mm.scope_type = N'PROFIT_CENTER_LIST'
    ORDER BY mm.role_name, mm.granted_via, mm.group_key, s.profit_center_name;
END
