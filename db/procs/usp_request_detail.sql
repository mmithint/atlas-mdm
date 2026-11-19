/* =====================================================================
   app.usp_request_detail       APP-4, read path C (D-17); screen S-3 (request detail); function getRequestDetail
   Single statement per file; CREATE OR ALTER, safe to run again.
   Needs: app.vw_request_detail, app.vw_request_event, app.vw_equipment_request, app.fn_request_checks,
   app.fn_request_actions and the gold views. Reads only. Test: db/tests/t_request_reads.sql

   Everything the request screen needs for ONE request, in one call (one connection instead of seven round
   trips). Eight result sets, always in this order (an empty set when there is nothing to show):

     1  request   app.vw_request_detail, one row: the queue columns, then class_code, route_id, creation_comment,
                  last_decision_by / _at_utc, merge_outcome, merged_at_utc, golden_version_id, exported_at_utc,
                  evolve_batch_id, evolve_row_number
     2  events    app.vw_request_event, oldest first (the Audit tab), plus three values read from the event's JSON
                  (the long JSON itself is not sent): decided_as (GROUP_MEMBER or ADMIN), same_person_both_stages
                  (the second approval came from the person who did the first), returned_to (a RETURNED event's
                  recipient)
     3  related   the other requests on the same heater, or at the same functional location (FLOC), open ones first,
                  newest first, at most 50, each with the overlap count of app.vw_equipment_request
     4  route     the approval route that was applied (0 rows when none matched)
     5  gold      the golden record now: the heater (or FLOC) and the current gold value of the requested field,
                  so the approver sees what the requester's "old value" is compared with
     6  checks    the six live approval checks as the approver would see them (same rows as app.usp_request_checks)
     7  viewer    what @actor_email may do: can_decide / can_approve with their reasons, can_resubmit, can_cancel,
                  who a RETURN goes to by default with a readable label, the stage, and decided_as
                  (app.fn_request_actions)
     8  return_to who the person may pick in the Return dialog (app.fn_return_candidates): user_email, display_name,
                  relation (SUBMITTER, RESPONSIBLE_GROUP, ACCOUNTABLE_GROUP, YOU), is_you; empty unless the
                  person may decide the request now

   The evidence snapshot (event_details_json of the CREATED event, nvarchar(max)) is read by app.usp_request_evidence.
   Open visibility (POC-APP-04): everybody may read every request; what a person may DO is the viewer row, and the
   procedures enforce it again.

   @only_set (testing aid, NULL = all): return only that numbered result set, so a test can read each set with
   INSERT ... EXEC, which cannot capture sets of different shapes. The functions never pass it.

   Refusal (THROW): 50301 no such request.
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_request_detail
    @request_id  bigint,
    @actor_email nvarchar(256),
    @only_set    tinyint = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @actor nvarchar(256) = LOWER(LTRIM(RTRIM(@actor_email)));
    DECLARE @etype nvarchar(10), @eq int, @floc nvarchar(40), @field nvarchar(64);
    SELECT @etype = r.entity_type, @eq = r.equipment_id, @floc = r.functional_location, @field = r.field_code
    FROM app.change_request AS r
    WHERE r.request_id = @request_id;
    IF @etype IS NULL
        THROW 50301, N'That request does not exist.', 1;

    /* ---- 1 the request ------------------------------------------------------------------ */
    IF @only_set IS NULL OR @only_set = 1
    SELECT d.*
    FROM app.vw_request_detail AS d
    WHERE d.request_id = @request_id;

    /* ---- 2 its history ------------------------------------------------------------------- */
    IF @only_set IS NULL OR @only_set = 2
    SELECT e.event_id, e.event_type, e.approval_stage, e.actor, e.actor_group, e.occurred_at_utc, e.comments, e.status_from, e.status_to,
           CAST(JSON_VALUE(x.event_details_json, '$.decided_as') AS nvarchar(12)) AS decided_as,
           CAST(CASE WHEN JSON_VALUE(x.event_details_json, '$.same_person_both_stages') = N'true' THEN 1 ELSE 0 END AS bit) AS same_person_both_stages,
           CAST(CASE WHEN e.event_type = N'RETURNED' THEN JSON_VALUE(x.event_details_json, '$.return_recipient') END AS nvarchar(256)) AS returned_to
    FROM app.vw_request_event AS e
    JOIN app.change_request_event AS x ON x.event_id = e.event_id
    WHERE e.request_id = @request_id
    ORDER BY e.occurred_at_utc, e.event_id;

    /* ---- 3 related requests ---------------------------------------------------------------- */
    IF @only_set IS NULL OR @only_set = 3
    SELECT TOP (50)
        q.request_id, q.request_ref, q.request_status, q.is_open, q.equipment_id, q.functional_location, q.field_code,
        q.field_label, q.source_label, q.requested_at_utc, q.other_open_requests_same_field
    FROM app.vw_equipment_request AS q
    WHERE q.request_id <> @request_id
      AND (   (@etype = N'EQUIPMENT' AND (q.equipment_id = @eq OR (q.equipment_id IS NULL AND q.functional_location = @floc)))
           OR (@etype = N'FLOC' AND q.functional_location = @floc))
    ORDER BY q.is_open DESC, q.requested_at_utc DESC, q.request_id DESC;

    /* ---- 4 the route that was applied ------------------------------------------------------- */
    IF @only_set IS NULL OR @only_set = 4
    SELECT ro.route_id, ro.entity_type, ro.request_action, ro.field_or_characteristic, ro.class_scope, ro.responsible_role, ro.accountable_role
    FROM app.approval_route AS ro
    WHERE ro.route_id = (SELECT r.route_id FROM app.change_request AS r WHERE r.request_id = @request_id);

    /* ---- 5 the golden record now (exactly one result set, from whichever branch applies) ----- */
    IF @only_set IS NULL OR @only_set = 5
    BEGIN
    IF @etype = N'EQUIPMENT'
    BEGIN
        SELECT
            CAST(N'EQUIPMENT' AS nvarchar(10))            AS entity_type,
            e.equipment_number, e.equipment_description, e.equipment_tag_number, e.functional_location, e.floc_description,
            e.equip_class, e.profit_center_name, e.manufacturer, e.model_number, e.manufacturer_serial_number,
            e.equipment_user_status, e.golden_version_id, e.last_changed_at_utc,
            CAST(fv.current_value AS nvarchar(400))       AS field_current_value,
            CAST(fv.unit AS nvarchar(20))                 AS field_unit
        FROM gold.vw_equipment_current AS e
        OUTER APPLY (SELECT TOP (1) x.current_value, x.unit
                     FROM gold.vw_equipment_field_current AS x
                     WHERE x.equipment_id = e.equipment_id AND x.field_code = @field) AS fv
        WHERE e.equipment_id = @eq;
    END
    ELSE
    BEGIN
        SELECT
            CAST(N'FLOC' AS nvarchar(10))                 AS entity_type,
            CAST(NULL AS nvarchar(18))                    AS equipment_number,
            CAST(NULL AS nvarchar(40))                    AS equipment_description,
            CAST(NULL AS nvarchar(30))                    AS equipment_tag_number,
            l.functional_location, l.floc_description,
            CAST(NULL AS nvarchar(30))                    AS equip_class,
            l.profit_center_name,
            CAST(NULL AS nvarchar(30))                    AS manufacturer,
            CAST(NULL AS nvarchar(20))                    AS model_number,
            CAST(NULL AS nvarchar(30))                    AS manufacturer_serial_number,
            CAST(NULL AS nvarchar(30))                    AS equipment_user_status,
            l.golden_version_id, l.last_changed_at_utc,
            CAST(CASE WHEN @field = N'FLOC_CLASS' THEN l.floc_class END AS nvarchar(400)) AS field_current_value,
            CAST(NULL AS nvarchar(20))                    AS field_unit
        FROM gold.vw_floc_current AS l
        WHERE l.functional_location = @floc;
    END
    END

    /* ---- 6 the live approval checks ----------------------------------------------------------- */
    IF @only_set IS NULL OR @only_set = 6
    SELECT c.check_order, c.check_code, c.check_status, c.message, c.checked_at_utc
    FROM app.fn_request_checks(@request_id, @actor) AS c
    ORDER BY c.check_order;

    /* ---- 7 what this person may do ------------------------------------------------------------ */
    IF @only_set IS NULL OR @only_set = 7
    SELECT
        a.can_decide, a.decide_blocked_reason, a.can_approve, a.approve_blocked_reason, a.can_resubmit, a.can_cancel,
        a.return_to_type, a.return_to,
        CAST(CASE WHEN a.return_to_type = N'USER' THEN ISNULL(i.display_name, a.return_to)
                  WHEN a.return_to_type = N'GROUP' THEN ISNULL(g.display_name, a.return_to)
                  ELSE a.return_to END AS nvarchar(256)) AS return_to_label,
        a.stage,
        a.decided_as
    FROM app.fn_request_actions(@request_id, @actor) AS a
    OUTER APPLY (SELECT TOP (1) p.display_name FROM app.principal_identity AS p
                 WHERE p.user_email = a.return_to AND p.is_active = 1) AS i
    OUTER APPLY (SELECT TOP (1) sg.display_name FROM app.security_group AS sg
                 WHERE sg.group_key = a.return_to) AS g;

    /* ---- 8 who a Return may be sent to (the dialog's picker; empty when this person may not decide) ---------- */
    IF @only_set IS NULL OR @only_set = 8
    SELECT c.user_email, c.display_name, c.relation, c.is_you
    FROM app.fn_return_candidates(@request_id, @actor) AS c
    WHERE EXISTS (SELECT 1 FROM app.fn_request_actions(@request_id, @actor) AS a WHERE a.can_decide = 1)
    ORDER BY c.sort_order, c.display_name, c.user_email;
END
