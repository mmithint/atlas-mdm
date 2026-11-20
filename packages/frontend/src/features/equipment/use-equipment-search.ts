import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchSortedPage, type SearchRow } from './equipment-api';
import { criteriaKey, pageCount as pageCountOf, type SearchCriteria } from './search-model';

/**
 * Runs the search for the screen S-4 and tracks the page.
 *
 * One call per page, in the chosen order (the column filters, the facility and the order are the
 * procedure's). The "cursor" is the row offset of the next page (see equipment-api.ts); the cursor
 * of every page already seen is kept to let "Previous" work. A new search starts again at page 1.
 * The closest-match mode of the procedure is not used here any more (CR-1, 19 Nov).
 *
 * Loading, error and ready are derived: an answer counts only if it belongs to the
 * request now on screen, so a slow old answer can never overwrite a newer one.
 */
export type SearchView =
  | { status: 'loading' }
  | { status: 'error'; message: string; retry: () => void }
  | {
      status: 'ready';
      rows: SearchRow[];
      /** 1-based. */
      page: number;
      pageCount: number;
      /** Every heater that matches the filters and the facility (all pages). */
      total: number;
      hasPrevious: boolean;
      hasNext: boolean;
      /** How long the last read took, in milliseconds (spike S7). */
      ms: number;
      next: () => void;
      previous: () => void;
    };

type Answer =
  | { request: string; ok: true; rows: SearchRow[]; hasNext: boolean; total: number; ms: number }
  | { request: string; ok: false; message: string };

const describe = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
};

export function useEquipmentSearch(criteria: SearchCriteria): SearchView {
  const key = criteriaKey(criteria);

  const [pageState, setPageState] = useState({ key, index: 0 });
  const pageIndex = pageState.key === key ? pageState.index : 0;
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const cursors = useRef<{ key: string; list: (string | null)[] }>({ key, list: [null] });

  const request = `${key}|${pageIndex}|${attempt}`;

  // The effect below must run only when `request` changes (a new search, another page, a retry),
  // never because the caller built a new but equal `criteria` object. So it reads everything else
  // from this ref, which is updated first (effects run in the order they are written).
  const latest = useRef({ criteria, key, pageIndex });
  useEffect(() => {
    latest.current = { criteria, key, pageIndex };
  });

  useEffect(() => {
    let cancelled = false;
    const { criteria: c, key: k, pageIndex: index } = latest.current;
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);

    if (cursors.current.key !== k) cursors.current = { key: k, list: [null] };
    const cursor = cursors.current.list[index] ?? null;
    fetchSortedPage(c, cursor).then(
      (r) => {
        if (cancelled) return;
        cursors.current.list[index + 1] = r.endCursor;
        setAnswer({ request, ok: true, rows: r.rows, hasNext: r.hasNext, total: r.total, ms: elapsed() });
      },
      (e: unknown) => {
        if (!cancelled) setAnswer({ request, ok: false, message: describe(e) });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [request]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const goTo = useCallback((index: number) => setPageState({ key, index }), [key]);

  if (answer === null || answer.request !== request) return { status: 'loading' };
  if (!answer.ok) return { status: 'error', message: answer.message, retry };

  return {
    status: 'ready',
    rows: answer.rows,
    page: pageIndex + 1,
    pageCount: pageCountOf(answer.total, criteria.pageSize),
    total: answer.total,
    hasPrevious: pageIndex > 0,
    hasNext: answer.hasNext,
    ms: answer.ms,
    next: () => goTo(pageIndex + 1),
    previous: () => goTo(Math.max(0, pageIndex - 1)),
  };
}
