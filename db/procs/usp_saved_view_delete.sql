/* =====================================================================
   app.usp_saved_view_delete    Saved filters of the Equipment screen (S-4); function deleteSavedView
   Single statement per file; CREATE OR ALTER, safe to run again.
   Writes app.saved_view (migration 0007, section 7.3).

   Deletes one of the caller's own saved views. Another person's view, or one already gone, is refused
   with the same words, so the answer never tells whether someone else's view exists.

   One result set: saved_view_id of the deleted view.

   Refusals (THROW): 50341 not a person, 50346 no such saved view of yours.
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_saved_view_delete
    @actor_email   nvarchar(256),
    @saved_view_id int
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @actor nvarchar(256) = LOWER(LTRIM(RTRIM(@actor_email)));
    IF @actor IS NULL OR CHARINDEX(N'@', @actor) < 2 OR LEFT(@actor, 7) = N'system:'
        THROW 50341, N'Saved filters belong to a person (an e-mail address).', 1;

    DELETE FROM app.saved_view
    WHERE saved_view_id = @saved_view_id AND owner_email = @actor;

    IF @@ROWCOUNT = 0
        THROW 50346, N'That saved filter no longer exists. Refresh the list.', 1;

    SELECT @saved_view_id AS saved_view_id;
END
