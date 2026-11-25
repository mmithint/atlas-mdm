import clsx from 'clsx';
import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { hrefFor } from '@/app/router';
import { identifierBadge } from '@/components/ui';
import { formatUtc } from '@/lib/format';

import type { DetailRow } from './request-api';
import { STALE_HOURS, actorText, ageText, isClosed, requestTitle } from './request-model';
import { StatusPill } from './status-pill.component';
import type { QueuePosition } from './use-queue-position';

/**
 * The top of the request: what it changes, its status, the IDs people search by, how long it has been open
 * (amber after 7 days) and, when the request is in the person's queue, where it sits there with Previous and Next.
 */
export function ApprovalHeader({ request, queue, actions }: { request: DetailRow; queue: QueuePosition | null; actions?: ReactNode }) {
  const open = !isClosed(request.requestStatus);
  const stale = open && request.ageHours !== null && request.ageHours > STALE_HOURS;
  const age = open ? ageText(request.ageHours) : null;
  const closed = !open && request.lastDecisionAtUtc ? `Closed ${formatUtc(request.lastDecisionAtUtc)}${request.lastDecisionBy ? ` by ${actorText(request.lastDecisionBy)}` : ''}` : null;
  const meta = [age ? `Open ${age}` : closed, request.profitCenterName].filter(Boolean).join(' · ');

  return (
    <header className="flex flex-wrap items-start justify-between gap-400">
      <div className="min-w-0 flex-1 space-y-300">
        <div className="flex flex-wrap items-center gap-x-300 gap-y-100">
          <h1 className="break-words text-500 font-semibold">{requestTitle(request)}</h1>
          {queue !== null ? <QueueNav queue={queue} /> : null}
        </div>
        {/* Where it stands: the status, then how long it has been open and for which profit centre. */}
        <div className="flex flex-wrap items-center gap-x-300 gap-y-100">
          <StatusPill status={request.requestStatus} />
          {meta ? (
            <span className={clsx('inline-flex items-center gap-100 text-300', stale ? 'font-medium text-warning-foreground' : 'text-muted-foreground')}>
              {stale ? <TriangleAlert aria-hidden="true" className="icon-size-200" /> : null}
              {meta}
              {stale ? <span className="sr-only"> (open longer than 7 days)</span> : null}
            </span>
          ) : null}
        </div>
        {/* What it is about: each ID named, so nobody has to guess which chip is which. */}
        <dl className="flex flex-wrap items-center gap-x-500 gap-y-200 text-200">
          <Ident label="Request">
            <span className="id-plate">{request.requestRef}</span>
          </Ident>
          {request.equipmentNumber ? (
            <Ident label="Equipment">
              {request.equipmentId !== null ? (
                <a
                  className="id-plate underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  href={hrefFor(`/equipment/${request.equipmentId}`)}
                  title="Open the heater"
                >
                  {request.equipmentNumber}
                </a>
              ) : (
                <span className="id-plate">{request.equipmentNumber}</span>
              )}
            </Ident>
          ) : null}
          {request.equipmentTagNumber ? (
            <Ident label="Tag">
              <span className={identifierBadge}>{request.equipmentTagNumber}</span>
            </Ident>
          ) : null}
          {request.functionalLocation ? (
            <Ident label="FLOC">
              <span className="id-plate">{request.functionalLocation}</span>
            </Ident>
          ) : null}
        </dl>
      </div>
      {actions ? <div className="sm:self-start">{actions}</div> : null}
    </header>
  );
}

function Ident({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-200">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const ARROW =
  'inline-flex h-700 w-700 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors duration-150 hover:border-input hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:text-disabled-foreground disabled:hover:border-border disabled:hover:bg-card motion-reduce:transition-none';

/** Icons only: the previous and next request in the person's queue. The place in the queue ("3 of 12") is in the tooltips. */
function QueueNav({ queue }: { queue: QueuePosition }) {
  const place = `${queue.index + 1} of ${queue.total} in my queue`;
  const arrow = (id: number | null, label: string, key: string, icon: ReactNode) =>
    id === null ? (
      <button type="button" className={ARROW} disabled aria-label={`${label} request (none)`} title={`No ${label.toLowerCase()} request · ${place}`}>
        {icon}
      </button>
    ) : (
      <a className={ARROW} href={hrefFor(`/requests/${id}`)} aria-label={`${label} request`} title={`${label} request (${key}) · ${place}`}>
        {icon}
      </a>
    );
  return (
    <nav aria-label={`Requests in my queue, ${place}`} className="flex items-center gap-100">
      {arrow(queue.prevId, 'Previous', 'K', <ChevronLeft aria-hidden="true" className="icon-size-200" />)}
      {arrow(queue.nextId, 'Next', 'J', <ChevronRight aria-hidden="true" className="icon-size-200" />)}
    </nav>
  );
}
