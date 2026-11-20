/**
 * What the Home page (S-1) reads for its programme-wide sections. The "My work" tiles come from the counts that
 * `getRequestQueue` already answers; this shape is only the Data quality and Request pipeline sections, agreed with
 * the user on 20 Nov (FINAL PLAN/11 §6 S-1). APP-8 builds the real function and may adjust the shape.
 */

export type SeverityTier = 'HIGH' | 'MEDIUM' | 'LOW';

export interface DataQualitySummary {
  heaterCount: number;
  /** Heaters with no Invalid result from a published rule (`app.vw_equipment_search.invalid_rule_count = 0`). */
  cleanHeaters: number;
  /** Open violations: Invalid results of the latest run of each published rule (`app.vw_rule_catalog`). */
  openViolations: number;
  /** Always all three tiers, HIGH first. */
  violationsBySeverity: { tier: SeverityTier; count: number }[];
  /** Average key-field verification across heaters, 0-100 (`verification_pct`). */
  avgVerificationPct: number;
  lastRun: { startedAtUtc: string; status: 'SUCCEEDED' | 'FAILED'; violations: number } | null;
}

export interface PipelineSummary {
  /** Open requests by stage, in this order: stage 1, stage 2, returned. */
  openByStage: { stage: 'RESPONSIBLE' | 'ACCOUNTABLE' | 'RETURNED'; count: number }[];
  openTotal: number;
  /** Open for more than `ageingDays` days. */
  ageing: number;
  ageingDays: number;
  /** Average days from detection or creation to merge, over finished requests; null when none finished. */
  avgCycleDays: number | null;
  /** Share of finished requests within `targetDays`, 0-100; null when none finished. */
  withinTargetPct: number | null;
  targetDays: number;
  /** Approved at both stages, not yet in an EVOLVE export file for SAP. */
  awaitingExport: number;
}

/** Null sections: the person is not an approver or admin, so the server does not send them. */
export interface HomeSummary {
  dataQuality: DataQualitySummary | null;
  pipeline: PipelineSummary | null;
}
