import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchSortedPage, type SearchRow } from './equipment-api';
import { passesSelection, selectedCount, type Selection } from './facets';
import { criteriaKey, pageCount as pageCountOf, type SearchCriteria } from './search-model';

/**
 * Every row of screen S-4's search, for the Filter panel's checkboxes.
 *
 * The procedure can only do the boxes' "contains" (no lists of values), and the backend stays as
 * it is, so the ticked values are matched in the browser: every row that the boxes, the facility
 * and the order choose is read (100 per call, a few calls at a time), the rows that pass are kept
 * in the same order, and the pages are cut here. Above MAX_FILTERED_ROWS the read is refused, so a
 * broad search never pulls the whole table: the person narrows it with a box or a facility first.
 */
export const MAX_FILTERED_ROWS = 2000;

/** The rows one call returns; the procedure's own limit. */
const CALL_SIZE = 100;
/** Calls in flight at once. */
const PARALLEL = 4;

/** Every row the search chooses: what the panel lists and counts. */
export type AllRows =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string; retry: () => void }
  | { status: 'too-many'; total: number }
  | { status: 'ready'; rows: SearchRow[] };

/** The table's list while values are ticked; mirrors the paged search's view. */
export type FilteredView =
  | Exclude<AllRows, { status: 'idle' } | { status: 'ready'; rows: SearchRow[] }>
  | {
      status: 'ready';
      rows: SearchRow[];
      /** 1-based. */
      page: number;
      pageCount: number;
      /** Rows that pass (all pages). */
      total: number;
      hasPrevious: boolean;
      hasNext: boolean;
      next: () => void;
      previous: () => void;
    };

class TooManyRows extends Error {
  constructor(readonly total: number) {
    super(`${total} rows`);
  }
}

/** Every row the criteria choose, in their order; refuses more than MAX_FILTERED_ROWS. */
export async function fetchAllMatches(criteria: SearchCriteria): Promise<SearchRow[]> {
  const c = { ...criteria, pageSize: CALL_SIZE };
  const first = await fetchSortedPage(c, null);
  if (first.total > MAX_FILTERED_ROWS) throw new TooManyRows(first.total);
  if (!first.hasNext) return first.rows;

  const offsets: number[] = [];
  for (let offset = first.rows.length; offset < first.total; offset += CALL_SIZE) offsets.push(offset);
  const rows = [...first.rows];
  for (let i = 0; i < offsets.length; i += PARALLEL) {
    const pages = await Promise.all(offsets.slice(i, i + PARALLEL).map((offset) => fetchSortedPage(c, String(offset))));
    for (const page of pages) rows.push(...page.rows);
  }
  return rows;
}

type Answer = { request: string; ok: true; rows: SearchRow[] } | { request: string; ok: false; tooMany: number | null; message: string };

/**
 * `all`: every row, read while `enabled` (the panel is open) or while values are ticked.
 * `list`: the table's rows while values are ticked; null otherwise (the normal paged search is used).
 */
export function useFilteredSearch(criteria: SearchCriteria, selection: Selection, enabled: boolean): { all: AllRows; list: FilteredView | null } {
  // The page size is cut here, so changing it must not read everything again.
  const readKey = criteriaKey({ ...criteria, pageSize: CALL_SIZE });
  const active = selectedCount(selection) > 0;
  const listKey = `${readKey}|${JSON.stringify(selection)}|${criteria.pageSize}`;

  const [pageState, setPageState] = useState({ key: listKey, index: 0 });
  const pageIndex = pageState.key === listKey ? pageState.index : 0;
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const request = enabled || active ? `${readKey}|${attempt}` : '';

  const latest = useRef(criteria);
  useEffect(() => {
    latest.current = criteria;
  });

  useEffect(() => {
    if (request === '') return;
    let cancelled = false;
    fetchAllMatches(latest.current).then(
      (rows) => {
        if (!cancelled) setAnswer({ request, ok: true, rows });
      },
      (e: unknown) => {
        if (cancelled) return;
        const tooMany = e instanceof TooManyRows ? e.total : null;
        setAnswer({ request, ok: false, tooMany, message: e instanceof Error ? e.message : String(e) });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [request]);

  const current = answer !== null && answer.request === request ? answer : null;
  const passing = useMemo(
    () => (active && current?.ok ? current.rows.filter((row) => passesSelection(row, selection)) : []),
    [active, current, selection]
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const goTo = useCallback((index: number) => setPageState({ key: listKey, index }), [listKey]);

  let all: AllRows;
  if (request === '') all = { status: 'idle' };
  else if (current === null) all = { status: 'loading' };
  else if (!current.ok) all = current.tooMany !== null ? { status: 'too-many', total: current.tooMany } : { status: 'error', message: current.message, retry };
  else all = { status: 'ready', rows: current.rows };

  if (!active) return { all, list: null };
  if (all.status !== 'ready') return { all, list: all.status === 'idle' ? { status: 'loading' } : all };

  const size = criteria.pageSize;
  const pages = pageCountOf(passing.length, size);
  const index = Math.min(pageIndex, pages - 1);
  return {
    all,
    list: {
      status: 'ready',
      rows: passing.slice(index * size, (index + 1) * size),
      page: index + 1,
      pageCount: pages,
      total: passing.length,
      hasPrevious: index > 0,
      hasNext: index < pages - 1,
      next: () => goTo(index + 1),
      previous: () => goTo(Math.max(0, index - 1)),
    },
  };
}
