/* =====================================================================
   app.usp_saved_view_list    Saved filters of the Equipment screen (S-4); function listSavedViews
   Single statement per file; CREATE OR ALTER, safe to run again.
   Reads only. Table: app.saved_view (migration 0007, section 7.3).

   The saved views of one person on one screen, by name. A saved view is personal, so it is read
   through a function with the caller's own e-mail, never through the connector.

   One result set: saved_view_id, view_name, definition_json, is_default, updated_at_utc.

   Refusals (THROW): 50341 the list is for a person (blank, no @, or a system: address),
                     50342 the screen is not S-2 or S-4.
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_saved_view_list
    @actor_email nvarchar(256),
    @screen_code nvarchar(10)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @actor nvarchar(256) = LOWER(LTRIM(RTRIM(@actor_email)));
    IF @actor IS NULL OR CHARINDEX(N'@', @actor) < 2 OR LEFT(@actor, 7) = N'system:'
        THROW 50341, N'Saved filters belong to a person (an e-mail address).', 1;
    IF @screen_code IS NULL OR @screen_code NOT IN (N'S-2', N'S-4')
        THROW 50342, N'Saved filters exist only for the Approvals (S-2) and Equipment (S-4) screens.', 1;

    SELECT v.saved_view_id, v.view_name, v.definition_json, v.is_default, v.updated_at_utc
    FROM app.saved_view AS v
    WHERE v.owner_email = @actor AND v.screen_code = @screen_code
    ORDER BY v.view_name, v.saved_view_id;
END
