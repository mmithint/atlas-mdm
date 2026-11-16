import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchSortedPage, fetchBestMatches } = vi.hoisted(() => ({
  fetchSortedPage: vi.fn(),
  fetchBestMatches: vi.fn(),
}));
vi.mock('./equipment-api', () => ({ fetchSortedPage, fetchBestMatches }));

import { criteriaFromQuery } from './search-model';
import { searchRow } from './test-fixtures';
import { useEquipmentSearch } from './use-equipment-search';

const criteria = (text: string) => criteriaFromQuery(new URLSearchParams(text));
const rows = (from: number, count: number) => Array.from({ length: count }, (_, i) => searchRow(from + i));

describe('useEquipmentSearch, sorted mode (no text, or a chosen sort)', () => {
  beforeEach(() => {
    fetchSortedPage.mockReset();
    fetchBestMatches.mockReset();
  });

  it('loads the first page, then goes forward with the cursor and back again', async () => {
    fetchSortedPage
      .mockResolvedValueOnce({ rows: rows(1, 50), hasNext: true, endCursor: 'CURSOR-1' })
      .mockResolvedValueOnce({ rows: rows(51, 50), hasNext: false, endCursor: null })
      .mockResolvedValueOnce({ rows: rows(1, 50), hasNext: true, endCursor: 'CURSOR-1' });
    const { result } = renderHook(() => useEquipmentSearch(criteria('')));

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    if (result.current.status !== 'ready') throw new Error('not ready');
    expect(result.current).toMatchObject({ mode: 'sorted', page: 1, hasNext: true, hasPrevious: false, total: null });
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

  it('starts again at page 1 when the search changes', async () => {
    fetchSortedPage.mockResolvedValue({ rows: rows(1, 3), hasNext: true, endCursor: 'C' });
    const { result, rerender } = renderHook(({ c }) => useEquipmentSearch(c), { initialProps: { c: criteria('') } });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => (result.current as { next: () => void }).next());
    await waitFor(() => expect(result.current).toMatchObject({ status: 'ready', page: 2 }));

    rerender({ c: criteria('facility=SYN-FL-AREA-01') });
    await waitFor(() => expect(result.current).toMatchObject({ status: 'ready', page: 1 }));
    expect(fetchSortedPage).toHaveBeenLastCalledWith(expect.objectContaining({ facility: 'SYN-FL-AREA-01' }), null);
  });

  it('shows an error and loads again on retry', async () => {
    fetchSortedPage.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ rows: rows(1, 2), hasNext: false, endCursor: null });
    const { result } = renderHook(() => useEquipmentSearch(criteria('')));
    await waitFor(() => expect(result.current.status).toBe('error'));
    if (result.current.status !== 'error') throw new Error('not an error');
    expect(result.current.message).toBe('boom');

    act(() => (result.current as { retry: () => void }).retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(fetchSortedPage).toHaveBeenCalledTimes(2);
  });

  it('ignores an old answer that arrives after a newer search was started', async () => {
    let releaseOld: (v: unknown) => void = () => undefined;
    fetchSortedPage
      .mockReturnValueOnce(new Promise((resolve) => (releaseOld = resolve)))
      .mockResolvedValueOnce({ rows: [searchRow(99)], hasNext: false, endCursor: null });
    const { result, rerender } = renderHook(({ c }) => useEquipmentSearch(c), { initialProps: { c: criteria('') } });

    rerender({ c: criteria('facility=NEW') });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => releaseOld({ rows: [searchRow(1)], hasNext: false, endCursor: null }));

    if (result.current.status !== 'ready') throw new Error('not ready');
    expect(result.current.rows.map((r) => r.equipmentId)).toEqual([99]);
  });
});

describe('useEquipmentSearch, match mode (a text and no chosen sort)', () => {
  beforeEach(() => {
    fetchSortedPage.mockReset();
    fetchBestMatches.mockReset();
  });

  it('asks once and pages through the list in memory', async () => {
    fetchBestMatches.mockResolvedValue({ rows: rows(1, 120), truncated: false });
    const { result } = renderHook(() => useEquipmentSearch(criteria('q=SYN&size=50')));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    if (result.current.status !== 'ready') throw new Error('not ready');
    expect(result.current).toMatchObject({ mode: 'match', page: 1, pageCount: 3, total: 120, hasNext: true, hasPrevious: false });
    expect(result.current.rows).toHaveLength(50);

    act(() => (result.current as { next: () => void }).next());
    await waitFor(() => expect(result.current).toMatchObject({ page: 2 }));
    act(() => (result.current as { next: () => void }).next());
    await waitFor(() => expect(result.current).toMatchObject({ page: 3, hasNext: false }));
    if (result.current.status !== 'ready') throw new Error('not ready');
    expect(result.current.rows).toHaveLength(20);
    expect(result.current.rows[0]?.equipmentId).toBe(101);
    expect(fetchBestMatches).toHaveBeenCalledTimes(1);
    expect(fetchSortedPage).not.toHaveBeenCalled();
  });

  it('passes on that more matches may exist', async () => {
    fetchBestMatches.mockResolvedValue({ rows: rows(1, 5), truncated: true });
    const { result } = renderHook(() => useEquipmentSearch(criteria('q=S')));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ truncated: true });
  });

  it('shows no rows for no matches', async () => {
    fetchBestMatches.mockResolvedValue({ rows: [], truncated: false });
    const { result } = renderHook(() => useEquipmentSearch(criteria('q=nothing')));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ total: 0, pageCount: 1, rows: [] });
  });
});
