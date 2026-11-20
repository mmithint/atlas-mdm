/**
 * What the Rules screens (S-9) read and send. Columns follow `FINAL PLAN/09` §6 (rule tables) and REF-52 §9.3
 * (editor fields). These are the shapes the APP-D preview uses (FINAL PLAN/11); APP-5 and APP-6 build the
 * functions and may adjust them, then these types come from `AppFunctionsSchema` instead.
 */

export type RuleState = 'DRAFT' | 'PUBLISHED' | 'RETIRED';
export type RoutingMode = 'MANUAL' | 'AUTO_ROUTE';
/** STALE = the SQL or a policy field changed after the last test, so Publish is off until it is tested again. */
export type TestStatus = 'NOT_TESTED' | 'PASSED' | 'FAILED' | 'STALE';

/** One version of a rule (`app.business_rules` plus its allowed targets and applicability). */
export interface RuleVersion {
  ruleId: string;
  version: number;
  status: RuleState;
  ruleName: string;
  description: string;
  queryLanguage: 'T-SQL';
  executionTarget: string;
  queryText: string;
  routingMode: RoutingMode;
  /** Who fixes what a MANUAL rule finds (REF-46 hidden column `resolution_role`). */
  resolutionGroup: string | null;
  editorGroup: string;
  /** Null = the approval route table decides (`app.approval_route`). */
  responsibleGroup: string | null;
  accountableGroup: string | null;
  /** Catalogue fields the rule may propose a value for (`app.business_rule_allowed_target`). */
  allowedTargets: string[];
  /** Classes the rule applies to (`app.business_rule_applicability`). */
  applicability: string[];
  effectiveFromUtc: string | null;
  effectiveToUtc: string | null;
  changeReason: string;
  testStatus: TestStatus;
  testedAtUtc: string | null;
  testedBy: string | null;
  publishedBy: string | null;
  publishedAtUtc: string | null;
  /** Fingerprint of the exact published text (SHA-256 on the server, REF-52 L0026). */
  queryHash: string | null;
  createdBy: string;
  updatedAtUtc: string;
}

/** What Save Draft sends: the editable fields of one draft, plus the time it was read (concurrency check). */
export type RuleDraftInput = Pick<
  RuleVersion,
  | 'ruleId'
  | 'version'
  | 'ruleName'
  | 'description'
  | 'queryText'
  | 'routingMode'
  | 'resolutionGroup'
  | 'editorGroup'
  | 'responsibleGroup'
  | 'accountableGroup'
  | 'allowedTargets'
  | 'applicability'
  | 'effectiveFromUtc'
  | 'effectiveToUtc'
  | 'changeReason'
> & { expectedUpdatedAtUtc: string };

/** One rule's part of a run (`app.business_rule_run`). */
export interface RunRuleLine {
  ruleId: string;
  version: number;
  status: 'SUCCEEDED' | 'FAILED';
  /** Heaters checked. */
  checked: number;
  /** Results that are violations (Invalid). */
  invalid: number;
  requestsCreated: number;
  requestsSuppressed: number;
  message: string | null;
}

export interface RuleRun {
  runId: number;
  trigger: 'SCHEDULED' | 'ON_DEMAND';
  startedAtUtc: string;
  finishedAtUtc: string;
  startedBy: string;
  status: 'SUCCEEDED' | 'FAILED';
  lines: RunRuleLine[];
}

/** One row of the catalog (`app.vw_rule_catalog`). */
export interface RuleCatalogRow {
  ruleId: string;
  ruleName: string;
  /** PUBLISHED when any version is in force, otherwise DRAFT. */
  state: 'PUBLISHED' | 'DRAFT';
  publishedVersion: number | null;
  draftVersion: number | null;
  routingMode: RoutingMode;
  editorGroup: string;
  /** Of the draft when there is one, else of the published version. */
  testStatus: TestStatus;
  hasSql: boolean;
  lastRun: (RunRuleLine & { runId: number; startedAtUtc: string }) | null;
}

export interface RuleTestColumn {
  name: string;
  type: string;
}

export interface RuleValidation {
  code: string;
  label: string;
  status: 'PASS' | 'FAIL' | 'SKIPPED';
  message: string;
}

/** The test panel (`test_details_json` of the draft). */
export interface RuleTestResult {
  ruleId: string;
  version: number;
  status: 'PASSED' | 'FAILED';
  elapsedMs: number;
  rowLimit: number;
  /** Rows the query returned (up to the limit). */
  rowCount: number;
  columns: RuleTestColumn[];
  /** The rows shown (the first 25). */
  rows: Record<string, string | null>[];
  validations: RuleValidation[];
  testedAtUtc: string;
  testedBy: string;
}

/** One line of Preview Changes: what a run would do for one result. Nothing is stored. */
export interface RulePreviewRow {
  equipmentId: number | null;
  entityKey: string;
  tag: string | null;
  profitCenter: string | null;
  fieldCode: string | null;
  oldValue: string | null;
  proposedValue: string | null;
  violation: string;
  outcome: 'NEW_REQUEST' | 'SUPPRESSED' | 'INVALID_BADGE';
  existingRequestRef: string | null;
}
