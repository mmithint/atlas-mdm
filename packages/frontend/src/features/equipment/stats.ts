/**
 * The metric cards above the Equipment table (screen S-4), as plain functions (no React, no network).
 *
 * Each card counts heaters in the current search (the boxes, the facility) and the ticked values of the
 * Filter panel, and most are also a shortcut to one of the panel's values: clicking ticks it, clicking
 * again unticks it. A card's count leaves its own field's ticks out, like the panel's counts, so a card
 * shows what choosing it gives even while another value of its field is chosen.
 */
import { BLANK_VALUE, FACETS, cleared, facetOptions, passesSelection, selectedCount, type Selection } from './facets';
import type { SearchRow } from './equipment-api';

export type StatTone = 'neutral' | 'success' | 'warning' | 'info' | 'danger';

export interface StatDef {
  id: string;
  label: string;
  tone: StatTone;
  /** The Filter panel value the card stands for; none for the total. */
  facetId?: string;
  value?: string;
}

/** The cards, in reading order: how many, then how well verified, then what needs a person. */
export const STATS: readonly StatDef[] = [
  { id: 'all', label: 'Heaters', tone: 'neutral' },
  { id: 'verified', label: 'Fully verified', tone: 'success', facetId: 'verificationPct', value: 'done' },
  { id: 'low', label: 'Under 50% verified', tone: 'warning', facetId: 'verificationPct', value: 'low' },
  { id: 'open', label: 'With open requests', tone: 'info', facetId: 'openRequestCount', value: 'some' },
  { id: 'duty', label: 'Missing heat duty', tone: 'danger', facetId: 'heatDutyMmbtuHr', value: BLANK_VALUE },
];

export interface StatValue {
  def: StatDef;
  /** Heaters the card counts. */
  count: number;
  /** What the count is out of: the heaters the card's own field is chosen from. */
  of: number;
  /** The card's filter is the one applied (the total: no filter applied). */
  active: boolean;
}

const sameValues = (a: readonly string[] | undefined, b: readonly string[]): boolean =>
  a !== undefined && a.length === b.length && a.every((v) => b.includes(v));

/** Every card's count from the rows of the search and the panel's ticked values. */
export function statValues(rows: readonly SearchRow[], selection: Selection): StatValue[] {
  return STATS.map((def) => {
    if (!def.facetId || def.value === undefined) {
      return { def, count: rows.filter((r) => passesSelection(r, selection)).length, of: rows.length, active: selectedCount(selection) === 0 };
    }
    const facet = FACETS.find((f) => f.id === def.facetId);
    const options = facet ? facetOptions(rows, facet, selection) : [];
    return {
      def,
      count: options.find((o) => o.value === def.value)?.count ?? 0,
      of: options.reduce((n, o) => n + o.count, 0),
      active: sameValues(selection[def.facetId], [def.value]),
    };
  });
}

/** The selection after a card is clicked: the total clears every filter; another card toggles its value. */
export function selectionAfterClick(def: StatDef, selection: Selection): Selection {
  if (!def.facetId || def.value === undefined) return {};
  return sameValues(selection[def.facetId], [def.value]) ? cleared(selection, def.facetId) : { ...selection, [def.facetId]: [def.value] };
}
