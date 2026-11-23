import { ArrowRight, RefreshCw } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { hrefFor } from '@/app/router';
import { badge, button, card } from '@/components/ui';
import { BLANK, formatUtc, isBlank, orBlank } from '@/lib/format';
import { errorText } from '@/lib/act-answer';

import type { CheckRow, EventRow, RelatedRow, RequestView } from './request-api';
import {
  actorText,
  checkBadge,
  checkLabel,
  describeRoute,
  eventLabel,
  mergeWording,
  statusDisplay,
  summarizeChecks,
  valueText,
  type BadgeKind,
} from './request-model';

const DANGER_BADGE =
  'inline-flex items-center rounded-lg bg-danger-solid px-200-nudge py-100-nudge text-200 leading-200 font-medium text-on-danger';

/** A small coloured label; `danger` is red, the rest are the shared badges. */
export function Badge({ kind, children }: { kind: BadgeKind; children: ReactNode }) {
  return <span className={kind === 'danger' ? DANGER_BADGE : badge[kind]}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const display = statusDisplay(status);
  return <Badge kind={display.kind}>{display.text}</Badge>;
}

type TabId = 'request' | 'equipment' | 'evidence' | 'audit';

const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'request', label: 'Request & related' },
  { id: 'equipment', label: 'Equipment & FLOC' },
  { id: 'evidence', label: 'Evidence' },
  // { id: 'audit', label: 'Audit & routing' },
];

export interface RequestTabsProps {
  view: RequestView;
  /** The checks now on screen (the page keeps them, so the decision panel and the table never disagree). */
  checks: readonly CheckRow[];
  /** Reads the checks again and stores them; rejects with the function's message. */
  onRecheck: () => Promise<void>;
}

/** The four tabs of S-3, named as the plan names them. Arrow keys, Home and End move between tabs. */
export function RequestTabs({ view, checks, onRecheck }: RequestTabsProps) {
  const base = useId();
  const [active, setActive] = useState<TabId>('request');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    const target = TABS[next];
    if (target) setActive(target.id);
    tabs.current[next]?.focus();
  };

  return (
    <section aria-label="Request details" className="space-y-300">
      <div role="tablist" aria-label="Request sections" className="flex flex-wrap gap-100 border-b border-border">
        {TABS.map((tab, index) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`-mb-px rounded-t-md border-b-2 px-400 py-200 text-300 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'border-ring text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${base}-panel-${active}`} aria-labelledby={`${base}-tab-${active}`} tabIndex={0} className="focus-visible:outline-none">
        {active === 'request' ? <RequestPanel view={view} /> : null}
        {active === 'equipment' ? <EquipmentPanel view={view} checks={checks} onRecheck={onRecheck} /> : null}
        {active === 'evidence' ? <EvidencePanel view={view} /> : null}
        {/* {active === 'audit' ? <AuditPanel view={view} /> : null} */}
      </div>
    </section>
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

function ValueBox({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-200 text-muted-foreground">{label}</p>
      <p className="mt-100">
        {value === BLANK ? <span className="text-muted-foreground">{BLANK}</span> : <span className="id-plate text-300">{value}</span>}
      </p>
    </div>
  );
}

const TH = 'px-300 py-200 font-semibold';

// ---- tab 1: Request & related -----------------------------------------------------

function RequestPanel({ view }: { view: RequestView }) {
  const { request, gold, related } = view;
  const unit = gold?.fieldUnit ?? null;

  return (
    <div className="space-y-400">
      <Section title="Proposed Changes">
        <div className="flex flex-wrap items-center gap-400">
          <ValueBox label="Value the requester saw" value={valueText(request.oldValue, unit)} />
          <ArrowRight aria-hidden="true" className="icon-size-300 text-muted-foreground" />
          <ValueBox label="Proposed value" value={valueText(request.newValue, unit)} />
        </div>
        <dl className="mt-400 grid gap-300 md:grid-cols-4">
          <Item label="Field">
            {orBlank(request.fieldLabel ?? request.fieldCode)}
            {request.sapField ? (
              <>
                {' '}
                <span className="id-plate" title="The SAP field this changes">
                  {request.sapField}
                </span>
              </>
            ) : null}
          </Item>
          <Item label="Reason">{orBlank(request.reason)}</Item>
          <Item label="Note">{request.note ? <span>{request.note}</span> : BLANK}</Item>
          <Item label="Raised by">
            {/* {request.sourceLabel} */}
            <span className="text-muted-foreground">by {actorText(request.requestedBy)}</span>
          </Item>
          <Item label="Submitted">{formatUtc(request.requestedAtUtc)}</Item>
          <Item label="Detected by a rule">{request.detectedAtUtc ? formatUtc(request.detectedAtUtc) : 'Not from a rule'}</Item>
          <Item label="Comment when it was created">{orBlank(request.creationComment)}</Item>
          <Item label="Profit centre">{orBlank(request.profitCenterName)}</Item>
        </dl>
      </Section>

      {/* <Section title="Evidence snapshot" hint="What the requester or the rule had in front of them when the request was created.">
        {evidenceError !== null ? (
          <p className="text-300 text-muted-foreground">
            The evidence snapshot could not be read ({evidenceError}). The rest of this page is not affected.
          </p>
        ) : null}
        {evidenceError === null && parsed.kind === 'none' ? (
          <p className="text-300 text-muted-foreground">No evidence snapshot was kept for this request.</p>
        ) : null}
        {parsed.kind === 'raw' ? (
          <div>
            <p className="text-200 text-muted-foreground">The snapshot is not in the usual shape, so it is shown as it was stored:</p>
            <pre className="mt-200 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-300 text-200">{parsed.text}</pre>
          </div>
        ) : null}
        {parsed.kind === 'snapshot' ? (
          <div className="space-y-300">
            <dl className="grid gap-300 md:grid-cols-2">
              <Item label="Snapshot taken">{formatUtc(evidence?.createdAtUtc)}</Item>
              <Item label="Taken by">{actorText(evidence?.createdBy)}</Item>
              <Item label="Golden record version">{orBlank(parsed.facts.goldenVersionId)}</Item>
              <Item label="SAP baseline as of">{formatUtc(parsed.facts.baselineAsOfUtc)}</Item>
              <Item label="Route used">{orBlank(parsed.facts.routeUsed)}</Item>
              <Item label="Target">
                <Plate value={parsed.facts.entityKey} />
              </Item>
            </dl>
            {parsed.items.length > 0 ? (
              <div>
                <h3 className="text-300 font-semibold">What was attached</h3>
                <dl className="mt-200 grid gap-300 md:grid-cols-2">
                  {parsed.items.map((item) => (
                    <Item key={item.key} label={item.key}>
                      {item.value}
                    </Item>
                  ))}
                </dl>
                {parsed.itemsClipped ? <p className="mt-200 text-200 text-muted-foreground">More was attached than is shown here.</p> : null}
              </div>
            ) : (
              <p className="text-300 text-muted-foreground">Nothing was attached beyond the facts above.</p>
            )}
          </div>
        ) : null}
      </Section> */}

      <RelatedTable rows={related} />
    </div>
  );
}

function RelatedTable({ rows }: { rows: readonly RelatedRow[] }) {
  return (
    <Section title="Related requests">
      {rows.length === 0 ? (
        <p className="text-300 text-muted-foreground">No other request on this heater or location.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-250 leading-250">
            <caption className="sr-only">Related requests</caption>
            <thead>
              <tr className="bg-muted text-left text-200 uppercase tracking-wide text-muted-foreground">
                <th scope="col" className={TH}>Request</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={TH}>Field</th>
                <th scope="col" className={TH}>Raised by</th>
                <th scope="col" className={TH}>Submitted</th>
                <th scope="col" className={TH}>Overlap</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.requestId} className="border-t border-border align-top">
                  <th scope="row" className="px-300 py-200 text-left font-medium">
                    <a className="id-plate text-brand-foreground underline-offset-2 hover:underline" href={hrefFor(`/requests/${row.requestId}`)}>
                      {row.requestRef}
                    </a>
                  </th>
                  <td className="px-300 py-200">
                    <StatusBadge status={row.requestStatus} />
                  </td>
                  <td className="px-300 py-200">{orBlank(row.fieldLabel ?? row.fieldCode)}</td>
                  <td className="px-300 py-200">{row.sourceLabel}</td>
                  <td className="px-300 py-200 text-muted-foreground">{formatUtc(row.requestedAtUtc)}</td>
                  <td className="px-300 py-200">
                    {row.otherOpenRequestsSameField > 0 ? (
                      <span className={badge.warning} title="Other open requests target the same field">
                        overlaps {row.otherOpenRequestsSameField} open
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{BLANK}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

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
            <Item label="Engineering tag"><Plate value={gold.equipmentTagNumber} /></Item>
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
                  <tr key={row.code} className="border-t border-border align-top">
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

// ---- tab 3: Evidence ---------------------------------------------------------------

function EvidencePanel({ view }: { view: RequestView }) {
  const count = view.request.photoCount;
  return (
    <Section title="Photos and drawings" hint="Photos from the field : APP-7. This tab shows what is linked to the request so far.">
      {count === 0 ? (
        <p className="flex flex-wrap items-center gap-200 text-300">
          {/* <span className={badge.warning}>Evidence missing</span> */}
          <span className="text-muted-foreground">No photo is attached to this request.</span>
        </p>
      ) : (
        <p className="text-300">
          {count} {count === 1 ? 'photo is' : 'photos are'} linked to this request. The gallery is built in APP-7.
        </p>
      )}
    </Section>
  );
}

// ---- tab 4: Audit & routing --------------------------------------------------------

// Not shown at the moment (the Audit & routing tab was taken out of the page); exported so the code is kept and the build stays clean.
export function AuditPanel({ view }: { view: RequestView }) {
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
