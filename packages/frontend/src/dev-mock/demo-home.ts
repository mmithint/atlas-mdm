/**
 * The Home page's programme-wide numbers in the client demo (`npm run dev:mock` only; FINAL PLAN/11 §6 S-1). Each
 * number is counted from the demo store, so it moves when the story changes the data (a rule run, an approval).
 *
 * Sample-only assumptions, to be replaced by APP-8 and the data engineer's views:
 * - severity tiers per rule: the catalogue has no severity yet (`severity_tier` is [INFERRED], FINAL PLAN/09 §6);
 * - cycle time: request creation (or rule detection) to its last update, standing in for `app.vw_cycle_time`
 *   (DE-8, detection to the EXPORTED event); target 7 days, the top of the 3-7 day window (Q-461 working assumption);
 * - awaiting export: every approved request, because the demo has no EVOLVE export yet (S-11);
 * - ageing: open for more than 7 days [INFERRED; user decision 20 Nov].
 */
import type { HomeSummary, SeverityTier } from '@/features/home/home-types';

import { demo, isOpen } from './demo-store';
import { currentPersona } from './personas';

const SEVERITY: Readonly<Record<string, SeverityTier>> = {
  ENGINEERING_TAG_UNIQUE: 'HIGH',
  HEATER_DUTY: 'MEDIUM',
  HEATER_CLASS_FIRED: 'LOW',
};
const TIERS: readonly SeverityTier[] = ['HIGH', 'MEDIUM', 'LOW'];

export const AGEING_DAYS = 7;
export const TARGET_DAYS = 7;

const DAY_MS = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function homeSummary(): HomeSummary {
  const p = currentPersona();
  // Server-side gate (D-03): a person who is not an approver or admin is not sent the programme sections.
  if (!(p.canResponsibleApprove || p.canAccountableApprove || p.canManageAdmin)) return { dataQuality: null, pipeline: null };

  const s = demo();

  // ---- data quality
  const bySeverity = new Map<SeverityTier, number>(TIERS.map((t) => [t, 0]));
  let openViolations = 0;
  for (const rows of s.ruleResults.values()) {
    for (const r of rows) {
      if (r.result !== 'INVALID') continue;
      openViolations += 1;
      const tier = SEVERITY[r.ruleId] ?? 'MEDIUM';
      bySeverity.set(tier, (bySeverity.get(tier) ?? 0) + 1);
    }
  }
  const heaters = s.heaters;
  const run = s.runs[0];

  // ---- pipeline
  const open = s.requests.filter(isOpen);
  const stageOf = (status: string) => (status === 'PENDING_RESPONSIBLE' ? 'RESPONSIBLE' : status === 'PENDING_ACCOUNTABLE' ? 'ACCOUNTABLE' : 'RETURNED');
  const finished = s.requests.filter((r) => r.requestStatus === 'APPROVED');
  const days = finished.map((r) => (Date.parse(r.updatedAtUtc ?? '') - Date.parse(r.detectedAtUtc ?? r.requestedAtUtc ?? '')) / DAY_MS).filter(Number.isFinite);

  return {
    dataQuality: {
      heaterCount: heaters.length,
      cleanHeaters: heaters.filter((h) => !h.invalidRuleCount).length,
      openViolations,
      violationsBySeverity: TIERS.map((tier) => ({ tier, count: bySeverity.get(tier) ?? 0 })),
      avgVerificationPct: heaters.length ? round1(heaters.reduce((sum, h) => sum + (h.verificationPct ?? 0), 0) / heaters.length) : 0,
      lastRun: run ? { startedAtUtc: run.startedAtUtc, status: run.status, violations: run.lines.reduce((sum, l) => sum + l.invalid, 0) } : null,
    },
    pipeline: {
      openByStage: (['RESPONSIBLE', 'ACCOUNTABLE', 'RETURNED'] as const).map((stage) => ({ stage, count: open.filter((r) => stageOf(r.requestStatus) === stage).length })),
      openTotal: open.length,
      ageing: open.filter((r) => (r.ageHours ?? 0) > AGEING_DAYS * 24).length,
      ageingDays: AGEING_DAYS,
      avgCycleDays: days.length ? round1(days.reduce((a, b) => a + b, 0) / days.length) : null,
      withinTargetPct: days.length ? Math.round((days.filter((d) => d <= TARGET_DAYS).length / days.length) * 100) : null,
      targetDays: TARGET_DAYS,
      awaitingExport: finished.length,
    },
  };
}
