import { afterEach, describe, expect, it, vi } from 'vitest';

import { TARGET_MS, runPagingSpike, type PageAnswer, type PagingSpikeDeps, type TimedAnswer } from './s7-paging';

/** A fake clock the fake calls advance, so timings are exact and nothing sleeps. */
function useFakeClock() {
  const clock = { now: 0 };
  vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
  return clock;
}

/** A fake list of `total` rows served `size` at a time through string cursors. */
function fakeView(total: number, serverMs: number | null = 5, onCall?: (n: number) => void) {
  let calls = 0;
  return async (cursor: string | null, size: number): Promise<PageAnswer> => {
    onCall?.(++calls);
    const start = cursor ? Number(cursor) : 0;
    const end = Math.min(total, start + size);
    return {
      keys: Array.from({ length: end - start }, (_, i) => start + i + 1),
      hasNext: end < total,
      endCursor: end < total ? String(end) : null,
      serverMs,
    };
  };
}

const one = (rows = 1, serverMs: number | null = 3): TimedAnswer => ({ rows, serverMs });
const deps = (page: PagingSpikeDeps['page'], over: Partial<PagingSpikeDeps> = {}): PagingSpikeDeps => ({
  page,
  filtered: async () => one(50),
  bestMatch: async () => one(8),
  detail: async () => one(1),
  ...over,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runPagingSpike', () => {
  it('reads every row once, page by page, and passes', async () => {
    const result = await runPagingSpike(deps(fakeView(2530)), 500);
    expect(result).toMatchObject({
      ok: true,
      pages: 6,
      rows: 2530,
      distinctKeys: 2530,
      duplicateKeys: 0,
      stopped: 'last page',
      filteredSortedRows: 50,
      filteredSortedServerMs: 3,
      bestMatchRows: 8,
      detailFound: true,
      detailServerMs: 3,
      firstPageServerMs: 5,
      averageWarmServerMs: 5,
      withinTarget: true,
      firstCallWithinTarget: true,
      error: null,
    });
  });

  it('fails when a key arrives twice', async () => {
    const result = await runPagingSpike(
      deps(async (cursor) =>
        cursor === null
          ? { keys: [1, 2, 3], hasNext: true, endCursor: 'x' }
          : { keys: [3, 4], hasNext: false, endCursor: null }
      ),
      3
    );
    expect(result.ok).toBe(false);
    expect(result.duplicateKeys).toBe(1);
    expect(result.distinctKeys).toBe(4);
  });

  it('stops at the page limit instead of running for ever, and does not pass', async () => {
    const result = await runPagingSpike(deps(fakeView(1_000_000)), 100, 5);
    expect(result.pages).toBe(5);
    expect(result.stopped).toBe('page limit');
    expect(result.ok).toBe(false);
  });

  it('reports an error from a function without throwing, with what was read so far', async () => {
    let calls = 0;
    const result = await runPagingSpike(
      deps(async (cursor, size) => {
        if (++calls === 3) throw new Error('the function failed');
        return fakeView(10_000)(cursor, size);
      }),
      100
    );
    expect(result.ok).toBe(false);
    expect(result.stopped).toBe('error');
    expect(result.error).toBe('the function failed');
    expect(result.distinctKeys).toBe(200);
  });

  it('keeps the first call apart from the warm ones: a slow cold start does not hide fast warm calls', async () => {
    const clock = useFakeClock();
    const page = fakeView(300, 40, (n) => {
      clock.now += n === 1 ? 4500 : 300; // the first call is a cold start
    });
    const result = await runPagingSpike(
      deps(page, {
        filtered: async () => {
          clock.now += 350;
          return one(50);
        },
        bestMatch: async () => {
          clock.now += 400;
          return one(8);
        },
        detail: async () => {
          clock.now += 250;
          return one(1);
        },
      }),
      100
    );
    expect(result.pages).toBe(3);
    expect(result.firstPageMs).toBe(4500);
    expect(result.slowestWarmPageMs).toBe(300);
    expect(result.averageWarmPageMs).toBe(300);
    expect(result.filteredSortedPageMs).toBe(350);
    expect(result.bestMatchMs).toBe(400);
    expect(result.detailMs).toBe(250);
    expect(result.slowestWarmCallMs).toBe(400);
    expect(result.withinTarget).toBe(true); // every warm call is under 2 s
    expect(result.firstCallWithinTarget).toBe(false); // the cold start is not
  });

  it('fails the gate when a warm call is slower than the target', async () => {
    const clock = useFakeClock();
    const result = await runPagingSpike(
      deps(fakeView(200, 5, () => (clock.now += 100)), {
        detail: async () => {
          clock.now += TARGET_MS + 1;
          return one(1);
        },
      }),
      100
    );
    expect(result.withinTarget).toBe(false);
    expect(result.slowestWarmCallMs).toBe(TARGET_MS + 1);
  });

  it('says a heater was not found when the detail call finds none', async () => {
    const result = await runPagingSpike(deps(fakeView(10), { detail: async () => one(0, null) }), 5);
    expect(result.detailFound).toBe(false);
    expect(result.detailServerMs).toBeNull();
  });

  it('carries only counts and timings, never row data', async () => {
    const result = await runPagingSpike(deps(fakeView(10)), 5);
    expect(Object.values(result).every((v) => v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string')).toBe(true);
  });
});
