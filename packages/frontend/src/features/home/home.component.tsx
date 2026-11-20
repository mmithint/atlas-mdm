import clsx from 'clsx';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { hrefFor } from '@/app/router';
import { useRegisteredProfile } from '@/app/profile.context';
import { PageHeader, Panel, Pill } from '@/components/layout';
import { ErrorState, LoadingState } from '@/components/states';
import { card } from '@/components/ui';
import type { TabId } from '@/features/approvals/queue-model';
import { useLoad } from '@/hooks/use-load';
import { formatUtc } from '@/lib/format';

import { fetchHomeSummary, fetchMyCounts } from './home-api';
import type { DataQualitySummary, PipelineSummary } from './home-types';

/**
 * S-1 Home (APP-8; content agreed 20 Nov, FINAL PLAN/11 §6 S-1). Everyone sees "My work": four counts, each opening
 * Approvals on that tab. Approvers and admins also see Data quality and Request pipeline, programme-wide; the server
 * decides that (it sends no programme numbers to anyone else), the screen only hides the empty sections.
 */
export function Home() {
  const profile = useRegisteredProfile();
  const who = profile?.email ?? '';
  const counts = useLoad(`home-counts|${who}`, fetchMyCounts);
  const summary = useLoad(`home-summary|${who}`, fetchHomeSummary);

  return (
    <div className="space-y-400">
      <PageHeader title={profile?.displayName ? `Welcome, ${profile.displayName}` : 'Home'} subtitle={profile?.roles.length ? `Roles: ${profile.roles.join(', ')}` : undefined} />

      <Panel title="My work" hint="Requests waiting for you. Select a tile to open the list.">
        {counts.status === 'loading' ? <LoadingState rows={1} label="Loading your counts" /> : null}
        {counts.status === 'error' ? <ErrorState message={counts.message} onRetry={counts.retry} /> : null}
        {counts.status === 'ready' ? (
          <div className="grid grid-cols-2 gap-300 lg:grid-cols-4">
            <WorkTile tab="RESPONSIBLE" label="Waiting for me, stage 1" hint="Responsible approval" n={counts.data.responsible} />
            <WorkTile tab="ACCOUNTABLE" label="Waiting for me, stage 2" hint="Accountable approval" n={counts.data.accountable} />
            <WorkTile tab="RETURNED" label="Returned to me" hint="Needs correcting" n={counts.data.returned} />
            <WorkTile tab="MY_REQUESTS" label="My requests" hint="Raised by me, any status" n={counts.data.mine} />
          </div>
        ) : null}
      </Panel>

      {summary.status === 'loading' ? <LoadingState rows={4} label="Loading the programme numbers" /> : null}
      {summary.status === 'error' ? <ErrorState message={summary.message} onRetry={summary.retry} /> : null}
      {summary.status === 'ready' && summary.data.dataQuality ? <DataQuality dq={summary.data.dataQuality} /> : null}
      {summary.status === 'ready' && summary.data.pipeline ? <Pipeline p={summary.data.pipeline} /> : null}
    </div>
  );
}

function WorkTile({ tab, label, hint, n }: { tab: TabId; label: string; hint: string; n: number }) {
  return (
    <a href={hrefFor('/approvals', { tab: tab === 'RESPONSIBLE' ? undefined : tab })} className={clsx(card, 'block p-300 transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2')}>
      <span className="block text-200 text-muted-foreground">{label}</span>
      <span className="mt-100 block text-700 font-semibold tabular-nums">{n}</span>
      <span className="block text-200 text-muted-foreground">{hint}</span>
    </a>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-md border border-border p-300">
      <div className="text-200 text-muted-foreground">{label}</div>
      <div className="mt-100 text-600 font-semibold tabular-nums">{value}</div>
      {sub ? <div className="text-200 text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

function DataQuality({ dq }: { dq: DataQualitySummary }) {
  const run = dq.lastRun;
  return (
    <Panel title="Data quality" hint="All heaters. Rule results come from the latest run of each published rule.">
      <div className="grid grid-cols-2 gap-300 lg:grid-cols-4">
        <Stat label="Clean heaters" value={`${pct(dq.cleanHeaters, dq.heaterCount)}%`} sub={`${dq.cleanHeaters} of ${dq.heaterCount} pass every rule`} />
        <Stat label="Open rule violations" value={dq.openViolations} sub="Invalid rule results" />
        <Stat label="Key fields verified" value={`${dq.avgVerificationPct}%`} sub="Average across heaters (target 75%)" />
        <Stat
          label="Last rule run"
          value={
            run ? (
              <Pill tone={run.status === 'SUCCEEDED' ? 'success' : 'danger'}>
                {run.status === 'SUCCEEDED' ? <CheckCircle2 aria-hidden="true" className="icon-size-100 mr-100" /> : <AlertTriangle aria-hidden="true" className="icon-size-100 mr-100" />}
                {run.status === 'SUCCEEDED' ? 'Succeeded' : 'Failed'}
              </Pill>
            ) : (
              'Never run'
            )
          }
          sub={run ? `${formatUtc(run.startedAtUtc)} · ${run.violations} found` : undefined}
        />
      </div>
      <BarList
        title="Open violations by severity"
        rows={dq.violationsBySeverity.map((r) => ({ label: r.tier.charAt(0) + r.tier.slice(1).toLowerCase(), count: r.count }))}
        unit="violations"
      />
    </Panel>
  );
}

const STAGE_LABEL = { RESPONSIBLE: 'Stage 1, responsible', ACCOUNTABLE: 'Stage 2, accountable', RETURNED: 'Returned' } as const;

function Pipeline({ p }: { p: PipelineSummary }) {
  return (
    <Panel title="Request pipeline" hint="All change requests, every profit centre.">
      <div className="grid grid-cols-2 gap-300 lg:grid-cols-4">
        <Stat label="Open requests" value={p.openTotal} sub="Waiting at a stage or returned" />
        <Stat label="Ageing" value={p.ageing} sub={`Open more than ${p.ageingDays} days`} />
        <Stat
          label="Cycle time"
          value={p.avgCycleDays === null ? 'None yet' : `${p.avgCycleDays} d`}
          sub={p.withinTargetPct === null ? 'No request finished yet' : `${p.withinTargetPct}% within ${p.targetDays} days`}
        />
        <Stat label="Awaiting SAP export" value={p.awaitingExport} sub="Approved, not yet in an EVOLVE file" />
      </div>
      <BarList title="Open requests by stage" rows={p.openByStage.map((r) => ({ label: STAGE_LABEL[r.stage], count: r.count }))} unit="requests" />
    </Panel>
  );
}

/**
 * A small single-series horizontal bar chart: one hue, the value written beside each bar (so nothing depends on
 * colour), a tooltip on each bar, and the same numbers as a list for screen readers.
 */
function BarList({ title, rows, unit }: { title: string; rows: { label: string; count: number }[]; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <figure className="mt-400">
      <figcaption className="text-300 font-semibold">{title}</figcaption>
      <ul className="mt-200 space-y-200">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-200 text-300" title={`${r.label}: ${r.count} ${unit}`}>
            <span className="truncate text-muted-foreground">{r.label}</span>
            <span className="h-300 rounded-sm bg-muted" aria-hidden="true">
              <span className="block h-full rounded-sm bg-primary" style={{ width: `${(r.count / max) * 100}%`, minWidth: r.count > 0 ? '4px' : 0 }} />
            </span>
            <span className="text-right tabular-nums">
              {r.count}
              <span className="sr-only"> {unit}</span>
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
