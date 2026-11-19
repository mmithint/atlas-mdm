/**
 * Stand-ins for the Rayfin functions that exist, used ONLY by `npm run dev:mock` (see mock-client.ts).
 *
 * Why this exists: under `rayfin dev` the functions run on the developer's own Microsoft account, which Fabric
 * SQL refuses, so UI work had no data; and the client demo (FINAL PLAN/11, APP-D) runs on sample data from a
 * laptop. The handlers answer from the demo store (`demo-store.ts`) for the persona chosen in the header
 * (`personas.ts`), so approving, returning or withdrawing a request moves it between the Approvals tabs, adds to
 * its history and tells the next people, until Reset demo or a page reload.
 *
 * Functions that are not built yet answer from `preview-handlers.ts` instead.
 *
 * Nothing here is real, nothing here talks to a server, and none of it is part of a production build: the
 * only importers are dynamic imports behind `import.meta.env.DEV` checks.
 *
 * Every handler is typed against `AppFunctionsSchema`, so a change to a function's answer breaks this file at
 * compile time, the same way it breaks the screens.
 */
import type { AppFunctionsSchema as S } from '@rayfin-app/functions/types';

import { queueRow } from '../features/approvals/queue-fixtures';
import type { QueueRow } from '../features/approvals/queue-api';
import type { DetailRow } from '../features/approvals/request-api';
import { checkRows, detailRow, goldRow, relatedRow, routeRow, viewer } from '../features/approvals/request-fixtures';

import { ALLOWED_VALUES, CATALOG, fieldOf, fieldValueOf, labelOf, setFieldValue } from './catalog';
import {
  ACCOUNTABLE_GROUP,
  addEvent,
  demo,
  displayNameOf,
  eligibility,
  eventsOf,
  inboxOf,
  isOpen,
  isReadBy,
  me,
  membersOf,
  notify,
  nowIso,
  refOf,
  resetDemoAndPersona,
  responsibleGroupFor,
} from './demo-store';
import { currentPersona, profileOf } from './personas';

/** Shown by the mock sign-in until the profile answers; the header then shows the persona. */
export const MOCK_USER = 'alex.kim@example.test';
export const MOCK_USER_NAME = 'Alex Kim (sample)';

type Handlers = { [K in keyof S]?: (input: S[K]['input']) => S[K]['output'] };

const TIMING = { connectMs: 0, queryMs: 1, totalMs: 1 };
const ok = () => ({ ok: true, status: 'OK', error: null, errorCode: null, userId: `sample-${currentPersona().id}`, timing: TIMING }) as const;

/** A procedure's refusal, as the real functions report it inside the answer. */
function refused(error: string, errorCode: number): never {
  return { ...ok(), ok: false, status: 'REFUSED', error, errorCode } as never;
}

/** The field catalogue, as the read-only connector returns it (table `app.field_catalog`). */
export function catalogRows(): Record<string, unknown>[] {
  return CATALOG.map((c, i) => ({
    fieldCode: c.fieldCode,
    label: c.label,
    entityType: c.entityType,
    dataType: c.dataType,
    maxLength: c.maxLength,
    unit: c.unit,
    allowedValuesSource: c.allowedValuesSource,
    isKeyVerificationField: c.isKey,
    isEditable: true,
    displayGroup: c.displayGroup,
    displayOrder: i + 1,
    isMandatoryForSubmission: false,
    isActive: true,
  }));
}

/** Back to the starting data and the default persona (tests call it; the header's Reset demo keeps the persona). */
export function resetMock(): void {
  resetDemoAndPersona();
}

const findRequest = (id: number): QueueRow | undefined => demo().requests.find((x) => x.requestId === id);
const findHeater = (id: number | null) => demo().heaters.find((x) => x.equipmentId === id);

/** The six queue tabs, for the current persona (`app.fn_request_actions`, simplified). */
const TAB_TEST: Record<string, (r: QueueRow) => boolean> = {
  RESPONSIBLE: (r) => r.requestStatus === 'PENDING_RESPONSIBLE' && eligibility(r).ok,
  ACCOUNTABLE: (r) => r.requestStatus === 'PENDING_ACCOUNTABLE' && eligibility(r).ok,
  RETURNED: (r) => r.requestStatus === 'RETURNED' && r.returnRecipient === me(),
  APPROVED: (r) => r.requestStatus === 'APPROVED',
  REJECTED: (r) => r.requestStatus === 'REJECTED',
  MY_REQUESTS: (r) => r.requestedBy === me(),
};

function tally(rows: QueueRow[], kind: string, pick: (r: QueueRow) => [string, string] | null) {
  const counts = new Map<string, { label: string; n: number }>();
  for (const r of rows) {
    const p = pick(r);
    if (!p) continue;
    const e = counts.get(p[0]) ?? { label: p[1], n: 0 };
    e.n += 1;
    counts.set(p[0], e);
  }
  return [...counts].map(([value, e]) => ({ kind, value, label: e.label, n: e.n }));
}

const MERGED = { outcome: 'MERGED', message: 'Merged into the golden record (sample data).', goldenVersionId: 5, recorded: 'MERGED', error: null };

/**
 * Applies a decision the persona is allowed to make: status, history, notifications and, on final approval,
 * the heater's new value (the merge). Mirrors `app.usp_request_decide` in outline.
 */
function applyDecision(r: QueueRow, decision: string, comment: string, returnTo: string): { previous: string; stage: string | null } {
  const previous = r.requestStatus;
  const stage = r.approvalStage;
  const who = eligibility(r);
  const stageGroup = previous === 'PENDING_RESPONSIBLE' ? r.responsibleGroup : r.accountableGroup;
  const base = { approvalStage: stage, actor: me(), actorGroup: who.decidedAs === 'GROUP_MEMBER' ? stageGroup : null, decidedAs: who.decidedAs, statusFrom: previous, comments: comment || null };

  if (decision === 'APPROVE' && previous === 'PENDING_RESPONSIBLE') {
    r.requestStatus = 'PENDING_ACCOUNTABLE';
    r.approvalStage = 'ACCOUNTABLE';
    addEvent(r.requestId, { ...base, eventType: 'RESPONSIBLE_APPROVED', statusTo: r.requestStatus });
    notify(r, `group:${r.accountableGroup}`, 'REQUEST_PENDING_ACCOUNTABLE', 'A request is waiting for your final approval');
  } else if (decision === 'APPROVE') {
    const stage1 = eventsOf(r.requestId).filter((e) => e.eventType === 'RESPONSIBLE_APPROVED').at(-1);
    r.requestStatus = 'APPROVED';
    r.approvalStage = null;
    addEvent(r.requestId, { ...base, eventType: 'ACCOUNTABLE_APPROVED', statusTo: 'APPROVED', samePersonBothStages: stage1?.actor === me() });
    const h = findHeater(r.equipmentId);
    if (h && r.fieldCode) setFieldValue(h, r.fieldCode, r.newValue);
    addEvent(r.requestId, { eventType: 'MERGED', actor: 'system:merge', comments: 'The golden record was updated.', statusFrom: 'APPROVED', statusTo: 'APPROVED' });
    notify(r, r.requestedBy, 'REQUEST_APPROVED', 'Your request was approved');
  } else if (decision === 'REJECT') {
    r.requestStatus = 'REJECTED';
    r.approvalStage = null;
    addEvent(r.requestId, { ...base, eventType: 'REJECTED', statusTo: 'REJECTED' });
    notify(r, r.requestedBy, 'REQUEST_REJECTED', 'Your request was rejected');
  } else {
    r.requestStatus = 'RETURNED';
    r.approvalStage = null;
    r.returnRecipientType = 'USER';
    r.returnRecipient = returnTo || (r.requestedBy.startsWith('system:') ? me() : r.requestedBy);
    addEvent(r.requestId, { ...base, eventType: 'RETURNED', statusTo: 'RETURNED', returnedTo: r.returnRecipient });
    notify(r, r.returnRecipient, 'REQUEST_RETURNED', 'A request was returned to you');
  }
  r.canApprove = r.requestStatus.startsWith('PENDING');
  r.updatedAtUtc = nowIso();
  return { previous, stage };
}

/** Who the Return dialog offers (`app.fn_return_candidates`): the submitter, members of both groups, you. */
function returnCandidatesFor(r: QueueRow) {
  const seen = new Set<string>();
  const out: { email: string; displayName: string; relation: string; isYou: boolean }[] = [];
  const add = (email: string, relation: string) => {
    if (seen.has(email) || email.startsWith('system:')) return;
    seen.add(email);
    out.push({ email, displayName: displayNameOf(email), relation, isYou: email === me() });
  };
  add(r.requestedBy, 'SUBMITTER');
  for (const p of membersOf(r.responsibleGroup)) add(p.email, 'RESPONSIBLE_GROUP');
  for (const p of membersOf(r.accountableGroup)) add(p.email, 'ACCOUNTABLE_GROUP');
  add(me(), 'APPROVER');
  return out;
}

export const mockHandlers: Handlers = {
  getMyProfile: () => profileOf(currentPersona()),

  searchEquipment: (input) => {
    const text = (input.searchText ?? '').trim().toLowerCase();
    let rows = demo().heaters.filter((h) => !input.facility || h.profitCenterName === input.facility);
    if (input.mode === 'match' && text) {
      rows = rows.filter((h) =>
        [h.equipmentNumber, h.equipmentDescription, h.functionalLocation, h.equipmentTagNumber, h.manufacturer, h.modelNumber, h.manufacturerSerialNumber]
          .some((v) => (v ?? '').toLowerCase().includes(text))
      );
    }
    const key = input.sortColumn as keyof (typeof rows)[number];
    if (key && rows.length > 0 && key in rows[0]) {
      const dir = input.sortDirection === 'desc' ? -1 : 1;
      rows = [...rows].sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? ''), undefined, { numeric: true }) * dir);
    }
    const page = rows.slice(input.offset, input.offset + input.pageSize).map((h) => ({
      ...h,
      openRequestCount: demo().requests.filter((r) => r.equipmentId === h.equipmentId && isOpen(r)).length,
    }));
    return { rows: page, totalMatches: rows.length, hasMore: input.offset + page.length < rows.length, truncated: false, timing: TIMING, error: null };
  },

  getEquipmentDetail: ({ equipmentId }) => {
    const h = findHeater(equipmentId);
    if (!h) return { found: false, heater: null, floc: null, fieldValues: [], ownership: [], timing: TIMING, error: null };
    return {
      found: true,
      heater: h,
      floc: {
        functionalLocation: h.functionalLocation ?? `SYN-FL-${String(equipmentId).padStart(4, '0')}`,
        flocDescription: h.flocDescription,
        superiorFunctionalLocation: h.superiorFunctionalLocation,
        flocClass: h.flocClass,
        techObjectType: h.techObjectType,
        flocUserStatus: h.flocUserStatus,
        profitCenterName: h.profitCenterName,
        level1Id: 'SYN-ORG',
        level2Id: 'SYN-BU-01',
        level3Id: 'SYN-AREA-01',
        level4Id: null,
        level5Id: null,
        level6Id: null,
        goldenVersionId: h.goldenVersionId,
        lastChangedAtUtc: h.lastChangedAtUtc,
      },
      fieldValues: CATALOG.map((c) => ({
        equipmentFieldKey: `${equipmentId}|${c.fieldCode}`,
        equipmentId,
        fieldCode: c.fieldCode,
        currentValue: fieldValueOf(h, c.fieldCode),
        baselineValue: fieldValueOf(h, c.fieldCode),
        unit: c.unit,
        valueSource: 'STATED',
        lastRequestId: null,
        lastChangedAtUtc: null,
      })),
      ownership: CATALOG.map((c) => ({
        fieldOwnershipKey: `${c.entityType}|${c.fieldCode}`,
        entityType: c.entityType,
        fieldCode: c.fieldCode,
        label: c.label,
        responsibleRole: 'Operations-IOC',
        accountableRole: ACCOUNTABLE_GROUP,
        routeId: 3,
      })),
      timing: TIMING,
      error: null,
    };
  },

  getRequestFormOptions: () => {
    const p = currentPersona();
    return {
      ...ok(),
      canSubmit: p.canSubmitRequests,
      isAdmin: p.canManageAdmin,
      allowedValues: [...ALLOWED_VALUES],
      blockedFields: p.canManageAdmin
        ? []
        : CATALOG.filter((c) => c.adminOnly).map((c) => ({ fieldCode: c.fieldCode, reason: 'Only an admin or a business rule may change this field.' })),
    };
  },

  getEquipmentRequests: ({ equipmentId }) => {
    const rows = demo()
      .requests.filter((r) => r.equipmentId === equipmentId)
      .map((r) => ({
        requestId: r.requestId,
        requestRef: r.requestRef,
        requestStatus: r.requestStatus,
        isOpen: isOpen(r),
        equipmentId: r.equipmentId,
        functionalLocation: r.functionalLocation,
        fieldCode: r.fieldCode,
        fieldLabel: r.fieldLabel,
        sourceLabel: r.sourceLabel,
        requestedAtUtc: r.requestedAtUtc,
        otherOpenRequestsSameField: 0,
      }));
    return { ...ok(), totalCount: rows.length, rows };
  },

  createChangeRequest: (input) => {
    const h = findHeater(input.equipmentId);
    if (!h) return refused('There is no such heater (sample data).', 50201);
    const open = demo().requests.find((r) => r.equipmentId === h.equipmentId && r.fieldCode === input.fieldCode && isOpen(r));
    const groups = { responsibleGroup: responsibleGroupFor(h.profitCenterName), accountableGroup: ACCOUNTABLE_GROUP };
    if (open) {
      const outcome = open.newValue === input.newValue ? 'DUPLICATE_SUPPRESSED' : 'BLOCKED_INCOMPATIBLE';
      return { ...ok(), requestId: open.requestId, requestRef: open.requestRef, outcome, ...groups };
    }
    const n = demo().nextRequestId++;
    const fromField = input.source === 'FIELD';
    const row = queueRow(n, {
      requestStatus: 'PENDING_RESPONSIBLE',
      approvalStage: 'RESPONSIBLE',
      equipmentId: h.equipmentId,
      equipmentNumber: h.equipmentNumber,
      functionalLocation: h.functionalLocation,
      equipmentTagNumber: h.equipmentTagNumber,
      profitCenterName: h.profitCenterName,
      fieldCode: input.fieldCode,
      fieldLabel: labelOf(input.fieldCode),
      sapField: fieldOf(input.fieldCode)?.sapField ?? null,
      oldValue: input.oldValue,
      newValue: input.newValue,
      reason: input.reason || null,
      sourceType: fromField ? 'FIELD' : 'MANUAL',
      sourceLabel: fromField ? 'Field submission' : 'Manual request',
      requestedBy: me(),
      requestedAtUtc: nowIso(),
      ...groups,
      ageHours: 0,
      updatedAtUtc: nowIso(),
      canApprove: true,
    });
    demo().requests.unshift(row);
    addEvent(n, { eventType: 'CREATED', actor: me(), comments: input.reason || null, statusTo: 'PENDING_RESPONSIBLE' });
    notify(row, `group:${groups.responsibleGroup}`, 'REQUEST_PENDING_RESPONSIBLE', 'A request is waiting for you');
    return { ...ok(), requestId: n, requestRef: refOf(n), outcome: 'CREATED', ...groups };
  },

  getRequestQueue: (input) => {
    const all = demo().requests;
    const inTab = all.filter(TAB_TEST[input.tab] ?? (() => false));
    const facets = [
      ...tally(inTab, 'PROFIT_CENTER', (r) => (r.profitCenterName ? [r.profitCenterName, r.profitCenterName] : null)),
      ...tally(inTab, 'FIELD', (r) => (r.fieldCode ? [r.fieldCode, r.fieldLabel ?? r.fieldCode] : null)),
      ...tally(inTab, 'RULE', (r) => (r.sourceRuleId ? [r.sourceRuleId, r.sourceRuleId] : null)),
    ];
    const rows = inTab.filter(
      (r) =>
        (!input.profitCenter || r.profitCenterName === input.profitCenter) &&
        (!input.fieldCode || r.fieldCode === input.fieldCode) &&
        (!input.ruleId || r.sourceRuleId === input.ruleId) &&
        (r.ageHours ?? 0) >= input.minAgeHours &&
        (!input.noteOnly || r.note !== null)
    );
    const page = rows.slice(input.offset, input.offset + input.pageSize).map((r) => ({ ...r, canApprove: eligibility(r).ok }));
    const count = (tab: string) => all.filter(TAB_TEST[tab]).length;
    return {
      ...ok(),
      counts: {
        responsible: count('RESPONSIBLE'),
        accountable: count('ACCOUNTABLE'),
        returned: count('RETURNED'),
        approved: count('APPROVED'),
        rejected: count('REJECTED'),
        mine: count('MY_REQUESTS'),
      },
      totalMatches: rows.length,
      hasMore: input.offset + page.length < rows.length,
      rows: page,
      facets,
    };
  },

  getRequestDetail: ({ requestId }) => {
    const r = findRequest(requestId);
    if (!r) return refused('There is no such request (sample data).', 50301);
    const h = findHeater(r.equipmentId);
    const p = currentPersona();
    const who = eligibility(r);
    const events = eventsOf(r.requestId);
    const lastDecision = [...events].reverse().find((e) => e.decidedAs !== null);
    const merged = events.find((e) => e.eventType === 'MERGED');
    const isSubmitter = r.requestedBy === me();
    const isRecipient = r.requestStatus === 'RETURNED' && r.returnRecipient === me();
    const defaultReturn = r.requestedBy.startsWith('system:') ? me() : r.requestedBy;
    return {
      ...ok(),
      request: detailRow({
        ...(r as unknown as Partial<DetailRow>),
        classCode: 'HEATER',
        routeId: 3,
        creationComment: r.reason,
        lastDecisionBy: lastDecision?.actor ?? null,
        lastDecisionAtUtc: lastDecision?.occurredAtUtc ?? null,
        mergeOutcome: merged ? 'MERGED' : null,
        mergedAtUtc: merged?.occurredAtUtc ?? null,
        goldenVersionId: merged ? (h?.goldenVersionId ?? 1) + 1 : null,
      }),
      events,
      related: demo()
        .requests.filter((x) => x.equipmentId === r.equipmentId && x.requestId !== r.requestId)
        .map((x) =>
          relatedRow(x.requestId, {
            requestStatus: x.requestStatus,
            isOpen: isOpen(x),
            fieldCode: x.fieldCode,
            fieldLabel: x.fieldLabel,
            equipmentId: x.equipmentId,
            functionalLocation: x.functionalLocation,
            sourceLabel: x.sourceLabel,
            requestedAtUtc: x.requestedAtUtc,
          })
        ),
      route: routeRow(),
      gold: goldRow({
        equipmentNumber: r.equipmentNumber,
        equipmentDescription: h?.equipmentDescription ?? null,
        equipmentTagNumber: r.equipmentTagNumber,
        functionalLocation: r.functionalLocation,
        profitCenterName: r.profitCenterName,
        manufacturer: h?.manufacturer ?? null,
        modelNumber: h?.modelNumber ?? null,
        manufacturerSerialNumber: h?.manufacturerSerialNumber ?? null,
        fieldCurrentValue: h && r.fieldCode ? fieldValueOf(h, r.fieldCode) : r.oldValue,
        fieldUnit: r.fieldCode ? (fieldOf(r.fieldCode)?.unit ?? null) : null,
      }),
      checks: checkRows(
        who.ok ? {} : { USER_ELIGIBLE_FOR_STAGE: { checkStatus: 'FAIL', message: who.reason ?? 'you may not decide this stage' } }
      ),
      viewer: viewer({
        canDecide: who.ok,
        decideBlockedReason: who.reason,
        canApprove: who.ok,
        approveBlockedReason: who.reason,
        canResubmit: isRecipient || (r.requestStatus === 'RETURNED' && p.canManageAdmin),
        canCancel: isOpen(r) && (isSubmitter || p.canManageAdmin),
        returnToType: 'USER',
        returnTo: defaultReturn,
        returnToLabel: displayNameOf(defaultReturn),
        stage: r.approvalStage,
        decidedAs: who.decidedAs,
      }),
      returnCandidates: returnCandidatesFor(r),
    };
  },

  getRequestChecks: ({ requestId }) => {
    const r = findRequest(requestId);
    return { ...ok(), requestStatus: r?.requestStatus ?? 'PENDING_RESPONSIBLE', checks: checkRows() };
  },

  getRequestEvidence: ({ requestId }) => {
    const r = findRequest(requestId);
    return {
      ...ok(),
      requestRef: r?.requestRef ?? null,
      createdAtUtc: r?.requestedAtUtc ?? null,
      createdBy: r?.requestedBy ?? null,
      detailsJson: JSON.stringify({
        event: 'CREATED',
        source_type: r?.sourceType ?? 'MANUAL',
        entity_type: 'EQUIPMENT',
        entity_key: r?.equipmentNumber ?? null,
        evidence: r?.sourceType === 'FIELD' ? { seen_on: 'nameplate', photo_taken: true } : { seen_on: 'data sheet' },
      }),
    };
  },

  decideRequest: ({ requestId, decision, comment, expectedStatus, returnTo }) => {
    const r = findRequest(requestId);
    if (!r) return refused('There is no such request (sample data).', 50301);
    if (expectedStatus && r.requestStatus !== expectedStatus) return refused('The request has moved on since you opened it.', 50310);
    const who = eligibility(r);
    if (!who.ok) return refused(who.reason ?? 'You may not decide this request.', 50140);
    const { previous, stage } = applyDecision(r, decision, comment, returnTo);
    return {
      ...ok(),
      requestId,
      requestRef: r.requestRef,
      decision,
      previousStatus: previous,
      newStatus: r.requestStatus,
      stage,
      needsMerge: false,
      merge: r.requestStatus === 'APPROVED' ? MERGED : null,
    };
  },

  bulkApprove: ({ requestIds, comment }) => {
    const ids = requestIds.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
    const results = ids.map((id) => {
      const r = findRequest(id);
      const who = r ? eligibility(r) : null;
      if (!r || !who?.ok) {
        return { requestId: id, requestRef: r?.requestRef ?? null, outcome: 'SKIPPED', newStatus: null, reason: who?.reason ?? 'There is no such request.', merge: null };
      }
      applyDecision(r, 'APPROVE', comment, '');
      return { requestId: id, requestRef: r.requestRef, outcome: 'DECIDED', newStatus: r.requestStatus, reason: null, merge: r.requestStatus === 'APPROVED' ? MERGED : null };
    });
    return { ...ok(), decided: results.filter((x) => x.outcome === 'DECIDED').length, skipped: results.filter((x) => x.outcome === 'SKIPPED').length, results };
  },

  resubmitRequest: ({ requestId, newValue, comment }) => {
    const r = findRequest(requestId);
    if (!r) return refused('There is no such request (sample data).', 50301);
    if (r.requestStatus !== 'RETURNED') return refused('Only a returned request can be resubmitted.', 50150);
    if (r.returnRecipient !== me() && !currentPersona().canManageAdmin) return refused('Only the person it was returned to (or an admin) can resubmit it.', 50151);
    const previous = r.requestStatus;
    r.requestStatus = 'PENDING_RESPONSIBLE';
    r.approvalStage = 'RESPONSIBLE';
    r.returnRecipient = null;
    r.returnRecipientType = null;
    if (newValue) r.newValue = newValue;
    r.canApprove = true;
    r.updatedAtUtc = nowIso();
    addEvent(r.requestId, { eventType: 'RESUBMITTED', comments: comment || null, statusFrom: previous, statusTo: r.requestStatus });
    notify(r, `group:${r.responsibleGroup}`, 'REQUEST_PENDING_RESPONSIBLE', 'A corrected request is waiting for you');
    return { ...ok(), requestId, requestRef: r.requestRef, newStatus: r.requestStatus, newValue: r.newValue };
  },

  cancelRequest: ({ requestId, comment }) => {
    const r = findRequest(requestId);
    if (!r) return refused('There is no such request (sample data).', 50301);
    if (!isOpen(r)) return refused('This request is already closed.', 50160);
    if (r.requestedBy !== me() && !currentPersona().canManageAdmin) return refused('Only the person who raised it (or an admin) can withdraw it.', 50161);
    const previous = r.requestStatus;
    r.requestStatus = 'CANCELLED';
    r.approvalStage = null;
    r.canApprove = false;
    r.updatedAtUtc = nowIso();
    addEvent(r.requestId, { eventType: 'CANCELLED', comments: comment || null, statusFrom: previous, statusTo: 'CANCELLED' });
    return { ...ok(), requestId, requestRef: r.requestRef, previousStatus: previous, newStatus: r.requestStatus };
  },

  getMyNotifications: ({ limit }) => {
    const mine = inboxOf();
    const items = mine.slice(0, limit).map((n) => ({
      notificationId: n.notificationId,
      topic: n.topic,
      requestId: n.requestId,
      requestRef: n.requestRef,
      title: n.title,
      body: n.body,
      createdAtUtc: n.createdAtUtc,
      isRead: isReadBy(n, me()),
    }));
    return { ...ok(), unreadCount: mine.filter((n) => !isReadBy(n, me())).length, items };
  },
};
