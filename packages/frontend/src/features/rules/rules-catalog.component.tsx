import { FilePlus2, Play, Search } from 'lucide-react';
import { useId, useState } from 'react';

import { hrefFor, navigate } from '@/app/router';
import { useProfile } from '@/app/profile.context';
import { HEAD_ROW, PageHeader, Panel, Pill, ROW, TABLE, TD, TH } from '@/components/layout';
import { Modal } from '@/components/modal.component';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { button, input } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { errorText } from '@/lib/act-answer';
import { formatUtc } from '@/lib/format';

import { createRuleVersion, fetchRuleCatalog, runRulesNow, type CatalogData } from './rules-api';
import { STATE_DISPLAY, TEST_DISPLAY } from './rules-model';
import type { RuleRun } from './rules-types';

/**
 * S-9 Rules, the catalog (APP-5; `guide/app/S-09` §2): every rule with its state, version, routing, editor
 * group, last test and last run, visible to everyone; Run rules now for admins; New rule for rule authors.
 */
export function RulesCatalog() {
  const [reload, setReload] = useState(0);
  const load = useLoad(`rule-catalog|${reload}`, fetchRuleCatalog);
  const { state } = useProfile();
  const profile = state.status === 'ready' && state.profile.status === 'OK' ? state.profile : null;
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'PUBLISHED' | 'DRAFT'>('ALL');
  const [dialog, setDialog] = useState<'run' | 'new' | null>(null);
  const searchId = useId();

  return (
    <div className="space-y-400">
      <PageHeader
        title="Business rules"
        subtitle="Rules check the golden record and say what is wrong. Everyone can read a rule and its SQL. DataQualityOwner members write and test rules; Admin and SAPBusinessSupport publish them. The published rules run every night and on demand."
        actions={
          <>
            {profile?.canEditRules ? (
              <button type="button" className={button.secondary} onClick={() => setDialog('new')}>
                <FilePlus2 aria-hidden="true" className="icon-size-200" />
                New rule
              </button>
            ) : null}
            {profile?.canManageAdmin ? (
              <button type="button" className={button.primary} onClick={() => setDialog('run')}>
                <Play aria-hidden="true" className="icon-size-200" />
                Run rules now
              </button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-300">
        <div className="min-w-0 flex-1 sm:max-w-md">
          <label htmlFor={searchId} className="sr-only">
            Find a rule
          </label>
          <div className="relative">
            <Search aria-hidden="true" className="icon-size-200 absolute left-300 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input id={searchId} className={`${input} pl-800`} placeholder="Find a rule by ID or name" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        </div>
        <label className="flex items-center gap-200 text-300">
          <span className="text-muted-foreground">Show</span>
          <select className={`${input} w-auto`} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="ALL">All rules</option>
            <option value="PUBLISHED">Published</option>
            <option value="DRAFT">Drafts only</option>
          </select>
        </label>
      </div>

      {load.status === 'loading' ? <LoadingState rows={6} label="Loading the rules" /> : null}
      {load.status === 'error' ? <ErrorState message={load.message} onRetry={load.retry} /> : null}
      {load.status === 'ready' ? (
        <>
          <CatalogTable data={load.data} text={text} filter={filter} />
          <RecentRuns runs={load.data.runs} />
        </>
      ) : null}

      {dialog === 'run' ? <RunDialog onClose={() => setDialog(null)} onDone={() => setReload((n) => n + 1)} /> : null}
      {dialog === 'new' ? <NewRuleDialog onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

function CatalogTable({ data, text, filter }: { data: CatalogData; text: string; filter: 'ALL' | 'PUBLISHED' | 'DRAFT' }) {
  const needle = text.trim().toLowerCase();
  const rows = data.rules.filter(
    (r) =>
      (filter === 'ALL' || (filter === 'PUBLISHED' ? r.publishedVersion !== null : r.draftVersion !== null)) &&
      (!needle || r.ruleId.toLowerCase().includes(needle) || r.ruleName.toLowerCase().includes(needle))
  );
  if (rows.length === 0) return <EmptyState title="No rule matches" hint="Clear the search or show all rules." />;
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className={TABLE}>
        <caption className="sr-only">Business rules</caption>
        <thead>
          <tr className={HEAD_ROW}>
            <th scope="col" className={TH}>Rule</th>
            <th scope="col" className={TH}>State</th>
            <th scope="col" className={TH}>Routing mode</th>
            <th scope="col" className={TH}>Rule editor role</th>
            <th scope="col" className={TH}>Last test</th>
            <th scope="col" className={TH}>Last run</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const state = STATE_DISPLAY[r.state];
            const test = TEST_DISPLAY[r.testStatus];
            return (
              <tr key={r.ruleId} className={`${ROW} hover:bg-hover`}>
                <td className={TD}>
                  <a href={hrefFor(`/rules/${encodeURIComponent(r.ruleId)}`)} className="id-plate text-brand-foreground hover:underline">
                    {r.ruleId}
                  </a>
                  <p className="mt-100 text-200 text-muted-foreground">{r.ruleName}</p>
                </td>
                <td className={TD}>
                  <div className="flex flex-wrap gap-100">
                    <Pill tone={state.tone}>
                      {state.text}
                      {r.publishedVersion !== null ? ` v${r.publishedVersion}` : ''}
                    </Pill>
                    {r.publishedVersion !== null && r.draftVersion !== null ? <Pill tone="info">Draft v{r.draftVersion}</Pill> : null}
                  </div>
                </td>
                <td className={TD}>{r.routingMode === 'AUTO_ROUTE' ? 'Auto-route' : 'Manual'}</td>
                <td className={TD}>{r.editorGroup}</td>
                <td className={TD}>{r.hasSql ? <Pill tone={test.tone}>{test.text}</Pill> : <span className="text-200 text-muted-foreground">SQL not written yet</span>}</td>
                <td className={TD}>
                  {r.lastRun ? (
                    <div className="text-200">
                      <p>{formatUtc(r.lastRun.startedAtUtc)}</p>
                      <p className="text-muted-foreground">
                        {r.lastRun.invalid} invalid · {r.lastRun.requestsCreated} raised · {r.lastRun.requestsSuppressed} already open
                      </p>
                    </div>
                  ) : (
                    <span className="text-200 text-muted-foreground">Not run (not published)</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RecentRuns({ runs }: { runs: readonly RuleRun[] }) {
  return (
    <Panel title="Recent runs" hint="A run freezes the published versions, checks every heater, and stores the results. A failed rule never clears earlier results.">
      {runs.length === 0 ? (
        <p className="text-300 text-muted-foreground">No run yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {runs.map((run) => (
            <li key={run.runId} className="flex flex-wrap items-center justify-between gap-200 py-200 text-300">
              <span className="flex flex-wrap items-center gap-200">
                <span className="id-plate">Run {run.runId}</span>
                <Pill tone={run.status === 'SUCCEEDED' ? 'success' : 'danger'}>{run.status === 'SUCCEEDED' ? 'Succeeded' : 'Failed'}</Pill>
                <span className="text-muted-foreground">
                  {run.trigger === 'ON_DEMAND' ? 'On demand' : 'Nightly'} · {formatUtc(run.startedAtUtc)}
                </span>
              </span>
              <span className="text-200 text-muted-foreground">
                {run.lines.length} rules · {sum(run, 'invalid')} invalid · {sum(run, 'requestsCreated')} requests raised · {sum(run, 'requestsSuppressed')} already open
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const sum = (run: RuleRun, key: 'invalid' | 'requestsCreated' | 'requestsSuppressed') => run.lines.reduce((n, l) => n + l[key], 0);

function RunDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<RuleRun | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setRun(await runRulesNow());
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={run ? `Run ${run.runId} finished` : 'Run the published rules now?'}
      onClose={onClose}
      busy={busy}
      footer={
        run ? (
          <>
            <a className={button.secondary} href={hrefFor('/approvals')}>
              Open Approvals
            </a>
            <button type="button" className={button.primary} onClick={onClose}>
              Close
            </button>
          </>
        ) : (
          <>
            <button type="button" className={button.secondary} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={button.primary} onClick={() => void start()} disabled={busy}>
              {busy ? 'Running…' : 'Run now'}
            </button>
          </>
        )
      }
    >
      {run ? (
        <div className="space-y-300 text-300">
          <p className="flex items-center gap-200">
            <Pill tone={run.status === 'SUCCEEDED' ? 'success' : 'danger'}>{run.status === 'SUCCEEDED' ? 'Succeeded' : 'Failed'}</Pill>
            <span className="text-muted-foreground">{formatUtc(run.finishedAtUtc)}</span>
          </p>
          <ul className="space-y-200">
            {run.lines.map((l) => (
              <li key={l.ruleId} className="rounded-md border border-border p-300">
                <p className="font-medium">
                  <span className="id-plate">{l.ruleId}</span> v{l.version}
                </p>
                <p className="mt-100 text-200 text-muted-foreground">
                  {l.checked} heaters checked · {l.invalid} invalid · {l.requestsCreated} new requests · {l.requestsSuppressed} not raised again (already open)
                </p>
              </li>
            ))}
          </ul>
          <p className="text-200 text-muted-foreground">New requests wait in the responsible group's queue. MANUAL rules only mark heaters Invalid.</p>
        </div>
      ) : (
        <div className="space-y-200 text-300">
          <p>Every published rule checks every heater now, the same way as the nightly run.</p>
          <p className="text-muted-foreground">
            AUTO_ROUTE rules raise a request for each result (an open request with the same value is not raised twice). MANUAL rules only mark heaters Invalid.
          </p>
          {error ? <ErrorState message={error} /> : null}
        </div>
      )}
    </Modal>
  );
}

function NewRuleDialog({ onClose }: { onClose: () => void }) {
  const [ruleId, setRuleId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idField = useId();
  const nameField = useId();

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const v = await createRuleVersion(ruleId.trim().toUpperCase(), name);
      navigate(`/rules/${encodeURIComponent(v.ruleId)}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New rule"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className={button.secondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={button.primary} disabled={busy || !ruleId.trim() || !name.trim()} onClick={() => void create()}>
            Create draft
          </button>
        </>
      }
    >
      <div className="space-y-300">
        <div className="space-y-100">
          <label htmlFor={idField} className="block text-300 font-medium">
            Rule ID
          </label>
          <input id={idField} className={`${input} font-mono uppercase`} value={ruleId} onChange={(e) => setRuleId(e.target.value)} placeholder="HEATER_SERIAL_UNIQUE" maxLength={64} />
          <p className="text-200 text-muted-foreground">Capital letters, digits and underscores, in the client's vocabulary (D-16). Fixed after the first save.</p>
        </div>
        <div className="space-y-100">
          <label htmlFor={nameField} className="block text-300 font-medium">
            Rule name
          </label>
          <input id={nameField} className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Serial number unique per manufacturer" maxLength={120} />
        </div>
        {error ? <ErrorState message={error} /> : null}
      </div>
    </Modal>
  );
}
