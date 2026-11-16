/**
 * `searchEquipment` and `getEquipmentDetail`: the reads behind screens S-4 and S-5
 * (read path C, decided 15 Nov, D-17; FINAL PLAN/01 section 2.1).
 *
 * Why functions: the connector cannot read views (spike S7: a view is refused even when it
 * has the same columns as an accepted table), so the browser reaches the search and
 * gold views through these two functions. Each one does only what every function does:
 * check the caller, check the input, run ONE procedure, return typed rows.
 *
 *   searchEquipment     -> app.usp_equipment_search   (the search rules live there)
 *   getEquipmentDetail  -> app.usp_equipment_detail   (four result sets, one connection)
 *
 * Nothing is written. Names only in the log: a row can be client data.
 *
 * Timing: every answer carries `timing` (connect, query, total, in milliseconds, measured
 * inside the function). The browser measures the whole call; the difference is the platform
 * (wake-up of an idle function, network). That is how the latency gate of APP-2 tells a slow
 * query from a slow start.
 */
import sql from 'mssql';
import type { ConnectionPool } from 'mssql';

import { callerId } from './identity.js';
import { describeSqlError, openPool } from './sql.js';

// ---------------------------------------------------------------------------
// What the screens receive (camelCase names of the view columns, 01 section 6.1)
// ---------------------------------------------------------------------------

/** The 26 columns of gold.vw_equipment_current. Dates are ISO text (UTC). */
export interface EquipmentRow {
  equipmentId: number;
  equipmentNumber: string | null;
  equipmentDescription: string | null;
  functionalLocation: string | null;
  flocDescription: string | null;
  superiorFunctionalLocation: string | null;
  equipmentTagNumber: string | null;
  equipClass: string | null;
  classType: string | null;
  objectType: string | null;
  flocClass: string | null;
  techObjectType: string | null;
  manufacturer: string | null;
  modelNumber: string | null;
  manufacturerSerialNumber: string | null;
  firedUnfired: string | null;
  heatDutyMmbtuHr: number | null;
  heatDutySource: string | null;
  equipmentUserStatus: string | null;
  flocUserStatus: string | null;
  profitCenterName: string | null;
  plannerGroup: string | null;
  heaterPopulationMethod: string | null;
  goldenVersionId: number | null;
  lastChangedAtUtc: string | null;
  baselineAsOfUtc: string | null;
}

/** The 29 columns of app.vw_equipment_search: the 26 above plus three counters. */
export interface EquipmentSearchRow {
  equipmentId: number;
  equipmentNumber: string | null;
  equipmentDescription: string | null;
  functionalLocation: string | null;
  flocDescription: string | null;
  superiorFunctionalLocation: string | null;
  equipmentTagNumber: string | null;
  equipClass: string | null;
  classType: string | null;
  objectType: string | null;
  flocClass: string | null;
  techObjectType: string | null;
  manufacturer: string | null;
  modelNumber: string | null;
  manufacturerSerialNumber: string | null;
  firedUnfired: string | null;
  heatDutyMmbtuHr: number | null;
  heatDutySource: string | null;
  equipmentUserStatus: string | null;
  flocUserStatus: string | null;
  profitCenterName: string | null;
  plannerGroup: string | null;
  heaterPopulationMethod: string | null;
  goldenVersionId: number | null;
  lastChangedAtUtc: string | null;
  baselineAsOfUtc: string | null;
  /** Open change requests on the heater or its FLOC. */
  openRequestCount: number;
  /** NULL until APP-5 computes it ("not computed yet", never zero). */
  invalidRuleCount: number | null;
  verificationPct: number | null;
}

/** The 15 columns of gold.vw_floc_current. */
export interface FlocRow {
  functionalLocation: string;
  flocDescription: string | null;
  superiorFunctionalLocation: string | null;
  flocClass: string | null;
  techObjectType: string | null;
  flocUserStatus: string | null;
  profitCenterName: string | null;
  level1Id: string | null;
  level2Id: string | null;
  level3Id: string | null;
  level4Id: string | null;
  level5Id: string | null;
  level6Id: string | null;
  goldenVersionId: number | null;
  lastChangedAtUtc: string | null;
}

/** The 9 columns of gold.vw_equipment_field_current. `lastRequestId` is a bigint, sent as text. */
export interface FieldValueRow {
  equipmentFieldKey: string;
  equipmentId: number;
  fieldCode: string;
  currentValue: string | null;
  baselineValue: string | null;
  unit: string | null;
  valueSource: string | null;
  lastRequestId: string | null;
  lastChangedAtUtc: string | null;
}

/** The 7 columns of app.vw_field_ownership. */
export interface OwnershipRow {
  fieldOwnershipKey: string;
  entityType: string | null;
  fieldCode: string | null;
  label: string | null;
  responsibleRole: string | null;
  accountableRole: string | null;
  routeId: number | null;
}

/** Milliseconds measured inside the function. */
export interface ReadTiming {
  connectMs: number;
  queryMs: number;
  totalMs: number;
}

export interface EquipmentSearchResult {
  rows: EquipmentSearchRow[];
  /** SORTED: every heater that matches (all pages). MATCH: the rows returned. */
  totalMatches: number;
  /** SORTED: another page follows. MATCH: always false. */
  hasMore: boolean;
  /** MATCH: a closeness tier overflowed its cap, so there may be more matches. */
  truncated: boolean;
  timing: ReadTiming;
  /** Why the read failed (text, no token, no row data); null when it worked. See `errorText`. */
  error: string | null;
}

export interface EquipmentDetailResult {
  /** False when no heater has that id (the other parts are then empty). */
  found: boolean;
  heater: EquipmentRow | null;
  floc: FlocRow | null;
  fieldValues: FieldValueRow[];
  ownership: OwnershipRow[];
  timing: ReadTiming;
  /** Why the read failed (text, no token, no row data); null when it worked. See `errorText`. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// The columns each row carries. `Record<keyof T, true>` makes the compiler insist that
// the list names every property of the interface, and nothing else.
// ---------------------------------------------------------------------------

const EQUIPMENT_KEYS: Record<keyof EquipmentRow, true> = {
  equipmentId: true,
  equipmentNumber: true,
  equipmentDescription: true,
  functionalLocation: true,
  flocDescription: true,
  superiorFunctionalLocation: true,
  equipmentTagNumber: true,
  equipClass: true,
  classType: true,
  objectType: true,
  flocClass: true,
  techObjectType: true,
  manufacturer: true,
  modelNumber: true,
  manufacturerSerialNumber: true,
  firedUnfired: true,
  heatDutyMmbtuHr: true,
  heatDutySource: true,
  equipmentUserStatus: true,
  flocUserStatus: true,
  profitCenterName: true,
  plannerGroup: true,
  heaterPopulationMethod: true,
  goldenVersionId: true,
  lastChangedAtUtc: true,
  baselineAsOfUtc: true,
};

const SEARCH_KEYS: Record<keyof EquipmentSearchRow, true> = {
  ...EQUIPMENT_KEYS,
  openRequestCount: true,
  invalidRuleCount: true,
  verificationPct: true,
};

const FLOC_KEYS: Record<keyof FlocRow, true> = {
  functionalLocation: true,
  flocDescription: true,
  superiorFunctionalLocation: true,
  flocClass: true,
  techObjectType: true,
  flocUserStatus: true,
  profitCenterName: true,
  level1Id: true,
  level2Id: true,
  level3Id: true,
  level4Id: true,
  level5Id: true,
  level6Id: true,
  goldenVersionId: true,
  lastChangedAtUtc: true,
};

const FIELD_VALUE_KEYS: Record<keyof FieldValueRow, true> = {
  equipmentFieldKey: true,
  equipmentId: true,
  fieldCode: true,
  currentValue: true,
  baselineValue: true,
  unit: true,
  valueSource: true,
  lastRequestId: true,
  lastChangedAtUtc: true,
};

const OWNERSHIP_KEYS: Record<keyof OwnershipRow, true> = {
  fieldOwnershipKey: true,
  entityType: true,
  fieldCode: true,
  label: true,
  responsibleRole: true,
  accountableRole: true,
  routeId: true,
};

/** Exposed for the unit test: how many columns each row type carries (the contract sizes). */
export const COLUMN_COUNTS = {
  equipment: Object.keys(EQUIPMENT_KEYS).length,
  search: Object.keys(SEARCH_KEYS).length,
  floc: Object.keys(FLOC_KEYS).length,
  fieldValue: Object.keys(FIELD_VALUE_KEYS).length,
  ownership: Object.keys(OWNERSHIP_KEYS).length,
} as const;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const snakeToCamel = (name: string): string =>
  name.replace(/_([a-z0-9])/g, (_match, c: string) => c.toUpperCase());

const camelToSnake = (name: string): string =>
  name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** What a database value looks like to the browser: no undefined, dates as ISO text, bigint as text. */
function plain(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  return value;
}

/** One database row (snake_case) as the typed row: exactly the listed keys, nothing else. */
function mapRow<T>(raw: Record<string, unknown>, keys: Record<keyof T, true>): T {
  const byCamel = new Map<string, unknown>();
  for (const [name, value] of Object.entries(raw)) byCamel.set(snakeToCamel(name), value);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(keys)) out[key] = plain(byCamel.get(key));
  return out as T;
}

const elapsed = (since: number): number => Math.round(performance.now() - since);

/**
 * A failure comes back INSIDE the answer (`error`), it is not thrown. Found 15 Nov: when
 * `getEquipmentDetail` failed on the deployed app the browser received only the platform's
 * "InternalError: An internal execution error occured during function execution", never the
 * message we had thrown, so the cause was invisible. `sqlPing` and `storageProbe` already work
 * this way. The frontend turns `error` back into an exception (`equipment-api.ts`).
 */
function errorText(name: string, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const text = raw.length > 400 ? `${raw.slice(0, 400)}…` : raw;
  console.error(`${name} failed: ${text}`);
  return text;
}

/**
 * What a refused input looked like, for the error text: its kind and, for a plain value, a short
 * rendering (an object shows only its key names). Added 15 Nov: the detail read refused an id
 * that the browser said it sent as a number, and the bare refusal could not tell which side was wrong.
 */
function received(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'object') return `an object with the keys ${Object.keys(value).slice(0, 8).join(', ') || '(none)'}`;
  if (typeof value === 'function') return 'a function';
  return `${typeof value} ${String(value).slice(0, 30)}`;
}

const failedTiming = (since: number): ReadTiming => ({ connectMs: 0, queryMs: 0, totalMs: elapsed(since) });

function requireCaller(accessToken: string | null | undefined): void {
  if (callerId(accessToken).status !== 'OK') {
    throw new Error('You are not signed in, so the equipment cannot be read.');
  }
}

/** Opens a connection as the app identity, runs the work, always closes it. */
async function withPool<T>(
  getSqlToken: () => string,
  work: (pool: ConnectionPool) => Promise<T>
): Promise<{ value: T; timing: ReadTiming }> {
  const started = performance.now();
  let token: string | undefined;
  let pool: ConnectionPool | undefined;
  try {
    token = getSqlToken();
    const connectStart = performance.now();
    pool = await openPool(token);
    const connectMs = elapsed(connectStart);

    const queryStart = performance.now();
    const value = await work(pool);
    const queryMs = elapsed(queryStart);

    return { value, timing: { connectMs, queryMs, totalMs: elapsed(started) } };
  } catch (err) {
    const info = describeSqlError(err, token);
    throw new Error(
      `Could not read the equipment (${info.number ?? 'no error number'}): ${info.message}${info.hint ? ` ${info.hint}` : ''}`
    );
  } finally {
    if (pool) await pool.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// searchEquipment
// ---------------------------------------------------------------------------

/**
 * What the screen asks. Column names are the camelCase names of the row (`equipmentTagNumber`);
 * the procedure checks them against its own lists, this function only makes sure they are plain
 * identifiers before they are turned into column names.
 */
export interface SearchRequest {
  /** MATCH (closest first) or SORTED (one column order, page by page). */
  mode: string;
  /** The column the text is searched in. */
  searchColumn: string;
  searchText: string;
  /** Only heaters under this parent FLOC; empty = all. */
  facility: string;
  sortColumn: string;
  /** asc or desc. */
  sortDirection: string;
  offset: number;
  pageSize: number;
}

const COLUMN_NAME = /^[a-z][A-Za-z0-9]{0,39}$/;
export const MAX_PAGE_SIZE = 100;
const MAX_OFFSET = 1_000_000;

interface CheckedSearch {
  mode: 'MATCH' | 'SORTED';
  searchColumn: string;
  searchText: string;
  facility: string;
  sortColumn: string;
  sortDirection: 'ASC' | 'DESC';
  offset: number;
  pageSize: number;
}

function text(label: string, value: unknown, max: number): string {
  if (typeof value !== 'string') throw new Error(`Invalid search: ${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error(`Invalid search: ${label} is longer than ${max} characters.`);
  return trimmed;
}

function column(label: string, value: unknown): string {
  if (typeof value !== 'string' || !COLUMN_NAME.test(value)) {
    throw new Error(`Invalid search: ${label} is not a column name.`);
  }
  return camelToSnake(value);
}

function whole(label: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid search: ${label} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

/** Input checks only. The search rules (which columns, order, caps) are the procedure's. */
export function checkSearch(request: SearchRequest): CheckedSearch {
  const mode = text('mode', request.mode, 8).toUpperCase();
  if (mode !== 'MATCH' && mode !== 'SORTED') throw new Error('Invalid search: mode must be MATCH or SORTED.');
  const direction = text('sort direction', request.sortDirection, 4).toUpperCase();
  if (direction !== 'ASC' && direction !== 'DESC') throw new Error('Invalid search: sort direction must be asc or desc.');
  return {
    mode,
    searchColumn: column('search column', request.searchColumn),
    searchText: text('search text', request.searchText, 100),
    facility: text('facility', request.facility, 40),
    sortColumn: column('sort column', request.sortColumn),
    sortDirection: direction,
    offset: whole('offset', request.offset, 0, MAX_OFFSET),
    pageSize: whole('page size', request.pageSize, 1, MAX_PAGE_SIZE),
  };
}

const isOn = (value: unknown): boolean => value === true || value === 1;

export async function runEquipmentSearch(
  request: SearchRequest,
  accessToken: string | null | undefined,
  getSqlToken: () => string
): Promise<EquipmentSearchResult> {
  const started = performance.now();
  try {
    return await searchOrThrow(request, accessToken, getSqlToken);
  } catch (err) {
    return {
      rows: [],
      totalMatches: 0,
      hasMore: false,
      truncated: false,
      timing: failedTiming(started),
      error: errorText('searchEquipment', err),
    };
  }
}

async function searchOrThrow(
  request: SearchRequest,
  accessToken: string | null | undefined,
  getSqlToken: () => string
): Promise<EquipmentSearchResult> {
  requireCaller(accessToken);
  const p = checkSearch(request);

  const { value, timing } = await withPool(getSqlToken, (pool) =>
    pool
      .request()
      .input('mode', sql.VarChar(8), p.mode)
      .input('search_column', sql.VarChar(40), p.searchColumn)
      .input('search_text', sql.NVarChar(100), p.searchText)
      .input('facility', sql.NVarChar(40), p.facility)
      .input('sort_column', sql.VarChar(40), p.sortColumn)
      .input('sort_direction', sql.VarChar(4), p.sortDirection)
      .input('offset', sql.Int, p.offset)
      .input('page_size', sql.Int, p.pageSize)
      .output('total_matches', sql.Int)
      .output('has_more', sql.Bit)
      .output('truncated', sql.Bit)
      .execute<Record<string, unknown>>('app.usp_equipment_search')
  );

  const rows = (value.recordset ?? []).map((r) => mapRow<EquipmentSearchRow>(r, SEARCH_KEYS));
  const out = (value.output ?? {}) as Record<string, unknown>;
  const result: EquipmentSearchResult = {
    rows,
    totalMatches: typeof out['total_matches'] === 'number' ? out['total_matches'] : rows.length,
    hasMore: isOn(out['has_more']),
    truncated: isOn(out['truncated']),
    timing,
    error: null,
  };
  console.log(`searchEquipment: mode=${p.mode} rows=${rows.length} totalMs=${timing.totalMs}`);
  return result;
}

// ---------------------------------------------------------------------------
// getEquipmentDetail
// ---------------------------------------------------------------------------

export async function runEquipmentDetail(
  equipmentId: number,
  accessToken: string | null | undefined,
  getSqlToken: () => string
): Promise<EquipmentDetailResult> {
  const started = performance.now();
  try {
    return await detailOrThrow(equipmentId, accessToken, getSqlToken);
  } catch (err) {
    return {
      found: false,
      heater: null,
      floc: null,
      fieldValues: [],
      ownership: [],
      timing: failedTiming(started),
      error: errorText('getEquipmentDetail', err),
    };
  }
}

async function detailOrThrow(
  equipmentId: number,
  accessToken: string | null | undefined,
  getSqlToken: () => string
): Promise<EquipmentDetailResult> {
  requireCaller(accessToken);
  // 0 is a valid id: the synthetic stub's first heater has it (found 15 Nov, APP-2 B6), and the
  // contract only says `int` (FINAL PLAN/01 section 6.1). Whether the id exists is the procedure's answer.
  if (typeof equipmentId !== 'number' || !Number.isInteger(equipmentId) || equipmentId < 0 || equipmentId > 2_147_483_647) {
    throw new Error(
      `Invalid request: the equipment id must be a whole number from 0 to 2147483647 (received ${received(equipmentId)}).`
    );
  }

  const { value, timing } = await withPool(getSqlToken, (pool) =>
    pool
      .request()
      .input('equipment_id', sql.Int, equipmentId)
      .execute<Record<string, unknown>>('app.usp_equipment_detail')
  );

  // Four result sets, always in this order (db/procs/usp_equipment_detail.sql).
  const sets = (value.recordsets ?? []) as unknown as Record<string, unknown>[][];
  const heaterRow = sets[0]?.[0];
  const flocRow = sets[1]?.[0];

  const result: EquipmentDetailResult = {
    found: heaterRow !== undefined,
    heater: heaterRow ? mapRow<EquipmentRow>(heaterRow, EQUIPMENT_KEYS) : null,
    floc: flocRow ? mapRow<FlocRow>(flocRow, FLOC_KEYS) : null,
    fieldValues: (sets[2] ?? []).map((r) => mapRow<FieldValueRow>(r, FIELD_VALUE_KEYS)),
    ownership: (sets[3] ?? []).map((r) => mapRow<OwnershipRow>(r, OWNERSHIP_KEYS)),
    timing,
    error: null,
  };
  console.log(
    `getEquipmentDetail: found=${result.found} fields=${result.fieldValues.length} totalMs=${timing.totalMs}`
  );
  return result;
}
