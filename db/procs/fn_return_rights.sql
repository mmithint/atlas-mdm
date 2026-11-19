/* =====================================================================
   app.fn_return_rights         APP-4 change (client, 18 Nov 2026; answers Q-465, edge case "the recipient left")
                                (used by app.usp_request_resubmit, app.fn_request_actions and app.usp_request_queue,
                                so the screens' Resubmit button, the "Returned to me" tab and the procedure agree)
   Single statement per file; CREATE OR ALTER, safe to run again.
   Needs: app.fn_return_candidates, app.fn_requester_rights. Reads only.
   Test: db/tests/t_request_approval_rules.sql

   Who may pick up (correct and resubmit) a RETURNED request?
     1. the recipient: the person it was returned to (USER), or an active member of the group (GROUP: a request
        the system raised, returned to the rule's resolution group or the responsible group)
     2. when the return is ORPHANED, also: the submitter, an active member of the responsible group, an admin.
        Orphaned means nobody valid holds it any more:
          USER   the recipient is no longer a valid recipient: not registered any more, or no longer the submitter,
                 a member of either routed group or an admin (app.fn_return_candidates without "you")
          GROUP  the group is inactive or has no active member left
   "Raised by" never changes; the picking up is visible in the history (the RESUBMITTED event names who did it).

   Input : @request_id, @actor_email.
   Output: one row per existing request (none for an unknown id):
     is_recipient   1 = rule 1
     is_orphaned    1 = the return is orphaned (only meaningful while RETURNED; 0 otherwise)
     can_resubmit   1 = the request is RETURNED, the actor is a person, and rule 1 or (orphaned and rule 2)
   ===================================================================== */
CREATE OR ALTER FUNCTION app.fn_return_rights
(
    @request_id  bigint,
    @actor_email nvarchar(256)
)
RETURNS TABLE
AS
RETURN
(
    SELECT
        r.request_id,
        CAST(x.is_recipient AS bit) AS is_recipient,
        CAST(x.is_orphaned  AS bit) AS is_orphaned,
        CAST(CASE WHEN r.request_status = N'RETURNED' AND a.is_person = 1
                   AND (x.is_recipient = 1 OR (x.is_orphaned = 1 AND x.is_fallback = 1)) THEN 1 ELSE 0 END AS bit) AS can_resubmit
    FROM app.change_request AS r
    CROSS APPLY (SELECT LOWER(LTRIM(RTRIM(@actor_email))) AS e) AS a0
    CROSS APPLY (SELECT a0.e,
                        CASE WHEN a0.e IS NOT NULL AND CHARINDEX(N'@', a0.e) > 1 AND LEFT(a0.e, 7) <> N'system:' THEN 1 ELSE 0 END AS is_person) AS a
    OUTER APPLY app.fn_requester_rights(a.e) AS me
    OUTER APPLY app.fn_requester_rights(CASE WHEN r.return_recipient_type = N'USER' THEN LOWER(r.return_recipient) END) AS rec
    CROSS APPLY
    (
        SELECT
            CASE WHEN a.is_person = 1
                  AND (   (r.return_recipient_type = N'USER' AND LOWER(r.return_recipient) = a.e)
                       OR (r.return_recipient_type = N'GROUP'
                           AND EXISTS (SELECT 1 FROM app.group_membership AS m
                                       JOIN app.security_group AS sg ON sg.group_key = m.group_key AND sg.is_active = 1
                                       WHERE m.group_key = r.return_recipient AND m.is_active = 1 AND m.user_email = a.e)))
                 THEN 1 ELSE 0 END AS is_recipient,
            CASE WHEN r.request_status <> N'RETURNED' THEN 0
                 WHEN r.return_recipient_type = N'USER'
                      AND ISNULL(rec.can_manage_admin, 0) = 0
                      AND NOT EXISTS (SELECT 1 FROM app.fn_return_candidates(r.request_id, NULL) AS c
                                      WHERE c.user_email = LOWER(r.return_recipient)) THEN 1
                 WHEN r.return_recipient_type = N'GROUP'
                      AND NOT EXISTS (SELECT 1 FROM app.group_membership AS m
                                      JOIN app.security_group AS sg ON sg.group_key = m.group_key AND sg.is_active = 1
                                      WHERE m.group_key = r.return_recipient AND m.is_active = 1) THEN 1
                 WHEN r.return_recipient_type IS NULL OR r.return_recipient IS NULL THEN 1
                 ELSE 0 END AS is_orphaned,
            CASE WHEN a.is_person = 0 THEN 0
                 WHEN LOWER(r.requested_by) = a.e THEN 1
                 WHEN ISNULL(me.can_manage_admin, 0) = 1 THEN 1
                 WHEN EXISTS (SELECT 1 FROM app.group_membership AS m
                              JOIN app.security_group AS sg ON sg.group_key = m.group_key AND sg.is_active = 1
                              WHERE m.group_key = r.responsible_group AND m.is_active = 1 AND m.user_email = a.e) THEN 1
                 ELSE 0 END AS is_fallback
    ) AS x
    WHERE r.request_id = @request_id
);
