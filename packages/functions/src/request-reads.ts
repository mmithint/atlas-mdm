/**
 * The request screens' reads (APP-4; FINAL PLAN/01 section 2.1 "read path C", decision D-17; 03 APP-4).
 *
 *   getRequestQueue        -> app.usp_request_queue        S-2: the six tabs, counts, filters, one page of rows
 *   getRequestDetail       -> app.usp_request_detail       S-3: one request, its history, related requests, route,
 *                                                          gold now, live approval checks, what the caller may do
 *   getMyNotifications     -> app.usp_notification_list    the bell: unread count and the latest messages
 *   getRequestFormOptions  -> app.usp_request_form_options the request dialog: drop-down values, who may submit,
 *                                                          fields this person may not request
 *   getEquipmentRequests   -> app.usp_equipment_requests   S-5: requests on one heater or at its location
 *
 * Reads only: nothing here writes. They are functions (not connector reads) because the connector cannot read
 * views (spike S7) and because "my queue", "what may I decide" and "my notifications" depend on WHO is asking.
 * The shared runner (`act`: caller from the verified token, one connection, failures returned as data) and the
 * answer envelope are in runner.ts. The business rules (which request is in which tab, who may decide, who a
 * return goes to) are in the T-SQL procedures and functions behind these; nothing is decided here.
 *
 * The browser never supplies identity: no function takes an e-mail; the e-mail goes to the procedure as
 * @actor_email. Names and counts only in the log.
 *
 * The answers are FLAT interfaces on purpose: the generated contract in types.ts is compared with them
 * (`npm run validate:functions`).
 */
import sql from 'mssql';

import type { CheckRow } from './requests.js';
import {
  FIELD_CODE,
  InputError,
  act,
  invalid,
  num,
  on,
  orNull,
  requestIdOf,
  str,
  text,
  whole,
  word,
  type Envelope,
  type Row,
  type Timing,
} from './runner.js';

// ---------------------------------------------------------------------------
// The answers
// ---------------------------------------------------------------------------

/** One row of a queue (S-2). */
export interface QueueRow {
  requestId: number;
  requestRef: string;
  requestStatus: string;
  /** RESPONSIBLE or ACCOUNTABLE while the request waits for a decision, else null. */
  approvalStage: string | null;
  entityType: string;
  equipmentId: number | null;
  equipmentNumber: string | null;
  functionalLocation: string | null;
  equipmentTagNumber: string | null;
  profitCenterName: string | null;
  fieldCode: string | null;
  fieldLabel: string | null;
  sapField: string | null;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  /** For example TBD on a fired / unfired proposal. */
  note: string | null;
  sourceType: string;
  sourceRuleId: string | null;
  sourceRuleVersion: number | null;
  /** "Rule <id> v<n>", "Field submission", "Manual request" ... */
  sourceLabel: string;
  requestedBy: string;
  requestedAtUtc: string | null;
  detectedAtUtc: string | null;
  responsibleGroup: string;
  accountableGroup: string;
  returnRecipientType: string | null;
  returnRecipient: string | null;
  ageHours: number | null;
  photoCount: number;
  updatedAtUtc: string | null;
  /** True when the caller may APPROVE this request now (stage, group, scope and segregation): the bulk checkbox. */
  canApprove: boolean;
}

/** The request of S-3: the queue columns (without canApprove) and what the detail view adds. */
export interface DetailRow {
  requestId: number;
  requestRef: string;
  requestStatus: string;
  approvalStage: string | null;
  entityType: string;
  equipmentId: number | null;
  equipmentNumber: string | null;
  functionalLocation: string | null;
  equipmentTagNumber: string | null;
  profitCenterName: string | null;
  fieldCode: string | null;
  fieldLabel: string | null;
  sapField: string | null;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  note: string | null;
  sourceType: string;
  sourceRuleId: string | null;
  sourceRuleVersion: number | null;
  sourceLabel: string;
  requestedBy: string;
  requestedAtUtc: string | null;
  detectedAtUtc: string | null;
  responsibleGroup: string;
  accountableGroup: string;
  returnRecipientType: string | null;
  returnRecipient: string | null;
  ageHours: number | null;
  photoCount: number;
  updatedAtUtc: string | null;
  classCode: string | null;
  routeId: number | null;
  creationComment: string | null;
  lastDecisionBy: string | null;
  lastDecisionAtUtc: string | null;
  /** APPLIED, STALE, ALREADY_APPLIED, NOT_ELIGIBLE or ERROR; null before a merge was tried. */
  mergeOutcome: string | null;
  mergedAtUtc: string | null;
  goldenVersionId: number | null;
  exportedAtUtc: string | null;
  evolveBatchId: number | null;
  evolveRowNumber: number | null;
}

export interface EventRow {
  eventId: number;
  eventType: string;
  approvalStage: string | null;
  actor: string;
  actorGroup: string | null;
  occurredAtUtc: string | null;
  comments: string | null;
  statusFrom: string | null;
  statusTo: string | null;
  /** On a decision: GROUP_MEMBER or ADMIN (how the person qualified); null otherwise. */
  decidedAs: string | null;
  /** The second approval came from the person who approved the first (allowed since 18 Nov 2026). */
  samePersonBothStages: boolean;
  /** On a RETURNED event: who it was returned to (an e-mail or a group key). */
  returnedTo: string | null;
}

/** One person the Return dialog may send the request to (app.fn_return_candidates). */
export interface ReturnCandidate {
  email: string;
  displayName: string;
  /** SUBMITTER, RESPONSIBLE_GROUP, ACCOUNTABLE_GROUP or YOU. */
  relation: string;
  isYou: boolean;
}

/** Another request on the same heater, or at the same location. */
export interface RelatedRow {
  requestId: number;
  requestRef: string;
  requestStatus: string;
  isOpen: boolean;
  equipmentId: number | null;
  functionalLocation: string | null;
  fieldCode: string | null;
  fieldLabel: string | null;
  sourceLabel: string;
  requestedAtUtc: string | null;
  /** More than 0 is the overlap flag: other open requests target the same field of the same heater. */
  otherOpenRequestsSameField: number;
}

export interface RouteRow {
  routeId: number;
  entityType: string;
  requestAction: string;
  fieldOrCharacteristic: string;
  classScope: string;
  responsibleRole: string;
  accountableRole: string;
}

/** What gold holds now for the heater (or location) and the requested field. */
export interface GoldRow {
  entityType: string;
  equipmentNumber: string | null;
  equipmentDescription: string | null;
  equipmentTagNumber: string | null;
  functionalLocation: string | null;
  flocDescription: string | null;
  equipClass: string | null;
  profitCenterName: string | null;
  manufacturer: string | null;
  modelNumber: string | null;
  manufacturerSerialNumber: string | null;
  equipmentUserStatus: string | null;
  goldenVersionId: number | null;
  lastChangedAtUtc: string | null;
  fieldCurrentValue: string | null;
  fieldUnit: string | null;
}

/** What the caller may do with this request, decided by the database (the screen only shows it). */
export interface Viewer {
  /** The request waits for a decision and the person is eligible (group, flag, scope): Reject and Return are allowed. */
  canDecide: boolean;
  /** Why not, in a sentence, when canDecide is false. */
  decideBlockedReason: string | null;
  /** Approve is allowed (since 18 Nov 2026 the same as canDecide: one person may approve both stages). */
  canApprove: boolean;
  /** Why not, in a sentence, when canApprove is false. */
  approveBlockedReason: string | null;
  canResubmit: boolean;
  canCancel: boolean;
  /** USER or GROUP: where a RETURN goes when nobody is picked (the default), or where it went. */
  returnToType: string | null;
  returnTo: string | null;
  returnToLabel: string | null;
  stage: string | null;
  /** GROUP_MEMBER or ADMIN while the person may decide: how they qualify. */
  decidedAs: string | null;
}

export interface NotificationRow {
  notificationId: number;
  topic: string;
  requestId: number | null;
  requestRef: string | null;
  title: string;
  body: string;
  createdAtUtc: string | null;
  isRead: boolean;
}

export interface RequestQueueResult {
  ok: boolean;
  status: string;
  error: string | null;
  errorCode: number | null;
  userId: string | null;
  timing: Timing;
  /** The size of each tab for this person (not narrowed by the filters). */
  counts: { responsible: number; accountable: number; returned: number; approved: number; rejected: number; mine: number };
  totalMatches: number;
  hasMore: boolean;
  rows: QueueRow[];
  /** Filter choices over the tab's rows: kind is PROFIT_CENTER, FIELD or RULE. */
  facets: { kind: string; value: string; label: string; n: number }[];
}

export interface RequestDetailResult {
  ok: boolean;
  status: string;
  error: string | null;
  errorCode: number | null;
  userId: string | null;
  timing: Timing;
  request: DetailRow | null;
  events: EventRow[];
  related: RelatedRow[];
  route: RouteRow | null;
  gold: GoldRow | null;
  checks: CheckRow[];
  viewer: Viewer | null;
  /** Who the caller may return the request to; empty unless they may decide it now. */
  returnCandidates: ReturnCandidate[];
}

export interface MyNotificationsResult {
  ok: boolean;
  status: string;
  error: string | null;
  errorCode: number | null;
  userId: string | null;
  timing: Timing;
  unreadCount: number;
  items: NotificationRow[];
}

export interface RequestFormOptionsResult {
  ok: boolean;
  status: string;
  error: string | null;
  errorCode: number | null;
  userId: string | null;
  timing: Timing;
  canSubmit: boolean;
  isAdmin: boolean;
  allowedValues: { fieldCode: string; value: string; order: number }[];
  blockedFields: { fieldCode: string; reason: string }[];
}

export interface EquipmentRequestsResult {
  ok: boolean;
  status: string;
  error: string | null;
  errorCode: number | null;
  userId: string | null;
  timing: Timing;
  totalCount: number;
  rows: RelatedRow[];
}

// ---------------------------------------------------------------------------
// Reading the result sets
// ---------------------------------------------------------------------------

/** The result sets of one procedure call, in order; a missing set is an empty one. */
function setsOf(result: { recordsets?: unknown; recordset?: unknown }): Row[][] {
  const all = result.recordsets;
  if (Array.isArray(all)) return all.map((s) => (Array.isArray(s) ? (s as Row[]) : []));
  return Array.isArray(result.recordset) ? [result.recordset as Row[]] : [];
}

const required = (v: unknown): string => str(v) ?? '';
const count = (v: unknown): number => num(v) ?? 0;

function baseRow(r: Row): Omit<QueueRow, 'canApprove'> {
  return {
    requestId: count(r['request_id']),
    requestRef: required(r['request_ref']),
    requestStatus: required(r['request_status']),
    approvalStage: str(r['approval_stage']),
    entityType: required(r['entity_type']),
    equipmentId: num(r['equipment_id']),
    equipmentNumber: str(r['equipment_number']),
    functionalLocation: str(r['functional_location']),
    equipmentTagNumber: str(r['equipment_tag_number']),
    profitCenterName: str(r['profit_center_name']),
    fieldCode: str(r['field_code']),
    fieldLabel: str(r['field_label']),
    sapField: str(r['sap_field']),
    oldValue: str(r['old_value']),
    newValue: str(r['new_value']),
    reason: str(r['reason']),
    note: str(r['note']),
    sourceType: required(r['source_type']),
    sourceRuleId: str(r['source_rule_id']),
    sourceRuleVersion: num(r['source_rule_version']),
    sourceLabel: required(r['source_label']),
    requestedBy: required(r['requested_by']),
    requestedAtUtc: str(r['requested_at_utc']),
    detectedAtUtc: str(r['detected_at_utc']),
    responsibleGroup: required(r['responsible_group']),
    accountableGroup: required(r['accountable_group']),
    returnRecipientType: str(r['return_recipient_type']),
    returnRecipient: str(r['return_recipient']),
    ageHours: num(r['age_hours']),
    photoCount: count(r['photo_count']),
    updatedAtUtc: str(r['updated_at_utc']),
  };
}

const queueRow = (r: Row): QueueRow => ({ ...baseRow(r), canApprove: on(r['can_approve']) });

const detailRow = (r: Row): DetailRow => ({
  ...baseRow(r),
  classCode: str(r['class_code']),
  routeId: num(r['route_id']),
  creationComment: str(r['creation_comment']),
  lastDecisionBy: str(r['last_decision_by']),
  lastDecisionAtUtc: str(r['last_decision_at_utc']),
  mergeOutcome: str(r['merge_outcome']),
  mergedAtUtc: str(r['merged_at_utc']),
  goldenVersionId: num(r['golden_version_id']),
  exportedAtUtc: str(r['exported_at_utc']),
  evolveBatchId: num(r['evolve_batch_id']),
  evolveRowNumber: num(r['evolve_row_number']),
});

const eventRow = (r: Row): EventRow => ({
  eventId: count(r['event_id']),
  eventType: required(r['event_type']),
  approvalStage: str(r['approval_stage']),
  actor: required(r['actor']),
  actorGroup: str(r['actor_group']),
  occurredAtUtc: str(r['occurred_at_utc']),
  comments: str(r['comments']),
  statusFrom: str(r['status_from']),
  statusTo: str(r['status_to']),
  decidedAs: str(r['decided_as']),
  samePersonBothStages: on(r['same_person_both_stages']),
  returnedTo: str(r['returned_to']),
});

const candidateRow = (r: Row): ReturnCandidate => ({
  email: required(r['user_email']),
  displayName: str(r['display_name']) ?? required(r['user_email']),
  relation: required(r['relation']),
  isYou: on(r['is_you']),
});

const relatedRow = (r: Row): RelatedRow => ({
  requestId: count(r['request_id']),
  requestRef: required(r['request_ref']),
  requestStatus: required(r['request_status']),
  isOpen: on(r['is_open']),
  equipmentId: num(r['equipment_id']),
  functionalLocation: str(r['functional_location']),
  fieldCode: str(r['field_code']),
  fieldLabel: str(r['field_label']),
  sourceLabel: required(r['source_label']),
  requestedAtUtc: str(r['requested_at_utc']),
  otherOpenRequestsSameField: count(r['other_open_requests_same_field']),
});

const routeRow = (r: Row): RouteRow => ({
  routeId: count(r['route_id']),
  entityType: required(r['entity_type']),
  requestAction: required(r['request_action']),
  fieldOrCharacteristic: required(r['field_or_characteristic']),
  classScope: required(r['class_scope']),
  responsibleRole: required(r['responsible_role']),
  accountableRole: required(r['accountable_role']),
});

const goldRow = (r: Row): GoldRow => ({
  entityType: required(r['entity_type']),
  equipmentNumber: str(r['equipment_number']),
  equipmentDescription: str(r['equipment_description']),
  equipmentTagNumber: str(r['equipment_tag_number']),
  functionalLocation: str(r['functional_location']),
  flocDescription: str(r['floc_description']),
  equipClass: str(r['equip_class']),
  profitCenterName: str(r['profit_center_name']),
  manufacturer: str(r['manufacturer']),
  modelNumber: str(r['model_number']),
  manufacturerSerialNumber: str(r['manufacturer_serial_number']),
  equipmentUserStatus: str(r['equipment_user_status']),
  goldenVersionId: num(r['golden_version_id']),
  lastChangedAtUtc: str(r['last_changed_at_utc']),
  fieldCurrentValue: str(r['field_current_value']),
  fieldUnit: str(r['field_unit']),
});

const checkRow = (r: Row): CheckRow => ({
  order: count(r['check_order']),
  code: required(r['check_code']),
  checkStatus: str(r['check_status']) ?? 'NOT_CHECKED',
  message: required(r['message']),
  checkedAtUtc: str(r['checked_at_utc']),
});

const viewerRow = (r: Row): Viewer => ({
  canDecide: on(r['can_decide']),
  decideBlockedReason: str(r['decide_blocked_reason']),
  canApprove: on(r['can_approve']),
  approveBlockedReason: str(r['approve_blocked_reason']),
  canResubmit: on(r['can_resubmit']),
  canCancel: on(r['can_cancel']),
  returnToType: str(r['return_to_type']),
  returnTo: str(r['return_to']),
  returnToLabel: str(r['return_to_label']),
  stage: str(r['stage']),
  decidedAs: str(r['decided_as']),
});

const notificationRow = (r: Row): NotificationRow => ({
  notificationId: count(r['notification_id']),
  topic: required(r['topic']),
  requestId: num(r['request_id']),
  requestRef: str(r['request_ref']),
  title: required(r['title']),
  body: required(r['body']),
  createdAtUtc: str(r['created_at_utc']),
  isRead: on(r['is_read']),
});

// ---------------------------------------------------------------------------
// getRequestQueue
// ---------------------------------------------------------------------------

export const QUEUE_TABS = ['RESPONSIBLE', 'ACCOUNTABLE', 'RETURNED', 'APPROVED', 'REJECTED', 'MY_REQUESTS'] as const;
const MAX_OFFSET = 1_000_000;
const MAX_PAGE = 100;

type QueuePayload = Omit<RequestQueueResult, keyof Envelope>;

const emptyQueue = (): QueuePayload => ({
  counts: { responsible: 0, accountable: 0, returned: 0, approved: 0, rejected: 0, mine: 0 },
  totalMatches: 0,
  hasMore: false,
  rows: [],
  facets: [],
});

export interface QueueInput {
  /** RESPONSIBLE, ACCOUNTABLE, RETURNED, APPROVED, REJECTED or MY_REQUESTS. */
  tab: string;
  /** Empty = any. */
  profitCenter: string;
  /** Empty = any. */
  fieldCode: string;
  /** Empty = any. */
  ruleId: string;
  /** Only open requests at least this many hours old; 0 = no age filter. */
  minAgeHours: number;
  /** 1 = only requests that carry a note (the TBD ones); 0 = all. */
  noteOnly: number;
  offset: number;
  pageSize: number;
}

interface CheckedQueue {
  tab: string;
  profitCenter: string | null;
  fieldCode: string | null;
  ruleId: string | null;
  minAgeHours: number | null;
  noteOnly: boolean;
  offset: number;
  pageSize: number;
}

/** Input checks only. Which request belongs in which tab is the procedure's rule. */
export function checkQueue(input: QueueInput): CheckedQueue {
  const fieldCode = text('The field', input.fieldCode, 64);
  if (fieldCode !== '' && !FIELD_CODE.test(fieldCode)) throw new InputError('The field is not a field code.');
  const minAge = whole('The age filter', input.minAgeHours, 0, 100_000);
  return {
    tab: word('The tab', input.tab, QUEUE_TABS),
    profitCenter: orNull(text('The profit centre', input.profitCenter, 40)),
    fieldCode: orNull(fieldCode),
    ruleId: orNull(text('The rule', input.ruleId, 64)),
    minAgeHours: minAge === 0 ? null : minAge,
    noteOnly: whole('The note filter', input.noteOnly, 0, 1) === 1,
    offset: whole('The offset', input.offset, 0, MAX_OFFSET),
    pageSize: whole('The page size', input.pageSize, 1, MAX_PAGE),
  };
}

export async function runRequestQueue(
  input: QueueInput,
  accessToken: string | null | undefined,
  getSqlToken: () => string
): Promise<RequestQueueResult> {
  const started = performance.now();
  let c: CheckedQueue;
  try {
    c = checkQueue(input);
  } catch (err) {
    return invalid(err, started, emptyQueue());
  }
  return act('getRequestQueue', 'read the queue', accessToken, getSqlToken, emptyQueue(), async (pool, email) => {
    const r = await pool
      .request()
      .input('actor_email', sql.NVarChar(256), email)
      .input('tab', sql.NVarChar(20), c.tab)
      .input('profit_center', sql.NVarChar(40), c.profitCenter)
      .input('field_code', sql.NVarChar(64), c.fieldCode)
      .input('rule_id', sql.NVarChar(64), c.ruleId)
      .input('min_age_hours', sql.Int, c.minAgeHours)
      .input('note_only', sql.Bit, c.noteOnly ? 1 : 0)
      .input('offset', sql.Int, c.offset)
      .input('page_size', sql.Int, c.pageSize)
      .execute<Row>('app.usp_request_queue');
    const sets = setsOf(r);
    const counts = sets[0]?.[0];
    const rows = (sets[2] ?? []).map(queueRow);
    const totalMatches = num(sets[1]?.[0]?.['total_matches']) ?? rows.length;
    console.log(`getRequestQueue: tab=${c.tab} rows=${rows.length} total=${totalMatches}`);
    return {
      counts: {
        responsible: count(counts?.['responsible_count']),
        accountable: count(counts?.['accountable_count']),
        returned: count(counts?.['returned_count']),
        approved: count(counts?.['approved_count']),
        rejected: count(counts?.['rejected_count']),
        mine: count(counts?.['mine_count']),
      },
      totalMatches,
      hasMore: c.offset + rows.length < totalMatches,
      rows,
      facets: (sets[3] ?? []).map((f) => ({
        kind: required(f['facet_kind']),
        value: required(f['facet_value']),
        label: str(f['facet_label']) ?? required(f['facet_value']),
        n: count(f['n']),
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// getRequestDetail
// ---------------------------------------------------------------------------

type DetailPayload = Omit<RequestDetailResult, keyof Envelope>;

const emptyDetail = (): DetailPayload => ({
  request: null,
  events: [],
  related: [],
  route: null,
  gold: null,
  checks: [],
  viewer: null,
  returnCandidates: [],
});

export async function runRequestDetail(
  requestId: number,
  accessToken: string | null | undefined,
  getSqlToken: () => string
): Promise<RequestDetailResult> {
  const started = performance.now();
  let id: number;
  try {
    id = requestIdOf(requestId);
  } catch (err) {
    return invalid(err, started, emptyDetail());
  }
  return act('getRequestDetail', 'read the request', accessToken, getSqlToken, emptyDetail(), async (pool, email) => {
    const r = await pool
      .request()
      .input('request_id', sql.BigInt, String(id))
      .input('actor_email', sql.NVarChar(256), email)
      .execute<Row>('app.usp_request_detail');
    // Eight result sets, always in this order (db/procs/usp_request_detail.sql).
    const sets = setsOf(r);
    const head = sets[0]?.[0];
    const route = sets[3]?.[0];
    const gold = sets[4]?.[0];
    const viewer = sets[6]?.[0];
    const result: DetailPayload = {
      request: head ? detailRow(head) : null,
      events: (sets[1] ?? []).map(eventRow),
      related: (sets[2] ?? []).map(relatedRow),
      route: route ? routeRow(route) : null,
      gold: gold ? goldRow(gold) : null,
      checks: (sets[5] ?? []).map(checkRow),
      viewer: viewer ? viewerRow(viewer) : null,
      returnCandidates: (sets[7] ?? []).map(candidateRow),
    };
    console.log(`getRequestDetail: events=${result.events.length} related=${result.related.length} checks=${result.checks.length}`);
    return result;
  });
}

// ---------------------------------------------------------------------------
// getMyNotifications
// ---------------------------------------------------------------------------

type NotificationsPayload = Omit<MyNotificationsResult, keyof Envelope>;

const emptyNotifications = (): NotificationsPayload => ({ unreadCount: 0, items: [] });

export async function runMyNotifications(
  limit: number,
  accessToken: string | null | undefined,
  getSqlToken: () => string
): Promise<MyNotificationsResult> {
  const started = performance.now();
  let n: number;
  try {
    n = whole('The limit', limit, 1, 50);
  } catch (err) {
    return invalid(err, started, emptyNotifications());
  }
  return act('getMyNotifications', 'read the notifications', accessToken, getSqlToken, emptyNotifications(), async (pool, email) => {
    const r = await pool
      .request()
      .input('actor_email', sql.NVarChar(256), email)
      .input('limit', sql.Int, n)
      .execute<Row>('app.usp_notification_list');
    const sets = setsOf(r);
    const items = (sets[1] ?? []).map(notificationRow);
    const unreadCount = count(sets[0]?.[0]?.['unread_count']);
    console.log(`getMyNotifications: unread=${unreadCount} items=${items.length}`);
    return { unreadCount, items };
  });
}

// ---------------------------------------------------------------------------
// getRequestFormOptions
// ---------------------------------------------------------------------------

type FormOptionsPayload = Omit<RequestFormOptionsResult, keyof Envelope>;

const emptyFormOptions = (): FormOptionsPayload => ({ canSubmit: false, isAdmin: false, allowedValues: [], blockedFields: [] });

export async function runRequestFormOptions(
  accessToken: string | null | undefined,
  getSqlToken: () => string
): Promise<RequestFormOptionsResult> {
  return act('getRequestFormOptions', 'read the form options', accessToken, getSqlToken, emptyFormOptions(), async (pool, email) => {
    const r = await pool.request().input('actor_email', sql.NVarChar(256), email).execute<Row>('app.usp_request_form_options');
    const sets = setsOf(r);
    const who = sets[1]?.[0];
    const result: FormOptionsPayload = {
      canSubmit: on(who?.['can_submit']),
      isAdmin: on(who?.['is_admin']),
      allowedValues: (sets[0] ?? []).map((v) => ({
        fieldCode: required(v['field_code']),
        value: required(v['allowed_value']),
        order: count(v['display_order']),
      })),
      blockedFields: (sets[2] ?? []).map((b) => ({ fieldCode: required(b['field_code']), reason: required(b['reason']) })),
    };
    console.log(`getRequestFormOptions: values=${result.allowedValues.length} blocked=${result.blockedFields.length}`);
    return result;
  });
}

// ---------------------------------------------------------------------------
// getEquipmentRequests
// ---------------------------------------------------------------------------

type EquipmentRequestsPayload = Omit<EquipmentRequestsResult, keyof Envelope>;

const emptyEquipmentRequests = (): EquipmentRequestsPayload => ({ totalCount: 0, rows: [] });

export async function runEquipmentRequests(
  equipmentId: number,
  accessToken: string | null | undefined,
  getSqlToken: () => string
): Promise<EquipmentRequestsResult> {
  const started = performance.now();
  let id: number;
  try {
    // 0 is a valid heater id (the synthetic stub's first heater, found 15 Nov).
    id = whole('The heater id', equipmentId, 0, 2_147_483_647);
  } catch (err) {
    return invalid(err, started, emptyEquipmentRequests());
  }
  return act('getEquipmentRequests', 'read the requests', accessToken, getSqlToken, emptyEquipmentRequests(), async (pool) => {
    const r = await pool.request().input('equipment_id', sql.Int, id).execute<Row>('app.usp_equipment_requests');
    const sets = setsOf(r);
    const rows = (sets[1] ?? []).map(relatedRow);
    const totalCount = num(sets[0]?.[0]?.['total_count']) ?? rows.length;
    console.log(`getEquipmentRequests: rows=${rows.length} total=${totalCount}`);
    return { totalCount, rows };
  });
}
