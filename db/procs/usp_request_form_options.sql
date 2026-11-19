/* =====================================================================
   app.usp_request_form_options  APP-4, read path C (D-17); the request dialog on S-5; function getRequestFormOptions
   Single statement per file; CREATE OR ALTER, safe to run again.
   Needs: app.fn_requester_rights. Reads only. Test: db/tests/t_request_reads.sql

   What the "Request change" dialog needs besides the field catalogue (which the browser reads through the connector):
   the drop-down values of the LIST fields, whether this person may submit requests at all, and which fields they may
   not ask for by hand. Showing this only saves a person from filling in a form that app.usp_request_create would
   refuse (50107 not allowed to submit, 50113 admin-only field); the procedure still enforces both.

   Three result sets, always in this order:
     1  allowed values   field_code, allowed_value, display_order: the active values of app.field_allowed_value for
                         active catalogue fields
     2  one row          can_submit (registered and holding a role with can_submit_requests), is_admin (can_manage_admin)
     3  blocked fields   field_code, reason: the admin-only fields (setting ADMIN_ONLY_FIELDS, seed 0109) when the person
                         is not an admin; no rows for an admin

   @only_set (testing aid, NULL = all): return only that numbered result set, so a test can read each set with
   INSERT ... EXEC, which cannot capture sets of different shapes. The functions never pass it.

   Refusal (THROW): 50331 the options are for a person (blank, no @, or a system: address).
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_request_form_options
    @actor_email nvarchar(256),
    @only_set    tinyint = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @actor nvarchar(256) = LOWER(LTRIM(RTRIM(@actor_email)));
    IF @actor IS NULL OR CHARINDEX(N'@', @actor) < 2 OR LEFT(@actor, 7) = N'system:'
        THROW 50331, N'The request options belong to a person (an e-mail address).', 1;

    DECLARE @submit bit = 0, @admin bit = 0;
    SELECT @submit = rr.can_submit_requests, @admin = rr.can_manage_admin
    FROM app.fn_requester_rights(@actor) AS rr;

    IF @only_set IS NULL OR @only_set = 1
    SELECT a.field_code, a.allowed_value, a.display_order
    FROM app.field_allowed_value AS a
    JOIN app.field_catalog AS c ON c.field_code = a.field_code AND c.is_active = 1
    WHERE a.is_active = 1
    ORDER BY a.field_code, a.display_order, a.allowed_value;

    IF @only_set IS NULL OR @only_set = 2
    SELECT CAST(ISNULL(@submit, 0) AS bit) AS can_submit, CAST(ISNULL(@admin, 0) AS bit) AS is_admin;

    IF @only_set IS NULL OR @only_set = 3
    SELECT CAST(LTRIM(RTRIM(s.value)) AS nvarchar(64)) AS field_code,
           CAST(N'Only an admin may ask to change this field by hand.' AS nvarchar(200)) AS reason
    FROM STRING_SPLIT(ISNULL((SELECT x.setting_value FROM app.app_setting AS x WHERE x.setting_key = N'ADMIN_ONLY_FIELDS'), N''), N',') AS s
    WHERE LTRIM(RTRIM(s.value)) <> N'' AND ISNULL(@admin, 0) = 0
    ORDER BY LTRIM(RTRIM(s.value));
END
