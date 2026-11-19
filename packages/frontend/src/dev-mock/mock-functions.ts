/**
 * Stand-ins for the Rayfin functions, used ONLY by `npm run dev:mock` (see mock-client.ts).
 *
 * Why this exists: under `rayfin dev` the functions run on the developer's own Microsoft account, which Fabric
 * SQL refuses, so UI work had no data. These handlers answer from invented rows (SYN- identifiers, addresses
 * ending @example.test, reused from the test fixtures) and keep a little state in memory, so approving, returning
 * or withdrawing a request moves it between the Approvals tabs until the page is reloaded.
 *
 * Nothing here is real, nothing here talks to a server, and none of it is part of a production build: the
 * only importers are dynamic imports behind `import.meta.env.DEV` checks.
 *
 * Every handler is typed against `AppFunctionsSchema`, so a change to a function's answer breaks this file at
 * compile time, the same way it breaks the screens.
 */
import type { AppFunctionsSchema as S } from '@rayfin-app/functions/types';

import { queueRow } from '../features/approvals/queue-fixtures';
import type { DetailRow } from '../features/approvals/request-api';
import { checkRows, detailRow, eventRow, goldRow, relatedRow, returnCandidates, routeRow, viewer } from '../features/approvals/request-fixtures';
import { formOptions, searchRow } from '../features/equipment/test-fixtures';

export const MOCK_USER = 'dev.user@example.test';
export const MOCK_USER_NAME = 'Dev User (mock)';

type Handlers = { [K in keyof S]?: (input: S[K]['input']) => S[K]['output'] };
type QueueRowT = S['getRequestQueue']['output']['rows'][number];
type SearchRowT = S['searchEquipment']['output']['rows'][number];

const TIMING = { connectMs: 0, queryMs: 1, totalMs: 1 };
const OK = { ok: true, status: 'OK', error: null, errorCode: null, userId: 'mock-user', timing: TIMING } as const;

/** A procedure's refusal, as the real functions report it inside the answer. */
function refused(error: string, errorCode: number): never {
  return { ...OK, ok: false, status: 'REFUSED', error, errorCode } as never;
}

// ---------------------------------------------------------------- heaters

const PROFIT_CENTRES = ['SYN PROFIT CENTRE A', 'SYN PROFIT CENTRE B', 'SYN PROFIT CENTRE C'];
const MAKERS = ['SYNTHETIC MFR A', 'SYNTHETIC MFR B', 'SYNTHETIC MFR C'];
const HEATER_COUNT = 60;

function buildHeaters(): SearchRowT[] {
  return Array.from({ length: HEATER_COUNT }, (_, i) => {
    const n = i + 1;
    return searchRow(n, {
      manufacturer: MAKERS[n % MAKERS.length],
      modelNumber: `SYN-MODEL-${(n % 4) + 1}`,
      profitCenterName: PROFIT_CENTRES[n % PROFIT_CENTRES.length],
      firedUnfired: n % 5 === 0 ? 'UNFIRED' : 'FIRED',
      heatDutyMmbtuHr: 1 + (n % 9) * 0.75,
      verificationPct: 20 + ((n * 7) % 80),
      invalidRuleCount: n % 4 === 0 ? 2 : 0,
    });
  });
}

const CATALOG = [
  ['MANUFACTURER', 'Manufacturer', 'EQUIPMENT', 'TEXT', null, 'KEY', true],
  ['MODEL_NUMBER', 'Model number', 'EQUIPMENT', 'TEXT', null, 'KEY', true],
  ['MANUFACTURER_SERIAL_NUMBER', 'Serial number', 'EQUIPMENT', 'TEXT', null, 'KEY', true],
  ['FIRED_UNFIRED', 'Fired / unfired', 'EQUIPMENT', 'LIST', null, 'KEY', true],
  ['HEAT_DUTY', 'Heat duty (MMBTU/hr)', 'EQUIPMENT', 'DECIMAL', 'MMBTU/hr', 'KEY', true],
  ['EQUIPMENT_TAG_NUMBER', 'Engineering tag', 'EQUIPMENT', 'TEXT', null, 'ADDITIONAL', true],
  ['FLOC_CLASS', 'FLOC class', 'FLOC', 'CODE', null, 'ADDITIONAL', true],
  ['PLANNER_GROUP', 'Planner group', 'EQUIPMENT', 'CODE', null, 'ADDITIONAL', false],
] as const;

/** The field catalogue, as the read-only connector returns it (table `app.field_catalog`). */
export function catalogRows(): Record<string, unknown>[] {
  return CATALOG.map(([fieldCode, label, entityType, dataType, unit, displayGroup, isEditable], i) => ({
    fieldCode,
    label,
    entityType,
    dataType,
    maxLength: 100,
    unit,
    allowedValuesSource: dataType === 'LIST' ? 'FIRED_UNFIRED' : null,
    isKeyVerificationField: displayGroup === 'KEY',
    isEditable,
    displayGroup,
    displayOrder: i + 1,
    isMandatoryForSubmission: false,
    isActive: true,
  }));
}

const FIELD_LABEL = new Map<string, string>(CATALOG.map((c) => [c[0], c[1]]));

function fieldValueOf(h: SearchRowT, code: string): string | null {
  const map: Record<string, unknown> = {
    MANUFACTURER: h.manufacturer,
    MODEL_NUMBER: h.modelNumber,
    MANUFACTURER_SERIAL_NUMBER: h.manufacturerSerialNumber,
    FIRED_UNFIRED: h.firedUnfired,
    HEAT_DUTY: h.heatDutyMmbtuHr === null ? null : h.heatDutyMmbtuHr.toFixed(4),
    EQUIPMENT_TAG_NUMBER: h.equipmentTagNumber,
    FLOC_CLASS: h.flocClass,
    PLANNER_GROUP: h.plannerGroup,
  };
  const v = map[code];
  return v === undefined || v === null ? null : String(v);
}

// ---------------------------------------------------------------- requests (in memory)

const ME = MOCK_USER;
const FIELDS = [
  ['MANUFACTURER', 'HERST', 'SYNTHETIC MFR A', 'SYNTHETIC MFR B'],
  ['MODEL_NUMBER', 'TYPBZ', 'SYN-MODEL-1', 'SYN-MODEL-2'],
  ['HEAT_DUTY', 'HEAT_DUTY', '2.5000', '3.1000'],
  ['FIRED_UNFIRED', 'FIRED_UNFIRED', 'FIRED', 'UNFIRED'],
] as const;

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

function buildRequests(heaters: SearchRowT[]): QueueRowT[] {
  // 1-8 waiting for the responsible group, 9-12 for the accountable group, 13-14 returned,
  // 15-20 approved, 21-22 rejected. Every third one was raised by the mock user.
  const status = (n: number): [string, string | null] =>
    n <= 8 ? ['PENDING_RESPONSIBLE', 'RESPONSIBLE']
    : n <= 12 ? ['PENDING_ACCOUNTABLE', 'ACCOUNTABLE']
    : n <= 14 ? ['RETURNED', null]
    : n <= 20 ? ['APPROVED', null]
    : ['REJECTED', null];

  return Array.from({ length: 22 }, (_, i) => {
    const n = i + 1;
    const h = heaters[(n * 3) % heaters.length];
    const [fieldCode, sapField, oldValue, newValue] = FIELDS[n % FIELDS.length];
    const [requestStatus, approvalStage] = status(n);
    const fromRule = n % 4 === 0;
    const age = 2 + n * 9;
    return queueRow(n, {
      requestStatus,
      approvalStage,
      equipmentId: h.equipmentId,
      equipmentNumber: h.equipmentNumber,
      functionalLocation: h.functionalLocation,
      equipmentTagNumber: h.equipmentTagNumber,
      profitCenterName: h.profitCenterName,
      fieldCode,
      fieldLabel: FIELD_LABEL.get(fieldCode) ?? fieldCode,
      sapField,
      oldValue,
      newValue,
      reason: fromRule ? null : 'Nameplate photo shows a different value (SYNTHETIC)',
      note: n % 5 === 0 ? 'Please double-check (SYNTHETIC note)' : null,
      sourceType: fromRule ? 'RULE' : 'MANUAL',
      sourceRuleId: fromRule ? 'HR-07' : null,
      sourceRuleVersion: fromRule ? 1 : null,
      sourceLabel: fromRule ? 'Rule HR-07 (synthetic)' : 'Manual request',
      requestedBy: n % 3 === 0 ? ME : `requester${n}@example.test`,
      requestedAtUtc: hoursAgo(age),
      detectedAtUtc: fromRule ? hoursAgo(age + 1) : null,
      returnRecipientType: requestStatus === 'RETURNED' ? 'USER' : null,
      returnRecipient: requestStatus === 'RETURNED' ? ME : null,
      ageHours: age,
      photoCount: n % 3,
      updatedAtUtc: hoursAgo(age / 2),
      canApprove: requestStatus.startsWith('PENDING'),
    });
  });
}

const HEATERS = buildHeaters();
let requests: QueueRowT[] = buildRequests(HEATERS);
let nextRequestId = 100;

/** Back to the starting data (the page reload does this too; tests call it). */
export function resetMock(): void {
  requests = buildRequests(HEATERS);
  nextRequestId = 100;
}

const isOpen = (r: QueueRowT) => r.requestStatus.startsWith('PENDING') || r.requestStatus === 'RETURNED';
const refOf = (n: number) => `CR-${String(n).padStart(6, '0')}`;

const TAB_TEST: Record<string, (r: QueueRowT) => boolean> = {
  RESPONSIBLE: (r) => r.requestStatus === 'PENDING_RESPONSIBLE',
  ACCOUNTABLE: (r) => r.requestStatus === 'PENDING_ACCOUNTABLE',
  RETURNED: (r) => r.requestStatus === 'RETURNED' && r.returnRecipient === ME,
  APPROVED: (r) => r.requestStatus === 'APPROVED',
  REJECTED: (r) => r.requestStatus === 'REJECTED',
  MY_REQUESTS: (r) => r.requestedBy === ME,
};

function tally(rows: QueueRowT[], kind: string, pick: (r: QueueRowT) => [string, string] | null) {
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

// ---------------------------------------------------------------- handlers

function applyDecision(row: QueueRowT, decision: string, returnTo: string): { previous: string; stage: string | null } {
  const previous = row.requestStatus;
  const stage = row.approvalStage;
  if (decision === 'APPROVE') {
    if (previous === 'PENDING_RESPONSIBLE') {
      row.requestStatus = 'PENDING_ACCOUNTABLE';
      row.approvalStage = 'ACCOUNTABLE';
    } else {
      row.requestStatus = 'APPROVED';
      row.approvalStage = null;
    }
  } else if (decision === 'REJECT') {
    row.requestStatus = 'REJECTED';
    row.approvalStage = null;
  } else {
    row.requestStatus = 'RETURNED';
    row.approvalStage = null;
    row.returnRecipientType = 'USER';
    row.returnRecipient = returnTo || row.requestedBy;
  }
  row.canApprove = row.requestStatus.startsWith('PENDING');
  row.updatedAtUtc = new Date().toISOString();
  return { previous, stage };
}

const MERGED = { outcome: 'MERGED', message: 'Merged into the golden record (mock).', goldenVersionId: 5, recorded: null, error: null };

export const mockHandlers: Handlers = {
  getMyProfile: () => ({
    status: 'OK',
    userId: 'mock-user',
    email: MOCK_USER,
    displayName: MOCK_USER_NAME,
    roles: ['Mock-Everything'],
    groups: ['SYN-GROUP-R', 'SYN-GROUP-A'],
    canView: true,
    canSubmitRequests: true,
    canEditRules: true,
    canPublishRules: true,
    canResponsibleApprove: true,
    canAccountableApprove: true,
    canManageAdmin: true,
    responsibleScope: { allOrcm: true, profitCenters: [] },
    accountableScope: { allOrcm: true, profitCenters: [] },
  }),

  searchEquipment: (input) => {
    const text = (input.searchText ?? '').trim().toLowerCase();
    let rows = HEATERS.filter((h) => !input.facility || h.profitCenterName === input.facility);
    if (input.mode === 'match' && text) {
      rows = rows.filter((h) =>
        [h.equipmentNumber, h.equipmentDescription, h.functionalLocation, h.equipmentTagNumber, h.manufacturer, h.modelNumber, h.manufacturerSerialNumber]
          .some((v) => (v ?? '').toLowerCase().includes(text))
      );
    }
    const key = input.sortColumn as keyof SearchRowT;
    if (key && rows.length > 0 && key in rows[0]) {
      const dir = input.sortDirection === 'desc' ? -1 : 1;
      rows = [...rows].sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? ''), undefined, { numeric: true }) * dir);
    }
    const page = rows.slice(input.offset, input.offset + input.pageSize).map((h) => ({
      ...h,
      openRequestCount: requests.filter((r) => r.equipmentId === h.equipmentId && isOpen(r)).length,
    }));
    return { rows: page, totalMatches: rows.length, hasMore: input.offset + page.length < rows.length, truncated: false, timing: TIMING, error: null };
  },

  getEquipmentDetail: ({ equipmentId }) => {
    const h = HEATERS.find((x) => x.equipmentId === equipmentId);
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
        goldenVersionId: 1,
        lastChangedAtUtc: null,
      },
      fieldValues: CATALOG.map(([fieldCode, , , , unit]) => ({
        equipmentFieldKey: `${equipmentId}|${fieldCode}`,
        equipmentId,
        fieldCode,
        currentValue: fieldValueOf(h, fieldCode),
        baselineValue: fieldValueOf(h, fieldCode),
        unit,
        valueSource: 'STATED',
        lastRequestId: null,
        lastChangedAtUtc: null,
      })),
      ownership: CATALOG.map(([fieldCode, label, entityType]) => ({
        fieldOwnershipKey: `${entityType}|${fieldCode}`,
        entityType,
        fieldCode,
        label,
        responsibleRole: 'Operations-IOC',
        accountableRole: 'SAPBusinessSupport',
        routeId: 3,
      })),
      timing: TIMING,
      error: null,
    };
  },

  getRequestFormOptions: () => ({ ...OK, ...formOptions({ isAdmin: true }) }),

  getEquipmentRequests: ({ equipmentId }) => {
    const rows = requests
      .filter((r) => r.equipmentId === equipmentId)
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
    return { ...OK, totalCount: rows.length, rows };
  },

  createChangeRequest: (input) => {
    const h = HEATERS.find((x) => x.equipmentId === input.equipmentId);
    if (!h) return refused('There is no such heater (mock).', 50201);
    const n = nextRequestId++;
    requests.unshift(
      queueRow(n, {
        requestStatus: 'PENDING_RESPONSIBLE',
        approvalStage: 'RESPONSIBLE',
        equipmentId: h.equipmentId,
        equipmentNumber: h.equipmentNumber,
        functionalLocation: h.functionalLocation,
        equipmentTagNumber: h.equipmentTagNumber,
        profitCenterName: h.profitCenterName,
        fieldCode: input.fieldCode,
        fieldLabel: FIELD_LABEL.get(input.fieldCode) ?? input.fieldCode,
        oldValue: input.oldValue,
        newValue: input.newValue,
        reason: input.reason || null,
        requestedBy: ME,
        requestedAtUtc: new Date().toISOString(),
        ageHours: 0,
        updatedAtUtc: new Date().toISOString(),
        canApprove: true,
      })
    );
    return { ...OK, requestId: n, requestRef: refOf(n), outcome: 'CREATED', responsibleGroup: 'SYN-GROUP-R', accountableGroup: 'SYN-GROUP-A' };
  },

  getRequestQueue: (input) => {
    const inTab = requests.filter(TAB_TEST[input.tab] ?? (() => false));
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
    const page = rows.slice(input.offset, input.offset + input.pageSize);
    return {
      ...OK,
      counts: {
        responsible: requests.filter(TAB_TEST.RESPONSIBLE).length,
        accountable: requests.filter(TAB_TEST.ACCOUNTABLE).length,
        returned: requests.filter(TAB_TEST.RETURNED).length,
        approved: requests.filter(TAB_TEST.APPROVED).length,
        rejected: requests.filter(TAB_TEST.REJECTED).length,
        mine: requests.filter(TAB_TEST.MY_REQUESTS).length,
      },
      totalMatches: rows.length,
      hasMore: input.offset + page.length < rows.length,
      rows: page,
      facets,
    };
  },

  getRequestDetail: ({ requestId }) => {
    const r = requests.find((x) => x.requestId === requestId);
    if (!r) return refused('There is no such request (mock).', 50301);
    const open = r.requestStatus.startsWith('PENDING');
    const h = HEATERS.find((x) => x.equipmentId === r.equipmentId);
    const events = [eventRow(1, { actor: r.requestedBy, occurredAtUtc: r.requestedAtUtc, comments: r.reason, statusTo: 'PENDING_RESPONSIBLE' })];
    if (r.requestStatus !== 'PENDING_RESPONSIBLE') {
      events.push(
        eventRow(2, {
          eventType: r.requestStatus === 'PENDING_ACCOUNTABLE' ? 'APPROVED' : r.requestStatus,
          approvalStage: 'RESPONSIBLE',
          actor: 't3.responsible@example.test',
          occurredAtUtc: r.updatedAtUtc,
          comments: 'Looks right (mock)',
          statusFrom: 'PENDING_RESPONSIBLE',
          statusTo: r.requestStatus,
        })
      );
    }
    return {
      ...OK,
      request: detailRow({ ...(r as unknown as Partial<DetailRow>), classCode: 'HEATER', routeId: 3, creationComment: r.reason }),
      events,
      related: requests
        .filter((x) => x.equipmentId === r.equipmentId && x.requestId !== r.requestId)
        .map((x) => relatedRow(x.requestId, { requestStatus: x.requestStatus, isOpen: isOpen(x), fieldCode: x.fieldCode, fieldLabel: x.fieldLabel, equipmentId: x.equipmentId, functionalLocation: x.functionalLocation })),
      route: routeRow(),
      gold: goldRow({
        equipmentNumber: r.equipmentNumber,
        equipmentTagNumber: r.equipmentTagNumber,
        functionalLocation: r.functionalLocation,
        profitCenterName: r.profitCenterName,
        manufacturer: h?.manufacturer ?? null,
        fieldCurrentValue: r.oldValue,
      }),
      checks: checkRows(),
      viewer: open
        ? viewer({ stage: r.approvalStage, returnTo: r.requestedBy, returnToLabel: r.requestedBy })
        : viewer({
            canDecide: false,
            decideBlockedReason: 'This request is no longer waiting for a decision (mock).',
            canApprove: false,
            approveBlockedReason: 'This request is no longer waiting for a decision (mock).',
            canResubmit: r.requestStatus === 'RETURNED' && r.requestedBy === ME,
            canCancel: r.requestStatus === 'RETURNED' && r.requestedBy === ME,
            stage: null,
            decidedAs: null,
          }),
      returnCandidates: returnCandidates(),
    };
  },

  getRequestChecks: () => ({ ...OK, requestStatus: 'PENDING_RESPONSIBLE', checks: checkRows() }),

  getRequestEvidence: ({ requestId }) => {
    const r = requests.find((x) => x.requestId === requestId);
    return {
      ...OK,
      requestRef: r?.requestRef ?? null,
      createdAtUtc: r?.requestedAtUtc ?? null,
      createdBy: r?.requestedBy ?? null,
      detailsJson: JSON.stringify({ event: 'CREATED', source_type: r?.sourceType ?? 'MANUAL', entity_type: 'EQUIPMENT', evidence: { seen_on: 'nameplate (mock)' } }),
    };
  },

  decideRequest: ({ requestId, decision, expectedStatus, returnTo }) => {
    const r = requests.find((x) => x.requestId === requestId);
    if (!r) return refused('There is no such request (mock).', 50301);
    if (expectedStatus && r.requestStatus !== expectedStatus) return refused('The request has moved on since you opened it (mock).', 50310);
    if (!r.requestStatus.startsWith('PENDING')) return refused('This request is not waiting for a decision (mock).', 50311);
    const { previous, stage } = applyDecision(r, decision, returnTo);
    const merged = r.requestStatus === 'APPROVED';
    return { ...OK, requestId, requestRef: r.requestRef, decision, previousStatus: previous, newStatus: r.requestStatus, stage, needsMerge: false, merge: merged ? MERGED : null };
  },

  bulkApprove: ({ requestIds }) => {
    const ids = requestIds.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
    const results = ids.map((id) => {
      const r = requests.find((x) => x.requestId === id);
      if (!r || !r.requestStatus.startsWith('PENDING')) {
        return { requestId: id, requestRef: r?.requestRef ?? null, outcome: 'SKIPPED', newStatus: null, reason: 'Not waiting for a decision (mock).', merge: null };
      }
      applyDecision(r, 'APPROVE', '');
      return { requestId: id, requestRef: r.requestRef, outcome: 'APPROVED', newStatus: r.requestStatus, reason: null, merge: r.requestStatus === 'APPROVED' ? MERGED : null };
    });
    return { ...OK, decided: results.filter((x) => x.outcome === 'APPROVED').length, skipped: results.filter((x) => x.outcome === 'SKIPPED').length, results };
  },

  resubmitRequest: ({ requestId, newValue }) => {
    const r = requests.find((x) => x.requestId === requestId);
    if (!r) return refused('There is no such request (mock).', 50301);
    r.requestStatus = 'PENDING_RESPONSIBLE';
    r.approvalStage = 'RESPONSIBLE';
    r.returnRecipient = null;
    r.returnRecipientType = null;
    if (newValue) r.newValue = newValue;
    r.canApprove = true;
    return { ...OK, requestId, requestRef: r.requestRef, newStatus: r.requestStatus, newValue: r.newValue };
  },

  cancelRequest: ({ requestId }) => {
    const r = requests.find((x) => x.requestId === requestId);
    if (!r) return refused('There is no such request (mock).', 50301);
    const previous = r.requestStatus;
    r.requestStatus = 'CANCELLED';
    r.approvalStage = null;
    r.canApprove = false;
    return { ...OK, requestId, requestRef: r.requestRef, previousStatus: previous, newStatus: r.requestStatus };
  },

  getMyNotifications: ({ limit }) => {
    const items = [
      { notificationId: 3, topic: 'REQUEST_DECIDED', requestId: 15, requestRef: refOf(15), title: 'Your request was approved', body: 'SYNTHETIC notification for the mock build.', createdAtUtc: hoursAgo(2), isRead: false },
      { notificationId: 2, topic: 'REQUEST_RETURNED', requestId: 13, requestRef: refOf(13), title: 'A request was returned to you', body: 'SYNTHETIC notification for the mock build.', createdAtUtc: hoursAgo(20), isRead: false },
      { notificationId: 1, topic: 'REQUEST_CREATED', requestId: 1, requestRef: refOf(1), title: 'A request is waiting for you', body: 'SYNTHETIC notification for the mock build.', createdAtUtc: hoursAgo(50), isRead: true },
    ].slice(0, limit);
    return { ...OK, unreadCount: items.filter((i) => !i.isRead).length, items };
  },
};
