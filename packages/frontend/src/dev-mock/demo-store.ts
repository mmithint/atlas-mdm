/**
 * The one in-memory state behind the client demo (`npm run dev:mock` only; FINAL PLAN/11 §3 F6 and §5).
 *
 * Every mock and preview handler reads and writes this, so one step of the demo shows up on the other pages:
 * a decision moves the request between queue tabs, adds to its history, tells the next people and, on final
 * approval, changes the heater. **Reset demo** (header) and a page reload both restore the starting state.
 * Later tiers add their own slices (rules, runs, verification marks, photos, export, admin settings).
 *
 * Sample data rules (FINAL PLAN/11 §4.1): heater identifiers are invented (`SYN-`); profit centres, roles and
 * groups are the client's own names from the committed seeds (metadata); people are "(sample)" names at
 * example.test. The eligibility rule below is a simplified copy of the server's (`app.fn_stage_eligibility`,
 * contract `01` §3): enough to show who may decide what, not a second source of truth.
 */
import { queueRow } from '../features/approvals/queue-fixtures';
import type { QueueRow } from '../features/approvals/queue-api';
import type { EventRow } from '../features/approvals/request-api';
import type { SearchRow } from '../features/equipment/equipment-api';
import { searchRow } from '../features/equipment/test-fixtures';

import type { RuleStatusRow } from '../features/equipment/rule-status-types';
import type { FieldFormSubmit, Mark, PhotoRow } from '../features/field/field-types';
import type { RuleRun, RuleTestResult, RuleVersion } from '../features/rules/rules-types';

import type { DropdownRow, Member, RouteRow } from '../features/admin/admin-types';

import { ROUTES } from './admin-seed';
import { ALLOWED_VALUES, CATALOG, fieldOf, fieldValueOf, labelOf, setFieldValue } from './catalog';
import { currentPersona, DEFAULT_PERSONA, PERSONAS, setPersona, type Persona } from './personas';
import { hasGroupBy, SAMPLE_RULES, sampleRule, type Violation } from './rule-samples';
import { sampleImage } from './sample-images';

// ---------------------------------------------------------------- places, groups, people

/** The ten profit centres (business units) of seed 0104. */
export const PROFIT_CENTRES = [
  'OP RES DB NM',
  'OP RES MB',
  'OP RES DB TX',
  'OP RES MB CROWNROCK',
  'OP EOR',
  'OP EOR GAS PLANT',
  'OP EOR CO2 OPS',
  'ROCKIES-DJ BASIN',
  'ROCKIES-OTHER',
  'ROCKIES-PRB',
] as const;

/** Which regional group is responsible for a profit centre (seed 0104, REF-46 L0241-L0244). */
const REGIONAL_GROUP: Record<string, string> = {
  'OP RES DB NM': 'Operations-IOC-Carlsbad',
  'OP RES MB': 'Operations-IOC-Midland',
  'OP RES DB TX': 'Operations-IOC-Midland',
  'OP RES MB CROWNROCK': 'Operations-IOC-Midland',
  'OP EOR': 'Operations-IOC-DenverCity',
  'OP EOR GAS PLANT': 'Operations-IOC-DenverCity',
  'OP EOR CO2 OPS': 'Operations-IOC-DenverCity',
  'ROCKIES-DJ BASIN': 'Operations-IOC-Platteville',
  'ROCKIES-OTHER': 'Operations-IOC-Platteville',
  'ROCKIES-PRB': 'Operations-IOC-Platteville',
};

/** The accountable group on every heater route (REF-46 L0211-L0214). */
export const ACCOUNTABLE_GROUP = 'SAPBusinessSupport';

export function responsibleGroupFor(profitCenter: string | null | undefined): string {
  return (profitCenter && REGIONAL_GROUP[profitCenter]) || 'UNROUTED';
}

export interface Person {
  email: string;
  displayName: string;
  groups: string[];
}

/** People who are not personas but appear in the data. DenverCity has no member, as in the client's workbook. */
const OTHER_PEOPLE: readonly Person[] = [
  { email: 'pat.nguyen@example.test', displayName: 'Pat Nguyen (sample)', groups: ['Operations-IOC-Midland'] },
  { email: 'drew.patel@example.test', displayName: 'Drew Patel (sample)', groups: ['Operations-IOC-Platteville'] },
  { email: 'taylor.reed@example.test', displayName: 'Taylor Reed (sample)', groups: ['SAPBusinessSupport'] },
  { email: 'casey.morgan@example.test', displayName: 'Casey Morgan (sample)', groups: [] },
];

export function people(): Person[] {
  return [...PERSONAS.map((p) => ({ email: p.email, displayName: p.displayName, groups: p.groups })), ...OTHER_PEOPLE];
}

export function displayNameOf(email: string | null | undefined): string {
  if (!email) return '';
  if (email.startsWith('system:')) return 'ATLAS rule engine';
  return people().find((p) => p.email === email)?.displayName ?? email;
}

export function membersOf(group: string | null | undefined): Person[] {
  return group ? people().filter((p) => p.groups.includes(group)) : [];
}

const ADMIN_EMAIL = PERSONAS.find((p) => p.id === 'admin')?.email ?? 'admin@example.test';
const FIELD_EMAIL = PERSONAS.find((p) => p.id === 'field')?.email ?? 'field@example.test';
/** A rule run raises requests as the system; the screens then show no submitter (queue-model `sourceView`). */
export const RULE_ENGINE = 'system:rules';

// ---------------------------------------------------------------- small helpers

export const me = (): string => currentPersona().email;
export const isOpen = (r: QueueRow): boolean => r.requestStatus.startsWith('PENDING') || r.requestStatus === 'RETURNED';
export const refOf = (n: number): string => `CR-${String(n).padStart(6, '0')}`;
export const hoursAgo = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString();
export const nowIso = (): string => new Date().toISOString();

// ---------------------------------------------------------------- heaters

const MAKERS = ['Example Heater Co.', 'Sample Burner Works', 'Demo Thermal Inc.'];
const HEATER_COUNT = 60;

/**
 * Tags written twice (or three times) under the same parent FLOC, spelt differently, for the rule
 * ENGINEERING_TAG_UNIQUE: its normalisation (no hyphens or slashes, any case) must see them as one.
 */
const DUPLICATE_TAGS: Record<number, string> = { 22: 'SYN-TAG-0021', 23: 'syn-tag/0021', 41: 'SYN-TAG-0040' };

function buildHeaters(): SearchRow[] {
  const others = PROFIT_CENTRES.slice(1);
  return Array.from({ length: HEATER_COUNT }, (_, i) => {
    const n = i + 1;
    return searchRow(n, {
      manufacturer: MAKERS[n % MAKERS.length],
      modelNumber: `SYN-MODEL-${(n % 4) + 1}`,
      // A third of the heaters are in Carlsbad's area, so the responsible persona has work to show; the rest
      // go round the other nine profit centres in turn (k = how many non-Carlsbad heaters came before).
      profitCenterName: n % 3 === 0 ? 'OP RES DB NM' : others[(n - Math.floor(n / 3) - 1) % others.length],
      firedUnfired: n % 5 === 0 ? 'UNFIRED' : 'FIRED',
      heatDutyMmbtuHr: n % 7 === 0 ? null : 1 + (n % 9) * 0.75,
      heatDutySource: n % 7 === 0 ? 'MISSING' : 'STATED',
      ...(DUPLICATE_TAGS[n] ? { equipmentTagNumber: DUPLICATE_TAGS[n] } : {}),
      // Both are recomputed from the store (verification marks, rule results) once it is built.
      verificationPct: 0,
      invalidRuleCount: 0,
    });
  });
}

// ---------------------------------------------------------------- requests

/** What a request proposes for a heater's field: a value that differs from the current one. */
function proposal(h: SearchRow, code: string): string {
  switch (code) {
    case 'MANUFACTURER':
      return MAKERS[(MAKERS.indexOf(h.manufacturer ?? '') + 1) % MAKERS.length];
    case 'MODEL_NUMBER':
      return 'SYN-MODEL-9';
    case 'SERIAL_NUMBER':
      return `${h.manufacturerSerialNumber ?? 'SYN-SN'}-A`;
    case 'HEAT_DUTY':
      return ((h.heatDutyMmbtuHr ?? 2) + 0.6).toFixed(4);
    default:
      return 'SYN-VALUE';
  }
}

const PERSON_FIELDS = ['MANUFACTURER', 'MODEL_NUMBER', 'SERIAL_NUMBER', 'HEAT_DUTY'] as const;

function buildRequests(heaters: SearchRow[]): QueueRow[] {
  const carlsbad = heaters.filter((h) => h.profitCenterName === 'OP RES DB NM');
  const elsewhere = heaters.filter((h) => h.profitCenterName !== 'OP RES DB NM');
  const unfired = heaters.filter((h) => h.firedUnfired === 'UNFIRED');

  // 1-8 wait for the responsible stage, 9-12 for the accountable stage, 13-14 are returned to the field
  // lead, 15-20 approved, 21-22 rejected. Every fourth came from the rule HEATER_CLASS_FIRED.
  const statusOf = (n: number): [string, string | null] =>
    n <= 8 ? ['PENDING_RESPONSIBLE', 'RESPONSIBLE']
    : n <= 12 ? ['PENDING_ACCOUNTABLE', 'ACCOUNTABLE']
    : n <= 14 ? ['RETURNED', null]
    : n <= 20 ? ['APPROVED', null]
    : ['REJECTED', null];

  return Array.from({ length: 22 }, (_, i) => {
    const n = i + 1;
    const fromRule = n % 4 === 0;
    const pool = fromRule ? unfired : n % 2 === 1 ? carlsbad : elsewhere;
    const h = fromRule ? pool[((n / 4) * 2) % pool.length] : pool[(n * 5) % pool.length];
    const [requestStatus, approvalStage] = statusOf(n);
    const fieldCode = fromRule ? 'FIRED_UNFIRED' : PERSON_FIELDS[n % PERSON_FIELDS.length];
    const fromField = !fromRule && n % 2 === 1;
    const returned = requestStatus === 'RETURNED';
    const requestedBy = fromRule ? RULE_ENGINE : returned || n % 3 === 0 ? FIELD_EMAIL : n % 3 === 1 ? 'casey.morgan@example.test' : 'pat.nguyen@example.test';
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
      fieldLabel: labelOf(fieldCode),
      sapField: fieldOf(fieldCode)?.sapField ?? null,
      oldValue: fieldValueOf(h, fieldCode),
      newValue: fromRule ? 'FIRED' : proposal(h, fieldCode),
      reason: fromRule ? null : fromField ? 'Nameplate photo shows a different value' : 'Corrected from the data sheet',
      note: fromRule ? 'TBD' : null,
      sourceType: fromRule ? 'BUSINESS_RULE' : fromField ? 'FIELD' : 'MANUAL',
      sourceRuleId: fromRule ? 'HEATER_CLASS_FIRED' : null,
      sourceRuleVersion: fromRule ? 1 : null,
      sourceLabel: fromRule ? 'Rule HEATER_CLASS_FIRED v1' : fromField ? 'Field submission' : 'Manual request',
      requestedBy,
      requestedAtUtc: hoursAgo(age),
      detectedAtUtc: fromRule ? hoursAgo(age + 1) : null,
      responsibleGroup: responsibleGroupFor(h.profitCenterName),
      accountableGroup: ACCOUNTABLE_GROUP,
      returnRecipientType: returned ? 'USER' : null,
      returnRecipient: returned ? FIELD_EMAIL : null,
      ageHours: age,
      photoCount: fromField ? 1 + (n % 2) : 0,
      updatedAtUtc: hoursAgo(age / 2),
      canApprove: requestStatus.startsWith('PENDING'),
    });
  });
}

// ---------------------------------------------------------------- notifications

export interface DemoNotification {
  notificationId: number;
  /** An e-mail, or `group:<name>` for every member of a group. */
  to: string;
  topic: string;
  requestId: number | null;
  requestRef: string | null;
  title: string;
  body: string;
  createdAtUtc: string;
  /** Who has read it; `*` = everyone (the old ones). */
  readBy: string[];
}

// ---------------------------------------------------------------- the state

/** The latest mark of one field of one heater (`app.vw_field_verification_latest`). */
export interface DemoMark {
  mark: Mark;
  by: string;
  atUtc: string;
  comment: string | null;
}

export interface DemoState {
  heaters: SearchRow[];
  requests: QueueRow[];
  events: Map<number, EventRow[]>;
  notifications: DemoNotification[];
  /** Every version of every rule. */
  ruleVersions: RuleVersion[];
  /** Newest first. */
  runs: RuleRun[];
  /** Latest result per heater × published rule (`app.vw_equipment_rule_status`). */
  ruleResults: Map<number, RuleStatusRow[]>;
  /** The last test of each draft, by `ruleId|version`, with the fingerprint of what was tested. */
  tests: Map<string, { result: RuleTestResult; hash: string }>;
  /** Latest mark per heater, then per field. */
  marks: Map<number, Map<string, DemoMark>>;
  photos: PhotoRow[];
  /** Field forms sent from S-6, newest last (TrueContext order; includes the recorded-only corrections). */
  fieldForms: (FieldFormSubmit & { referenceNumber: string; by: string; atUtc: string })[];
  /** S-13 Admin: the page's own copy (user decision of 20 Nov: member edits do not change routing or queues). */
  admin: { members: Record<string, Member[]>; routes: RouteRow[]; dropdowns: DropdownRow[]; mandatory: string[] };
  nextRequestId: number;
  nextEventId: number;
  nextNotificationId: number;
  nextRunId: number;
  nextPhotoId: number;
}

let state: DemoState = initialState();

export function demo(): DemoState {
  return state;
}

/** Back to the starting data; the persona stays (the presenter chose it). The header's Reset demo calls this. */
export function resetDemo(): void {
  state = initialState();
}

/** Back to the starting data and the default persona (tests). */
export function resetDemoAndPersona(): void {
  setPersona(DEFAULT_PERSONA);
  resetDemo();
}

function initialAdmin(): DemoState['admin'] {
  const members: Record<string, Member[]> = {};
  for (const p of people()) for (const g of p.groups) (members[g] ??= []).push({ email: p.email, displayName: p.displayName });
  return {
    members,
    routes: ROUTES.map((r) => ({ ...r, classes: [...r.classes] })),
    dropdowns: ALLOWED_VALUES.map((a) => ({ ...a, active: true })),
    mandatory: [],
  };
}

/** The drop-down values of a field that are switched on (S-13 can add values and switch them off). */
export function activeValues(fieldCode: string, s: DemoState = state): string[] {
  return s.admin.dropdowns
    .filter((d) => d.fieldCode === fieldCode && d.active)
    .sort((a, b) => a.order - b.order)
    .map((d) => d.value);
}

function initialState(): DemoState {
  const heaters = buildHeaters();
  const requests = buildRequests(heaters);
  const s: DemoState = {
    heaters,
    requests,
    events: new Map(),
    notifications: [],
    ruleVersions: [],
    runs: [],
    ruleResults: new Map(),
    tests: new Map(),
    marks: new Map(),
    photos: [],
    fieldForms: [],
    admin: initialAdmin(),
    nextRequestId: 100,
    nextEventId: 1,
    nextNotificationId: 1,
    nextRunId: 1,
    nextPhotoId: 1,
  };
  for (const r of requests) seedHistory(s, r);
  s.notifications.sort((a, b) => a.createdAtUtc.localeCompare(b.createdAtUtc));
  // The golden record already holds the changes approved before the demo starts.
  for (const r of requests) {
    const h = heaters.find((x) => x.equipmentId === r.equipmentId);
    if (r.requestStatus === 'APPROVED' && h && r.fieldCode) {
      setFieldValue(h, r.fieldCode, r.newValue);
      h.goldenVersionId = (h.goldenVersionId ?? 1) + 1;
      h.lastChangedAtUtc = r.updatedAtUtc;
    }
  }
  seedPhotos(s);
  seedMarks(s);
  seedRules(s);
  for (const h of heaters) refreshHeater(s, h);
  return s;
}

/** Photos for the field requests that say they have some (sample images, Q-418). */
function seedPhotos(s: DemoState): void {
  for (const r of s.requests) {
    const types = (['NAMEPLATE', 'OVERALL'] as const).slice(0, r.photoCount ?? 0);
    for (const photoType of types) {
      const image = sampleImage(photoType);
      s.photos.push({
        fileId: s.nextPhotoId++,
        equipmentId: r.equipmentId ?? 0,
        requestIds: [r.requestId],
        photoType,
        fileName: image.fileName,
        uploadedBy: r.requestedBy,
        uploadedAtUtc: r.requestedAtUtc ?? nowIso(),
        url: image.url,
        isSample: true,
      });
    }
  }
}

/** Earlier field visits: heater n has its first (n mod 6) key fields verified, so the % spreads from 0 to 100. */
function seedMarks(s: DemoState): void {
  const keys = CATALOG.filter((c) => c.isKey).map((c) => c.fieldCode);
  for (const h of s.heaters) {
    const n = h.equipmentId;
    const verified = n % 6;
    const byField = new Map<string, DemoMark>();
    const by = n % 2 === 0 ? FIELD_EMAIL : 'casey.morgan@example.test';
    const at = hoursAgo(24 * ((n % 20) + 2));
    keys.slice(0, verified).forEach((code) => byField.set(code, { mark: 'VERIFIED_CORRECT', by, atUtc: at, comment: null }));
    if (verified < keys.length && n % 4 === 0) {
      byField.set(keys[verified], { mark: 'DID_NOT_VERIFY', by, atUtc: at, comment: 'Nameplate painted over' });
    }
    if (byField.size > 0) s.marks.set(n, byField);
  }
}

/** The ten client rules as versions, two earlier scheduled runs, and the results of the latest one. */
function seedRules(s: DemoState): void {
  const created = hoursAgo(24 * 12);
  const published = hoursAgo(24 * 10);
  for (const rule of SAMPLE_RULES) {
    const isPublished = rule.start === 'PUBLISHED';
    s.ruleVersions.push({
      ruleId: rule.ruleId,
      version: 1,
      status: isPublished ? 'PUBLISHED' : 'DRAFT',
      ruleName: rule.ruleName,
      description: rule.description,
      queryLanguage: 'TSQL',
      executionTarget: rule.executionTarget,
      queryText: rule.queryText,
      routingMode: rule.routingMode,
      resolutionGroup: rule.editorGroup,
      editorGroup: rule.editorGroup,
      responsibleGroup: rule.responsibleGroup,
      accountableGroup: rule.accountableGroup,
      allowedTargets: rule.allowedTargets,
      applicability: rule.applicability,
      effectiveFromUtc: isPublished ? published : null,
      effectiveToUtc: null,
      // The workbook's version_change_reason; the two rules the demo starts as published need one to have been published.
      changeReason: rule.changeReason || (isPublished ? 'First version, agreed with the data owner (sample).' : ''),
      testStatus: isPublished ? 'PASSED' : 'NOT_TESTED',
      testedAtUtc: isPublished ? published : null,
      testedBy: isPublished ? 'morgan.diaz@example.test' : null,
      publishedBy: isPublished ? 'jordan.lee@example.test' : null,
      publishedAtUtc: isPublished ? published : null,
      createdBy: 'morgan.diaz@example.test',
      updatedAtUtc: isPublished ? published : created,
    });
  }
  // Two nightly runs: the first raised the rule requests the demo starts with; the second found them open.
  const openRuleRequests = s.requests.filter((r) => r.sourceRuleId && isOpen(r)).length;
  const raised = s.requests.filter((r) => r.sourceRuleId).length;
  const at = (days: number) => hoursAgo(24 * days);
  const lines = (created: number, suppressed: number) =>
    publishedVersions(s).map((v) => {
      const found = sampleRule(v.ruleId)?.evaluate(s.heaters, false).length ?? 0;
      const auto = v.routingMode === 'AUTO_ROUTE';
      return { ruleId: v.ruleId, version: v.version, status: 'SUCCEEDED' as const, checked: s.heaters.length, invalid: found, requestsCreated: auto ? created : 0, requestsSuppressed: auto ? suppressed : 0, message: null };
    });
  s.runs.push({ runId: s.nextRunId++, trigger: 'SCHEDULED', startedAtUtc: at(2), finishedAtUtc: at(2), startedBy: 'system:nightly', status: 'SUCCEEDED', lines: lines(raised, 0) });
  s.runs.unshift({ runId: s.nextRunId++, trigger: 'SCHEDULED', startedAtUtc: at(1), finishedAtUtc: at(1), startedBy: 'system:nightly', status: 'SUCCEEDED', lines: lines(0, openRuleRequests) });
  storeResults(s, at(1));
}

/** A function declaration on purpose: it runs while the starting state is built, before later constants exist. */
export function publishedVersions(s: DemoState = state): RuleVersion[] {
  return s.ruleVersions.filter((v) => v.status === 'PUBLISHED');
}

/** Replaces every heater's rule results with what the published rules find now. */
export function storeResults(s: DemoState, atUtc: string): void {
  s.ruleResults = new Map();
  for (const v of publishedVersions(s)) {
    const rule = sampleRule(v.ruleId);
    if (!rule) continue;
    const found = new Map<number, Violation>();
    for (const x of rule.evaluate(s.heaters, hasGroupBy(v.queryText))) if (!found.has(x.equipmentId)) found.set(x.equipmentId, x);
    for (const h of s.heaters) {
      if (!v.applicability.includes(h.equipClass ?? '')) continue;
      const hit = found.get(h.equipmentId);
      const row: RuleStatusRow = {
        ruleId: v.ruleId,
        ruleName: v.ruleName,
        version: v.version,
        routingMode: v.routingMode,
        result: hit ? 'INVALID' : 'VALID',
        message: hit?.violation ?? null,
        fieldCode: hit ? (hit.fieldCode ?? v.allowedTargets[0] ?? null) : null,
        proposedValue: hit?.proposedValue ?? null,
        detectedAtUtc: atUtc,
      };
      s.ruleResults.set(h.equipmentId, [...(s.ruleResults.get(h.equipmentId) ?? []), row]);
    }
  }
  for (const h of s.heaters) refreshHeater(s, h);
}

/** Verified key fields of a heater, out of the key fields (WA-07). */
export function verificationOf(equipmentId: number, s: DemoState = state): { verified: number; keys: number; pct: number } {
  const keys = CATALOG.filter((c) => c.isKey);
  const marks = s.marks.get(equipmentId);
  const verified = keys.filter((k) => marks?.get(k.fieldCode)?.mark === 'VERIFIED_CORRECT').length;
  return { verified, keys: keys.length, pct: keys.length === 0 ? 0 : Math.round((verified / keys.length) * 1000) / 10 };
}

/** Keeps the numbers the search list shows (verification %, Invalid count) in step with the store. */
export function refreshHeater(s: DemoState, h: SearchRow): void {
  const row = h as unknown as Record<string, unknown>;
  row['verificationPct'] = verificationOf(h.equipmentId, s).pct;
  row['invalidRuleCount'] = (s.ruleResults.get(h.equipmentId) ?? []).filter((r) => r.result === 'INVALID').length;
}

export interface NewRequest {
  heater: SearchRow;
  fieldCode: string;
  oldValue: string | null;
  newValue: string;
  reason: string | null;
  sourceType: 'MANUAL' | 'FIELD' | 'BUSINESS_RULE';
  requestedBy: string;
  ruleId?: string;
  ruleVersion?: number;
  note?: string | null;
  photoCount?: number;
}

/**
 * The one door into the workflow, as `app.usp_request_create` (contract `01` §6.3): an open request with the
 * same value suppresses the new one, a different value on the same field blocks it; otherwise it is routed,
 * gets its CREATED event and tells the responsible group.
 */
export function createRequest(input: NewRequest): { outcome: 'CREATED' | 'DUPLICATE_SUPPRESSED' | 'BLOCKED_INCOMPATIBLE'; row: QueueRow } {
  const h = input.heater;
  const open = state.requests.find((r) => r.equipmentId === h.equipmentId && r.fieldCode === input.fieldCode && isOpen(r));
  if (open) return { outcome: open.newValue === input.newValue ? 'DUPLICATE_SUPPRESSED' : 'BLOCKED_INCOMPATIBLE', row: open };
  const n = state.nextRequestId++;
  const fromRule = input.sourceType === 'BUSINESS_RULE';
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
    reason: input.reason,
    note: input.note ?? null,
    sourceType: input.sourceType,
    sourceRuleId: input.ruleId ?? null,
    sourceRuleVersion: input.ruleVersion ?? null,
    sourceLabel: fromRule ? `Rule ${input.ruleId ?? ''} v${input.ruleVersion ?? 1}` : input.sourceType === 'FIELD' ? 'Field submission' : 'Manual request',
    requestedBy: input.requestedBy,
    requestedAtUtc: nowIso(),
    detectedAtUtc: fromRule ? nowIso() : null,
    responsibleGroup: responsibleGroupFor(h.profitCenterName),
    accountableGroup: ACCOUNTABLE_GROUP,
    ageHours: 0,
    photoCount: input.photoCount ?? 0,
    updatedAtUtc: nowIso(),
    canApprove: true,
  });
  state.requests.unshift(row);
  addEvent(n, { eventType: 'CREATED', actor: input.requestedBy, comments: input.reason, statusTo: 'PENDING_RESPONSIBLE' });
  notify(row, `group:${row.responsibleGroup}`, 'REQUEST_PENDING_RESPONSIBLE', 'A request is waiting for you');
  return { outcome: 'CREATED', row };
}

/** A plausible history and the notifications it would have sent, for a starting request. */
function seedHistory(s: DemoState, r: QueueRow): void {
  const at = (fraction: number) => new Date(Date.parse(r.requestedAtUtc ?? nowIso()) + (r.ageHours ?? 1) * 3_600_000 * fraction).toISOString();
  const stage1 = membersOf(r.responsibleGroup)[0];
  const stage1Actor = stage1?.email ?? ADMIN_EMAIL;
  const add = (over: Partial<EventRow>) => {
    const list = s.events.get(r.requestId) ?? [];
    list.push(eventRowOf(s.nextEventId++, over));
    s.events.set(r.requestId, list);
  };
  // Messages about requests still waiting stay unread; the ones about closed requests were read long ago.
  const tell = (to: string, topic: string, title: string, when: string) =>
    s.notifications.push(notificationOf(s.nextNotificationId++, r, to, topic, title, when, isOpen(r) ? [] : ['*']));

  add({ eventType: 'CREATED', actor: r.requestedBy, occurredAtUtc: r.requestedAtUtc ?? nowIso(), comments: r.reason, statusTo: 'PENDING_RESPONSIBLE' });
  const decided = { approvalStage: 'RESPONSIBLE', actor: stage1Actor, actorGroup: r.responsibleGroup, decidedAs: stage1 ? 'GROUP_MEMBER' : 'ADMIN', statusFrom: 'PENDING_RESPONSIBLE' };
  switch (r.requestStatus) {
    case 'PENDING_RESPONSIBLE':
      tell(`group:${r.responsibleGroup}`, 'REQUEST_PENDING_RESPONSIBLE', 'A request is waiting for you', r.requestedAtUtc ?? nowIso());
      break;
    case 'PENDING_ACCOUNTABLE':
      add({ ...decided, eventType: 'RESPONSIBLE_APPROVED', occurredAtUtc: at(0.5), comments: null, statusTo: 'PENDING_ACCOUNTABLE' });
      tell(`group:${ACCOUNTABLE_GROUP}`, 'REQUEST_PENDING_ACCOUNTABLE', 'A request is waiting for your final approval', at(0.5));
      break;
    case 'APPROVED':
      add({ ...decided, eventType: 'RESPONSIBLE_APPROVED', occurredAtUtc: at(0.3), comments: null, statusTo: 'PENDING_ACCOUNTABLE' });
      add({ eventType: 'ACCOUNTABLE_APPROVED', approvalStage: 'ACCOUNTABLE', actor: 'jordan.lee@example.test', actorGroup: ACCOUNTABLE_GROUP, decidedAs: 'GROUP_MEMBER', occurredAtUtc: at(0.5), comments: null, statusFrom: 'PENDING_ACCOUNTABLE', statusTo: 'APPROVED' });
      add({ eventType: 'MERGED', actor: 'system:merge', occurredAtUtc: at(0.5), comments: 'The golden record was updated.', statusFrom: 'APPROVED', statusTo: 'APPROVED' });
      if (!r.requestedBy.startsWith('system:')) tell(r.requestedBy, 'REQUEST_APPROVED', 'Your request was approved', at(0.5));
      break;
    case 'RETURNED':
      add({ ...decided, eventType: 'RETURNED', occurredAtUtc: at(0.5), comments: 'Please add a photo of the nameplate.', statusTo: 'RETURNED', returnedTo: r.returnRecipient });
      tell(r.returnRecipient ?? r.requestedBy, 'REQUEST_RETURNED', 'A request was returned to you', at(0.5));
      break;
    case 'REJECTED':
      add({ ...decided, eventType: 'REJECTED', occurredAtUtc: at(0.5), comments: 'The data sheet shows the current value is right.', statusTo: 'REJECTED' });
      if (!r.requestedBy.startsWith('system:')) tell(r.requestedBy, 'REQUEST_REJECTED', 'Your request was rejected', at(0.5));
      break;
  }
}

function eventRowOf(eventId: number, over: Partial<EventRow>): EventRow {
  return {
    eventId,
    eventType: 'COMMENTED',
    approvalStage: null,
    actor: me(),
    actorGroup: null,
    occurredAtUtc: nowIso(),
    comments: null,
    statusFrom: null,
    statusTo: null,
    decidedAs: null,
    samePersonBothStages: false,
    returnedTo: null,
    ...over,
  };
}

function notificationOf(id: number, r: QueueRow, to: string, topic: string, title: string, createdAtUtc: string, readBy: string[]): DemoNotification {
  const where = [r.equipmentTagNumber, r.profitCenterName].filter(Boolean).join(', ');
  return {
    notificationId: id,
    to,
    topic,
    requestId: r.requestId,
    requestRef: r.requestRef,
    title,
    body: `${r.requestRef}: ${r.fieldLabel ?? r.fieldCode} ${r.oldValue ?? '(empty)'} → ${r.newValue ?? '(empty)'}${where ? ` (${where})` : ''}.`,
    createdAtUtc,
    readBy,
  };
}

// ---------------------------------------------------------------- writes used by the handlers

export function eventsOf(requestId: number): EventRow[] {
  return state.events.get(requestId) ?? [];
}

export function addEvent(requestId: number, over: Partial<EventRow>): EventRow {
  const row = eventRowOf(state.nextEventId++, over);
  state.events.set(requestId, [...eventsOf(requestId), row]);
  return row;
}

/** Queues an in-app notification, unless it would go to the person who caused it. */
export function notify(r: QueueRow, to: string, topic: string, title: string): void {
  if (to === me() || to.startsWith('system:')) return;
  state.notifications.push(notificationOf(state.nextNotificationId++, r, to, topic, title, nowIso(), []));
}

/** A person's notifications, newest first: the ones sent to them and to their groups. */
export function inboxOf(p: Persona = currentPersona()): DemoNotification[] {
  return state.notifications
    .filter((n) => n.to === p.email || (n.to.startsWith('group:') && p.groups.includes(n.to.slice('group:'.length))))
    .sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc));
}

export const isReadBy = (n: DemoNotification, email: string): boolean => n.readBy.includes('*') || n.readBy.includes(email);

// ---------------------------------------------------------------- who may decide

export interface Eligibility {
  ok: boolean;
  reason: string | null;
  decidedAs: 'GROUP_MEMBER' | 'ADMIN' | null;
}

/**
 * May this persona decide the stage the request is waiting for? A member of the routed group whose role
 * has the stage permission may; an admin may decide any stage (D-20, 18 Nov). Simplified from the server.
 */
export function eligibility(r: QueueRow, p: Persona = currentPersona()): Eligibility {
  if (!r.requestStatus.startsWith('PENDING')) return { ok: false, reason: 'This request is not waiting for a decision.', decidedAs: null };
  const responsible = r.requestStatus === 'PENDING_RESPONSIBLE';
  const group = responsible ? r.responsibleGroup : r.accountableGroup;
  const hasFlag = responsible ? p.canResponsibleApprove : p.canAccountableApprove;
  if (hasFlag && group && p.groups.includes(group)) return { ok: true, reason: null, decidedAs: 'GROUP_MEMBER' };
  if (p.canManageAdmin) return { ok: true, reason: null, decidedAs: 'ADMIN' };
  return { ok: false, reason: `Only members of ${group ?? 'the routed group'} (or an admin) can decide this stage.`, decidedAs: null };
}
