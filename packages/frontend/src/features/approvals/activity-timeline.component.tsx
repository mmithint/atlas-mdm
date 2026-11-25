import clsx from 'clsx';
import { useState } from 'react';

import { Panel } from '@/components/layout';

import type { DetailRow, EventRow, Viewer } from './request-api';
import { STAGE_LABELS, actorText, eventLabel, isClosed, stampText } from './request-model';

/** The newest events shown at first; the rest are one click away. */
const SHOWN = 4;

/** Who a pending request is waiting on, from its data: the stage's group, or the person it was returned to. */
function waitingOn(request: DetailRow, viewer: Viewer): { who: string; stage: string } | null {
  if (request.requestStatus === 'PENDING_RESPONSIBLE') return { who: viewer.canDecide ? 'you' : request.responsibleGroup, stage: STAGE_LABELS.responsible };
  if (request.requestStatus === 'PENDING_ACCOUNTABLE') return { who: viewer.canDecide ? 'you' : request.accountableGroup, stage: STAGE_LABELS.accountable };
  if (request.requestStatus === 'RETURNED') return { who: request.returnRecipient ?? 'the requester', stage: 'Returned for correction' };
  return null;
}

/**
 * What happened and what is next, newest first: a blue "Waiting on you" (or on a group) at the top while the request
 * is open, then one entry per event with who, when and any comment. Everything comes from the request's history.
 */
export function ActivityTimeline({ request, events, viewer }: { request: DetailRow; events: readonly EventRow[]; viewer: Viewer }) {
  const [all, setAll] = useState(false);
  const newest = [...events].sort((a, b) => b.eventId - a.eventId);
  const shown = all ? newest : newest.slice(0, SHOWN);
  const waiting = isClosed(request.requestStatus) ? null : waitingOn(request, viewer);
  const since = newest[0]?.occurredAtUtc ?? request.requestedAtUtc;

  return (
    <Panel title="Activity" className="p-500!">
      {waiting === null && newest.length === 0 ? (
        <p className="text-300 text-muted-foreground">No activity was recorded for this request.</p>
      ) : (
        <ol className="relative space-y-400 pl-500" aria-label="Request activity, newest first">
          <span aria-hidden="true" className="absolute bottom-100 left-[0.5rem] top-100 w-px -translate-x-1/2 bg-border" />
          {waiting !== null ? (
            <Item current title={`Waiting on ${waiting.who}`} sub={`${waiting.stage} · since ${stampText(since)}`} />
          ) : null}
          {shown.map((e) => (
            <Item
              key={e.eventId}
              title={eventLabel(e.eventType)}
              sub={`${actorText(e.actor)}${e.actorGroup ? ` · ${e.actorGroup}` : ''}${e.decidedAs === 'ADMIN' ? ' · as an admin' : ''} · ${stampText(e.occurredAtUtc)}`}
              note={e.comments}
              extra={e.eventType === 'RETURNED' && e.returnedTo ? `Returned to ${actorText(e.returnedTo)}` : null}
            />
          ))}
        </ol>
      )}
      {newest.length > SHOWN ? (
        <button type="button" className="mt-300 text-300 font-medium text-link underline-offset-2 hover:underline" aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show ${newest.length - SHOWN} earlier`}
        </button>
      ) : null}
    </Panel>
  );
}

function Item({ title, sub, note, extra, current = false }: { title: string; sub: string; note?: string | null; extra?: string | null; current?: boolean }) {
  return (
    <li className="relative">
      <span
        aria-hidden="true"
        className={clsx('absolute -left-500 top-100 icon-size-200 rounded-full border-2', current ? 'border-primary bg-primary ring-4 ring-focus-ring' : 'border-input bg-card')}
      />
      <p className={clsx('text-300 font-medium', current && 'font-semibold')}>{title}</p>
      <p className="text-200 text-muted-foreground">{sub}</p>
      {extra ? <p className="text-200 text-muted-foreground">{extra}</p> : null}
      {note ? <p className="mt-100 break-words text-300">“{note}”</p> : null}
    </li>
  );
}
