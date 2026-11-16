import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchBestMatches, fetchSortedPage, type SearchRow } from './equipment-api';
import {
  criteriaKey,
  modeOf,
  pageCount as pageCountOf,
  sliceRows,
  type SearchCriteria,
  type SearchMode,
} from './search-model';

/**
 * Runs the search for the screen S-4 and tracks the page.
 *
 * Two ways of filling the list (`modeOf`):
 *  - match:  a text and no chosen sort. One call returns the closest matches first (the
 *            procedure's rule, capped); the pages are slices of that list in memory.
 *  - sorted: one call per page in the chosen order. The "cursor" is the row offset of the
 *            next page (see equipment-api.ts); the cursor of every page already seen is kept
 *            to let "Previous" work. A new search starts again at page 1.
 *
 * Loading, error and ready are derived: an answer counts only if it belongs to the
 * request now on screen, so a slow old answer can never overwrite a newer one.
 */
export type SearchView =
  | { status: 'loading' }
  | { status: 'error'; message: string; retry: () => void }
  | {
      status: 'ready';
      mode: SearchMode;
      rows: SearchRow[];
      /** 1-based. */
      page: number;
      /** Known only in `match` mode (the whole list is in memory). */
      pageCount: number | null;
      /** Number of matches; known only in `match` mode. */
      total: number | null;
      /** `match` mode only: a query hit its row cap, so there may be more matches. */
      truncated: boolean;
      hasPrevious: boolean;
      hasNext: boolean;
      /** How long the last read took, in milliseconds (spike S7). */
      ms: number;
      next: () => void;
      previous: () => void;
    };

type Answer =
  | { request: string; ok: true; kind: 'match'; rows: SearchRow[]; truncated: boolean; ms: number }
  | { request: string; ok: true; kind: 'sorted'; rows: SearchRow[]; hasNext: boolean; ms: number }
  | { request: string; ok: false; message: string };

const describe = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
};

export function useEquipmentSearch(criteria: SearchCriteria): SearchView {
  const key = criteriaKey(criteria);
  const mode = modeOf(criteria);

  const [pageState, setPageState] = useState({ key, index: 0 });
  const pageIndex = pageState.key === key ? pageState.index : 0;
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const cursors = useRef<{ key: string; list: (string | null)[] }>({ key, list: [null] });

  const request = mode === 'match' ? `${key}|m|${attempt}` : `${key}|s|${pageIndex}|${attempt}`;

  // The effect below must run only when `request` changes (a new search, another page in
  // `sorted` mode, a retry), never when the page changes in `match` mode, where the whole list
  // is already in memory. So it reads everything else from this ref, which is updated first
  // (effects run in the order they are written).
  const latest = useRef({ criteria, mode, key, pageIndex });
  useEffect(() => {
    latest.current = { criteria, mode, key, pageIndex };
  });

  useEffect(() => {
    let cancelled = false;
    const { criteria: c, mode: m, key: k, pageIndex: index } = latest.current;
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);

    if (m === 'match') {
      fetchBestMatches(c).then(
        (r) => {
          if (!cancelled) setAnswer({ request, ok: true, kind: 'match', rows: r.rows, truncated: r.truncated, ms: elapsed() });
        },
        (e: unknown) => {
          if (!cancelled) setAnswer({ request, ok: false, message: describe(e) });
        }
      );
    } else {
      if (cursors.current.key !== k) cursors.current = { key: k, list: [null] };
      const cursor = cursors.current.list[index] ?? null;
      fetchSortedPage(c, cursor).then(
        (r) => {
          if (cancelled) return;
          cursors.current.list[index + 1] = r.endCursor;
          setAnswer({ request, ok: true, kind: 'sorted', rows: r.rows, hasNext: r.hasNext, ms: elapsed() });
        },
        (e: unknown) => {
          if (!cancelled) setAnswer({ request, ok: false, message: describe(e) });
        }
      );
    }
    return () => {
      cancelled = true;
    };
  }, [request]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const goTo = useCallback((index: number) => setPageState({ key, index }), [key]);

  if (answer === null || answer.request !== request) return { status: 'loading' };
  if (!answer.ok) return { status: 'error', message: answer.message, retry };

  if (answer.kind === 'match') {
    const pages = pageCountOf(answer.rows.length, criteria.pageSize);
    const index = Math.min(pageIndex, pages - 1);
    return {
      status: 'ready',
      mode: 'match',
      rows: sliceRows(answer.rows, index, criteria.pageSize),
      page: index + 1,
      pageCount: pages,
      total: answer.rows.length,
      truncated: answer.truncated,
      hasPrevious: index > 0,
      hasNext: index < pages - 1,
      ms: answer.ms,
      next: () => goTo(index + 1),
      previous: () => goTo(Math.max(0, index - 1)),
    };
  }

  return {
    status: 'ready',
    mode: 'sorted',
    rows: answer.rows,
    page: pageIndex + 1,
    pageCount: null,
    total: null,
    truncated: false,
    hasPrevious: pageIndex > 0,
    hasNext: answer.hasNext,
    ms: answer.ms,
    next: () => goTo(pageIndex + 1),
    previous: () => goTo(Math.max(0, pageIndex - 1)),
  };
}
