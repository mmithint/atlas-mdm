/* =====================================================================
   app.usp_route_resolve        APP-1; FINAL PLAN/03 APP-1 step 5, 09 section 3.7
   Single statement per file; CREATE OR ALTER, safe to run again.

   Who approves a change? Input: entity type, action, profit centre, and optionally
   the field and the class of the heater / FLOC. Output: ONE row
     route_id, route_used, responsible_role, responsible_group,
     accountable_role, accountable_group

   Which route: among the active routes that match the entity, the action, the field
   (the route's field is '*' or equals @field_code) and the class (the route covers any
   class, or lists @class_code), the most specific wins:
     FIELD+CLASS (rank 3) > FIELD (rank 2) > CLASS (rank 1) > WILDCARD (rank 0);
   equal rank: the lowest route_id. [INFERRED from REF-46:L0210-L0223 and the meeting
   statement quoted in POC-APP-03.]

   Which group: the route names ROLES (an alias such as "Operations-IOC - NMD" is
   resolved through app.role_alias); the group is chosen by app.fn_group_for_role
   (explicit profit-centre list beats ALL_ORCM). No route or no group: 'UNROUTED',
   which admins see on S-13.

   Reads only; changes nothing. Never raises on unknown input: it answers NONE / UNROUTED.
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_route_resolve
    @entity_type        nvarchar(10),
    @request_action     nvarchar(10),
    @profit_center_name nvarchar(40),
    @field_code         nvarchar(64) = NULL,
    @class_code         nvarchar(30) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @route_id int, @route_used nvarchar(12), @resp_raw nvarchar(64), @acc_raw nvarchar(64);

    SELECT TOP (1)
        @route_id   = r.route_id,
        @resp_raw   = r.responsible_role,
        @acc_raw    = r.accountable_role,
        @route_used = CASE WHEN r.field_or_characteristic <> N'*' AND r.class_scope = N'LIST' THEN N'FIELD+CLASS'
                           WHEN r.field_or_characteristic <> N'*' THEN N'FIELD'
                           WHEN r.class_scope = N'LIST' THEN N'CLASS'
                           ELSE N'WILDCARD' END
    FROM app.approval_route AS r
    WHERE r.is_active = 1
      AND r.entity_type = @entity_type
      AND r.request_action = @request_action
      AND (r.field_or_characteristic = N'*' OR r.field_or_characteristic = @field_code)
      AND (r.class_scope = N'ANY'
           OR EXISTS (SELECT 1 FROM app.approval_route_class AS c WHERE c.route_id = r.route_id AND c.class_code = @class_code))
    ORDER BY (CASE WHEN r.field_or_characteristic <> N'*' THEN 2 ELSE 0 END
              + CASE WHEN r.class_scope = N'LIST' THEN 1 ELSE 0 END) DESC,
             r.route_id;

    DECLARE @resp_role nvarchar(64), @resp_group nvarchar(64), @acc_role nvarchar(64), @acc_group nvarchar(64);

    IF @route_id IS NOT NULL
    BEGIN
        SELECT @resp_role = g.role_name, @resp_group = g.group_key
        FROM app.fn_group_for_role(@resp_raw, @profit_center_name) AS g;

        SELECT @acc_role = g.role_name, @acc_group = g.group_key
        FROM app.fn_group_for_role(@acc_raw, @profit_center_name) AS g;
    END

    SELECT
        @route_id                                   AS route_id,
        ISNULL(@route_used, N'NONE')                AS route_used,
        @resp_role                                  AS responsible_role,
        ISNULL(@resp_group, N'UNROUTED')            AS responsible_group,
        @acc_role                                   AS accountable_role,
        ISNULL(@acc_group, N'UNROUTED')             AS accountable_group;
END
