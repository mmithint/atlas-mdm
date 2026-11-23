import { describe, expect, it } from 'vitest';

import { COLUMNS, DEFAULT_COLUMNS, FILTER_COLUMNS, MAX_FILTER_TEXT, SEARCH_SELECT, isFilterColumn } from './columns';
import {
  criteriaFromQuery,
  criteriaKey,
  filtersFromValues,
  pageCount,
  queryFromCriteria,
  sortOf,
  valuesFromFilters,
  type SearchCriteria,
} from './search-model';

const q = (text: string) => criteriaFromQuery(new URLSearchParams(text));

describe('columns', () => {
  it('only offers columns the search reads, once each, and shows nine by default', () => {
    const names = COLUMNS.map((c) => c.column);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(SEARCH_SELECT).toContain(n);
    expect(DEFAULT_COLUMNS).toHaveLength(9);
  });

  it('gives a filter box to the 20 text columns, and none to counts, percentages, decimals and dates', () => {
    expect(FILTER_COLUMNS).toHaveLength(20);
    for (const c of COLUMNS) {
      const text = ['tag', 'plate', 'facility', 'text', 'class', 'fired', 'status'].includes(c.kind);
      expect(isFilterColumn(c.column), c.column).toBe(text);
    }
    for (const none of ['openRequestCount', 'verificationPct', 'heatDutyMmbtuHr', 'invalidRuleCount', 'lastChangedAtUtc']) {
      expect(isFilterColumn(none)).toBe(false);
    }
  });

  it('keeps the tag, serial number and equipment number first, as field users look for them (POC-APP-05)', () => {
    expect(FILTER_COLUMNS.slice(0, 3)).toEqual(['equipmentTagNumber', 'manufacturerSerialNumber', 'equipmentNumber']);
  });
});

describe('criteriaFromQuery', () => {
  it('uses defaults for an empty address', () => {
    expect(q('')).toEqual<SearchCriteria>({ filters: [], facility: '', sort: null, direction: 'asc', pageSize: 50 });
  });

  it('reads a full address, filters in the order of the columns, not of the address', () => {
    expect(q('f.manufacturer=%20heat%20&f.equipmentTagNumber=SYN-TAG&facility=AREA-01&sort=manufacturer&dir=desc&size=25')).toEqual<SearchCriteria>({
      filters: [
        { column: 'equipmentTagNumber', text: 'SYN-TAG' },
        { column: 'manufacturer', text: 'heat' },
      ],
      facility: 'AREA-01',
      sort: 'manufacturer',
      direction: 'desc',
      pageSize: 25,
    });
  });

  it('falls back to a default for values it does not know, and drops filters it cannot use', () => {
    const c = q('sort=dropTable&dir=sideways&size=7&f.openRequestCount=3&f.nonsense=x&f.manufacturer=%20%20&q=old&field=serial');
    expect(c.sort).toBeNull();
    expect(c.direction).toBe('asc');
    expect(c.pageSize).toBe(50);
    expect(c.filters).toEqual([]); // not a filter column, unknown column, blank box; the old ?q= and ?field= are ignored
  });

  it('cuts a filter text to the longest the backend accepts', () => {
    expect(q(`f.manufacturer=${'x'.repeat(150)}`).filters[0]?.text).toHaveLength(MAX_FILTER_TEXT);
  });

  it('round-trips through the address, leaving defaults out', () => {
    expect(queryFromCriteria(q(''))).toEqual({ facility: undefined, sort: undefined, dir: undefined, size: undefined });
    const c = q('f.equipClass=fired&f.manufacturer=A%26B&facility=X&sort=equipClass&dir=desc&size=100');
    const query = Object.entries(queryFromCriteria(c)).filter(([, v]) => v !== undefined) as [string, string][];
    expect(criteriaFromQuery(new URLSearchParams(query))).toEqual(c);
    expect(new URLSearchParams(query).get('f.manufacturer')).toBe('A&B');
  });
});

describe('the boxes', () => {
  it('turns typed text into filters: trimmed, blank boxes dropped, in column order', () => {
    expect(filtersFromValues({ manufacturer: '  heat  ', equipClass: '   ', equipmentTagNumber: 'T' })).toEqual([
      { column: 'equipmentTagNumber', text: 'T' },
      { column: 'manufacturer', text: 'heat' },
    ]);
    expect(filtersFromValues({})).toEqual([]);
  });

  it('puts applied filters back into the boxes', () => {
    const filters = [{ column: 'manufacturer' as const, text: 'heat' }];
    expect(valuesFromFilters(filters)).toEqual({ manufacturer: 'heat' });
    expect(filtersFromValues(valuesFromFilters(filters))).toEqual(filters);
  });
});

describe('order and key', () => {
  it('orders by equipment number when nothing else is chosen', () => {
    expect(sortOf(q(''))).toEqual({ column: 'equipmentNumber', direction: 'asc' });
    expect(sortOf(q('sort=manufacturer&dir=desc'))).toEqual({ column: 'manufacturer', direction: 'desc' });
  });

  it('gives a different key for anything that changes the list', () => {
    const base = criteriaKey(q('f.manufacturer=a'));
    expect(criteriaKey(q('f.manufacturer=a'))).toBe(base);
    for (const other of ['f.manufacturer=b', 'f.equipClass=a', 'f.manufacturer=a&f.equipClass=a', 'f.manufacturer=a&facility=X', 'f.manufacturer=a&sort=manufacturer', 'f.manufacturer=a&size=25']) {
      expect(criteriaKey(q(other)), other).not.toBe(base);
    }
  });
});

// The AND, the order and the paging are the procedure's rules; they are tested in
// db/tests/t_equipment_read.sql (R2 to R6 and R13 to R16), not here.

describe('paging helper', () => {
  it('counts pages, at least one even when empty', () => {
    expect(pageCount(125, 50)).toBe(3);
    expect(pageCount(100, 50)).toBe(2);
    expect(pageCount(0, 50)).toBe(1);
  });
});
