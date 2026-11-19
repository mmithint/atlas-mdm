/**
 * The request write path's functions (APP-3; FINAL PLAN/01 section 2.2 and 6.8, 03 APP-3 step 7).
 *
 *   createChangeRequest  -> app.usp_request_create
 *   decideRequest        -> app.usp_request_decide, then (after a final approval) the merge into gold
 *                           gold.usp_apply_approved_change and app.usp_request_record_merge
 *   bulkApprove          -> app.usp_request_bulk_decide (+ a merge per final approval)
 *   resubmitRequest      -> app.usp_request_resubmit
 *   cancelRequest        -> app.usp_request_cancel
 *   getRequestChecks     -> app.usp_request_checks      (a read, for the approver's screen)
 *   getRequestEvidence   -> app.usp_request_evidence    (a read, the snapshot kept on the CREATED event)
 *
 * Functions are thin (decision D-03): they check their inputs, find out who is calling (the verified token's user
 * id, never anything the browser says), run ONE business procedure and hand the answer back as typed data. The
 * shared runner and the answer envelope (ok, status, error, errorCode, userId, timing; failures are returned,
 * never thrown) live in runner.ts since APP-4, where they are described. The merge after a final approval is the
 * one extra step here, and it is the plan's own: 01 section 2.2, "the merge is a separate step after the approval
 * commits".
 *
 * Names and counts only in the log: an e-mail address, a value or a reason can be client data.
 */
import sql from 'mssql';
import type { ConnectionPool } from 'mssql';

import { describeSqlError } from './sql.js';
import {
  FIELD_CODE,
  InputError,
  act,
  clip,
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
// The answers (flat on purpose: the generated contract in types.ts is compared with them)
// ---------------------------------------------------------------------------

/** What the merge into gold answered, and whether the app recorded it. */
export interface MergeResult {
  /** APPLIED, STALE, ALREADY_APPLIED, NOT_ELIGIBLE or ERROR (also when the call itself failed). */
  outcome: string;
  message: string | null;
  goldenVersionId: number | null;
  /** MERGED, MERGE_STALE, COMMENTED or ALREADY_RECORDED; null when recording failed (see `error`). */
  recorded: string | null;
  /** Why the merge or its recording could not be completed; null when both worked. */
  error: string | null;
}

export interface CreateRequestResult {
  ok: boolean;
  status: string;
  error: string | null;
  errorCode: number | null;
  userId: string | null;
  timing: Timing;
  requestId: number | null;
  requestRef: string | null;
  /** CREATED, DUPLICATE_SUPPRESSED (the open request that already proposes it is returned) or BLOCKED_INCOMPATIBLE. */
  outcome: string | null;
  responsibleGroup: string | null;
  accountableGroup: string | null;
}

export interface DecideRequestResult {
  ok: boolean;
  status: string;
  error: string | null;
  errorCode: number | null;
  userId: string | null;
  timing: Timing;
  requestId: number | null;
  requestRef: string | null;
  decision: string | null;
  previousStatus: string | null;
  newStatus: string | null;
  stage: string | null;
  /** True when this was the final approval and the merge into gold was attempted (see `merge`). */
  needsMerge: boolean;
  merge: MergeResult | null;
}

export interface BulkRow {
  requestId: number | null;
  requestRef: string | null;
  /** DECIDED or SKIPPED. */
  outcome: string;
  newStatus: string | null;
  /** Why it was skipped (the refusal text of the decision procedure); null when decided. */
  reason: string | null;
  merge: MergeResult | null;
}

export interface BulkApproveResult {
  ok: boolean;
  status: string;
  error: string | null;
  errorCode: number | null;
  userId: string | null;
  timing: Timing;
  decided: number;
  skipped: number;
  results: BulkRow[];
}

export interface ResubmitRequestResult {
  ok: boolean;
  status: string;
  error: string | null;
  errorCode: number | null;
  userId: string | null;
  timing: Timing;
  requestId: number | null;
  requestRef: string | null;
  newStatus: string | null;
  newValue: string | null;
}

export interface CancelRequestResult {
  ok: boolean;
  status: string;
  error: string | null;
  errorCode: number | null;
  userId: string | null;
  timing: Timing;
  requestId: number | null;
  requestRef: string | null;
  previousStatus: string | null;
  newStatus: string | null;
}

export interface CheckRow {
  order: number;
  code: string;
  /** PASS, FAIL or NOT_CHECKED. */
  checkStatus: string;
  message: string;
  checkedAtUtc: string | null;
}

export interface RequestChecksResult {
  ok: boolean;
  status: string;
  error: string | null;
  errorCode: number | null;
  userId: string | null;
  timing: Timing;
  requestStatus: string | null;
  checks: CheckRow[];
}

export interface RequestEvidenceResult {
  ok: boolean;
  status: string;
  error: string | null;
  errorCode: number | null;
  userId: string | null;
  timing: Timing;
  requestRef: string | null;
  createdAtUtc: string | null;
  createdBy: string | null;
  /** The evidence snapshot as JSON text (what the requester or the rule saw), null when there is none. */
  detailsJson: string | null;
}

// ---------------------------------------------------------------------------
// Input checks (types, sizes, words; never business rules)
// ---------------------------------------------------------------------------

const MAX_BULK = 100;

export interface CreateRequestInput {
  /** MANUAL (desktop) or FIELD (field view). Rule and import requests are made by the system, never from the browser. */
  source: string;
  entityType: string;
  /** The heater; use -1 for a FLOC request. 0 is a valid heater id. */
  equipmentId: number;
  /** The FLOC (FLOC requests); empty for a heater. */
  functionalLocation: string;
  fieldCode: string;
  /** The value the person saw; empty when the field was blank. */
  oldValue: string;
  newValue: string;
  reason: string;
  comment: string;
  /** JSON text, empty for none. The procedure checks that it is JSON. */
  evidenceJson: string;
}

interface CheckedCreate {
  source: string;
  entityType: string;
  equipmentId: number | null;
  functionalLocation: string | null;
  fieldCode: string;
  oldValue: string | null;
  newValue: string;
  reason: string;
  comment: string | null;
  evidenceJson: string | null;
}

export function checkCreate(input: CreateRequestInput): CheckedCreate {
  const source = word('The source', input.source, ['MANUAL', 'FIELD']);
  const entityType = word('The entity type', input.entityType, ['EQUIPMENT', 'FLOC']);
  const functionalLocation = text('The functional location', input.functionalLocation, 40);
  let equipmentId: number | null = null;
  if (entityType === 'EQUIPMENT') {
    equipmentId = whole('The heater id', input.equipmentId, 0, 2_147_483_647);
  } else if (functionalLocation === '') {
    throw new InputError('The functional location is required for a location request.');
  }
  const fieldCode = text('The field', input.fieldCode, 64, true);
  if (!FIELD_CODE.test(fieldCode)) throw new InputError('The field is not a field code.');
  return {
    source,
    entityType,
    equipmentId,
    functionalLocation: entityType === 'FLOC' ? functionalLocation : null,
    fieldCode,
    oldValue: orNull(text('The old value', input.oldValue, 400)),
    newValue: text('The new value', input.newValue, 400, true),
    reason: text('The reason', input.reason, 400, true),
    comment: orNull(text('The comment', input.comment, 1000)),
    evidenceJson: orNull(text('The evidence', input.evidenceJson, 4000)),
  };
}

const MERGE_OUTCOMES = ['APPLIED', 'STALE', 'ALREADY_APPLIED', 'NOT_ELIGIBLE', 'ERROR'] as const;

// ---------------------------------------------------------------------------
// The merge into gold, after a final approval (01 section 2.2, 6.5)
// ---------------------------------------------------------------------------

/**
 * Asks gold to apply an APPROVED request and records the answer on the request's history. Neither step can undo
 * the approval, and neither throws: a failure of either comes back in the result, because the approval has already
 * committed (01 section 2.2: "an approval is never rolled back because a merge found a stale value").
 * The data engineer's real procedure replaces the stub (answers ERROR "merge not yet implemented") with the same
 * signature, so this code does not change when it arrives.
 */
export async function mergeAfterApproval(pool: ConnectionPool, requestId: number): Promise<MergeResult> {
  let outcome = 'ERROR';
  let message: string | null = null;
  let goldenVersionId: number | null = null;
  try {
    const merged = await pool
      .request()
      .input('request_id', sql.BigInt, String(requestId))
      .input('actor', sql.NVarChar(256), 'system:merge')
      .execute<Row>('gold.usp_apply_approved_change');
    const row = merged.recordset?.[0];
    const answered = (str(row?.['outcome']) ?? '').toUpperCase();
    outcome = (MERGE_OUTCOMES as readonly string[]).includes(answered) ? answered : 'ERROR';
    message = str(row?.['message']);
    if (outcome === 'ERROR' && answered !== 'ERROR') message = `The merge answered "${answered || 'nothing'}".`;
    goldenVersionId = num(row?.['golden_version_id']);
  } catch (err) {
    const info = describeSqlError(err);
    message = `The merge could not be called (${info.number ?? 'no error number'}): ${info.message}`;
    console.error(`merge after approval failed: ${info.number ?? 'no number'}`);
  }

  try {
    const recorded = await pool
      .request()
      .input('request_id', sql.BigInt, String(requestId))
      .input('outcome', sql.NVarChar(16), outcome)
      .input('message', sql.NVarChar(400), message === null ? null : clip(message, 400))
      .input('golden_version_id', sql.Int, goldenVersionId)
      .input('actor', sql.NVarChar(256), 'system:merge')
      .execute<Row>('app.usp_request_record_merge');
    return { outcome, message, goldenVersionId, recorded: str(recorded.recordset?.[0]?.['recorded']), error: null };
  } catch (err) {
    const info = describeSqlError(err);
    console.error(`recording the merge failed: ${info.number ?? 'no number'}`);
    return {
      outcome,
      message,
      goldenVersionId,
      recorded: null,
      error: `The merge outcome could not be recorded (${info.number ?? 'no error number'}): ${info.message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// createChangeRequest
// ---------------------------------------------------------------------------

const EMPTY_CREATE = {
  requestId: null,
  requestRef: null,
  outcome: null,
  responsibleGroup: null,
  accountableGroup: null,
} as const;

export async function runCreateRequest(
  input: CreateRequestInput,
  accessToken: string | null | undefined,
  getSqlToken: () => string
): Promise<CreateRequestResult> {
  const started = performance.now();
  let c: CheckedCreate;
  try {
    c = checkCreate(input);
  } catch (err) {
    return invalid(err, started, { ...EMPTY_CREATE });
  }
  return act('createChangeRequest', 'create the request', accessToken, getSqlToken, { ...EMPTY_CREATE } as Omit<CreateRequestResult, keyof Envelope>, async (pool, email) => {
    const r = await pool
      .request()
      .input('source_type', sql.NVarChar(20), c.source)
      .input('entity_type', sql.NVarChar(10), c.entityType)
      .input('field_code', sql.NVarChar(64), c.fieldCode)
      .input('new_value', sql.NVarChar(400), c.newValue)
      .input('reason', sql.NVarChar(400), c.reason)
      .input('requested_by', sql.NVarChar(256), email)
      .input('equipment_id', sql.Int, c.equipmentId)
      .input('functional_location', sql.NVarChar(40), c.functionalLocation)
      .input('old_value', sql.NVarChar(400), c.oldValue)
      .input('comment', sql.NVarChar(1000), c.comment)
      .input('evidence_json', sql.NVarChar(4000), c.evidenceJson)
      .input('emit_result', sql.Bit, 1)
      .execute<Row>('app.usp_request_create');
    const row = r.recordset?.[0];
    return {
      requestId: num(row?.['request_id']),
      requestRef: str(row?.['request_ref']),
      outcome: str(row?.['outcome']),
      responsibleGroup: str(row?.['responsible_group']),
      accountableGroup: str(row?.['accountable_group']),
    };
  });
}

// ---------------------------------------------------------------------------
// decideRequest
// ---------------------------------------------------------------------------

const EMPTY_DECIDE = {
  requestId: null,
  requestRef: null,
  decision: null,
  previousStatus: null,
  newStatus: null,
  stage: null,
  needsMerge: false,
  merge: null,
} as const;

export interface DecideInput {
  requestId: number;
  /** APPROVE, REJECT or RETURN. */
  decision: string;
  /** Required by the procedure for REJECT and RETURN. */
  comment: string;
  /** The status the screen showed; the procedure refuses when the request has moved on. Empty = do not check. */
  expectedStatus: string;
  /**
   * RETURN only: the e-mail of the person to return it to (one of the detail's `returnCandidates`). Empty = the
   * default recipient. The procedure checks it (app.fn_return_candidates); refused with 50137 otherwise.
   */
  returnTo: string;
}

export async function runDecideRequest(
  input: DecideInput,
  accessToken: string | null | undefined,
  getSqlToken: () => string
): Promise<DecideRequestResult> {
  const started = performance.now();
  let id: number, decision: string, comment: string | null, expected: string | null, returnTo: string | null;
  try {
    id = requestIdOf(input.requestId);
    decision = word('The decision', input.decision, ['APPROVE', 'REJECT', 'RETURN']);
    comment = orNull(text('The comment', input.comment, 1000));
    expected = orNull(text('The expected status', input.expectedStatus, 24));
    returnTo = orNull(text('The return recipient', input.returnTo ?? '', 256));
    if (returnTo !== null && decision !== 'RETURN') throw new InputError('A return recipient only goes with RETURN.');
    if (returnTo !== null && !/^[^@\s]+@[^@\s]+$/.test(returnTo)) throw new InputError('The return recipient is not an e-mail address.');
  } catch (err) {
    return invalid(err, started, { ...EMPTY_DECIDE });
  }
  return act('decideRequest', 'record the decision', accessToken, getSqlToken, { ...EMPTY_DECIDE } as Omit<DecideRequestResult, keyof Envelope>, async (pool, email) => {
    const r = await pool
      .request()
      .input('request_id', sql.BigInt, String(id))
      .input('actor_email', sql.NVarChar(256), email)
      .input('decision', sql.NVarChar(10), decision)
      .input('comment', sql.NVarChar(1000), comment)
      .input('expected_status', sql.NVarChar(24), expected)
      .input('return_recipient_type', sql.NVarChar(10), returnTo === null ? null : 'USER')
      .input('return_recipient', sql.NVarChar(256), returnTo)
      .input('emit_result', sql.Bit, 1)
      .execute<Row>('app.usp_request_decide');
    const row = r.recordset?.[0];
    const needsMerge = on(row?.['needs_merge']);
    // The decision has committed. Only now is the merge attempted; its failure is reported, not thrown.
    const merge = needsMerge ? await mergeAfterApproval(pool, id) : null;
    return {
      requestId: num(row?.['request_id']),
      requestRef: str(row?.['request_ref']),
      decision: str(row?.['decision']),
      previousStatus: str(row?.['previous_status']),
      newStatus: str(row?.['new_status']),
      stage: str(row?.['stage']),
      needsMerge,
      merge,
    };
  });
}

// ---------------------------------------------------------------------------
// bulkApprove
// ---------------------------------------------------------------------------

const EMPTY_BULK = { decided: 0, skipped: 0, results: [] as BulkRow[] };

export interface BulkInput {
  /** Request numbers separated by commas, at most 100. */
  requestIds: string;
  comment: string;
}

export function checkBulkIds(value: unknown): number[] {
  const list = text('The request numbers', value, 4000, true);
  const parts = list.split(',').map((p) => p.trim()).filter((p) => p !== '');
  if (parts.length === 0) throw new InputError('Name at least one request.');
  if (parts.length > MAX_BULK) throw new InputError(`At most ${MAX_BULK} requests can be approved at once.`);
  const ids = parts.map((p) => {
    if (!/^[0-9]{1,15}$/.test(p)) throw new InputError(`"${p.slice(0, 20)}" is not a request number.`);
    return Number(p);
  });
  return [...new Set(ids)];
}

export async function runBulkApprove(
  input: BulkInput,
  accessToken: string | null | undefined,
  getSqlToken: () => string
): Promise<BulkApproveResult> {
  const started = performance.now();
  let ids: number[], comment: string | null;
  try {
    ids = checkBulkIds(input.requestIds);
    comment = orNull(text('The comment', input.comment, 1000));
  } catch (err) {
    return invalid(err, started, { ...EMPTY_BULK, results: [] });
  }
  return act('bulkApprove', 'approve the requests', accessToken, getSqlToken, { ...EMPTY_BULK, results: [] as BulkRow[] } as Omit<BulkApproveResult, keyof Envelope>, async (pool, email) => {
    const r = await pool
      .request()
      .input('request_ids', sql.NVarChar(4000), ids.join(','))
      .input('actor_email', sql.NVarChar(256), email)
      .input('decision', sql.NVarChar(10), 'APPROVE')
      .input('comment', sql.NVarChar(1000), comment)
      .execute<Row>('app.usp_request_bulk_decide');

    const results: BulkRow[] = [];
    for (const row of r.recordset ?? []) {
      const requestId = num(row['request_id']);
      const decided = str(row['outcome']) === 'DECIDED';
      // Every final approval is merged on its own, one after the other, as a single approval is.
      const merge = decided && on(row['needs_merge']) && requestId !== null ? await mergeAfterApproval(pool, requestId) : null;
      results.push({
        requestId,
        requestRef: str(row['request_ref']),
        outcome: decided ? 'DECIDED' : 'SKIPPED',
        newStatus: str(row['new_status']),
        reason: str(row['reason']),
        merge,
      });
    }
    const decidedCount = results.filter((x) => x.outcome === 'DECIDED').length;
    return { decided: decidedCount, skipped: results.length - decidedCount, results };
  });
}

// ---------------------------------------------------------------------------
// resubmitRequest, cancelRequest
// ---------------------------------------------------------------------------

const EMPTY_RESUBMIT = { requestId: null, requestRef: null, newStatus: null, newValue: null } as const;

export interface ResubmitInput {
  requestId: number;
  /** A corrected proposed value; empty keeps the current one. */
  newValue: string;
  comment: string;
}

export async function runResubmitRequest(
  input: ResubmitInput,
  accessToken: string | null | undefined,
  getSqlToken: () => string
): Promise<ResubmitRequestResult> {
  const started = performance.now();
  let id: number, newValue: string | null, comment: string | null;
  try {
    id = requestIdOf(input.requestId);
    newValue = orNull(text('The corrected value', input.newValue, 400));
    comment = orNull(text('The comment', input.comment, 1000));
  } catch (err) {
    return invalid(err, started, { ...EMPTY_RESUBMIT });
  }
  return act('resubmitRequest', 'resubmit the request', accessToken, getSqlToken, { ...EMPTY_RESUBMIT } as Omit<ResubmitRequestResult, keyof Envelope>, async (pool, email) => {
    const r = await pool
      .request()
      .input('request_id', sql.BigInt, String(id))
      .input('actor_email', sql.NVarChar(256), email)
      .input('new_value', sql.NVarChar(400), newValue)
      .input('comment', sql.NVarChar(1000), comment)
      .input('emit_result', sql.Bit, 1)
      .execute<Row>('app.usp_request_resubmit');
    const row = r.recordset?.[0];
    return {
      requestId: num(row?.['request_id']),
      requestRef: str(row?.['request_ref']),
      newStatus: str(row?.['new_status']),
      newValue: str(row?.['new_value']),
    };
  });
}

const EMPTY_CANCEL = { requestId: null, requestRef: null, previousStatus: null, newStatus: null } as const;

export interface CancelInput {
  requestId: number;
  comment: string;
}

export async function runCancelRequest(
  input: CancelInput,
  accessToken: string | null | undefined,
  getSqlToken: () => string
): Promise<CancelRequestResult> {
  const started = performance.now();
  let id: number, comment: string | null;
  try {
    id = requestIdOf(input.requestId);
    comment = orNull(text('The comment', input.comment, 1000));
  } catch (err) {
    return invalid(err, started, { ...EMPTY_CANCEL });
  }
  return act('cancelRequest', 'withdraw the request', accessToken, getSqlToken, { ...EMPTY_CANCEL } as Omit<CancelRequestResult, keyof Envelope>, async (pool, email) => {
    const r = await pool
      .request()
      .input('request_id', sql.BigInt, String(id))
      .input('actor_email', sql.NVarChar(256), email)
      .input('comment', sql.NVarChar(1000), comment)
      .input('emit_result', sql.Bit, 1)
      .execute<Row>('app.usp_request_cancel');
    const row = r.recordset?.[0];
    return {
      requestId: num(row?.['request_id']),
      requestRef: str(row?.['request_ref']),
      previousStatus: str(row?.['previous_status']),
      newStatus: str(row?.['new_status']),
    };
  });
}

// ---------------------------------------------------------------------------
// getRequestChecks, getRequestEvidence (reads)
// ---------------------------------------------------------------------------

const EMPTY_CHECKS = { requestStatus: null, checks: [] as CheckRow[] };

export async function runRequestChecks(
  requestId: number,
  accessToken: string | null | undefined,
  getSqlToken: () => string
): Promise<RequestChecksResult> {
  const started = performance.now();
  let id: number;
  try {
    id = requestIdOf(requestId);
  } catch (err) {
    return invalid(err, started, { ...EMPTY_CHECKS, checks: [] });
  }
  return act('getRequestChecks', 'read the checks', accessToken, getSqlToken, { ...EMPTY_CHECKS, checks: [] as CheckRow[] } as Omit<RequestChecksResult, keyof Envelope>, async (pool, email) => {
    const r = await pool
      .request()
      .input('request_id', sql.BigInt, String(id))
      .input('actor_email', sql.NVarChar(256), email)
      .execute<Row>('app.usp_request_checks');
    const rows = r.recordset ?? [];
    return {
      requestStatus: str(rows[0]?.['request_status']),
      checks: rows.map((row) => ({
        order: num(row['check_order']) ?? 0,
        code: str(row['check_code']) ?? '',
        checkStatus: str(row['check_status']) ?? 'NOT_CHECKED',
        message: str(row['message']) ?? '',
        checkedAtUtc: str(row['checked_at_utc']),
      })),
    };
  });
}

const EMPTY_EVIDENCE = { requestRef: null, createdAtUtc: null, createdBy: null, detailsJson: null } as const;

export async function runRequestEvidence(
  requestId: number,
  accessToken: string | null | undefined,
  getSqlToken: () => string
): Promise<RequestEvidenceResult> {
  const started = performance.now();
  let id: number;
  try {
    id = requestIdOf(requestId);
  } catch (err) {
    return invalid(err, started, { ...EMPTY_EVIDENCE });
  }
  return act('getRequestEvidence', 'read the evidence', accessToken, getSqlToken, { ...EMPTY_EVIDENCE } as Omit<RequestEvidenceResult, keyof Envelope>, async (pool) => {
    const r = await pool.request().input('request_id', sql.BigInt, String(id)).execute<Row>('app.usp_request_evidence');
    const row = r.recordset?.[0];
    return {
      requestRef: str(row?.['request_ref']),
      createdAtUtc: str(row?.['created_at_utc']),
      createdBy: str(row?.['created_by']),
      detailsJson: str(row?.['details_json']),
    };
  });
}
