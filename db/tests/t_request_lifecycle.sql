/* =====================================================================
   t_request_lifecycle.sql   APP-3 test: the request write path
                             (usp_request_create, _checks, _decide, _bulk_decide, _resubmit, _cancel,
                              _record_merge, _mark_exported, usp_notification_enqueue and the helper functions)
   Needs : migrations 0001-0007, seeds 0101-0109 (0108 and 0109 are APP-3 stage 0), the procedures and
           functions of the APP-3 stage, and the SYNTHETIC gold stub (db/dev/gold_stub.sql). It is skipped,
           with an INFO line, when the data engineer's real gold has replaced the stub (the scenarios
           rely on the stub's values).
   Needs no local seed: it makes its own people (addresses ending @example.test), group memberships and a
   rule row, INSIDE ONE TRANSACTION THAT IS ROLLED BACK AT THE END, so it leaves nothing behind (the last
   check proves it). It also edits two stub rows and one setting inside that transaction.
   Final line: `t_request_lifecycle RESULT: ...`

   Scenarios (S1-S16 are the plan's 16, 03 APP-3 step 8; E1 and E2 add the rule source and a global check)
     S1  create -> responsible approve -> accountable approve -> the merge stub -> merge recorded -> exported;
         notifications to the right people
     S2  reject (and return) without a comment refused; reject with one works; a closed request cannot be decided
     S3  return -> resubmit with a corrected value (the de-duplication key moves with it)
     S4  return -> cancel; the same change can be raised again afterwards
     S5  a person who is not in the routed group refused (several kinds); the checks say so
     S6  out of scope: a member of another region's group refused; a member whose roles lost the flag refused
     S7  both stages (changed 18 Nov 2026, client; Q-479): a member of both groups may approve both and the event
         records it; a member of the first group only is still refused at the second stage
     S8  a failing approval check blocks approval (gold moved on), but the request can still be rejected
     S9  a duplicate is suppressed (any requester); after a rejection a person can raise it again
     S10 an incompatible open request on the same field is blocked; another field is not
     S11 bulk of 10 with 1 failing check: 9 decided, 1 skipped with the reason; bad lists refused
     S12 one event per status change, in an unbroken chain, ending at the request's status
     S13 nothing is deleted: no request procedure deletes or edits history
     S14 refused inputs: unregistered person, admin-only field, unknown field / heater, wrong entity type,
         unacceptable values (number format, length, list), same value, source and requester that disagree
     S15 an equipment status outside AVFS / NOPE / OPER / DECM is refused, one inside it is accepted (D-18)
     S16 a location change to a FLOC that does not exist is refused, to one that exists is accepted (D-18)
     E1  a rule request: duplicate, return to the rule's resolution group and back, suppression after a rejection
     E2  the rollback left no test people, requests or notifications behind
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL t_request_lifecycle wrong editor: connected to "' + DB_NAME() + '". Open the item named ATLAS_SQL_DB whose type is SQL database. Nothing was run.';
    RETURN;
END
IF OBJECT_ID(N'app.usp_request_create', N'P') IS NULL OR OBJECT_ID(N'app.usp_request_checks', N'P') IS NULL
   OR OBJECT_ID(N'app.usp_request_decide', N'P') IS NULL OR OBJECT_ID(N'app.usp_request_bulk_decide', N'P') IS NULL
   OR OBJECT_ID(N'app.usp_request_resubmit', N'P') IS NULL OR OBJECT_ID(N'app.usp_request_cancel', N'P') IS NULL
   OR OBJECT_ID(N'app.usp_request_record_merge', N'P') IS NULL OR OBJECT_ID(N'app.usp_request_mark_exported', N'P') IS NULL
   OR OBJECT_ID(N'app.usp_notification_enqueue', N'P') IS NULL OR OBJECT_ID(N'app.usp_request_evidence', N'P') IS NULL
   OR OBJECT_ID(N'app.fn_request_checks', N'IF') IS NULL OR OBJECT_ID(N'app.fn_stage_eligibility', N'IF') IS NULL
   OR OBJECT_ID(N'app.fn_value_check', N'IF') IS NULL OR OBJECT_ID(N'app.fn_requester_rights', N'IF') IS NULL
   OR OBJECT_ID(N'app.vw_request_detail', N'V') IS NULL
BEGIN
    PRINT 'FAIL t_request_lifecycle a procedure, function or view of the APP-3 stage is missing: run the APP-3 stage 1 bundle (app3_1_request_objects) first. Nothing was run.';
    RETURN;
END
IF OBJECT_ID(N'gold.vw_equipment_current', N'V') IS NULL OR OBJECT_ID(N'gold.vw_equipment_field_current', N'V') IS NULL OR OBJECT_ID(N'gold.vw_floc_current', N'V') IS NULL
BEGIN
    PRINT 'FAIL t_request_lifecycle the gold views are missing: run the gold stub (or the real gold) first. Nothing was run.';
    RETURN;
END
IF OBJECT_DEFINITION(OBJECT_ID(N'gold.vw_equipment_current')) NOT LIKE N'%ATLAS-STUB%'
BEGIN
    PRINT 'INFO t_request_lifecycle skipped: gold.vw_equipment_current is not the synthetic stub (the data engineer''s real view?). The scenarios use the stub''s values.';
    RETURN;
END
IF NOT EXISTS (SELECT 1 FROM app.field_catalog WHERE field_code = N'EQUIPMENT_USER_STATUS' AND allowed_values_source = N'LIST')
   OR NOT EXISTS (SELECT 1 FROM app.app_setting WHERE setting_key = N'ADMIN_ONLY_FIELDS')
BEGIN
    PRINT 'FAIL t_request_lifecycle seeds 0108 / 0109 are missing: run bundle app3_0_seed_status first. Nothing was run.';
    RETURN;
END

DECLARE @checks int = 0, @fails int = 0;
DECLARE @txt nvarchar(2000), @errno int, @n int, @n2 int, @n3 int;
DECLARE @id bigint, @ref nvarchar(12), @out nvarchar(24), @rgo nvarchar(64), @ago nvarchar(64), @ns nvarchar(24), @nm bit;
DECLARE @eid int, @cur nvarchar(400), @s nvarchar(24), @s2 nvarchar(40), @s3 nvarchar(400);
DECLARE @r1 bigint, @r2 bigint, @r3 bigint, @r4 bigint, @r5 bigint, @r6 bigint, @r7 bigint, @r8 bigint, @r9 bigint, @r10 bigint, @r11 bigint, @r12 bigint;
DECLARE @pc nvarchar(40) = N'OP RES DB NM', @pc_other nvarchar(40) = N'OP EOR';
DECLARE @rg nvarchar(64), @ag nvarchar(64), @rg2 nvarchar(64), @class nvarchar(30);

/* ---- the heaters the scenarios use: 14 synthetic filler heaters of one profit centre, with no open request ---- */
DECLARE @h TABLE (n int NOT NULL PRIMARY KEY, equipment_id int NOT NULL, equipment_number nvarchar(18) NOT NULL,
                  mfr nvarchar(30) NULL, model nvarchar(20) NULL, floc nvarchar(40) NOT NULL, equip_class nvarchar(30) NULL);
INSERT INTO @h (n, equipment_id, equipment_number, mfr, model, floc, equip_class)
SELECT ROW_NUMBER() OVER (ORDER BY e.equipment_id), e.equipment_id, e.equipment_number, e.manufacturer, e.model_number, e.functional_location, e.equip_class
FROM (SELECT TOP (14) x.*
      FROM gold.vw_equipment_current AS x
      WHERE x.profit_center_name = @pc AND x.equipment_number LIKE N'SYN-EQ-1%'
        AND NOT EXISTS (SELECT 1 FROM app.change_request AS r
                        WHERE r.equipment_id = x.equipment_id
                          AND r.request_status <> N'APPROVED' AND r.request_status <> N'REJECTED' AND r.request_status <> N'CANCELLED')
      ORDER BY x.equipment_id) AS e;
SELECT @n = COUNT(*) FROM @h;
IF @n < 14
BEGIN
    PRINT 'FAIL t_request_lifecycle setup: found ' + CAST(@n AS varchar(10)) + ' synthetic heaters without an open request in ' + @pc + ' (need 14). Reject or cancel the open requests on them, or rebuild the stub.';
    RETURN;
END

/* ---- the routing the scenarios depend on -------------------------------------------- */
DECLARE @route TABLE (route_id int NULL, route_used nvarchar(12) NULL, responsible_role nvarchar(64) NULL,
                      responsible_group nvarchar(64) NULL, accountable_role nvarchar(64) NULL, accountable_group nvarchar(64) NULL);
SELECT @class = equip_class FROM @h WHERE n = 1;
INSERT INTO @route EXEC app.usp_route_resolve @entity_type = N'EQUIPMENT', @request_action = N'UPDATE', @profit_center_name = @pc, @field_code = N'MANUFACTURER', @class_code = @class;
SELECT @rg = responsible_group, @ag = accountable_group FROM @route;
DELETE FROM @route;
INSERT INTO @route EXEC app.usp_route_resolve @entity_type = N'EQUIPMENT', @request_action = N'UPDATE', @profit_center_name = @pc_other, @field_code = N'MANUFACTURER', @class_code = @class;
SELECT @rg2 = responsible_group FROM @route;
IF @rg IS NULL OR @ag IS NULL OR @rg = N'UNROUTED' OR @ag = N'UNROUTED' OR @rg2 IS NULL OR @rg2 = N'UNROUTED' OR @rg2 = @rg
BEGIN
    PRINT 'FAIL t_request_lifecycle setup: the routes do not give two different responsible groups for ' + @pc + ' and ' + @pc_other + ' (got ' + ISNULL(@rg, N'NULL') + ', ' + ISNULL(@ag, N'NULL') + ', ' + ISNULL(@rg2, N'NULL') + '). Run seeds 0103 to 0105.';
    RETURN;
END

/* ---- people, memberships and a rule, all rolled back at the end ------------------------ */
DECLARE @u_req nvarchar(256) = N't3.requester@example.test', @u_resp nvarchar(256) = N't3.responsible@example.test',
        @u_acc nvarchar(256) = N't3.accountable@example.test', @u_both nvarchar(256) = N't3.both@example.test',
        @u_none nvarchar(256) = N't3.nobody@example.test', @u_other nvarchar(256) = N't3.otherregion@example.test',
        @u_admin nvarchar(256) = N't3.admin@example.test', @u_unreg nvarchar(256) = N't3.unregistered@example.test';
DECLARE @setup_ok bit = 0;
BEGIN TRANSACTION;
BEGIN TRY
    INSERT INTO app.principal_identity (external_id, user_email, display_name, is_active, bound_by) VALUES
        (N'00000000-0000-4000-8000-0000000003a1', @u_req,   N'T3 requester',   1, N'test:t_request_lifecycle'),
        (N'00000000-0000-4000-8000-0000000003a2', @u_resp,  N'T3 responsible', 1, N'test:t_request_lifecycle'),
        (N'00000000-0000-4000-8000-0000000003a3', @u_acc,   N'T3 accountable', 1, N'test:t_request_lifecycle'),
        (N'00000000-0000-4000-8000-0000000003a4', @u_both,  N'T3 both stages', 1, N'test:t_request_lifecycle'),
        (N'00000000-0000-4000-8000-0000000003a5', @u_none,  N'T3 nobody',      1, N'test:t_request_lifecycle'),
        (N'00000000-0000-4000-8000-0000000003a6', @u_other, N'T3 other region',1, N'test:t_request_lifecycle'),
        (N'00000000-0000-4000-8000-0000000003a7', @u_admin, N'T3 admin',       1, N'test:t_request_lifecycle');
    INSERT INTO app.group_membership (group_key, user_email, is_active, added_by) VALUES
        (@rg,  @u_resp,  1, N'test:t_request_lifecycle'),
        (@rg,  @u_both,  1, N'test:t_request_lifecycle'),
        (@ag,  @u_acc,   1, N'test:t_request_lifecycle'),
        (@ag,  @u_both,  1, N'test:t_request_lifecycle'),
        (@rg2, @u_other, 1, N'test:t_request_lifecycle');
    INSERT INTO app.principal_role_assignment (principal_type, principal_key, principal_display_name, role_name, scope_type, scope_value, is_active)
    VALUES (N'USER', @u_admin, N'T3 admin', N'Admin', N'ALL_ORCM', NULL, 1);
    INSERT INTO app.business_rules (rule_id, rule_version, rule_name, rule_description, execution_target, query_text, routing_mode,
                                    resolution_group, rule_editor_group, created_by, version_change_reason)
    VALUES (N'T3_TEST_RULE', 1, N'T3 test rule', N'Synthetic rule for t_request_lifecycle', N'gold.vw_equipment_current',
            N'SELECT 1', N'AUTO_ROUTE', @rg2, @rg2, N'test:t_request_lifecycle', N'test');
    SET @setup_ok = 1;
END TRY
BEGIN CATCH
    PRINT 'FAIL t_request_lifecycle setup error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;
IF @setup_ok = 0
BEGIN
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    RETURN;
END

DECLARE @rec TABLE (request_id bigint NULL, request_ref nvarchar(12) NULL, recorded nvarchar(16) NULL);
DECLARE @mg TABLE (outcome nvarchar(16) NULL, message nvarchar(400) NULL, golden_version_id int NULL);
DECLARE @bulk TABLE (request_id bigint NULL, request_ref nvarchar(12) NULL, outcome nvarchar(10) NULL, new_status nvarchar(24) NULL, needs_merge bit NULL, reason nvarchar(400) NULL);
DECLARE @chk TABLE (request_id bigint, request_status nvarchar(24), check_order int, check_code nvarchar(40), check_status nvarchar(12), message nvarchar(400), checked_at_utc datetime2(3));
DECLARE @undo TABLE (assignment_id int NOT NULL PRIMARY KEY);
DECLARE @mo nvarchar(16), @mm nvarchar(400);

/* ---- S1 create -> two approvals -> merge -> export -------------------------------------- */
BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    SELECT @eid = equipment_id, @cur = mfr FROM @h WHERE n = 1;
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T3 MFR 1',
        @reason = N'T3 lifecycle', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0,
        @o_request_id = @id OUTPUT, @o_request_ref = @ref OUTPUT, @o_outcome = @out OUTPUT, @o_responsible_group = @rgo OUTPUT, @o_accountable_group = @ago OUTPUT;
    SET @r1 = @id;
    IF NOT (@out = N'CREATED' AND @rgo = @rg AND @ago = @ag AND @ref = N'CR-' + RIGHT(N'000000' + CAST(@id AS nvarchar(20)), 6))
        SET @txt += N' create gave ' + ISNULL(@out, N'NULL') + N' ' + ISNULL(@rgo, N'NULL') + N'/' + ISNULL(@ago, N'NULL') + N' ' + ISNULL(@ref, N'NULL') + N';';
    SELECT @s = request_status FROM app.change_request WHERE request_id = @r1;
    SELECT @n = COUNT(*) FROM app.change_request_event WHERE request_id = @r1 AND event_type = N'CREATED' AND status_from IS NULL AND status_to = N'PENDING_RESPONSIBLE' AND actor = @u_req AND ISJSON(event_details_json) = 1;
    IF @s <> N'PENDING_RESPONSIBLE' OR @n <> 1 SET @txt += N' created status ' + ISNULL(@s, N'NULL') + N', CREATED events ' + CAST(@n AS nvarchar(10)) + N';';
    -- notifications: every active member of the responsible group, once; nobody else
    SELECT @n = COUNT(*) FROM app.notification WHERE request_id = @r1 AND topic = N'REQUEST_PENDING_RESPONSIBLE';
    SELECT @n2 = COUNT(*) FROM app.group_membership WHERE group_key = @rg AND is_active = 1;
    IF @n <> @n2 OR @n2 < 2 SET @txt += N' notified ' + CAST(@n AS nvarchar(10)) + N' of ' + CAST(@n2 AS nvarchar(10)) + N' group members;';
    IF NOT EXISTS (SELECT 1 FROM app.notification WHERE request_id = @r1 AND topic = N'REQUEST_PENDING_RESPONSIBLE' AND recipient_email = @u_resp)
       OR EXISTS (SELECT 1 FROM app.notification WHERE request_id = @r1 AND recipient_email IN (@u_none, @u_acc, @u_req))
        SET @txt += N' the notification went to the wrong people;';
    -- the checks as the responsible approver sees them: all six pass
    DELETE FROM @chk;
    INSERT INTO @chk EXEC app.usp_request_checks @request_id = @r1, @actor_email = @u_resp;
    SELECT @n = COUNT(*), @n2 = SUM(CASE WHEN check_status = N'PASS' THEN 1 ELSE 0 END) FROM @chk;
    IF @n <> 6 OR @n2 <> 6 SET @txt += N' checks: ' + CAST(@n AS nvarchar(10)) + N' rows, ' + CAST(@n2 AS nvarchar(10)) + N' PASS (expected 6 and 6);';
    -- responsible approval
    EXEC app.usp_request_decide @request_id = @r1, @actor_email = @u_resp, @decision = N'APPROVE', @comment = N'looks right', @emit_result = 0, @o_new_status = @ns OUTPUT, @o_needs_merge = @nm OUTPUT;
    IF @ns <> N'PENDING_ACCOUNTABLE' OR @nm <> 0 SET @txt += N' responsible approval gave ' + ISNULL(@ns, N'NULL') + N' merge ' + ISNULL(CAST(@nm AS nvarchar(2)), N'NULL') + N';';
    IF NOT EXISTS (SELECT 1 FROM app.change_request_event WHERE request_id = @r1 AND event_type = N'RESPONSIBLE_APPROVED' AND approval_stage = N'RESPONSIBLE' AND actor = @u_resp AND actor_group = @rg AND status_from = N'PENDING_RESPONSIBLE' AND status_to = N'PENDING_ACCOUNTABLE' AND comments = N'looks right')
        SET @txt += N' no RESPONSIBLE_APPROVED event;';
    IF NOT EXISTS (SELECT 1 FROM app.notification WHERE request_id = @r1 AND topic = N'REQUEST_PENDING_ACCOUNTABLE' AND recipient_email = @u_acc)
        SET @txt += N' the accountable group was not notified;';
    -- accountable approval: final
    EXEC app.usp_request_decide @request_id = @r1, @actor_email = @u_acc, @decision = N'APPROVE', @emit_result = 0, @o_new_status = @ns OUTPUT, @o_needs_merge = @nm OUTPUT;
    IF @ns <> N'APPROVED' OR @nm <> 1 SET @txt += N' final approval gave ' + ISNULL(@ns, N'NULL') + N' merge ' + ISNULL(CAST(@nm AS nvarchar(2)), N'NULL') + N';';
    IF NOT EXISTS (SELECT 1 FROM app.notification WHERE request_id = @r1 AND topic = N'REQUEST_APPROVED' AND recipient_email = @u_req)
        SET @txt += N' the requester was not told of the approval;';
    -- the merge stub, then the outcome recorded (the stub answers ERROR: the approval stays, the history says why)
    IF OBJECT_DEFINITION(OBJECT_ID(N'gold.usp_apply_approved_change')) LIKE N'%ATLAS-STUB%'
    BEGIN
        INSERT INTO @mg EXEC gold.usp_apply_approved_change @request_id = @r1, @actor = N'system:merge';
        SELECT @mo = outcome, @mm = message FROM @mg;
        INSERT INTO @rec EXEC app.usp_request_record_merge @request_id = @r1, @outcome = @mo, @message = @mm;
        SELECT @s2 = recorded FROM @rec;
        IF @mo <> N'ERROR' OR @s2 <> N'COMMENTED' OR NOT EXISTS (SELECT 1 FROM app.change_request_event WHERE request_id = @r1 AND event_type = N'COMMENTED' AND comments LIKE N'Merge ERROR:%')
            SET @txt += N' merge stub: ' + ISNULL(@mo, N'NULL') + N' recorded as ' + ISNULL(@s2, N'NULL') + N';';
        SELECT @s = request_status FROM app.change_request WHERE request_id = @r1;
        IF @s <> N'APPROVED' SET @txt += N' a failed merge changed the status to ' + @s + N';';
    END
    -- a simulated APPLIED merge is recorded once; asking again adds nothing
    DELETE FROM @rec;
    INSERT INTO @rec EXEC app.usp_request_record_merge @request_id = @r1, @outcome = N'APPLIED', @message = N'simulated', @golden_version_id = 7;
    SELECT @s2 = recorded FROM @rec;
    DELETE FROM @rec;
    INSERT INTO @rec EXEC app.usp_request_record_merge @request_id = @r1, @outcome = N'APPLIED', @message = N'simulated again', @golden_version_id = 7;
    SELECT @s3 = recorded FROM @rec;
    SELECT @n = COUNT(*) FROM app.change_request_event WHERE request_id = @r1 AND event_type = N'MERGED';
    IF @s2 <> N'MERGED' OR @s3 <> N'ALREADY_RECORDED' OR @n <> 1 SET @txt += N' merge recorded as ' + ISNULL(@s2, N'NULL') + N' then ' + ISNULL(@s3, N'NULL') + N', MERGED events ' + CAST(@n AS nvarchar(10)) + N';';
    SELECT @mo = merge_outcome, @n = golden_version_id FROM app.vw_request_detail WHERE request_id = @r1;
    IF @mo <> N'APPLIED' OR @n <> 7 SET @txt += N' vw_request_detail shows merge ' + ISNULL(@mo, N'NULL') + N' version ' + ISNULL(CAST(@n AS nvarchar(10)), N'NULL') + N';';
    -- the export is marked once
    DELETE FROM @rec;
    INSERT INTO @rec EXEC app.usp_request_mark_exported @request_id = @r1, @batch_id = 5, @template_code = N'EQUIPMENT_UPDATE', @row_number = 3;
    SELECT @s2 = recorded FROM @rec;
    DELETE FROM @rec;
    INSERT INTO @rec EXEC app.usp_request_mark_exported @request_id = @r1, @batch_id = 5, @template_code = N'EQUIPMENT_UPDATE', @row_number = 3;
    SELECT @s3 = recorded FROM @rec;
    SELECT @n = COUNT(*) FROM app.change_request_event WHERE request_id = @r1 AND event_type = N'EXPORTED';
    IF @s2 <> N'EXPORTED' OR @s3 <> N'ALREADY_RECORDED' OR @n <> 1 SET @txt += N' export recorded as ' + ISNULL(@s2, N'NULL') + N' then ' + ISNULL(@s3, N'NULL') + N';';
    IF @txt = N'' PRINT 'OK  S1 create, responsible approve, accountable approve (merge due), merge stub answer and a simulated merge recorded once, export marked once, notifications to the right people, checks all PASS';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL S1' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL S1 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- S2 comments, closed requests ------------------------------------------------------ */
BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    SELECT @eid = equipment_id, @cur = mfr FROM @h WHERE n = 2;
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T3 MFR 2',
        @reason = N'T3 lifecycle', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT;
    SET @r2 = @id;
    SET @errno = NULL;
    BEGIN TRY
        EXEC app.usp_request_decide @request_id = @r2, @actor_email = @u_resp, @decision = N'REJECT', @comment = NULL, @emit_result = 0;
    END TRY
    BEGIN CATCH
        SET @errno = ERROR_NUMBER();
    END CATCH;
    IF @errno IS NULL OR @errno <> 50136 SET @txt += N' REJECT without a comment gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N';';
    SET @errno = NULL;
    BEGIN TRY
        EXEC app.usp_request_decide @request_id = @r2, @actor_email = @u_resp, @decision = N'REJECT', @comment = N'    ', @emit_result = 0;
    END TRY
    BEGIN CATCH
        SET @errno = ERROR_NUMBER();
    END CATCH;
    IF @errno IS NULL OR @errno <> 50136 SET @txt += N' REJECT with a blank comment gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N';';
    SET @errno = NULL;
    BEGIN TRY
        EXEC app.usp_request_decide @request_id = @r2, @actor_email = @u_resp, @decision = N'RETURN', @comment = NULL, @emit_result = 0;
    END TRY
    BEGIN CATCH
        SET @errno = ERROR_NUMBER();
    END CATCH;
    IF @errno IS NULL OR @errno <> 50136 SET @txt += N' RETURN without a comment gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N';';
    SELECT @s = request_status FROM app.change_request WHERE request_id = @r2;
    SELECT @n = COUNT(*) FROM app.change_request_event WHERE request_id = @r2;
    IF @s <> N'PENDING_RESPONSIBLE' OR @n <> 1 SET @txt += N' refused decisions changed something: status ' + @s + N', events ' + CAST(@n AS nvarchar(10)) + N';';
    -- with a comment it works, and the requester hears why
    EXEC app.usp_request_decide @request_id = @r2, @actor_email = @u_resp, @decision = N'REJECT', @comment = N'not this heater', @emit_result = 0, @o_new_status = @ns OUTPUT;
    IF @ns <> N'REJECTED' OR NOT EXISTS (SELECT 1 FROM app.change_request_event WHERE request_id = @r2 AND event_type = N'REJECTED' AND comments = N'not this heater' AND status_to = N'REJECTED')
        SET @txt += N' REJECT with a comment gave ' + ISNULL(@ns, N'NULL') + N';';
    IF NOT EXISTS (SELECT 1 FROM app.notification WHERE request_id = @r2 AND topic = N'REQUEST_REJECTED' AND recipient_email = @u_req AND body LIKE N'%not this heater%')
        SET @txt += N' the requester was not told why;';
    -- a closed request cannot be decided
    SET @errno = NULL;
    BEGIN TRY
        EXEC app.usp_request_decide @request_id = @r2, @actor_email = @u_resp, @decision = N'APPROVE', @emit_result = 0;
    END TRY
    BEGIN CATCH
        SET @errno = ERROR_NUMBER();
    END CATCH;
    IF @errno IS NULL OR @errno <> 50134 SET @txt += N' deciding a rejected request gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N';';
    -- not a person, not a decision
    SET @errno = NULL;
    BEGIN TRY
        EXEC app.usp_request_decide @request_id = @r1, @actor_email = N'system:merge', @decision = N'APPROVE', @emit_result = 0;
    END TRY
    BEGIN CATCH
        SET @errno = ERROR_NUMBER();
    END CATCH;
    IF @errno IS NULL OR @errno <> 50131 SET @txt += N' a system actor gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N';';
    IF @txt = N'' PRINT 'OK  S2 reject, return and blank-comment refused (50136) with nothing written; reject with a comment works and the requester is told; a closed request and a system actor are refused';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL S2' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL S2 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- S3 return -> resubmit with a corrected value --------------------------------------- */
BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    SELECT @eid = equipment_id, @cur = mfr FROM @h WHERE n = 3;
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T3 MFR 3',
        @reason = N'T3 lifecycle', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT;
    SET @r3 = @id;
    -- a return cannot go to an outsider (not the submitter, not in either group; rule of 18 Nov 2026)
    SET @errno = NULL;
    BEGIN TRY
        EXEC app.usp_request_decide @request_id = @r3, @actor_email = @u_resp, @decision = N'RETURN', @comment = N'wrong spelling', @return_recipient_type = N'USER', @return_recipient = @u_none, @emit_result = 0;
    END TRY
    BEGIN CATCH
        SET @errno = ERROR_NUMBER();
    END CATCH;
    IF @errno IS NULL OR @errno <> 50137 SET @txt += N' a return to an outsider gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N';';
    EXEC app.usp_request_decide @request_id = @r3, @actor_email = @u_resp, @decision = N'RETURN', @comment = N'wrong spelling', @emit_result = 0, @o_new_status = @ns OUTPUT;
    IF @ns <> N'RETURNED' SET @txt += N' RETURN gave ' + ISNULL(@ns, N'NULL') + N';';
    IF NOT EXISTS (SELECT 1 FROM app.change_request WHERE request_id = @r3 AND return_recipient_type = N'USER' AND return_recipient = @u_req)
        SET @txt += N' the return recipient is not the submitter;';
    IF NOT EXISTS (SELECT 1 FROM app.notification WHERE request_id = @r3 AND topic = N'REQUEST_RETURNED' AND recipient_email = @u_req AND body LIKE N'%wrong spelling%')
        SET @txt += N' the submitter was not told;';
    -- only the recipient may resubmit
    SET @errno = NULL;
    BEGIN TRY
        EXEC app.usp_request_resubmit @request_id = @r3, @actor_email = @u_none, @new_value = N'T3 MFR 3B', @emit_result = 0;
    END TRY
    BEGIN CATCH
        SET @errno = ERROR_NUMBER();
    END CATCH;
    IF @errno IS NULL OR @errno <> 50163 SET @txt += N' resubmit by a stranger gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N';';
    -- a corrected value that is not acceptable is refused, the request stays returned
    SET @errno = NULL;
    BEGIN TRY
        EXEC app.usp_request_resubmit @request_id = @r3, @actor_email = @u_req, @new_value = N'T3 MFR 3 THAT IS FAR TOO LONG FOR THE SAP FIELD', @emit_result = 0;
    END TRY
    BEGIN CATCH
        SET @errno = ERROR_NUMBER();
    END CATCH;
    IF @errno IS NULL OR @errno <> 50121 SET @txt += N' resubmit with a too long value gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N';';
    -- the recipient resubmits with a corrected value
    EXEC app.usp_request_resubmit @request_id = @r3, @actor_email = @u_req, @new_value = N'T3 MFR 3B', @comment = N'corrected', @emit_result = 0, @o_new_status = @ns OUTPUT;
    IF @ns <> N'PENDING_RESPONSIBLE' SET @txt += N' resubmit gave ' + ISNULL(@ns, N'NULL') + N';';
    IF NOT EXISTS (SELECT 1 FROM app.change_request WHERE request_id = @r3 AND request_status = N'PENDING_RESPONSIBLE' AND new_value = N'T3 MFR 3B' AND return_recipient IS NULL AND return_recipient_type IS NULL)
        SET @txt += N' the request row was not updated;';
    IF NOT EXISTS (SELECT 1 FROM app.change_request_event WHERE request_id = @r3 AND event_type = N'RESUBMITTED' AND status_from = N'RETURNED' AND status_to = N'PENDING_RESPONSIBLE' AND comments = N'corrected')
        SET @txt += N' no RESUBMITTED event;';
    -- the key moved with the value: the corrected change raised again is the same open request
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T3 MFR 3B',
        @reason = N'T3 lifecycle', @requested_by = @u_none, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT, @o_outcome = @out OUTPUT;
    IF @out <> N'DUPLICATE_SUPPRESSED' OR @id <> @r3 SET @txt += N' the corrected change raised again gave ' + ISNULL(@out, N'NULL') + N';';
    -- not returned any more
    SET @errno = NULL;
    BEGIN TRY
        EXEC app.usp_request_resubmit @request_id = @r3, @actor_email = @u_req, @emit_result = 0;
    END TRY
    BEGIN CATCH
        SET @errno = ERROR_NUMBER();
    END CATCH;
    IF @errno IS NULL OR @errno <> 50162 SET @txt += N' resubmit of a request that is not returned gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N';';
    IF @txt = N'' PRINT 'OK  S3 return goes to the submitter with the comment; only the recipient resubmits; the corrected value is checked, stored and re-keyed; the request is back at the first stage';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL S3' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL S3 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- S4 return -> cancel ------------------------------------------------------------------ */
BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    SELECT @eid = equipment_id, @cur = mfr FROM @h WHERE n = 4;
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T3 MFR 4',
        @reason = N'T3 lifecycle', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT;
    SET @r4 = @id;
    EXEC app.usp_request_decide @request_id = @r4, @actor_email = @u_resp, @decision = N'RETURN', @comment = N'please check the nameplate', @emit_result = 0;
    SET @errno = NULL;
    BEGIN TRY
        EXEC app.usp_request_cancel @request_id = @r4, @actor_email = @u_none, @emit_result = 0;
    END TRY
    BEGIN CATCH
        SET @errno = ERROR_NUMBER();
    END CATCH;
    IF @errno IS NULL OR @errno <> 50173 SET @txt += N' withdrawal by a stranger gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N';';
    EXEC app.usp_request_cancel @request_id = @r4, @actor_email = @u_req, @comment = N'no longer needed', @emit_result = 0, @o_new_status = @ns OUTPUT;
    IF @ns <> N'CANCELLED' OR NOT EXISTS (SELECT 1 FROM app.change_request_event WHERE request_id = @r4 AND event_type = N'CANCELLED' AND status_from = N'RETURNED' AND status_to = N'CANCELLED' AND comments = N'no longer needed')
        SET @txt += N' withdrawal gave ' + ISNULL(@ns, N'NULL') + N' or wrote no CANCELLED event;';
    SET @errno = NULL;
    BEGIN TRY
        EXEC app.usp_request_cancel @request_id = @r4, @actor_email = @u_req, @emit_result = 0;
    END TRY
    BEGIN CATCH
        SET @errno = ERROR_NUMBER();
    END CATCH;
    IF @errno IS NULL OR @errno <> 50172 SET @txt += N' a second withdrawal gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N';';
    -- the closed request freed its key: the same change can be raised again by a person
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T3 MFR 4',
        @reason = N'T3 lifecycle', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT, @o_outcome = @out OUTPUT;
    IF @out <> N'CREATED' OR @id = @r4 SET @txt += N' raising it again after a withdrawal gave ' + ISNULL(@out, N'NULL') + N';';
    SET @r12 = @id;
    -- the requester may also withdraw a request that is still pending
    EXEC app.usp_request_cancel @request_id = @r12, @actor_email = @u_req, @emit_result = 0, @o_new_status = @ns OUTPUT;
    IF @ns <> N'CANCELLED' SET @txt += N' withdrawing a pending request gave ' + ISNULL(@ns, N'NULL') + N';';
    IF @txt = N'' PRINT 'OK  S4 return then withdraw: a stranger is refused, the requester withdraws, a second withdrawal is refused, the freed change can be raised again';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL S4' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL S4 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- S5 ineligible people, S6 out of scope ------------------------------------------------ */
BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    SELECT @eid = equipment_id, @cur = mfr FROM @h WHERE n = 5;
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T3 MFR 5',
        @reason = N'T3 lifecycle', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT;
    SET @r5 = @id;
    -- nobody, the requester, an unregistered address, and the accountable approver at the first stage: none may decide
    SET @n = 0;
    BEGIN TRY
        EXEC app.usp_request_decide @request_id = @r5, @actor_email = @u_none, @decision = N'APPROVE', @emit_result = 0;
    END TRY
    BEGIN CATCH
        IF ERROR_NUMBER() = 50141 SET @n += 1;
    END CATCH;
    BEGIN TRY
        EXEC app.usp_request_decide @request_id = @r5, @actor_email = @u_req, @decision = N'APPROVE', @emit_result = 0;
    END TRY
    BEGIN CATCH
        IF ERROR_NUMBER() = 50141 SET @n += 1;
    END CATCH;
    BEGIN TRY
        EXEC app.usp_request_decide @request_id = @r5, @actor_email = @u_unreg, @decision = N'REJECT', @comment = N'x', @emit_result = 0;
    END TRY
    BEGIN CATCH
        IF ERROR_NUMBER() = 50141 SET @n += 1;
    END CATCH;
    BEGIN TRY
        EXEC app.usp_request_decide @request_id = @r5, @actor_email = @u_acc, @decision = N'APPROVE', @emit_result = 0;
    END TRY
    BEGIN CATCH
        IF ERROR_NUMBER() = 50141 SET @n += 1;
    END CATCH;
    IF @n <> 4 SET @txt += N' only ' + CAST(@n AS nvarchar(10)) + N' of 4 ineligible people were refused with 50141;';
    SELECT @s = request_status FROM app.change_request WHERE request_id = @r5;
    SELECT @n2 = COUNT(*) FROM app.change_request_event WHERE request_id = @r5;
    IF @s <> N'PENDING_RESPONSIBLE' OR @n2 <> 1 SET @txt += N' a refused decision changed something;';
    -- the checks name the reason; without an approver the row is NOT_CHECKED
    DELETE FROM @chk;
    INSERT INTO @chk EXEC app.usp_request_checks @request_id = @r5, @actor_email = @u_none;
    SELECT @s2 = check_status, @s3 = message FROM @chk WHERE check_code = N'USER_ELIGIBLE_FOR_STAGE';
    IF @s2 <> N'FAIL' OR @s3 NOT LIKE N'%not an active member%' SET @txt += N' the eligibility check said ' + ISNULL(@s2, N'NULL') + N': ' + ISNULL(@s3, N'NULL') + N';';
    DELETE FROM @chk;
    INSERT INTO @chk EXEC app.usp_request_checks @request_id = @r5;
    SELECT @s2 = check_status FROM @chk WHERE check_code = N'USER_ELIGIBLE_FOR_STAGE';
    IF @s2 <> N'NOT_CHECKED' SET @txt += N' without an approver the eligibility check said ' + ISNULL(@s2, N'NULL') + N';';
    SET @errno = NULL;
    BEGIN TRY
        EXEC app.usp_request_checks @request_id = 0, @actor_email = @u_none;
    END TRY
    BEGIN CATCH
        SET @errno = ERROR_NUMBER();
    END CATCH;
    IF @errno IS NULL OR @errno <> 50130 SET @txt += N' checks of an unknown request gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N';';
    IF @txt = N'' PRINT 'OK  S5 a stranger, the requester, an unregistered address and the other stage''s approver are all refused (50141), nothing is written, the checks name the reason';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL S5' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL S5 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    -- a member of ANOTHER region's responsible group (its scope is another profit centre)
    SET @errno = NULL;
    BEGIN TRY
        EXEC app.usp_request_decide @request_id = @r5, @actor_email = @u_other, @decision = N'APPROVE', @emit_result = 0;
    END TRY
    BEGIN CATCH
        SET @errno = ERROR_NUMBER();
    END CATCH;
    IF @errno IS NULL OR @errno <> 50141 SET @txt += N' a member of another region gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N';';
    -- a member of the routed group whose roles lost the stage flag: refused with 50142 (switched off inside the test, switched back below)
    INSERT INTO @undo (assignment_id)
    SELECT a.assignment_id FROM app.principal_role_assignment AS a WHERE a.principal_type = N'GROUP' AND a.principal_key = @rg AND a.is_active = 1;
    UPDATE a SET is_active = 0 FROM app.principal_role_assignment AS a JOIN @undo AS u ON u.assignment_id = a.assignment_id;
    SET @errno = NULL;
    BEGIN TRY
        EXEC app.usp_request_decide @request_id = @r5, @actor_email = @u_resp, @decision = N'APPROVE', @emit_result = 0;
    END TRY
    BEGIN CATCH
        SET @errno = ERROR_NUMBER();
    END CATCH;
    UPDATE a SET is_active = 1 FROM app.principal_role_assignment AS a JOIN @undo AS u ON u.assignment_id = a.assignment_id;
    IF @errno IS NULL OR @errno <> 50142 SET @txt += N' a member without the flag gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N';';
    -- and with the assignments back, the same person may decide
    EXEC app.usp_request_decide @request_id = @r5, @actor_email = @u_resp, @decision = N'REJECT', @comment = N'S6 done', @emit_result = 0, @o_new_status = @ns OUTPUT;
    IF @ns <> N'REJECTED' SET @txt += N' after the assignments were back the approver gave ' + ISNULL(@ns, N'NULL') + N';';
    IF @txt = N'' PRINT 'OK  S6 out of scope: a member of another region is refused (50141); a member whose roles lost the stage flag is refused (50142); restored, the same person may decide';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL S6' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL S6 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- S7 the same person at both stages ------------------------------------------------------ */
BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    SELECT @eid = equipment_id, @cur = mfr FROM @h WHERE n = 6;
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T3 MFR 6',
        @reason = N'T3 lifecycle', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT;
    SET @r6 = @id;
    EXEC app.usp_request_decide @request_id = @r6, @actor_email = @u_both, @decision = N'APPROVE', @emit_result = 0, @o_new_status = @ns OUTPUT;
    IF @ns <> N'PENDING_ACCOUNTABLE' SET @txt += N' first stage gave ' + ISNULL(@ns, N'NULL') + N';';
    -- changed 18 Nov 2026 (client, Q-479): a member of BOTH groups may approve both stages; the check says so
    DELETE FROM @chk;
    INSERT INTO @chk EXEC app.usp_request_checks @request_id = @r6, @actor_email = @u_both;
    SELECT @s2 = check_status, @s3 = message FROM @chk WHERE check_code = N'USER_ELIGIBLE_FOR_STAGE';
    IF @s2 <> N'PASS' SET @txt += N' the eligibility check said ' + ISNULL(@s2, N'NULL') + N': ' + ISNULL(@s3, N'NULL') + N';';
    EXEC app.usp_request_decide @request_id = @r6, @actor_email = @u_both, @decision = N'APPROVE', @emit_result = 0, @o_new_status = @ns OUTPUT;
    IF @ns <> N'APPROVED' SET @txt += N' the same person (member of both groups) at the second stage gave ' + ISNULL(@ns, N'NULL') + N';';
    IF NOT EXISTS (SELECT 1 FROM app.change_request_event WHERE request_id = @r6 AND event_type = N'ACCOUNTABLE_APPROVED' AND actor = @u_both
                     AND JSON_VALUE(event_details_json, '$.decided_as') = N'GROUP_MEMBER'
                     AND JSON_VALUE(event_details_json, '$.same_person_both_stages') = N'true')
        SET @txt += N' the second approval does not record decided_as GROUP_MEMBER and same_person_both_stages;';
    -- a person in only the first group still cannot approve the second stage (50141)
    SELECT @eid = equipment_id, @cur = mfr FROM @h WHERE n = 7;
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T3 MFR 7',
        @reason = N'T3 lifecycle', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT;
    SET @r7 = @id;
    EXEC app.usp_request_decide @request_id = @r7, @actor_email = @u_resp, @decision = N'APPROVE', @emit_result = 0;
    SET @errno = NULL;
    BEGIN TRY
        EXEC app.usp_request_decide @request_id = @r7, @actor_email = @u_resp, @decision = N'APPROVE', @emit_result = 0;
    END TRY
    BEGIN CATCH
        SET @errno = ERROR_NUMBER();
    END CATCH;
    IF @errno IS NULL OR @errno <> 50141 SET @txt += N' a first-group-only approver at the second stage gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N' (expected 50141);';
    EXEC app.usp_request_decide @request_id = @r7, @actor_email = @u_acc, @decision = N'APPROVE', @emit_result = 0, @o_new_status = @ns OUTPUT;
    IF @ns <> N'APPROVED' SET @txt += N' a second person gave ' + ISNULL(@ns, N'NULL') + N';';
    IF @txt = N'' PRINT 'OK  S7 both stages (rule of 18 Nov): a member of both groups approves both, the check says PASS and the event records GROUP_MEMBER and same person; a first-group-only approver is still refused at stage 2 (50141); another person finishes it';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL S7' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL S7 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- S8 a failing check blocks approval (gold moved on) ---------------------------------------- */
BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    SELECT @eid = equipment_id, @cur = mfr FROM @h WHERE n = 8;
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T3 MFR 8',
        @reason = N'T3 lifecycle', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT;
    SET @r8 = @id;
    -- after the request was raised the golden value changes (a stub row is edited inside this test)
    UPDATE dev.stub_equipment SET manufacturer = N'T3 CHANGED' WHERE equipment_id = @eid;
    DELETE FROM @chk;
    INSERT INTO @chk EXEC app.usp_request_checks @request_id = @r8, @actor_email = @u_resp;
    SELECT @s2 = check_status, @s3 = message FROM @chk WHERE check_code = N'OLD_VALUE_CURRENT';
    IF @s2 <> N'FAIL' OR @s3 NOT LIKE N'%T3 CHANGED%' SET @txt += N' OLD_VALUE_CURRENT said ' + ISNULL(@s2, N'NULL') + N': ' + ISNULL(@s3, N'NULL') + N';';
    SELECT @n = COUNT(*) FROM @chk WHERE check_status = N'FAIL';
    IF @n <> 1 SET @txt += N' ' + CAST(@n AS nvarchar(10)) + N' checks failed (expected only OLD_VALUE_CURRENT);';
    SET @errno = NULL; SET @s3 = NULL;
    BEGIN TRY
        EXEC app.usp_request_decide @request_id = @r8, @actor_email = @u_resp, @decision = N'APPROVE', @emit_result = 0;
    END TRY
    BEGIN CATCH
        SET @errno = ERROR_NUMBER(); SET @s3 = ERROR_MESSAGE();
    END CATCH;
    IF @errno IS NULL OR @errno <> 50144 OR @s3 NOT LIKE N'%OLD_VALUE_CURRENT%' SET @txt += N' approval gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N' ' + ISNULL(@s3, N'') + N';';
    SELECT @s = request_status FROM app.change_request WHERE request_id = @r8;
    IF @s <> N'PENDING_RESPONSIBLE' SET @txt += N' the blocked approval changed the status to ' + @s + N';';
    -- a stale request can still be rejected, and then every check reads NOT_CHECKED
    EXEC app.usp_request_decide @request_id = @r8, @actor_email = @u_resp, @decision = N'REJECT', @comment = N'stale', @emit_result = 0, @o_new_status = @ns OUTPUT;
    IF @ns <> N'REJECTED' SET @txt += N' rejecting the stale request gave ' + ISNULL(@ns, N'NULL') + N';';
    DELETE FROM @chk;
    INSERT INTO @chk EXEC app.usp_request_checks @request_id = @r8, @actor_email = @u_resp;
    SELECT @n = COUNT(*) FROM @chk WHERE check_status = N'NOT_CHECKED';
    IF @n <> 6 SET @txt += N' a closed request showed ' + CAST(@n AS nvarchar(10)) + N' NOT_CHECKED rows (expected 6);';
    -- a request whose heater moved to another location: the association check fails
    SELECT @eid = equipment_id, @cur = model FROM @h WHERE n = 12;
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MODEL_NUMBER', @new_value = N'T3 MODEL 12',
        @reason = N'T3 lifecycle', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT;
    SET @r12 = @id;
    UPDATE r SET functional_location = N'SYN-FL-MOVED' FROM app.change_request AS r WHERE r.request_id = @r12;
    DELETE FROM @chk;
    INSERT INTO @chk EXEC app.usp_request_checks @request_id = @r12, @actor_email = @u_resp;
    SELECT @s2 = check_status FROM @chk WHERE check_code = N'ASSOCIATION_MATCH';
    IF @s2 <> N'FAIL' SET @txt += N' ASSOCIATION_MATCH said ' + ISNULL(@s2, N'NULL') + N' for a heater that is elsewhere;';
    IF @txt = N'' PRINT 'OK  S8 a failing check blocks approval (50144 names OLD_VALUE_CURRENT, nothing written), a stale request can still be rejected, a closed request reads NOT_CHECKED, a moved heater fails ASSOCIATION_MATCH';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL S8' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL S8 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- S9 duplicates, S10 incompatible -------------------------------------------------------- */
BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    SELECT @eid = equipment_id, @cur = mfr FROM @h WHERE n = 9;
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T3 MFR 9',
        @reason = N'T3 lifecycle', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT, @o_outcome = @out OUTPUT;
    SET @r9 = @id;
    IF @out <> N'CREATED' SET @txt += N' first create gave ' + ISNULL(@out, N'NULL') + N';';
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T3 MFR 9',
        @reason = N'T3 lifecycle again', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT, @o_outcome = @out OUTPUT;
    IF @out <> N'DUPLICATE_SUPPRESSED' OR @id <> @r9 SET @txt += N' the same person again gave ' + ISNULL(@out, N'NULL') + N';';
    EXEC app.usp_request_create @source_type = N'FIELD', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T3 MFR 9',
        @reason = N'another person, another source', @requested_by = @u_none, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT, @o_outcome = @out OUTPUT;
    IF @out <> N'DUPLICATE_SUPPRESSED' OR @id <> @r9 SET @txt += N' another person and source gave ' + ISNULL(@out, N'NULL') + N';';
    SELECT @n = COUNT(*) FROM app.change_request WHERE equipment_id = @eid AND field_code = N'MANUFACTURER' AND request_status = N'PENDING_RESPONSIBLE';
    IF @n <> 1 SET @txt += N' ' + CAST(@n AS nvarchar(10)) + N' open requests for the one change;';
    -- the notification a request already sent is not sent twice
    SELECT @n = COUNT(*) FROM app.notification WHERE request_id = @r9;
    EXEC app.usp_notification_enqueue @topic = N'REQUEST_PENDING_RESPONSIBLE', @request_id = @r9, @event_key = N'CREATED', @title = N't', @body = N'b', @recipient_group = @rg;
    SELECT @n2 = COUNT(*) FROM app.notification WHERE request_id = @r9;
    IF @n <> @n2 SET @txt += N' the same notification was queued twice (' + CAST(@n AS nvarchar(10)) + N' then ' + CAST(@n2 AS nvarchar(10)) + N');';
    -- after a rejection a person may raise it again (that is an explicit new request)
    SELECT @eid = equipment_id, @cur = mfr FROM @h WHERE n = 10;
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T3 MFR 10',
        @reason = N'T3 lifecycle', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT;
    SET @r10 = @id;
    EXEC app.usp_request_decide @request_id = @r10, @actor_email = @u_resp, @decision = N'REJECT', @comment = N'try later', @emit_result = 0;
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T3 MFR 10',
        @reason = N'raised again', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT, @o_outcome = @out OUTPUT;
    IF @out <> N'CREATED' OR @id = @r10 SET @txt += N' raising it again after a rejection gave ' + ISNULL(@out, N'NULL') + N';';
    IF @txt = N'' PRINT 'OK  S9 a duplicate is suppressed whoever raises it (one open request, the first one returned), a queued notification is not queued twice, a person may raise it again after a rejection';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL S9' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL S9 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    SELECT @eid = equipment_id, @cur = mfr FROM @h WHERE n = 9;
    -- R9 (heater 9, MANUFACTURER) is still open: a DIFFERENT new value for the same field is blocked
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T3 MFR 9 OTHER',
        @reason = N'T3 lifecycle', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT, @o_outcome = @out OUTPUT;
    IF @out <> N'BLOCKED_INCOMPATIBLE' OR @id <> @r9 SET @txt += N' a different value for the same field gave ' + ISNULL(@out, N'NULL') + N' (id ' + ISNULL(CAST(@id AS nvarchar(20)), N'NULL') + N');';
    -- a different field of the same heater is not blocked (the engineering tag, so S11's model-number requests stay free)
    SELECT @s3 = equipment_tag_number FROM gold.vw_equipment_current WHERE equipment_id = @eid;
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'EQUIPMENT_TAG_NUMBER', @new_value = N'T3-TAG-9',
        @reason = N'T3 lifecycle', @requested_by = @u_req, @equipment_id = @eid, @old_value = @s3, @emit_result = 0, @o_request_id = @id OUTPUT, @o_outcome = @out OUTPUT;
    IF @out <> N'CREATED' SET @txt += N' a different field gave ' + ISNULL(@out, N'NULL') + N';';
    SELECT @n = COUNT(*) FROM app.change_request WHERE equipment_id = @eid AND field_code = N'MANUFACTURER' AND request_status = N'PENDING_RESPONSIBLE';
    IF @n <> 1 SET @txt += N' the blocked request was written anyway;';
    -- the overlap flag of the view sees the open requests of one heater
    SELECT @n = other_open_requests_same_field FROM app.vw_equipment_request WHERE request_id = @r9;
    IF @n <> 0 SET @txt += N' vw_equipment_request flags an overlap (' + CAST(@n AS nvarchar(10)) + N') where there is none;';
    IF @txt = N'' PRINT 'OK  S10 an incompatible open request on the same field is blocked (and names the open one), a different field is accepted';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL S10' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL S10 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- S11 bulk of 10 with one failing check ---------------------------------------------------- */
BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    DECLARE @ids nvarchar(4000) = N'';
    DECLARE @i int = 1, @bad_id bigint;
    WHILE @i <= 10
    BEGIN
        -- the fifth request carries an old value that is not what gold holds, so its approval check fails
        SELECT @eid = equipment_id, @cur = CASE WHEN @i = 5 THEN N'WRONG OLD MODEL' ELSE model END FROM @h WHERE n = @i;
        EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MODEL_NUMBER', @new_value = N'T3 BULK',
            @reason = N'T3 bulk', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0,
            @o_request_id = @id OUTPUT, @o_outcome = @out OUTPUT, @o_responsible_group = @rgo OUTPUT;
        IF @out <> N'CREATED' OR @rgo <> @rg SET @txt += N' request ' + CAST(@i AS nvarchar(10)) + N' gave ' + ISNULL(@out, N'NULL') + N' for ' + ISNULL(@rgo, N'NULL') + N';';
        IF @i = 5 SET @bad_id = @id;
        SET @ids = @ids + CAST(@id AS nvarchar(20)) + N',';
        SET @i += 1;
    END
    SET @ids = @ids + N'abc,' + LEFT(@ids, CHARINDEX(N',', @ids) - 1);    -- one invalid entry and one repeated number
    SELECT @n = COUNT(*) FROM app.change_request_event;
    INSERT INTO @bulk EXEC app.usp_request_bulk_decide @request_ids = @ids, @actor_email = @u_resp, @decision = N'APPROVE', @comment = N'bulk';
    SELECT @n2 = SUM(CASE WHEN outcome = N'DECIDED' THEN 1 ELSE 0 END), @n3 = SUM(CASE WHEN outcome = N'SKIPPED' THEN 1 ELSE 0 END) FROM @bulk;
    IF @n2 <> 9 OR @n3 <> 2 SET @txt += N' decided ' + CAST(@n2 AS nvarchar(10)) + N', skipped ' + CAST(@n3 AS nvarchar(10)) + N' (expected 9 and 2: the failing check and the invalid entry);';
    SELECT @s3 = reason FROM @bulk WHERE request_id = @bad_id;
    IF @s3 IS NULL OR @s3 NOT LIKE N'%OLD_VALUE_CURRENT%' SET @txt += N' the failing request was skipped with "' + ISNULL(@s3, N'NULL') + N'";';
    IF EXISTS (SELECT 1 FROM @bulk WHERE outcome = N'DECIDED' AND (new_status <> N'PENDING_ACCOUNTABLE' OR needs_merge <> 0)) SET @txt += N' a decided row has the wrong status;';
    SELECT @n3 = COUNT(*) FROM app.change_request_event;
    IF @n3 - @n <> 9 SET @txt += N' ' + CAST(@n3 - @n AS nvarchar(10)) + N' events were written (expected 9);';
    SELECT @s = request_status FROM app.change_request WHERE request_id = @bad_id;
    IF @s <> N'PENDING_RESPONSIBLE' SET @txt += N' the skipped request is ' + @s + N';';
    -- an empty list and a list over the limit are refused
    SET @errno = NULL;
    BEGIN TRY
        INSERT INTO @bulk EXEC app.usp_request_bulk_decide @request_ids = N' , ', @actor_email = @u_resp, @decision = N'APPROVE';
    END TRY
    BEGIN CATCH
        SET @errno = ERROR_NUMBER();
    END CATCH;
    IF @errno IS NULL OR @errno <> 50151 SET @txt += N' an empty list gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N';';
    IF @txt = N'' PRINT 'OK  S11 bulk of 10: 9 decided with 9 events, the failing request skipped with its reason (OLD_VALUE_CURRENT), an invalid entry skipped, a repeated number counted once, an empty list refused';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL S11' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL S11 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- S14 refused inputs -------------------------------------------------------------------------- */
BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    DECLARE @bad TABLE (label nvarchar(60) NOT NULL, expected int NOT NULL, got int NULL);
    SELECT @eid = equipment_id, @cur = mfr FROM @h WHERE n = 13;
    DECLARE @hd nvarchar(400) = (SELECT f.current_value FROM gold.vw_equipment_field_current AS f WHERE f.equipment_id = @eid AND f.field_code = N'HEAT_DUTY');

    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'X', @reason = N'r', @requested_by = @u_unreg, @equipment_id = @eid, @old_value = @cur, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'unregistered person', 50107, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'EQUIP_CLASS', @new_value = N'T3CLASS', @reason = N'r', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'admin-only field by a non-admin', 50113, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'NOT_A_FIELD', @new_value = N'X', @reason = N'r', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'unknown field', 50110, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'FLOC_CLASS', @new_value = N'X', @reason = N'r', @requested_by = @u_admin, @equipment_id = @eid, @old_value = @cur, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'a FLOC field on a heater', 50112, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'X', @reason = N'r', @requested_by = @u_req, @equipment_id = 99999999, @old_value = @cur, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'a heater that is not in gold', 50115, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'X', @reason = N'r', @requested_by = @u_req, @old_value = @cur, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'no heater named', 50114, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'ROOM', @field_code = N'MANUFACTURER', @new_value = N'X', @reason = N'r', @requested_by = @u_req, @equipment_id = @eid, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'an unknown entity type', 50103, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'GUESS', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'X', @reason = N'r', @requested_by = @u_req, @equipment_id = @eid, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'an unknown source', 50101, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'NEW_CHARACTERISTIC', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'X', @reason = N'r', @requested_by = @u_req, @equipment_id = @eid, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'a source with its own procedure', 50102, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'BUSINESS_RULE', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'X', @reason = N'r', @requested_by = @u_req, @equipment_id = @eid, @source_rule_id = N'T3_TEST_RULE', @source_rule_version = 1, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'a person claiming a rule source', 50105, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'X', @reason = N'r', @requested_by = N'system:rule-run', @equipment_id = @eid, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'the system claiming a person''s source', 50105, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'BUSINESS_RULE', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'X', @reason = N'r', @requested_by = N'system:rule-run', @equipment_id = @eid, @source_rule_id = N'T3_NO_SUCH_RULE', @source_rule_version = 1, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'an unknown rule version', 50108, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'', @reason = N'r', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'an empty new value', 50121, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'THIRTY-ONE CHARACTERS LONG TEXT', @reason = N'r', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'longer than the SAP field', 50121, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'FIRED_UNFIRED', @new_value = N'MAYBE', @reason = N'r', @requested_by = @u_req, @equipment_id = @eid, @old_value = N'FIRED', @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'a value outside the allowed list', 50121, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'FIRED_UNFIRED', @new_value = N'unfired', @reason = N'r', @requested_by = @u_req, @equipment_id = @eid, @old_value = N'FIRED', @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'an allowed value in the wrong letter case', 50121, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'HEAT_DUTY', @new_value = N'abc', @reason = N'r', @requested_by = @u_req, @equipment_id = @eid, @old_value = @hd, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'a number that is text', 50121, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'HEAT_DUTY', @new_value = N'-3', @reason = N'r', @requested_by = @u_req, @equipment_id = @eid, @old_value = @hd, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'a negative number', 50121, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'HEAT_DUTY', @new_value = N'1.23456', @reason = N'r', @requested_by = @u_req, @equipment_id = @eid, @old_value = @hd, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'five decimals', 50121, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = @cur, @reason = N'r', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'the same text as the old value', 50120, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'HEAT_DUTY', @new_value = N'2.5', @reason = N'r', @requested_by = @u_req, @equipment_id = @eid, @old_value = N'2.5000', @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'the same number written differently', 50120, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'X', @reason = N'   ', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'no reason', 50123, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'X', @reason = N'r', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @evidence_json = N'{not json', @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @bad VALUES (N'evidence that is not JSON', 50122, @errno);

    SELECT @txt = STRING_AGG(CAST(b.label + N' (expected ' + CAST(b.expected AS nvarchar(10)) + N', got ' + ISNULL(CAST(b.got AS nvarchar(10)), N'no error') + N')' AS nvarchar(max)), N'; ')
    FROM @bad AS b WHERE b.got IS NULL OR b.got <> b.expected;
    SELECT @n = COUNT(*) FROM @bad;
    SELECT @n2 = COUNT(*) FROM app.change_request WHERE request_status <> N'APPROVED' AND request_status <> N'REJECTED' AND request_status <> N'CANCELLED' AND old_value = @cur AND new_value = N'X';
    IF @txt IS NULL SET @txt = N'';
    IF @n2 <> 0 SET @txt += N' a refused request was written anyway;';
    -- the accepted side: an admin may change a classification field, a person may change a number
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'EQUIP_CLASS', @new_value = N'T3CLASS', @reason = N'r', @requested_by = @u_admin,
        @equipment_id = @eid, @old_value = N'VESSEL', @emit_result = 0, @o_outcome = @out OUTPUT;
    IF @out <> N'CREATED' SET @txt += N' an admin on an admin-only field gave ' + ISNULL(@out, N'NULL') + N';';
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'HEAT_DUTY', @new_value = N'3.25', @reason = N'r', @requested_by = @u_req,
        @equipment_id = @eid, @old_value = @hd, @emit_result = 0, @o_outcome = @out OUTPUT;
    IF @out <> N'CREATED' SET @txt += N' a valid number gave ' + ISNULL(@out, N'NULL') + N';';
    IF @txt = N'' PRINT 'OK  S14 ' + CAST(@n AS varchar(10)) + ' refused inputs each gave the expected error and wrote nothing; an admin may change a classification field and a person a number';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL S14' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL S14 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- S15 status values, S16 locations (D-18) ------------------------------------------------------- */
BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    DECLARE @st TABLE (label nvarchar(40) NOT NULL, expected int NOT NULL, got int NULL);
    SELECT @eid = equipment_id FROM @h WHERE n = 11;
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'EQUIPMENT_USER_STATUS', @new_value = N'OOSR', @reason = N'r', @requested_by = @u_req, @equipment_id = @eid, @old_value = N'OPER', @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @st VALUES (N'OOSR', 50121, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'EQUIPMENT_USER_STATUS', @new_value = N'AVFS DECM', @reason = N'r', @requested_by = @u_req, @equipment_id = @eid, @old_value = N'OPER', @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @st VALUES (N'AVFS DECM', 50121, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'EQUIPMENT_USER_STATUS', @new_value = N'SOLD', @reason = N'r', @requested_by = @u_req, @equipment_id = @eid, @old_value = N'OPER', @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @st VALUES (N'SOLD', 50121, @errno);
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'EQUIPMENT_USER_STATUS', @new_value = N'nope', @reason = N'r', @requested_by = @u_req, @equipment_id = @eid, @old_value = N'OPER', @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    INSERT INTO @st VALUES (N'nope (letter case)', 50121, @errno);
    SELECT @txt = STRING_AGG(CAST(t.label + N' (got ' + ISNULL(CAST(t.got AS nvarchar(10)), N'no error') + N')' AS nvarchar(max)), N'; ') FROM @st AS t WHERE t.got IS NULL OR t.got <> t.expected;
    IF @txt IS NOT NULL SET @txt = N' not refused as expected: ' + @txt + N';'; ELSE SET @txt = N'';
    -- the four allowed codes pass the value check (the check of the value alone; the request is raised for one)
    SELECT @n = COUNT(*) FROM (VALUES (N'AVFS'), (N'NOPE'), (N'OPER'), (N'DECM')) AS v (code) CROSS APPLY app.fn_value_check(N'EQUIPMENT_USER_STATUS', v.code) AS c WHERE c.problem IS NULL;
    IF @n <> 4 SET @txt += N' only ' + CAST(@n AS nvarchar(10)) + N' of the 4 allowed codes passed the value check;';
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'EQUIPMENT_USER_STATUS', @new_value = N'NOPE', @reason = N'out of service', @requested_by = @u_req,
        @equipment_id = @eid, @old_value = N'OPER', @emit_result = 0, @o_outcome = @out OUTPUT;
    IF @out <> N'CREATED' SET @txt += N' NOPE gave ' + ISNULL(@out, N'NULL') + N';';
    IF @txt = N'' PRINT 'OK  S15 equipment status: OOSR, SOLD, "AVFS DECM" and a wrong letter case are refused (50121); AVFS, NOPE, OPER, DECM pass; NOPE is accepted';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL S15' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL S15 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    DECLARE @floc_old nvarchar(40), @floc_new nvarchar(40);
    SELECT @eid = equipment_id, @floc_old = floc FROM @h WHERE n = 14;
    SELECT @floc_new = floc FROM @h WHERE n = 1;
    SET @errno = NULL; BEGIN TRY EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'FUNCTIONAL_LOCATION', @new_value = N'SYN-FL-DOES-NOT-EXIST', @reason = N'moved', @requested_by = @u_req, @equipment_id = @eid, @old_value = @floc_old, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    IF @errno IS NULL OR @errno <> 50121 SET @txt += N' a location that does not exist gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N';';
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'FUNCTIONAL_LOCATION', @new_value = @floc_new, @reason = N'moved', @requested_by = @u_req,
        @equipment_id = @eid, @old_value = @floc_old, @emit_result = 0, @o_request_id = @id OUTPUT, @o_outcome = @out OUTPUT;
    IF @out <> N'CREATED' SET @txt += N' a location that exists gave ' + ISNULL(@out, N'NULL') + N';';
    -- the request carries the heater's location at creation; the checks pass while the heater is still there
    DELETE FROM @chk;
    INSERT INTO @chk EXEC app.usp_request_checks @request_id = @id, @actor_email = @u_resp;
    SELECT @s2 = check_status FROM @chk WHERE check_code = N'ASSOCIATION_MATCH';
    SELECT @s3 = check_status FROM @chk WHERE check_code = N'OLD_VALUE_CURRENT';
    IF @s2 <> N'PASS' OR @s3 <> N'PASS' SET @txt += N' the checks of a location change said ' + ISNULL(@s2, N'NULL') + N' / ' + ISNULL(@s3, N'NULL') + N';';
    -- a FLOC request: the class of a location (admin-only field, so by the admin), checked against gold.vw_floc_current
    DECLARE @fl nvarchar(40), @fcl nvarchar(30);
    SELECT TOP (1) @fl = functional_location, @fcl = floc_class FROM gold.vw_floc_current ORDER BY functional_location;
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'FLOC', @functional_location = @fl, @field_code = N'FLOC_CLASS', @new_value = N'T3FLOCCLASS', @reason = N'reclassified',
        @requested_by = @u_admin, @old_value = @fcl, @emit_result = 0, @o_request_id = @id OUTPUT, @o_outcome = @out OUTPUT;
    IF @out <> N'CREATED' SET @txt += N' a FLOC request gave ' + ISNULL(@out, N'NULL') + N';';
    -- no approver named: the five data checks pass and the eligibility row is NOT_CHECKED
    DELETE FROM @chk;
    INSERT INTO @chk EXEC app.usp_request_checks @request_id = @id;
    SELECT @n = SUM(CASE WHEN check_status = N'PASS' THEN 1 ELSE 0 END), @n2 = SUM(CASE WHEN check_status = N'NOT_CHECKED' THEN 1 ELSE 0 END) FROM @chk;
    IF @n <> 5 OR @n2 <> 1 SET @txt += N' a FLOC request passed ' + CAST(@n AS nvarchar(10)) + N' checks and left ' + CAST(@n2 AS nvarchar(10)) + N' not checked (expected 5 and 1);';
    IF @txt = N'' PRINT 'OK  S16 location change: a FLOC that does not exist is refused (50121), one that exists is accepted and its checks pass; a FLOC request (class of a location) is accepted and its checks pass';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL S16' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL S16 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- E1 a rule request -------------------------------------------------------------------------------- */
BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    SELECT @eid = equipment_id, @cur = mfr FROM @h WHERE n = 14;
    EXEC app.usp_request_create @source_type = N'BUSINESS_RULE', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T3 RULE MFR', @reason = N'rule found it',
        @requested_by = N'system:rule-run', @equipment_id = @eid, @old_value = @cur, @source_rule_id = N'T3_TEST_RULE', @source_rule_version = 1, @note = N'TBD',
        @evidence_json = N'{"seen":"yes"}', @emit_result = 0, @o_request_id = @id OUTPUT, @o_outcome = @out OUTPUT;
    SET @r11 = @id;
    IF @out <> N'CREATED' SET @txt += N' the rule request gave ' + ISNULL(@out, N'NULL') + N';';
    IF NOT EXISTS (SELECT 1 FROM app.change_request_event WHERE request_id = @r11 AND event_type = N'CREATED' AND actor = N'system:rule-run' AND JSON_VALUE(event_details_json, '$.evidence.seen') = N'yes')
        SET @txt += N' the evidence snapshot is not on the CREATED event;';
    EXEC app.usp_request_create @source_type = N'BUSINESS_RULE', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T3 RULE MFR', @reason = N'rule found it again',
        @requested_by = N'system:rule-run', @equipment_id = @eid, @old_value = @cur, @source_rule_id = N'T3_TEST_RULE', @source_rule_version = 1, @emit_result = 0, @o_request_id = @id OUTPUT, @o_outcome = @out OUTPUT;
    IF @out <> N'DUPLICATE_SUPPRESSED' OR @id <> @r11 SET @txt += N' the rule run again gave ' + ISNULL(@out, N'NULL') + N';';
    -- returned to the rule's resolution group (not to "system:rule-run"), and that group may resubmit
    EXEC app.usp_request_decide @request_id = @r11, @actor_email = @u_resp, @decision = N'RETURN', @comment = N'the rule is wrong here', @emit_result = 0, @o_new_status = @ns OUTPUT;
    IF NOT EXISTS (SELECT 1 FROM app.change_request WHERE request_id = @r11 AND request_status = N'RETURNED' AND return_recipient_type = N'GROUP' AND return_recipient = @rg2)
        SET @txt += N' the rule request was not returned to the resolution group;';
    IF NOT EXISTS (SELECT 1 FROM app.notification WHERE request_id = @r11 AND topic = N'REQUEST_RETURNED' AND recipient_email = @u_other)
        SET @txt += N' the resolution group was not told;';
    EXEC app.usp_request_resubmit @request_id = @r11, @actor_email = @u_other, @comment = N'checked', @emit_result = 0, @o_new_status = @ns OUTPUT;
    IF @ns <> N'PENDING_RESPONSIBLE' SET @txt += N' the resolution group resubmit gave ' + ISNULL(@ns, N'NULL') + N';';
    -- after a rejection a RULE stays suppressed, a person may raise it
    EXEC app.usp_request_decide @request_id = @r11, @actor_email = @u_resp, @decision = N'REJECT', @comment = N'not a defect', @emit_result = 0;
    EXEC app.usp_request_create @source_type = N'BUSINESS_RULE', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T3 RULE MFR', @reason = N'rule found it a third time',
        @requested_by = N'system:rule-run', @equipment_id = @eid, @old_value = @cur, @source_rule_id = N'T3_TEST_RULE', @source_rule_version = 1, @emit_result = 0, @o_request_id = @id OUTPUT, @o_outcome = @out OUTPUT;
    IF @out <> N'DUPLICATE_SUPPRESSED' OR @id <> @r11 SET @txt += N' the rule after a rejection gave ' + ISNULL(@out, N'NULL') + N';';
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T3 RULE MFR', @reason = N'I disagree with the rejection',
        @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT, @o_outcome = @out OUTPUT;
    IF @out <> N'CREATED' SET @txt += N' a person after the rejection gave ' + ISNULL(@out, N'NULL') + N';';
    -- the evidence snapshot is read back through its own procedure; an unknown request is refused
    DECLARE @ev TABLE (request_id bigint NULL, request_ref nvarchar(12) NULL, created_at_utc datetime2(3) NULL, created_by nvarchar(256) NULL, details_json nvarchar(max) NULL);
    INSERT INTO @ev EXEC app.usp_request_evidence @request_id = @r11;
    SELECT @n = COUNT(*) FROM @ev WHERE created_by = N'system:rule-run' AND JSON_VALUE(details_json, '$.evidence.seen') = N'yes' AND JSON_VALUE(details_json, '$.source_type') = N'BUSINESS_RULE';
    IF @n <> 1 SET @txt += N' usp_request_evidence did not return the evidence snapshot;';
    SET @errno = NULL;
    BEGIN TRY
        EXEC app.usp_request_evidence @request_id = 0;
    END TRY
    BEGIN CATCH
        SET @errno = ERROR_NUMBER();
    END CATCH;
    IF @errno IS NULL OR @errno <> 50201 SET @txt += N' evidence of an unknown request gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N';';
    IF @txt = N'' PRINT 'OK  E1 a rule request keeps its evidence (read back by usp_request_evidence), a rerun is suppressed, a return goes to the rule''s resolution group which may resubmit, a rule stays suppressed after a rejection while a person may raise it again';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL E1' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL E1 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- S12 one event per status change, S13 nothing deleted ------------------------------------------------ */
BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    -- over EVERY request in the table: the status-carrying events form an unbroken chain from NULL to the request's status
    SELECT @n = COUNT(*)
    FROM (SELECT ev.request_id, ev.status_from, ev.status_to,
                 LAG(ev.status_to) OVER (PARTITION BY ev.request_id ORDER BY ev.event_id) AS prev_to,
                 ROW_NUMBER() OVER (PARTITION BY ev.request_id ORDER BY ev.event_id) AS rn
          FROM app.change_request_event AS ev
          WHERE ev.status_to IS NOT NULL) AS x
    WHERE (x.rn = 1 AND x.status_from IS NOT NULL)
       OR (x.rn > 1 AND (x.status_from IS NULL OR x.status_from <> x.prev_to))
       OR x.status_from = x.status_to;
    IF @n <> 0 SET @txt += N' ' + CAST(@n AS nvarchar(10)) + N' events break the status chain;';
    SELECT @n = COUNT(*)
    FROM app.change_request AS r
    WHERE (SELECT TOP (1) ev.status_to FROM app.change_request_event AS ev WHERE ev.request_id = r.request_id AND ev.status_to IS NOT NULL ORDER BY ev.event_id DESC) <> r.request_status
       OR NOT EXISTS (SELECT 1 FROM app.change_request_event AS ev WHERE ev.request_id = r.request_id AND ev.event_type = N'CREATED');
    IF @n <> 0 SET @txt += N' ' + CAST(@n AS nvarchar(10)) + N' requests whose last event does not match the status or that have no CREATED event;';
    -- every decision event carries its stage and a group; every rejected or returned one its comment
    SELECT @n = COUNT(*) FROM app.change_request_event AS ev
    WHERE (ev.event_type IN (N'RESPONSIBLE_APPROVED', N'ACCOUNTABLE_APPROVED', N'REJECTED', N'RETURNED') AND (ev.approval_stage IS NULL OR ev.actor_group IS NULL))
       OR (ev.event_type IN (N'REJECTED', N'RETURNED') AND (ev.comments IS NULL OR LTRIM(RTRIM(ev.comments)) = N''));
    IF @n <> 0 SET @txt += N' ' + CAST(@n AS nvarchar(10)) + N' decision events lack a stage, a group or a mandatory comment;';
    IF @txt = N'' PRINT 'OK  S12 every request has a CREATED event and its status-carrying events form an unbroken chain to its current status; every decision names its stage and group; reject and return always carry a comment';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL S12' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL S12 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    SELECT @txt = STRING_AGG(CAST(o.name AS nvarchar(max)), N', ')
    FROM sys.objects AS o
    JOIN sys.sql_modules AS m ON m.object_id = o.object_id
    WHERE o.schema_id = SCHEMA_ID(N'app')
      AND (o.name LIKE N'usp[_]request[_]%' OR o.name = N'usp_notification_enqueue')
      AND (m.definition LIKE N'%DELETE FROM%' OR m.definition LIKE N'%TRUNCATE TABLE%' OR m.definition LIKE N'%UPDATE app.change_request_event%' OR m.definition LIKE N'%DROP TABLE%');
    IF @txt IS NULL SET @txt = N''; ELSE SET @txt = N' these procedures delete or edit history: ' + @txt + N';';
    IF @txt = N'' PRINT 'OK  S13 no request procedure deletes rows, truncates or edits the event history (appended events only)';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL S13' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL S13 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- E2 the rollback left nothing behind --------------------------------------------------------------------- */
IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    SELECT @n = COUNT(*) FROM app.principal_identity WHERE user_email LIKE N't3.%@example.test';
    SELECT @n2 = COUNT(*) FROM app.change_request WHERE requested_by LIKE N't3.%@example.test' OR requested_by = N'system:rule-run';
    SELECT @n3 = COUNT(*) FROM app.notification WHERE recipient_email LIKE N't3.%@example.test';
    IF @n <> 0 OR @n2 <> 0 OR @n3 <> 0 SET @txt += N' left behind: ' + CAST(@n AS nvarchar(10)) + N' people, ' + CAST(@n2 AS nvarchar(10)) + N' requests, ' + CAST(@n3 AS nvarchar(10)) + N' notifications;';
    IF EXISTS (SELECT 1 FROM app.business_rules WHERE rule_id = N'T3_TEST_RULE') OR EXISTS (SELECT 1 FROM app.group_membership WHERE user_email LIKE N't3.%@example.test')
        SET @txt += N' the test rule or a test membership is still there;';
    IF EXISTS (SELECT 1 FROM dev.stub_equipment WHERE manufacturer = N'T3 CHANGED') SET @txt += N' the edited stub row was not rolled back;';
    IF EXISTS (SELECT 1 FROM app.app_setting WHERE setting_key = N'SAME_PERSON_BOTH_STAGES' AND setting_value <> N'0') SET @txt += N' the setting SAME_PERSON_BOTH_STAGES was not restored;';
    IF @txt = N'' PRINT 'OK  E2 the test rolled back completely: no test people, requests, notifications, rule, memberships, edited stub rows or changed setting remain';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL E2' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL E2 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

IF @fails = 0
    PRINT 't_request_lifecycle RESULT: ALL ' + CAST(@checks AS varchar(12)) + ' CHECKS PASS';
ELSE
    PRINT 't_request_lifecycle RESULT: ' + CAST(@fails AS varchar(12)) + ' OF ' + CAST(@checks AS varchar(12)) + ' CHECK(S) FAILED';
