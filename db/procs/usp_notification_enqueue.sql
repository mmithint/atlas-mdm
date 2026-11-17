/* =====================================================================
   app.usp_notification_enqueue   APP-3, INTERNAL (called only by the request procedures;
                                  no function exposes it). FINAL PLAN/03 section 2.3.
   Single statement per file; CREATE OR ALTER, safe to run again.

   Queues one in-app notification for each recipient: one person (@recipient_email), the active
   members of one group (@recipient_group), or both (a person who is also in the group gets ONE
   message). Writes app.notification only; returns no result set (so a caller can use it freely).

   Nobody gets the same message twice: the unique dedup_key is a SHA-256 over topic, request,
   @event_key and recipient (REF-52 analysis section 4.6, "deduplicate recipients per notification").
   Running the same call again therefore adds nothing. Pass an @event_key that is unique to the
   event (for example 'E' + the event id), so a later event of the same kind is a new message.

   Never queued: a system address (system:...), an address without an @, or a member of an inactive
   group. An unknown or empty group (for example UNROUTED) queues nothing and is not an error.
   email_status keeps its default NOT_REQUIRED: e-mail is only built if spike S6 passes (APP-8).
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_notification_enqueue
    @topic           nvarchar(30),
    @request_id      bigint,
    @event_key       nvarchar(60),
    @title           nvarchar(200),
    @body            nvarchar(1000),
    @recipient_email nvarchar(256) = NULL,
    @recipient_group nvarchar(64)  = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @r TABLE (email nvarchar(256) NOT NULL PRIMARY KEY);
    DECLARE @one nvarchar(256) = LOWER(LTRIM(RTRIM(@recipient_email)));

    IF @one IS NOT NULL AND CHARINDEX(N'@', @one) > 1 AND LEFT(@one, 7) <> N'system:'
        INSERT INTO @r (email) VALUES (@one);

    IF @recipient_group IS NOT NULL
        INSERT INTO @r (email)
        SELECT m.user_email
        FROM app.group_membership AS m
        JOIN app.security_group AS g ON g.group_key = m.group_key AND g.is_active = 1
        WHERE m.group_key = @recipient_group
          AND m.is_active = 1
          AND CHARINDEX(N'@', m.user_email) > 1
          AND LEFT(m.user_email, 7) <> N'system:'
          AND NOT EXISTS (SELECT 1 FROM @r AS x WHERE x.email = m.user_email);

    INSERT INTO app.notification (recipient_email, topic, request_id, title, body, dedup_key)
    SELECT r.email, @topic, @request_id, LEFT(@title, 200), LEFT(@body, 1000), k.dedup_key
    FROM @r AS r
    CROSS APPLY (SELECT CONVERT(char(64), HASHBYTES('SHA2_256', CONCAT(@topic, N'|', @request_id, N'|', @event_key, N'|', r.email)), 2) AS dedup_key) AS k
    WHERE NOT EXISTS (SELECT 1 FROM app.notification AS n WHERE n.dedup_key = k.dedup_key);
END
