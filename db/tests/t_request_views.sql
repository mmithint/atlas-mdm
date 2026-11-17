/* =====================================================================
   t_request_views.sql       APP-3 test: app.vw_request_queue, vw_request_detail, vw_request_event,
                             vw_equipment_request  (FINAL PLAN/09 section 9)
   Needs : migrations 0001-0007, seeds 0101-0109, the APP-3 stage (functions, procedures, views), the gold
           views. Part V1 (columns) reads only. Part V2 (rows) needs the SYNTHETIC gold stub and is skipped,
           with an INFO line, when the real gold has replaced it; it makes one test person and three requests
           INSIDE A TRANSACTION THAT IS ROLLED BACK, so it leaves nothing behind.
   Final line: `t_request_views RESULT: ...`

   Checks
     V1  each view has exactly the columns of 09 section 9 with the right types, its key is reported as not
         nullable, and no column is (max) (the long JSON stays inside the database)
     V2  rows: the queue view shows a new request with its stage, label, source, tag, age and zero photos;
         the detail view adds the creation comment and the merge facts; the event view lists the events;
         the equipment view counts overlapping open requests on the same field and drops the count when one
         of them is withdrawn
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL t_request_views wrong editor: connected to "' + DB_NAME() + '". Open the item named ATLAS_SQL_DB whose type is SQL database. Nothing was run.';
    RETURN;
END
IF OBJECT_ID(N'app.vw_request_queue', N'V') IS NULL OR OBJECT_ID(N'app.vw_request_detail', N'V') IS NULL
   OR OBJECT_ID(N'app.vw_request_event', N'V') IS NULL OR OBJECT_ID(N'app.vw_equipment_request', N'V') IS NULL
BEGIN
    PRINT 'FAIL t_request_views a request view is missing: run the APP-3 stage 1 bundle (app3_1_request_objects) first. Nothing was run.';
    RETURN;
END

DECLARE @checks int = 0, @fails int = 0;
DECLARE @problems nvarchar(2000), @n int, @n2 int;

DECLARE @exp TABLE (view_name sysname NOT NULL, col_name sysname NOT NULL, col_type nvarchar(40) NOT NULL, PRIMARY KEY (view_name, col_name));
INSERT INTO @exp (view_name, col_name, col_type) VALUES
    (N'vw_request_queue', N'request_id', N'bigint'), (N'vw_request_queue', N'request_ref', N'nvarchar(12)'),
    (N'vw_request_queue', N'request_status', N'nvarchar(24)'), (N'vw_request_queue', N'approval_stage', N'nvarchar(12)'),
    (N'vw_request_queue', N'entity_type', N'nvarchar(10)'), (N'vw_request_queue', N'equipment_id', N'int'),
    (N'vw_request_queue', N'equipment_number', N'nvarchar(18)'), (N'vw_request_queue', N'functional_location', N'nvarchar(40)'),
    (N'vw_request_queue', N'equipment_tag_number', N'nvarchar(30)'), (N'vw_request_queue', N'profit_center_name', N'nvarchar(40)'),
    (N'vw_request_queue', N'field_code', N'nvarchar(64)'), (N'vw_request_queue', N'field_label', N'nvarchar(100)'),
    (N'vw_request_queue', N'sap_field', N'nvarchar(40)'), (N'vw_request_queue', N'old_value', N'nvarchar(400)'),
    (N'vw_request_queue', N'new_value', N'nvarchar(400)'), (N'vw_request_queue', N'reason', N'nvarchar(400)'),
    (N'vw_request_queue', N'note', N'nvarchar(200)'), (N'vw_request_queue', N'source_type', N'nvarchar(20)'),
    (N'vw_request_queue', N'source_rule_id', N'nvarchar(64)'), (N'vw_request_queue', N'source_rule_version', N'int'),
    (N'vw_request_queue', N'source_label', N'nvarchar(120)'), (N'vw_request_queue', N'requested_by', N'nvarchar(256)'),
    (N'vw_request_queue', N'requested_at_utc', N'datetime2(3)'), (N'vw_request_queue', N'detected_at_utc', N'datetime2(3)'),
    (N'vw_request_queue', N'responsible_group', N'nvarchar(64)'), (N'vw_request_queue', N'accountable_group', N'nvarchar(64)'),
    (N'vw_request_queue', N'return_recipient_type', N'nvarchar(10)'), (N'vw_request_queue', N'return_recipient', N'nvarchar(256)'),
    (N'vw_request_queue', N'age_hours', N'int'), (N'vw_request_queue', N'photo_count', N'int'),
    (N'vw_request_queue', N'updated_at_utc', N'datetime2(3)'),

    (N'vw_request_detail', N'request_id', N'bigint'), (N'vw_request_detail', N'request_ref', N'nvarchar(12)'),
    (N'vw_request_detail', N'request_status', N'nvarchar(24)'), (N'vw_request_detail', N'approval_stage', N'nvarchar(12)'),
    (N'vw_request_detail', N'entity_type', N'nvarchar(10)'), (N'vw_request_detail', N'equipment_id', N'int'),
    (N'vw_request_detail', N'equipment_number', N'nvarchar(18)'), (N'vw_request_detail', N'functional_location', N'nvarchar(40)'),
    (N'vw_request_detail', N'equipment_tag_number', N'nvarchar(30)'), (N'vw_request_detail', N'profit_center_name', N'nvarchar(40)'),
    (N'vw_request_detail', N'field_code', N'nvarchar(64)'), (N'vw_request_detail', N'field_label', N'nvarchar(100)'),
    (N'vw_request_detail', N'sap_field', N'nvarchar(40)'), (N'vw_request_detail', N'old_value', N'nvarchar(400)'),
    (N'vw_request_detail', N'new_value', N'nvarchar(400)'), (N'vw_request_detail', N'reason', N'nvarchar(400)'),
    (N'vw_request_detail', N'note', N'nvarchar(200)'), (N'vw_request_detail', N'source_type', N'nvarchar(20)'),
    (N'vw_request_detail', N'source_rule_id', N'nvarchar(64)'), (N'vw_request_detail', N'source_rule_version', N'int'),
    (N'vw_request_detail', N'source_label', N'nvarchar(120)'), (N'vw_request_detail', N'requested_by', N'nvarchar(256)'),
    (N'vw_request_detail', N'requested_at_utc', N'datetime2(3)'), (N'vw_request_detail', N'detected_at_utc', N'datetime2(3)'),
    (N'vw_request_detail', N'responsible_group', N'nvarchar(64)'), (N'vw_request_detail', N'accountable_group', N'nvarchar(64)'),
    (N'vw_request_detail', N'return_recipient_type', N'nvarchar(10)'), (N'vw_request_detail', N'return_recipient', N'nvarchar(256)'),
    (N'vw_request_detail', N'age_hours', N'int'), (N'vw_request_detail', N'photo_count', N'int'),
    (N'vw_request_detail', N'updated_at_utc', N'datetime2(3)'),
    (N'vw_request_detail', N'class_code', N'nvarchar(30)'), (N'vw_request_detail', N'route_id', N'int'),
    (N'vw_request_detail', N'creation_comment', N'nvarchar(1000)'), (N'vw_request_detail', N'last_decision_by', N'nvarchar(256)'),
    (N'vw_request_detail', N'last_decision_at_utc', N'datetime2(3)'), (N'vw_request_detail', N'merge_outcome', N'nvarchar(16)'),
    (N'vw_request_detail', N'merged_at_utc', N'datetime2(3)'), (N'vw_request_detail', N'golden_version_id', N'int'),
    (N'vw_request_detail', N'exported_at_utc', N'datetime2(3)'), (N'vw_request_detail', N'evolve_batch_id', N'bigint'),
    (N'vw_request_detail', N'evolve_row_number', N'int'),

    (N'vw_request_event', N'event_id', N'bigint'), (N'vw_request_event', N'request_id', N'bigint'),
    (N'vw_request_event', N'event_type', N'nvarchar(24)'), (N'vw_request_event', N'approval_stage', N'nvarchar(12)'),
    (N'vw_request_event', N'actor', N'nvarchar(256)'), (N'vw_request_event', N'actor_group', N'nvarchar(64)'),
    (N'vw_request_event', N'occurred_at_utc', N'datetime2(3)'), (N'vw_request_event', N'comments', N'nvarchar(1000)'),
    (N'vw_request_event', N'status_from', N'nvarchar(24)'), (N'vw_request_event', N'status_to', N'nvarchar(24)'),

    (N'vw_equipment_request', N'request_id', N'bigint'), (N'vw_equipment_request', N'equipment_id', N'int'),
    (N'vw_equipment_request', N'functional_location', N'nvarchar(40)'), (N'vw_equipment_request', N'field_code', N'nvarchar(64)'),
    (N'vw_equipment_request', N'field_label', N'nvarchar(100)'), (N'vw_equipment_request', N'request_ref', N'nvarchar(12)'),
    (N'vw_equipment_request', N'request_status', N'nvarchar(24)'), (N'vw_equipment_request', N'is_open', N'bit'),
    (N'vw_equipment_request', N'source_label', N'nvarchar(120)'), (N'vw_equipment_request', N'requested_at_utc', N'datetime2(3)'),
    (N'vw_equipment_request', N'other_open_requests_same_field', N'int');

DECLARE @views TABLE (seq int IDENTITY(1,1) NOT NULL PRIMARY KEY, view_name sysname NOT NULL, key_col sysname NOT NULL);
INSERT INTO @views (view_name, key_col) VALUES
    (N'vw_request_queue', N'request_id'), (N'vw_request_detail', N'request_id'),
    (N'vw_request_event', N'event_id'), (N'vw_equipment_request', N'request_id');

DECLARE @d TABLE (column_ordinal int NULL, name sysname NULL, system_type_name nvarchar(256) NULL, is_nullable bit NULL, error_message nvarchar(4000) NULL);
DECLARE @vn sysname, @kc sysname, @sqlt nvarchar(400), @vi int = 1;

WHILE @vi <= 4
BEGIN
    SELECT @vn = v.view_name, @kc = v.key_col FROM @views AS v WHERE v.seq = @vi;
    BEGIN TRY
        SET @checks += 1;
        DELETE FROM @d;
        SET @sqlt = N'SELECT * FROM app.' + @vn;
        INSERT INTO @d (column_ordinal, name, system_type_name, is_nullable, error_message)
        SELECT column_ordinal, name, system_type_name, is_nullable, error_message
        FROM sys.dm_exec_describe_first_result_set(@sqlt, NULL, 0);

        SET @problems = NULL;
        IF EXISTS (SELECT 1 FROM @d WHERE error_message IS NOT NULL)
            SELECT TOP (1) @problems = N'SQL Server cannot describe the view: ' + error_message FROM @d WHERE error_message IS NOT NULL;
        ELSE
            SELECT @problems = STRING_AGG(CAST(x.msg AS nvarchar(max)), N'; ')
            FROM
            (
                SELECT e.col_name + N': ' + CASE WHEN d.name IS NULL THEN N'missing' ELSE N'type is ' + ISNULL(d.system_type_name, N'?') + N', expected ' + e.col_type END AS msg
                FROM @exp AS e
                LEFT JOIN @d AS d ON d.name COLLATE Latin1_General_BIN2 = e.col_name COLLATE Latin1_General_BIN2
                WHERE e.view_name = @vn AND (d.name IS NULL OR d.system_type_name <> e.col_type)
                UNION ALL
                SELECT d.name + N': not in 09 section 9' FROM @d AS d
                WHERE NOT EXISTS (SELECT 1 FROM @exp AS e WHERE e.view_name = @vn AND e.col_name COLLATE Latin1_General_BIN2 = d.name COLLATE Latin1_General_BIN2)
            ) AS x;
        SELECT @n = COUNT(*) FROM @d WHERE system_type_name LIKE N'%(max)%';
        SELECT @n2 = COUNT(*) FROM @d WHERE name = @kc AND is_nullable = 0;
        IF @n <> 0 SET @problems = ISNULL(@problems + N'; ', N'') + CAST(@n AS nvarchar(10)) + N' (max) column(s)';
        IF @n2 <> 1 SET @problems = ISNULL(@problems + N'; ', N'') + N'the key ' + @kc + N' is reported as nullable';

        IF @problems IS NULL PRINT 'OK  V1 ' + @vn + ': exactly the columns of 09 section 9 with the right types, key ' + @kc + ' not nullable, no (max) column';
        ELSE BEGIN SET @fails += 1; PRINT 'FAIL V1 ' + @vn + ': ' + LEFT(@problems, 1500); END
    END TRY
    BEGIN CATCH
        SET @fails += 1;
        PRINT 'FAIL V1 ' + @vn + ' error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    END CATCH;
    SET @vi += 1;
END

/* ---- V2 rows (synthetic stub only; rolled back) ----------------------------------------------- */
IF OBJECT_ID(N'gold.vw_equipment_current', N'V') IS NULL OR OBJECT_DEFINITION(OBJECT_ID(N'gold.vw_equipment_current')) NOT LIKE N'%ATLAS-STUB%'
   OR OBJECT_ID(N'app.usp_request_create', N'P') IS NULL OR OBJECT_ID(N'app.usp_request_cancel', N'P') IS NULL OR OBJECT_ID(N'app.usp_request_record_merge', N'P') IS NULL
BEGIN
    PRINT 'INFO V2 skipped: it needs the synthetic gold stub and the APP-3 procedures (real gold has replaced the stub, or the procedures are not installed).';
END
ELSE
BEGIN
    DECLARE @u nvarchar(256) = N't3v.requester@example.test';
    DECLARE @eid int, @eqnum nvarchar(18), @tag nvarchar(30), @cur nvarchar(400), @id bigint, @id2 bigint, @id3 bigint, @out nvarchar(24);
    DECLARE @s nvarchar(400), @s2 nvarchar(400), @a int, @b int;
    SELECT TOP (1) @eid = e.equipment_id, @eqnum = e.equipment_number, @tag = e.equipment_tag_number, @cur = e.manufacturer
    FROM gold.vw_equipment_current AS e
    WHERE e.equipment_number LIKE N'SYN-EQ-2%' AND e.equipment_tag_number IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM app.change_request AS r WHERE r.equipment_id = e.equipment_id
                      AND r.request_status <> N'APPROVED' AND r.request_status <> N'REJECTED' AND r.request_status <> N'CANCELLED')
    ORDER BY e.equipment_id;

    BEGIN TRANSACTION;
    BEGIN TRY
        SET @checks += 1;
        SET @problems = N'';
        INSERT INTO app.principal_identity (external_id, user_email, display_name, is_active, bound_by)
        VALUES (N'00000000-0000-4000-8000-0000000003b1', @u, N'T3V requester', 1, N'test:t_request_views');

        EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T3V MFR',
            @reason = N'T3V views', @requested_by = @u, @equipment_id = @eid, @old_value = @cur, @comment = N'first look',
            @emit_result = 0, @o_request_id = @id OUTPUT, @o_outcome = @out OUTPUT;
        IF @out <> N'CREATED' SET @problems += N' create gave ' + ISNULL(@out, N'NULL') + N';';

        -- the queue view
        SELECT @s = approval_stage, @s2 = field_label, @n = age_hours, @n2 = photo_count FROM app.vw_request_queue WHERE request_id = @id;
        IF @s <> N'RESPONSIBLE' OR @s2 <> N'Manufacturer' OR @n < 0 OR @n2 <> 0 SET @problems += N' queue row: stage ' + ISNULL(@s, N'NULL') + N', label ' + ISNULL(@s2, N'NULL') + N', age ' + ISNULL(CAST(@n AS nvarchar(10)), N'NULL') + N', photos ' + ISNULL(CAST(@n2 AS nvarchar(10)), N'NULL') + N';';
        IF NOT EXISTS (SELECT 1 FROM app.vw_request_queue WHERE request_id = @id AND source_label = N'Manual request' AND equipment_number = @eqnum
                       AND equipment_tag_number = @tag AND request_status = N'PENDING_RESPONSIBLE' AND new_value = N'T3V MFR' AND detected_at_utc IS NULL)
            SET @problems += N' queue row: source label, number, tag, status or value differ;';
        SELECT @n = COUNT(*) FROM app.vw_request_queue WHERE request_id = @id;
        IF @n <> 1 SET @problems += N' the queue view has ' + CAST(@n AS nvarchar(10)) + N' rows for one request;';

        -- the detail view: the same row plus the creation comment, nothing merged yet
        IF NOT EXISTS (SELECT 1 FROM app.vw_request_detail WHERE request_id = @id AND creation_comment = N'first look' AND last_decision_by IS NULL
                       AND merge_outcome IS NULL AND merged_at_utc IS NULL AND exported_at_utc IS NULL AND class_code IS NOT NULL)
            SET @problems += N' detail row: creation comment, decision or merge facts differ;';

        -- the event view
        SELECT @n = COUNT(*) FROM app.vw_request_event WHERE request_id = @id AND event_type = N'CREATED' AND status_to = N'PENDING_RESPONSIBLE';
        IF @n <> 1 SET @problems += N' the event view does not show the CREATED event;';

        -- the equipment view: one open request, no overlap; a second open request on the same field overlaps it
        SELECT @a = other_open_requests_same_field FROM app.vw_equipment_request WHERE request_id = @id AND is_open = 1;
        IF @a <> 0 SET @problems += N' overlap flag is ' + ISNULL(CAST(@a AS nvarchar(10)), N'NULL') + N' for a lone request;';
        -- a second open request for the same field, written straight into the table (the procedure would block it)
        INSERT INTO app.change_request (entity_type, equipment_id, equipment_number, functional_location, profit_center_name, class_code, request_action,
                                        source_type, field_code, old_value, new_value, reason, requested_by, request_status, responsible_group, accountable_group, route_id, deduplication_key)
        SELECT r.entity_type, r.equipment_id, r.equipment_number, r.functional_location, r.profit_center_name, r.class_code, r.request_action,
               r.source_type, r.field_code, r.old_value, N'T3V OTHER', r.reason, r.requested_by, N'PENDING_RESPONSIBLE', r.responsible_group, r.accountable_group, r.route_id,
               CONVERT(char(64), HASHBYTES('SHA2_256', N't3v overlap'), 2)
        FROM app.change_request AS r WHERE r.request_id = @id;
        SET @id2 = SCOPE_IDENTITY();
        SELECT @a = other_open_requests_same_field FROM app.vw_equipment_request WHERE request_id = @id;
        SELECT @b = other_open_requests_same_field FROM app.vw_equipment_request WHERE request_id = @id2;
        IF @a <> 1 OR @b <> 1 SET @problems += N' overlap flags ' + ISNULL(CAST(@a AS nvarchar(10)), N'NULL') + N' / ' + ISNULL(CAST(@b AS nvarchar(10)), N'NULL') + N' (expected 1 and 1);';
        -- withdrawing one clears the flag of the other and closes its own row
        EXEC app.usp_request_cancel @request_id = @id2, @actor_email = @u, @emit_result = 0;
        SELECT @a = other_open_requests_same_field FROM app.vw_equipment_request WHERE request_id = @id;
        SELECT @b = other_open_requests_same_field FROM app.vw_equipment_request WHERE request_id = @id2;
        IF @a <> 0 OR @b <> 0 OR EXISTS (SELECT 1 FROM app.vw_equipment_request WHERE request_id = @id2 AND is_open = 1)
            SET @problems += N' after the withdrawal the flags are ' + ISNULL(CAST(@a AS nvarchar(10)), N'NULL') + N' / ' + ISNULL(CAST(@b AS nvarchar(10)), N'NULL') + N' or the row is still open;';
        SELECT @n = age_hours FROM app.vw_request_queue WHERE request_id = @id2;
        IF @n IS NOT NULL SET @problems += N' a closed request still has an age;';

        -- a merge fact and an export fact flow into the detail view
        UPDATE app.change_request SET request_status = N'APPROVED' WHERE request_id = @id;
        INSERT INTO app.change_request_event (request_id, event_type, actor, status_from, status_to) VALUES (@id, N'ACCOUNTABLE_APPROVED', N'test:t_request_views', N'PENDING_RESPONSIBLE', N'APPROVED');
        EXEC app.usp_request_record_merge @request_id = @id, @outcome = N'STALE', @message = N'moved on', @golden_version_id = NULL;
        SELECT @s = merge_outcome FROM app.vw_request_detail WHERE request_id = @id;
        IF @s <> N'STALE' SET @problems += N' detail merge outcome is ' + ISNULL(@s, N'NULL') + N' (expected STALE);';
        SELECT @s = last_decision_by FROM app.vw_request_detail WHERE request_id = @id;
        IF @s <> N'test:t_request_views' SET @problems += N' detail last decision by is ' + ISNULL(@s, N'NULL') + N';';

        IF @problems = N'' PRINT 'OK  V2 rows: queue (stage, label, source, tag, age, photos), detail (comment, decision, merge facts), event and equipment (overlap flag up and down) views read as designed';
        ELSE BEGIN SET @fails += 1; PRINT 'FAIL V2' + @problems; END
    END TRY
    BEGIN CATCH
        SET @fails += 1;
        PRINT 'FAIL V2 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    END CATCH;
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;

    SELECT @n = COUNT(*) FROM app.change_request WHERE requested_by LIKE N't3v.%@example.test';
    SELECT @n2 = COUNT(*) FROM app.principal_identity WHERE user_email LIKE N't3v.%@example.test';
    IF @n <> 0 OR @n2 <> 0 BEGIN SET @fails += 1; PRINT 'FAIL V2 the rollback left ' + CAST(@n AS varchar(10)) + ' requests and ' + CAST(@n2 AS varchar(10)) + ' people behind'; END
END

IF @fails = 0
    PRINT 't_request_views RESULT: ALL ' + CAST(@checks AS varchar(12)) + ' CHECKS PASS';
ELSE
    PRINT 't_request_views RESULT: ' + CAST(@fails AS varchar(12)) + ' OF ' + CAST(@checks AS varchar(12)) + ' CHECK(S) FAILED';
