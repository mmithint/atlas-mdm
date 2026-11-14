import { describe, expect, it } from 'vitest';

import { parseRoute } from './use-hash-route';

describe('parseRoute', () => {
  it.each([
    ['', 'notes'],
    ['#', 'notes'],
    ['#/', 'notes'],
    ['#/notes', 'notes'],
    ['#/other', 'notes'],
    ['#/spikesx', 'notes'],
    ['#/spikes', 'spikes'],
    ['#spikes', 'spikes'],
    ['#/spikes/', 'spikes'],
    ['#/spikes?run=1', 'spikes'],
  ])('maps %j to %s', (hash, route) => {
    expect(parseRoute(hash)).toBe(route);
  });
});
