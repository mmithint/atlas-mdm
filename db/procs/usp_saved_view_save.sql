/* =====================================================================
   app.usp_saved_view_save    Saved filters of the Equipment screen (S-4); function saveView
   Single statement per file; CREATE OR ALTER, safe to run again.
   Writes app.saved_view (migration 0007, section 7.3). Test: db/tests/t_saved_views.sql

   Saves one person's view under a name on one screen. A name the person already uses on that screen
   is replaced (the name is unique per owner and screen: ux_saved_view_name), so saving again under the
   same name updates it. Nobody can write another person's views: the owner is the caller.

   No transaction of its own: each change is one statement, so it can run inside a caller's transaction
   (the test rolls everything back). Two saves of the same new name at once: ux_saved_view_name stops the
   second, which then fails rather than making a duplicate.

   One result set, the row as saved: saved_view_id, view_name, definition_json, is_default, updated_at_utc,
   and outcome CREATED or REPLACED.

   Refusals (THROW): 50341 not a person, 50342 not S-2 or S-4,
                     50343 the name is blank or longer than 100 characters,
                     50344 the definition is not JSON or longer than 4000 characters,
                     50345 the person already has 50 views on this screen (a new name only).
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_saved_view_save
    @actor_email     nvarchar(256),
    @screen_code     nvarchar(10),
    @view_name       nvarchar(200),
    @definition_json nvarchar(max)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @actor nvarchar(256) = LOWER(LTRIM(RTRIM(@actor_email)));
    DECLARE @name nvarchar(200) = LTRIM(RTRIM(@view_name));

    IF @actor IS NULL OR CHARINDEX(N'@', @actor) < 2 OR LEFT(@actor, 7) = N'system:'
        THROW 50341, N'Saved filters belong to a person (an e-mail address).', 1;
    IF @screen_code IS NULL OR @screen_code NOT IN (N'S-2', N'S-4')
        THROW 50342, N'Saved filters exist only for the Approvals (S-2) and Equipment (S-4) screens.', 1;
    IF @name IS NULL OR @name = N'' OR LEN(@name) > 100
        THROW 50343, N'Give the filter a name of 1 to 100 characters.', 1;
    IF @definition_json IS NULL OR LEN(@definition_json) > 4000 OR ISJSON(@definition_json) <> 1
        THROW 50344, N'The filter could not be saved: its settings are too long or not readable.', 1;

    DECLARE @id int, @outcome nvarchar(10);

    UPDATE app.saved_view
    SET definition_json = @definition_json, updated_at_utc = SYSUTCDATETIME(), @id = saved_view_id
    WHERE owner_email = @actor AND screen_code = @screen_code AND view_name = @name;

    IF @id IS NOT NULL
        SET @outcome = N'REPLACED';
    ELSE
    BEGIN
        IF (SELECT COUNT(*) FROM app.saved_view WHERE owner_email = @actor AND screen_code = @screen_code) >= 50
            THROW 50345, N'You already have 50 saved filters on this screen. Delete one to save another.', 1;
        INSERT INTO app.saved_view (owner_email, screen_code, view_name, definition_json)
        VALUES (@actor, @screen_code, @name, @definition_json);
        SET @id = CAST(SCOPE_IDENTITY() AS int);
        SET @outcome = N'CREATED';
    END

    SELECT v.saved_view_id, v.view_name, v.definition_json, v.is_default, v.updated_at_utc, @outcome AS outcome
    FROM app.saved_view AS v
    WHERE v.saved_view_id = @id;
END
