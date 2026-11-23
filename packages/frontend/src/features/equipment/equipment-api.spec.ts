import { beforeEach, describe, expect, it, vi } from 'vitest';

const { searchInvoke, detailInvoke, catalogExecute, catalogWhere, catalogOrderBy, catalogSelect } = vi.hoisted(() => {
  // The catalogue chain: select(columns).where(filter).orderBy(order).execute()
  const catalogExecute = vi.fn();
  const catalogOrderBy = vi.fn();
  const catalogWhere = vi.fn();
  const catalogSelect = vi.fn();
  catalogOrderBy.mockReturnValue({ execute: catalogExecute });
  catalogWhere.mockReturnValue({ orderBy: catalogOrderBy });
  catalogSelect.mockReturnValue({ where: catalogWhere });
  return { searchInvoke: vi.fn(), detailInvoke: vi.fn(), catalogExecute, catalogWhere, catalogOrderBy, catalogSelect };
});

vi.mock('@/lib/rayfin-client', () => ({
  getRayfinClient: async () => ({
    functions: {
      searchEquipment: { invoke: searchInvoke },
      getEquipmentDetail: { invoke: detailInvoke },
    },
    connectors: { atlas_sql_db: { FieldCatalog: { select: catalogSelect } } },
  }),
}));

import { fetchHeater, fetchSortedPage, filtersJsonOf } from './equipment-api';
import { criteriaFromQuery } from './search-model';
import { heaterDetail, searchRow } from './test-fixtures';

const criteria = (query: string) => criteriaFromQuery(new URLSearchParams(query));
const TIMING = { connectMs: 1, queryMs: 2, totalMs: 3 };

beforeEach(() => {
  searchInvoke.mockReset();
  detailInvoke.mockReset();
  catalogExecute.mockReset();
  catalogSelect.mockClear();
  catalogWhere.mockClear();
  catalogOrderBy.mockClear();
});

describe('fetchSortedPage', () => {
  it('asks the function for one page in the chosen order, from the start, with the boxes as one JSON text', async () => {
    searchInvoke.mockResolvedValue({ rows: [searchRow(1)], totalMatches: 1, hasMore: false, truncated: false, timing: TIMING, error: null });
    await fetchSortedPage(criteria('f.manufacturer=heat&f.equipClass=fired&facility=AREA-01&sort=manufacturer&dir=desc&size=25'), null);
    expect(searchInvoke).toHaveBeenCalledWith({
      mode: 'SORTED',
      searchColumn: 'equipmentTagNumber', // the older single column and text: not used by the screen, an empty text
      searchText: '',
      facility: 'AREA-01',
      sortColumn: 'manufacturer',
      sortDirection: 'desc',
      offset: 0,
      pageSize: 25,
      filtersJson: '[{"column":"manufacturer","text":"heat"},{"column":"equipClass","text":"fired"}]', // in the order of the columns, not of the address
    });
  });

  it('orders by equipment number when no sort is chosen', async () => {
    searchInvoke.mockResolvedValue({ rows: [], totalMatches: 0, hasMore: false, truncated: false, timing: TIMING, error: null });
    await fetchSortedPage(criteria(''), null);
    expect(searchInvoke.mock.calls[0]?.[0]).toMatchObject({ sortColumn: 'equipmentNumber', sortDirection: 'asc', searchColumn: 'equipmentTagNumber', filtersJson: '' });
  });

  it('uses closest-match mode for the toolbar tag search', async () => {
    searchInvoke.mockResolvedValue({ rows: [searchRow(7)], totalMatches: 1, hasMore: false, truncated: false, timing: TIMING, error: null });
    await fetchSortedPage(criteria('q=SYN-TAG-0007'), null);
    expect(searchInvoke).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'MATCH',
      searchColumn: 'equipmentTagNumber',
      searchText: 'SYN-TAG-0007',
    }));
  });

  it('turns "more pages" into a cursor that is the next row offset, and the last page into no cursor', async () => {
    const rows = [searchRow(1), searchRow(2), searchRow(3)];
    searchInvoke.mockResolvedValueOnce({ rows, totalMatches: 9, hasMore: true, truncated: false, timing: TIMING, error: null });
    const first = await fetchSortedPage(criteria('size=25'), null);
    expect(first).toEqual({ rows, hasNext: true, endCursor: '3', total: 9 });

    searchInvoke.mockResolvedValueOnce({ rows, totalMatches: 9, hasMore: true, truncated: false, timing: TIMING, error: null });
    const second = await fetchSortedPage(criteria('size=25'), first.endCursor);
    expect(searchInvoke.mock.calls[1]?.[0]).toMatchObject({ offset: 3 });
    expect(second.endCursor).toBe('6');

    searchInvoke.mockResolvedValueOnce({ rows: [searchRow(7)], totalMatches: 7, hasMore: false, truncated: false, timing: TIMING, error: null });
    const last = await fetchSortedPage(criteria('size=25'), second.endCursor);
    expect(last).toMatchObject({ hasNext: false, endCursor: null });
  });

  it('starts again at the first row when the cursor is not a row offset', async () => {
    searchInvoke.mockResolvedValue({ rows: [], totalMatches: 0, hasMore: false, truncated: false, timing: TIMING, error: null });
    for (const bad of ['abc', '-5', '1.5']) {
      await fetchSortedPage(criteria(''), bad);
      expect(searchInvoke.mock.lastCall?.[0]).toMatchObject({ offset: 0 });
    }
  });

  it('lets a failure reach the screen', async () => {
    searchInvoke.mockRejectedValue(new Error('Could not read the equipment (50014): that column cannot be searched.'));
    await expect(fetchSortedPage(criteria(''), null)).rejects.toThrow(/50014/);
  });

  it('turns the function\'s own `error` text back into an exception', async () => {
    searchInvoke.mockResolvedValue({ rows: [], totalMatches: 0, hasMore: false, truncated: false, timing: TIMING, error: 'Could not read the equipment (229): permission denied.' });
    await expect(fetchSortedPage(criteria(''), null)).rejects.toThrow(/229.*permission denied/);
  });
});

describe('filtersJsonOf', () => {
  it('is empty text when no box holds text, and a JSON list of column and text otherwise', () => {
    expect(filtersJsonOf([])).toBe('');
    // quotes and backslashes survive the round trip (the procedure reads this text with OPENJSON)
    const text = 'A "B" \\ C';
    expect(filtersJsonOf([{ column: 'manufacturer', text }])).toBe('[{"column":"manufacturer","text":"A \\"B\\" \\\\ C"}]');
    expect(JSON.parse(filtersJsonOf([{ column: 'manufacturer', text }]))).toEqual([{ column: 'manufacturer', text }]);
  });
});

describe('fetchHeater', () => {
  const detail = heaterDetail();
  const answer = {
    found: true,
    heater: detail.heater,
    floc: detail.floc,
    fieldValues: detail.fieldValues,
    ownership: detail.ownership,
    timing: TIMING,
    error: null,
  };

  it('puts the function answer and the catalogue together', async () => {
    detailInvoke.mockResolvedValue(answer);
    catalogExecute.mockResolvedValue(detail.catalog);
    const result = await fetchHeater(1);
    expect(detailInvoke).toHaveBeenCalledWith({ equipmentId: 1 });
    expect(result).toEqual({
      heater: detail.heater,
      floc: detail.floc,
      fieldValues: detail.fieldValues,
      catalog: detail.catalog,
      ownership: detail.ownership,
    });
  });

  it('reads only the active catalogue fields, in display order, through the connector', async () => {
    detailInvoke.mockResolvedValue(answer);
    catalogExecute.mockResolvedValue([]);
    await fetchHeater(1);
    expect(catalogWhere).toHaveBeenCalledWith({ isActive: { eq: true } });
    expect(catalogOrderBy).toHaveBeenCalledWith({ displayOrder: 'asc' });
    expect(catalogSelect.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(['fieldCode', 'label', 'displayGroup', 'displayOrder']));
  });

  it('is null when there is no such heater', async () => {
    detailInvoke.mockResolvedValue({ found: false, heater: null, floc: null, fieldValues: [], ownership: [], timing: TIMING, error: null });
    catalogExecute.mockResolvedValue([]);
    expect(await fetchHeater(999999)).toBeNull();
  });

  it('turns the function\'s own `error` text back into an exception', async () => {
    detailInvoke.mockResolvedValue({ found: false, heater: null, floc: null, fieldValues: [], ownership: [], timing: TIMING, error: 'Could not read the equipment (229): permission denied.' });
    catalogExecute.mockResolvedValue([]);
    await expect(fetchHeater(1)).rejects.toThrow(/229.*permission denied/);
  });

  it('lets a failure of either read reach the screen', async () => {
    detailInvoke.mockRejectedValue(new Error('the function failed'));
    catalogExecute.mockResolvedValue([]);
    await expect(fetchHeater(1)).rejects.toThrow('the function failed');

    detailInvoke.mockResolvedValue(answer);
    catalogExecute.mockRejectedValue(new Error('the catalogue failed'));
    await expect(fetchHeater(1)).rejects.toThrow('the catalogue failed');
  });
});
