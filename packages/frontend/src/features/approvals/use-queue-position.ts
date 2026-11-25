import { useEffect, useRef } from 'react';

import { navigate } from '@/app/router';
import { useLoad } from '@/hooks/use-load';

import { fetchQueue } from './queue-api';
import { criteriaFromQuery, type TabId } from './queue-model';

export interface QueuePosition {
  /** 0-based place in the person's queue. */
  index: number;
  total: number;
  prevId: number | null;
  nextId: number | null;
}

/** The queue tab a request waits in, by its status; other statuses are in none of the person's queues. */
const TAB_OF: Readonly<Record<string, TabId>> = {
  PENDING_RESPONSIBLE: 'RESPONSIBLE',
  PENDING_ACCOUNTABLE: 'ACCOUNTABLE',
  RETURNED: 'RETURNED',
};

/**
 * Where this request sits in the person's own queue (the same list as the Approvals tab), so the page can say
 * "3 of 12 in my queue" and step to the previous or next request. It is read once per request: after a decision the
 * request leaves the queue, and the neighbours found before it stay valid for "Next request". A request that is not in
 * the queue (or a queue that cannot be read) simply shows no position.
 */
export function useQueuePosition(requestId: number, status: string): QueuePosition | null {
  const tab = TAB_OF[status];
  const load = useLoad(`queue-position:${requestId}`, async (): Promise<QueuePosition | null> => {
    if (tab === undefined) return null;
    const page = await fetchQueue(criteriaFromQuery(new URLSearchParams({ tab, size: '100' })), 0);
    const index = page.rows.findIndex((r) => r.requestId === requestId);
    if (index < 0) return null;
    return { index, total: page.totalMatches, prevId: page.rows[index - 1]?.requestId ?? null, nextId: page.rows[index + 1]?.requestId ?? null };
  });
  return load.status === 'ready' ? load.data : null;
}

export const openRequest = (id: number) => navigate(`/requests/${id}`);

/** True when the key press belongs to a text field or a dialog, so a shortcut must not fire. */
export function isTypingTarget(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || document.querySelector('[role="dialog"]') !== null;
}

/** J goes to the next request in the queue, K to the previous one. */
export function useQueueKeys(queue: QueuePosition | null): void {
  const latest = useRef(queue);
  useEffect(() => {
    latest.current = queue;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event)) return;
      const q = latest.current;
      if (q === null) return;
      const key = event.key.toLowerCase();
      if (key === 'j' && q.nextId !== null) openRequest(q.nextId);
      if (key === 'k' && q.prevId !== null) openRequest(q.prevId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
