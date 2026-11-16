import { useMemo, useSyncExternalStore } from 'react';

import { parseHash, type HashLocation } from '@/app/router';
import { matchRoute, type RouteMatch } from '@/app/routes';

/**
 * The current page, read from the address bar hash. A static host needs no server-side
 * fallback for a hash. The route table is in `app/routes.ts`; `app/router.ts` builds
 * links and moves between pages.
 */
export interface CurrentRoute extends HashLocation {
  /** The matching screen and its path parameters, or null for an unknown address. */
  match: RouteMatch | null;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

const getHash = (): string => window.location.hash;
const getServerHash = (): string => '';

export function useHashRoute(): CurrentRoute {
  const hash = useSyncExternalStore(subscribe, getHash, getServerHash);
  return useMemo(() => {
    const location = parseHash(hash);
    return { ...location, match: matchRoute(location.path) };
  }, [hash]);
}
