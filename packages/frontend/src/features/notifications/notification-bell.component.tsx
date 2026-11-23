import clsx from 'clsx';
import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { hrefFor } from '@/app/router';
import { errorText } from '@/lib/act-answer';
import { formatUtc } from '@/lib/format';

import { fetchNotifications, type Notifications } from './notifications-api';

/** How many messages the popover lists; the full list is the notifications page (APP-8). */
const LIST_LIMIT = 10;

type Settled =
  | { request: string; ok: true; data: Notifications }
  | { request: string; ok: false; message: string };

/**
 * The bell in the app header (APP-4 step 4): how many in-app notifications are waiting, and the newest few.
 *
 * It loads when the app opens, every time the popover opens, and whenever `refreshKey` changes (the shell passes
 * the current page, so the count follows a decision made on another page). Older data stays on screen while a
 * reload runs, and a failed load is a quiet line inside the popover: the bell never blocks the header.
 *
 * There is NO "mark as read" yet (it comes with the notifications page, APP-8). So the number means "not yet
 * marked as read", it does not go down by itself, and the popover says so instead of pretending it can be cleared.
 */
export function NotificationBell({ refreshKey }: { refreshKey: string }) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const request = `${refreshKey}|${opened}`;

  useEffect(() => {
    let cancelled = false;
    fetchNotifications(LIST_LIMIT).then(
      (data) => {
        if (!cancelled) setSettled({ request, ok: true, data });
      },
      (error: unknown) => {
        if (!cancelled) setSettled({ request, ok: false, message: errorText(error) });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [request]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointer = (event: MouseEvent) => {
      if (root.current !== null && event.target instanceof Node && !root.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const data = settled?.ok ? settled.data : null;
  const refreshing = settled === null || settled.request !== request;
  const unread = data?.unreadCount ?? 0;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => {
          if (!open) setOpened((n) => n + 1);
          setOpen(!open);
        }}
        className="relative rounded-md p-200 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell aria-hidden="true" className="icon-size-300" />
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-100 -top-100 min-w-500 rounded-full bg-warning-solid px-100 text-center text-200 font-semibold leading-none text-on-warning"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="region"
          aria-label="Your notifications"
          className="absolute right-0 top-full z-40 mt-100 w-screen max-w-sm rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="border-b border-border px-300 py-200">
            <p className="text-300 font-semibold">Notifications</p>
            <p className="text-200 text-muted-foreground">
              {data === null ? 'Loading…' : `${unread} not yet marked as read`}
              {refreshing && data !== null ? ' · refreshing…' : ''}
            </p>
          </div>

          {settled !== null && !settled.ok ? (
            <p role="alert" className="border-b border-border px-300 py-200 text-200 text-destructive">
              The notifications could not be loaded: {settled.message}
            </p>
          ) : null}

          {data !== null && data.items.length === 0 ? (
            <p className="px-300 py-400 text-center text-300 text-muted-foreground">No notifications yet.</p>
          ) : null}

          {data !== null && data.items.length > 0 ? (
            <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
              {data.items.map((n) => {
                const body = (
                  <>
                    <span className="flex items-start gap-200">
                      {!n.isRead ? (
                        <span aria-hidden="true" className="mt-100 inline-block size-200 shrink-0 rounded-full bg-warning-solid" />
                      ) : null}
                      <span className={clsx('min-w-0 break-words text-300', !n.isRead && 'font-semibold')}>
                        {!n.isRead ? <span className="sr-only">Unread: </span> : null}
                        {n.title}
                      </span>
                    </span>
                    <span className="mt-100 line-clamp-2 block text-200 text-muted-foreground">{n.body}</span>
                    <span className="mt-100 block text-200 text-muted-foreground">{formatUtc(n.createdAtUtc)}</span>
                  </>
                );
                return (
                  <li key={n.notificationId}>
                    {n.requestId !== null ? (
                      <a
                        className="block px-300 py-200 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        href={hrefFor(`/requests/${n.requestId}`)}
                        onClick={() => setOpen(false)}
                      >
                        {body}
                      </a>
                    ) : (
                      <div className="px-300 py-200">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}

          <p className="border-t border-border px-300 py-200 text-200 text-muted-foreground">
            Marking messages as read comes with the notifications page, so this number does not go down yet.
          </p>
        </div>
      ) : null}
    </div>
  );
}
