/**
 * Synthetic answers for the request-detail tests. Everything here is invented (SYN- identifiers, addresses
 * ending @example.test); nothing comes from the client.
 */
import type { CheckRow, DetailRow, EventRow, GoldRow, RelatedRow, RequestView, ReturnCandidate, RouteRow, Viewer } from './request-api';

export function detailRow(over: Partial<DetailRow> = {}): DetailRow {
  return {
    requestId: 12,
    requestRef: 'CR-000012',
    requestStatus: 'PENDING_RESPONSIBLE',
    approvalStage: 'RESPONSIBLE',
    entityType: 'EQUIPMENT',
    equipmentId: 7,
    equipmentNumber: 'SYN-EQ-0007',
    functionalLocation: 'SYN-FL-0007',
    equipmentTagNumber: 'SYN-TAG-0007',
    profitCenterName: 'SYN PROFIT CENTRE',
    fieldCode: 'MANUFACTURER',
    fieldLabel: 'Manufacturer',
    sapField: 'HERST',
    oldValue: 'SYNTHETIC MFR A',
    newValue: 'SYNTHETIC MFR B',
    reason: 'Nameplate photo shows a different maker',
    note: null,
    sourceType: 'MANUAL',
    sourceRuleId: null,
    sourceRuleVersion: null,
    sourceLabel: 'Manual request',
    requestedBy: 't3.requester@example.test',
    requestedAtUtc: '2026-11-17T09:30:00.000Z',
    detectedAtUtc: null,
    responsibleGroup: 'SYN-RESPONSIBLE-GROUP',
    accountableGroup: 'SYN-ACCOUNTABLE-GROUP',
    returnRecipientType: null,
    returnRecipient: null,
    ageHours: 5,
    photoCount: 0,
    updatedAtUtc: '2026-11-17T09:30:00.000Z',
    classCode: 'HEATER',
    routeId: 3,
    creationComment: 'Checked on site',
    lastDecisionBy: null,
    lastDecisionAtUtc: null,
    mergeOutcome: null,
    mergedAtUtc: null,
    goldenVersionId: null,
    exportedAtUtc: null,
    evolveBatchId: null,
    evolveRowNumber: null,
    ...over,
  };
}

export function eventRow(n: number, over: Partial<EventRow> = {}): EventRow {
  return {
    eventId: n,
    eventType: 'CREATED',
    approvalStage: null,
    actor: 't3.requester@example.test',
    actorGroup: null,
    occurredAtUtc: '2026-11-17T09:30:00.000Z',
    comments: 'Checked on site',
    statusFrom: null,
    statusTo: 'PENDING_RESPONSIBLE',
    decidedAs: null,
    samePersonBothStages: false,
    returnedTo: null,
    ...over,
  };
}

export function relatedRow(n: number, over: Partial<RelatedRow> = {}): RelatedRow {
  return {
    requestId: n,
    requestRef: `CR-${String(n).padStart(6, '0')}`,
    requestStatus: 'PENDING_ACCOUNTABLE',
    isOpen: true,
    equipmentId: 7,
    functionalLocation: 'SYN-FL-0007',
    fieldCode: 'MODEL_NUMBER',
    fieldLabel: 'Model number',
    sourceLabel: 'Field submission',
    requestedAtUtc: '2026-11-16T08:00:00.000Z',
    otherOpenRequestsSameField: 0,
    ...over,
  };
}

export function goldRow(over: Partial<GoldRow> = {}): GoldRow {
  return {
    entityType: 'EQUIPMENT',
    equipmentNumber: 'SYN-EQ-0007',
    equipmentDescription: 'SYNTHETIC HEATER 0007',
    equipmentTagNumber: 'SYN-TAG-0007',
    functionalLocation: 'SYN-FL-0007',
    flocDescription: 'SYNTHETIC SLOT 0007',
    equipClass: 'HEATER',
    profitCenterName: 'SYN PROFIT CENTRE',
    manufacturer: 'SYNTHETIC MFR A',
    modelNumber: 'SYN-MODEL-1',
    manufacturerSerialNumber: 'SYN-SN-0007',
    equipmentUserStatus: 'OPER',
    goldenVersionId: 4,
    lastChangedAtUtc: null,
    fieldCurrentValue: 'SYNTHETIC MFR A',
    fieldUnit: null,
    ...over,
  };
}

export function routeRow(over: Partial<RouteRow> = {}): RouteRow {
  return {
    routeId: 3,
    entityType: 'EQUIPMENT',
    requestAction: 'UPDATE',
    fieldOrCharacteristic: '*',
    classScope: 'ANY',
    responsibleRole: 'Operations-IOC',
    accountableRole: 'SAPBusinessSupport',
    ...over,
  };
}

const CHECKED = '2026-11-17T14:00:00.000Z';

/** The six checks in the server's order; pass `over` to change one by code. */
export function checkRows(over: Record<string, Partial<CheckRow>> = {}): CheckRow[] {
  const base: [string, string][] = [
    ['ASSOCIATION_MATCH', 'the heater is still at the location the request was raised at'],
    ['OLD_VALUE_CURRENT', 'the current value is still the one the request expected'],
    ['VALUE_ALLOWED', 'the value is acceptable'],
    ['UNITS_EXPLICIT', 'not applicable'],
    ['NO_CONFLICTING_OPEN_REQUEST', 'no other open request proposes a different value'],
    ['USER_ELIGIBLE_FOR_STAGE', 'you may decide this stage'],
  ];
  return base.map(([code, message], i) => ({ order: i + 1, code, checkStatus: 'PASS', message, checkedAtUtc: CHECKED, ...over[code] }));
}

export function viewer(over: Partial<Viewer> = {}): Viewer {
  return {
    canDecide: true,
    decideBlockedReason: null,
    canApprove: true,
    approveBlockedReason: null,
    canResubmit: false,
    canCancel: false,
    returnToType: 'USER',
    returnTo: 't3.requester@example.test',
    returnToLabel: 'T3 requester',
    stage: 'RESPONSIBLE',
    decidedAs: 'GROUP_MEMBER',
    ...over,
  };
}

/** Who the Return dialog offers: the submitter, a member of each group, and the person themselves. */
export function returnCandidates(): ReturnCandidate[] {
  return [
    { email: 't3.requester@example.test', displayName: 'T3 requester', relation: 'SUBMITTER', isYou: false },
    { email: 't3.responsible@example.test', displayName: 'T3 responsible', relation: 'RESPONSIBLE_GROUP', isYou: true },
    { email: 't3.accountable@example.test', displayName: 'T3 accountable', relation: 'ACCOUNTABLE_GROUP', isYou: false },
  ];
}

export function requestView(over: Partial<RequestView> = {}): RequestView {
  return {
    request: detailRow(),
    events: [eventRow(1)],
    related: [],
    route: routeRow(),
    gold: goldRow(),
    checks: checkRows(),
    viewer: viewer(),
    returnCandidates: returnCandidates(),
    evidence: {
      createdAtUtc: '2026-11-17T09:30:00.000Z',
      createdBy: 't3.requester@example.test',
      detailsJson: JSON.stringify({
        event: 'CREATED',
        source_type: 'MANUAL',
        entity_type: 'EQUIPMENT',
        entity_key: 'SYN-EQ-0007',
        route_used: 'FIELD',
        golden_version_id: 4,
        baseline_as_of_utc: '2026-11-01T00:00:00.000Z',
        evidence: { seen_on: 'nameplate', photo_taken: true },
      }),
    },
    evidenceError: null,
    ...over,
  };
}
