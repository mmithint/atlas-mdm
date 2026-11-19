/**
 * The notification bell's read (APP-4). In-app notifications are queued by the request procedures since APP-3;
 * `getMyNotifications` returns the signed-in person's newest ones and how many are not yet marked as read.
 * Notifications are personal data, so they come through a function that knows who is asking (D-17), never
 * through the connector. Marking them read, the full list and subscriptions are APP-8.
 */
import type { AppFunctionsSchema } from '@rayfin-app/functions/types';

import { unwrapAct } from '@/lib/act-answer';
import { getRayfinClient } from '@/lib/rayfin-client';

export type NotificationItem = AppFunctionsSchema['getMyNotifications']['output']['items'][number];

export interface Notifications {
  /** Messages not yet marked as read. */
  unreadCount: number;
  /** The newest messages, newest first. */
  items: NotificationItem[];
}

export async function fetchNotifications(limit: number): Promise<Notifications> {
  const answer = unwrapAct(await (await getRayfinClient()).functions.getMyNotifications.invoke({ limit }));
  return { unreadCount: answer.unreadCount, items: answer.items };
}
