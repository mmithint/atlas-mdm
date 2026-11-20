/**
 * What the verification scorecard (S-10) reads: `gold.vw_verification_by_business_unit` and
 * `gold.vw_verification_score` (data engineer, DE-8). Shapes used by the APP-D preview (FINAL PLAN/11);
 * APP-9 builds the function and may adjust them.
 */

export interface ScoreTotals {
  heaters: number;
  /** Average of the heaters' % (0-100). */
  avgPct: number;
  /** Heaters with all key fields verified. */
  fullyVerified: number;
  /** fullyVerified ÷ heaters × 100. */
  shareFullyVerified: number;
}

/** One business unit (profit centre, assumption for Q-490). */
export interface UnitScore extends ScoreTotals {
  profitCenter: string;
}

export interface HeaterScore {
  equipmentId: number;
  equipmentNumber: string | null;
  tag: string | null;
  pct: number;
  keyMarks: { fieldCode: string; label: string; verified: boolean }[];
}

export interface Scorecard {
  /** The 2027 target, not a POC pass mark. */
  goalPct: number;
  /** The formula in words, with its working assumption. */
  formula: string;
  totals: ScoreTotals;
  units: UnitScore[];
  /** Filled only when one business unit was asked for. */
  heaters: HeaterScore[];
}
