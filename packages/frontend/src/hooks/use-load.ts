import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads something once per `key` and says whether it is loading, failed or ready.
 *
 * The state is derived: an answer counts only if it belongs to the request now on screen
 * (the key plus the number of retries), so a slow old answer never replaces a newer one,
 * and nothing is set while an effect starts. No automatic retry: a failure is shown and
 * the person asks again (`retry`).
 */
export type Load<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string; retry: () => void }
  | { status: 'ready'; data: T };

type Settled<T> =
  | { request: string; ok: true; data: T }
  | { request: string; ok: false; message: string };

const describe = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
};

export function useLoad<T>(key: string, load: () => Promise<T>): Load<T> {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const request = `${key}|${attempt}`;

  // The effect reads the newest `load` without making it a dependency.
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });

  useEffect(() => {
    let cancelled = false;
    latest.current().then(
      (data) => {
        if (!cancelled) setSettled({ request, ok: true, data });
      },
      (error: unknown) => {
        if (!cancelled) setSettled({ request, ok: false, message: describe(error) });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [request]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (settled === null || settled.request !== request) return { status: 'loading' };
  return settled.ok ? { status: 'ready', data: settled.data } : { status: 'error', message: settled.message, retry };
}
