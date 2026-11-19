/**
 * The mock Rayfin client and sign-in for `npm run dev:mock` (Vite mode `mock`).
 *
 * Only reachable through dynamic imports guarded by `import.meta.env.DEV && import.meta.env.MODE === 'mock'` in
 * `lib/rayfin-client.ts` and `main.tsx`, so a production build never contains it. The screens are unchanged: they
 * call `client.functions.<name>.invoke(...)` and `client.connectors.atlas_sql_db.FieldCatalog.select(...)` exactly as
 * in the real app; the answers come from `mock-functions.ts`.
 *
 * AGENTS.md: sample data is allowed here because the developer asked for it, and it is labelled on screen (banner).
 */
import type { OpaqueSession } from '@microsoft/rayfin-auth';

import type { AppClient } from '@/lib/rayfin-client';
import type { IAuthService } from '@/services/rayfin-auth.service';

import { catalogRows, MOCK_USER, MOCK_USER_NAME, mockHandlers } from './mock-functions';

/** A short pause so loading states are visible, like a real call. */
const LATENCY_MS = 150;

type Invoke = (input?: Record<string, unknown>) => Promise<unknown>;

export function createMockClient(): AppClient {
  const functions = new Proxy(
    {},
    {
      get(_target, name): { invoke: Invoke } | undefined {
        if (typeof name !== 'string') return undefined;
        return {
          invoke: async (input = {}) => {
            await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
            const handler = mockHandlers[name as keyof typeof mockHandlers] as ((i: unknown) => unknown) | undefined;
            if (!handler) {
              throw new Error(`The function "${name}" is not mocked. Add it to dev-mock/mock-functions.ts, or run the real app.`);
            }
            // A copy, so a screen can never change the mock's own rows by accident.
            return structuredClone(handler(input));
          },
        };
      },
    }
  );

  // The one connector read (the field catalogue): select(...).where(...).orderBy(...).execute().
  // The filters the screens use (active rows, display order) are already how the rows come.
  const query = {
    where: () => query,
    orderBy: () => query,
    execute: async () => {
      await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
      return catalogRows();
    },
  };
  const connectors = { atlas_sql_db: { FieldCatalog: { select: () => query } } };

  return { functions, connectors, runtimeConfig: {} } as unknown as AppClient;
}

const MOCK_SESSION = {
  isAuthenticated: true,
  isAnonymous: false,
  user: { id: 'mock-user', email: MOCK_USER, name: MOCK_USER_NAME },
} as unknown as OpaqueSession;

/** Signs in as the mock user, with no network. */
export function createMockAuthService(): IAuthService {
  installBanner();
  return {
    config: { kind: 'ready' },
    canSignIn: false,
    resolveSession: async () => MOCK_SESSION,
    signIn: async () => MOCK_SESSION,
  };
}

/** A fixed label on every screen: nobody should mistake this for the real app. */
function installBanner(): void {
  const banner = document.createElement('div');
  banner.textContent = 'MOCK DATA: invented rows, no server (npm run dev:mock)';
  banner.setAttribute('role', 'status');
  banner.style.cssText =
    'position:fixed;left:8px;bottom:8px;z-index:2147483647;padding:4px 10px;border-radius:6px;' +
    'background:#b45309;color:#fff;font:600 12px system-ui,sans-serif;pointer-events:none;opacity:.92';
  document.body.appendChild(banner);
}
