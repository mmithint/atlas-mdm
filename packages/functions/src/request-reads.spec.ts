import sql from 'mssql';
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
  checkQueue,
  runEquipmentRequests,
  runMyNotifications,
  runRequestDetail,
  runRequestFormOptions,
  runRequestQueue,
  type QueueInput,
} from './request-reads.js';

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
  types: Record<string, unknown>;
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
      const types: Record<string, unknown> = {};
      const req = {
        input(name: string, type: unknown, value: unknown) {
          inputs[name] = value;
          types[name] = type;
          return req;
        },
        async execute(proc: string) {
          calls.push({ proc, inputs, types });
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

/** What the driver returns for a procedure with several result sets. */
const sets = (...recordsets: Record<string, unknown>[][]) => ({ recordsets, recordset: recordsets[0] ?? [] });

const refusal = (number: number, message: string) => Object.assign(new Error(message), { number });
const business = (calls: Call[]) => calls.filter((c) => c.proc !== 'app.usp_identity_resolve');

const queueInput = (over: Partial<QueueInput> = {}): QueueInput => ({
  tab: 'responsible',
  profitCenter: '',
  fieldCode: '',
  ruleId: '',
  minAgeHours: 0,
  noteOnly: 0,
  offset: 0,
  pageSize: 50,
  ...over,
});

beforeEach(() => {
  openPool.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

// ---------------------------------------------------------------------------
// Fake result sets
// ---------------------------------------------------------------------------

const queueRowRaw = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  request_id: '41',
  request_ref: 'CR-000041',
  request_status: 'PENDING_RESPONSIBLE',
  approval_stage: 'RESPONSIBLE',
  entity_type: 'EQUIPMENT',
  equipment_id: 7,
  equipment_number: 'SYN-EQ-0007',
  functional_location: 'SYN-FL-7',
  equipment_tag_number: 'TAG-7',
  profit_center_name: 'OP RES DB NM',
  field_code: 'MANUFACTURER',
  field_label: 'Manufacturer',
  sap_field: null,
  old_value: 'OLD',
  new_value: 'NEW',
  reason: 'nameplate',
  note: null,
  source_type: 'MANUAL',
  source_rule_id: null,
  source_rule_version: null,
  source_label: 'Manual request',
  requested_by: 'someone.else@example.test',
  requested_at_utc: new Date('2026-11-17T08:00:00Z'),
  detected_at_utc: null,
  responsible_group: 'G-R',
  accountable_group: 'G-A',
  return_recipient_type: null,
  return_recipient: null,
  age_hours: 3,
  photo_count: 0,
  updated_at_utc: new Date('2026-11-17T08:00:00Z'),
  ...over,
});

const detailRowRaw = (): Record<string, unknown> => ({
  ...queueRowRaw({ request_status: 'APPROVED', approval_stage: null, age_hours: null }),
  class_code: 'FIRED_HEATER',
  route_id: 4,
  creation_comment: 'please check',
  last_decision_by: 'approver@example.test',
  last_decision_at_utc: new Date('2026-11-17T10:00:00Z'),
  merge_outcome: 'ERROR',
  merged_at_utc: null,
  golden_version_id: null,
  exported_at_utc: null,
  evolve_batch_id: null,
  evolve_row_number: null,
});

const relatedRaw = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  request_id: 40,
  request_ref: 'CR-000040',
  request_status: 'PENDING_ACCOUNTABLE',
  is_open: true,
  equipment_id: 7,
  functional_location: 'SYN-FL-7',
  field_code: 'MANUFACTURER',
  field_label: 'Manufacturer',
  source_label: 'Field submission',
  requested_at_utc: new Date('2026-11-16T09:00:00Z'),
  other_open_requests_same_field: 1,
  ...over,
});

// ---------------------------------------------------------------------------
// Input checks
// ---------------------------------------------------------------------------

describe('input checks (types, sizes, words; never business rules)', () => {
  it('cleans a queue request: upper-case tab, trimmed text, blanks and zero as no filter', () => {
    expect(checkQueue(queueInput({ profitCenter: ' OP RES DB NM ', ruleId: ' HEATER_DUTY ', fieldCode: 'HEAT_DUTY', minAgeHours: 48, noteOnly: 1, offset: 100, pageSize: 25 }))).toEqual({
      tab: 'RESPONSIBLE',
      profitCenter: 'OP RES DB NM',
      fieldCode: 'HEAT_DUTY',
      ruleId: 'HEATER_DUTY',
      minAgeHours: 48,
      noteOnly: true,
      offset: 100,
      pageSize: 25,
    });
    expect(checkQueue(queueInput())).toEqual({
      tab: 'RESPONSIBLE',
      profitCenter: null,
      fieldCode: null,
      ruleId: null,
      minAgeHours: null,
      noteOnly: false,
      offset: 0,
      pageSize: 50,
    });
  });

  it.each(['RESPONSIBLE', 'ACCOUNTABLE', 'RETURNED', 'APPROVED', 'REJECTED', 'MY_REQUESTS'])('accepts the tab %s', (tab) => {
    expect(checkQueue(queueInput({ tab: tab.toLowerCase() })).tab).toBe(tab);
  });

  it.each<[string, Partial<QueueInput>]>([
    ['an unknown tab', { tab: 'EVERYTHING' }],
    ['no tab', { tab: '' }],
    ['a profit centre over 40 characters', { profitCenter: 'x'.repeat(41) }],
    ['a field that is not a field code', { fieldCode: 'heat duty; DROP TABLE x' }],
    ['a rule over 64 characters', { ruleId: 'x'.repeat(65) }],
    ['a negative age', { minAgeHours: -1 }],
    ['an age over 100000', { minAgeHours: 100_001 }],
    ['an age with decimals', { minAgeHours: 1.5 }],
    ['a note flag of 2', { noteOnly: 2 }],
    ['a negative offset', { offset: -1 }],
    ['an offset over a million', { offset: 1_000_001 }],
    ['a page size of 0', { pageSize: 0 }],
    ['a page size of 101', { pageSize: 101 }],
    ['a page size that is text', { pageSize: '50' as unknown as number }],
  ])('refuses %s', (_label, over) => {
    expect(() => checkQueue(queueInput(over))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// What every read function does
// ---------------------------------------------------------------------------

describe('every read function', () => {
  const callers = {
    getRequestQueue: (t: string | undefined) => runRequestQueue(queueInput(), t, getSqlToken),
    getRequestDetail: (t: string | undefined) => runRequestDetail(41, t, getSqlToken),
    getMyNotifications: (t: string | undefined) => runMyNotifications(20, t, getSqlToken),
    getRequestFormOptions: (t: string | undefined) => runRequestFormOptions(t, getSqlToken),
    getEquipmentRequests: (t: string | undefined) => runEquipmentRequests(7, t, getSqlToken),
  };

  it.each(Object.entries(callers))('%s refuses a caller who is not signed in, before touching the database', async (_name, call) => {
    for (const token of [undefined, 'not-a-token', jwt({ sub: 'no-user-id-here' })]) {
      const r = await call(token);
      expect(r).toMatchObject({ ok: false, status: 'NOT_AUTHENTICATED', userId: null });
      expect(r.error).toMatch(/not signed in/);
    }
    expect(openPool).not.toHaveBeenCalled();
  });

  it.each(Object.entries(callers))("%s answers NOT_REGISTERED (with the caller's id) when no person is linked, and runs nothing else", async (_name, call) => {
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
    expect(r.error).toMatch(/^Could not /);
    expect(JSON.stringify(r)).not.toContain('sql-token-value');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('a failure answer keeps the full shape of a good one (nothing to guard against on the screen)', async () => {
    makePool({});
    const queue = await runRequestQueue(queueInput(), TOKEN, getSqlToken);
    expect(queue).toMatchObject({
      counts: { responsible: 0, accountable: 0, returned: 0, approved: 0, rejected: 0, mine: 0 },
      totalMatches: 0,
      hasMore: false,
      rows: [],
      facets: [],
    });
    const detail = await runRequestDetail(41, TOKEN, getSqlToken);
    expect(detail).toMatchObject({ request: null, events: [], related: [], route: null, gold: null, checks: [], viewer: null });
    expect(await runMyNotifications(20, TOKEN, getSqlToken)).toMatchObject({ unreadCount: 0, items: [] });
    expect(await runRequestFormOptions(TOKEN, getSqlToken)).toMatchObject({ canSubmit: false, isAdmin: false, allowedValues: [], blockedFields: [] });
    expect(await runEquipmentRequests(7, TOKEN, getSqlToken)).toMatchObject({ totalCount: 0, rows: [] });
  });

  it('refuses bad input as INVALID without touching the database', async () => {
    const queue = await runRequestQueue(queueInput({ tab: 'NOPE' }), TOKEN, getSqlToken);
    expect(queue).toMatchObject({ ok: false, status: 'INVALID', rows: [] });
    expect(queue.error).toMatch(/tab/i);
    expect((await runRequestDetail(0, TOKEN, getSqlToken)).status).toBe('INVALID');
    expect((await runRequestDetail(1.5, TOKEN, getSqlToken)).status).toBe('INVALID');
    expect((await runMyNotifications(0, TOKEN, getSqlToken)).status).toBe('INVALID');
    expect((await runMyNotifications(51, TOKEN, getSqlToken)).status).toBe('INVALID');
    expect((await runEquipmentRequests(-1, TOKEN, getSqlToken)).status).toBe('INVALID');
    expect((await runEquipmentRequests(2_147_483_648, TOKEN, getSqlToken)).status).toBe('INVALID');
    expect(openPool).not.toHaveBeenCalled();
  });

  it("returns a procedure's refusal as REFUSED with its own words and number (never thrown)", async () => {
    makePool({ 'app.usp_request_detail': refusal(50301, 'That request does not exist.') });
    const r = await runRequestDetail(999, TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: false, status: 'REFUSED', errorCode: 50301, userId: ID, request: null, viewer: null });
    expect(r.error).toBe('That request does not exist.');
  });

  it('returns anything else as FAILED with what went wrong', async () => {
    makePool({ 'app.usp_request_queue': Object.assign(new Error('Login failed for user'), { number: 18456 }) });
    const r = await runRequestQueue(queueInput(), TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: false, status: 'FAILED', errorCode: 18456, rows: [] });
    expect(r.error).toContain('Could not read the queue (18456): Login failed for user');
  });

  it("sends the caller's e-mail only to the procedure's @actor_email, and keeps it out of the answer and the log", async () => {
    const { calls } = makePool({
      'app.usp_request_queue': sets([{ responsible_count: 1, accountable_count: 0, returned_count: 0, approved_count: 0, rejected_count: 0, mine_count: 0 }], [{ total_matches: 1 }], [queueRowRaw()], []),
      'app.usp_request_detail': sets([detailRowRaw()], [], [], [], [], [], []),
      'app.usp_notification_list': sets([{ unread_count: 0 }], []),
      'app.usp_request_form_options': sets([], [{ can_submit: true, is_admin: false }], []),
      'app.usp_equipment_requests': sets([{ total_count: 0 }], []),
    });
    const answers = [
      await runRequestQueue(queueInput(), TOKEN, getSqlToken),
      await runRequestDetail(41, TOKEN, getSqlToken),
      await runMyNotifications(20, TOKEN, getSqlToken),
      await runRequestFormOptions(TOKEN, getSqlToken),
      await runEquipmentRequests(7, TOKEN, getSqlToken),
    ];
    for (const a of answers) expect(a.ok).toBe(true);
    expect(JSON.stringify(answers)).not.toContain(EMAIL);

    const withEmail = business(calls).filter((c) => Object.values(c.inputs).includes(EMAIL));
    expect(withEmail.map((c) => c.proc)).toEqual([
      'app.usp_request_queue',
      'app.usp_request_detail',
      'app.usp_notification_list',
      'app.usp_request_form_options',
    ]);
    for (const c of withEmail) {
      expect(Object.entries(c.inputs).filter(([, v]) => v === EMAIL).map(([k]) => k)).toEqual(['actor_email']);
    }
    const logged = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].flat().join(' ');
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain('someone.else@example.test');
    expect(logged).not.toContain('nameplate');
    expect(logged).not.toContain(ID);
  });
});

// ---------------------------------------------------------------------------
// getRequestQueue
// ---------------------------------------------------------------------------

describe('getRequestQueue', () => {
  const answer = (rows: Record<string, unknown>[], total: number) =>
    sets(
      [{ responsible_count: 12, accountable_count: 3, returned_count: 1, approved_count: 40, rejected_count: 2, mine_count: 5 }],
      [{ total_matches: total }],
      rows,
      [
        { facet_kind: 'PROFIT_CENTER', facet_value: 'OP RES DB NM', facet_label: 'OP RES DB NM', n: 9 },
        { facet_kind: 'FIELD', facet_value: 'HEAT_DUTY', facet_label: 'Heat duty (MMBTU/hr)', n: 4 },
        { facet_kind: 'RULE', facet_value: 'HEATER_DUTY', facet_label: null, n: 2 },
      ]
    );

  it('calls the queue procedure with the cleaned filters, typed, as the person from the token', async () => {
    const { calls } = makePool({ 'app.usp_request_queue': answer([], 0) });
    await runRequestQueue(
      queueInput({ tab: 'accountable', profitCenter: ' OP EOR ', fieldCode: 'HEAT_DUTY', ruleId: 'HEATER_DUTY', minAgeHours: 24, noteOnly: 1, offset: 100, pageSize: 25 }),
      TOKEN,
      getSqlToken
    );
    expect(calls[0]).toMatchObject({ proc: 'app.usp_identity_resolve', inputs: { external_id: ID } });
    expect(calls[1]?.proc).toBe('app.usp_request_queue');
    expect(calls[1]?.inputs).toEqual({
      actor_email: EMAIL,
      tab: 'ACCOUNTABLE',
      profit_center: 'OP EOR',
      field_code: 'HEAT_DUTY',
      rule_id: 'HEATER_DUTY',
      min_age_hours: 24,
      note_only: 1,
      offset: 100,
      page_size: 25,
    });
    expect(calls[1]?.types).toEqual({
      actor_email: sql.NVarChar(256),
      tab: sql.NVarChar(20),
      profit_center: sql.NVarChar(40),
      field_code: sql.NVarChar(64),
      rule_id: sql.NVarChar(64),
      min_age_hours: sql.Int,
      note_only: sql.Bit,
      offset: sql.Int,
      page_size: sql.Int,
    });
  });

  it('sends no filter as null and a zero age as null', async () => {
    const { calls } = makePool({ 'app.usp_request_queue': answer([], 0) });
    await runRequestQueue(queueInput(), TOKEN, getSqlToken);
    expect(calls[1]?.inputs).toMatchObject({ profit_center: null, field_code: null, rule_id: null, min_age_hours: null, note_only: 0 });
  });

  it('maps the counts, the rows and the facets from the four result sets', async () => {
    makePool({ 'app.usp_request_queue': answer([queueRowRaw({ can_approve: true }), queueRowRaw({ request_id: 42, request_ref: 'CR-000042', can_approve: 0, note: 'TBD', photo_count: '2' })], 2) });
    const r = await runRequestQueue(queueInput(), TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: true, status: 'OK', userId: ID, totalMatches: 2, hasMore: false });
    expect(r.counts).toEqual({ responsible: 12, accountable: 3, returned: 1, approved: 40, rejected: 2, mine: 5 });
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({
      requestId: 41,
      requestRef: 'CR-000041',
      requestStatus: 'PENDING_RESPONSIBLE',
      approvalStage: 'RESPONSIBLE',
      entityType: 'EQUIPMENT',
      equipmentId: 7,
      equipmentNumber: 'SYN-EQ-0007',
      functionalLocation: 'SYN-FL-7',
      equipmentTagNumber: 'TAG-7',
      profitCenterName: 'OP RES DB NM',
      fieldCode: 'MANUFACTURER',
      fieldLabel: 'Manufacturer',
      sapField: null,
      oldValue: 'OLD',
      newValue: 'NEW',
      reason: 'nameplate',
      note: null,
      sourceType: 'MANUAL',
      sourceRuleId: null,
      sourceRuleVersion: null,
      sourceLabel: 'Manual request',
      requestedBy: 'someone.else@example.test',
      requestedAtUtc: '2026-11-17T08:00:00.000Z',
      detectedAtUtc: null,
      responsibleGroup: 'G-R',
      accountableGroup: 'G-A',
      returnRecipientType: null,
      returnRecipient: null,
      ageHours: 3,
      photoCount: 0,
      updatedAtUtc: '2026-11-17T08:00:00.000Z',
      canApprove: true,
    });
    expect(r.rows[1]).toMatchObject({ requestId: 42, canApprove: false, note: 'TBD', photoCount: 2 });
    expect(r.facets).toEqual([
      { kind: 'PROFIT_CENTER', value: 'OP RES DB NM', label: 'OP RES DB NM', n: 9 },
      { kind: 'FIELD', value: 'HEAT_DUTY', label: 'Heat duty (MMBTU/hr)', n: 4 },
      { kind: 'RULE', value: 'HEATER_DUTY', label: 'HEATER_DUTY', n: 2 },
    ]);
  });

  it('says there is more when the rows so far are fewer than the total', async () => {
    makePool({ 'app.usp_request_queue': answer([queueRowRaw(), queueRowRaw({ request_id: 42 })], 130) });
    const first = await runRequestQueue(queueInput({ offset: 0, pageSize: 2 }), TOKEN, getSqlToken);
    expect(first).toMatchObject({ totalMatches: 130, hasMore: true });
    makePool({ 'app.usp_request_queue': answer([queueRowRaw(), queueRowRaw({ request_id: 42 })], 102) });
    const last = await runRequestQueue(queueInput({ offset: 100, pageSize: 2 }), TOKEN, getSqlToken);
    expect(last).toMatchObject({ totalMatches: 102, hasMore: false });
  });

  it('is not thrown by missing result sets: an empty queue', async () => {
    makePool({ 'app.usp_request_queue': { recordsets: [] } });
    const r = await runRequestQueue(queueInput(), TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: true, totalMatches: 0, hasMore: false, rows: [], facets: [] });
    expect(r.counts).toEqual({ responsible: 0, accountable: 0, returned: 0, approved: 0, rejected: 0, mine: 0 });
  });

  it('logs the tab and counts only', async () => {
    makePool({ 'app.usp_request_queue': answer([queueRowRaw()], 1) });
    await runRequestQueue(queueInput({ tab: 'RETURNED' }), TOKEN, getSqlToken);
    const logged = vi.mocked(console.log).mock.calls.flat().join(' ');
    expect(logged).toContain('getRequestQueue: tab=RETURNED rows=1 total=1');
  });
});

// ---------------------------------------------------------------------------
// getRequestDetail
// ---------------------------------------------------------------------------

describe('getRequestDetail', () => {
  const full = () =>
    sets(
      [detailRowRaw()],
      [
        { event_id: '1', event_type: 'CREATED', approval_stage: null, actor: 'someone.else@example.test', actor_group: null, occurred_at_utc: new Date('2026-11-17T08:00:00Z'), comments: 'please check', status_from: null, status_to: 'PENDING_RESPONSIBLE' },
        { event_id: 2, event_type: 'RESPONSIBLE_APPROVED', approval_stage: 'RESPONSIBLE', actor: 'approver@example.test', actor_group: 'G-R', occurred_at_utc: new Date('2026-11-17T09:00:00Z'), comments: null, status_from: 'PENDING_RESPONSIBLE', status_to: 'PENDING_ACCOUNTABLE', decided_as: 'ADMIN', same_person_both_stages: 1, returned_to: null },
        { event_id: 3, event_type: 'RETURNED', approval_stage: 'ACCOUNTABLE', actor: 'approver@example.test', actor_group: 'G-A', occurred_at_utc: new Date('2026-11-17T10:00:00Z'), comments: 'fix', status_from: 'PENDING_ACCOUNTABLE', status_to: 'RETURNED', decided_as: 'GROUP_MEMBER', same_person_both_stages: false, returned_to: 'fixer@example.test' },
      ],
      [relatedRaw()],
      [{ route_id: 4, entity_type: 'EQUIPMENT', request_action: 'UPDATE', field_or_characteristic: '*', class_scope: 'ANY', responsible_role: 'Operations-IOC', accountable_role: 'SAPBusinessSupport' }],
      [
        {
          entity_type: 'EQUIPMENT',
          equipment_number: 'SYN-EQ-0007',
          equipment_description: 'Heater 7',
          equipment_tag_number: 'TAG-7',
          functional_location: 'SYN-FL-7',
          floc_description: 'Furnace 7',
          equip_class: 'FIRED_HEATER',
          profit_center_name: 'OP RES DB NM',
          manufacturer: 'OLD',
          model_number: 'M1',
          manufacturer_serial_number: 'S1',
          equipment_user_status: 'OPER',
          golden_version_id: '3',
          last_changed_at_utc: new Date('2026-11-16T12:00:00Z'),
          field_current_value: 'OLD',
          field_unit: null,
        },
      ],
      [
        { check_order: 1, check_code: 'ASSOCIATION_MATCH', check_status: 'PASS', message: 'ok', checked_at_utc: new Date('2026-11-17T10:00:00Z') },
        { check_order: 2, check_code: 'OLD_VALUE_CURRENT', check_status: 'FAIL', message: 'moved', checked_at_utc: null },
      ],
      [
        {
          can_decide: 1,
          decide_blocked_reason: null,
          can_approve: 0,
          approve_blocked_reason: 'A sentence for Approve only.',
          can_resubmit: 0,
          can_cancel: 1,
          return_to_type: 'USER',
          return_to: 'someone.else@example.test',
          return_to_label: 'Someone Else',
          stage: 'ACCOUNTABLE',
          decided_as: 'ADMIN',
        },
      ],
      [
        { user_email: 'someone.else@example.test', display_name: 'Someone Else', relation: 'SUBMITTER', is_you: 0 },
        { user_email: 'me@example.test', display_name: null, relation: 'YOU', is_you: true },
      ]
    );

  it('calls the detail procedure with the request number as text and the person from the token', async () => {
    const { calls } = makePool({ 'app.usp_request_detail': full() });
    await runRequestDetail(41, TOKEN, getSqlToken);
    expect(calls[1]).toEqual({
      proc: 'app.usp_request_detail',
      inputs: { request_id: '41', actor_email: EMAIL },
      types: { request_id: sql.BigInt, actor_email: sql.NVarChar(256) },
    });
  });

  it('maps all eight result sets', async () => {
    makePool({ 'app.usp_request_detail': full() });
    const r = await runRequestDetail(41, TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: true, status: 'OK', userId: ID });
    expect(r.request).toMatchObject({
      requestId: 41,
      requestRef: 'CR-000041',
      requestStatus: 'APPROVED',
      classCode: 'FIRED_HEATER',
      routeId: 4,
      creationComment: 'please check',
      lastDecisionBy: 'approver@example.test',
      lastDecisionAtUtc: '2026-11-17T10:00:00.000Z',
      mergeOutcome: 'ERROR',
      mergedAtUtc: null,
      goldenVersionId: null,
      evolveBatchId: null,
    });
    expect(r.request).not.toHaveProperty('canApprove');
    expect(r.events).toEqual([
      { eventId: 1, eventType: 'CREATED', approvalStage: null, actor: 'someone.else@example.test', actorGroup: null, occurredAtUtc: '2026-11-17T08:00:00.000Z', comments: 'please check', statusFrom: null, statusTo: 'PENDING_RESPONSIBLE', decidedAs: null, samePersonBothStages: false, returnedTo: null },
      { eventId: 2, eventType: 'RESPONSIBLE_APPROVED', approvalStage: 'RESPONSIBLE', actor: 'approver@example.test', actorGroup: 'G-R', occurredAtUtc: '2026-11-17T09:00:00.000Z', comments: null, statusFrom: 'PENDING_RESPONSIBLE', statusTo: 'PENDING_ACCOUNTABLE', decidedAs: 'ADMIN', samePersonBothStages: true, returnedTo: null },
      { eventId: 3, eventType: 'RETURNED', approvalStage: 'ACCOUNTABLE', actor: 'approver@example.test', actorGroup: 'G-A', occurredAtUtc: '2026-11-17T10:00:00.000Z', comments: 'fix', statusFrom: 'PENDING_ACCOUNTABLE', statusTo: 'RETURNED', decidedAs: 'GROUP_MEMBER', samePersonBothStages: false, returnedTo: 'fixer@example.test' },
    ]);
    expect(r.related).toEqual([
      {
        requestId: 40,
        requestRef: 'CR-000040',
        requestStatus: 'PENDING_ACCOUNTABLE',
        isOpen: true,
        equipmentId: 7,
        functionalLocation: 'SYN-FL-7',
        fieldCode: 'MANUFACTURER',
        fieldLabel: 'Manufacturer',
        sourceLabel: 'Field submission',
        requestedAtUtc: '2026-11-16T09:00:00.000Z',
        otherOpenRequestsSameField: 1,
      },
    ]);
    expect(r.route).toEqual({ routeId: 4, entityType: 'EQUIPMENT', requestAction: 'UPDATE', fieldOrCharacteristic: '*', classScope: 'ANY', responsibleRole: 'Operations-IOC', accountableRole: 'SAPBusinessSupport' });
    expect(r.gold).toEqual({
      entityType: 'EQUIPMENT',
      equipmentNumber: 'SYN-EQ-0007',
      equipmentDescription: 'Heater 7',
      equipmentTagNumber: 'TAG-7',
      functionalLocation: 'SYN-FL-7',
      flocDescription: 'Furnace 7',
      equipClass: 'FIRED_HEATER',
      profitCenterName: 'OP RES DB NM',
      manufacturer: 'OLD',
      modelNumber: 'M1',
      manufacturerSerialNumber: 'S1',
      equipmentUserStatus: 'OPER',
      goldenVersionId: 3,
      lastChangedAtUtc: '2026-11-16T12:00:00.000Z',
      fieldCurrentValue: 'OLD',
      fieldUnit: null,
    });
    expect(r.checks).toEqual([
      { order: 1, code: 'ASSOCIATION_MATCH', checkStatus: 'PASS', message: 'ok', checkedAtUtc: '2026-11-17T10:00:00.000Z' },
      { order: 2, code: 'OLD_VALUE_CURRENT', checkStatus: 'FAIL', message: 'moved', checkedAtUtc: null },
    ]);
    expect(r.viewer).toEqual({
      canDecide: true,
      decideBlockedReason: null,
      canApprove: false,
      approveBlockedReason: 'A sentence for Approve only.',
      canResubmit: false,
      canCancel: true,
      returnToType: 'USER',
      returnTo: 'someone.else@example.test',
      returnToLabel: 'Someone Else',
      stage: 'ACCOUNTABLE',
      decidedAs: 'ADMIN',
    });
    expect(r.returnCandidates).toEqual([
      { email: 'someone.else@example.test', displayName: 'Someone Else', relation: 'SUBMITTER', isYou: false },
      { email: 'me@example.test', displayName: 'me@example.test', relation: 'YOU', isYou: true },
    ]);
  });

  it('shows a request without a route, gold row or viewer as nulls, and missing sets as empty lists', async () => {
    makePool({ 'app.usp_request_detail': sets([detailRowRaw()], [], [], [], [], [], []) });
    const r = await runRequestDetail(41, TOKEN, getSqlToken);
    expect(r).toMatchObject({ ok: true, events: [], related: [], route: null, gold: null, checks: [], viewer: null, returnCandidates: [] });
    expect(r.request?.requestId).toBe(41);

    makePool({ 'app.usp_request_detail': { recordsets: [] } });
    expect(await runRequestDetail(41, TOKEN, getSqlToken)).toMatchObject({ ok: true, request: null, events: [], viewer: null });
  });

  it('reads the viewer flags as booleans whatever the driver gives (bit, 0 / 1, text)', async () => {
    const viewer = (v: unknown) => sets([detailRowRaw()], [], [], [], [], [], [{ can_decide: v, can_approve: v, can_resubmit: v, can_cancel: v }]);
    makePool({ 'app.usp_request_detail': viewer(true) });
    expect((await runRequestDetail(41, TOKEN, getSqlToken)).viewer).toMatchObject({ canDecide: true, canApprove: true, canResubmit: true, canCancel: true });
    makePool({ 'app.usp_request_detail': viewer(0) });
    expect((await runRequestDetail(41, TOKEN, getSqlToken)).viewer).toMatchObject({ canDecide: false, canApprove: false, canResubmit: false, canCancel: false });
    makePool({ 'app.usp_request_detail': viewer(null) });
    expect((await runRequestDetail(41, TOKEN, getSqlToken)).viewer).toMatchObject({ canDecide: false, canApprove: false });
  });
});

// ---------------------------------------------------------------------------
// getMyNotifications
// ---------------------------------------------------------------------------

describe('getMyNotifications', () => {
  it('sends the limit and the person, and maps the unread count and the messages', async () => {
    const { calls } = makePool({
      'app.usp_notification_list': sets(
        [{ unread_count: 3 }],
        [
          { notification_id: '9', topic: 'REQUEST_RETURNED', request_id: 41, request_ref: 'CR-000041', title: 'Request CR-000041 was returned to you', body: 'Comment: fix it', created_at_utc: new Date('2026-11-17T11:00:00Z'), is_read: 0 },
          { notification_id: 8, topic: 'REQUEST_APPROVED', request_id: null, request_ref: null, title: 'Approved', body: 'Done', created_at_utc: null, is_read: 1 },
        ]
      ),
    });
    const r = await runMyNotifications(20, TOKEN, getSqlToken);
    expect(calls[1]).toEqual({
      proc: 'app.usp_notification_list',
      inputs: { actor_email: EMAIL, limit: 20 },
      types: { actor_email: sql.NVarChar(256), limit: sql.Int },
    });
    expect(r).toMatchObject({ ok: true, unreadCount: 3 });
    expect(r.items).toEqual([
      { notificationId: 9, topic: 'REQUEST_RETURNED', requestId: 41, requestRef: 'CR-000041', title: 'Request CR-000041 was returned to you', body: 'Comment: fix it', createdAtUtc: '2026-11-17T11:00:00.000Z', isRead: false },
      { notificationId: 8, topic: 'REQUEST_APPROVED', requestId: null, requestRef: null, title: 'Approved', body: 'Done', createdAtUtc: null, isRead: true },
    ]);
  });

  it('answers zero unread and no messages when the procedure returns empty sets', async () => {
    makePool({ 'app.usp_notification_list': sets([{ unread_count: 0 }], []) });
    expect(await runMyNotifications(5, TOKEN, getSqlToken)).toMatchObject({ ok: true, unreadCount: 0, items: [] });
  });
});

// ---------------------------------------------------------------------------
// getRequestFormOptions
// ---------------------------------------------------------------------------

describe('getRequestFormOptions', () => {
  it('maps the drop-down values, the person\'s rights and the fields they may not request', async () => {
    const { calls } = makePool({
      'app.usp_request_form_options': sets(
        [
          { field_code: 'FIRED_UNFIRED', allowed_value: 'FIRED', display_order: 1 },
          { field_code: 'FIRED_UNFIRED', allowed_value: 'UNFIRED', display_order: '2' },
        ],
        [{ can_submit: 1, is_admin: 0 }],
        [{ field_code: 'EQUIP_CLASS', reason: 'Only an admin may ask to change this field by hand.' }]
      ),
    });
    const r = await runRequestFormOptions(TOKEN, getSqlToken);
    expect(calls[1]).toEqual({
      proc: 'app.usp_request_form_options',
      inputs: { actor_email: EMAIL },
      types: { actor_email: sql.NVarChar(256) },
    });
    expect(r).toMatchObject({ ok: true, canSubmit: true, isAdmin: false });
    expect(r.allowedValues).toEqual([
      { fieldCode: 'FIRED_UNFIRED', value: 'FIRED', order: 1 },
      { fieldCode: 'FIRED_UNFIRED', value: 'UNFIRED', order: 2 },
    ]);
    expect(r.blockedFields).toEqual([{ fieldCode: 'EQUIP_CLASS', reason: 'Only an admin may ask to change this field by hand.' }]);
  });

  it('treats a person row that is missing as no rights', async () => {
    makePool({ 'app.usp_request_form_options': sets([], [], []) });
    expect(await runRequestFormOptions(TOKEN, getSqlToken)).toMatchObject({ ok: true, canSubmit: false, isAdmin: false, allowedValues: [], blockedFields: [] });
  });
});

// ---------------------------------------------------------------------------
// getEquipmentRequests
// ---------------------------------------------------------------------------

describe('getEquipmentRequests', () => {
  it('sends the heater id (0 is a valid heater) and maps the total and the rows', async () => {
    const { calls } = makePool({
      'app.usp_equipment_requests': sets([{ total_count: 120 }], [relatedRaw(), relatedRaw({ request_id: 39, request_ref: 'CR-000039', request_status: 'APPROVED', is_open: 0, other_open_requests_same_field: 0 })]),
    });
    const r = await runEquipmentRequests(0, TOKEN, getSqlToken);
    expect(calls[1]).toEqual({ proc: 'app.usp_equipment_requests', inputs: { equipment_id: 0 }, types: { equipment_id: sql.Int } });
    expect(r).toMatchObject({ ok: true, totalCount: 120 });
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ requestId: 40, isOpen: true, otherOpenRequestsSameField: 1 });
    expect(r.rows[1]).toMatchObject({ requestId: 39, requestStatus: 'APPROVED', isOpen: false, otherOpenRequestsSameField: 0 });
  });

  it('answers an unknown heater with no rows', async () => {
    makePool({ 'app.usp_equipment_requests': sets([{ total_count: 0 }], []) });
    expect(await runEquipmentRequests(99, TOKEN, getSqlToken)).toMatchObject({ ok: true, totalCount: 0, rows: [] });
  });
});
