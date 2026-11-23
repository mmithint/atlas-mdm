/**
 * The checkbox filters of the Filter panel on screen S-4, as plain functions (no React, no network).
 *
 * Each facet is one field the person can tick values of, as on a shop's filter list. Within a facet
 * the ticked values widen the list (any of them, OR); across facets they narrow it (all facets,
 * AND). Numbers are offered as ranges. The procedure can only do the boxes' "contains", so the
 * facets run in the browser over every row the boxes, the facility and the order already chose
 * (see use-filtered-search.ts).
 */
import type { SearchColumn } from './columns';
import { labelOf } from './columns';
import type { SearchRow } from './equipment-api';

/** The value a row has for blank fields, so "not set" can be ticked too. */
export const BLANK_VALUE = '__blank__';

export interface Facet {
  id: string;
  label: string;
  /** The option a row falls under. */
  valueOf: (row: SearchRow) => string;
  /** The words for an option; the value itself when missing. */
  labelOf?: (value: string) => string;
  /** A fixed order for the options (ranges); otherwise they are sorted by name. */
  order?: readonly string[];
}

const text = (column: SearchColumn): Facet => ({
  id: column,
  label: labelOf(column),
  valueOf: (row) => {
    const v = row[column];
    return v === null || v === undefined || String(v).trim() === '' ? BLANK_VALUE : String(v).trim();
  },
});

const VERIFIED: Record<string, string> = { done: '100%', part: '50–99%', low: 'Under 50%', [BLANK_VALUE]: 'Not available' };
const OPEN: Record<string, string> = { none: 'None', some: '1 or more', [BLANK_VALUE]: 'Not available' };

/** The facets, in the panel's order: what a heater is, its state, then who and where. */
export const FACETS: readonly Facet[] = [
  text('equipClass'),
  text('firedUnfired'),
  text('equipmentUserStatus'),
  text('flocUserStatus'),
  {
    id: 'verificationPct',
    label: labelOf('verificationPct'),
    valueOf: (row) => {
      const v = row.verificationPct;
      if (typeof v !== 'number') return BLANK_VALUE;
      return v >= 100 ? 'done' : v >= 50 ? 'part' : 'low';
    },
    labelOf: (v) => VERIFIED[v] ?? v,
    order: ['done', 'part', 'low', BLANK_VALUE],
  },
  {
    id: 'openRequestCount',
    label: labelOf('openRequestCount'),
    valueOf: (row) => {
      const v = row.openRequestCount;
      return typeof v !== 'number' ? BLANK_VALUE : v > 0 ? 'some' : 'none';
    },
    labelOf: (v) => OPEN[v] ?? v,
    order: ['none', 'some', BLANK_VALUE],
  },
  {
    id: 'heatDutyMmbtuHr',
    label: 'Heat duty',
    valueOf: (row) => (typeof row.heatDutyMmbtuHr === 'number' ? 'set' : BLANK_VALUE),
    labelOf: (v) => (v === 'set' ? 'Recorded' : 'Missing'),
    order: ['set', BLANK_VALUE],
  },
  text('manufacturer'),
  text('modelNumber'),
  text('profitCenterName'),
  text('superiorFunctionalLocation'),
  text('plannerGroup'),
  text('heaterPopulationMethod'),
  text('classType'),
  text('objectType'),
  text('flocClass'),
  text('techObjectType'),
];

/** The ticked values, by facet id; a facet with none ticked does not filter. */
export type Selection = Readonly<Record<string, readonly string[]>>;

export const NO_SELECTION: Selection = {};

export const optionLabel = (facet: Facet, value: string): string =>
  facet.labelOf ? facet.labelOf(value) : value === BLANK_VALUE ? 'Not set' : value;

/** How many values are ticked: the count on the Filter button. */
export const selectedCount = (selection: Selection): number => Object.values(selection).reduce((n, values) => n + values.length, 0);

/** The selection without any value of one facet. */
export const cleared = (selection: Selection, facetId: string): Selection =>
  Object.fromEntries(Object.entries(selection).filter(([id]) => id !== facetId));

/** The selection with one value ticked or unticked. */
export function toggled(selection: Selection, facetId: string, value: string): Selection {
  const now = selection[facetId] ?? [];
  const next = now.includes(value) ? now.filter((v) => v !== value) : [...now, value];
  return next.length === 0 ? cleared(selection, facetId) : { ...selection, [facetId]: next };
}

const passesExcept = (row: SearchRow, selection: Selection, skip: string | null): boolean =>
  FACETS.every((f) => {
    if (f.id === skip) return true;
    const ticked = selection[f.id];
    return !ticked || ticked.length === 0 || ticked.includes(f.valueOf(row));
  });

/** Whether a row passes every facet that has values ticked. */
export const passesSelection = (row: SearchRow, selection: Selection): boolean => passesExcept(row, selection, null);

export interface FacetOption {
  value: string;
  label: string;
  /** Rows with this value among those that pass the other facets: what ticking it would add. */
  count: number;
  checked: boolean;
}

/**
 * A facet's options with their counts. Each count leaves the facet's own ticks out, as shops do, so
 * ticking a second value shows how many it adds. Ticked values stay listed even at zero.
 */
export function facetOptions(rows: readonly SearchRow[], facet: Facet, selection: Selection): FacetOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = facet.valueOf(row);
    if (!counts.has(value)) counts.set(value, 0);
    if (passesExcept(row, selection, facet.id)) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const ticked = selection[facet.id] ?? [];
  for (const value of ticked) if (!counts.has(value)) counts.set(value, 0);

  const values = [...counts.keys()];
  if (facet.order) values.sort((a, b) => facet.order!.indexOf(a) - facet.order!.indexOf(b));
  else values.sort((a, b) => (a === BLANK_VALUE ? 1 : b === BLANK_VALUE ? -1 : a.localeCompare(b, undefined, { numeric: true })));

  return values.map((value) => ({ value, label: optionLabel(facet, value), count: counts.get(value) ?? 0, checked: ticked.includes(value) }));
}

/** Whether a facet is worth showing: it tells rows apart, or something in it is ticked. */
export const facetUseful = (options: readonly FacetOption[]): boolean => options.length > 1 || options.some((o) => o.checked);
