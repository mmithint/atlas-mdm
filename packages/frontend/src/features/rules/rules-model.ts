/**
 * The rules of the Rules screens (S-9), kept apart from the components so they can be tested: who may edit,
 * why a button is off, how a state is shown. The server checks all of it again (`app.usp_rule_*`); these
 * only make the screen say the same thing before the person clicks (REF-52 §9.5).
 */
import type { Tone } from '@/components/layout';

import type { RuleDraftInput, RuleState, RuleTestResult, RuleVersion, TestStatus } from './rules-types';

/** The security groups (`app.security_group`, seed 0102); read through a function when APP-6 builds the editor. */
export const GROUPS: readonly string[] = [
  'DataQualityOwner',
  'SAPBusinessSupport',
  'HSESDS',
  'Operations-IOC',
  'Operations-IOC-Carlsbad',
  'Operations-IOC-Midland',
  'Operations-IOC-DenverCity',
  'Operations-IOC-Platteville',
  'Operations-PT',
  'ReliabilityandMaintenance',
  'AirQuality',
  'AssetIntegrity',
  'Engineering_Central',
  'Engineering_Asset',
  'Construction',
  'Approval_EvidenceOwner',
];

/** Classes a heater rule can apply to (from `gold.class_characteristic` once DE-3 lands). */
export const CLASSES: readonly string[] = ['HEATER', 'BOILER', 'REBOILER', 'HEAT_EXCHANGER'];

export const TEST_DISPLAY: Record<TestStatus, { text: string; tone: Tone }> = {
  NOT_TESTED: { text: 'Not tested', tone: 'neutral' },
  PASSED: { text: 'Test passed', tone: 'success' },
  FAILED: { text: 'Test failed', tone: 'danger' },
  STALE: { text: 'Edited since the test', tone: 'warning' },
};

export const STATE_DISPLAY: Record<RuleState, { text: string; tone: Tone }> = {
  PUBLISHED: { text: 'Published', tone: 'success' },
  DRAFT: { text: 'Draft', tone: 'info' },
  RETIRED: { text: 'Retired', tone: 'neutral' },
};

export interface Person {
  canEditRules: boolean;
  canPublishRules: boolean;
  canManageAdmin: boolean;
  groups: readonly string[];
}

/** Edit = the edit permission and membership of the rule's editor group; an admin always (REF-52 §9.7). */
export function canEditRule(person: Person | null, editorGroup: string): boolean {
  if (!person) return false;
  return person.canManageAdmin || (person.canEditRules && person.groups.includes(editorGroup));
}

/** The editable fields of a version, as the form holds them. */
export function draftFrom(v: RuleVersion): RuleDraftInput {
  return {
    ruleId: v.ruleId,
    version: v.version,
    ruleName: v.ruleName,
    description: v.description,
    executionTarget: v.executionTarget,
    queryText: v.queryText,
    routingMode: v.routingMode,
    resolutionGroup: v.resolutionGroup,
    editorGroup: v.editorGroup,
    responsibleGroup: v.responsibleGroup,
    accountableGroup: v.accountableGroup,
    allowedTargets: [...v.allowedTargets],
    applicability: [...v.applicability],
    effectiveFromUtc: v.effectiveFromUtc,
    effectiveToUtc: v.effectiveToUtc,
    changeReason: v.changeReason,
    expectedUpdatedAtUtc: v.updatedAtUtc,
  };
}

/** True when the form differs from what was saved. */
export function isDirty(form: RuleDraftInput, saved: RuleVersion): boolean {
  return JSON.stringify({ ...form, expectedUpdatedAtUtc: '' }) !== JSON.stringify({ ...draftFrom(saved), expectedUpdatedAtUtc: '' });
}

export interface ActionGate {
  save: string | null;
  test: string | null;
  preview: string | null;
  publish: string | null;
}

/**
 * Why each button is off (null = on), in the order REF-52 §9.5 gives: Save Draft → Test Query →
 * Preview Changes (only after a passing test of this exact definition) → Publish (publish permission too).
 */
export function actionGate(v: RuleVersion, dirty: boolean, person: Person | null): ActionGate {
  const editable = v.status === 'DRAFT' && canEditRule(person, v.editorGroup);
  const notEditable = v.status !== 'DRAFT' ? 'A published version cannot change. Create a new version.' : 'Only members of the editor group may change this rule.';
  const tested =
    v.testStatus === 'PASSED'
      ? null
      : v.testStatus === 'STALE'
        ? 'The draft changed after its test. Test it again.'
        : v.testStatus === 'FAILED'
          ? 'The last test failed. Fix the draft and test it again.'
          : 'Test the draft first.';
  const unsaved = dirty ? 'Save the draft first.' : null;
  return {
    save: !editable ? notEditable : dirty ? null : 'Nothing has changed.',
    test: !editable ? notEditable : unsaved,
    preview: v.status !== 'DRAFT' ? 'Preview applies to a draft.' : (unsaved ?? tested),
    publish:
      v.status !== 'DRAFT'
        ? 'This version is already published.'
        : !person?.canPublishRules
          ? 'Only Admin and SAPBusinessSupport may publish (can_publish_business_rules).'
          : (unsaved ?? tested),
  };
}

/** The line under the test panel's heading: rows shown out of rows returned and the limit. */
export function rowsLine(t: RuleTestResult): string {
  const shown = t.rows.length;
  return `${shown} of ${t.rowCount} row${t.rowCount === 1 ? '' : 's'} shown · limit ${t.rowLimit} · ${t.elapsedMs} ms`;
}

/** `2026-11-19T…` as `2026-11-19` for a date input, and back. */
export const toDateInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : '');
export const fromDateInput = (text: string): string | null => (text ? `${text}T00:00:00.000Z` : null);
