/* =====================================================================
   t_request_approval_rules.sql   APP-4 change test: the approval rules the client set on 18 Nov 2026
                                  (answers Q-479 and Q-465; FINAL PLAN/08, 18 Nov)
   Objects: app.fn_stage_eligibility, app.fn_return_candidates, app.fn_return_rights, app.fn_request_checks,
            app.fn_request_actions, app.usp_request_decide, _resubmit, _cancel, _queue, _detail.
   Needs : the APP-3 and APP-4 bundles including app4_0_approval_rules, and the SYNTHETIC gold stub. Skipped, with
           an INFO line, when the data engineer's real gold has replaced the stub.
   Needs no local seed: it makes its own people (addresses ending @example.test) and requests INSIDE ONE
   TRANSACTION THAT IS ROLLED BACK AT THE END (the last check proves it). Counts that depend on what is already in
   the database are compared as differences to a baseline.
   Final line: `t_request_approval_rules RESULT: ...`

   Scenarios
     R1  an admin who is in neither group: the screen says "may decide, as ADMIN", the admin's two pending tabs list
         the request, the check passes "as an admin", the admin approves both stages, the events record ADMIN and
         same person
     R2  who a request may be returned to: the submitter, members of both groups, yourself; not an outsider, not an
         unregistered or inactive person; the detail's picker (result set 8) is empty for someone who may not decide
     R3  returned to a member of the accountable group: that person is told, sees it in "Returned to me", may resubmit
         but not withdraw; the submitter may withdraw but not resubmit; "raised by" never changes; the history says
         who it went to and who resubmitted
     R4  refused recipients (outsider, unregistered, a made-up group) write nothing; returning it to yourself works,
         sends you no notification and puts it in your own "Returned to me"
     R5  an orphaned return (the recipient left both groups): the submitter, a responsible-group member and an admin
         may pick it up (and see it in "Returned to me"); an outsider may not
     R6  withdraw: an admin may withdraw anybody's open request; an outsider may not
     R7  the rollback left nothing behind
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL t_request_approval_rules wrong editor: connected to "' + DB_NAME() + '". Open the item named ATLAS_SQL_DB whose type is SQL database. Nothing was run.';
    RETURN;
END
IF OBJECT_ID(N'app.fn_return_candidates', N'IF') IS NULL OR OBJECT_ID(N'app.fn_return_rights', N'IF') IS NULL
   OR OBJECT_ID(N'app.fn_request_actions', N'IF') IS NULL OR OBJECT_ID(N'app.usp_request_detail', N'P') IS NULL
   OR OBJECT_ID(N'app.usp_request_queue', N'P') IS NULL OR OBJECT_ID(N'app.usp_request_decide', N'P') IS NULL
BEGIN
    PRINT 'FAIL t_request_approval_rules an object is missing: run the bundles app4_0_approval_rules and app4_1_read_objects first. Nothing was run.';
    RETURN;
END
IF OBJECT_ID(N'gold.vw_equipment_current', N'V') IS NULL
BEGIN
    PRINT 'FAIL t_request_approval_rules the gold views are missing: run the gold stub (or the real gold) first. Nothing was run.';
    RETURN;
END
IF OBJECT_DEFINITION(OBJECT_ID(N'gold.vw_equipment_current')) NOT LIKE N'%ATLAS-STUB%'
BEGIN
    PRINT 'INFO t_request_approval_rules skipped: gold.vw_equipment_current is not the synthetic stub (the data engineer''s real view?). The scenarios use the stub''s values.';
    RETURN;
END

DECLARE @checks int = 0, @fails int = 0;
DECLARE @txt nvarchar(2000), @errno int, @n int, @n2 int, @n3 int;
DECLARE @id bigint, @ns nvarchar(24), @nm bit, @eid int, @cur nvarchar(400);
DECLARE @b1 bigint, @b2 bigint, @b3 bigint, @b4 bigint, @b5 bigint, @b6 bigint;
DECLARE @pc nvarchar(40) = N'OP RES DB NM';
DECLARE @rg nvarchar(64), @ag nvarchar(64), @class nvarchar(30);

/* ---- six synthetic filler heaters of one profit centre, with no open request ---------------------------------- */
DECLARE @h TABLE (n int NOT NULL PRIMARY KEY, equipment_id int NOT NULL, mfr nvarchar(30) NULL, equip_class nvarchar(30) NULL);
INSERT INTO @h (n, equipment_id, mfr, equip_class)
SELECT ROW_NUMBER() OVER (ORDER BY e.equipment_id), e.equipment_id, e.manufacturer, e.equip_class
FROM (SELECT TOP (6) x.*
      FROM gold.vw_equipment_current AS x
      WHERE x.profit_center_name = @pc AND x.equipment_number LIKE N'SYN-EQ-1%'
        AND NOT EXISTS (SELECT 1 FROM app.change_request AS r
                        WHERE r.equipment_id = x.equipment_id
                          AND r.request_status <> N'APPROVED' AND r.request_status <> N'REJECTED' AND r.request_status <> N'CANCELLED')
      ORDER BY x.equipment_id) AS e;
SELECT @n = COUNT(*) FROM @h;
IF @n < 6
BEGIN
    PRINT 'FAIL t_request_approval_rules setup: found ' + CAST(@n AS varchar(10)) + ' synthetic heaters without an open request in ' + @pc + ' (need 6). Reject or withdraw the open requests on them.';
    RETURN;
END

DECLARE @route TABLE (route_id int NULL, route_used nvarchar(12) NULL, responsible_role nvarchar(64) NULL,
                      responsible_group nvarchar(64) NULL, accountable_role nvarchar(64) NULL, accountable_group nvarchar(64) NULL);
SELECT @class = equip_class FROM @h WHERE n = 1;
INSERT INTO @route EXEC app.usp_route_resolve @entity_type = N'EQUIPMENT', @request_action = N'UPDATE', @profit_center_name = @pc, @field_code = N'MANUFACTURER', @class_code = @class;
SELECT @rg = responsible_group, @ag = accountable_group FROM @route;
IF @rg IS NULL OR @ag IS NULL OR @rg = N'UNROUTED' OR @ag = N'UNROUTED' OR @rg = @ag
BEGIN
    PRINT 'FAIL t_request_approval_rules setup: the route for ' + @pc + ' does not give two different groups (got ' + ISNULL(@rg, N'NULL') + ', ' + ISNULL(@ag, N'NULL') + '). Run seeds 0103 to 0105.';
    RETURN;
END

/* ---- people and memberships, all rolled back at the end ------------------------------------------------------- */
DECLARE @u_req nvarchar(256) = N't5.requester@example.test', @u_resp nvarchar(256) = N't5.responsible@example.test',
        @u_acc nvarchar(256) = N't5.accountable@example.test', @u_none nvarchar(256) = N't5.nobody@example.test',
        @u_admin nvarchar(256) = N't5.admin@example.test', @u_gone nvarchar(256) = N't5.inactive@example.test',
        @u_unreg nvarchar(256) = N't5.unregistered@example.test';
DECLARE @setup_ok bit = 0;
BEGIN TRANSACTION;
BEGIN TRY
    INSERT INTO app.principal_identity (external_id, user_email, display_name, is_active, bound_by) VALUES
        (N'00000000-0000-4000-8000-0000000005a1', @u_req,   N'T5 requester',   1, N'test:t_request_approval_rules'),
        (N'00000000-0000-4000-8000-0000000005a2', @u_resp,  N'T5 responsible', 1, N'test:t_request_approval_rules'),
        (N'00000000-0000-4000-8000-0000000005a3', @u_acc,   N'T5 accountable', 1, N'test:t_request_approval_rules'),
        (N'00000000-0000-4000-8000-0000000005a4', @u_none,  N'T5 nobody',      1, N'test:t_request_approval_rules'),
        (N'00000000-0000-4000-8000-0000000005a5', @u_admin, N'T5 admin',       1, N'test:t_request_approval_rules'),
        (N'00000000-0000-4000-8000-0000000005a6', @u_gone,  N'T5 inactive',    0, N'test:t_request_approval_rules');
    INSERT INTO app.group_membership (group_key, user_email, is_active, added_by) VALUES
        (@rg, @u_resp, 1, N'test:t_request_approval_rules'),
        (@ag, @u_acc,  1, N'test:t_request_approval_rules'),
        (@rg, @u_gone, 1, N'test:t_request_approval_rules');
    INSERT INTO app.principal_role_assignment (principal_type, principal_key, principal_display_name, role_name, scope_type, scope_value, is_active)
    VALUES (N'USER', @u_admin, N'T5 admin', N'Admin', N'ALL_ORCM', NULL, 1);
    SET @setup_ok = 1;
END TRY
BEGIN CATCH
    PRINT 'FAIL t_request_approval_rules setup error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;
IF @setup_ok = 0
BEGIN
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    RETURN;
END

/* ---- tables that catch the result sets ----------------------------------------------------------------------- */
DECLARE @q1 TABLE (responsible_count int, accountable_count int, returned_count int, approved_count int, rejected_count int, mine_count int);
DECLARE @v TABLE (can_decide bit, decide_blocked_reason nvarchar(400), can_approve bit, approve_blocked_reason nvarchar(400),
    can_resubmit bit, can_cancel bit, return_to_type nvarchar(40), return_to nvarchar(300), return_to_label nvarchar(300), stage nvarchar(40),
    decided_as nvarchar(40));
DECLARE @cand TABLE (user_email nvarchar(300), display_name nvarchar(300), relation nvarchar(40), is_you bit);
DECLARE @ev TABLE (ord int IDENTITY(1,1) NOT NULL, event_id bigint, event_type nvarchar(40), approval_stage nvarchar(40), actor nvarchar(300), actor_group nvarchar(80),
    occurred_at_utc datetime2(3), comments nvarchar(1000), status_from nvarchar(40), status_to nvarchar(40),
    decided_as nvarchar(40), same_person_both_stages bit, returned_to nvarchar(300));
DECLARE @chk TABLE (request_id bigint, request_status nvarchar(24), check_order int, check_code nvarchar(40), check_status nvarchar(12), message nvarchar(400), checked_at_utc datetime2(3));
DECLARE @base_resp int, @base_acc int, @base_ret int;

/* ---- the six requests, all raised by the requester ------------------------------------------------------------ */
BEGIN TRY
    SELECT @eid = equipment_id, @cur = mfr FROM @h WHERE n = 1;
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T5 MFR 1',
        @reason = N'T5 rules', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT;
    SET @b1 = @id;
    SELECT @eid = equipment_id, @cur = mfr FROM @h WHERE n = 2;
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T5 MFR 2',
        @reason = N'T5 rules', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT;
    SET @b2 = @id;
    SELECT @eid = equipment_id, @cur = mfr FROM @h WHERE n = 3;
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T5 MFR 3',
        @reason = N'T5 rules', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT;
    SET @b3 = @id;
    SELECT @eid = equipment_id, @cur = mfr FROM @h WHERE n = 4;
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T5 MFR 4',
        @reason = N'T5 rules', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT;
    SET @b4 = @id;
    SELECT @eid = equipment_id, @cur = mfr FROM @h WHERE n = 5;
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T5 MFR 5',
        @reason = N'T5 rules', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT;
    SET @b5 = @id;
    SELECT @eid = equipment_id, @cur = mfr FROM @h WHERE n = 6;
    EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = N'T5 MFR 6',
        @reason = N'T5 rules', @requested_by = @u_req, @equipment_id = @eid, @old_value = @cur, @emit_result = 0, @o_request_id = @id OUTPUT;
    SET @b6 = @id;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL setup the six requests could not be created, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    PRINT 't_request_approval_rules RESULT: setup failed, nothing else was run';
    RETURN;
END CATCH;

/* ---- R1 an admin who is in neither group -------------------------------------------------------------------- */
BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    DELETE FROM @v; INSERT INTO @v EXEC app.usp_request_detail @request_id = @b1, @actor_email = @u_admin, @only_set = 7;
    SELECT @n = COUNT(*) FROM @v WHERE can_decide = 1 AND can_approve = 1 AND decided_as = N'ADMIN' AND stage = N'RESPONSIBLE';
    IF @n <> 1 SET @txt += N' the screen should let the admin decide stage 1 as ADMIN;';
    -- both pending tabs of an admin list every waiting request: b1 to b6 are six more at the responsible stage
    DELETE FROM @q1; INSERT INTO @q1 EXEC app.usp_request_queue @actor_email = @u_admin, @tab = N'RESPONSIBLE', @only_set = 1;
    SELECT @base_resp = responsible_count, @base_acc = accountable_count FROM @q1;
    SELECT @n = COUNT(*) FROM app.change_request WHERE request_status = N'PENDING_RESPONSIBLE';
    IF @base_resp <> @n SET @txt += N' the admin''s responsible tab counts ' + CAST(@base_resp AS nvarchar(10)) + N' of ' + CAST(@n AS nvarchar(10)) + N' waiting requests;';
    DELETE FROM @chk; INSERT INTO @chk EXEC app.usp_request_checks @request_id = @b1, @actor_email = @u_admin;
    SELECT @n = COUNT(*) FROM @chk WHERE check_code = N'USER_ELIGIBLE_FOR_STAGE' AND check_status = N'PASS' AND message LIKE N'%as an admin%';
    IF @n <> 1 SET @txt += N' the eligibility check should pass "as an admin";';
    EXEC app.usp_request_decide @request_id = @b1, @actor_email = @u_admin, @decision = N'APPROVE', @emit_result = 0, @o_new_status = @ns OUTPUT;
    IF @ns <> N'PENDING_ACCOUNTABLE' SET @txt += N' the admin''s first approval gave ' + ISNULL(@ns, N'NULL') + N';';
    DELETE FROM @q1; INSERT INTO @q1 EXEC app.usp_request_queue @actor_email = @u_admin, @tab = N'ACCOUNTABLE', @only_set = 1;
    SELECT @n = accountable_count FROM @q1;
    IF @n <> @base_acc + 1 SET @txt += N' the admin''s accountable tab did not gain the request;';
    EXEC app.usp_request_decide @request_id = @b1, @actor_email = @u_admin, @decision = N'APPROVE', @emit_result = 0, @o_new_status = @ns OUTPUT, @o_needs_merge = @nm OUTPUT;
    IF @ns <> N'APPROVED' OR @nm <> 1 SET @txt += N' the admin''s second approval gave ' + ISNULL(@ns, N'NULL') + N';';
    DELETE FROM @ev; INSERT INTO @ev (event_id, event_type, approval_stage, actor, actor_group, occurred_at_utc, comments, status_from, status_to, decided_as, same_person_both_stages, returned_to)
        EXEC app.usp_request_detail @request_id = @b1, @actor_email = @u_admin, @only_set = 2;
    SELECT @n = COUNT(*) FROM @ev WHERE event_type = N'RESPONSIBLE_APPROVED' AND actor = @u_admin AND decided_as = N'ADMIN' AND same_person_both_stages = 0 AND actor_group = @rg;
    SELECT @n2 = COUNT(*) FROM @ev WHERE event_type = N'ACCOUNTABLE_APPROVED' AND actor = @u_admin AND decided_as = N'ADMIN' AND same_person_both_stages = 1 AND actor_group = @ag;
    IF @n <> 1 OR @n2 <> 1 SET @txt += N' the history does not show both approvals as ADMIN, the second as the same person;';
    -- an ordinary person outside the groups is still refused
    SET @errno = NULL;
    BEGIN TRY EXEC app.usp_request_decide @request_id = @b2, @actor_email = @u_none, @decision = N'APPROVE', @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    IF @errno IS NULL OR @errno <> 50141 SET @txt += N' an outsider gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N' (expected 50141);';
    IF @txt = N'' PRINT 'OK  R1 an admin in neither group: allowed as ADMIN on screen and in the check, sees every waiting request, approves both stages, the history says ADMIN and same person; an outsider is still refused';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL R1' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL R1 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- R2 who a request may be returned to ------------------------------------------------------------------------ */
BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    DELETE FROM @cand; INSERT INTO @cand EXEC app.usp_request_detail @request_id = @b2, @actor_email = @u_resp, @only_set = 8;
    IF NOT EXISTS (SELECT 1 FROM @cand WHERE user_email = @u_req AND relation = N'SUBMITTER' AND display_name = N'T5 requester' AND is_you = 0)
        SET @txt += N' the submitter is not offered;';
    IF NOT EXISTS (SELECT 1 FROM @cand WHERE user_email = @u_resp AND relation = N'RESPONSIBLE_GROUP' AND is_you = 1)
        SET @txt += N' the person returning it (a responsible member) is not offered as themselves;';
    IF NOT EXISTS (SELECT 1 FROM @cand WHERE user_email = @u_acc AND relation = N'ACCOUNTABLE_GROUP')
        SET @txt += N' the accountable member is not offered;';
    IF EXISTS (SELECT 1 FROM @cand WHERE user_email IN (@u_none, @u_gone, @u_unreg, @u_admin))
        SET @txt += N' an outsider, an inactive, an unregistered person or an uninvolved admin is offered;';
    SELECT @n = COUNT(*), @n2 = COUNT(DISTINCT user_email) FROM @cand;
    IF @n <> @n2 SET @txt += N' a person is offered twice;';
    -- an admin who returns it is offered as "you" though in neither group
    DELETE FROM @cand; INSERT INTO @cand EXEC app.usp_request_detail @request_id = @b2, @actor_email = @u_admin, @only_set = 8;
    IF NOT EXISTS (SELECT 1 FROM @cand WHERE user_email = @u_admin AND relation = N'YOU' AND is_you = 1)
        SET @txt += N' the admin is not offered as themselves;';
    -- somebody who may not decide gets no picker at all
    DELETE FROM @cand; INSERT INTO @cand EXEC app.usp_request_detail @request_id = @b2, @actor_email = @u_none, @only_set = 8;
    SELECT @n = COUNT(*) FROM @cand;
    IF @n <> 0 SET @txt += N' an outsider is offered ' + CAST(@n AS nvarchar(10)) + N' recipients;';
    IF @txt = N'' PRINT 'OK  R2 the Return picker offers the submitter, both groups'' members and yourself (an admin too), once each; never an outsider, an inactive or unregistered person; nothing to someone who may not decide';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL R2' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL R2 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- R3 returned to a member of the accountable group -------------------------------------------------------- */
BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    DELETE FROM @q1; INSERT INTO @q1 EXEC app.usp_request_queue @actor_email = @u_acc, @tab = N'RETURNED', @only_set = 1;
    SELECT @base_ret = returned_count FROM @q1;
    EXEC app.usp_request_decide @request_id = @b2, @actor_email = @u_resp, @decision = N'RETURN', @comment = N'T5 please check the nameplate',
        @return_recipient = @u_acc, @emit_result = 0, @o_new_status = @ns OUTPUT;
    IF @ns <> N'RETURNED' SET @txt += N' the return gave ' + ISNULL(@ns, N'NULL') + N';';
    IF NOT EXISTS (SELECT 1 FROM app.change_request WHERE request_id = @b2 AND return_recipient_type = N'USER' AND return_recipient = @u_acc AND requested_by = @u_req)
        SET @txt += N' the request does not name the accountable member as recipient (or raised-by changed);';
    IF NOT EXISTS (SELECT 1 FROM app.notification WHERE request_id = @b2 AND topic = N'REQUEST_RETURNED' AND recipient_email = @u_acc AND body LIKE N'%nameplate%')
        SET @txt += N' the recipient was not told;';
    DELETE FROM @q1; INSERT INTO @q1 EXEC app.usp_request_queue @actor_email = @u_acc, @tab = N'RETURNED', @only_set = 1;
    SELECT @n = returned_count FROM @q1;
    IF @n <> @base_ret + 1 SET @txt += N' it is not in the recipient''s Returned tab;';
    DELETE FROM @v; INSERT INTO @v EXEC app.usp_request_detail @request_id = @b2, @actor_email = @u_acc, @only_set = 7;
    SELECT @n = COUNT(*) FROM @v WHERE can_resubmit = 1 AND can_cancel = 0 AND return_to = @u_acc;
    IF @n <> 1 SET @txt += N' the recipient should be able to resubmit but not withdraw;';
    DELETE FROM @v; INSERT INTO @v EXEC app.usp_request_detail @request_id = @b2, @actor_email = @u_req, @only_set = 7;
    SELECT @n = COUNT(*) FROM @v WHERE can_resubmit = 0 AND can_cancel = 1;
    IF @n <> 1 SET @txt += N' the submitter should be able to withdraw but not resubmit;';
    SET @errno = NULL;
    BEGIN TRY EXEC app.usp_request_cancel @request_id = @b2, @actor_email = @u_acc, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    IF @errno IS NULL OR @errno <> 50173 SET @txt += N' the recipient''s withdrawal gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N' (expected 50173);';
    SET @errno = NULL;
    BEGIN TRY EXEC app.usp_request_resubmit @request_id = @b2, @actor_email = @u_req, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    IF @errno IS NULL OR @errno <> 50163 SET @txt += N' the submitter''s resubmission gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N' (expected 50163);';
    EXEC app.usp_request_resubmit @request_id = @b2, @actor_email = @u_acc, @new_value = N'T5 MFR 2B', @comment = N'T5 fixed', @emit_result = 0, @o_new_status = @ns OUTPUT;
    IF @ns <> N'PENDING_RESPONSIBLE' SET @txt += N' the recipient''s resubmission gave ' + ISNULL(@ns, N'NULL') + N';';
    IF NOT EXISTS (SELECT 1 FROM app.change_request WHERE request_id = @b2 AND requested_by = @u_req AND new_value = N'T5 MFR 2B')
        SET @txt += N' raised-by changed or the corrected value was not stored;';
    DELETE FROM @ev; INSERT INTO @ev (event_id, event_type, approval_stage, actor, actor_group, occurred_at_utc, comments, status_from, status_to, decided_as, same_person_both_stages, returned_to)
        EXEC app.usp_request_detail @request_id = @b2, @actor_email = @u_req, @only_set = 2;
    SELECT @n = COUNT(*) FROM @ev WHERE event_type = N'RETURNED' AND actor = @u_resp AND returned_to = @u_acc AND decided_as = N'GROUP_MEMBER';
    SELECT @n2 = COUNT(*) FROM @ev WHERE event_type = N'RESUBMITTED' AND actor = @u_acc;
    IF @n <> 1 OR @n2 <> 1 SET @txt += N' the history does not say who it was returned to and who resubmitted;';
    IF @txt = N'' PRINT 'OK  R3 returned to an accountable member: told, in their Returned tab, may resubmit not withdraw; the submitter may withdraw not resubmit; raised-by unchanged; the history names both';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL R3' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL R3 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- R4 refused recipients; returning it to yourself ---------------------------------------------------------- */
BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    SET @n = 0;
    BEGIN TRY EXEC app.usp_request_decide @request_id = @b3, @actor_email = @u_resp, @decision = N'RETURN', @comment = N'x', @return_recipient = @u_none, @emit_result = 0; END TRY
    BEGIN CATCH IF ERROR_NUMBER() = 50137 SET @n += 1; END CATCH;
    BEGIN TRY EXEC app.usp_request_decide @request_id = @b3, @actor_email = @u_resp, @decision = N'RETURN', @comment = N'x', @return_recipient = @u_unreg, @emit_result = 0; END TRY
    BEGIN CATCH IF ERROR_NUMBER() = 50137 SET @n += 1; END CATCH;
    BEGIN TRY EXEC app.usp_request_decide @request_id = @b3, @actor_email = @u_resp, @decision = N'RETURN', @comment = N'x', @return_recipient = @u_gone, @emit_result = 0; END TRY
    BEGIN CATCH IF ERROR_NUMBER() = 50137 SET @n += 1; END CATCH;
    BEGIN TRY EXEC app.usp_request_decide @request_id = @b3, @actor_email = @u_resp, @decision = N'RETURN', @comment = N'x', @return_recipient_type = N'GROUP', @return_recipient = @ag, @emit_result = 0; END TRY
    BEGIN CATCH IF ERROR_NUMBER() = 50137 SET @n += 1; END CATCH;
    IF @n <> 4 SET @txt += N' only ' + CAST(@n AS nvarchar(10)) + N' of 4 wrong recipients were refused with 50137;';
    SELECT @n = COUNT(*) FROM app.change_request_event WHERE request_id = @b3;
    IF @n <> 1 SET @txt += N' a refused return wrote something;';
    -- to yourself
    DELETE FROM @q1; INSERT INTO @q1 EXEC app.usp_request_queue @actor_email = @u_resp, @tab = N'RETURNED', @only_set = 1;
    SELECT @base_ret = returned_count FROM @q1;
    EXEC app.usp_request_decide @request_id = @b3, @actor_email = @u_resp, @decision = N'RETURN', @comment = N'T5 I will fix it myself',
        @return_recipient = @u_resp, @emit_result = 0, @o_new_status = @ns OUTPUT;
    IF @ns <> N'RETURNED' OR NOT EXISTS (SELECT 1 FROM app.change_request WHERE request_id = @b3 AND return_recipient_type = N'USER' AND return_recipient = @u_resp)
        SET @txt += N' returning it to yourself gave ' + ISNULL(@ns, N'NULL') + N';';
    IF EXISTS (SELECT 1 FROM app.notification WHERE request_id = @b3 AND topic = N'REQUEST_RETURNED')
        SET @txt += N' a notification was queued for returning it to yourself;';
    DELETE FROM @q1; INSERT INTO @q1 EXEC app.usp_request_queue @actor_email = @u_resp, @tab = N'RETURNED', @only_set = 1;
    SELECT @n = returned_count FROM @q1;
    IF @n <> @base_ret + 1 SET @txt += N' it is not in your own Returned tab;';
    EXEC app.usp_request_resubmit @request_id = @b3, @actor_email = @u_resp, @emit_result = 0, @o_new_status = @ns OUTPUT;
    IF @ns <> N'PENDING_RESPONSIBLE' SET @txt += N' your own resubmission gave ' + ISNULL(@ns, N'NULL') + N';';
    IF @txt = N'' PRINT 'OK  R4 an outsider, an unregistered, an inactive person and a made-up group are refused (50137) with nothing written; returned to yourself: no notification, in your Returned tab, you may resubmit';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL R4' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL R4 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- R5 an orphaned return ---------------------------------------------------------------------------------- */
BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    EXEC app.usp_request_decide @request_id = @b4, @actor_email = @u_resp, @decision = N'RETURN', @comment = N'T5 over to accountable',
        @return_recipient = @u_acc, @emit_result = 0;
    SELECT @n = COUNT(*) FROM app.fn_return_rights(@b4, @u_req) WHERE is_orphaned = 0 AND can_resubmit = 0;
    IF @n <> 1 SET @txt += N' before the recipient left, the return should not be orphaned and the submitter may not pick it up;';
    DELETE FROM @q1; INSERT INTO @q1 EXEC app.usp_request_queue @actor_email = @u_req, @tab = N'RETURNED', @only_set = 1;
    SELECT @base_ret = returned_count FROM @q1;
    -- the recipient leaves the accountable group (switched off inside the test)
    UPDATE app.group_membership SET is_active = 0 WHERE group_key = @ag AND user_email = @u_acc;
    SELECT @n = COUNT(*) FROM app.fn_return_rights(@b4, @u_req) WHERE is_orphaned = 1 AND can_resubmit = 1;
    IF @n <> 1 SET @txt += N' after the recipient left, the submitter should be able to pick it up;';
    DELETE FROM @q1; INSERT INTO @q1 EXEC app.usp_request_queue @actor_email = @u_req, @tab = N'RETURNED', @only_set = 1;
    SELECT @n = returned_count FROM @q1;
    IF @n <> @base_ret + 1 SET @txt += N' the orphaned return is not in the submitter''s Returned tab;';
    SELECT @n = COUNT(*) FROM app.fn_return_rights(@b4, @u_admin) WHERE can_resubmit = 1;
    SELECT @n2 = COUNT(*) FROM app.fn_return_rights(@b4, @u_resp) WHERE can_resubmit = 1;
    SELECT @n3 = COUNT(*) FROM app.fn_return_rights(@b4, @u_none) WHERE can_resubmit = 0;
    IF @n <> 1 OR @n2 <> 1 OR @n3 <> 1 SET @txt += N' admin / responsible member / outsider rights on the orphaned return are wrong (' + CAST(@n AS nvarchar(5)) + N'/' + CAST(@n2 AS nvarchar(5)) + N'/' + CAST(@n3 AS nvarchar(5)) + N');';
    SET @errno = NULL;
    BEGIN TRY EXEC app.usp_request_resubmit @request_id = @b4, @actor_email = @u_none, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    IF @errno IS NULL OR @errno <> 50163 SET @txt += N' an outsider''s pick-up gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N' (expected 50163);';
    EXEC app.usp_request_resubmit @request_id = @b4, @actor_email = @u_resp, @comment = N'T5 picked up', @emit_result = 0, @o_new_status = @ns OUTPUT;
    IF @ns <> N'PENDING_RESPONSIBLE' SET @txt += N' the responsible member''s pick-up gave ' + ISNULL(@ns, N'NULL') + N';';
    UPDATE app.group_membership SET is_active = 1 WHERE group_key = @ag AND user_email = @u_acc;
    IF @txt = N'' PRINT 'OK  R5 an orphaned return (the recipient left the group): the submitter sees it and may pick it up, so may a responsible member and an admin; an outsider is refused (50163)';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL R5' + @txt; END
END TRY
BEGIN CATCH
    UPDATE app.group_membership SET is_active = 1 WHERE group_key = @ag AND user_email = @u_acc;
    SET @fails += 1;
    PRINT 'FAIL R5 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- R6 withdraw ----------------------------------------------------------------------------------------------- */
BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    DELETE FROM @v; INSERT INTO @v EXEC app.usp_request_detail @request_id = @b5, @actor_email = @u_admin, @only_set = 7;
    SELECT @n = COUNT(*) FROM @v WHERE can_cancel = 1;
    DELETE FROM @v; INSERT INTO @v EXEC app.usp_request_detail @request_id = @b5, @actor_email = @u_none, @only_set = 7;
    SELECT @n2 = COUNT(*) FROM @v WHERE can_cancel = 0;
    IF @n <> 1 OR @n2 <> 1 SET @txt += N' the withdraw flags are wrong (admin ' + CAST(@n AS nvarchar(5)) + N', outsider ' + CAST(@n2 AS nvarchar(5)) + N');';
    SET @errno = NULL;
    BEGIN TRY EXEC app.usp_request_cancel @request_id = @b5, @actor_email = @u_none, @emit_result = 0; END TRY BEGIN CATCH SET @errno = ERROR_NUMBER(); END CATCH;
    IF @errno IS NULL OR @errno <> 50173 SET @txt += N' an outsider''s withdrawal gave error ' + ISNULL(CAST(@errno AS nvarchar(12)), N'none') + N' (expected 50173);';
    EXEC app.usp_request_cancel @request_id = @b5, @actor_email = @u_admin, @comment = N'T5 admin clean-up', @emit_result = 0, @o_new_status = @ns OUTPUT;
    IF @ns <> N'CANCELLED' SET @txt += N' the admin''s withdrawal gave ' + ISNULL(@ns, N'NULL') + N';';
    -- b6 stays pending for nothing: withdrawn by its requester to leave the table tidy inside the transaction
    EXEC app.usp_request_cancel @request_id = @b6, @actor_email = @u_req, @emit_result = 0;
    IF @txt = N'' PRINT 'OK  R6 an admin may withdraw somebody else''s open request (and the screen says so); an outsider may not (50173)';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL R6' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL R6 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- R7 the rollback left nothing behind ------------------------------------------------------------------------- */
IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
BEGIN TRY
    SET @checks += 1; SET @txt = N'';
    SELECT @n = COUNT(*) FROM app.principal_identity WHERE user_email LIKE N't5.%@example.test';
    SELECT @n2 = COUNT(*) FROM app.change_request WHERE requested_by LIKE N't5.%@example.test';
    SELECT @n3 = COUNT(*) FROM app.notification WHERE recipient_email LIKE N't5.%@example.test';
    IF @n <> 0 OR @n2 <> 0 OR @n3 <> 0 SET @txt += N' left behind: ' + CAST(@n AS nvarchar(10)) + N' people, ' + CAST(@n2 AS nvarchar(10)) + N' requests, ' + CAST(@n3 AS nvarchar(10)) + N' notifications;';
    IF EXISTS (SELECT 1 FROM app.group_membership WHERE user_email LIKE N't5.%@example.test')
       OR EXISTS (SELECT 1 FROM app.principal_role_assignment WHERE principal_key LIKE N't5.%@example.test')
        SET @txt += N' a test membership or role assignment is still there;';
    IF @txt = N'' PRINT 'OK  R7 the test rolled back completely: no test people, requests, notifications, memberships or role assignments remain';
    ELSE BEGIN SET @fails += 1; PRINT 'FAIL R7' + @txt; END
END TRY
BEGIN CATCH
    SET @fails += 1;
    PRINT 'FAIL R7 error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ' on line ' + CAST(ERROR_LINE() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

IF @fails = 0
    PRINT 't_request_approval_rules RESULT: ALL ' + CAST(@checks AS varchar(12)) + ' CHECKS PASS';
ELSE
    PRINT 't_request_approval_rules RESULT: ' + CAST(@fails AS varchar(12)) + ' OF ' + CAST(@checks AS varchar(12)) + ' CHECK(S) FAILED';
