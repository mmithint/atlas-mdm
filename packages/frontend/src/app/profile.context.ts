import type { AppFunctionsSchema } from '@rayfin-app/functions/types';
import { createContext, useContext } from 'react';

/**
 * Who is signed in and what may they do: the answer of the `getMyProfile` function,
 * loaded once when the app opens (`profile.provider.tsx`) and kept for the session.
 *
 * The profile only shapes the screen (the menu, the name in the header, a notice for a
 * person who is not registered yet). It never grants anything: every action is checked
 * again on the server by the procedure that does it (decision D-03).
 */
export type MyProfile = AppFunctionsSchema['getMyProfile']['output'];

export type ProfileState =
  | { status: 'loading' }
  | { status: 'ready'; profile: MyProfile }
  | { status: 'error'; message: string };

export interface ProfileContextValue {
  state: ProfileState;
  /** Asks the server again (after an error, or after an admin changed the person's roles). */
  reload: () => void;
}

export const ProfileContext = createContext<ProfileContextValue | undefined>(undefined);

export function useProfile(): ProfileContextValue {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }
  return context;
}

/** The profile when it is ready and the person is registered; otherwise null. */
export function useRegisteredProfile(): MyProfile | null {
  const { state } = useProfile();
  return state.status === 'ready' && state.profile.status === 'OK' ? state.profile : null;
}
