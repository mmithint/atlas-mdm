/* =====================================================================
   app.usp_request_create       APP-3; contract FINAL PLAN/01 section 6.3 ("the only door into the
                                workflow"); FINAL PLAN/03 APP-3 step 1; tests: db/tests/t_request_lifecycle.sql
   Single statement per file; CREATE OR ALTER, safe to run again.
   Needs: the gold views (stub or the data engineer's), app.usp_route_resolve, app.fn_value_check,
   app.fn_requester_rights, app.usp_notification_enqueue, setting ADMIN_ONLY_FIELDS (seed 0109).

   Every source (field user, desktop user, rule run, data-engineer import) creates a request here.

   What it does, in order (a refusal is a THROW, nothing is written):
     1  checks who and what: source type and requester agree (a person for FIELD / MANUAL; system:...
        for BUSINESS_RULE / CORRECTION_IMPORT); a person must be registered and may submit requests;
        a rule request names its rule and version
     2  checks the field: in the catalogue, active, editable, belongs to the entity type; the four
        admin-only classification fields (setting ADMIN_ONLY_FIELDS) need can_manage_admin from a person
     3  finds the target in gold: the heater (EQUIPMENT) or the functional location (FLOC), and copies
        the facts the routing and the approval checks need (profit centre, class, FLOC, golden version)
     4  checks the value: it differs from the old one, and app.fn_value_check accepts it (length,
        number format, allowed list, a new FLOC must exist, D-18)
     5  suppresses or blocks (no error, an outcome):
          DUPLICATE_SUPPRESSED  an open request with the same de-duplication key exists; for a RULE source
                                also when the latest request with that key was REJECTED or CANCELLED
                                (REF-52 [L0187]: "after rejection/cancellation unless explicitly
                                resubmitted"; a person raising it again counts as explicit)
          BLOCKED_INCOMPATIBLE  another open request proposes a different value for the same field of the
                                same heater (or FLOC)
        Both return the OTHER request's id and reference.
     6  routes it (app.usp_route_resolve: field > class > wildcard); a rule's own responsible /
        accountable group, when set, overrides the route's groups
     7  in ONE transaction: inserts the request as PENDING_RESPONSIBLE, writes the CREATED event with the
        evidence snapshot (+ golden version and baseline watermark), queues the notification to the
        responsible group. A concurrent twin (unique index) is reported as DUPLICATE_SUPPRESSED.

   De-duplication key: SHA-256 (upper-case hex, char(64)) over rule id (empty for non-rule sources),
   entity type, entity key (equipment number, or the FLOC), field code, old value, new value, joined by
   character 31. Run id and rule version are left out on purpose, so a new rule version does not
   duplicate an open request (01 section 6.3, 09 section 4.1).

   Class used for routing: the heater's equip_class (EQUIPMENT) or the FLOC's floc_class (FLOC).

   Results: ONE row (request_id, request_ref, outcome, responsible_group, accountable_group) when
   @emit_result = 1 (the default), and always the five @o_ OUTPUT parameters. A caller that creates many
   requests in a loop (the rule engine) passes @emit_result = 0. Do not call this procedure from
   INSERT ... EXEC: it uses INSERT ... EXEC itself (SQL Server does not allow nesting); read the OUTPUT
   parameters instead.

   Refusal numbers (THROW): 50101 unknown source, 50102 source not available here, 50103 unknown entity
   type, 50104 requester missing or not an e-mail, 50105 source and requester do not agree, 50106 a rule
   request without its rule, 50107 not registered or may not submit, 50108 unknown rule version,
   50110 unknown field, 50111 field inactive or not editable, 50112 field belongs to another entity type,
   50113 field is admin-only, 50114 no heater / location named, 50115 not found in gold, 50116 no profit
   centre, 50120 new value equals the old, 50121 value not acceptable, 50122 evidence is not JSON,
   50123 no reason.
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_request_create
    @source_type         nvarchar(20),
    @entity_type         nvarchar(10),
    @field_code          nvarchar(64),
    @new_value           nvarchar(400),
    @reason              nvarchar(400),
    @requested_by        nvarchar(256),
    @equipment_id        int            = NULL,
    @functional_location nvarchar(40)   = NULL,
    @old_value           nvarchar(400)  = NULL,
    @note                nvarchar(200)  = NULL,
    @source_rule_id      nvarchar(64)   = NULL,
    @source_rule_version int            = NULL,
    @source_result_id    bigint         = NULL,
    @comment             nvarchar(1000) = NULL,
    @evidence_json       nvarchar(4000) = NULL,
    @emit_result         bit            = 1,
    @o_request_id        bigint         = NULL OUTPUT,
    @o_request_ref       nvarchar(12)   = NULL OUTPUT,
    @o_outcome           nvarchar(24)   = NULL OUTPUT,
    @o_responsible_group nvarchar(64)   = NULL OUTPUT,
    @o_accountable_group nvarchar(64)   = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @msg nvarchar(2048);
    DECLARE @by nvarchar(256) = LOWER(LTRIM(RTRIM(@requested_by)));
    DECLARE @is_system bit = CASE WHEN LEFT(@by, 7) = N'system:' THEN 1 ELSE 0 END;
    DECLARE @newv nvarchar(400) = LTRIM(RTRIM(@new_value));
    DECLARE @oldv nvarchar(400) = NULLIF(LTRIM(RTRIM(@old_value)), N'');
    DECLARE @floc_in nvarchar(40) = NULLIF(LTRIM(RTRIM(@functional_location)), N'');
    DECLARE @why nvarchar(400) = LTRIM(RTRIM(@reason));

    /* ---- 1 who and what ---------------------------------------------------------- */
    IF @source_type IS NULL OR @source_type NOT IN (N'BUSINESS_RULE', N'FIELD', N'MANUAL', N'CORRECTION_IMPORT', N'NEW_CHARACTERISTIC', N'NEW_RECORD')
        THROW 50101, N'Unknown request source.', 1;
    IF @source_type IN (N'NEW_CHARACTERISTIC', N'NEW_RECORD')
        THROW 50102, N'This source is not created through usp_request_create (a new field request has its own procedure, APP-9).', 1;
    IF @entity_type IS NULL OR @entity_type NOT IN (N'EQUIPMENT', N'FLOC')
        THROW 50103, N'The entity type must be EQUIPMENT or FLOC.', 1;
    IF @by IS NULL OR @by = N'' OR (@is_system = 0 AND CHARINDEX(N'@', @by) < 2)
        THROW 50104, N'The requester must be a person''s e-mail address or a system:... name.', 1;
    IF (@source_type IN (N'BUSINESS_RULE', N'CORRECTION_IMPORT') AND @is_system = 0)
       OR (@source_type IN (N'FIELD', N'MANUAL') AND @is_system = 1)
        THROW 50105, N'The requester does not fit the source: a person raises FIELD and MANUAL requests; the rule run and the data engineer''s import (system:...) raise BUSINESS_RULE and CORRECTION_IMPORT requests.', 1;
    IF @source_type = N'BUSINESS_RULE' AND (@source_rule_id IS NULL OR @source_rule_version IS NULL)
        THROW 50106, N'A rule request must name its rule and rule version.', 1;
    IF @source_type = N'BUSINESS_RULE'
       AND NOT EXISTS (SELECT 1 FROM app.business_rules AS br WHERE br.rule_id = @source_rule_id AND br.rule_version = @source_rule_version)
        THROW 50108, N'Unknown rule version.', 1;
    IF @source_type <> N'BUSINESS_RULE' AND (@source_rule_id IS NOT NULL OR @source_rule_version IS NOT NULL)
        THROW 50106, N'Only a rule request may name a rule.', 1;

    DECLARE @reg bit = 1, @can_submit bit = 1, @is_admin bit = 1;
    IF @is_system = 0
    BEGIN
        SELECT @reg = u.is_registered, @can_submit = u.can_submit_requests, @is_admin = u.can_manage_admin
        FROM app.fn_requester_rights(@by) AS u;
        IF @reg = 0 OR @can_submit = 0
            THROW 50107, N'This person is not registered, or may not submit requests.', 1;
    END

    IF @why IS NULL OR @why = N''
        THROW 50123, N'A reason is required.', 1;
    IF @evidence_json IS NOT NULL AND ISJSON(@evidence_json) = 0
        THROW 50122, N'The evidence must be valid JSON.', 1;

    /* ---- 2 the field -------------------------------------------------------------- */
    DECLARE @f_entity nvarchar(10), @f_editable bit, @f_active bit, @f_type nvarchar(10), @f_label nvarchar(100);
    SELECT @f_entity = c.entity_type, @f_editable = c.is_editable, @f_active = c.is_active, @f_type = c.data_type, @f_label = c.label
    FROM app.field_catalog AS c
    WHERE c.field_code = @field_code;
    IF @f_entity IS NULL
        THROW 50110, N'That field is not in the catalogue.', 1;
    IF @f_active = 0 OR @f_editable = 0
        THROW 50111, N'That field is switched off or cannot be changed by a request.', 1;
    IF @f_entity <> @entity_type
        THROW 50112, N'That field belongs to the other entity type (heater or location).', 1;

    DECLARE @admin_only nvarchar(400) = ISNULL((SELECT s.setting_value FROM app.app_setting AS s WHERE s.setting_key = N'ADMIN_ONLY_FIELDS'), N'');
    IF @is_system = 0 AND @is_admin = 0
       AND EXISTS (SELECT 1 FROM STRING_SPLIT(@admin_only, N',') AS a WHERE LTRIM(RTRIM(a.value)) = @field_code)
        THROW 50113, N'Only an admin may ask to change this field by hand (a rule or the data engineer''s import may propose it).', 1;

    /* ---- 3 the target in gold ----------------------------------------------------- */
    DECLARE @eqnum nvarchar(18), @floc nvarchar(40), @pc nvarchar(40), @class nvarchar(30);
    DECLARE @golden int, @baseline datetime2(3), @entity_key nvarchar(40);
    IF @entity_type = N'EQUIPMENT'
    BEGIN
        IF @equipment_id IS NULL
            THROW 50114, N'Name the heater (equipment_id).', 1;
        SELECT @eqnum = e.equipment_number, @floc = e.functional_location, @pc = e.profit_center_name,
               @class = e.equip_class, @golden = e.golden_version_id, @baseline = e.baseline_as_of_utc
        FROM gold.vw_equipment_current AS e
        WHERE e.equipment_id = @equipment_id;
        IF @@ROWCOUNT = 0
            THROW 50115, N'That heater is not in gold.', 1;
        SET @entity_key = @eqnum;
    END
    ELSE
    BEGIN
        IF @floc_in IS NULL
            THROW 50114, N'Name the functional location.', 1;
        SELECT @floc = f.functional_location, @pc = f.profit_center_name, @class = f.floc_class, @golden = f.golden_version_id
        FROM gold.vw_floc_current AS f
        WHERE f.functional_location = @floc_in;
        IF @@ROWCOUNT = 0
            THROW 50115, N'That functional location is not in gold.', 1;
        SET @equipment_id = NULL;
        SET @entity_key = @floc;
    END
    IF @pc IS NULL OR @pc = N''
        THROW 50116, N'The heater or location has no profit centre, so the request cannot be routed.', 1;

    /* ---- 4 the value --------------------------------------------------------------- */
    DECLARE @same bit = 0;
    IF @f_type = N'DECIMAL' AND TRY_CONVERT(decimal(18,4), @newv) IS NOT NULL AND TRY_CONVERT(decimal(18,4), @oldv) IS NOT NULL
        SET @same = CASE WHEN TRY_CONVERT(decimal(18,4), @newv) = TRY_CONVERT(decimal(18,4), @oldv) THEN 1 ELSE 0 END;
    ELSE
        SET @same = CASE WHEN ISNULL(@oldv, N'') COLLATE Latin1_General_BIN2 = ISNULL(@newv, N'') COLLATE Latin1_General_BIN2 THEN 1 ELSE 0 END;

    DECLARE @problem nvarchar(400) = (SELECT v.problem FROM app.fn_value_check(@field_code, @newv) AS v);
    IF @problem IS NOT NULL
    BEGIN
        SET @msg = N'The new value is not acceptable: ' + @problem + N'.';
        THROW 50121, @msg, 1;
    END
    IF @same = 1
        THROW 50120, N'The new value is the same as the old value.', 1;

    /* ---- 5 duplicates and conflicts ------------------------------------------------- */
    DECLARE @key char(64) = CONVERT(char(64), HASHBYTES('SHA2_256',
        CONCAT(ISNULL(@source_rule_id, N''), NCHAR(31), @entity_type, NCHAR(31), @entity_key, NCHAR(31),
               @field_code, NCHAR(31), ISNULL(@oldv, N''), NCHAR(31), @newv)), 2);

    DECLARE @outcome nvarchar(24) = NULL, @id bigint = NULL, @ref nvarchar(12) = NULL;
    DECLARE @rg nvarchar(64), @ag nvarchar(64), @route_id int, @route_used nvarchar(12);

    SELECT TOP (1) @id = d.request_id, @ref = d.request_ref, @rg = d.responsible_group, @ag = d.accountable_group, @outcome = N'DUPLICATE_SUPPRESSED'
    FROM app.change_request AS d
    WHERE d.deduplication_key = @key
      AND d.request_status <> N'APPROVED' AND d.request_status <> N'REJECTED' AND d.request_status <> N'CANCELLED'
    ORDER BY d.request_id;

    IF @outcome IS NULL AND @source_type = N'BUSINESS_RULE'
        SELECT TOP (1) @id = d.request_id, @ref = d.request_ref, @rg = d.responsible_group, @ag = d.accountable_group, @outcome = N'DUPLICATE_SUPPRESSED'
        FROM app.change_request AS d
        WHERE d.deduplication_key = @key
          AND d.request_id = (SELECT MAX(l.request_id) FROM app.change_request AS l WHERE l.deduplication_key = @key)
          AND (d.request_status = N'REJECTED' OR d.request_status = N'CANCELLED');

    IF @outcome IS NULL
        SELECT TOP (1) @id = o.request_id, @ref = o.request_ref, @rg = o.responsible_group, @ag = o.accountable_group, @outcome = N'BLOCKED_INCOMPATIBLE'
        FROM app.change_request AS o
        WHERE o.field_code = @field_code
          AND o.request_status <> N'APPROVED' AND o.request_status <> N'REJECTED' AND o.request_status <> N'CANCELLED'
          AND (   (@entity_type = N'EQUIPMENT' AND o.equipment_id = @equipment_id)
               OR (@entity_type = N'FLOC' AND o.entity_type = N'FLOC' AND o.functional_location = @floc))
        ORDER BY o.request_id;

    /* ---- 6 and 7 route and write ----------------------------------------------------- */
    IF @outcome IS NULL
    BEGIN
        DECLARE @route TABLE
        (
            route_id int NULL, route_used nvarchar(12) NULL, responsible_role nvarchar(64) NULL,
            responsible_group nvarchar(64) NULL, accountable_role nvarchar(64) NULL, accountable_group nvarchar(64) NULL
        );
        INSERT INTO @route (route_id, route_used, responsible_role, responsible_group, accountable_role, accountable_group)
        EXEC app.usp_route_resolve @entity_type = @entity_type, @request_action = N'UPDATE', @profit_center_name = @pc,
                                   @field_code = @field_code, @class_code = @class;
        SELECT TOP (1) @route_id = r.route_id, @route_used = r.route_used, @rg = ISNULL(r.responsible_group, N'UNROUTED'), @ag = ISNULL(r.accountable_group, N'UNROUTED')
        FROM @route AS r;
        SET @rg = ISNULL(@rg, N'UNROUTED');
        SET @ag = ISNULL(@ag, N'UNROUTED');

        IF @source_type = N'BUSINESS_RULE'
            SELECT @rg = ISNULL(br.responsible_group, @rg), @ag = ISNULL(br.accountable_group, @ag)
            FROM app.business_rules AS br
            WHERE br.rule_id = @source_rule_id AND br.rule_version = @source_rule_version;

        DECLARE @details nvarchar(max) =
            (SELECT N'CREATED' AS [event], @source_type AS source_type, @entity_type AS entity_type, @entity_key AS entity_key,
                    @route_used AS route_used, @golden AS golden_version_id, @baseline AS baseline_as_of_utc,
                    JSON_QUERY(@evidence_json) AS evidence
             FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);

        DECLARE @own bit = CASE WHEN @@TRANCOUNT = 0 THEN 1 ELSE 0 END;
        DECLARE @errno int;
        BEGIN TRY
            IF @own = 1 BEGIN TRANSACTION;

            INSERT INTO app.change_request
                (entity_type, equipment_id, equipment_number, functional_location, profit_center_name, class_code, request_action,
                 source_type, source_result_id, source_rule_id, source_rule_version, field_code, old_value, new_value, reason, note,
                 requested_by, request_status, responsible_group, accountable_group, route_id, deduplication_key)
            VALUES
                (@entity_type, @equipment_id, @eqnum, @floc, @pc, @class, N'UPDATE',
                 @source_type, @source_result_id, @source_rule_id, @source_rule_version, @field_code, @oldv, @newv, @why, @note,
                 @by, N'PENDING_RESPONSIBLE', @rg, @ag, @route_id, @key);
            SET @id = SCOPE_IDENTITY();
            SET @ref = (SELECT c.request_ref FROM app.change_request AS c WHERE c.request_id = @id);

            INSERT INTO app.change_request_event
                (request_id, event_type, approval_stage, actor, actor_group, comments, status_from, status_to, event_details_json)
            VALUES
                (@id, N'CREATED', NULL, @by, NULL, @comment, NULL, N'PENDING_RESPONSIBLE', @details);

            DECLARE @title nvarchar(200) = N'Request ' + @ref + N' needs your approval';
            DECLARE @body nvarchar(1000) = LEFT(@ref + N': ' + @f_label + N' of ' + ISNULL(@entity_key, N'') + N' from "' + ISNULL(@oldv, N'(blank)')
                                                + N'" to "' + @newv + N'". Reason: ' + @why, 1000);
            EXEC app.usp_notification_enqueue @topic = N'REQUEST_PENDING_RESPONSIBLE', @request_id = @id, @event_key = N'CREATED',
                                              @title = @title, @body = @body, @recipient_group = @rg;

            IF @own = 1 COMMIT TRANSACTION;
            SET @outcome = N'CREATED';
        END TRY
        BEGIN CATCH
            SET @errno = ERROR_NUMBER();
            IF @own = 1 AND @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
            IF @errno IN (2601, 2627)
            BEGIN
                -- a concurrent twin got in first: report it as the duplicate it is
                SET @id = NULL;
                SELECT TOP (1) @id = d.request_id, @ref = d.request_ref, @rg = d.responsible_group, @ag = d.accountable_group
                FROM app.change_request AS d
                WHERE d.deduplication_key = @key
                  AND d.request_status <> N'APPROVED' AND d.request_status <> N'REJECTED' AND d.request_status <> N'CANCELLED'
                ORDER BY d.request_id;
                IF @id IS NULL THROW;
                SET @outcome = N'DUPLICATE_SUPPRESSED';
            END
            ELSE
                THROW;
        END CATCH;
    END

    SET @o_request_id = @id;
    SET @o_request_ref = @ref;
    SET @o_outcome = @outcome;
    SET @o_responsible_group = @rg;
    SET @o_accountable_group = @ag;

    IF @emit_result = 1
        SELECT @id AS request_id, @ref AS request_ref, @outcome AS outcome, @rg AS responsible_group, @ag AS accountable_group;
END
