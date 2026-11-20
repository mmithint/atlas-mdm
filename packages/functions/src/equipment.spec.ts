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
  COLUMN_COUNTS,
  checkSearch,
  runEquipmentDetail,
  runEquipmentSearch,
  type SearchRequest,
} from './equipment.js';

const ID = '11111111-2222-3333-4444-555555555555';
function jwt(claims: Record<string, unknown>): string {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');
  return `${part({ alg: 'none' })}.${part(claims)}.sig`;
}
const TOKEN = jwt({ sub: `/eid1/c/pub/t/T/a/A/workspaces/W/projects/P/users/${ID}` });
const getSqlToken = () => 'sql-token-value-that-must-never-be-logged';

interface Call {
  proc: string;
  inputs: Record<string, unknown>;
  outputs: string[];
}

/** A stand-in for a connection pool: records the procedure call, answers with `result`. */
function makePool(result: unknown, failWith?: Error) {
  const calls: Call[] = [];
  const close = vi.fn().mockResolvedValue(undefined);
  const pool = {
    request() {
      const inputs: Record<string, unknown> = {};
      const outputs: string[] = [];
      const req = {
        input(name: string, _type: unknown, value: unknown) {
          inputs[name] = value;
          return req;
        },
        output(name: string) {
          outputs.push(name);
          return req;
        },
        async execute(proc: string) {
          calls.push({ proc, inputs, outputs });
          if (failWith) throw failWith;
          return result;
        },
      };
      return req;
    },
    close,
  };
  openPool.mockResolvedValue(pool);
  return { calls, close };
}

const request = (over: Partial<SearchRequest> = {}): SearchRequest => ({
  mode: 'sorted',
  searchColumn: 'equipmentTagNumber',
  searchText: '  SYN-TAG  ',
  facility: '',
  sortColumn: 'equipmentNumber',
  sortDirection: 'desc',
  offset: 50,
  pageSize: 25,
  filtersJson: '',
  ...over,
});

const heaterRaw = {
  equipment_id: 4,
  equipment_number: 'SYN-EQ-0004',
  equipment_tag_number: 'SYN-TAG-0004',
  heat_duty_mmbtu_hr: 1.5,
  golden_version_id: 1,
  last_changed_at_utc: null,
  baseline_as_of_utc: new Date('2000-01-01T00:00:00Z'),
  open_request_count: 2,
  invalid_rule_count: null,
  verification_pct: 60,
  seq: 99, // a column the contract does not know: must not reach the browser
};

beforeEach(() => {
  openPool.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('the contract sizes (FINAL PLAN/01 section 6.1 and 09 section 9)', () => {
  it('carries 26, 29, 15, 9 and 7 columns', () => {
    expect(COLUMN_COUNTS).toEqual({ equipment: 26, search: 29, floc: 15, fieldValue: 9, ownership: 7 });
  });
});

describe('checkSearch', () => {
  it('turns the screen words into the procedure words', () => {
    expect(checkSearch(request())).toEqual({
      mode: 'SORTED',
      searchColumn: 'equipment_tag_number',
      searchText: 'SYN-TAG',
      facility: '',
      sortColumn: 'equipment_number',
      sortDirection: 'DESC',
      offset: 50,
      pageSize: 25,
      filtersJson: '',
    });
  });

  it.each<[string, Partial<SearchRequest>]>([
    ['an unknown mode', { mode: 'FIND' }],
    ['a search column that is not an identifier', { searchColumn: 'equipmentId; DROP TABLE x' }],
    ['a search column that starts with a capital', { searchColumn: 'EquipmentTag' }],
    ['an empty sort column', { sortColumn: '' }],
    ['a sort column with SQL in it', { sortColumn: 'equipmentId--' }],
    ['a sort direction that is neither asc nor desc', { sortDirection: 'sideways' }],
    ['a negative offset', { offset: -1 }],
    ['a fractional offset', { offset: 1.5 }],
    ['a page size of 0', { pageSize: 0 }],
    ['a page size above 100', { pageSize: 101 }],
    ['a search text over 100 characters', { searchText: 'x'.repeat(101) }],
    ['a facility over 40 characters', { facility: 'x'.repeat(41) }],
    ['a search text that is not text', { searchText: 42 as unknown as string }],
    ['a page size that is not a number', { pageSize: '50' as unknown as number }],
    ['filters that are not text', { filtersJson: [] as unknown as string }],
    ['filters that are not JSON', { filtersJson: 'not json' }],
    ['filters that are an object, not a list', { filtersJson: '{"column":"manufacturer","text":"x"}' }],
    ['a filter that is not an object', { filtersJson: '["manufacturer"]' }],
    ['a filter with null in it', { filtersJson: '[null]' }],
    ['a filter without a column', { filtersJson: '[{"text":"x"}]' }],
    ['a filter without a text', { filtersJson: '[{"column":"manufacturer"}]' }],
    ['a filter text that is not text', { filtersJson: '[{"column":"manufacturer","text":5}]' }],
    ['a filter column that is not an identifier', { filtersJson: '[{"column":"manufacturer]; DROP TABLE x;--","text":"x"}]' }],
    ['a filter text over 100 characters', { filtersJson: JSON.stringify([{ column: 'manufacturer', text: 'x'.repeat(101) }]) }],
    ['21 filters', { filtersJson: JSON.stringify(Array.from({ length: 21 }, () => ({ column: 'manufacturer', text: 'a' }))) }],
    ['filters longer than 4000 characters', { filtersJson: ' '.repeat(4001) + '[]' }],
  ])('refuses %s', (_label, over) => {
    expect(() => checkSearch(request(over))).toThrow(/Invalid search/);
  });

  it('accepts the biggest page and the first page', () => {
    expect(() => checkSearch(request({ pageSize: 100, offset: 0 }))).not.toThrow();
  });

  describe('the column filters (CR-1)', () => {
    const filters = (list: unknown) => checkSearch(request({ filtersJson: JSON.stringify(list) })).filtersJson;

    it('hands the procedure one canonical form: snake_case columns, trimmed texts, blank entries dropped', () => {
      const text = 'A "B" \\ C'; // A, a quoted B, a backslash, C
      expect(filters([{ column: 'equipClass', text: '  fired ' }, { column: 'manufacturer', text }, { column: 'plannerGroup', text: '   ' }])).toBe(
        '[{"column":"equip_class","text":"fired"},{"column":"manufacturer","text":"A \\"B\\" \\\\ C"}]'
      );
    });

    it('means no filter for an empty text, an empty list and a list of blanks', () => {
      expect(checkSearch(request({ filtersJson: '' })).filtersJson).toBe('');
      expect(checkSearch(request({ filtersJson: '   ' })).filtersJson).toBe('');
      expect(filters([])).toBe('');
      expect(filters([{ column: 'manufacturer', text: ' ' }])).toBe('');
    });

    it('accepts 20 filters and a text of 100 characters (which columns are allowed is up to the procedure)', () => {
      expect(() => filters(Array.from({ length: 20 }, () => ({ column: 'manufacturer', text: 'a' })))).not.toThrow();
      expect(() => filters([{ column: 'manufacturer', text: 'x'.repeat(100) }])).not.toThrow();
    });
  });
});

describe('runEquipmentSearch', () => {
  it('refuses a caller who is not signed in, before touching the database', async () => {
    for (const token of [undefined, 'not-a-token']) {
      const r = await runEquipmentSearch(request(), token, getSqlToken);
      expect(r.error).toMatch(/not signed in/);
      expect(r.rows).toEqual([]);
    }
    expect(openPool).not.toHaveBeenCalled();
  });

  it('refuses bad input before touching the database', async () => {
    const r = await runEquipmentSearch(request({ pageSize: 500 }), TOKEN, getSqlToken);
    expect(r.error).toMatch(/Invalid search/);
    expect(openPool).not.toHaveBeenCalled();
  });

  it('answers a good read with error null', async () => {
    makePool({ recordset: [], output: {} });
    expect((await runEquipmentSearch(request(), TOKEN, getSqlToken)).error).toBeNull();
  });

  it('runs the one procedure with the cleaned values and asks for the three summary outputs', async () => {
    const { calls } = makePool({ recordset: [], output: { total_matches: 0, has_more: false, truncated: false } });
    await runEquipmentSearch(request({ facility: ' SYN-FL-AREA-01 ' }), TOKEN, getSqlToken);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      proc: 'app.usp_equipment_search',
      inputs: {
        mode: 'SORTED',
        search_column: 'equipment_tag_number',
        search_text: 'SYN-TAG',
        facility: 'SYN-FL-AREA-01',
        sort_column: 'equipment_number',
        sort_direction: 'DESC',
        offset: 50,
        page_size: 25,
        filters_json: '',
      },
      outputs: ['total_matches', 'has_more', 'truncated'],
    });
  });

  it('passes the column filters to the procedure as one JSON text, cleaned', async () => {
    const { calls } = makePool({ recordset: [], output: {} });
    const list = [{ column: 'manufacturer', text: ' heat ' }, { column: 'equipClass', text: 'fired' }];
    await runEquipmentSearch(request({ filtersJson: JSON.stringify(list) }), TOKEN, getSqlToken);
    expect(calls[0]?.inputs['filters_json']).toBe('[{"column":"manufacturer","text":"heat"},{"column":"equip_class","text":"fired"}]');
  });

  it('refuses bad filters before touching the database', async () => {
    const r = await runEquipmentSearch(request({ filtersJson: 'not json' }), TOKEN, getSqlToken);
    expect(r.error).toMatch(/Invalid search: filters are not valid JSON/);
    expect(openPool).not.toHaveBeenCalled();
  });

  it('returns typed rows: camelCase, blanks as null, dates as ISO text, unknown columns dropped', async () => {
    makePool({
      recordset: [heaterRaw],
      output: { total_matches: 41, has_more: true, truncated: false },
    });
    const r = await runEquipmentSearch(request(), TOKEN, getSqlToken);
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0]!;
    expect(row.equipmentId).toBe(4);
    expect(row.equipmentTagNumber).toBe('SYN-TAG-0004');
    expect(row.heatDutyMmbtuHr).toBe(1.5);
    expect(row.lastChangedAtUtc).toBeNull();
    expect(row.baselineAsOfUtc).toBe('2000-01-01T00:00:00.000Z');
    expect(row.manufacturer).toBeNull(); // not in the database row: a blank, never undefined
    expect(row.openRequestCount).toBe(2);
    expect(row.invalidRuleCount).toBeNull();
    expect('seq' in row).toBe(false);
    expect(Object.keys(row)).toHaveLength(COLUMN_COUNTS.search);
    expect(r).toMatchObject({ totalMatches: 41, hasMore: true, truncated: false });
  });

  it('reads the summary flags whether the driver gives booleans or 0/1', async () => {
    makePool({ recordset: [], output: { total_matches: 7, has_more: 0, truncated: 1 } });
    const r = await runEquipmentSearch(request({ mode: 'MATCH' }), TOKEN, getSqlToken);
    expect(r).toMatchObject({ totalMatches: 7, hasMore: false, truncated: true });
  });

  it('reports how long it took inside the function', async () => {
    makePool({ recordset: [], output: {} });
    const r = await runEquipmentSearch(request(), TOKEN, getSqlToken);
    for (const ms of [r.timing.connectMs, r.timing.queryMs, r.timing.totalMs]) {
      expect(Number.isInteger(ms)).toBe(true);
      expect(ms).toBeGreaterThanOrEqual(0);
    }
    expect(r.timing.totalMs).toBeGreaterThanOrEqual(r.timing.queryMs);
  });

  it('closes the connection, and returns what the database said as `error` (never thrown), without the token', async () => {
    const { close } = makePool(null, Object.assign(new Error('that column cannot be searched.'), { number: 50014 }));
    const r = await runEquipmentSearch(request(), TOKEN, getSqlToken);
    expect(r.error).toContain('Could not read the equipment (50014): that column cannot be searched.');
    expect(r.error).not.toContain('sql-token-value');
    expect(r).toMatchObject({ rows: [], totalMatches: 0, hasMore: false, truncated: false });
    expect(r.timing.totalMs).toBeGreaterThanOrEqual(0);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('returns a failure to open the connection as `error` too', async () => {
    openPool.mockRejectedValue(new Error('Login failed for user'));
    const r = await runEquipmentSearch(request(), TOKEN, getSqlToken);
    expect(r.error).toContain('Login failed for user');
  });

  it('closes the connection after a good read too', async () => {
    const { close } = makePool({ recordset: [], output: {} });
    await runEquipmentSearch(request(), TOKEN, getSqlToken);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('runEquipmentDetail', () => {
  const flocRaw = { functional_location: 'SYN-FL-0004', level1_id: 'SYN-ORG', level2_id: 'SYN-BU-02', golden_version_id: 1 };
  const valueRaw = {
    equipment_field_key: '4|HEAT_DUTY',
    equipment_id: 4,
    field_code: 'HEAT_DUTY',
    current_value: '1.5000',
    baseline_value: '1.5000',
    unit: 'MMBTU/hr',
    value_source: 'STATED',
    last_request_id: BigInt(123456789012),
    last_changed_at_utc: new Date('2026-11-14T10:00:00Z'),
  };
  const ownerRaw = {
    field_ownership_key: 'EQUIPMENT|HEAT_DUTY',
    entity_type: 'EQUIPMENT',
    field_code: 'HEAT_DUTY',
    label: 'Heat duty',
    responsible_role: 'Operations-IOC',
    accountable_role: 'SAPBusinessSupport',
    route_id: 3,
  };

  it('refuses a caller who is not signed in, and a bad id, before touching the database', async () => {
    expect((await runEquipmentDetail(4, undefined, getSqlToken)).error).toMatch(/not signed in/);
    for (const bad of [-1, 1.5, Number.NaN, 2_147_483_648, '4' as unknown as number]) {
      const r = await runEquipmentDetail(bad, TOKEN, getSqlToken);
      expect(r.error).toMatch(/Invalid request/);
      expect(r.found).toBe(false);
    }
    expect(openPool).not.toHaveBeenCalled();
  });

  it('says what it received when it refuses an id, without printing an object\'s contents', async () => {
    const said = async (value: unknown) => (await runEquipmentDetail(value as number, TOKEN, getSqlToken)).error;
    expect(await said('4')).toContain('received string 4');
    expect(await said(-3)).toContain('received number -3');
    expect(await said(null)).toContain('received null');
    expect(await said(undefined)).toContain('received undefined');
    const object = await said({ accessToken: 'secret-value', Tokens: {} });
    expect(object).toContain('an object with the keys accessToken, Tokens');
    expect(object).not.toContain('secret-value');
  });

  it('accepts id 0 and the largest int: the stub\'s first heater is id 0 (found 15 Nov), and existence is the procedure\'s answer', async () => {
    for (const id of [0, 2_147_483_647]) {
      const { calls } = makePool({ recordsets: [[], [], [], []] });
      const r = await runEquipmentDetail(id, TOKEN, getSqlToken);
      expect(r.error).toBeNull();
      expect(calls[0]?.inputs).toEqual({ equipment_id: id });
    }
  });

  it('runs the one procedure with the id', async () => {
    const { calls } = makePool({ recordsets: [[], [], [], []] });
    await runEquipmentDetail(4, TOKEN, getSqlToken);
    expect(calls).toEqual([{ proc: 'app.usp_equipment_detail', inputs: { equipment_id: 4 }, outputs: [] }]);
  });

  it('maps the four result sets', async () => {
    makePool({ recordsets: [[heaterRaw], [flocRaw], [valueRaw], [ownerRaw]] });
    const r = await runEquipmentDetail(4, TOKEN, getSqlToken);
    expect(r.found).toBe(true);
    expect(r.heater?.equipmentNumber).toBe('SYN-EQ-0004');
    expect(Object.keys(r.heater ?? {})).toHaveLength(COLUMN_COUNTS.equipment);
    expect(r.floc?.functionalLocation).toBe('SYN-FL-0004');
    expect(r.floc?.level1Id).toBe('SYN-ORG'); // level1_id -> level1Id
    expect(r.floc?.level3Id).toBeNull();
    expect(Object.keys(r.floc ?? {})).toHaveLength(COLUMN_COUNTS.floc);
    expect(r.fieldValues).toHaveLength(1);
    expect(r.fieldValues[0]?.lastRequestId).toBe('123456789012'); // bigint travels as text
    expect(r.fieldValues[0]?.lastChangedAtUtc).toBe('2026-11-14T10:00:00.000Z');
    expect(r.ownership[0]).toMatchObject({ fieldCode: 'HEAT_DUTY', responsibleRole: 'Operations-IOC', routeId: 3 });
    expect(Object.keys(r.ownership[0] ?? {})).toHaveLength(COLUMN_COUNTS.ownership);
  });

  it('says "not found" for an id with no heater, and still carries the owners', async () => {
    makePool({ recordsets: [[], [], [], [ownerRaw]] });
    const r = await runEquipmentDetail(999999, TOKEN, getSqlToken);
    expect(r.found).toBe(false);
    expect(r.heater).toBeNull();
    expect(r.floc).toBeNull();
    expect(r.fieldValues).toEqual([]);
    expect(r.ownership).toHaveLength(1);
  });

  it('copes with a heater that has no location row', async () => {
    makePool({ recordsets: [[heaterRaw], [], [valueRaw], [ownerRaw]] });
    const r = await runEquipmentDetail(4, TOKEN, getSqlToken);
    expect(r.found).toBe(true);
    expect(r.floc).toBeNull();
  });

  it('closes the connection when the database fails, and returns the failure as `error`', async () => {
    const { close } = makePool(null, new Error('boom'));
    const r = await runEquipmentDetail(4, TOKEN, getSqlToken);
    expect(r.error).toMatch(/Could not read the equipment/);
    expect(r.error).toContain('boom');
    expect(r).toMatchObject({ found: false, heater: null, floc: null, fieldValues: [], ownership: [] });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('returns a mistake while shaping the answer as `error` too, so it is never lost', async () => {
    makePool({ recordsets: [[heaterRaw], [], [null], []] }); // a field-value row that is not a row at all
    const r = await runEquipmentDetail(4, TOKEN, getSqlToken);
    expect(r.error).not.toBeNull();
  });

  it('answers a good read with error null', async () => {
    makePool({ recordsets: [[heaterRaw], [flocRaw], [valueRaw], [ownerRaw]] });
    expect((await runEquipmentDetail(4, TOKEN, getSqlToken)).error).toBeNull();
  });
});
