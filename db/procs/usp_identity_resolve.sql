/* =====================================================================
   app.usp_identity_resolve     APP-1; contract: FINAL PLAN/01 section 6.8
   Single statement per file; CREATE OR ALTER, safe to run again.

   Turns the user id found in the caller's token (the text after /users/ at the end
   of `sub`) into the person's e-mail. The function calls this first, then passes the
   e-mail on as @actor_email to the one business procedure.

   Returns ONE row (user_email, display_name) for an active identity, and NO row for
   an unknown, inactive or empty id: the function then answers NOT_REGISTERED.
   Case and outer spaces in the id are ignored. Reads one table, changes nothing.
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_identity_resolve
    @external_id nvarchar(64)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (1)
        CAST(i.user_email   AS nvarchar(256)) AS user_email,
        CAST(i.display_name AS nvarchar(100)) AS display_name
    FROM app.principal_identity AS i
    WHERE i.external_id = LOWER(LTRIM(RTRIM(@external_id)))
      AND i.is_active = 1
    ORDER BY i.identity_id;
END
