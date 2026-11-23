/* =====================================================================
   t_saved_views.sql       Test: the saved filters of the Equipment screen (S-4)
                           (usp_saved_view_list, usp_saved_view_save, usp_saved_view_delete)
   Needs : migration 0007 (app.saved_view) and the three procedures in db/procs/usp_saved_view_*.sql.
   Needs no seed: it uses two made-up people (addresses ending @example.test) INSIDE ONE TRANSACTION THAT
   IS ROLLED BACK AT THE END, so it leaves nothing behind (the last check proves it).
   Final line: `t_saved_views RESULT: ...`

   Scenarios
     V1  a new name is CREATED; the same name again (in other spacing) REPLACES it, keeping its number
     V2  the list holds only the caller's own views on that screen, by name
     V3  a person cannot delete another person's view (refused like a missing one), and can delete their own
     V4  the refusals: not a person, unknown screen, blank or long name, unreadable definition, the 50-view cap
     V5  the rollback left no test views behind
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL t_saved_views wrong editor: connected to "' + DB_NAME() + '". Open the item named ATLAS_SQL_DB whose type is SQL database. Nothing was run.';
    RETURN;
END
IF OBJECT_ID(N'app.saved_view', N'U') IS NULL
   OR OBJECT_ID(N'app.usp_saved_view_list', N'P') IS NULL
   OR OBJECT_ID(N'app.usp_saved_view_save', N'P') IS NULL
   OR OBJECT_ID(N'app.usp_saved_view_delete', N'P') IS NULL
BEGIN
    PRINT 'FAIL t_saved_views app.saved_view (migration 0007) or a usp_saved_view_* procedure is missing. Nothing was run.';
    RETURN;
END

DECLARE @pass int = 0, @fail int = 0, @err int;
DECLARE @ann nvarchar(256) = N'saved.view.ann@example.test', @bob nvarchar(256) = N'saved.view.bob@example.test';
DECLARE @saved TABLE (saved_view_id int, view_name nvarchar(100), definition_json nvarchar(4000), is_default bit, updated_at_utc datetime2(3), outcome nvarchar(10));
DECLARE @listed TABLE (saved_view_id int, view_name nvarchar(100), definition_json nvarchar(4000), is_default bit, updated_at_utc datetime2(3));
DECLARE @deleted TABLE (saved_view_id int);
DECLARE @first int, @n int;

BEGIN TRANSACTION;

/* ---- V1 create, then replace ------------------------------------------------------ */
INSERT INTO @saved EXEC app.usp_saved_view_save @ann, N'S-4', N'Line heaters', N'{"v":1,"query":{}}';
SELECT @first = saved_view_id FROM @saved WHERE outcome = N'CREATED';
IF @first IS NOT NULL BEGIN SET @pass += 1; PRINT 'PASS V1a a new name is created'; END
ELSE BEGIN SET @fail += 1; PRINT 'FAIL V1a a new name was not created'; END

DELETE FROM @saved;
INSERT INTO @saved EXEC app.usp_saved_view_save @ann, N'S-4', N'  Line heaters ', N'{"v":1,"query":{"size":"25"}}';
IF EXISTS (SELECT 1 FROM @saved WHERE outcome = N'REPLACED' AND saved_view_id = @first AND definition_json LIKE N'%25%')
BEGIN SET @pass += 1; PRINT 'PASS V1b the same name replaces it and keeps its number'; END
ELSE BEGIN SET @fail += 1; PRINT 'FAIL V1b the same name did not replace the view'; END

/* ---- V2 the list is the caller's own, by name -------------------------------------- */
INSERT INTO @saved EXEC app.usp_saved_view_save @ann, N'S-4', N'A first', N'{}';
INSERT INTO @saved EXEC app.usp_saved_view_save @ann, N'S-2', N'Approvals view', N'{}';
INSERT INTO @saved EXEC app.usp_saved_view_save @bob, N'S-4', N'Bob only', N'{}';
INSERT INTO @listed EXEC app.usp_saved_view_list @ann, N'S-4';
IF (SELECT COUNT(*) FROM @listed) = 2
   AND (SELECT TOP (1) view_name FROM @listed ORDER BY view_name) = N'A first'
   AND NOT EXISTS (SELECT 1 FROM @listed WHERE view_name IN (N'Bob only', N'Approvals view'))
BEGIN SET @pass += 1; PRINT 'PASS V2 the list holds only the caller''s own views on that screen'; END
ELSE BEGIN SET @fail += 1; PRINT 'FAIL V2 the list holds other screens'' or other people''s views'; END

/* ---- V3 delete: never another person's, always one's own ---------------------------- */
SET @err = NULL;
BEGIN TRY EXEC app.usp_saved_view_delete @bob, @first; END TRY BEGIN CATCH SET @err = ERROR_NUMBER(); END CATCH;
IF @err = 50346 AND EXISTS (SELECT 1 FROM app.saved_view WHERE saved_view_id = @first)
BEGIN SET @pass += 1; PRINT 'PASS V3a another person cannot delete the view'; END
ELSE BEGIN SET @fail += 1; PRINT 'FAIL V3a another person could delete the view, or was not refused with 50346'; END

INSERT INTO @deleted EXEC app.usp_saved_view_delete @ann, @first;
IF EXISTS (SELECT 1 FROM @deleted WHERE saved_view_id = @first) AND NOT EXISTS (SELECT 1 FROM app.saved_view WHERE saved_view_id = @first)
BEGIN SET @pass += 1; PRINT 'PASS V3b the owner deletes the view'; END
ELSE BEGIN SET @fail += 1; PRINT 'FAIL V3b the owner could not delete the view'; END

/* ---- V4 refusals ------------------------------------------------------------------- */
SET @err = NULL; BEGIN TRY EXEC app.usp_saved_view_list N'system:job', N'S-4'; END TRY BEGIN CATCH SET @err = ERROR_NUMBER(); END CATCH;
IF @err = 50341 BEGIN SET @pass += 1; PRINT 'PASS V4a not a person is refused'; END ELSE BEGIN SET @fail += 1; PRINT 'FAIL V4a not a person was not refused with 50341'; END

SET @err = NULL; BEGIN TRY EXEC app.usp_saved_view_list @ann, N'S-9'; END TRY BEGIN CATCH SET @err = ERROR_NUMBER(); END CATCH;
IF @err = 50342 BEGIN SET @pass += 1; PRINT 'PASS V4b an unknown screen is refused'; END ELSE BEGIN SET @fail += 1; PRINT 'FAIL V4b an unknown screen was not refused with 50342'; END

SET @err = NULL; BEGIN TRY EXEC app.usp_saved_view_save @ann, N'S-4', N'   ', N'{}'; END TRY BEGIN CATCH SET @err = ERROR_NUMBER(); END CATCH;
IF @err = 50343 BEGIN SET @pass += 1; PRINT 'PASS V4c a blank name is refused'; END ELSE BEGIN SET @fail += 1; PRINT 'FAIL V4c a blank name was not refused with 50343'; END

SET @err = NULL; BEGIN TRY EXEC app.usp_saved_view_save @ann, N'S-4', N'Broken', N'not json'; END TRY BEGIN CATCH SET @err = ERROR_NUMBER(); END CATCH;
IF @err = 50344 BEGIN SET @pass += 1; PRINT 'PASS V4d an unreadable definition is refused'; END ELSE BEGIN SET @fail += 1; PRINT 'FAIL V4d an unreadable definition was not refused with 50344'; END

-- fill Ann's S-4 views up to 50, then one more new name must be refused, but replacing one still works
SELECT @n = COUNT(*) FROM app.saved_view WHERE owner_email = @ann AND screen_code = N'S-4';
WHILE @n < 50
BEGIN
    INSERT INTO app.saved_view (owner_email, screen_code, view_name, definition_json) VALUES (@ann, N'S-4', CONCAT(N'Filler ', @n), N'{}');
    SET @n += 1;
END
SET @err = NULL; BEGIN TRY EXEC app.usp_saved_view_save @ann, N'S-4', N'One too many', N'{}'; END TRY BEGIN CATCH SET @err = ERROR_NUMBER(); END CATCH;
DELETE FROM @saved;
INSERT INTO @saved EXEC app.usp_saved_view_save @ann, N'S-4', N'A first', N'{"v":1}';
IF @err = 50345 AND EXISTS (SELECT 1 FROM @saved WHERE outcome = N'REPLACED')
BEGIN SET @pass += 1; PRINT 'PASS V4e the 51st new name is refused, replacing still works'; END
ELSE BEGIN SET @fail += 1; PRINT 'FAIL V4e the 50-view cap does not hold as expected'; END

ROLLBACK TRANSACTION;

/* ---- V5 nothing left behind ------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM app.saved_view WHERE owner_email IN (@ann, @bob))
BEGIN SET @pass += 1; PRINT 'PASS V5 the rollback left no test views behind'; END
ELSE BEGIN SET @fail += 1; PRINT 'FAIL V5 test views were left behind'; END

IF @fail = 0 PRINT CONCAT('t_saved_views RESULT: ALL ', @pass, ' CHECKS PASSED');
ELSE PRINT CONCAT('t_saved_views RESULT: ', @fail, ' OF ', @pass + @fail, ' CHECKS FAILED');
