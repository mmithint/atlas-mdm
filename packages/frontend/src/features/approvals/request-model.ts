/**
 * What the request-detail screen (S-3) says, as plain functions so each sentence can be tested on its own.
 *
 * Nothing here decides anything. Who may approve, which checks pass and what the golden record holds are
 * all answered by T-SQL (the procedures behind `getRequestDetail`); this file only turns those answers
 * into words and groups. The one derivation that looks like a rule, "a failed check blocks approval",
 * only EXPLAINS what `app.usp_request_decide` enforces (50144) so a disabled button is never silent.
 */
import { BLANK, isBlank } from '@/lib/format';

/** The four badges of `components/ui.ts` plus a red one for a closed-without-change status or a failed check. */
export type BadgeKind = 'neutral' | 'warning' | 'success' | 'info' | 'danger';

export interface StatusDisplay {
  text: string;
  kind: BadgeKind;
}

const STATUS: Readonly<Record<string, StatusDisplay>> = {
  DRAFT: { text: 'Draft', kind: 'neutral' },
  PENDING_RESPONSIBLE: { text: 'Waiting for responsible approval', kind: 'warning' },
  PENDING_ACCOUNTABLE: { text: 'Waiting for accountable approval', kind: 'warning' },
  RETURNED: { text: 'Returned for correction', kind: 'info' },
  APPROVED: { text: 'Approved', kind: 'success' },
  REJECTED: { text: 'Rejected', kind: 'danger' },
  CANCELLED: { text: 'Withdrawn', kind: 'neutral' },
};

const readable = (code: string): string => code.toLowerCase().replace(/_/g, ' ');

/** A request status in words, with the badge it gets. An unknown status is shown as its own words, never hidden. */
export function statusDisplay(status: string): StatusDisplay {
  return STATUS[status] ?? { text: readable(status), kind: 'neutral' };
}

/** A closed request: no decision is expected any more. */
export const isClosed = (status: string): boolean => status === 'APPROVED' || status === 'REJECTED' || status === 'CANCELLED';

const EVENT: Readonly<Record<string, string>> = {
  CREATED: 'Request created',
  RESPONSIBLE_APPROVED: 'Approved by the responsible stage',
  ACCOUNTABLE_APPROVED: 'Approved by the accountable stage',
  REJECTED: 'Rejected',
  RETURNED: 'Returned for correction',
  RESUBMITTED: 'Resubmitted',
  CANCELLED: 'Withdrawn',
  COMMENTED: 'Note',
  MERGED: 'Applied to the golden record',
  MERGE_STALE: 'Not applied: the value had changed',
  EXPORTED: 'Exported for SAP',
};

export function eventLabel(type: string): string {
  return EVENT[type] ?? readable(type);
}

/** `system:rule-run` and friends are not people; say what they are. A person's address is shown as it is. */
export function actorText(actor: string | null | undefined): string {
  if (isBlank(actor)) return BLANK;
  const name = String(actor);
  if (!name.startsWith('system:')) return name;
  switch (name.slice('system:'.length)) {
    case 'rule-run':
      return 'Rule run (system)';
    case 'de':
      return 'Data engineering import (system)';
    case 'merge':
      return 'Golden record update (system)';
    default:
      return 'System';
  }
}

// ---- the approval checks -------------------------------------------------------

export interface CheckLike {
  code: string;
  checkStatus: string;
  message: string;
}

const CHECK: Readonly<Record<string, string>> = {
  ASSOCIATION_MATCH: 'Heater is still at the same location (FLOC)',
  OLD_VALUE_CURRENT: 'Golden value is still the one the requester saw',
  VALUE_ALLOWED: 'Proposed value is allowed',
  UNITS_EXPLICIT: 'Unit is stated for a numeric field',
  NO_CONFLICTING_OPEN_REQUEST: 'No other open request proposes something different',
  USER_ELIGIBLE_FOR_STAGE: 'You may decide this stage',
};

export function checkLabel(code: string): string {
  return CHECK[code] ?? readable(code);
}

/**
 * The checks that stop an approval (the first five). The sixth, who may decide, is answered by `viewer`; the
 * procedure keeps it apart from these because it refuses with its own message (50141 to 50143).
 */
const BLOCKING_CHECKS: readonly string[] = [
  'ASSOCIATION_MATCH',
  'OLD_VALUE_CURRENT',
  'VALUE_ALLOWED',
  'UNITS_EXPLICIT',
  'NO_CONFLICTING_OPEN_REQUEST',
];

/** Codes of the failed checks that block an approval; empty when nothing blocks it. */
export function approvalBlockers(checks: readonly CheckLike[]): string[] {
  return checks.filter((c) => c.checkStatus === 'FAIL' && BLOCKING_CHECKS.includes(c.code)).map((c) => c.code);
}

/** The server's own words when the golden value is no longer the one the requester saw; null otherwise. */
export function oldValueMismatch(checks: readonly CheckLike[]): string | null {
  const row = checks.find((c) => c.code === 'OLD_VALUE_CURRENT' && c.checkStatus === 'FAIL');
  return row ? row.message : null;
}

export interface CheckSummary {
  pass: number;
  fail: number;
  notChecked: number;
}

export function summarizeChecks(checks: readonly CheckLike[]): CheckSummary {
  return {
    pass: checks.filter((c) => c.checkStatus === 'PASS').length,
    fail: checks.filter((c) => c.checkStatus === 'FAIL').length,
    notChecked: checks.filter((c) => c.checkStatus !== 'PASS' && c.checkStatus !== 'FAIL').length,
  };
}

export function checkBadge(status: string): StatusDisplay {
  if (status === 'PASS') return { text: 'Pass', kind: 'success' };
  if (status === 'FAIL') return { text: 'Fail', kind: 'danger' };
  return { text: 'Not checked', kind: 'neutral' };
}

// ---- the evidence snapshot -----------------------------------------------------

/** Longest raw text or single value shown; the snapshot can hold whatever a rule or a person attached. */
const CLIP = 600;
const VALUE_CLIP = 300;
const MAX_ITEMS = 30;

export const clip = (text: string, max = CLIP): string => (text.length > max ? `${text.slice(0, max)}…` : text);

export interface EvidenceFacts {
  sourceType: string | null;
  entityType: string | null;
  entityKey: string | null;
  routeUsed: string | null;
  goldenVersionId: string | null;
  baselineAsOfUtc: string | null;
}

export interface EvidenceItem {
  key: string;
  value: string;
}

export type ParsedEvidence =
  | { kind: 'none' }
  | { kind: 'snapshot'; facts: EvidenceFacts; items: EvidenceItem[]; itemsClipped: boolean }
  | { kind: 'raw'; text: string };

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function scalar(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function itemValue(v: unknown): string {
  if (v === null || v === undefined) return BLANK;
  if (typeof v === 'string') return v.trim() === '' ? BLANK : clip(v, VALUE_CLIP);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return clip(JSON.stringify(v) ?? BLANK, VALUE_CLIP);
}

/**
 * Reads the evidence snapshot kept on the CREATED event (shape: db/procs/usp_request_evidence.sql). Defensive on
 * purpose: the `evidence` part is whatever the caller sent, so anything that is not the documented shape is shown
 * as clipped raw text instead of breaking the page.
 */
export function parseEvidence(detailsJson: string | null | undefined): ParsedEvidence {
  if (detailsJson === null || detailsJson === undefined || detailsJson.trim() === '') return { kind: 'none' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(detailsJson);
  } catch {
    return { kind: 'raw', text: clip(detailsJson) };
  }
  if (!isPlainObject(parsed)) return { kind: 'raw', text: clip(detailsJson) };

  const facts: EvidenceFacts = {
    sourceType: scalar(parsed['source_type']),
    entityType: scalar(parsed['entity_type']),
    entityKey: scalar(parsed['entity_key']),
    routeUsed: scalar(parsed['route_used']),
    goldenVersionId: scalar(parsed['golden_version_id']),
    baselineAsOfUtc: scalar(parsed['baseline_as_of_utc']),
  };

  const evidence = parsed['evidence'];
  let entries: [string, unknown][] = [];
  if (isPlainObject(evidence)) entries = Object.entries(evidence);
  else if (evidence !== undefined && evidence !== null) entries = [['evidence', evidence]];

  return {
    kind: 'snapshot',
    facts,
    items: entries.slice(0, MAX_ITEMS).map(([key, value]) => ({ key: readable(key), value: itemValue(value) })),
    itemsClipped: entries.length > MAX_ITEMS,
  };
}

// ---- the merge into the golden record ------------------------------------------

export interface MergeWording {
  tone: 'success' | 'warning' | 'neutral';
  text: string;
}

/**
 * The outcome of the merge into gold in words. `outcome` is the merge's own word (APPLIED, ALREADY_APPLIED, STALE,
 * ERROR, NOT_ELIGIBLE) or null when none was tried yet. An approval is never undone by a merge problem, so the wording
 * for a problem says the approval stands.
 */
export function mergeWording(outcome: string | null | undefined, message?: string | null): MergeWording {
  const note = isBlank(message) ? '' : `: ${String(message).replace(/[.\s]+$/, '')}`;
  switch (outcome) {
    case 'APPLIED':
    case 'ALREADY_APPLIED':
      return { tone: 'success', text: 'In the golden record.' };
    case 'STALE':
      return { tone: 'warning', text: 'Not applied: the golden value changed after the request was raised. The approval stands.' };
    case 'ERROR':
    case 'NOT_ELIGIBLE':
      return { tone: 'warning', text: `Golden record update pending${note}. The approval stands.` };
    default:
      return { tone: 'neutral', text: 'Not applied yet.' };
  }
}

export interface MergeInfo {
  outcome: string;
  message: string | null;
  error: string | null;
}

export interface DecisionInfo {
  requestRef: string | null;
  newStatus: string | null;
  needsMerge: boolean;
  merge: MergeInfo | null;
}

export interface ResultBanner {
  tone: 'success' | 'warning';
  title: string;
  detail: string | null;
}

const DECIDED_TITLE: Readonly<Record<string, string>> = {
  PENDING_ACCOUNTABLE: 'Approved at the responsible stage. It now waits for the accountable stage.',
  APPROVED: 'Approved by both stages.',
  REJECTED: 'Rejected. The request is closed.',
  RETURNED: 'Returned for correction.',
};

/** What to tell the person after a decision went through. A merge problem turns the banner into a warning. */
export function decisionBanner(answer: DecisionInfo): ResultBanner {
  const ref = answer.requestRef ?? 'The request';
  const status = answer.newStatus ?? '';
  const title = `${ref}: ${DECIDED_TITLE[status] ?? `now ${statusDisplay(status).text.toLowerCase()}.`}`;
  if (!answer.needsMerge) return { tone: 'success', title, detail: null };

  const merge = answer.merge;
  if (merge === null) {
    return { tone: 'warning', title, detail: 'The approval stands, but the golden record update could not be started.' };
  }
  if (merge.error !== null) {
    return { tone: 'warning', title, detail: `The approval stands, but the golden record update could not be completed: ${merge.error}` };
  }
  const wording = mergeWording(merge.outcome, merge.message);
  return wording.tone === 'success'
    ? { tone: 'success', title, detail: 'The golden record was updated.' }
    : { tone: 'warning', title, detail: wording.text };
}

export function withdrawBanner(requestRef: string | null): ResultBanner {
  return { tone: 'success', title: `${requestRef ?? 'The request'} was withdrawn. It is closed and stays in the history.`, detail: null };
}

// ---- small wording helpers -------------------------------------------------------

/** "Who a Return goes to by default", as the confirm dialog says it (the person may pick another: `candidateText`). */
export function returnTarget(viewer: { returnToType: string | null; returnTo: string | null; returnToLabel: string | null }): string | null {
  const who = !isBlank(viewer.returnToLabel) ? viewer.returnToLabel : viewer.returnTo;
  if (isBlank(who)) return null;
  const kind = viewer.returnToType === 'GROUP' ? 'group' : viewer.returnToType === 'USER' ? 'person' : null;
  return kind ? `${who} (${kind})` : String(who);
}

const RELATION_TEXT: Record<string, string> = {
  SUBMITTER: 'raised it',
  RESPONSIBLE_GROUP: 'responsible group',
  ACCOUNTABLE_GROUP: 'accountable group',
  YOU: 'you',
};

/** One entry of the Return picker: "T3 accountable (accountable group)", "T3 responsible (responsible group, you)". */
export function candidateText(c: { displayName: string; email: string; relation: string; isYou: boolean }): string {
  const name = isBlank(c.displayName) ? c.email : c.displayName;
  const why = RELATION_TEXT[c.relation] ?? c.relation.toLowerCase();
  return c.isYou && c.relation !== 'YOU' ? `${name} (${why}, you)` : `${name} (${why})`;
}

/** A value with its unit; a blank stays blank, never zero (REF-13 to 21 analysis). */
export function valueText(value: string | null | undefined, unit?: string | null): string {
  if (isBlank(value)) return BLANK;
  return isBlank(unit) ? String(value) : `${value} ${unit}`;
}

/** Hours open as people say it. */
export function ageText(hours: number | null | undefined): string | null {
  if (hours === null || hours === undefined || hours < 0) return null;
  if (hours < 1) return 'less than an hour';
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return `${Math.floor(hours / 24)} days`;
}

/** What the request changes, in one phrase for the page title: "Manufacturer on SYN-TAG-0001". */
export function requestTitle(request: {
  fieldLabel: string | null;
  fieldCode: string | null;
  equipmentTagNumber: string | null;
  equipmentNumber: string | null;
  functionalLocation: string | null;
}): string {
  const field = request.fieldLabel || request.fieldCode || 'Change';
  const subject = request.equipmentTagNumber || request.equipmentNumber || request.functionalLocation;
  return subject ? `${field} on ${subject}` : field;
}

/** The route that was applied, in one line. */
export function describeRoute(route: {
  routeId: number;
  entityType: string;
  requestAction: string;
  fieldOrCharacteristic: string;
  classScope: string;
}): string {
  const field = route.fieldOrCharacteristic === '*' ? 'any field' : `field ${route.fieldOrCharacteristic}`;
  const classes = route.classScope === 'ANY' ? 'any class' : 'listed classes only';
  return `Route ${route.routeId}: ${readable(route.entityType)} ${readable(route.requestAction)}, ${field}, ${classes}`;
}
