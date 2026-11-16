import { describe, expect, it } from 'vitest';

import { COLUMNS, DEFAULT_COLUMNS, SEARCH_FIELDS, SEARCH_SELECT, fieldById } from './columns';
import {
  criteriaFromQuery,
  criteriaKey,
  modeOf,
  pageCount,
  queryFromCriteria,
  sliceRows,
  sortOf,
  type SearchCriteria,
} from './search-model';

const q = (text: string) => criteriaFromQuery(new URLSearchParams(text));

describe('columns', () => {
  it('lists every search field once, each on a column the search reads', () => {
    expect(new Set(SEARCH_FIELDS.map((f) => f.id)).size).toBe(SEARCH_FIELDS.length);
    for (const f of SEARCH_FIELDS) expect(SEARCH_SELECT).toContain(f.column);
  });

  it('puts the tag and the serial number first, as field users look for them (POC-APP-05)', () => {
    expect(SEARCH_FIELDS.slice(0, 2).map((f) => f.id)).toEqual(['tag', 'serial']);
    expect(fieldById('nonsense').id).toBe('tag');
  });

  it('only offers columns the search reads, once each, and shows nine by default', () => {
    const names = COLUMNS.map((c) => c.column);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(SEARCH_SELECT).toContain(n);
    expect(DEFAULT_COLUMNS).toHaveLength(9);
  });
});

describe('criteriaFromQuery', () => {
  it('uses defaults for an empty address', () => {
    expect(q('')).toEqual<SearchCriteria>({
      fieldId: 'tag',
      query: '',
      facility: '',
      sort: null,
      direction: 'asc',
      pageSize: 50,
    });
  });

  it('reads a full address', () => {
    expect(q('field=serial&q=%20SYN-SN%20&facility=AREA-01&sort=manufacturer&dir=desc&size=25')).toEqual<SearchCriteria>({
      fieldId: 'serial',
      query: 'SYN-SN',
      facility: 'AREA-01',
      sort: 'manufacturer',
      direction: 'desc',
      pageSize: 25,
    });
  });

  it('falls back to a default for values it does not know', () => {
    const c = q('field=nope&sort=dropTable&dir=sideways&size=7');
    expect(c.fieldId).toBe('tag');
    expect(c.sort).toBeNull();
    expect(c.direction).toBe('asc');
    expect(c.pageSize).toBe(50);
  });

  it('round-trips through the address, leaving defaults out', () => {
    expect(queryFromCriteria(q(''))).toEqual({ field: undefined, q: undefined, facility: undefined, sort: undefined, dir: undefined, size: undefined });
    const c = q('field=floc&q=A&sort=equipClass&dir=desc&size=100');
    expect(criteriaFromQuery(new URLSearchParams(Object.entries(queryFromCriteria(c)).filter(([, v]) => v !== undefined) as [string, string][]))).toEqual(c);
  });
});

describe('modes', () => {
  it('uses closest-match when there is a text and no chosen sort', () => {
    expect(modeOf(q('q=abc'))).toBe('match');
  });

  it('reads page by page in a column order when a sort is chosen or there is no text', () => {
    expect(modeOf(q('q=abc&sort=manufacturer'))).toBe('sorted');
    expect(modeOf(q(''))).toBe('sorted');
    expect(modeOf(q('facility=AREA-01'))).toBe('sorted');
  });

  it('orders by equipment number when nothing else is chosen', () => {
    expect(sortOf(q(''))).toEqual({ column: 'equipmentNumber', direction: 'asc' });
    expect(sortOf(q('sort=manufacturer&dir=desc'))).toEqual({ column: 'manufacturer', direction: 'desc' });
  });

  it('gives a different key for anything that changes the list', () => {
    const base = criteriaKey(q('q=a'));
    expect(criteriaKey(q('q=a'))).toBe(base);
    for (const other of ['q=b', 'field=serial&q=a', 'q=a&facility=X', 'q=a&sort=manufacturer', 'q=a&size=25']) {
      expect(criteriaKey(q(other)), other).not.toBe(base);
    }
  });
});

// The closest-match ordering and the row caps are the procedure's rules now; they are tested
// in db/tests/t_equipment_read.sql (R7 to R9), not here.

describe('paging helpers', () => {
  const rows = Array.from({ length: 125 }, (_, i) => i);

  it('slices a page out of a list in memory', () => {
    expect(sliceRows(rows, 0, 50)).toHaveLength(50);
    expect(sliceRows(rows, 2, 50)).toEqual(rows.slice(100));
    expect(sliceRows(rows, 9, 50)).toEqual([]);
  });

  it('counts pages, at least one even when empty', () => {
    expect(pageCount(125, 50)).toBe(3);
    expect(pageCount(100, 50)).toBe(2);
    expect(pageCount(0, 50)).toBe(1);
  });
});
