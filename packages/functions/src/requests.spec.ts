import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openPool } = vi.hoisted(() => ({ openPool: vi.fn() }));

vi.mock('./sql.js', () => ({
  openPool,
  describeSqlError: (err: unknown) => ({
    number: (err as { number?: number } | null)?.number ?? null,
    message: err instanceof Error ? err.message : String(err),
    hint: null,
  }),
}));

import {
  checkBulkIds,
  checkCreate,
  runBulkApprove,
  runCancelRequest,
  runCreateRequest,
  runDecideRequest,
  runRequestChecks,
  runRequestEvidence,
  runResubmitRequest,
  type CreateRequestInput,
} from './requests.js';

const ID = '11111111-2222-3333-4444-555555555555';
function jwt(claims: Record<string, unknown>): string {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');
  return `${part({ alg: 'none' })}.${part(claims)}.sig`;
}
const TOKEN = jwt({ sub: `/eid1/c/pub/t/T/a/A/workspaces/W/projects/P/users/${ID}` });
const SQL_TOKEN = 'sql-token-value-that-must-never-be-logged';
const getSqlToken = () => SQL_TOKEN;
const EMAIL = 'real.person@example.test';

interface Call {
  proc: string;
  inputs: Record<string, unknown>;
}

/**
 * A stand-in for a connection pool. `answers` maps a procedure name to its result, or to an Error to throw.
 * The identity lookup answers with EMAIL unless `answers` says otherwise.
 */
function makePool(answers: Record<string, unknown>) {
  const calls: Call[] = [];
  const close = vi.fn().mockResolvedValue(undefined);
  const all: Record<string, unknown> = { 'app.usp_identity_resolve': { recordset: [{ user_email: EMAIL }] }, ...answers };
  const pool = {
    request() {
      const inputs: Record<string, unknown> = {};
      const req = {
        input(name: string, _type: unknown, value: unknown) {
          inputs[name] = value;
          return req;
        },
        async execute(proc: string) {
          calls.push({ proc, inputs });
          const answer = all[proc];
          if (answer instanceof Error) throw answer;
          if (answer === undefined) throw new Error(`no answer set for ${proc}`);
          return answer;
        },
      };
      return req;
    },
    close,
  };
  openPool.mockResolvedValue(pool);
  return { calls, close };
}

const refusal = (number: number, message: string) => Object.assign(new Error(message), { number });
const business = (calls: Call[]) => calls.filter((c) => c.proc !== 'app.usp_identity_resolve');

const create = (over: Partial<CreateRequestInput> = {}): CreateRequestInput => ({
  source: 'manual',
  entityType: 'equipment',
  equipmentId: 4,
  functionalLocation: '',
  fieldCode: 'MANUFACTURER',
  oldValue: ' OLD MFR ',
  newValue: ' NEW MFR ',
  reason: 'nameplate says so',
  comment: '',
  evidenceJson: '',
  ...over,
});

beforeEach(() => {
  openPool.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('input checks (types, sizes, words; never business rules)', () => {
  it('cleans a heater request: upper-case words, trimmed text, blanks as null', () => {
    expect(checkCreate(create())).toEqual({
      source: 'MANUAL',
      entityType: 'EQUIPMENT',
      equipmentId: 4,
      functionalLocation: null,
      fieldCode: 'MANUFACTURER',
      oldValue: 'OLD MFR',
      newValue: 'NEW MFR',
      reason: 'nameplate says so',
      comment: null,
      evidenceJson: null,
    });
  });

  it('accepts heater id 0 (the stub\'s first heater) and a FLOC request with -1', () => {
    expect(checkCreate(create({ equipmentId: 0 })).equipmentId).toBe(0);
    const floc = checkCreate(create({ entityType: 'FLOC', equipmentId: -1, functionalLocation: ' SYN-FL-1 ', fieldCode: 'FLOC_CLASS' }));
    expect(floc).toMatchObject({ entityType: 'FLOC', equipmentId: null, functionalLocation: 'SYN-FL-1' });
  });

  it.each<[string, Partial<CreateRequestInput>]>([
    ['a source the system alone may use', { source: 'BUSINESS_RULE' }],
    ['an unknown entity type', { entityType: 'ROOM' }],
    ['a negative heater id', { equipmentId: -1 }],
    ['a heater id with decimals', { equipmentId: 1.5 }],
    ['a heater id that is text', { equipmentId: '4' as unknown as number }],
    ['a FLOC request without a location', { entityType: 'FLOC', equipmentId: -1, functionalLocation: ' ' }],
    ['a field that is not a code', { fieldCode: 'manufacturer; DROP TABLE x' }],
    ['no new value', { newValue: '   ' }],
    ['no reason', { reason: '' }],
    ['a new value over 400 characters', { newValue: 'x'.repeat(401) }],
    ['a comment over 1000 characters', { comment: 'x'.repeat(1001) }],
    ['evidence over 4000 characters', { evidenceJson: 'x'.repeat(4001) }],
  ])('refuses %s', (_label, over) => {
    expect(() => checkCreate(create(over))).toThrow();
  });

  it('turns a list of request numbers into distinct numbers and refuses anything else', () => {
    expect(checkBulkIds(' 12, 7,12 ,')).toEqual([12, 7]);
    expect(() => checkBulkIds('')).toThrow();
    expect(() => checkBulkIds('1,abc')).toThrow(/not a request number/);
    expect(() => checkBulkIds('1;2')).toThrow();
    expect(() => checkBulkIds(Array.from({ length: 101 }, (_, i) => String(i + 1)).join(','))).toThrow(/At most 100/);
  });
});

describe('every function', () => {
  const callers = {
    createChangeRequest: (t: string | undefined) => runCreateRequest(create(), t, getSqlToken),
    decideRequest: (t: string | undefined) => runDecideRequest({ requestId: 5, decision: 'APPROVE', comment: '', expectedStatus: '', returnTo: '' }, t, getSqlToken),
    bulkApprove: (t: string | undefined) => runBulkApprove({ requestIds: '5,6', comment: '' }, t, getSqlToken),
    resubmitRequest: (t: string | undefined) => runResubmitRequest({ requestId: 5, newValue: '', comment: '' }, t, getSqlToken),
    cancelRequest: (t: string | undefined) => runCancelRequest({ requestId: 5, comment: '' }, t, getSqlToken),
    getRequestChecks: (t: string | undefined) => runRequestChecks(5, t, getSqlToken),
    getRequestEvidence: (t: string | undefined) => runRequestEvidence(5, t, getSqlToken),
  };

  it.each(Object.entries(callers))('%s refuses a caller who is not signed in, before touching the database', async (_name, call) => {
    for (const token of [undefined, 'not-a-token', jwt({ sub: 'no-user-id-here' })]) {
      const r = await call(token);
      expect(r).toMatchObject({ ok: false, status: 'NOT_AUTHENTICATED', userId: null });
      expect(r.error).toMatch(/not signed in/);
    }
    expect(openPool).not.toHaveBeenCalled();
  });

  it.each(Object.entries(callers))('%s answers NOT_REGISTERED (with the caller\'s id) when no person is linked, and runs nothing else', async (_name, call) => {
    const { calls, close } = makePool({ 'app.usp_identity_resolve': { recordset: [] } });
    const r = await call(TOKEN);
    expect(r).toMatchObject({ ok: false, status: 'NOT_REGISTERED', userId: ID });
    expect(business(calls)).toEqual([]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each(Object.entries(callers))('%s closes the connection and never puts the SQL token in an answer', async (_name, call) => {
    const { close } = makePool({});
    const r = await call(TOKEN); // no answer set for the business procedure: it fails
    expect(r.status).toBe('FAILED');
    expect(JSON.stringify(r)).not.toContain('sql-token-value');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('refuses bad input as INVALID without touching the database', async () => {
    const r = await runCreateRequest(create({ source: 'BUSINESS_RULE' }), TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: false, status: 'INVALID', requestId: null });
    expect(r.error).toMatch(/source/i);
    expect((await runDecideRequest({ requestId: 0, decision: 'APPROVE', comment: '', expectedStatus: '', returnTo: '' }, TOKEN, getSqlToken)).status).toBe('INVALID');
    expect((await runDecideRequest({ requestId: 5, decision: 'DELETE', comment: '', expectedStatus: '', returnTo: '' }, TOKEN, getSqlToken)).status).toBe('INVALID');
    expect((await runBulkApprove({ requestIds: '1,x', comment: '' }, TOKEN, getSqlToken)).status).toBe('INVALID');
    expect((await runRequestChecks(1.5, TOKEN, getSqlToken)).status).toBe('INVALID');
    expect(openPool).not.toHaveBeenCalled();
  });

  it('returns a procedure\'s refusal as REFUSED with its own words and number (never thrown)', async () => {
    makePool({ 'app.usp_request_decide': refusal(50141, 'You are not an active member of the group for this stage (X).') });
    const r = await runDecideRequest({ requestId: 5, decision: 'APPROVE', comment: '', expectedStatus: '', returnTo: '' }, TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: false, status: 'REFUSED', errorCode: 50141, userId: ID, needsMerge: false, merge: null });
    expect(r.error).toBe('You are not an active member of the group for this stage (X).');
  });

  it('returns anything else as FAILED with what went wrong', async () => {
    makePool({ 'app.usp_request_cancel': Object.assign(new Error('Login failed for user'), { number: 18456 }) });
    const r = await runCancelRequest({ requestId: 5, comment: '' }, TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: false, status: 'FAILED', errorCode: 18456 });
    expect(r.error).toContain('Could not withdraw the request (18456): Login failed for user');
  });

  it('keeps e-mail addresses out of the log', async () => {
    makePool({ 'app.usp_request_cancel': { recordset: [{ request_id: 5, request_ref: 'CR-000005', previous_status: 'RETURNED', new_status: 'CANCELLED' }] } });
    await runCancelRequest({ requestId: 5, comment: 'private comment' }, TOKEN, getSqlToken);
    const logged = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].flat().join(' ');
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain('private comment');
    expect(logged).not.toContain(ID);
  });
});

describe('createChangeRequest', () => {
  it('sends the person from the token, never from the browser, with cleaned values', async () => {
    const { calls } = makePool({
      'app.usp_request_create': {
        recordset: [{ request_id: '123', request_ref: 'CR-000123', outcome: 'CREATED', responsible_group: 'G-R', accountable_group: 'G-A' }],
      },
    });
    const r = await runCreateRequest(create({ comment: ' check ' }), TOKEN, getSqlToken);
    expect(calls[0]).toMatchObject({ proc: 'app.usp_identity_resolve', inputs: { external_id: ID } });
    expect(calls[1]).toEqual({
      proc: 'app.usp_request_create',
      inputs: {
        source_type: 'MANUAL',
        entity_type: 'EQUIPMENT',
        field_code: 'MANUFACTURER',
        new_value: 'NEW MFR',
        reason: 'nameplate says so',
        requested_by: EMAIL,
        equipment_id: 4,
        functional_location: null,
        old_value: 'OLD MFR',
        comment: 'check',
        evidence_json: null,
        emit_result: 1,
      },
    });
    expect(r).toMatchObject({
      ok: true,
      status: 'OK',
      error: null,
      errorCode: null,
      userId: ID,
      requestId: 123,
      requestRef: 'CR-000123',
      outcome: 'CREATED',
      responsibleGroup: 'G-R',
      accountableGroup: 'G-A',
    });
    for (const ms of [r.timing.connectMs, r.timing.queryMs, r.timing.totalMs]) expect(Number.isInteger(ms)).toBe(true);
  });

  it('passes a duplicate or a blocked request through as an answer, not an error', async () => {
    makePool({ 'app.usp_request_create': { recordset: [{ request_id: 9, request_ref: 'CR-000009', outcome: 'DUPLICATE_SUPPRESSED', responsible_group: 'G-R', accountable_group: 'G-A' }] } });
    const r = await runCreateRequest(create(), TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: true, outcome: 'DUPLICATE_SUPPRESSED', requestId: 9 });
  });

  it('sends a FLOC request with its location and no heater', async () => {
    const { calls } = makePool({ 'app.usp_request_create': { recordset: [{ request_id: 2, request_ref: 'CR-000002', outcome: 'CREATED', responsible_group: 'a', accountable_group: 'b' }] } });
    await runCreateRequest(create({ entityType: 'FLOC', equipmentId: -1, functionalLocation: 'SYN-FL-1', fieldCode: 'FLOC_CLASS' }), TOKEN, getSqlToken);
    expect(calls[1]?.inputs).toMatchObject({ entity_type: 'FLOC', equipment_id: null, functional_location: 'SYN-FL-1' });
  });
});

describe('decideRequest and the merge', () => {
  const decided = (over: Record<string, unknown> = {}) => ({
    recordset: [{ request_id: 5, request_ref: 'CR-000005', decision: 'APPROVE', previous_status: 'PENDING_ACCOUNTABLE', new_status: 'APPROVED', stage: 'ACCOUNTABLE', needs_merge: true, ...over }],
  });

  it('a first-stage approval is only the decision: no merge is attempted', async () => {
    const { calls } = makePool({ 'app.usp_request_decide': decided({ new_status: 'PENDING_ACCOUNTABLE', stage: 'RESPONSIBLE', needs_merge: false }) });
    const r = await runDecideRequest({ requestId: 5, decision: 'approve', comment: ' ok ', expectedStatus: 'PENDING_RESPONSIBLE', returnTo: '' }, TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: true, newStatus: 'PENDING_ACCOUNTABLE', stage: 'RESPONSIBLE', needsMerge: false, merge: null });
    expect(calls.map((c) => c.proc)).toEqual(['app.usp_identity_resolve', 'app.usp_request_decide']);
    expect(calls[1]?.inputs).toEqual({
      request_id: '5',
      actor_email: EMAIL,
      decision: 'APPROVE',
      comment: 'ok',
      expected_status: 'PENDING_RESPONSIBLE',
      return_recipient_type: null,
      return_recipient: null,
      emit_result: 1,
    });
  });

  it('a final approval then asks gold to merge and records the answer', async () => {
    const { calls } = makePool({
      'app.usp_request_decide': decided(),
      'gold.usp_apply_approved_change': { recordset: [{ outcome: 'applied', message: 'done', golden_version_id: 7 }] },
      'app.usp_request_record_merge': { recordset: [{ request_id: 5, request_ref: 'CR-000005', recorded: 'MERGED' }] },
    });
    const r = await runDecideRequest({ requestId: 5, decision: 'APPROVE', comment: '', expectedStatus: '', returnTo: '' }, TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: true, newStatus: 'APPROVED', needsMerge: true });
    expect(r.merge).toEqual({ outcome: 'APPLIED', message: 'done', goldenVersionId: 7, recorded: 'MERGED', error: null });
    expect(calls.map((c) => c.proc)).toEqual([
      'app.usp_identity_resolve',
      'app.usp_request_decide',
      'gold.usp_apply_approved_change',
      'app.usp_request_record_merge',
    ]);
    expect(calls[2]?.inputs).toEqual({ request_id: '5', actor: 'system:merge' });
    expect(calls[3]?.inputs).toEqual({ request_id: '5', outcome: 'APPLIED', message: 'done', golden_version_id: 7, actor: 'system:merge' });
  });

  it('the merge stub answering ERROR leaves the approval standing and is recorded', async () => {
    const { calls } = makePool({
      'app.usp_request_decide': decided(),
      'gold.usp_apply_approved_change': { recordset: [{ outcome: 'ERROR', message: 'merge not yet implemented', golden_version_id: null }] },
      'app.usp_request_record_merge': { recordset: [{ recorded: 'COMMENTED' }] },
    });
    const r = await runDecideRequest({ requestId: 5, decision: 'APPROVE', comment: '', expectedStatus: '', returnTo: '' }, TOKEN, getSqlToken);
    expect(r.ok).toBe(true);
    expect(r.newStatus).toBe('APPROVED');
    expect(r.merge).toEqual({ outcome: 'ERROR', message: 'merge not yet implemented', goldenVersionId: null, recorded: 'COMMENTED', error: null });
    expect(calls[3]?.inputs).toMatchObject({ outcome: 'ERROR', golden_version_id: null });
  });

  it('a merge that cannot be called, or answers something unknown, is reported as ERROR and still recorded', async () => {
    makePool({
      'app.usp_request_decide': decided(),
      'gold.usp_apply_approved_change': Object.assign(new Error('Could not find stored procedure'), { number: 2812 }),
      'app.usp_request_record_merge': { recordset: [{ recorded: 'COMMENTED' }] },
    });
    const r = await runDecideRequest({ requestId: 5, decision: 'APPROVE', comment: '', expectedStatus: '', returnTo: '' }, TOKEN, getSqlToken);
    expect(r.ok).toBe(true);
    expect(r.merge).toMatchObject({ outcome: 'ERROR', recorded: 'COMMENTED', error: null });
    expect(r.merge?.message).toContain('could not be called (2812)');

    makePool({
      'app.usp_request_decide': decided(),
      'gold.usp_apply_approved_change': { recordset: [{ outcome: 'MAYBE', message: null, golden_version_id: null }] },
      'app.usp_request_record_merge': { recordset: [{ recorded: 'COMMENTED' }] },
    });
    const r2 = await runDecideRequest({ requestId: 5, decision: 'APPROVE', comment: '', expectedStatus: '', returnTo: '' }, TOKEN, getSqlToken);
    expect(r2.merge).toMatchObject({ outcome: 'ERROR', message: 'The merge answered "MAYBE".' });
  });

  it('a failure to record the merge outcome is reported inside `merge`, not as a failed approval', async () => {
    makePool({
      'app.usp_request_decide': decided(),
      'gold.usp_apply_approved_change': { recordset: [{ outcome: 'STALE', message: 'value moved', golden_version_id: null }] },
      'app.usp_request_record_merge': refusal(50182, 'Only an approved request has a merge to record.'),
    });
    const r = await runDecideRequest({ requestId: 5, decision: 'APPROVE', comment: '', expectedStatus: '', returnTo: '' }, TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: true, status: 'OK', newStatus: 'APPROVED' });
    expect(r.merge).toMatchObject({ outcome: 'STALE', recorded: null });
    expect(r.merge?.error).toContain('could not be recorded (50182)');
  });

  it('a refused approval never reaches the merge', async () => {
    const { calls } = makePool({ 'app.usp_request_decide': refusal(50144, 'Approval is blocked by failed checks: OLD_VALUE_CURRENT.') });
    const r = await runDecideRequest({ requestId: 5, decision: 'APPROVE', comment: '', expectedStatus: '', returnTo: '' }, TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: false, status: 'REFUSED', errorCode: 50144 });
    expect(calls.some((c) => c.proc.startsWith('gold.'))).toBe(false);
  });

  it('reject and return send their comment and never merge', async () => {
    const { calls } = makePool({ 'app.usp_request_decide': decided({ decision: 'RETURN', new_status: 'RETURNED', needs_merge: false }) });
    const r = await runDecideRequest({ requestId: 5, decision: 'RETURN', comment: 'wrong spelling', expectedStatus: '', returnTo: '' }, TOKEN, getSqlToken);
    expect(r).toMatchObject({ newStatus: 'RETURNED', needsMerge: false, merge: null });
    expect(calls[1]?.inputs).toMatchObject({ decision: 'RETURN', comment: 'wrong spelling', expected_status: null, return_recipient_type: null, return_recipient: null });
  });

  it('sends a picked return recipient as a USER; the procedure checks who it may be', async () => {
    const { calls } = makePool({ 'app.usp_request_decide': decided({ decision: 'RETURN', new_status: 'RETURNED', needs_merge: false }) });
    const r = await runDecideRequest({ requestId: 5, decision: 'RETURN', comment: 'check it', expectedStatus: '', returnTo: ' someone@example.test ' }, TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: true, newStatus: 'RETURNED' });
    expect(calls[1]?.inputs).toMatchObject({ return_recipient_type: 'USER', return_recipient: 'someone@example.test' });
  });

  it('refuses a return recipient on APPROVE or one that is not an e-mail, before any database call', async () => {
    const a = await runDecideRequest({ requestId: 5, decision: 'APPROVE', comment: '', expectedStatus: '', returnTo: 'someone@example.test' }, TOKEN, getSqlToken);
    const b = await runDecideRequest({ requestId: 5, decision: 'RETURN', comment: 'x', expectedStatus: '', returnTo: 'not an address' }, TOKEN, getSqlToken);
    expect(a).toMatchObject({ ok: false, status: 'INVALID' });
    expect(b).toMatchObject({ ok: false, status: 'INVALID' });
  });

  it('passes the server refusal for a recipient who may not receive it (50137)', async () => {
    makePool({ 'app.usp_request_decide': refusal(50137, 'A request can only be returned to its submitter, to a registered member of one of its two approval groups, or to yourself.') });
    const r = await runDecideRequest({ requestId: 5, decision: 'RETURN', comment: 'x', expectedStatus: '', returnTo: 'outsider@example.test' }, TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: false, status: 'REFUSED', errorCode: 50137 });
  });
});

describe('bulkApprove', () => {
  it('sends the distinct ids to the one procedure, approves, and merges only the final approvals', async () => {
    const { calls } = makePool({
      'app.usp_request_bulk_decide': {
        recordset: [
          { request_id: 5, request_ref: 'CR-000005', outcome: 'DECIDED', new_status: 'APPROVED', needs_merge: true, reason: null },
          { request_id: 6, request_ref: 'CR-000006', outcome: 'DECIDED', new_status: 'PENDING_ACCOUNTABLE', needs_merge: false, reason: null },
          { request_id: 7, request_ref: 'CR-000007', outcome: 'SKIPPED', new_status: null, needs_merge: false, reason: 'Approval is blocked by failed checks: OLD_VALUE_CURRENT.' },
        ],
      },
      'gold.usp_apply_approved_change': { recordset: [{ outcome: 'APPLIED', message: null, golden_version_id: 3 }] },
      'app.usp_request_record_merge': { recordset: [{ recorded: 'MERGED' }] },
    });
    const r = await runBulkApprove({ requestIds: '5, 6,7,5', comment: ' bulk ' }, TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: true, decided: 2, skipped: 1 });
    expect(r.results.map((x) => [x.requestId, x.outcome, x.merge?.outcome ?? null])).toEqual([
      [5, 'DECIDED', 'APPLIED'],
      [6, 'DECIDED', null],
      [7, 'SKIPPED', null],
    ]);
    expect(r.results[2]?.reason).toContain('OLD_VALUE_CURRENT');
    expect(calls[1]).toEqual({
      proc: 'app.usp_request_bulk_decide',
      inputs: { request_ids: '5,6,7', actor_email: EMAIL, decision: 'APPROVE', comment: 'bulk' },
    });
    expect(calls.filter((c) => c.proc === 'gold.usp_apply_approved_change')).toHaveLength(1);
  });

  it('returns a refusal of the whole call (for example an empty list) as REFUSED', async () => {
    makePool({ 'app.usp_request_bulk_decide': refusal(50152, 'At most 100 requests can be decided at once.') });
    const r = await runBulkApprove({ requestIds: '1', comment: '' }, TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: false, status: 'REFUSED', errorCode: 50152, decided: 0, skipped: 0, results: [] });
  });
});

describe('resubmitRequest and cancelRequest', () => {
  it('resubmits with the corrected value, as the person from the token', async () => {
    const { calls } = makePool({ 'app.usp_request_resubmit': { recordset: [{ request_id: 5, request_ref: 'CR-000005', new_status: 'PENDING_RESPONSIBLE', new_value: 'FIXED' }] } });
    const r = await runResubmitRequest({ requestId: 5, newValue: ' FIXED ', comment: '' }, TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: true, newStatus: 'PENDING_RESPONSIBLE', newValue: 'FIXED', requestRef: 'CR-000005' });
    expect(calls[1]).toEqual({
      proc: 'app.usp_request_resubmit',
      inputs: { request_id: '5', actor_email: EMAIL, new_value: 'FIXED', comment: null, emit_result: 1 },
    });
  });

  it('cancels as the person from the token and returns the old and new status', async () => {
    const { calls } = makePool({ 'app.usp_request_cancel': { recordset: [{ request_id: 5, request_ref: 'CR-000005', previous_status: 'RETURNED', new_status: 'CANCELLED' }] } });
    const r = await runCancelRequest({ requestId: 5, comment: 'no longer needed' }, TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: true, previousStatus: 'RETURNED', newStatus: 'CANCELLED' });
    expect(calls[1]?.inputs).toEqual({ request_id: '5', actor_email: EMAIL, comment: 'no longer needed', emit_result: 1 });
  });
});

describe('getRequestChecks and getRequestEvidence', () => {
  it('returns the six checks in order, evaluated for the caller', async () => {
    const { calls } = makePool({
      'app.usp_request_checks': {
        recordset: [
          { request_status: 'PENDING_RESPONSIBLE', check_order: 1, check_code: 'ASSOCIATION_MATCH', check_status: 'PASS', message: 'ok', checked_at_utc: new Date('2026-11-16T10:00:00Z') },
          { request_status: 'PENDING_RESPONSIBLE', check_order: 2, check_code: 'OLD_VALUE_CURRENT', check_status: 'FAIL', message: 'moved', checked_at_utc: null },
        ],
      },
    });
    const r = await runRequestChecks(5, TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: true, requestStatus: 'PENDING_RESPONSIBLE' });
    expect(r.checks).toEqual([
      { order: 1, code: 'ASSOCIATION_MATCH', checkStatus: 'PASS', message: 'ok', checkedAtUtc: '2026-11-16T10:00:00.000Z' },
      { order: 2, code: 'OLD_VALUE_CURRENT', checkStatus: 'FAIL', message: 'moved', checkedAtUtc: null },
    ]);
    expect(calls[1]).toEqual({ proc: 'app.usp_request_checks', inputs: { request_id: '5', actor_email: EMAIL } });
  });

  it('returns the evidence snapshot as JSON text', async () => {
    makePool({
      'app.usp_request_evidence': {
        recordset: [{ request_ref: 'CR-000005', created_at_utc: new Date('2026-11-16T09:00:00Z'), created_by: 'x@example.test', details_json: '{"event":"CREATED"}' }],
      },
    });
    const r = await runRequestEvidence(5, TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: true, requestRef: 'CR-000005', createdAtUtc: '2026-11-16T09:00:00.000Z', detailsJson: '{"event":"CREATED"}' });
  });

  it('answers an unknown request with the procedure\'s refusal', async () => {
    makePool({ 'app.usp_request_evidence': refusal(50201, 'That request does not exist.') });
    const r = await runRequestEvidence(999, TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: false, status: 'REFUSED', errorCode: 50201, detailsJson: null });
  });
});
