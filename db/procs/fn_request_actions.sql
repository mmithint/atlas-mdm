/* =====================================================================
   app.fn_request_actions       APP-4 helper (used by app.usp_request_queue and app.usp_request_detail,
                                so the screens' buttons and the procedures' refusals agree)
   Single statement per file; CREATE OR ALTER, safe to run again.
   Needs: app.fn_stage_eligibility, app.fn_return_rights, app.fn_requester_rights. Reads only.
   Tests: db/tests/t_request_reads.sql (scenario Q5 checks that every flag below matches what usp_request_decide,
   _resubmit and _cancel really do) and db/tests/t_request_approval_rules.sql (the 18 Nov rules).

   What may this person do with this request, and why not? The screens (S-2 checkboxes, S-3 buttons) show
   these answers; the procedures still enforce every rule themselves, so a wrong answer here could mislead a
   person but never let anything through.

   Input : @request_id, @actor_email (the signed-in person; blank or system:... gives "no" to everything).
   Output: one row per existing request (none for an unknown id):

     stage                   RESPONSIBLE or ACCOUNTABLE while the request waits for a decision, else NULL
     can_decide              the request waits for a decision AND the person is eligible for the stage: an active
                             member of the routed group holding the stage's flag with a scope that covers the
                             profit centre, or an admin (app.fn_stage_eligibility). Approve, Reject, Return.
     decide_blocked_reason   why not (the words of app.usp_request_decide's refusals), NULL when allowed
     can_approve             the same as can_decide since 18 Nov 2026 (the client allowed one person to approve both
                             stages, Q-479). Kept as its own column so the screens and the queue's bulk tick box keep
                             one name for "may approve"; the failed-check block is shown by the screen from the checks.
     approve_blocked_reason  the decide reason
     decided_as              GROUP_MEMBER or ADMIN when can_decide (how the person qualifies), else NULL
     can_resubmit            app.fn_return_rights: RETURNED and the person is the recipient, or the return is
                             orphaned and the person is the submitter, a responsible-group member or an admin
     can_cancel              open, and the person raised it, or is an admin, or (RETURNED to a GROUP, a system
                             request) is a member of that group (app.usp_request_cancel)
     return_to_type/return_to  where a RETURN goes when the person picks nobody (the default), or, once RETURNED,
                             who it went to: the submitter for a field or manual request, the rule's resolution
                             group for a rule request, the responsible group for a request the system raised; NULL
                             on a closed request. The people the person MAY pick are app.fn_return_candidates
                             (usp_request_detail result set 8).
   ===================================================================== */
CREATE OR ALTER FUNCTION app.fn_request_actions
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
        st.stage,
        CAST(CASE WHEN z.decide_reason IS NULL THEN 1 ELSE 0 END AS bit)                         AS can_decide,
        CAST(z.decide_reason AS nvarchar(400))                                                   AS decide_blocked_reason,
        CAST(CASE WHEN z.decide_reason IS NULL THEN 1 ELSE 0 END AS bit)                         AS can_approve,
        CAST(z.decide_reason AS nvarchar(400))                                                   AS approve_blocked_reason,
        CAST(CASE WHEN z.decide_reason IS NOT NULL THEN NULL
                  WHEN el.is_group_member = 1 AND el.has_flag_in_scope = 1 THEN N'GROUP_MEMBER'
                  ELSE N'ADMIN' END AS nvarchar(12))                                             AS decided_as,
        CAST(ISNULL(rr.can_resubmit, 0) AS bit)                                                  AS can_resubmit,
        CAST(CASE WHEN ac.is_person = 1
                   AND r.request_status <> N'APPROVED' AND r.request_status <> N'REJECTED' AND r.request_status <> N'CANCELLED'
                   AND (   LOWER(r.requested_by) = ac.a
                        OR ISNULL(me.can_manage_admin, 0) = 1
                        OR (r.request_status = N'RETURNED' AND r.return_recipient_type = N'GROUP'
                            AND EXISTS (SELECT 1 FROM app.group_membership AS m2
                                        WHERE m2.group_key = r.return_recipient AND m2.is_active = 1 AND m2.user_email = ac.a)))
                  THEN 1 ELSE 0 END AS bit)                                                      AS can_cancel,
        CAST(rt.rtype AS nvarchar(10))                                                           AS return_to_type,
        CAST(rt.rrec  AS nvarchar(256))                                                          AS return_to
    FROM app.change_request AS r
    CROSS APPLY (SELECT CASE r.request_status WHEN N'PENDING_RESPONSIBLE' THEN N'RESPONSIBLE'
                                              WHEN N'PENDING_ACCOUNTABLE' THEN N'ACCOUNTABLE'
                                              ELSE NULL END AS stage) AS st
    CROSS APPLY (SELECT LOWER(LTRIM(RTRIM(@actor_email))) AS a) AS a0
    CROSS APPLY (SELECT a0.a AS a,
                        CASE WHEN a0.a IS NOT NULL AND CHARINDEX(N'@', a0.a) > 1 AND LEFT(a0.a, 7) <> N'system:' THEN 1 ELSE 0 END AS is_person,
                        CASE st.stage WHEN N'RESPONSIBLE' THEN r.responsible_group
                                      WHEN N'ACCOUNTABLE' THEN r.accountable_group
                                      ELSE NULL END AS grp) AS ac
    OUTER APPLY app.fn_stage_eligibility(ac.a, st.stage, ac.grp, r.profit_center_name) AS el
    OUTER APPLY app.fn_requester_rights(ac.a) AS me
    OUTER APPLY app.fn_return_rights(r.request_id, ac.a) AS rr
    CROSS APPLY (SELECT CASE
                     WHEN ac.is_person = 0
                         THEN N'Sign in as a person to decide.'
                     WHEN st.stage IS NULL
                         THEN N'The request is ' + r.request_status + N'; only a request that waits for a decision can be decided.'
                     WHEN el.is_eligible = 1
                         THEN NULL
                     WHEN el.is_group_member = 0
                         THEN N'You are not an active member of the group for this stage (' + ISNULL(ac.grp, N'none') + N').'
                     ELSE N'No role of yours allows the ' + st.stage + N' stage for ' + ISNULL(r.profit_center_name, N'this profit centre') + N'.'
                     END AS decide_reason) AS z
    OUTER APPLY (SELECT TOP (1) b.resolution_group AS grp
                 FROM app.business_rules AS b
                 WHERE b.rule_id = r.source_rule_id AND b.rule_version = r.source_rule_version) AS br
    CROSS APPLY (SELECT CASE WHEN r.request_status = N'RETURNED'         THEN r.return_recipient_type
                             WHEN st.stage IS NULL                       THEN NULL
                             WHEN r.source_type = N'BUSINESS_RULE'       THEN N'GROUP'
                             WHEN LEFT(r.requested_by, 7) <> N'system:'  THEN N'USER'
                             ELSE N'GROUP' END AS rtype,
                        CASE WHEN r.request_status = N'RETURNED'         THEN r.return_recipient
                             WHEN st.stage IS NULL                       THEN NULL
                             WHEN r.source_type = N'BUSINESS_RULE'       THEN ISNULL(br.grp, r.responsible_group)
                             WHEN LEFT(r.requested_by, 7) <> N'system:'  THEN r.requested_by
                             ELSE r.responsible_group END AS rrec) AS rt
    WHERE r.request_id = @request_id
);
