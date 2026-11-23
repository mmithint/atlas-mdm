import { describe, expect, it } from 'vitest';

import { BLANK_VALUE, FACETS, cleared, facetOptions, facetUseful, passesSelection, selectedCount, toggled, type Facet } from './facets';
import { searchRow } from './test-fixtures';

const facet = (id: string): Facet => FACETS.find((f) => f.id === id)!;

const rows = [
  searchRow(1, { manufacturer: 'Demo Thermal Inc.', equipClass: 'HEATER', verificationPct: 100 }),
  searchRow(2, { manufacturer: 'Example Heater Co.', equipClass: 'LINE_HEATER', verificationPct: 60 }),
  searchRow(3, { manufacturer: 'Demo Thermal Inc.', equipClass: 'LINE_HEATER', verificationPct: 20 }),
  searchRow(4, { manufacturer: null, equipClass: 'HEATER', verificationPct: null }),
];

describe('filter facets', () => {
  it('lists each value with how many rows have it, blanks last as "Not set"', () => {
    expect(facetOptions(rows, facet('manufacturer'), {}).map((o) => [o.label, o.count])).toEqual([
      ['Demo Thermal Inc.', 2],
      ['Example Heater Co.', 1],
      ['Not set', 1],
    ]);
  });

  it('offers numbers as ranges, in a fixed order', () => {
    expect(facetOptions(rows, facet('verificationPct'), {}).map((o) => [o.label, o.count])).toEqual([
      ['100%', 1],
      ['50–99%', 1],
      ['Under 50%', 1],
      ['Not available', 1],
    ]);
  });

  it('widens within a facet (any ticked value) and narrows across facets (every facet)', () => {
    const either = { manufacturer: ['Demo Thermal Inc.', 'Example Heater Co.'] };
    expect(rows.filter((r) => passesSelection(r, either)).map((r) => r.equipmentId)).toEqual([1, 2, 3]);
    const both = { ...either, equipClass: ['LINE_HEATER'] };
    expect(rows.filter((r) => passesSelection(r, both)).map((r) => r.equipmentId)).toEqual([2, 3]);
    expect(rows.filter((r) => passesSelection(r, { manufacturer: [BLANK_VALUE] })).map((r) => r.equipmentId)).toEqual([4]);
  });

  it('counts each option against the other facets only, so a second tick shows what it adds', () => {
    const selection = { equipClass: ['LINE_HEATER'], manufacturer: ['Demo Thermal Inc.'] };
    const manufacturers = facetOptions(rows, facet('manufacturer'), selection);
    expect(manufacturers.find((o) => o.label === 'Example Heater Co.')).toMatchObject({ count: 1, checked: false });
    expect(manufacturers.find((o) => o.label === 'Demo Thermal Inc.')).toMatchObject({ count: 1, checked: true });
  });

  it('ticks, unticks and clears values, and counts them', () => {
    let s = toggled({}, 'manufacturer', 'A');
    s = toggled(s, 'manufacturer', 'B');
    s = toggled(s, 'equipClass', 'HEATER');
    expect(selectedCount(s)).toBe(3);
    s = toggled(s, 'manufacturer', 'A');
    expect(s).toEqual({ manufacturer: ['B'], equipClass: ['HEATER'] });
    expect(cleared(s, 'manufacturer')).toEqual({ equipClass: ['HEATER'] });
    expect(toggled({ equipClass: ['HEATER'] }, 'equipClass', 'HEATER')).toEqual({});
  });

  it('hides a facet whose every row has the same value, unless something in it is ticked', () => {
    const same = [searchRow(1), searchRow(2)];
    expect(facetUseful(facetOptions(same, facet('firedUnfired'), {}))).toBe(false);
    expect(facetUseful(facetOptions(same, facet('firedUnfired'), { firedUnfired: ['FIRED'] }))).toBe(true);
  });
});
