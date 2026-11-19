/* =====================================================================
   app4_make_test_requests.sql   APP-4 helper (you run it in the SQL editor, RB-02): makes test requests so the
                                 bulk approve of 10 can be tried without filling in the dialog ten times.
   Not part of any bundle and not a test: it WRITES requests (they stay), on SYNTHETIC heaters only
   (equipment numbers SYN-EQ-...). Safe to run again: it picks heaters that have no open request.

   BEFORE YOU RUN IT: type your own registered e-mail in the line marked <-- on the first DECLARE below, in the
   editor window only. Never save your address into this file (it is in the repository).

   What it does: goes through the synthetic heaters one by one; for each it asks the routing which group would
   approve the first stage, and keeps the heater only if YOU are eligible for that stage (member of the group and
   holding the stage's right for the profit centre: app.fn_stage_eligibility), so every request it makes can be
   bulk-approved by you. It then raises a MANUFACTURER change for it as you, through app.usp_request_create, with
   the reason "APP-4 test". Your colleague needs the accountable stage for the second approval, as in APP-3 B6.

   Prints one line per request and a summary. Nothing here is a business rule: the procedure does all the checks.
   ===================================================================== */
SET NOCOUNT ON;

DECLARE @as_email nvarchar(256) = N'you@example.test';   -- <-- your registered e-mail (RB-11); do not save it into the repository
DECLARE @how_many int = 10;                              -- how many requests to make (1 to 50)

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL app4_make_test_requests wrong editor: connected to "' + DB_NAME() + '". Open the item named ATLAS_SQL_DB whose type is SQL database. Nothing was changed.';
    RETURN;
END
IF OBJECT_ID(N'app.usp_request_create', N'P') IS NULL OR OBJECT_ID(N'app.usp_route_resolve', N'P') IS NULL OR OBJECT_ID(N'app.fn_stage_eligibility', N'IF') IS NULL
BEGIN
    PRINT 'FAIL app4_make_test_requests the APP-3 request procedures are missing: run the APP-3 bundles first. Nothing was changed.';
    RETURN;
END
IF OBJECT_ID(N'gold.vw_equipment_current', N'V') IS NULL
   OR OBJECT_DEFINITION(OBJECT_ID(N'gold.vw_equipment_current')) NOT LIKE N'%ATLAS-STUB%'
BEGIN
    PRINT 'FAIL app4_make_test_requests the gold views are not the synthetic stub; this helper only makes test requests on synthetic heaters. Nothing was changed.';
    RETURN;
END
IF @how_many IS NULL OR @how_many < 1 OR @how_many > 50
BEGIN
    PRINT 'FAIL app4_make_test_requests @how_many must be from 1 to 50. Nothing was changed.';
    RETURN;
END

SET @as_email = LOWER(LTRIM(RTRIM(@as_email)));
DECLARE @registered bit = 0, @can_submit bit = 0;
SELECT @registered = rr.is_registered, @can_submit = rr.can_submit_requests FROM app.fn_requester_rights(@as_email) AS rr;
IF @registered = 0 OR @can_submit = 0
BEGIN
    PRINT 'FAIL app4_make_test_requests the address in the first DECLARE is not a registered person who may submit requests. Replace it with the one you were registered with (RB-11). Nothing was changed.';
    RETURN;
END

/* ---- candidate heaters: synthetic, no open request --------------------------------------- */
DECLARE @c TABLE (n int IDENTITY(1,1) NOT NULL PRIMARY KEY, equipment_id int NOT NULL, profit_center nvarchar(40) NULL,
                  equip_class nvarchar(30) NULL, mfr nvarchar(30) NULL);
INSERT INTO @c (equipment_id, profit_center, equip_class, mfr)
SELECT TOP (600) x.equipment_id, x.profit_center_name, x.equip_class, x.manufacturer
FROM gold.vw_equipment_current AS x
WHERE x.equipment_number LIKE N'SYN-EQ-%'
  AND NOT EXISTS (SELECT 1 FROM app.change_request AS r
                  WHERE r.equipment_id = x.equipment_id
                    AND r.request_status <> N'APPROVED' AND r.request_status <> N'REJECTED' AND r.request_status <> N'CANCELLED')
ORDER BY x.equipment_id;

DECLARE @elig TABLE (profit_center nvarchar(40) NOT NULL, equip_class nvarchar(30) NOT NULL, is_eligible bit NOT NULL, PRIMARY KEY (profit_center, equip_class));
DECLARE @route TABLE (route_id int NULL, route_used nvarchar(12) NULL, responsible_role nvarchar(64) NULL,
                      responsible_group nvarchar(64) NULL, accountable_role nvarchar(64) NULL, accountable_group nvarchar(64) NULL);

DECLARE @i int = 1, @total int = (SELECT COUNT(*) FROM @c), @made int = 0;
DECLARE @eid int, @pc nvarchar(40), @class nvarchar(30), @mfr nvarchar(30), @rg nvarchar(64), @ok bit;
DECLARE @id bigint, @ref nvarchar(12), @out nvarchar(24), @nv nvarchar(400), @line nvarchar(200);

WHILE @i <= @total AND @made < @how_many
BEGIN
    SELECT @eid = c.equipment_id, @pc = ISNULL(c.profit_center, N''), @class = ISNULL(c.equip_class, N''), @mfr = c.mfr FROM @c AS c WHERE c.n = @i;

    SET @ok = (SELECT e.is_eligible FROM @elig AS e WHERE e.profit_center = @pc AND e.equip_class = @class);
    IF @ok IS NULL
    BEGIN
        DELETE FROM @route;
        SET @rg = NULL;
        INSERT INTO @route EXEC app.usp_route_resolve @entity_type = N'EQUIPMENT', @request_action = N'UPDATE', @profit_center_name = @pc, @field_code = N'MANUFACTURER', @class_code = @class;
        SELECT @rg = r.responsible_group FROM @route AS r;
        SET @ok = 0;
        IF @rg IS NOT NULL AND @rg <> N'UNROUTED'
            SELECT @ok = el.is_eligible FROM app.fn_stage_eligibility(@as_email, N'RESPONSIBLE', @rg, @pc) AS el;
        INSERT INTO @elig (profit_center, equip_class, is_eligible) VALUES (@pc, @class, ISNULL(@ok, 0));
    END

    IF @ok = 1
    BEGIN
        SET @nv = N'APP4 TEST ' + CAST(@eid AS nvarchar(12));
        BEGIN TRY
            EXEC app.usp_request_create @source_type = N'MANUAL', @entity_type = N'EQUIPMENT', @field_code = N'MANUFACTURER', @new_value = @nv,
                @reason = N'APP-4 test', @requested_by = @as_email, @equipment_id = @eid, @old_value = @mfr, @emit_result = 0,
                @o_request_id = @id OUTPUT, @o_request_ref = @ref OUTPUT, @o_outcome = @out OUTPUT;
            SET @made += 1;
            SET @line = N'OK  ' + ISNULL(@ref, N'?') + N' ' + ISNULL(@out, N'?') + N' for heater id ' + CAST(@eid AS nvarchar(12)) + N' (' + @pc + N')';
            PRINT @line;
        END TRY
        BEGIN CATCH
            SET @line = N'FAIL heater id ' + CAST(@eid AS nvarchar(12)) + N', error ' + CAST(ERROR_NUMBER() AS nvarchar(12)) + N': ' + LEFT(ERROR_MESSAGE(), 150);
            PRINT @line;
            BREAK;
        END CATCH;
    END
    SET @i += 1;
END

IF @made = @how_many
    PRINT 'app4_make_test_requests RESULT: made ' + CAST(@made AS varchar(12)) + ' request(s) as you; open Approvals, tab My Responsible.';
ELSE
    PRINT 'app4_make_test_requests RESULT: made only ' + CAST(@made AS varchar(12)) + ' of ' + CAST(@how_many AS varchar(12)) + ' (not enough synthetic heaters in profit centres you are eligible for, or a failure above).';
