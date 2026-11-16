import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { getRayfinClient } from '@/lib/rayfin-client';

import { ProfileContext, type MyProfile, type ProfileContextValue, type ProfileState } from './profile.context';

const loadFromServer = async (): Promise<MyProfile> =>
  (await getRayfinClient()).functions.getMyProfile.invoke();

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

type Settled =
  | { attempt: number; ok: true; profile: MyProfile }
  | { attempt: number; ok: false; message: string };

/**
 * Loads the profile once when the app opens. No automatic retry: a failure shows an
 * actionable message and the person (or the header's "Try again") asks again.
 */
export function ProfileProvider({
  children,
  load = loadFromServer,
}: {
  children: ReactNode;
  /** Replaced in tests. */
  load?: () => Promise<MyProfile>;
}) {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (profile) => {
        if (!cancelled) setSettled({ attempt, ok: true, profile });
      },
      (error: unknown) => {
        if (!cancelled) setSettled({ attempt, ok: false, message: describe(error) });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [load, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const value = useMemo<ProfileContextValue>(() => {
    // An answer from an earlier attempt means we are loading again.
    const state: ProfileState =
      settled === null || settled.attempt !== attempt
        ? { status: 'loading' }
        : settled.ok
          ? { status: 'ready', profile: settled.profile }
          : { status: 'error', message: settled.message };
    return { state, reload };
  }, [settled, attempt, reload]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}
