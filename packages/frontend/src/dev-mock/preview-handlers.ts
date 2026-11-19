/**
 * Sample-data answers for the functions no phase has built yet (`lib/preview-functions.ts`), used ONLY by
 * `npm run dev:mock`. Each handler reads and writes the demo store, like the mock handlers of the built
 * functions. A phase that builds a function for real deletes its handler here.
 */
import type { PreviewFunctions } from '@/lib/preview-functions';

import { inboxOf, isReadBy, me } from './demo-store';

type PreviewHandlers = { [K in keyof PreviewFunctions]: (input: PreviewFunctions[K]['input']) => PreviewFunctions[K]['output'] };

const OK = { ok: true, status: 'OK', error: null, errorCode: null } as const;

export const previewHandlers: PreviewHandlers = {
  markNotificationsRead: ({ notificationIds }) => {
    const wanted = new Set(
      notificationIds
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
    );
    const email = me();
    let marked = 0;
    for (const n of inboxOf()) {
      if ((wanted.size === 0 || wanted.has(n.notificationId)) && !isReadBy(n, email)) {
        n.readBy.push(email);
        marked += 1;
      }
    }
    return { ...OK, marked, unreadCount: inboxOf().filter((n) => !isReadBy(n, email)).length };
  },
};

/** A short pause so loading states are visible, like a real call (same as mock-client). */
const LATENCY_MS = 150;

/** What `lib/preview-invoke.ts` calls under `npm run dev:mock`. Answers a copy, so a page cannot change the store by accident. */
export async function invokePreview<K extends keyof PreviewFunctions>(
  name: K,
  input: PreviewFunctions[K]['input']
): Promise<PreviewFunctions[K]['output']> {
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  const handler = previewHandlers[name] as (i: PreviewFunctions[K]['input']) => PreviewFunctions[K]['output'];
  return structuredClone(handler(input));
}
