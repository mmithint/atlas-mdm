/**
 * TEMPORARY (APP-2, removed in APP-10): the LATENCY GATE of read path C (decision D-17).
 *
 * Spike S7 first asked "can the connector page through a view?" and the answer was no, so the
 * equipment screens read through the functions `searchEquipment` and `getEquipmentDetail`.
 * The risk that choice carries is time, so this card times the real calls:
 *   A. every page of the whole list, in order, with the offset "cursor" (the screen's own way);
 *   B. one filtered, sorted page;
 *   C. one closest-match search;
 *   D. one heater's detail.
 * Each call is timed in the browser (what a person waits) and carries the time the function
 * measured inside itself (`serverMs`); the difference is the platform: waking an idle
 * function, and the network.
 *
 * The FIRST call is kept apart from the rest. Open the page after about 20 minutes idle and
 * the first call is a cold start; press the button again and every call is warm. Pass rule
 * (FINAL PLAN/03 APP-2, "latency gate"): the warm calls are about two seconds or less.
 *
 * It reports counts and timings only, no heater data, so the result is safe to paste.
 */

export interface PageAnswer {
  /** The key (equipment_id) of every row on the page, in order. */
  keys: number[];
  hasNext: boolean;
  endCursor: string | null;
  /** Milliseconds the function measured inside itself, when it says. */
  serverMs?: number | null;
}

/** What a one-off call reports: how many rows (or 1/0 for "found"), and its own timing. */
export interface TimedAnswer {
  rows: number;
  serverMs: number | null;
}

export interface PagingSpikeDeps {
  /** One page of the whole list in key order. */
  page: (cursor: string | null, size: number) => Promise<PageAnswer>;
  /** One filtered, sorted page. */
  filtered: () => Promise<TimedAnswer>;
  /** One closest-match search. */
  bestMatch: () => Promise<TimedAnswer>;
  /** One heater's detail (rows = 1 when the heater was found, else 0). */
  detail: () => Promise<TimedAnswer>;
}

export interface PagingSpikeResult {
  /** True when every key arrived exactly once, the whole list was read and no step failed. */
  ok: boolean;
  pageSize: number;
  pages: number;
  rows: number;
  distinctKeys: number;
  duplicateKeys: number;
  /** The first call of the run: a cold start if the functions had been idle. */
  firstPageMs: number | null;
  firstPageServerMs: number | null;
  /** Pages after the first (warm). */
  slowestWarmPageMs: number | null;
  averageWarmPageMs: number | null;
  averageWarmServerMs: number | null;
  totalPagingMs: number | null;
  /** Why paging stopped: it reached the last page, or the safety limit. */
  stopped: 'last page' | 'page limit' | 'error';
  filteredSortedPageMs: number | null;
  filteredSortedRows: number | null;
  filteredSortedServerMs: number | null;
  bestMatchMs: number | null;
  bestMatchRows: number | null;
  bestMatchServerMs: number | null;
  detailMs: number | null;
  detailFound: boolean | null;
  detailServerMs: number | null;
  /** The slowest warm call of all four kinds, in milliseconds. */
  slowestWarmCallMs: number | null;
  /** Every warm call is at or under the two-second target. */
  withinTarget: boolean | null;
  /** The first call is at or under it too (false after a long idle means a cold-start problem). */
  firstCallWithinTarget: boolean | null;
  error: string | null;
}

export const TARGET_MS = 2000;
/** The most rows one search call returns (the procedure's own limit). */
export const SPIKE_PAGE_SIZE = 100;

const since = (started: number): number => Math.round(performance.now() - started);
const average = (values: number[]): number | null =>
  values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;

export async function runPagingSpike(
  deps: PagingSpikeDeps,
  pageSize = SPIKE_PAGE_SIZE,
  pageLimit = 40
): Promise<PagingSpikeResult> {
  const result: PagingSpikeResult = {
    ok: false,
    pageSize,
    pages: 0,
    rows: 0,
    distinctKeys: 0,
    duplicateKeys: 0,
    firstPageMs: null,
    firstPageServerMs: null,
    slowestWarmPageMs: null,
    averageWarmPageMs: null,
    averageWarmServerMs: null,
    totalPagingMs: null,
    stopped: 'error',
    filteredSortedPageMs: null,
    filteredSortedRows: null,
    filteredSortedServerMs: null,
    bestMatchMs: null,
    bestMatchRows: null,
    bestMatchServerMs: null,
    detailMs: null,
    detailFound: null,
    detailServerMs: null,
    slowestWarmCallMs: null,
    withinTarget: null,
    firstCallWithinTarget: null,
    error: null,
  };

  const seen = new Set<number>();
  const times: number[] = [];
  const serverTimes: number[] = [];
  let firstServerMs: number | null = null;

  try {
    let cursor: string | null = null;
    const startedAll = performance.now();
    for (;;) {
      const started = performance.now();
      const answer = await deps.page(cursor, pageSize);
      times.push(since(started));
      if (times.length === 1) firstServerMs = answer.serverMs ?? null;
      else if (typeof answer.serverMs === 'number') serverTimes.push(answer.serverMs);
      result.pages += 1;
      for (const key of answer.keys) {
        result.rows += 1;
        if (seen.has(key)) result.duplicateKeys += 1;
        seen.add(key);
      }
      if (!answer.hasNext || !answer.endCursor) {
        result.stopped = 'last page';
        break;
      }
      if (result.pages >= pageLimit) {
        result.stopped = 'page limit';
        break;
      }
      cursor = answer.endCursor;
    }
    result.totalPagingMs = since(startedAll);
    result.distinctKeys = seen.size;
    result.firstPageMs = times[0] ?? null;
    result.firstPageServerMs = firstServerMs;
    const warmPages = times.slice(1);
    result.slowestWarmPageMs = warmPages.length ? Math.max(...warmPages) : null;
    result.averageWarmPageMs = average(warmPages);
    result.averageWarmServerMs = average(serverTimes);

    const warmCalls = [...warmPages];

    const startedFiltered = performance.now();
    const filtered = await deps.filtered();
    result.filteredSortedPageMs = since(startedFiltered);
    result.filteredSortedRows = filtered.rows;
    result.filteredSortedServerMs = filtered.serverMs;
    warmCalls.push(result.filteredSortedPageMs);

    const startedMatch = performance.now();
    const match = await deps.bestMatch();
    result.bestMatchMs = since(startedMatch);
    result.bestMatchRows = match.rows;
    result.bestMatchServerMs = match.serverMs;
    warmCalls.push(result.bestMatchMs);

    const startedDetail = performance.now();
    const detail = await deps.detail();
    result.detailMs = since(startedDetail);
    result.detailFound = detail.rows > 0;
    result.detailServerMs = detail.serverMs;
    warmCalls.push(result.detailMs);

    result.slowestWarmCallMs = Math.max(...warmCalls);
    result.withinTarget = result.slowestWarmCallMs <= TARGET_MS;
    result.firstCallWithinTarget = (result.firstPageMs ?? Infinity) <= TARGET_MS;
    result.ok = result.duplicateKeys === 0 && result.rows > 0 && result.stopped === 'last page';
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    result.error = text.length > 400 ? `${text.slice(0, 400)}…` : text;
    result.stopped = 'error';
    result.distinctKeys = seen.size;
  }
  return result;
}
