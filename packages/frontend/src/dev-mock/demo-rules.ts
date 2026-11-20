/**
 * The rule engine of the client demo (`npm run dev:mock` only; FINAL PLAN/11 §6 S-9 and §5 L1, L5). It follows
 * the outline of the procedures APP-5 and APP-6 build (`guide/app/S-09` §3; REF-52 §9): save a draft, test it,
 * preview it, publish it, run the published rules. It does not run SQL: the checks read the SQL text, and each
 * rule's `evaluate` (rule-samples.ts) finds what its SQL would find in the sample heaters.
 */
import type { RuleStatusRow } from '@/features/equipment/rule-status-types';
import type {
  RuleCatalogRow,
  RuleDraftInput,
  RulePreviewRow,
  RuleRun,
  RuleTestResult,
  RuleValidation,
  RuleVersion,
  RunRuleLine,
} from '@/features/rules/rules-types';

import { ALLOWED_VALUES, fieldOf } from './catalog';
import { createRequest, demo, isOpen, me, nowIso, publishedVersions, RULE_ENGINE, storeResults } from './demo-store';
import { currentPersona } from './personas';
import { Refusal } from './refusal';
import { fingerprint, hasGroupBy, SAMPLE_RULES, sampleRule, stripComments, type Violation } from './rule-samples';

/** Settings seed 0107: TEST_ROW_LIMIT = 200. */
const ROW_LIMIT = 200;
const ROWS_SHOWN = 25;

/** The ten columns every rule must return (contract `01` §6.4), with their types. */
const CONTRACT: readonly [string, string][] = [
  ['entity_type', 'nvarchar(10)'],
  ['entity_key', 'nvarchar(40)'],
  ['equipment_id', 'int'],
  ['profit_center_name', 'nvarchar(40)'],
  ['violation_description', 'nvarchar(400)'],
  ['field_code', 'nvarchar(64)'],
  ['old_value', 'nvarchar(400)'],
  ['proposed_value', 'nvarchar(400)'],
  ['note', 'nvarchar(200)'],
  ['evidence_json', 'nvarchar(4000)'],
];

/** Words a rule may not contain (the S3 fallback's deny-list, `03` APP-0). */
const DENY = /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|EXEC|EXECUTE|INTO|GRANT)\b/i;

const key = (ruleId: string, version: number) => `${ruleId}|${version}`;

/** What a test fingerprints: the SQL and the policy fields. Name, description and reason do not make a test stale. */
function definitionHash(v: Pick<RuleVersion, 'queryText' | 'routingMode' | 'resolutionGroup' | 'responsibleGroup' | 'accountableGroup' | 'allowedTargets' | 'applicability' | 'effectiveFromUtc' | 'effectiveToUtc'>): string {
  return fingerprint(
    JSON.stringify([v.queryText, v.routingMode, v.resolutionGroup, v.responsibleGroup, v.accountableGroup, [...v.allowedTargets].sort(), [...v.applicability].sort(), v.effectiveFromUtc, v.effectiveToUtc])
  );
}

function versionsOf(ruleId: string): RuleVersion[] {
  return demo()
    .ruleVersions.filter((v) => v.ruleId === ruleId)
    .sort((a, b) => b.version - a.version);
}

function findVersion(ruleId: string, version: number): RuleVersion {
  const v = demo().ruleVersions.find((x) => x.ruleId === ruleId && x.version === version);
  if (!v) throw new Refusal(`There is no version ${version} of rule ${ruleId}.`, 50401);
  return v;
}

/** May the person change this rule? The edit permission and membership of the rule's editor group (an admin always). */
function assertCanEdit(editorGroup: string): void {
  const p = currentPersona();
  if (p.canManageAdmin) return;
  if (!p.canEditRules) throw new Refusal('You may read rules but not edit them (permission can_request_edit_business_rules).', 50402);
  if (!p.groups.includes(editorGroup)) throw new Refusal(`Only members of ${editorGroup}, the rule's editor group, may edit it.`, 50403);
}

// ---------------------------------------------------------------- reads

export function catalog(): { rules: RuleCatalogRow[]; runs: RuleRun[] } {
  const ids = [...new Set([...SAMPLE_RULES.map((r) => r.ruleId), ...demo().ruleVersions.map((v) => v.ruleId)])];
  const rules = ids.map((ruleId): RuleCatalogRow => {
    const versions = versionsOf(ruleId);
    const published = versions.find((v) => v.status === 'PUBLISHED') ?? null;
    const draft = versions.find((v) => v.status === 'DRAFT') ?? null;
    const current = draft ?? published ?? versions[0];
    const run = demo().runs.find((r) => r.lines.some((l) => l.ruleId === ruleId));
    const line = run?.lines.find((l) => l.ruleId === ruleId);
    return {
      ruleId,
      ruleName: current.ruleName,
      state: published ? 'PUBLISHED' : 'DRAFT',
      publishedVersion: published?.version ?? null,
      draftVersion: draft?.version ?? null,
      routingMode: current.routingMode,
      editorGroup: current.editorGroup,
      testStatus: current.testStatus,
      hasSql: stripComments(current.queryText).trim().length > 0,
      lastRun: run && line ? { ...line, runId: run.runId, startedAtUtc: run.startedAtUtc } : null,
    };
  });
  return { rules, runs: demo().runs.slice(0, 5) };
}

export function definition(ruleId: string) {
  const versions = versionsOf(ruleId);
  if (versions.length === 0) throw new Refusal(`There is no rule ${ruleId}.`, 50401);
  const runs = demo().runs.flatMap((run) =>
    run.lines.filter((l) => l.ruleId === ruleId).map((l) => ({ ...l, runId: run.runId, startedAtUtc: run.startedAtUtc, trigger: run.trigger }))
  );
  const working = versions.find((v) => v.status === 'DRAFT') ?? versions[0];
  return { versions, runs, lastTest: demo().tests.get(key(working.ruleId, working.version))?.result ?? null };
}

export function ruleStatus(equipmentId: number): { rows: RuleStatusRow[]; lastRunAtUtc: string | null } {
  return { rows: demo().ruleResults.get(equipmentId) ?? [], lastRunAtUtc: demo().runs[0]?.startedAtUtc ?? null };
}

// ---------------------------------------------------------------- drafts

export function saveDraft(input: RuleDraftInput): RuleVersion {
  const v = findVersion(input.ruleId, input.version);
  assertCanEdit(v.editorGroup);
  if (v.status !== 'DRAFT') throw new Refusal('A published version cannot be changed. Create a new version.', 50404);
  if (v.updatedAtUtc !== input.expectedUpdatedAtUtc) throw new Refusal('Someone saved this draft after you opened it. Reload it, then make your change again.', 50405);
  if (!input.ruleName.trim()) throw new Refusal('The rule needs a name.', 50406);

  const before = definitionHash(v);
  Object.assign(v, {
    ruleName: input.ruleName.trim(),
    description: input.description,
    queryText: input.queryText,
    routingMode: input.routingMode,
    resolutionGroup: input.resolutionGroup,
    editorGroup: input.editorGroup,
    responsibleGroup: input.responsibleGroup,
    accountableGroup: input.accountableGroup,
    allowedTargets: [...input.allowedTargets],
    applicability: [...input.applicability],
    effectiveFromUtc: input.effectiveFromUtc,
    effectiveToUtc: input.effectiveToUtc,
    changeReason: input.changeReason,
    updatedAtUtc: nowIso(),
  });
  const tested = demo().tests.get(key(v.ruleId, v.version));
  if (definitionHash(v) !== before && v.testStatus !== 'NOT_TESTED') v.testStatus = 'STALE';
  if (tested && tested.hash === definitionHash(v)) v.testStatus = tested.result.status;
  return v;
}

export function createVersion(ruleId: string, ruleName: string): RuleVersion {
  const id = ruleId.trim().toUpperCase();
  const versions = versionsOf(id);
  const latest = versions[0];
  assertCanEdit(latest?.editorGroup ?? 'DataQualityOwner');
  const draft = versions.find((v) => v.status === 'DRAFT');
  if (draft) throw new Refusal(`Draft version ${draft.version} already exists. Open it instead.`, 50407);
  if (!latest && !/^[A-Z][A-Z0-9_]{2,63}$/.test(id)) {
    throw new Refusal('A rule ID uses capital letters, digits and underscores, starts with a letter and has 3 to 64 characters (for example HEATER_DUTY).', 50408);
  }
  if (!latest && !ruleName.trim()) throw new Refusal('A new rule needs a name.', 50406);

  const source = versions.find((v) => v.status === 'PUBLISHED') ?? latest;
  const now = nowIso();
  const v: RuleVersion = source
    ? { ...source, allowedTargets: [...source.allowedTargets], applicability: [...source.applicability], version: source.version + 1 }
    : {
        ruleId: id,
        version: 1,
        status: 'DRAFT',
        ruleName: ruleName.trim(),
        description: '',
        queryLanguage: 'T-SQL',
        executionTarget: 'ATLAS_DB · gold views',
        queryText: '',
        routingMode: 'MANUAL',
        resolutionGroup: 'DataQualityOwner',
        editorGroup: 'DataQualityOwner',
        responsibleGroup: null,
        accountableGroup: null,
        allowedTargets: [],
        applicability: ['HEATER'],
        effectiveFromUtc: null,
        effectiveToUtc: null,
        changeReason: '',
        testStatus: 'NOT_TESTED',
        testedAtUtc: null,
        testedBy: null,
        publishedBy: null,
        publishedAtUtc: null,
        queryHash: null,
        createdBy: me(),
        updatedAtUtc: now,
      };
  Object.assign(v, {
    status: 'DRAFT',
    changeReason: '',
    effectiveFromUtc: null,
    effectiveToUtc: null,
    testStatus: 'NOT_TESTED',
    testedAtUtc: null,
    testedBy: null,
    publishedBy: null,
    publishedAtUtc: null,
    queryHash: null,
    createdBy: me(),
    updatedAtUtc: now,
  });
  demo().ruleVersions.push(v);
  return v;
}

// ---------------------------------------------------------------- test and preview

function check(code: string, label: string, ok: boolean, pass: string, fail: string): RuleValidation {
  return { code, label, status: ok ? 'PASS' : 'FAIL', message: ok ? pass : fail };
}

const skipped = (code: string, label: string): RuleValidation => ({ code, label, status: 'SKIPPED', message: 'Not run: fix the checks above first.' });

/** What the query would return, as the test panel's rows. */
function asRows(found: readonly Violation[]): Record<string, string | null>[] {
  return found.map((x) => ({
    entity_type: 'EQUIPMENT',
    entity_key: x.entityKey,
    equipment_id: String(x.equipmentId),
    profit_center_name: x.profitCenter,
    violation_description: x.violation,
    field_code: x.fieldCode,
    old_value: x.oldValue,
    proposed_value: x.proposedValue,
    note: x.note,
    evidence_json: JSON.stringify(x.evidence),
  }));
}

/** `app.usp_rule_test` in outline: read-only checks on the text, then the output checks on what it finds. */
export function test(ruleId: string, version: number): { test: RuleTestResult; version: RuleVersion } {
  const v = findVersion(ruleId, version);
  assertCanEdit(v.editorGroup);
  if (v.status !== 'DRAFT') throw new Refusal('Only a draft is tested. Create a new version to change a published rule.', 50409);

  const sql = stripComments(v.queryText).trim();
  const sources = [...sql.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z0-9_.[\]]+)/gi)].map((m) => m[1].replace(/[[\]]/g, '').toLowerCase());
  const missing = CONTRACT.map(([name]) => name).filter((name) => !new RegExp(`\\b${name}\\b`, 'i').test(sql));
  const checks: RuleValidation[] = [
    check(
      'READ_ONLY',
      'One read-only SELECT',
      sql.length > 0 && /^(SELECT|WITH)\b/i.test(sql) && !DENY.test(sql) && !/;\s*\S/.test(sql),
      'A single SELECT that changes nothing.',
      sql.length === 0 ? 'There is no SQL yet.' : 'Only one SELECT (or WITH … SELECT) is allowed: no ";", and none of INSERT, UPDATE, DELETE, MERGE, CREATE, ALTER, DROP, TRUNCATE, EXEC, INTO, GRANT.'
    ),
    check(
      'GOLD_ONLY',
      'Reads gold views only',
      sources.length > 0 && sources.every((s) => s.startsWith('gold.')),
      `Sources: ${[...new Set(sources)].join(', ') || 'none'}.`,
      sources.length === 0 ? 'The query reads no table or view.' : `Only gold.* may be read; found ${[...new Set(sources.filter((s) => !s.startsWith('gold.')))].join(', ')}.`
    ),
    check('OUTPUT_COLUMNS', 'Output columns (contract 01 §6.4)', missing.length === 0, 'All ten columns are returned.', `Missing: ${missing.join(', ')}.`),
  ];

  const rule = sampleRule(ruleId);
  const textOk = checks.every((c) => c.status === 'PASS');
  const found = textOk && rule ? rule.evaluate(demo().heaters, hasGroupBy(v.queryText)) : [];
  if (textOk) {
    const grain = new Map<string, number>();
    for (const x of found) grain.set(`${x.equipmentId}|${x.fieldCode ?? ''}`, (grain.get(`${x.equipmentId}|${x.fieldCode ?? ''}`) ?? 0) + 1);
    const twice = [...grain.values()].filter((n) => n > 1).length;
    const allowed = (x: Violation) =>
      x.proposedValue !== null &&
      x.fieldCode !== null &&
      v.allowedTargets.includes(x.fieldCode) &&
      (fieldOf(x.fieldCode)?.allowedValuesSource !== 'LIST' || ALLOWED_VALUES.some((a) => a.fieldCode === x.fieldCode && a.value === x.proposedValue));
    checks.push(
      check('ONE_ROW_PER_HEATER_AND_FIELD', 'One row per heater and field', twice === 0, 'Every heater and field appears once.', `${twice} heater(s) have more than one row for the same field. Aggregate the rows (GROUP BY) so each appears once.`),
      v.routingMode === 'AUTO_ROUTE'
        ? check('PROPOSED_VALUES_ALLOWED', 'Proposed values allowed', found.every(allowed), 'Every proposed value is in the allowed targets and the allowed-value list.', 'A proposed value is missing, or is not in the allowed targets or the allowed-value list.')
        : { code: 'PROPOSED_VALUES_ALLOWED', label: 'Proposed values allowed', status: 'SKIPPED', message: 'MANUAL rule: it reports, it proposes no value.' },
      check(
        'ROUTING_COMPLETE',
        'Routing complete',
        v.routingMode === 'AUTO_ROUTE' || v.resolutionGroup !== null,
        v.routingMode === 'AUTO_ROUTE' ? 'The route table decides both approval groups.' : `Results go to ${v.resolutionGroup ?? ''} for review.`,
        'A MANUAL rule needs a resolution group.'
      ),
      check(
        'EXAMPLE_HEATERS',
        'Known-bad example found',
        found.length > 0,
        `Finds the known-bad example heater (${found[0]?.entityKey ?? ''}) and leaves the known-good one alone.`,
        'Empty results are not proof of correctness (REF-52): the known-bad example heater was not found.'
      )
    );
  } else {
    checks.push(skipped('ONE_ROW_PER_HEATER_AND_FIELD', 'One row per heater and field'), skipped('PROPOSED_VALUES_ALLOWED', 'Proposed values allowed'), skipped('ROUTING_COMPLETE', 'Routing complete'), skipped('EXAMPLE_HEATERS', 'Known-bad example found'));
  }

  const passed = checks.every((c) => c.status !== 'FAIL');
  const returned = found.slice(0, ROW_LIMIT);
  const result: RuleTestResult = {
    ruleId,
    version,
    status: passed ? 'PASSED' : 'FAILED',
    elapsedMs: 180 + returned.length * 3,
    rowLimit: ROW_LIMIT,
    rowCount: returned.length,
    columns: textOk ? CONTRACT.map(([name, type]) => ({ name, type })) : [],
    rows: asRows(returned.slice(0, ROWS_SHOWN)),
    validations: checks,
    testedAtUtc: nowIso(),
    testedBy: me(),
  };
  demo().tests.set(key(ruleId, version), { result, hash: definitionHash(v) });
  Object.assign(v, { testStatus: result.status, testedAtUtc: result.testedAtUtc, testedBy: result.testedBy });
  return { test: result, version: v };
}

function assertFreshPass(v: RuleVersion, what: string): void {
  const tested = demo().tests.get(key(v.ruleId, v.version));
  if (!tested || tested.result.status !== 'PASSED' || tested.hash !== definitionHash(v)) {
    throw new Refusal(`${what} needs a passing test of this exact definition. Test it again first.`, 50410);
  }
}

/** `app.usp_rule_preview`: what a run would do now, with the de-duplication outcome. Writes nothing. */
export function preview(ruleId: string, version: number) {
  const v = findVersion(ruleId, version);
  assertFreshPass(v, 'Preview');
  const rule = sampleRule(ruleId);
  const found = rule ? rule.evaluate(demo().heaters, hasGroupBy(v.queryText)) : [];
  const rows: RulePreviewRow[] = found.map((x) => {
    const open = demo().requests.find((r) => r.equipmentId === x.equipmentId && r.fieldCode === x.fieldCode && isOpen(r));
    const outcome = v.routingMode === 'MANUAL' || x.fieldCode === null ? 'INVALID_BADGE' : open ? 'SUPPRESSED' : 'NEW_REQUEST';
    return {
      equipmentId: x.equipmentId,
      entityKey: x.entityKey,
      tag: x.tag,
      profitCenter: x.profitCenter,
      fieldCode: x.fieldCode,
      oldValue: x.oldValue,
      proposedValue: x.proposedValue,
      violation: x.violation,
      outcome,
      existingRequestRef: outcome === 'SUPPRESSED' ? (open?.requestRef ?? null) : null,
    };
  });
  return {
    rows,
    newRequests: rows.filter((r) => r.outcome === 'NEW_REQUEST').length,
    suppressed: rows.filter((r) => r.outcome === 'SUPPRESSED').length,
    invalidOnly: rows.filter((r) => r.outcome === 'INVALID_BADGE').length,
  };
}

// ---------------------------------------------------------------- publish and run

/** `app.usp_rule_publish`: one transaction, previous version's period closed. */
export function publish(ruleId: string, version: number, reason: string): RuleVersion {
  if (!currentPersona().canPublishRules) {
    throw new Refusal('Only roles with the publish permission may publish (Admin, SAPBusinessSupport; can_publish_business_rules).', 50411);
  }
  const v = findVersion(ruleId, version);
  if (v.status !== 'DRAFT') throw new Refusal('Only a draft can be published.', 50412);
  assertFreshPass(v, 'Publishing');
  if (!reason.trim()) throw new Refusal('Say why this version is published (change reason).', 50413);
  const now = nowIso();
  for (const old of demo().ruleVersions) {
    if (old.ruleId === ruleId && old.status === 'PUBLISHED') Object.assign(old, { status: 'RETIRED', effectiveToUtc: now });
  }
  Object.assign(v, {
    status: 'PUBLISHED',
    changeReason: reason.trim(),
    effectiveFromUtc: v.effectiveFromUtc && v.effectiveFromUtc > now ? v.effectiveFromUtc : now,
    publishedBy: me(),
    publishedAtUtc: now,
    queryHash: fingerprint(v.queryText),
    updatedAtUtc: now,
  });
  return v;
}

/** `app.usp_rule_run_execute @trigger = 'ON_DEMAND'`: every published rule; AUTO_ROUTE results become requests. */
export function runNow(): RuleRun {
  if (!currentPersona().canManageAdmin) throw new Refusal('Only an admin may run the rules on demand.', 50414);
  const startedAtUtc = nowIso();
  const lines: RunRuleLine[] = publishedVersions().map((v) => {
    const rule = sampleRule(v.ruleId);
    const found = rule ? rule.evaluate(demo().heaters, hasGroupBy(v.queryText)) : [];
    let created = 0;
    let suppressed = 0;
    if (v.routingMode === 'AUTO_ROUTE') {
      for (const x of found) {
        const heater = demo().heaters.find((h) => h.equipmentId === x.equipmentId);
        if (!heater || !x.fieldCode || x.proposedValue === null) continue;
        const { outcome } = createRequest({
          heater,
          fieldCode: x.fieldCode,
          oldValue: x.oldValue,
          newValue: x.proposedValue,
          reason: null,
          sourceType: 'BUSINESS_RULE',
          requestedBy: RULE_ENGINE,
          ruleId: v.ruleId,
          ruleVersion: v.version,
          note: x.note,
        });
        if (outcome === 'CREATED') created += 1;
        else suppressed += 1;
      }
    }
    return { ruleId: v.ruleId, version: v.version, status: 'SUCCEEDED', checked: demo().heaters.length, invalid: found.length, requestsCreated: created, requestsSuppressed: suppressed, message: null };
  });
  storeResults(demo(), startedAtUtc);
  const run: RuleRun = { runId: demo().nextRunId++, trigger: 'ON_DEMAND', startedAtUtc, finishedAtUtc: nowIso(), startedBy: me(), status: 'SUCCEEDED', lines };
  demo().runs.unshift(run);
  return run;
}
