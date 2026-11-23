import { ArrowLeft, Check, CircleSlash, Eye, FlaskConical, GitBranchPlus, Minus, Save, Send, X } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { hrefFor } from '@/app/router';
import { useProfile } from '@/app/profile.context';
import { FormField, HEAD_ROW, PageHeader, Panel, Pill, ROW, TABLE, TD, Tabs, TH } from '@/components/layout';
import { Modal } from '@/components/modal.component';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { button, identifierBadge, input } from '@/components/ui';
import { fetchCatalog, type CatalogRow } from '@/features/equipment/equipment-api';
import { useLoad } from '@/hooks/use-load';
import { errorText } from '@/lib/act-answer';
import { BLANK, formatUtc, orBlank } from '@/lib/format';

import { createRuleVersion, fetchRule, previewRule, publishRule, saveRuleDraft, testRule, type PreviewData, type RuleData } from './rules-api';
import {
  actionGate,
  canEditRule,
  CLASSES,
  draftFrom,
  fromDateInput,
  GROUPS,
  isDirty,
  rowsLine,
  STATE_DISPLAY,
  TEST_DISPLAY,
  toDateInput,
  type Person,
} from './rules-model';
import type { RuleDraftInput, RuleTestResult, RuleVersion } from './rules-types';
import { SqlEditor } from './sql-editor.component';

type TabId = 'definition' | 'test' | 'preview' | 'versions' | 'runs';

/**
 * S-9, one rule (APP-5 read, APP-6 editor; REF-52 §9; `guide/app/S-09`). Everyone reads the definition, the
 * versions and the runs. A member of the editor group edits a draft, tests it, previews what it would do, and a
 * publisher publishes it. Every disabled button says why.
 */
export function RulePage({ ruleId }: { ruleId: string }) {
  const load = useLoad(`rule|${ruleId}`, () => fetchRule(ruleId));
  const [fresh, setFresh] = useState<RuleData | null>(null);
  const data = fresh ?? (load.status === 'ready' ? load.data : null);

  if (data === null) {
    return (
      <div className="space-y-400">
        <BackLink />
        {load.status === 'error' ? <ErrorState message={load.message} onRetry={load.retry} /> : <LoadingState rows={8} label="Loading the rule" />}
      </div>
    );
  }
  return <Loaded ruleId={ruleId} data={data} refresh={async () => setFresh(await fetchRule(ruleId))} />;
}

function BackLink() {
  return (
    <a href={hrefFor('/rules')} className="inline-flex items-center gap-100 text-300 text-brand-foreground hover:underline">
      <ArrowLeft aria-hidden="true" className="icon-size-200" />
      All rules
    </a>
  );
}

function Loaded({ ruleId, data, refresh }: { ruleId: string; data: RuleData; refresh: () => Promise<void> }) {
  const { state } = useProfile();
  const profile = state.status === 'ready' && state.profile.status === 'OK' ? state.profile : null;
  const person: Person | null = profile;
  const catalog = useLoad('field-catalog', fetchCatalog);

  const draft = data.versions.find((v) => v.status === 'DRAFT') ?? null;
  const published = data.versions.find((v) => v.status === 'PUBLISHED') ?? null;
  const [selected, setSelected] = useState<number | null>(null);
  const v = data.versions.find((x) => x.version === selected) ?? draft ?? published ?? data.versions[0];

  const savedKey = `${v.ruleId}|${v.version}|${v.updatedAtUtc}`;
  const [edit, setEdit] = useState<{ key: string; form: RuleDraftInput } | null>(null);
  const form = edit && edit.key === savedKey ? edit.form : draftFrom(v);
  const update = (patch: Partial<RuleDraftInput>) => setEdit({ key: savedKey, form: { ...form, ...patch } });
  const editable = v.status === 'DRAFT' && canEditRule(person, v.editorGroup);
  const dirty = editable && isDirty(form, v);
  const gate = actionGate(v, dirty, person);

  const [tab, setTab] = useState<TabId>('definition');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null);
  const [preview, setPreview] = useState<{ key: string; data: PreviewData } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const lastTest = data.lastTest && data.lastTest.version === v.version ? data.lastTest : null;

  const act = async (label: string, work: () => Promise<string | void>) => {
    setBusy(label);
    setNotice(null);
    try {
      const done = await work();
      if (done) setNotice({ tone: 'success', text: done });
    } catch (e) {
      setNotice({ tone: 'danger', text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    act('save', async () => {
      await saveRuleDraft(form);
      await refresh();
      return `Draft v${v.version} saved.`;
    });
  const runTest = () =>
    act('test', async () => {
      const answer = await testRule(v.ruleId, v.version);
      await refresh();
      setTab('test');
      return answer.test.status === 'PASSED' ? 'The test passed. You can now preview the changes.' : undefined;
    });
  const runPreview = () =>
    act('preview', async () => {
      setPreview({ key: savedKey, data: await previewRule(v.ruleId, v.version) });
      setTab('preview');
    });
  const newVersion = () =>
    act('version', async () => {
      const created = await createRuleVersion(v.ruleId, v.ruleName);
      await refresh();
      setSelected(created.version);
      setTab('definition');
      return `Draft v${created.version} created from the published version. Edit it, test it, then publish it.`;
    });

  const state_ = STATE_DISPLAY[v.status];
  const test = TEST_DISPLAY[v.testStatus];

  return (
    <div className="space-y-400">
      <BackLink />
      <PageHeader title={v.ruleName} subtitle={v.description || undefined}>
        {/* <p className="mt-200 flex flex-wrap items-center gap-200">
          <span className="id-plate">{ruleId}</span>
          <Pill tone={state_.tone}>
            {state_.text} v{v.version}
          </Pill>
          {v.status === 'DRAFT' ? <Pill tone={test.tone}>{test.text}</Pill> : null}
        </p> */}
      </PageHeader>

      {draft && published ? (
        <div className="flex flex-wrap items-center gap-200 text-300" role="group" aria-label="Which version">
          <span className="text-muted-foreground">Showing</span>
          {[draft, published].map((x) => (
            <button key={x.version} type="button" aria-pressed={x.version === v.version} className={x.version === v.version ? button.small.replace('bg-card', 'bg-accent') : button.small} onClick={() => setSelected(x.version)}>
              {x.status === 'DRAFT' ? `Draft v${x.version}` : `Published v${x.version}`}
            </button>
          ))}
        </div>
      ) : null}

      {/* <ActionBar
        v={v}
        editable={editable}
        canCreateVersion={!draft && canEditRule(person, v.editorGroup)}
        gate={gate}
        busy={busy}
        onSave={() => void save()}
        onTest={() => void runTest()}
        onPreview={() => void runPreview()}
        onPublish={() => setPublishing(true)}
        onNewVersion={() => void newVersion()}
      /> */}

      {notice ? (
        <p role="status" className={`rounded-md border px-300 py-200 text-300 ${notice.tone === 'danger' ? 'border-destructive' : 'border-border bg-card'}`}>
          {notice.text}
        </p>
      ) : null}

      <Tabs<TabId>
        label="Rule"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'definition', label: 'Definition' },
          // { id: 'test', label: 'Test' },
          // { id: 'preview', label: 'Preview' },
          // { id: 'versions', label: `Versions (${data.versions.length})` },
          // { id: 'runs', label: 'Runs' },
        ]}
      >
        {tab === 'definition' ? (
          editable ? (
            <DefinitionForm form={form} update={update} catalog={catalog.status === 'ready' ? catalog.data : []} />
          ) : (
            <DefinitionView v={v} catalog={catalog.status === 'ready' ? catalog.data : []} />
          )
        ) : null}
        {tab === 'test' ? <TestPanel test={lastTest} v={v} /> : null}
        {tab === 'preview' ? <PreviewPanel data={preview && preview.key === savedKey ? preview.data : null} blockedBecause={gate.preview} /> : null}
        {tab === 'versions' ? <VersionsTable versions={data.versions} /> : null}
        {/* {tab === 'runs' ? <RunsTable runs={data.runs} /> : null} */}
      </Tabs>

      {publishing ? (
        <PublishDialog
          v={v}
          onClose={() => setPublishing(false)}
          onPublish={async (reason) => {
            const done = await publishRule(v.ruleId, v.version, reason);
            await refresh();
            setSelected(done.version);
            setPublishing(false);
            setNotice({ tone: 'success', text: `Version ${done.version} is published and in force from ${formatUtc(done.effectiveFromUtc)}. The next run uses it.` });
          }}
        />
      ) : null}
    </div>
  );
}

// ---- action bar ---------------------------------------------------------------------

// function ActionBar({
//   v,
//   editable,
//   canCreateVersion,
//   gate,
//   busy,
//   onSave,
//   onTest,
//   onPreview,
//   onPublish,
//   onNewVersion,
// }: {
//   v: RuleVersion;
//   editable: boolean;
//   canCreateVersion: boolean;
//   gate: ReturnType<typeof actionGate>;
//   busy: string | null;
//   onSave: () => void;
//   onTest: () => void;
//   onPreview: () => void;
//   onPublish: () => void;
//   onNewVersion: () => void;
// }) {
//   if (v.status !== 'DRAFT') {
//     return (
//       <div className="flex flex-wrap items-center gap-300 rounded-lg border border-border bg-card px-400 py-300 text-300">
//         <span className="text-muted-foreground">
//           {v.status === 'PUBLISHED' ? 'Published versions never change. To change this rule, create a new version, test it and publish it.' : 'This version is retired.'}
//         </span>
//         {canCreateVersion && v.status === 'PUBLISHED' ? (
//           <button type="button" className={`${button.secondary} ml-auto`} onClick={onNewVersion} disabled={busy !== null}>
//             <GitBranchPlus aria-hidden="true" className="icon-size-200" />
//             Create new version
//           </button>
//         ) : null}
//       </div>
//     );
//   }
//   const steps: { key: keyof typeof gate; label: string; icon: ReactNode; onClick: () => void; primary?: boolean }[] = [
//     { key: 'save', label: 'Save draft', icon: <Save aria-hidden="true" className="icon-size-200" />, onClick: onSave },
//     { key: 'test', label: 'Test query', icon: <FlaskConical aria-hidden="true" className="icon-size-200" />, onClick: onTest },
//     { key: 'preview', label: 'Preview changes', icon: <Eye aria-hidden="true" className="icon-size-200" />, onClick: onPreview },
//     { key: 'publish', label: 'Publish', icon: <Send aria-hidden="true" className="icon-size-200" />, onClick: onPublish, primary: true },
//   ];
//   const firstBlock = steps.map((s) => gate[s.key]).find((r) => r !== null && r !== 'Nothing has changed.');
//   return (
//     <div className="space-y-200 rounded-lg border border-border bg-card px-400 py-300">
//       <div className="flex flex-wrap items-center gap-200">
//         {steps.map((s, i) => (
//           <span key={s.key} className="flex items-center gap-200">
//             {i > 0 ? <span aria-hidden="true" className="text-muted-foreground">→</span> : null}
//             <button
//               type="button"
//               className={s.primary ? button.primary : button.secondary}
//               disabled={gate[s.key] !== null || busy !== null}
//               title={gate[s.key] ?? undefined}
//               onClick={s.onClick}
//             >
//               {s.icon}
//               {busy === s.key ? 'Working…' : s.label}
//             </button>
//           </span>
//         ))}
//       </div>
//       <p className="text-200 text-muted-foreground">
//         {!editable ? 'You can read this draft. Only members of the editor group may change it.' : firstBlock ? `Next: ${firstBlock}` : 'Ready to publish.'}
//       </p>
//     </div>
//   );
// }

// ---- definition ---------------------------------------------------------------------

function DefinitionForm({ form, update, catalog }: { form: RuleDraftInput; update: (patch: Partial<RuleDraftInput>) => void; catalog: readonly CatalogRow[] }) {
  const ids = useId();
  const toggle = (list: readonly string[], value: string) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  return (
    <div className="grid gap-400 lg:grid-cols-3">
      <div className="space-y-400 lg:col-span-2">
        <Panel title="Identity">
          <div className="grid gap-300 sm:grid-cols-2">
            <FormField label="Rule ID" htmlFor={`${ids}-id`} hint="Fixed after the first save.">
              <input id={`${ids}-id`} className={`${input} font-mono`} value={form.ruleId} readOnly />
            </FormField>
            <FormField label="Rule name" htmlFor={`${ids}-name`} error={form.ruleName.trim() ? null : 'A name is required.'}>
              <input id={`${ids}-name`} className={input} value={form.ruleName} onChange={(e) => update({ ruleName: e.target.value })} maxLength={120} />
            </FormField>
          </div>
          <div className="mt-300">
            <FormField label="Rule description" htmlFor={`${ids}-desc`} hint="What the rule checks, in plain words.">
              <textarea id={`${ids}-desc`} className={input} rows={3} value={form.description} onChange={(e) => update({ description: e.target.value })} />
            </FormField>
          </div>
        </Panel>
        <Panel title="Query" hint="Returns the ten columns of the output contract (01 §6.4). It runs read-only, inside a transaction that is always rolled back.">
          <div className="mb-300 grid gap-300 sm:grid-cols-3">
            <FormField label="Query language" htmlFor={`${ids}-lang`}>
              <input id={`${ids}-lang`} className={`${input} font-mono`} value="TSQL" readOnly />
            </FormField>
            <div className="sm:col-span-2">
              <FormField label="Execution target" htmlFor={`${ids}-target`} hint="The source tables the rule checks. ATLAS reads their gold copies.">
                <input id={`${ids}-target`} className={`${input} font-mono`} value={form.executionTarget} onChange={(e) => update({ executionTarget: e.target.value })} maxLength={200} />
              </FormField>
            </div>
          </div>
          <SqlEditor id={`${ids}-sql`} label="Query text" value={form.queryText} onChange={(queryText) => update({ queryText })} />
        </Panel>
      </div>
      <div className="space-y-400">
        <Panel title="Routing">
          <fieldset className="space-y-200">
            <legend className="sr-only">Routing mode</legend>
            {(['MANUAL', 'AUTO_ROUTE'] as const).map((mode) => (
              <label key={mode} className="flex items-start gap-200 text-300">
                <input type="radio" name={`${ids}-routing`} checked={form.routingMode === mode} onChange={() => update({ routingMode: mode })} className="mt-100" />
                <span>
                  <span className="font-medium">{mode === 'MANUAL' ? 'Manual' : 'Auto-route'}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="mt-300 space-y-300">
            <GroupSelect id={`${ids}-resp`} label="Responsible role" value={form.responsibleGroup} onChange={(responsibleGroup) => update({ responsibleGroup })} routeTable />
            <GroupSelect id={`${ids}-acc`} label="Accountable role" value={form.accountableGroup} onChange={(accountableGroup) => update({ accountableGroup })} routeTable />
          </div>
        </Panel>
        <Panel title="Ownership">
          <GroupSelect
            id={`${ids}-ed`}
            label="Rule editor role"
            hint="Its members may edit and test this rule, and review what a manual rule finds."
            value={form.editorGroup}
            onChange={(g) => update({ editorGroup: g ?? 'DataQualityOwner', resolutionGroup: g ?? 'DataQualityOwner' })}
          />
        </Panel>
        <Panel title="Scope" hint="ATLAS settings, not columns of the client's rule sheet.">
          <fieldset>
            <legend className="text-300 font-medium">Fields it may change</legend>
            <div className="mt-200 max-h-48 space-y-100 overflow-y-auto">
              {catalog.map((c) => (
                <label key={c.fieldCode} className="flex items-center gap-200 text-300">
                  <input type="checkbox" checked={form.allowedTargets.includes(c.fieldCode)} onChange={() => update({ allowedTargets: toggle(form.allowedTargets, c.fieldCode) })} />
                  {c.label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="mt-300">
            <legend className="text-300 font-medium">Applies to classes</legend>
            <div className="mt-200 flex flex-wrap gap-300">
              {CLASSES.map((c) => (
                <label key={c} className="flex items-center gap-100 text-300">
                  <input type="checkbox" checked={form.applicability.includes(c)} onChange={() => update({ applicability: toggle(form.applicability, c) })} />
                  {c}
                </label>
              ))}
            </div>
          </fieldset>
        </Panel>
        <Panel title="Period and reason">
          <div className="grid gap-300 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <FormField label="Effective from (UTC)" htmlFor={`${ids}-from`} hint="Empty = when published.">
              <input id={`${ids}-from`} type="date" className={input} value={toDateInput(form.effectiveFromUtc)} onChange={(e) => update({ effectiveFromUtc: fromDateInput(e.target.value) })} />
            </FormField>
            <FormField label="Effective to (UTC)" htmlFor={`${ids}-to`} hint="Empty = open-ended.">
              <input id={`${ids}-to`} type="date" className={input} value={toDateInput(form.effectiveToUtc)} onChange={(e) => update({ effectiveToUtc: fromDateInput(e.target.value) })} />
            </FormField>
          </div>
          <div className="mt-300">
            <FormField label="Version change reason" htmlFor={`${ids}-reason`} hint="Required to publish.">
              <textarea id={`${ids}-reason`} className={input} rows={2} value={form.changeReason} onChange={(e) => update({ changeReason: e.target.value })} />
            </FormField>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function GroupSelect({
  id,
  label,
  hint,
  value,
  onChange,
  allowNone = false,
  routeTable = false,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  allowNone?: boolean;
  routeTable?: boolean;
}) {
  return (
    <FormField label={label} htmlFor={id} hint={hint ?? (routeTable ? 'Empty = the approval route table decides.' : undefined)}>
      <select id={id} className={input} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        {routeTable ? <option value="">From the route table</option> : allowNone ? <option value="">None</option> : null}
        {value && !GROUPS.includes(value) ? <option value={value}>{`${value} (not a defined group)`}</option> : null}
        {GROUPS.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
    </FormField>
  );
}

function DefinitionView({ v, catalog }: { v: RuleVersion; catalog: readonly CatalogRow[] }) {
  const ids = useId();
  const label = (code: string) => catalog.find((c) => c.fieldCode === code)?.label ?? code;
  return (
    <div className="grid gap-400 lg:grid-cols-3">
      <Panel title="Query" className="lg:col-span-2" hint="Everyone can read the SQL of every rule.">
        {v.queryText.trim() ? <SqlEditor id={`${ids}-sql`} label="Rule SQL (read only)" value={v.queryText} readOnly /> : <EmptyState title="SQL not written yet" hint="The client's workbook lists this rule without SQL. A rule author writes it in a draft." />}
      </Panel>
      <Panel title="Policy">
        <dl className="space-y-200 text-300">
          <Fact label="Query language">{v.queryLanguage}</Fact>
          <Fact label="Execution target">
            <span className="font-mono">{v.executionTarget || BLANK}</span>
          </Fact>
          <Fact label="Routing mode">{v.routingMode === 'AUTO_ROUTE' ? 'Auto-route' : 'Manual'}</Fact>
          <Fact label="Rule editor role">{v.editorGroup}</Fact>
          <Fact label="Responsible role">{v.responsibleGroup ?? 'From the route table'}</Fact>
          <Fact label="Accountable role">{v.accountableGroup ?? 'From the route table'}</Fact>
          <Fact label="Effective from → to (UTC)">{v.effectiveFromUtc ? `${formatUtc(v.effectiveFromUtc)} → ${v.effectiveToUtc ? formatUtc(v.effectiveToUtc) : 'open-ended'}` : 'Not yet'}</Fact>
          <Fact label="Version change reason">{v.changeReason || BLANK}</Fact>
          <Fact label="Fields it may change (ATLAS)">{v.allowedTargets.length ? v.allowedTargets.map(label).join(', ') : 'None (reports only)'}</Fact>
          <Fact label="Applies to classes (ATLAS)">{v.applicability.join(', ') || BLANK}</Fact>
          {v.publishedBy ? <Fact label="Published">{`${v.publishedBy}, ${formatUtc(v.publishedAtUtc)}`}</Fact> : null}
        </dl>
      </Panel>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-200 text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

// ---- test ---------------------------------------------------------------------------

const CHECK_ICON = {
  PASS: <Check aria-hidden="true" className="icon-size-200 text-success-foreground" />,
  FAIL: <X aria-hidden="true" className="icon-size-200 text-destructive" />,
  SKIPPED: <Minus aria-hidden="true" className="icon-size-200 text-muted-foreground" />,
};

function TestPanel({ test, v }: { test: RuleTestResult | null; v: RuleVersion }) {
  if (!test) {
    return <EmptyState title="Not tested yet" hint={v.status === 'DRAFT' ? 'Save the draft, then press Test query. The test runs the SQL read-only and checks what it returns.' : 'Tests belong to drafts.'} />;
  }
  return (
    <div className="space-y-400">
      <div className="flex flex-wrap items-center gap-300">
        <Pill tone={test.status === 'PASSED' ? 'success' : 'danger'}>{test.status === 'PASSED' ? 'Passed' : 'Failed'}</Pill>
        <span className="text-300 text-muted-foreground">{rowsLine(test)}</span>
        <span className="text-200 text-muted-foreground">
          Tested {formatUtc(test.testedAtUtc)} by {test.testedBy}
        </span>
        {v.testStatus === 'STALE' ? <Pill tone="warning">The draft changed after this test</Pill> : null}
      </div>
      <Panel title="Checks" hint="Kept apart from the data: a check can fail even when rows come back.">
        <ul className="divide-y divide-border">
          {test.validations.map((c) => (
            <li key={c.code} className="flex items-start gap-300 py-200 text-300">
              <span className="mt-100">{CHECK_ICON[c.status]}</span>
              <span className="min-w-0">
                <span className="font-medium">{c.label}</span>
                <span className="block text-200 text-muted-foreground">{c.message}</span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      {test.columns.length > 0 ? (
        <Panel title="What it returns" hint="Columns and types, then the first rows.">
          <p className="mb-300 flex flex-wrap gap-100">
            {test.columns.map((c) => (
              <span key={c.name} className="id-plate">
                {c.name} <span className="text-muted-foreground">{c.type}</span>
              </span>
            ))}
          </p>
          {test.rows.length === 0 ? (
            <p className="text-300 text-muted-foreground">No rows.</p>
          ) : (
            <div className="max-h-96 overflow-auto rounded-md border border-border">
              <table className={TABLE}>
                <caption className="sr-only">Sample rows</caption>
                <thead className="sticky top-0">
                  <tr className={HEAD_ROW}>
                    {test.columns.map((c) => (
                      <th key={c.name} scope="col" className={`${TH} normal-case`}>
                        {c.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {test.rows.map((row, i) => (
                    <tr key={i} className={ROW}>
                      {test.columns.map((c) => (
                        <td key={c.name} className={`${TD} font-mono text-200`}>
                          {row[c.name] ?? <span className="text-muted-foreground">NULL</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : null}
    </div>
  );
}

// ---- preview ------------------------------------------------------------------------

const OUTCOME = {
  NEW_REQUEST: { text: 'New request', tone: 'warning' },
  SUPPRESSED: { text: 'Already open', tone: 'neutral' },
  INVALID_BADGE: { text: 'Invalid badge only', tone: 'info' },
} as const;

function PreviewPanel({ data, blockedBecause }: { data: PreviewData | null; blockedBecause: string | null }) {
  if (!data) {
    return <EmptyState title="No preview yet" hint={blockedBecause ?? 'Press Preview changes to see what a run would do now.'} />;
  }
  return (
    <div className="space-y-300">
      <p role="note" className="flex flex-wrap items-center gap-200 rounded-md border border-border bg-info px-300 py-200 text-300 text-info-foreground">
        <CircleSlash aria-hidden="true" className="icon-size-200" />
        Preview creates nothing: no results, requests, approvals or notifications.
      </p>
      <p className="text-300">
        A run now would raise <strong>{data.newRequests}</strong> new request{data.newRequests === 1 ? '' : 's'}, skip <strong>{data.suppressed}</strong> already open, and mark{' '}
        <strong>{data.invalidOnly}</strong> heater{data.invalidOnly === 1 ? '' : 's'} Invalid without a request.
      </p>
      {data.rows.length === 0 ? (
        <EmptyState title="Nothing to change" hint="No heater breaks this rule today." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className={TABLE}>
            <caption className="sr-only">What a run would do</caption>
            <thead>
              <tr className={HEAD_ROW}>
                <th scope="col" className={TH}>Heater</th>
                <th scope="col" className={TH}>Profit centre</th>
                <th scope="col" className={TH}>Change</th>
                <th scope="col" className={TH}>Why</th>
                <th scope="col" className={TH}>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={`${r.entityKey}-${i}`} className={ROW}>
                  <td className={TD}>
                    {r.equipmentId !== null ? (
                      <a className={`${identifierBadge} hover:underline`} href={hrefFor(`/equipment/${r.equipmentId}`)}>
                        {r.tag ?? r.entityKey}
                      </a>
                    ) : (
                      <span className={identifierBadge}>{r.entityKey}</span>
                    )}
                  </td>
                  <td className={TD}>{orBlank(r.profitCenter)}</td>
                  <td className={TD}>{r.fieldCode ? `${r.fieldCode}: ${orBlank(r.oldValue)} → ${orBlank(r.proposedValue)}` : BLANK}</td>
                  <td className={`${TD} max-w-xs whitespace-normal`}>{r.violation}</td>
                  <td className={TD}>
                    <Pill tone={OUTCOME[r.outcome].tone}>{OUTCOME[r.outcome].text}</Pill>
                    {r.existingRequestRef ? <span className="ml-200 text-200 text-muted-foreground">{r.existingRequestRef}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- versions and runs --------------------------------------------------------------

function VersionsTable({ versions }: { versions: readonly RuleVersion[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className={TABLE}>
        <caption className="sr-only">Versions</caption>
        <thead>
          <tr className={HEAD_ROW}>
            <th scope="col" className={TH}>Version</th>
            <th scope="col" className={TH}>Status</th>
            <th scope="col" className={TH}>In force</th>
            <th scope="col" className={TH}>Published by</th>
            <th scope="col" className={TH}>Reason</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.version} className={ROW}>
              <td className={TD}>v{v.version}</td>
              <td className={TD}>
                <Pill tone={STATE_DISPLAY[v.status].tone}>{STATE_DISPLAY[v.status].text}</Pill>
              </td>
              <td className={TD}>{v.effectiveFromUtc ? `${formatUtc(v.effectiveFromUtc)} → ${v.effectiveToUtc ? formatUtc(v.effectiveToUtc) : 'now'}` : BLANK}</td>
              <td className={TD}>{v.publishedBy ? `${v.publishedBy} · ${formatUtc(v.publishedAtUtc)}` : BLANK}</td>
              <td className={`${TD} max-w-xs whitespace-normal`}>{v.changeReason || BLANK}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunsTable({ runs }: { runs: RuleData['runs'] }) {
  if (runs.length === 0) return <EmptyState title="Never run" hint="A rule runs once it is published: every night, or when an admin presses Run rules now." />;
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className={TABLE}>
        <caption className="sr-only">Runs of this rule</caption>
        <thead>
          <tr className={HEAD_ROW}>
            <th scope="col" className={TH}>Run</th>
            <th scope="col" className={TH}>Started</th>
            <th scope="col" className={TH}>Version</th>
            <th scope="col" className={TH}>Status</th>
            <th scope="col" className={TH}>Checked</th>
            <th scope="col" className={TH}>Invalid</th>
            <th scope="col" className={TH}>Requests raised</th>
            <th scope="col" className={TH}>Already open</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.runId} className={ROW}>
              <td className={TD}>
                {r.runId} <span className="text-200 text-muted-foreground">{r.trigger === 'ON_DEMAND' ? 'on demand' : 'nightly'}</span>
              </td>
              <td className={TD}>{formatUtc(r.startedAtUtc)}</td>
              <td className={TD}>v{r.version}</td>
              <td className={TD}>
                <Pill tone={r.status === 'SUCCEEDED' ? 'success' : 'danger'}>{r.status === 'SUCCEEDED' ? 'Succeeded' : 'Failed'}</Pill>
              </td>
              <td className={TD}>{r.checked}</td>
              <td className={TD}>{r.invalid}</td>
              <td className={TD}>{r.requestsCreated}</td>
              <td className={TD}>{r.requestsSuppressed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- publish ------------------------------------------------------------------------

function PublishDialog({ v, onClose, onPublish }: { v: RuleVersion; onClose: () => void; onPublish: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState(v.changeReason);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onPublish(reason);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Publish ${v.ruleId} v${v.version}?`}
      size="lg"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className={button.secondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={button.primary}
            disabled={busy || !reason.trim()}
            onClick={() => void confirm()}
          >
            <Send aria-hidden="true" className="icon-size-200" />
            Publish v{v.version}
          </button>
        </>
      }
    >
      <div className="space-y-300 text-300">
        <p>This exact definition goes into force. The previous version's period ends now, and the next run (tonight, or Run rules now) uses it.</p>
        <dl className="grid gap-200 sm:grid-cols-2">
          <Fact label="Routing mode">{v.routingMode === 'AUTO_ROUTE' ? 'Auto-route' : 'Manual'}</Fact>
          <Fact label="Rule editor role">{v.editorGroup}</Fact>
          <Fact label="Responsible / accountable role">{v.responsibleGroup || v.accountableGroup ? `${orBlank(v.responsibleGroup)} / ${orBlank(v.accountableGroup)}` : 'From the route table'}</Fact>
          <Fact label="Effective (UTC)">{v.effectiveFromUtc ? formatUtc(v.effectiveFromUtc) : 'From now'} → {v.effectiveToUtc ? formatUtc(v.effectiveToUtc) : 'open-ended'}</Fact>
        </dl>
        <SqlEditor id={`${ids}-sql`} label="SQL to publish" value={v.queryText} readOnly rows={8} />
        <FormField label="Version change reason" htmlFor={`${ids}-reason`} error={reason.trim() ? null : 'A reason is required.'}>
          <textarea id={`${ids}-reason`} className={input} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        {error ? <ErrorState message={error} /> : null}
      </div>
    </Modal>
  );
}
