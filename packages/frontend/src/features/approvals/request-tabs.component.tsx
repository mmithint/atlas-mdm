import { RefreshCw } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { Tabs, type TabDef } from '@/components/layout';
import { badge, button, card, identifierBadge } from '@/components/ui';
import { BLANK, formatUtc, isBlank, orBlank } from '@/lib/format';
import { errorText } from '@/lib/act-answer';

import { RelatedRequests } from './related-requests.component';
import type { CheckRow, EventRow, RequestView } from './request-api';
import {
  actorText,
  checkBadge,
  checkLabel,
  describeRoute,
  eventLabel,
  mergeWording,
  statusDisplay,
  summarizeChecks,
  type BadgeKind,
} from './request-model';

/** A small coloured label; `danger` is red, the rest are the shared badges. */
export function Badge({ kind, children }: { kind: BadgeKind; children: ReactNode }) {
  return <span className={badge[kind]}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const display = statusDisplay(status);
  return <Badge kind={display.kind}>{display.text}</Badge>;
}

type TabId = 'related' | 'equipment' | 'history';

export interface RequestTabsProps {
  view: RequestView;
  /** The checks now on screen (the page keeps them, so the decision panel and the table never disagree). */
  checks: readonly CheckRow[];
  /** Reads the checks again and stores them; rejects with the function's message. */
  onRecheck: () => Promise<void>;
}

/** The secondary content of S-3 in the design system's Tabs: related requests, the equipment and its checks, and the history. */
export function RequestTabs({ view, checks, onRecheck }: RequestTabsProps) {
  const [active, setActive] = useState<TabId>('related');
  const tabs: readonly TabDef<TabId>[] = [
    { id: 'related', label: `Related requests (${view.related.length})` },
    { id: 'equipment', label: 'Equipment & FLOC' },
    { id: 'history', label: 'History' },
  ];
  return (
    <Tabs tabs={tabs} active={active} onChange={setActive} label="Request sections">
      {active === 'related' ? <RelatedRequests request={view.request} related={view.related} /> : null}
      {active === 'equipment' ? <EquipmentPanel view={view} checks={checks} onRecheck={onRecheck} /> : null}
      {active === 'history' ? <AuditPanel view={view} /> : null}
    </Tabs>
  );
}

// ---- small building blocks ---------------------------------------------------------

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`${card} p-400`}>
      <h2 id={id} className="text-400 font-semibold">
        {title}
      </h2>
      {hint ? <p className="mt-100 text-200 text-muted-foreground">{hint}</p> : null}
      <div className="mt-300">{children}</div>
    </section>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-200 text-muted-foreground">{label}</dt>
      <dd className="mt-100 break-words text-300">{children}</dd>
    </div>
  );
}

function Plate({ value }: { value: string | null | undefined }) {
  return isBlank(value) ? <span className="text-muted-foreground">{BLANK}</span> : <span className="id-plate">{value}</span>;
}

function TagBadge({ value }: { value: string | null | undefined }) {
  return isBlank(value) ? <span className="text-muted-foreground">{BLANK}</span> : <span className={identifierBadge}>{value}</span>;
}

const TH = 'px-300 py-200 font-semibold';

// ---- tab 2: Equipment & FLOC ------------------------------------------------------

function EquipmentPanel({ view, checks, onRecheck }: { view: RequestView; checks: readonly CheckRow[]; onRecheck: () => Promise<void> }) {
  const { gold } = view;
  const isFloc = gold?.entityType === 'FLOC';

  return (
    <div className="space-y-400">
      <Section title={isFloc ? 'Functional location in the golden record now' : 'Gold Layer'}>
        {gold === null ? (
          <p className="text-300 text-muted-foreground">The heater or location is no longer in the golden record.</p>
        ) : (
          <dl className="grid gap-300 md:grid-cols-2 xl:grid-cols-4">
            <Item label="Equipment number"><Plate value={gold.equipmentNumber} /></Item>
            <Item label="Engineering tag"><TagBadge value={gold.equipmentTagNumber} /></Item>
            <Item label="Description">{orBlank(gold.equipmentDescription)}</Item>
            <Item label="Functional location (FLOC)"><Plate value={gold.functionalLocation} /></Item>
            <Item label="FLOC description">{orBlank(gold.flocDescription)}</Item>
            <Item label="Equipment class">{orBlank(gold.equipClass)}</Item>
            <Item label="Manufacturer">{orBlank(gold.manufacturer)}</Item>
            <Item label="Model number">{orBlank(gold.modelNumber)}</Item>
            <Item label="Serial number">{orBlank(gold.manufacturerSerialNumber)}</Item>
            <Item label="Equipment status">{orBlank(gold.equipmentUserStatus)}</Item>
            <Item label="Profit centre">{orBlank(gold.profitCenterName)}</Item>
            <Item label="Golden record version">{orBlank(gold.goldenVersionId)}</Item>
            <Item label="Last approved change">{gold.lastChangedAtUtc ? formatUtc(gold.lastChangedAtUtc) : 'none yet (SAP baseline)'}</Item>
          </dl>
        )}
      </Section>

      {/* <Section title="The field being changed" hint="Blank means no value is held, not zero.">
        <div className="flex flex-wrap items-center gap-400">
          <ValueBox label="Value the requester saw" value={valueText(request.oldValue, unit)} />
          <ValueBox label="Value in the golden record now" value={valueText(gold?.fieldCurrentValue, unit)} />
          <ValueBox label="Proposed value" value={valueText(request.newValue, unit)} />
        </div>
        {mismatch !== null ? (
          <p role="alert" className="mt-300 flex items-start gap-200 rounded-md bg-warning px-300 py-200 text-300 text-warning-foreground">
            <TriangleAlert aria-hidden="true" className="icon-size-300 mt-100 shrink-0" />
            <span>The golden value changed after this request was raised: {mismatch}</span>
          </p>
        ) : null}
        {mismatch === null && closed ? (
          <p className="mt-300 text-200 text-muted-foreground">
            The request is closed, so the values are not compared: the golden record may have changed since.
          </p>
        ) : null}
      </Section> */}

      <ChecksTable checks={checks} onRecheck={onRecheck} />
    </div>
  );
}

function ChecksTable({ checks, onRecheck }: { checks: readonly CheckRow[]; onRecheck: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summary = summarizeChecks(checks);
  const rows = [...checks].sort((a, b) => a.order - b.order);

  const recheck = async () => {
    setBusy(true);
    setError(null);
    try {
      await onRecheck();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Approval checks">
      <div className="flex flex-wrap items-center justify-between gap-300">
        <p className="text-300 text-muted-foreground">
          {summary.pass} passed, {summary.fail} failed, {summary.notChecked} not checked
        </p>
        <button type="button" className={button.small} onClick={() => void recheck()} disabled={busy}>
          <RefreshCw aria-hidden="true" className="icon-size-100" />
          {busy ? 'Checking…' : 'Check again'}
        </button>
      </div>
      {error !== null ? (
        <p role="alert" className="mt-200 text-300 text-destructive">
          The checks could not be read again: {error}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="mt-300 text-300 text-muted-foreground">No checks were returned for this request.</p>
      ) : (
        <div className="mt-300 overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-250 leading-250">
            <caption className="sr-only">Approval checks</caption>
            <thead>
              <tr className="bg-muted text-left text-200 uppercase tracking-wide text-muted-foreground">
                <th scope="col" className={TH}>Check</th>
                <th scope="col" className={TH}>Result</th>
                <th scope="col" className={TH}>What was found</th>
                <th scope="col" className={TH}>Checked</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const result = checkBadge(row.checkStatus);
                return (
                  <tr key={row.code} className="border-t border-divider align-top hover:bg-row-hover">
                    <th scope="row" className="px-300 py-200 text-left font-medium">
                      {checkLabel(row.code)}
                      <span className="mt-100 block">
                        <span className="id-plate">{row.code}</span>
                      </span>
                    </th>
                    <td className="px-300 py-200">
                      <Badge kind={result.kind}>{result.text}</Badge>
                    </td>
                    <td className="px-300 py-200">{row.message}</td>
                    <td className="px-300 py-200 text-muted-foreground">{formatUtc(row.checkedAtUtc)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ---- tab 3: History ----------------------------------------------------------------

/** The History tab: routing, outcome and the full audit trail, oldest first. */
function AuditPanel({ view }: { view: RequestView }) {
  const { request, route } = view;
  const events = [...view.events].sort((a, b) => a.eventId - b.eventId);
  const merge = mergeWording(request.mergeOutcome);

  return (
    <div className="space-y-400">
      <Section title="Routing">
        <dl className="grid gap-300 md:grid-cols-3">
          <Item label="Responsible group (first stage)">
            <span className="id-plate">{request.responsibleGroup}</span>
          </Item>
          <Item label="Accountable group (second stage)">
            <span className="id-plate">{request.accountableGroup}</span>
          </Item>
          <div className="md:col-span-2">
            <dt className="text-200 text-muted-foreground">Route applied</dt>
            <dd className="mt-100 text-300">
              {request.routeId === null ? (
                'No route was recorded for this request.'
              ) : route === null ? (
                `Route ${request.routeId} (its details are not available).`
              ) : (
                <>
                  {describeRoute(route)}
                  <span className="block text-muted-foreground">
                    {route.responsibleRole} <span aria-hidden="true">→</span>
                    <span className="sr-only"> then </span> {route.accountableRole}
                  </span>
                </>
              )}
            </dd>
          </div>
        </dl>
      </Section>

      <Section title="Outcome">
        <dl className="grid gap-300 md:grid-cols-2">
          <Item label="Last decision">
            {request.lastDecisionBy ? `${actorText(request.lastDecisionBy)}, ${formatUtc(request.lastDecisionAtUtc)}` : 'No decision yet'}
          </Item>
          <Item label="Golden record">
            <span className={merge.tone === 'warning' ? 'text-warning-foreground' : undefined}>{merge.text}</span>
            {request.mergedAtUtc ? <span className="block text-muted-foreground">Applied {formatUtc(request.mergedAtUtc)}</span> : null}
            {request.goldenVersionId !== null ? <span className="block text-muted-foreground">Golden record version {request.goldenVersionId}</span> : null}
          </Item>
          {request.exportedAtUtc ? (
            <Item label="Exported for SAP">
              {formatUtc(request.exportedAtUtc)}
              {request.evolveBatchId !== null ? <span className="block text-muted-foreground">Batch {request.evolveBatchId}, row {orBlank(request.evolveRowNumber)}</span> : null}
            </Item>
          ) : null}
        </dl>
      </Section>

      <Section title="History" hint="One entry per action, oldest first. Entries are never edited or deleted.">
        {events.length === 0 ? <p className="text-300 text-muted-foreground">No history was returned.</p> : <Timeline events={events} />}
      </Section>
    </div>
  );
}

function Timeline({ events }: { events: readonly EventRow[] }) {
  return (
    <ol className="space-y-300" aria-label="Request history">
      {events.map((event) => (
        <li key={event.eventId} className="border-l-2 border-border pl-300">
          <p className="flex flex-wrap items-baseline gap-x-300 gap-y-100">
            <span className="text-300 font-semibold">{eventLabel(event.eventType)}</span>
          </p>
          <p className="mt-100 text-200 text-muted-foreground">
            {actorText(event.actor)}
            {event.actorGroup ? <> · {event.actorGroup}</> : null}
            {event.decidedAs === 'ADMIN' ? <> · as an admin (not a group member)</> : null} · {formatUtc(event.occurredAtUtc)}
          </p>
          {event.samePersonBothStages ? (
            <p className="mt-100 text-200 text-muted-foreground">The same person approved the first stage (allowed: admin or member of both groups).</p>
          ) : null}
          {event.eventType === 'RETURNED' && event.returnedTo ? (
            <p className="mt-100 text-200 text-muted-foreground">Returned to {actorText(event.returnedTo)}</p>
          ) : null}
          {event.comments ? <p className="mt-100 break-words text-300">“{event.comments}”</p> : null}
          {event.statusFrom || event.statusTo ? (
            <p className="mt-100 text-200 text-muted-foreground">
              {event.statusFrom ? statusDisplay(event.statusFrom).text : 'new'} <span aria-hidden="true">→</span>
              <span className="sr-only"> became </span> {event.statusTo ? statusDisplay(event.statusTo).text : BLANK}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
