/* =====================================================================
   app.usp_equipment_search     APP-2, read path C (decided 15 Nov, D-17); screen S-4
   Single statement per file; CREATE OR ALTER, safe to run again.
   Called by the function searchEquipment. Needs app.vw_equipment_search.
   Test: db/tests/t_equipment_read.sql

   Why a procedure: the connector cannot read views (spike S7, 14-15 Nov), so the browser
   reaches the search view through a function that runs this procedure. The search RULES
   live here, not in the browser: which columns can be searched, the closest-match order,
   the row caps, the paging.

   One result set: the rows, in the column order of app.vw_equipment_search (29 columns).
   Three OUTPUT values describe it:
     @total_matches  SORTED: every heater that matches the text and facility (all pages).
                     MATCH:  the rows returned (after the caps).
     @has_more       SORTED: another page follows this one. MATCH: always 0.
     @truncated      MATCH: at least one closeness tier held more rows than its cap, so
                     there may be more matches than were returned. SORTED: always 0.

   @mode
     MATCH   a text was typed and no sort chosen: closest matches first (POC-APP-05).
             Tier 1 = the value equals the text, tier 2 = starts with it, tier 3 = merely
             contains it. Rows come tier by tier, each tier ordered by the searched column,
             then equipment number. Each tier is capped (200 / 500 / 500) so one broad text
             cannot return the whole table. @offset and @page_size are not used: the
             screen pages through the returned list itself.
     SORTED  one list in the order of a chosen column, read page by page with @offset and
             @page_size (1 to 100). A text, if there is one, is a "contains" filter.

   @search_column  one of the eight columns people can search (POC-APP-05); anything else
                   is refused. @sort_column may be any column of the view. Both are checked
                   against fixed lists or sys.columns and then written with QUOTENAME, and
                   every value goes in as a parameter, so no caller text becomes SQL.
   @facility       only heaters under this parent FLOC (the facility drill-down); empty = all.

   The text is matched literally: % _ and [ typed by the person are escaped. Comparison
   follows the database collation (case-insensitive on this database).

   Paging is stable: every order ends with equipment_id, so a column that is not unique
   (manufacturer, say) never repeats or drops a heater between pages.

   Errors (THROW): 50010 view missing, 50011 bad mode, 50012 bad direction, 50013 bad
   offset or page size, 50014 column not searchable, 50015 MATCH without text, 50016 sort
   column unknown.
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_equipment_search
    @mode           varchar(8),
    @search_column  varchar(40),
    @search_text    nvarchar(100) = N'',
    @facility       nvarchar(40)  = N'',
    @sort_column    varchar(40)   = 'equipment_number',
    @sort_direction varchar(4)    = 'ASC',
    @offset         int           = 0,
    @page_size      int           = 50,
    @total_matches  int OUTPUT,
    @has_more       bit OUTPUT,
    @truncated      bit OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    /* the rules in numbers */
    DECLARE @cap_exact    int = 200;
    DECLARE @cap_starts   int = 500;
    DECLARE @cap_contains int = 500;
    DECLARE @max_page     int = 100;

    DECLARE @view_id int = OBJECT_ID(N'app.vw_equipment_search', N'V');

    SET @mode           = UPPER(LTRIM(RTRIM(ISNULL(@mode, ''))));
    SET @search_column  = LTRIM(RTRIM(ISNULL(@search_column, '')));
    SET @search_text    = LTRIM(RTRIM(ISNULL(@search_text, N'')));
    SET @facility       = LTRIM(RTRIM(ISNULL(@facility, N'')));
    SET @sort_column    = LTRIM(RTRIM(ISNULL(@sort_column, '')));
    SET @sort_direction = UPPER(LTRIM(RTRIM(ISNULL(@sort_direction, 'ASC'))));
    SET @offset         = ISNULL(@offset, 0);
    SET @page_size      = ISNULL(@page_size, 50);

    SET @total_matches = 0;
    SET @has_more      = 0;
    SET @truncated     = 0;

    /* ---- checks ----------------------------------------------------------- */
    IF @view_id IS NULL
        THROW 50010, N'app.vw_equipment_search is missing: run the APP-2 views stage first.', 1;
    IF @mode NOT IN ('MATCH', 'SORTED')
        THROW 50011, N'mode must be MATCH or SORTED.', 1;
    IF @sort_direction NOT IN ('ASC', 'DESC')
        THROW 50012, N'sort direction must be ASC or DESC.', 1;
    IF @offset < 0 OR @page_size < 1 OR @page_size > @max_page
        THROW 50013, N'offset must be 0 or more and page size 1 to 100.', 1;
    IF @search_column NOT IN ('equipment_tag_number', 'manufacturer_serial_number', 'equipment_number',
                              'functional_location', 'manufacturer', 'equip_class', 'floc_class', 'profit_center_name')
        THROW 50014, N'that column cannot be searched.', 1;
    IF @mode = 'MATCH' AND @search_text = N''
        THROW 50015, N'MATCH needs a search text.', 1;
    IF NOT EXISTS (SELECT 1 FROM sys.columns AS c WHERE c.object_id = @view_id AND c.name = @sort_column)
        THROW 50016, N'unknown sort column.', 1;

    /* ---- the pieces of the query ------------------------------------------ */
    DECLARE @col  nvarchar(130) = QUOTENAME(@search_column);
    DECLARE @sort nvarchar(130) = QUOTENAME(@sort_column);
    DECLARE @dir  nvarchar(4)   = CASE WHEN @sort_direction = 'DESC' THEN N'DESC' ELSE N'ASC' END;
    DECLARE @esc  nvarchar(400) = REPLACE(REPLACE(REPLACE(REPLACE(@search_text, N'\', N'\\'), N'%', N'\%'), N'_', N'\_'), N'[', N'\[');

    /* every column of the view, in its own order (so the result follows the view) */
    DECLARE @cols nvarchar(max);
    SELECT @cols = STRING_AGG(CAST(QUOTENAME(c.name) AS nvarchar(max)), N', ') WITHIN GROUP (ORDER BY c.column_id)
    FROM sys.columns AS c
    WHERE c.object_id = @view_id;

    DECLARE @filter nvarchar(max) = N'(@facility = N'''' OR v.superior_functional_location = @facility)';
    IF @search_text <> N''
        SET @filter = @filter + N' AND v.' + @col + N' LIKE N''%'' + @esc + N''%'' ESCAPE N''\''';

    DECLARE @sql nvarchar(max);
    DECLARE @n int = 0, @flag int = 0;

    DECLARE @p_count nvarchar(400) =
        N'@text nvarchar(100), @esc nvarchar(400), @facility nvarchar(40), @cap1 int, @cap2 int, @cap3 int, @total int OUTPUT, @trunc int OUTPUT';
    DECLARE @p_rows nvarchar(400) =
        N'@text nvarchar(100), @esc nvarchar(400), @facility nvarchar(40), @cap1 int, @cap2 int, @cap3 int, @offset int, @page_size int';

    /* ---- MATCH: closest first --------------------------------------------- */
    IF @mode = 'MATCH'
    BEGIN
        DECLARE @hits nvarchar(max) =
            N'WITH hits AS (SELECT v.*, CASE WHEN v.' + @col + N' = @text THEN 1'
            + N' WHEN v.' + @col + N' LIKE @esc + N''%'' ESCAPE N''\'' THEN 2 ELSE 3 END AS tier'
            + N' FROM app.vw_equipment_search AS v WHERE ' + @filter + N')';

        -- how many rows come back, and did any tier overflow its cap
        SET @sql = @hits
            + N' SELECT @total = ISNULL(SUM(CASE t.tier WHEN 1 THEN CASE WHEN t.n > @cap1 THEN @cap1 ELSE t.n END'
            + N' WHEN 2 THEN CASE WHEN t.n > @cap2 THEN @cap2 ELSE t.n END'
            + N' ELSE CASE WHEN t.n > @cap3 THEN @cap3 ELSE t.n END END), 0),'
            + N' @trunc = ISNULL(MAX(CASE WHEN (t.tier = 1 AND t.n > @cap1) OR (t.tier = 2 AND t.n > @cap2) OR (t.tier = 3 AND t.n > @cap3) THEN 1 ELSE 0 END), 0)'
            + N' FROM (SELECT tier, COUNT(*) AS n FROM hits GROUP BY tier) AS t';
        EXEC sp_executesql @sql, @p_count,
            @text = @search_text, @esc = @esc, @facility = @facility,
            @cap1 = @cap_exact, @cap2 = @cap_starts, @cap3 = @cap_contains,
            @total = @n OUTPUT, @trunc = @flag OUTPUT;
        SET @total_matches = @n;
        SET @truncated     = CASE WHEN @flag = 1 THEN 1 ELSE 0 END;

        -- the rows: tier by tier, each tier in the order of the searched column, then equipment
        -- number, then equipment id. A column may appear only once in an ORDER BY, so when the
        -- searched column IS the equipment number it is not listed a second time.
        DECLARE @ties_h nvarchar(100) = CASE WHEN @search_column = 'equipment_number' THEN N'h.equipment_id' ELSE N'h.equipment_number, h.equipment_id' END;
        DECLARE @ties_r nvarchar(100) = CASE WHEN @search_column = 'equipment_number' THEN N'r.equipment_id' ELSE N'r.equipment_number, r.equipment_id' END;
        SET @sql = @hits
            + N', ranked AS (SELECT h.*, ROW_NUMBER() OVER (PARTITION BY h.tier ORDER BY h.' + @col + N', ' + @ties_h + N') AS rn FROM hits AS h)'
            + N' SELECT ' + @cols + N' FROM ranked AS r'
            + N' WHERE r.rn <= CASE r.tier WHEN 1 THEN @cap1 WHEN 2 THEN @cap2 ELSE @cap3 END'
            + N' ORDER BY r.tier, r.' + @col + N', ' + @ties_r;
        EXEC sp_executesql @sql, @p_rows,
            @text = @search_text, @esc = @esc, @facility = @facility,
            @cap1 = @cap_exact, @cap2 = @cap_starts, @cap3 = @cap_contains,
            @offset = @offset, @page_size = @page_size;
        RETURN;
    END

    /* ---- SORTED: one column order, page by page ---------------------------- */
    SET @sql = N'SELECT @total = COUNT(*) FROM app.vw_equipment_search AS v WHERE ' + @filter;
    EXEC sp_executesql @sql, @p_count,
        @text = @search_text, @esc = @esc, @facility = @facility,
        @cap1 = @cap_exact, @cap2 = @cap_starts, @cap3 = @cap_contains,
        @total = @n OUTPUT, @trunc = @flag OUTPUT;
    SET @total_matches = @n;
    SET @has_more      = CASE WHEN @offset + @page_size < @n THEN 1 ELSE 0 END;

    SET @sql = N'SELECT ' + @cols + N' FROM app.vw_equipment_search AS v WHERE ' + @filter
        + N' ORDER BY v.' + @sort + N' ' + @dir
        + CASE WHEN @sort_column = 'equipment_id' THEN N'' ELSE N', v.equipment_id' END
        + N' OFFSET @offset ROWS FETCH NEXT @page_size ROWS ONLY';
    EXEC sp_executesql @sql, @p_rows,
        @text = @search_text, @esc = @esc, @facility = @facility,
        @cap1 = @cap_exact, @cap2 = @cap_starts, @cap3 = @cap_contains,
        @offset = @offset, @page_size = @page_size;
END
