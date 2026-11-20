import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchSortedPage } = vi.hoisted(() => ({ fetchSortedPage: vi.fn() }));
vi.mock('./equipment-api', () => ({ fetchSortedPage }));

import { criteriaFromQuery } from './search-model';
import { searchRow } from './test-fixtures';
import { useEquipmentSearch } from './use-equipment-search';

const criteria = (text: string) => criteriaFromQuery(new URLSearchParams(text));
const rows = (from: number, count: number) => Array.from({ length: count }, (_, i) => searchRow(from + i));

describe('useEquipmentSearch', () => {
  beforeEach(() => {
    fetchSortedPage.mockReset();
  });

  it('loads the first page, then goes forward with the cursor and back again', async () => {
    fetchSortedPage
      .mockResolvedValueOnce({ rows: rows(1, 50), hasNext: true, endCursor: 'CURSOR-1', total: 100 })
      .mockResolvedValueOnce({ rows: rows(51, 50), hasNext: false, endCursor: null, total: 100 })
      .mockResolvedValueOnce({ rows: rows(1, 50), hasNext: true, endCursor: 'CURSOR-1', total: 100 });
    const { result } = renderHook(() => useEquipmentSearch(criteria('')));

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    if (result.current.status !== 'ready') throw new Error('not ready');
    expect(result.current).toMatchObject({ page: 1, pageCount: 2, total: 100, hasNext: true, hasPrevious: false });
    expect(fetchSortedPage).toHaveBeenLastCalledWith(expect.objectContaining({ pageSize: 50 }), null);

    act(() => (result.current as { next: () => void }).next());
    await waitFor(() => expect(fetchSortedPage).toHaveBeenCalledTimes(2));
    expect(fetchSortedPage).toHaveBeenLastCalledWith(expect.anything(), 'CURSOR-1');
    await waitFor(() => expect(result.current).toMatchObject({ status: 'ready', page: 2, hasNext: false, hasPrevious: true }));

    act(() => (result.current as { previous: () => void }).previous());
    await waitFor(() => expect(fetchSortedPage).toHaveBeenCalledTimes(3));
    expect(fetchSortedPage).toHaveBeenLastCalledWith(expect.anything(), null);
    await waitFor(() => expect(result.current).toMatchObject({ status: 'ready', page: 1 }));
  });

  it('passes the column filters on, and reports how many heaters match', async () => {
    fetchSortedPage.mockResolvedValue({ rows: rows(1, 3), hasNext: false, endCursor: null, total: 3 });
    const { result } = renderHook(() => useEquipmentSearch(criteria('f.manufacturer=heat&f.equipClass=fired')));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ total: 3, pageCount: 1, page: 1 });
    expect(fetchSortedPage.mock.calls[0]?.[0].filters).toEqual([
      { column: 'manufacturer', text: 'heat' },
      { column: 'equipClass', text: 'fired' },
    ]);
  });

  it('starts again at page 1 when the search changes', async () => {
    fetchSortedPage.mockResolvedValue({ rows: rows(1, 3), hasNext: true, endCursor: 'C', total: 9 });
    const { result, rerender } = renderHook(({ c }) => useEquipmentSearch(c), { initialProps: { c: criteria('') } });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => (result.current as { next: () => void }).next());
    await waitFor(() => expect(result.current).toMatchObject({ status: 'ready', page: 2 }));

    rerender({ c: criteria('f.manufacturer=heat') });
    await waitFor(() => expect(result.current).toMatchObject({ status: 'ready', page: 1 }));
    expect(fetchSortedPage).toHaveBeenLastCalledWith(expect.objectContaining({ filters: [{ column: 'manufacturer', text: 'heat' }] }), null);
  });

  it('does not search again when the caller hands in an equal but new criteria object', async () => {
    fetchSortedPage.mockResolvedValue({ rows: rows(1, 2), hasNext: false, endCursor: null, total: 2 });
    const { result, rerender } = renderHook(({ c }) => useEquipmentSearch(c), { initialProps: { c: criteria('f.manufacturer=heat') } });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ c: criteria('f.manufacturer=heat') });
    rerender({ c: criteria('f.manufacturer=heat') });
    expect(fetchSortedPage).toHaveBeenCalledTimes(1);
  });

  it('shows an error and loads again on retry', async () => {
    fetchSortedPage.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ rows: rows(1, 2), hasNext: false, endCursor: null, total: 2 });
    const { result } = renderHook(() => useEquipmentSearch(criteria('')));
    await waitFor(() => expect(result.current.status).toBe('error'));
    if (result.current.status !== 'error') throw new Error('not an error');
    expect(result.current.message).toBe('boom');

    act(() => (result.current as { retry: () => void }).retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(fetchSortedPage).toHaveBeenCalledTimes(2);
  });

  it('shows no rows, and one page, for no matches', async () => {
    fetchSortedPage.mockResolvedValue({ rows: [], hasNext: false, endCursor: null, total: 0 });
    const { result } = renderHook(() => useEquipmentSearch(criteria('f.manufacturer=nothing')));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ total: 0, pageCount: 1, rows: [] });
  });

  it('ignores an old answer that arrives after a newer search was started', async () => {
    let releaseOld: (v: unknown) => void = () => undefined;
    fetchSortedPage
      .mockReturnValueOnce(new Promise((resolve) => (releaseOld = resolve)))
      .mockResolvedValueOnce({ rows: [searchRow(99)], hasNext: false, endCursor: null, total: 1 });
    const { result, rerender } = renderHook(({ c }) => useEquipmentSearch(c), { initialProps: { c: criteria('') } });

    rerender({ c: criteria('facility=NEW') });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => releaseOld({ rows: [searchRow(1)], hasNext: false, endCursor: null, total: 1 }));

    if (result.current.status !== 'ready') throw new Error('not ready');
    expect(result.current.rows.map((r) => r.equipmentId)).toEqual([99]);
  });
});
