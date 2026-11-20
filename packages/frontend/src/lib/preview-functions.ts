/**
 * Functions a page already calls although no phase has built them yet (FINAL PLAN/11 §3 F7, APP-D).
 *
 * Pages call them through `previewInvoke` (never through the Rayfin client, where they do not exist). Under
 * `npm run dev:mock` they answer from sample data (`dev-mock/preview-handlers.ts`); anywhere else
 * `previewInvoke` refuses, and the page is not shown (its route shows the "arrives in APP-n" placeholder).
 * Names follow `FINAL PLAN/03` §2.2; a name that section does not list yet is marked "proposed" and is fixed by
 * the phase that builds it. Shapes are proposals too: the building phase may change them.
 *
 * When a phase builds one of these for real: delete its entry here and its handler in preview-handlers.ts,
 * and call it as `client.functions.<name>.invoke(...)`. Until the entry is deleted, `npm run typecheck`
 * fails (see the check at the bottom), so a stale entry cannot stay behind.
 */
import type { AppFunctionsSchema } from '@rayfin-app/functions/types';

import type { RuleStatusRow } from '@/features/equipment/rule-status-types';
import type { Evidence, FieldEntry, HeaterVerification, NameplateReading, PhotoRow, PhotoType, SubmitResult } from '@/features/field/field-types';
import type { Scorecard } from '@/features/measures/measures-types';
import type { RuleCatalogRow, RuleDraftInput, RulePreviewRow, RuleRun, RuleTestResult, RuleVersion, RunRuleLine } from '@/features/rules/rules-types';

import type { ActAnswer } from './act-answer';

type Fn<I, O> = { input: I; output: ActAnswer & O };

export interface PreviewFunctions {
  // ---- APP-5 / APP-6 rules (S-9)
  /** proposed: the catalog and the latest runs (`app.vw_rule_catalog`, `app.vw_rule_run_summary`). */
  getRuleCatalog: Fn<Record<string, never>, { rules: RuleCatalogRow[]; runs: RuleRun[] }>;
  /** `03` §2.2 (shape proposed): every version of one rule, its runs and the draft's last test. */
  getRuleDefinition: Fn<
    { ruleId: string },
    { versions: RuleVersion[]; runs: (RunRuleLine & { runId: number; startedAtUtc: string; trigger: string })[]; lastTest: RuleTestResult | null }
  >;
  saveRuleDraft: Fn<RuleDraftInput, { version: RuleVersion }>;
  /** A new draft: version 1 of a new rule, or the next version copied from the published one. */
  createRuleVersion: Fn<{ ruleId: string; ruleName: string }, { version: RuleVersion }>;
  testRule: Fn<{ ruleId: string; version: number }, { test: RuleTestResult; version: RuleVersion }>;
  previewRule: Fn<{ ruleId: string; version: number }, { rows: RulePreviewRow[]; newRequests: number; suppressed: number; invalidOnly: number }>;
  publishRule: Fn<{ ruleId: string; version: number; reason: string }, { version: RuleVersion }>;
  runRulesNow: Fn<Record<string, never>, { run: RuleRun }>;

  // ---- APP-5 heater rule badges (S-5)
  /** proposed: `app.vw_equipment_rule_status` for one heater. */
  getEquipmentRuleStatus: Fn<{ equipmentId: number }, { rows: RuleStatusRow[]; lastRunAtUtc: string | null }>;

  // ---- APP-7 field view, photos, evidence (S-6, S-5, S-3)
  /** proposed: `app.vw_field_verification_latest` for one heater. */
  getHeaterVerification: Fn<{ equipmentId: number }, HeaterVerification>;
  /** proposed: `app.vw_equipment_evidence`; `requestId` 0 = every photo of the heater. */
  getEquipmentEvidence: Fn<{ equipmentId: number; requestId: number }, Evidence>;
  registerPhoto: Fn<{ equipmentId: number; fileName: string; contentType: string; photoType: PhotoType; dataUrl: string }, { photo: PhotoRow }>;
  extractNameplate: Fn<{ equipmentId: number; fileId: number }, NameplateReading>;
  submitFieldVerification: Fn<{ equipmentId: number; entries: FieldEntry[]; photoIds: number[] }, SubmitResult>;

  // ---- APP-8 notifications
  /** Input as `bulkApprove`: a comma-separated id list; empty = all of mine. */
  markNotificationsRead: Fn<{ notificationIds: string }, { marked: number; unreadCount: number }>;

  // ---- APP-9 verification scorecard (S-10)
  /** proposed: one call for the business units and, when `profitCenter` is set, that unit's heaters. */
  getVerificationScorecard: Fn<{ profitCenter: string }, Scorecard>;
}

export type PreviewFunctionName = keyof PreviewFunctions;

/** Compile-time guard: fails to compile once a name above also exists among the real functions. */
type BuiltAlready = Extract<PreviewFunctionName, keyof AppFunctionsSchema>;
export const PREVIEW_NAMES_ARE_NOT_BUILT: [BuiltAlready] extends [never] ? true : BuiltAlready = true;
