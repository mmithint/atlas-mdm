import { describe, expect, it } from 'vitest';

import { BLANK_VALUE } from './facets';
import { STATS, selectionAfterClick, statValues } from './stats';
import { searchRow } from './test-fixtures';

const rows = [
  searchRow(1, { verificationPct: 100, openRequestCount: 2, heatDutyMmbtuHr: 2.5, manufacturer: 'A' }),
  searchRow(2, { verificationPct: 100, openRequestCount: 0, heatDutyMmbtuHr: null, manufacturer: 'B' }),
  searchRow(3, { verificationPct: 20, openRequestCount: 1, heatDutyMmbtuHr: null, manufacturer: 'A' }),
  searchRow(4, { verificationPct: 60, openRequestCount: 0, heatDutyMmbtuHr: 1, manufacturer: 'A' }),
];
const byId = (selection = {}) => Object.fromEntries(statValues(rows, selection).map((v) => [v.def.id, v]));
const def = (id: string) => STATS.find((s) => s.id === id)!;

describe('equipment metric cards', () => {
  it('counts every card from the rows of the search', () => {
    const v = byId();
    expect([v.all!.count, v.verified!.count, v.low!.count, v.open!.count, v.duty!.count]).toEqual([4, 2, 1, 2, 2]);
    expect(v.verified!.of).toBe(4);
    expect(v.all!.active).toBe(true);
  });

  it('follows the ticked filters, leaving a card own field out of its count', () => {
    const v = byId({ manufacturer: ['A'], verificationPct: ['done'] });
    expect(v.all!.count).toBe(1);
    // verified: among manufacturer A (3 heaters), whatever Verified is ticked
    expect([v.verified!.count, v.verified!.of, v.verified!.active]).toEqual([1, 3, true]);
    expect(v.low!.count).toBe(1);
    // the other cards respect both ticks
    expect([v.open!.count, v.duty!.count]).toEqual([1, 0]);
    expect(v.all!.active).toBe(false);
  });

  it('toggles a card filter, keeps the other filters, and lets the total clear them all', () => {
    const on = selectionAfterClick(def('duty'), { manufacturer: ['A'] });
    expect(on).toEqual({ manufacturer: ['A'], heatDutyMmbtuHr: [BLANK_VALUE] });
    expect(selectionAfterClick(def('duty'), on)).toEqual({ manufacturer: ['A'] });
    expect(selectionAfterClick(def('low'), { verificationPct: ['done'] })).toEqual({ verificationPct: ['low'] });
    expect(selectionAfterClick(def('all'), on)).toEqual({});
  });

  it('counts nothing in an empty search', () => {
    expect(statValues([], {}).map((v) => [v.count, v.of])).toEqual(STATS.map(() => [0, 0]));
  });
});
