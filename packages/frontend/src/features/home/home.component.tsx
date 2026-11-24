import clsx from 'clsx';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { hrefFor } from '@/app/router';
import { useRegisteredProfile } from '@/app/profile.context';
import { ErrorState, LoadingState } from '@/components/states';
import { button, card } from '@/components/ui';
import type { TabId } from '@/features/approvals/queue-model';
import { StatIllustration } from '@/features/equipment/stat-illustrations';
import { useLoad } from '@/hooks/use-load';
import { formatUtc } from '@/lib/format';

import { fetchHomeSummary, fetchMyCounts } from './home-api';
import type { DataQualitySummary, PipelineSummary, SeverityTier } from './home-types';

/** The verification goal the bar's marker shows (agreed 20 Nov, FINAL PLAN/11 §6 S-1). */
const VERIFICATION_TARGET = 75;

/**
 * S-1 Home (APP-8; content agreed 20 Nov, FINAL PLAN/11 §6 S-1). Everyone sees "My work": four counts, each opening
 * Approvals on that tab. Approvers and admins also see Data quality, Request pipeline and Awaiting SAP export,
 * programme-wide; the server decides that (it sends no programme numbers to anyone else), the screen only hides
 * the empty sections. From 1080px the person's own work takes 30% on the left, never under 22rem, the programme the rest; below that they stack.
 */
export function Home() {
  const profile = useRegisteredProfile();
  const who = profile?.email ?? '';
  const counts = useLoad(`home-counts|${who}`, fetchMyCounts);
  const summary = useLoad(`home-summary|${who}`, fetchHomeSummary);
  const dq = summary.status === 'ready' ? summary.data.dataQuality : null;
  const pipeline = summary.status === 'ready' ? summary.data.pipeline : null;
  const programme = summary.status !== 'ready' || dq !== null || pipeline !== null;

  return (
    <div className="space-y-400">
      <header className="flex flex-wrap items-start justify-between gap-400">
        <div className="min-w-0">
          <h1 className="break-words text-hero-700 font-semibold leading-hero-700">{profile?.displayName ? `Welcome, ${profile.displayName}` : 'Home'}</h1>
          {profile?.roles.length ? <p className="mt-200 text-300 text-muted-foreground">Roles: {profile.roles.join(', ')}</p> : null}
        </div>
        <a href={hrefFor('/approvals')} className={`${button.large} px-400`}>
          Review approvals
          <ArrowRight aria-hidden="true" className="icon-size-300" />
        </a>
      </header>

      <div className={clsx('grid items-start gap-400', programme && 'min-[1080px]:grid-cols-[minmax(22rem,3fr)_7fr]')}>
        <div className="space-y-400">
          <Section title="My work" hint="Requests waiting for you. Select a tile to open the list.">
            {counts.status === 'loading' ? <LoadingState rows={3} label="Loading your counts" /> : null}
            {counts.status === 'error' ? <ErrorState message={counts.message} onRetry={counts.retry} /> : null}
            {counts.status === 'ready' ? (
              <div className="grid grid-cols-2 gap-300">
                <WorkTile tab="RESPONSIBLE" label="Waiting for me, stage 1" hint="Responsible approval" n={counts.data.responsible} look="featured" />
                <WorkTile tab="ACCOUNTABLE" label="Waiting for me, stage 2" hint="Accountable approval" n={counts.data.accountable} look="tinted" />
                <WorkTile tab="RETURNED" label="Returned to me" hint="Needs correcting" n={counts.data.returned} />
                <WorkTile tab="MY_REQUESTS" label="My requests" hint="Raised by me, any status" n={counts.data.mine} />
              </div>
            ) : null}
          </Section>
          {pipeline ? <AwaitingExport n={pipeline.awaitingExport} /> : null}
        </div>

        {programme ? (
          <div className="min-w-0 space-y-400">
            {summary.status === 'loading' ? <LoadingState rows={6} label="Loading the programme numbers" /> : null}
            {summary.status === 'error' ? <ErrorState message={summary.message} onRetry={summary.retry} /> : null}
            {dq ? <DataQuality dq={dq} /> : null}
            {pipeline ? <Pipeline p={pipeline} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Section({ title, hint, children, divided = false }: { title: string; hint: string; children: ReactNode; divided?: boolean }) {
  return (
    <section className={`${card} p-500`}>
      <h2 className="text-400 font-semibold leading-400">{title}</h2>
      <p className={clsx('mt-100 text-300 text-muted-foreground', divided && 'border-b border-border pb-300')}>{hint}</p>
      <div className="mt-400">{children}</div>
    </section>
  );
}

const TILE = {
  featured: 'col-span-2 border-primary bg-primary text-primary-foreground hover:bg-primary-hover',
  tinted: 'col-span-2 border-info-border bg-info hover:border-ring',
  plain: 'border-border bg-card hover:border-secondary-hover-text',
} as const;

/** A count that opens Approvals on its tab. Stage 1 leads (filled), stage 2 follows (tinted), the rest are plain. */
function WorkTile({ tab, label, hint, n, look = 'plain' }: { tab: TabId; label: string; hint: string; n: number; look?: keyof typeof TILE }) {
  const strong = look !== 'plain';
  return (
    <a
      href={hrefFor('/approvals', { tab: tab === 'RESPONSIBLE' ? undefined : tab })}
      className={clsx(
        'group relative isolate flex flex-col overflow-hidden rounded-lg border p-400 transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        TILE[look]
      )}
    >
      {look === 'featured' ? (
        <StatIllustration id="verified" tone="neutral" onSelected className="pointer-events-none absolute -right-200 -top-300 -z-10 w-28 rotate-12 opacity-30" />
      ) : null}
      <span className={clsx('text-300', look === 'featured' ? 'text-card-selected-muted' : 'text-muted-foreground')}>{label}</span>
      <span className={clsx('mt-200 font-semibold', strong ? 'text-hero-800 leading-hero-800' : 'text-600 leading-600')}>{n}</span>
      <span className={clsx('mt-200 flex items-center justify-between gap-200 text-200', look === 'featured' ? 'text-card-selected-muted' : 'text-muted-foreground')}>
        {hint}
        {strong ? <ArrowRight aria-hidden="true" className={clsx('icon-size-300 shrink-0 transition-transform duration-150 group-hover:translate-x-100 motion-reduce:transition-none', look === 'tinted' && 'text-link')} /> : null}
      </span>
    </a>
  );
}

function AwaitingExport({ n }: { n: number }) {
  return (
    <section className="rounded-lg border border-info-border bg-info p-500">
      <h2 className="text-300 font-semibold">Awaiting SAP export</h2>
      <p className="mt-300 flex items-start gap-400">
        <span className="text-hero-800 font-semibold leading-hero-800 text-link">{n}</span>
        <span className="pt-200 text-300 text-muted-foreground">Approved, not yet in an EVOLVE file</span>
      </p>
    </section>
  );
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

const SEVERITY: Record<SeverityTier, { label: string; bar: string }> = {
  HIGH: { label: 'High', bar: 'bg-danger-solid' },
  MEDIUM: { label: 'Medium', bar: 'bg-warning-foreground' },
  LOW: { label: 'Low', bar: 'bg-primary' },
};

function DataQuality({ dq }: { dq: DataQualitySummary }) {
  const clean = pct(dq.cleanHeaters, dq.heaterCount);
  const run = dq.lastRun;
  return (
    <Section title="Data quality" hint="All heaters. Rule results come from the latest run of each published rule." divided>
      <div className="grid gap-500 xl:grid-cols-[1fr_1fr] xl:divide-x xl:divide-border">
        <div className="space-y-500 xl:pr-500">
          <div className="flex items-center gap-500">
            <Donut value={clean} />
            <div className="min-w-0">
              <h3 className="text-300 font-semibold">Clean heaters</h3>
              <p className="mt-100 text-200 text-muted-foreground">
                {dq.cleanHeaters} of {dq.heaterCount} pass every rule
              </p>
              <ul className="mt-200 space-y-100 text-200 text-muted-foreground">
                <li className="flex items-center gap-200">
                  <span aria-hidden="true" className="size-300 rounded-sm bg-success-foreground" />
                  Pass every rule
                </li>
                <li className="flex items-center gap-200">
                  <span aria-hidden="true" className="size-300 rounded-sm bg-muted" />
                  {dq.heaterCount - dq.cleanHeaters} need attention
                </li>
              </ul>
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-300">
              <h3 className="text-300 font-medium">Key fields verified</h3>
              <span className="text-500 font-semibold">{dq.avgVerificationPct}%</span>
            </div>
            <div
              className="relative mt-200 h-200 rounded-full bg-muted"
              role="meter"
              aria-label="Key fields verified"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={dq.avgVerificationPct}
            >
              <span className="block h-full rounded-full bg-primary" style={{ width: `${dq.avgVerificationPct}%` }} />
              <span aria-hidden="true" className="absolute -top-200 h-600 w-[2px] rounded-full bg-foreground" style={{ left: `${VERIFICATION_TARGET}%` }} />
            </div>
            <p className="mt-200 text-200 text-muted-foreground">Average across heaters (target {VERIFICATION_TARGET}%)</p>
          </div>
        </div>

        <div className="xl:pl-500">
          {/* The count leads, with its name and meaning beside it, like the pipeline's figures. */}
          <div className="flex items-center gap-300">
            {/* 36px: the height of the two lines beside it (no scale step between 32 and 40). */}
            <span className="text-[36px] font-semibold leading-none text-warning-foreground">{dq.openViolations}</span>
            <div>
              <h3 className="text-300 text-muted-foreground">Open rule violations</h3>
              <p className="text-200 text-muted-foreground">Invalid rule results</p>
            </div>
          </div>
          <ColumnChart
            title="Open violations by severity"
            unit="violations"
            rows={dq.violationsBySeverity.map((r) => ({ label: SEVERITY[r.tier].label, count: r.count, bar: SEVERITY[r.tier].bar }))}
          />
        </div>
      </div>

      <p className="mt-500 flex flex-wrap items-center gap-x-600 gap-y-100 rounded-md bg-muted px-300 py-200 text-200 text-muted-foreground">
        <span>Last rule run</span>
        {run ? (
          <>
            <span className={clsx('font-semibold', run.status === 'SUCCEEDED' ? 'text-success-foreground' : 'text-destructive')}>
              {run.status === 'SUCCEEDED' ? 'Succeeded' : 'Failed'}
            </span>
            <span>
              {formatUtc(run.startedAtUtc)} · {run.violations} found
            </span>
          </>
        ) : (
          <span>Never run</span>
        )}
      </p>
    </Section>
  );
}

/** The clean share as a ring: the share in green on a light track, the number in the middle. */
function Donut({ value }: { value: number }) {
  const r = 42;
  const length = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 100 100" className="w-32 shrink-0" role="img" aria-label={`${value}% of heaters are clean`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-muted)" strokeWidth="9" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke="var(--color-success-foreground)"
        strokeWidth="9"
        strokeDasharray={`${(value / 100) * length} ${length}`}
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="50" textAnchor="middle" dominantBaseline="central" className="fill-success-foreground text-[22px] font-semibold">
        {value}%
      </text>
    </svg>
  );
}

/** Ticks at 0, half and the top of a scale rounded up to a multiple of `step`. */
const scaleOf = (max: number, step: number) => {
  const top = Math.max(step, Math.ceil(max / step) * step);
  return { top, ticks: [0, top / 2, top] };
};

/**
 * A small column chart: one column per row, the value above it (so nothing depends on colour), light gridlines,
 * and the same numbers as a list for screen readers.
 */
function ColumnChart({ title, unit, rows }: { title: string; unit: string; rows: { label: string; count: number; bar: string }[] }) {
  const { top, ticks } = scaleOf(Math.max(...rows.map((r) => r.count), 0), 10);
  return (
    <figure className="mt-400">
      <figcaption className="text-300 font-semibold">{title}</figcaption>
      <div className="mt-300 grid grid-cols-[2rem_1fr] gap-x-200" aria-hidden="true">
        <div className="relative h-32 text-200 text-muted-foreground">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 translate-y-1/2" style={{ bottom: `${(t / top) * 100}%` }}>
              {t}
            </span>
          ))}
        </div>
        <div className="relative h-32">
          {ticks.map((t) => (
            <span key={t} className="absolute inset-x-0 border-t border-divider" style={{ bottom: `${(t / top) * 100}%` }} />
          ))}
          <div className="relative flex h-full items-end justify-around">
            {rows.map((r) => (
              <div key={r.label} className="flex h-full w-1/5 flex-col items-center justify-end" title={`${r.label}: ${r.count} ${unit}`}>
                <span className="mb-100 text-200 font-semibold">{r.count}</span>
                <span className={clsx('w-full rounded-t-md', r.bar)} style={{ height: `${(r.count / top) * 100}%` }} />
              </div>
            ))}
          </div>
        </div>
        <span />
        <div className="mt-200 flex justify-around text-200 text-muted-foreground">
          {rows.map((r) => (
            <span key={r.label} className="w-1/5 text-center">
              {r.label}
            </span>
          ))}
        </div>
      </div>
      <ul className="sr-only">
        {rows.map((r) => (
          <li key={r.label}>
            {r.label}: {r.count} {unit}
          </li>
        ))}
      </ul>
    </figure>
  );
}

const STAGE = {
  RESPONSIBLE: { label: 'Stage 1, responsible', bar: 'bg-primary' },
  ACCOUNTABLE: { label: 'Stage 2, accountable', bar: 'bg-primary/65' },
  RETURNED: { label: 'Returned', bar: 'bg-warning-foreground' },
} as const;

function Pipeline({ p }: { p: PipelineSummary }) {
  const total = Math.max(1, p.openByStage.reduce((n, r) => n + r.count, 0));
  return (
    <Section title="Request pipeline" hint="All change requests, every profit centre." divided>
      <div className="grid gap-500 xl:grid-cols-[1fr_1.2fr] xl:divide-x xl:divide-border">
        <div className="space-y-400 xl:pr-500">
          <Figure value={p.openTotal} label="Open requests" sub="Waiting at a stage or returned" />
          <Figure value={p.ageing} label="Ageing" sub={`Open more than ${p.ageingDays} days`} tone={p.ageing === 0 ? 'good' : 'warn'} />
          <Figure
            value={p.avgCycleDays === null ? '—' : `${p.avgCycleDays} d`}
            label="Cycle time"
            sub={p.withinTargetPct === null ? 'No request finished yet' : `${p.withinTargetPct}% within ${p.targetDays} days`}
          />
        </div>

        <figure className="xl:pl-500">
          <figcaption className="text-300 font-semibold">Open requests by stage</figcaption>
          <ul className="mt-300 space-y-300">
            {p.openByStage.map((r) => (
              <li key={r.stage} title={`${STAGE[r.stage].label}: ${r.count} requests`}>
                <div className="flex items-baseline justify-between text-200">
                  <span className="text-muted-foreground">{STAGE[r.stage].label}</span>
                  <span className="font-semibold">
                    {r.count}
                    <span className="sr-only"> requests</span>
                  </span>
                </div>
                <span aria-hidden="true" className="mt-200 block h-200 rounded-full bg-muted">
                  <span className={clsx('block h-full rounded-full', STAGE[r.stage].bar)} style={{ width: `${(r.count / total) * 100}%`, minWidth: r.count > 0 ? '4px' : 0 }} />
                </span>
              </li>
            ))}
          </ul>
          <div aria-hidden="true" className="mt-300 flex justify-between text-200 text-muted-foreground">
            <span>0</span>
            <span>{Math.round(total / 2)}</span>
            <span>{total} requests</span>
          </div>
        </figure>
      </div>
    </Section>
  );
}

function Figure({ value, label, sub, tone }: { value: ReactNode; label: string; sub: string; tone?: 'good' | 'warn' }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] items-start gap-300">
      <p
        className={clsx(
          'text-hero-700 font-semibold leading-hero-700',
          tone === 'good' ? 'text-success-foreground' : tone === 'warn' ? 'text-warning-foreground' : 'text-foreground'
        )}
      >
        {value}
      </p>
      <p className="pt-100">
        <span className="block text-300 font-medium">{label}</span>
        <span className="mt-100 block text-200 text-muted-foreground">{sub}</span>
      </p>
    </div>
  );
}
