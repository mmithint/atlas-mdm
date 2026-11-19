/* =====================================================================
   app.usp_request_queue        APP-4, read path C (D-17); screen S-2 (approvals); function getRequestQueue
   Single statement per file; CREATE OR ALTER, safe to run again.
   Needs: app.vw_request_queue, app.fn_request_actions. Reads only. Test: db/tests/t_request_reads.sql

   One tab of the approver's work list, with the counts of all six tabs, in one call (one connection). The tabs
   are filters on the requests, using the groups of the person asking (FINAL PLAN/guide/app/S-02 section 2;
   "my queue" depends on who is asking, which is why the browser cannot filter a view by itself):

     RESPONSIBLE   waits for the responsible stage and is routed to a group the person is an active member of;
                   for an admin, every request waiting for that stage (an admin may decide any stage, 18 Nov 2026)
     ACCOUNTABLE   the same for the accountable stage
     RETURNED      status RETURNED and the person is the return recipient (the user, or a member of the group), or
                   the return is orphaned and the person may pick it up (app.fn_return_rights)
     APPROVED      every approved request (visibility is open: POC-APP-04)
     REJECTED      every rejected request
     MY_REQUESTS   raised by the person, in any status

   Input : @actor_email (a person), @tab, the filters (NULL / blank = no filter): @profit_center, @field_code,
           @rule_id (the rule that raised it), @min_age_hours (open requests at least that many hours old; ignored
           on APPROVED and REJECTED, which have no age), @note_only (1 = only requests that carry a note, the TBD
           ones), and the page: @offset (0 or more), @page_size (1 to 100).
   Order : pending and returned tabs oldest first (the longest wait on top); APPROVED, REJECTED and MY_REQUESTS
           newest change first. The request id is the last key, so a page boundary never repeats or skips a row.

   Four result sets, always in this order (an empty set when there is nothing):
     1  counts   one row: responsible_count, accountable_count, returned_count, approved_count, rejected_count,
                 mine_count (not narrowed by the filters)
     2  page     one row: total_matches (the tab's rows after the filters, before paging)
     3  rows     the page: the columns of app.vw_request_queue plus can_approve (1 = the person may approve it and so
                 may tick it for a bulk approval: app.fn_request_actions)
     4  facets   what the filters can offer for this tab (ignoring the filters themselves): facet_kind
                 (PROFIT_CENTER, FIELD or RULE), facet_value, facet_label, n

   @only_set (testing aid, NULL = all): return only that numbered result set, so a test can read each set with
   INSERT ... EXEC, which cannot capture sets of different shapes. The functions never pass it.

   Refusals (THROW): 50311 unknown tab, 50312 page size outside 1 to 100, 50313 negative offset,
   50314 negative age, 50315 the queue is for a person (blank, no @, or a system: address).
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_request_queue
    @actor_email   nvarchar(256),
    @tab           nvarchar(20),
    @profit_center nvarchar(40)  = NULL,
    @field_code    nvarchar(64)  = NULL,
    @rule_id       nvarchar(64)  = NULL,
    @min_age_hours int           = NULL,
    @note_only     bit           = 0,
    @offset        int           = 0,
    @page_size     int           = 50,
    @only_set      tinyint       = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @actor nvarchar(256) = LOWER(LTRIM(RTRIM(@actor_email)));
    DECLARE @t nvarchar(20) = UPPER(LTRIM(RTRIM(@tab)));
    DECLARE @pc nvarchar(40) = NULLIF(LTRIM(RTRIM(@profit_center)), N'');
    DECLARE @fc nvarchar(64) = NULLIF(LTRIM(RTRIM(@field_code)), N'');
    DECLARE @rl nvarchar(64) = NULLIF(LTRIM(RTRIM(@rule_id)), N'');

    IF @actor IS NULL OR CHARINDEX(N'@', @actor) < 2 OR LEFT(@actor, 7) = N'system:'
        THROW 50315, N'The queue is shown to a person (an e-mail address).', 1;
    IF @t IS NULL OR @t NOT IN (N'RESPONSIBLE', N'ACCOUNTABLE', N'RETURNED', N'APPROVED', N'REJECTED', N'MY_REQUESTS')
        THROW 50311, N'The tab must be RESPONSIBLE, ACCOUNTABLE, RETURNED, APPROVED, REJECTED or MY_REQUESTS.', 1;
    IF @page_size IS NULL OR @page_size < 1 OR @page_size > 100
        THROW 50312, N'The page size must be from 1 to 100.', 1;
    IF @offset IS NULL OR @offset < 0
        THROW 50313, N'The offset must be 0 or more.', 1;
    IF @min_age_hours IS NOT NULL AND @min_age_hours < 0
        THROW 50314, N'The age must be 0 hours or more.', 1;

    /* ---- the person's groups ------------------------------------------------------------- */
    DECLARE @g TABLE (group_key nvarchar(64) NOT NULL PRIMARY KEY);
    INSERT INTO @g (group_key)
    SELECT m.group_key
    FROM app.group_membership AS m
    JOIN app.security_group AS sg ON sg.group_key = m.group_key AND sg.is_active = 1
    WHERE m.is_active = 1 AND m.user_email = @actor;

    /* an admin may decide every stage of every request (client, 18 Nov 2026), so both pending tabs list them all */
    DECLARE @is_admin bit = ISNULL((SELECT TOP (1) x.can_manage_admin FROM app.fn_requester_rights(@actor) AS x), 0);

    /* ---- every request with the tabs it belongs to, for this person -------------------------- */
    DECLARE @all TABLE
    (
        request_id        bigint        NOT NULL PRIMARY KEY,
        in_resp           bit           NOT NULL,
        in_acc            bit           NOT NULL,
        in_ret            bit           NOT NULL,
        in_app            bit           NOT NULL,
        in_rej            bit           NOT NULL,
        in_mine           bit           NOT NULL,
        is_open           bit           NOT NULL,
        profit_center_name nvarchar(40) NULL,
        field_code        nvarchar(64)  NULL,
        source_rule_id    nvarchar(64)  NULL,
        note              nvarchar(200) NULL,
        requested_at_utc  datetime2(3)  NOT NULL,
        updated_at_utc    datetime2(3)  NOT NULL
    );
    INSERT INTO @all (request_id, in_resp, in_acc, in_ret, in_app, in_rej, in_mine, is_open,
                      profit_center_name, field_code, source_rule_id, note, requested_at_utc, updated_at_utc)
    SELECT r.request_id, f.in_resp, f.in_acc, f.in_ret, f.in_app, f.in_rej, f.in_mine, f.is_open,
           r.profit_center_name, r.field_code, r.source_rule_id, r.note, r.requested_at_utc, r.updated_at_utc
    FROM app.change_request AS r
    CROSS APPLY
    (
        SELECT
            CAST(CASE WHEN r.request_status = N'PENDING_RESPONSIBLE'
                       AND (@is_admin = 1 OR EXISTS (SELECT 1 FROM @g AS g WHERE g.group_key = r.responsible_group)) THEN 1 ELSE 0 END AS bit) AS in_resp,
            CAST(CASE WHEN r.request_status = N'PENDING_ACCOUNTABLE'
                       AND (@is_admin = 1 OR EXISTS (SELECT 1 FROM @g AS g WHERE g.group_key = r.accountable_group)) THEN 1 ELSE 0 END AS bit) AS in_acc,
            CAST(CASE WHEN r.request_status <> N'RETURNED' THEN 0
                      WHEN (r.return_recipient_type = N'USER' AND LOWER(r.return_recipient) = @actor)
                        OR (r.return_recipient_type = N'GROUP' AND EXISTS (SELECT 1 FROM @g AS g WHERE g.group_key = r.return_recipient)) THEN 1
                      WHEN EXISTS (SELECT 1 FROM app.fn_return_rights(r.request_id, @actor) AS rr WHERE rr.can_resubmit = 1) THEN 1
                      ELSE 0 END AS bit) AS in_ret,
            CAST(CASE WHEN r.request_status = N'APPROVED' THEN 1 ELSE 0 END AS bit) AS in_app,
            CAST(CASE WHEN r.request_status = N'REJECTED' THEN 1 ELSE 0 END AS bit) AS in_rej,
            CAST(CASE WHEN LOWER(r.requested_by) = @actor THEN 1 ELSE 0 END AS bit) AS in_mine,
            CAST(CASE WHEN r.request_status = N'APPROVED' OR r.request_status = N'REJECTED' OR r.request_status = N'CANCELLED'
                      THEN 0 ELSE 1 END AS bit) AS is_open
    ) AS f
    WHERE f.in_resp = 1 OR f.in_acc = 1 OR f.in_ret = 1 OR f.in_app = 1 OR f.in_rej = 1 OR f.in_mine = 1;

    /* ---- 1 counts (the six tabs, not narrowed by the filters) ------------------------------- */
    IF @only_set IS NULL OR @only_set = 1
    SELECT
        CAST(ISNULL(SUM(CAST(a.in_resp AS int)), 0) AS int) AS responsible_count,
        CAST(ISNULL(SUM(CAST(a.in_acc  AS int)), 0) AS int) AS accountable_count,
        CAST(ISNULL(SUM(CAST(a.in_ret  AS int)), 0) AS int) AS returned_count,
        CAST(ISNULL(SUM(CAST(a.in_app  AS int)), 0) AS int) AS approved_count,
        CAST(ISNULL(SUM(CAST(a.in_rej  AS int)), 0) AS int) AS rejected_count,
        CAST(ISNULL(SUM(CAST(a.in_mine AS int)), 0) AS int) AS mine_count
    FROM @all AS a;

    /* ---- the chosen tab, then the filters ---------------------------------------------------- */
    DECLARE @tabrows TABLE
    (
        request_id bigint NOT NULL PRIMARY KEY,
        profit_center_name nvarchar(40) NULL, field_code nvarchar(64) NULL, source_rule_id nvarchar(64) NULL,
        note nvarchar(200) NULL, is_open bit NOT NULL, requested_at_utc datetime2(3) NOT NULL, updated_at_utc datetime2(3) NOT NULL
    );
    INSERT INTO @tabrows (request_id, profit_center_name, field_code, source_rule_id, note, is_open, requested_at_utc, updated_at_utc)
    SELECT a.request_id, a.profit_center_name, a.field_code, a.source_rule_id, a.note, a.is_open, a.requested_at_utc, a.updated_at_utc
    FROM @all AS a
    WHERE (CASE @t WHEN N'RESPONSIBLE' THEN a.in_resp WHEN N'ACCOUNTABLE' THEN a.in_acc WHEN N'RETURNED' THEN a.in_ret
                   WHEN N'APPROVED' THEN a.in_app WHEN N'REJECTED' THEN a.in_rej ELSE a.in_mine END) = 1;

    DECLARE @oldest_first bit = CASE WHEN @t IN (N'RESPONSIBLE', N'ACCOUNTABLE', N'RETURNED') THEN 1 ELSE 0 END;
    DECLARE @ignore_age bit = CASE WHEN @t IN (N'APPROVED', N'REJECTED') THEN 1 ELSE 0 END;

    DECLARE @hit TABLE
    (
        request_id bigint NOT NULL PRIMARY KEY,
        k1 bigint NOT NULL,
        k2 bigint NOT NULL
    );
    INSERT INTO @hit (request_id, k1, k2)
    SELECT x.request_id,
           CASE WHEN @oldest_first = 1 THEN x.stamp ELSE -x.stamp END,
           CASE WHEN @oldest_first = 1 THEN x.request_id ELSE -x.request_id END
    FROM
    (
        SELECT t.request_id,
               DATEDIFF_BIG(second, CAST('2000-01-01' AS datetime2(3)), CASE WHEN @oldest_first = 1 THEN t.requested_at_utc ELSE t.updated_at_utc END) AS stamp
        FROM @tabrows AS t
        WHERE (@pc IS NULL OR t.profit_center_name = @pc)
          AND (@fc IS NULL OR t.field_code = @fc)
          AND (@rl IS NULL OR t.source_rule_id = @rl)
          AND (@note_only IS NULL OR @note_only = 0 OR t.note IS NOT NULL)
          AND (@min_age_hours IS NULL OR @min_age_hours = 0 OR @ignore_age = 1
               OR (t.is_open = 1 AND DATEDIFF(hour, t.requested_at_utc, SYSUTCDATETIME()) >= @min_age_hours))
    ) AS x;

    /* ---- 2 the size of the filtered tab ------------------------------------------------------ */
    IF @only_set IS NULL OR @only_set = 2
    SELECT CAST(COUNT(*) AS int) AS total_matches FROM @hit;

    /* ---- 3 the page ------------------------------------------------------------------------- */
    IF @only_set IS NULL OR @only_set = 3
    SELECT
        q.request_id, q.request_ref, q.request_status, q.approval_stage, q.entity_type, q.equipment_id, q.equipment_number,
        q.functional_location, q.equipment_tag_number, q.profit_center_name, q.field_code, q.field_label, q.sap_field,
        q.old_value, q.new_value, q.reason, q.note, q.source_type, q.source_rule_id, q.source_rule_version, q.source_label,
        q.requested_by, q.requested_at_utc, q.detected_at_utc, q.responsible_group, q.accountable_group,
        q.return_recipient_type, q.return_recipient, q.age_hours, q.photo_count, q.updated_at_utc,
        CAST(ISNULL(ac.can_approve, 0) AS bit) AS can_approve
    FROM @hit AS h
    JOIN app.vw_request_queue AS q ON q.request_id = h.request_id
    OUTER APPLY app.fn_request_actions(q.request_id, @actor) AS ac
    ORDER BY h.k1, h.k2
    OFFSET @offset ROWS FETCH NEXT @page_size ROWS ONLY;

    /* ---- 4 what the filters can offer for this tab ------------------------------------------- */
    IF @only_set IS NULL OR @only_set = 4
    SELECT f.facet_kind, f.facet_value, f.facet_label, f.n
    FROM
    (
        SELECT CAST(N'PROFIT_CENTER' AS nvarchar(14)) AS facet_kind, CAST(t.profit_center_name AS nvarchar(64)) AS facet_value,
               CAST(t.profit_center_name AS nvarchar(100)) AS facet_label, CAST(COUNT(*) AS int) AS n
        FROM @tabrows AS t
        WHERE t.profit_center_name IS NOT NULL
        GROUP BY t.profit_center_name
        UNION ALL
        SELECT N'FIELD', CAST(t.field_code AS nvarchar(64)), CAST(ISNULL(fc2.label, t.field_code) AS nvarchar(100)), CAST(COUNT(*) AS int)
        FROM @tabrows AS t
        LEFT JOIN app.field_catalog AS fc2 ON fc2.field_code = t.field_code
        WHERE t.field_code IS NOT NULL
        GROUP BY t.field_code, fc2.label
        UNION ALL
        SELECT N'RULE', CAST(t.source_rule_id AS nvarchar(64)), CAST(t.source_rule_id AS nvarchar(100)), CAST(COUNT(*) AS int)
        FROM @tabrows AS t
        WHERE t.source_rule_id IS NOT NULL
        GROUP BY t.source_rule_id
    ) AS f
    ORDER BY f.facet_kind, f.facet_label;
END
