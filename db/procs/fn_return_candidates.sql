/* =====================================================================
   app.fn_return_candidates     APP-4 change (client, 18 Nov 2026; answers Q-465)
                                (used by app.usp_request_decide to check a RETURN, app.fn_return_rights and
                                app.usp_request_detail for the Return dialog's picker, so the list lives in ONE place)
   Single statement per file; CREATE OR ALTER, safe to run again.
   Needs: app.principal_identity, app.group_membership, app.security_group. Reads only.
   Test: db/tests/t_request_approval_rules.sql

   Who may a request be returned to "for correction"? The client: "anyone, including themselves". Agreed
   reading (18 Nov): the people who have something to do with the request:
     SUBMITTER          the person who raised it (not for a request raised by system:...)
     RESPONSIBLE_GROUP  an active member of the group the first stage is routed to
     ACCOUNTABLE_GROUP  an active member of the group the second stage is routed to
     YOU                @actor_email itself (the person returning it), whatever else is true
   Everyone except YOU must be a REGISTERED person (an active row in app.principal_identity), so a request is
   never returned to an address nobody signs in with. The groups must be active.

   Input : @request_id, @actor_email (NULL = list without "you": used to ask "is this person still a valid
           holder of a returned request?", app.fn_return_rights)
   Output: one row per person (a person who fits several reasons appears once, with the first reason in the
           order above, YOU last unless YOU is the only reason):
     user_email, display_name, relation (SUBMITTER, RESPONSIBLE_GROUP, ACCOUNTABLE_GROUP or YOU), sort_order,
     is_you (1 = this row is @actor_email, whatever its relation)
   An unknown request gives no rows.
   ===================================================================== */
CREATE OR ALTER FUNCTION app.fn_return_candidates
(
    @request_id  bigint,
    @actor_email nvarchar(256)
)
RETURNS TABLE
AS
RETURN
(
    SELECT
        CAST(c.user_email AS nvarchar(256)) AS user_email,
        CAST(ISNULL(pi.display_name, c.user_email) AS nvarchar(256)) AS display_name,
        CAST(CASE MIN(c.prio) WHEN 1 THEN N'SUBMITTER' WHEN 2 THEN N'RESPONSIBLE_GROUP'
                              WHEN 3 THEN N'ACCOUNTABLE_GROUP' ELSE N'YOU' END AS nvarchar(20)) AS relation,
        CAST(MIN(c.prio) AS int) AS sort_order,
        CAST(CASE WHEN c.user_email = LOWER(LTRIM(RTRIM(@actor_email))) THEN 1 ELSE 0 END AS bit) AS is_you
    FROM
    (
        SELECT LOWER(r.requested_by) AS user_email, 1 AS prio
        FROM app.change_request AS r
        WHERE r.request_id = @request_id
          AND LEFT(r.requested_by, 7) <> N'system:'
          AND EXISTS (SELECT 1 FROM app.principal_identity AS i WHERE i.user_email = LOWER(r.requested_by) AND i.is_active = 1)
        UNION ALL
        SELECT LOWER(m.user_email), CASE WHEN m.group_key = r.responsible_group THEN 2 ELSE 3 END
        FROM app.change_request AS r
        JOIN app.group_membership AS m ON m.is_active = 1 AND (m.group_key = r.responsible_group OR m.group_key = r.accountable_group)
        JOIN app.security_group AS sg ON sg.group_key = m.group_key AND sg.is_active = 1
        WHERE r.request_id = @request_id
          AND EXISTS (SELECT 1 FROM app.principal_identity AS i WHERE i.user_email = LOWER(m.user_email) AND i.is_active = 1)
        UNION ALL
        SELECT LOWER(LTRIM(RTRIM(@actor_email))), 9
        FROM app.change_request AS r
        WHERE r.request_id = @request_id
          AND @actor_email IS NOT NULL
          AND CHARINDEX(N'@', @actor_email) > 1
          AND LEFT(LTRIM(@actor_email), 7) <> N'system:'
    ) AS c
    OUTER APPLY (SELECT TOP (1) p.display_name FROM app.principal_identity AS p
                 WHERE p.user_email = c.user_email AND p.is_active = 1) AS pi
    GROUP BY c.user_email, pi.display_name
);
