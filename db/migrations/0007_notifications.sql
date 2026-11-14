/* =====================================================================
   0007_notifications.sql    APP-1, migration 7 of 7
   Tables: app.notification, app.subscription, app.saved_view
   Columns and meanings: FINAL PLAN/09_Data_Dictionary.md section 7.
   Re-runnable: yes (IF OBJECT_ID ... IS NULL). Never edit after it has run.

   notification.dedup_key is unique: recipient + event, so nobody gets the same
   message twice. A subscription never gives access to data (09 section 7.2).
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL 0007 wrong editor: connected to "' + DB_NAME() + '". Open the item named ATLAS_SQL_DB whose type is SQL database. Nothing was changed.';
    RETURN;
END
IF OBJECT_ID(N'app.change_request', N'U') IS NULL
BEGIN
    PRINT 'FAIL 0007 app.change_request is missing: run 0004 first. Nothing was changed.';
    RETURN;
END

DECLARE @failed int = 0;

/* ---- 7.1 app.notification ------------------------------------------------------- */
BEGIN TRY
    IF OBJECT_ID(N'app.notification', N'U') IS NULL
        CREATE TABLE app.notification
        (
            notification_id  bigint IDENTITY(1,1) NOT NULL,
            recipient_email  nvarchar(256)  NOT NULL,
            topic            nvarchar(30)   NOT NULL,
            request_id       bigint         NULL,
            title            nvarchar(200)  NOT NULL,
            body             nvarchar(1000) NOT NULL,
            created_at_utc   datetime2(3)   NOT NULL CONSTRAINT df_notification_created_at DEFAULT (SYSUTCDATETIME()),
            read_at_utc      datetime2(3)   NULL,
            email_status     nvarchar(12)   NOT NULL CONSTRAINT df_notification_email_status DEFAULT (N'NOT_REQUIRED'),
            email_sent_at_utc datetime2(3)  NULL,
            dedup_key        nvarchar(100)  NOT NULL,
            CONSTRAINT pk_notification PRIMARY KEY (notification_id),
            CONSTRAINT ux_notification_dedup UNIQUE (dedup_key),
            CONSTRAINT fk_notification_request FOREIGN KEY (request_id) REFERENCES app.change_request (request_id),
            CONSTRAINT ck_notification_topic CHECK (topic IN (N'REQUEST_PENDING_RESPONSIBLE', N'REQUEST_PENDING_ACCOUNTABLE', N'REQUEST_APPROVED', N'REQUEST_REJECTED', N'REQUEST_RETURNED', N'SUBSCRIBED_CHANGE')),
            CONSTRAINT ck_notification_email_status CHECK (email_status IN (N'NOT_REQUIRED', N'PENDING', N'SENT', N'FAILED'))
        );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_notification_recipient' AND object_id = OBJECT_ID(N'app.notification'))
        CREATE INDEX ix_notification_recipient ON app.notification (recipient_email, read_at_utc, created_at_utc);
    PRINT 'OK  0007 app.notification ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0007 app.notification, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- 7.2 app.subscription -------------------------------------------------------- */
BEGIN TRY
    IF OBJECT_ID(N'app.subscription', N'U') IS NULL
        CREATE TABLE app.subscription
        (
            subscription_id    int IDENTITY(1,1) NOT NULL,
            subscriber_email   nvarchar(256) NOT NULL,
            topic              nvarchar(30)  NOT NULL,
            profit_center_name nvarchar(40)  NULL,
            equipment_id       int           NULL,
            field_code         nvarchar(64)  NULL,
            rule_id            nvarchar(64)  NULL,
            is_active          bit           NOT NULL CONSTRAINT df_subscription_is_active DEFAULT (1),
            created_at_utc     datetime2(3)  NOT NULL CONSTRAINT df_subscription_created_at DEFAULT (SYSUTCDATETIME()),
            CONSTRAINT pk_subscription PRIMARY KEY (subscription_id),
            CONSTRAINT ck_subscription_topic CHECK (topic IN (N'ALL_CHANGES', N'APPROVED_CHANGES', N'RULE_EXCEPTION')),
            CONSTRAINT ck_subscription_rule CHECK (rule_id IS NULL OR topic = N'RULE_EXCEPTION')
        );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_subscription_subscriber' AND object_id = OBJECT_ID(N'app.subscription'))
        CREATE INDEX ix_subscription_subscriber ON app.subscription (subscriber_email, is_active);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_subscription_topic' AND object_id = OBJECT_ID(N'app.subscription'))
        CREATE INDEX ix_subscription_topic ON app.subscription (topic, is_active);
    PRINT 'OK  0007 app.subscription ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0007 app.subscription, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- 7.3 app.saved_view ----------------------------------------------------------- */
BEGIN TRY
    IF OBJECT_ID(N'app.saved_view', N'U') IS NULL
        CREATE TABLE app.saved_view
        (
            saved_view_id   int IDENTITY(1,1) NOT NULL,
            owner_email     nvarchar(256)  NOT NULL,
            screen_code     nvarchar(10)   NOT NULL,
            view_name       nvarchar(100)  NOT NULL,
            definition_json nvarchar(4000) NOT NULL,
            is_default      bit            NOT NULL CONSTRAINT df_saved_view_is_default DEFAULT (0),
            updated_at_utc  datetime2(3)   NOT NULL CONSTRAINT df_saved_view_updated_at DEFAULT (SYSUTCDATETIME()),
            CONSTRAINT pk_saved_view PRIMARY KEY (saved_view_id),
            CONSTRAINT ux_saved_view_name UNIQUE (owner_email, screen_code, view_name),
            CONSTRAINT ck_saved_view_screen CHECK (screen_code IN (N'S-2', N'S-4')),
            CONSTRAINT ck_saved_view_json CHECK (ISJSON(definition_json) = 1)
        );
    PRINT 'OK  0007 app.saved_view ready';
END TRY
BEGIN CATCH
    SET @failed += 1;
    PRINT 'FAIL 0007 app.saved_view, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

IF @failed = 0 PRINT '0007_notifications RESULT: ALL 3 TABLES READY';
ELSE PRINT '0007_notifications RESULT: ' + CAST(@failed AS varchar(12)) + ' TABLE(S) FAILED';
