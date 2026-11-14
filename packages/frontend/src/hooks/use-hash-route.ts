import { useSyncExternalStore } from 'react';

/**
 * Minimal address-bar routing for APP-0: `#/spikes` shows the temporary spike
 * page, anything else shows the Notes page. APP-2 replaces this with the real
 * app shell and router. A hash needs no server-side fallback on static hosting.
 */
export type AppRoute = 'notes' | 'spikes';

export function parseRoute(hash: string): AppRoute {
  const first = hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return first === 'spikes' ? 'spikes' : 'notes';
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

const getHash = (): string => window.location.hash;
const getServerHash = (): string => '';

export function useHashRoute(): AppRoute {
  return parseRoute(useSyncExternalStore(subscribe, getHash, getServerHash));
}
