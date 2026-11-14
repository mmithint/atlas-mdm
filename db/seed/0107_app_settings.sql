/* =====================================================================
   0107_app_settings.sql        APP-1 seed: switches and working assumptions as data
   Source    : FINAL PLAN/09_Data_Dictionary.md section 2.1 (seeded keys) and
               FINAL PLAN/06_Client_Inputs_and_Assumptions.md (the open questions).
   Writes to : app.app_setting
   Database  : the ATLAS Fabric SQL database (item of type SQL database)
   Re-runnable: yes, INSERT-ONLY. A key that already exists is never changed, so
   re-running cannot undo a value an admin set on the Admin screen.

   No secret is stored here. The OxyGPT key is a Rayfin secret (04 RB-06). The
   OxyGPT address and agent id are empty until the client grants access (06 section 3,
   spike S5); the app shows "AI unavailable" while OXYGPT_BASE_URL is empty.
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL 0107.0 wrong editor: connected to "' + DB_NAME() + '". Open the item named ATLAS_SQL_DB whose type is SQL database. Nothing was changed.';
    RETURN;
END
IF OBJECT_ID(N'app.app_setting', N'U') IS NULL
BEGIN
    PRINT 'FAIL 0107.1 app.app_setting not found: run migration 0002_settings_catalog.sql first. Nothing was changed.';
    RETURN;
END

BEGIN TRY
    DECLARE @s TABLE
    (
        setting_key nvarchar(64) NOT NULL PRIMARY KEY, setting_value nvarchar(400) NOT NULL, description nvarchar(400) NOT NULL,
        is_assumption bit NOT NULL, related_question nvarchar(40) NULL
    );
    INSERT INTO @s (setting_key, setting_value, description, is_assumption, related_question) VALUES
        (N'SAME_PERSON_BOTH_STAGES', N'0',
         N'1 = one person may approve both stages of the same request; 0 = a second person is needed for the second stage. Working assumption until the client answers.', 1, N'Q-479'),
        (N'RETURN_RECIPIENT_RULE', N'SUBMITTER_OR_RESOLUTION_GROUP',
         N'Who receives a returned request: the person who submitted it, or the resolution group when a rule created it. Working assumption until the client answers.', 1, N'Q-465'),
        (N'TEST_ROW_LIMIT', N'200',
         N'Most rows a rule test or preview returns.', 0, NULL),
        (N'TEST_TIMEOUT_SECONDS', N'60',
         N'Longest a rule test may run before it is stopped.', 0, NULL),
        (N'NOTIFICATION_CHANNEL', N'IN_APP',
         N'Where notifications appear: IN_APP only (e-mail only if spike S6 passes and the client wants it). Working assumption until the client answers.', 1, N'Q-480'),
        (N'PHOTO_MAX_BYTES', N'10485760',
         N'Largest photo the app accepts (10 MB).', 0, NULL),
        (N'OXYGPT_BASE_URL', N'',
         N'Address of the client''s OxyGPT service. Empty until access is granted (VPN): the app then shows "AI unavailable" and lets people type the nameplate values.', 1, NULL),
        (N'OXYGPT_AGENT_MODEL_ID', N'',
         N'Id of the OxyGPT agent that reads nameplates. Empty until access is granted.', 1, NULL),
        (N'OXYGPT_TIMEOUT_SECONDS', N'30',
         N'Longest the app waits for OxyGPT before showing "AI unavailable". Our own choice, not a client value.', 1, NULL);

    DECLARE @new int;

    INSERT INTO app.app_setting (setting_key, setting_value, description, is_assumption, related_question, updated_by, updated_at_utc)
    SELECT s.setting_key, s.setting_value, s.description, s.is_assumption, s.related_question, N'system:seed', SYSUTCDATETIME()
    FROM @s AS s
    WHERE NOT EXISTS (SELECT 1 FROM app.app_setting AS a WHERE a.setting_key = s.setting_key);
    SET @new = @@ROWCOUNT;

    -- PRINT accepts only plain values (Msg 1046 for a subquery), so count first
    DECLARE @total int = (SELECT COUNT(*) FROM app.app_setting);
    PRINT 'OK  0107 settings: ' + CAST(@new AS varchar(12)) + ' new, '
        + CAST(@total AS varchar(12)) + ' in total (expected 9)';
END TRY
BEGIN CATCH
    PRINT 'FAIL 0107.9 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;
