/* =====================================================================
   app.usp_notification_list    APP-4, read path C (D-17); the notification bell (S-12 is APP-8); function getMyNotifications
   Single statement per file; CREATE OR ALTER, safe to run again.
   Reads only. Test: db/tests/t_request_reads.sql

   The in-app notifications of one person (queued by app.usp_notification_enqueue since APP-3): how many are not
   yet marked read, and the newest ones. Notifications are personal data, so this is read through a function with
   the caller's own e-mail, never through the connector. Marking them read is APP-8 (until then the count only
   grows).

   Two result sets, always in this order:
     1  one row: unread_count
     2  the newest @limit notifications, newest first: notification_id, topic, request_id, request_ref, title, body,
        created_at_utc, is_read

   @only_set (testing aid, NULL = all): return only that numbered result set, so a test can read each set with
   INSERT ... EXEC, which cannot capture sets of different shapes. The functions never pass it.

   Refusals (THROW): 50321 limit outside 1 to 50, 50322 the list is for a person (blank, no @, or a system: address).
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_notification_list
    @actor_email nvarchar(256),
    @limit       int = 20,
    @only_set    tinyint = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @actor nvarchar(256) = LOWER(LTRIM(RTRIM(@actor_email)));
    IF @actor IS NULL OR CHARINDEX(N'@', @actor) < 2 OR LEFT(@actor, 7) = N'system:'
        THROW 50322, N'Notifications belong to a person (an e-mail address).', 1;
    IF @limit IS NULL OR @limit < 1 OR @limit > 50
        THROW 50321, N'The limit must be from 1 to 50.', 1;

    IF @only_set IS NULL OR @only_set = 1
    SELECT CAST(COUNT(*) AS int) AS unread_count
    FROM app.notification AS n
    WHERE n.recipient_email = @actor AND n.read_at_utc IS NULL;

    IF @only_set IS NULL OR @only_set = 2
    SELECT TOP (@limit)
        n.notification_id, n.topic, n.request_id, r.request_ref, n.title, n.body, n.created_at_utc,
        CAST(CASE WHEN n.read_at_utc IS NULL THEN 0 ELSE 1 END AS bit) AS is_read
    FROM app.notification AS n
    LEFT JOIN app.change_request AS r ON r.request_id = n.request_id
    WHERE n.recipient_email = @actor
    ORDER BY n.created_at_utc DESC, n.notification_id DESC;
END
