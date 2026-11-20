import { Menu, Moon, Sun, X } from 'lucide-react';
import clsx from 'clsx';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';

import oxyLogo from '@/assets/oxy-logo.png';
import { badge } from '@/components/ui';
import { NotificationBell } from '@/features/notifications/notification-bell.component';
import { useAuth } from '@/hooks/auth.context';
import { useHashRoute } from '@/hooks/use-hash-route';
import { useTheme } from '@/hooks/theme.context';

import { Nav } from './nav.component';
import { PREVIEW_MODE } from './preview';
import { ProfileNotice } from './profile-notice.component';
import { useProfile } from './profile.context';
import { isBuilt } from './routes';
import { Screen } from './screens';

const MAX_ROLES_SHOWN = 3;

/**
 * The presenter's persona switch and Reset demo (FINAL PLAN/11 §3), `npm run dev:mock` only. The condition is
 * written out so the production build drops the import and the whole dev-mock folder with it.
 */
const DemoControls =
  import.meta.env.DEV && import.meta.env.MODE === 'mock' ? lazy(() => import('@/dev-mock/demo-controls.component')) : null;

/**
 * The frame around every screen: the navigation rail (dark, like an instrument panel),
 * a header with the signed-in person and their roles, a notice when the profile needs
 * attention, and the current screen. On a phone the rail slides in from the left.
 */
export function AppShell() {
  const route = useHashRoute();
  const { state, reload } = useProfile();
  const { session } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  // Demo build only: a persona switch or Reset demo bumps this, so the profile, the page and the bell reload.
  const [demoEpoch, setDemoEpoch] = useState(0);
  const onDemoChange = useCallback(() => {
    reload();
    setDemoEpoch((n) => n + 1);
  }, [reload]);

  const profile = state.status === 'ready' && state.profile.status === 'OK' ? state.profile : null;
  const canManageAdmin = profile?.canManageAdmin === true;
  const current = route.match?.route ?? null;
  const title = current?.title ?? 'Page not found';

  useEffect(() => {
    document.title = `${title} · ATLAS`;
  }, [title]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const name = profile?.displayName || profile?.email || session?.user?.email || 'Signed in';
  const roles = profile?.roles ?? [];
  const shownRoles = roles.slice(0, MAX_ROLES_SHOWN).join(', ');
  const moreRoles = roles.length > MAX_ROLES_SHOWN ? ` +${roles.length - MAX_ROLES_SHOWN}` : '';

  let roleLine: string;
  if (state.status === 'loading') roleLine = 'Loading roles…';
  else if (state.status === 'error') roleLine = 'Roles unavailable';
  else if (state.profile.status === 'NOT_REGISTERED') roleLine = 'Not registered yet';
  else if (roles.length === 0) roleLine = 'No roles';
  else roleLine = `${shownRoles}${moreRoles}`;

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {menuOpen ? (
        <button
          type="button"
          aria-label="Close the menu"
          className="fixed inset-0 z-20 bg-foreground/40 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-30 flex w-sidebar flex-col bg-sidebar text-sidebar-foreground transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0',
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center gap-300 border-b border-sidebar-border px-400 py-400">
          <img src={oxyLogo} alt="Oxy" className="icon-size-700 shrink-0 object-contain" />
          <div className="min-w-0 flex-1">
            <p className="text-500 font-bold leading-none tracking-wide">ATLAS</p>
            <p className="mt-200 text-200 text-sidebar-muted">Heater master data</p>
          </div>
          <button
            type="button"
            aria-label="Close the menu"
            className="rounded-md p-100 text-sidebar-muted hover:bg-sidebar-accent md:hidden"
            onClick={() => setMenuOpen(false)}
          >
            <X aria-hidden="true" className="icon-size-300" />
          </button>
        </div>
        <Nav current={current?.id ?? null} canManageAdmin={canManageAdmin} onNavigate={() => setMenuOpen(false)} preview={PREVIEW_MODE} />
        <p className="border-t border-sidebar-border px-400 py-300 text-100 text-sidebar-muted">Proof of value build</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-300 border-b border-border bg-card px-400 py-200">
          <button
            type="button"
            aria-label="Open the menu"
            aria-expanded={menuOpen}
            className="rounded-md p-200 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
            onClick={() => setMenuOpen(true)}
          >
            <Menu aria-hidden="true" className="icon-size-300" />
          </button>
          <p className="min-w-0 flex-1 truncate text-300 text-muted-foreground">
            {current?.screen ? <span className="id-plate mr-200">{current.screen}</span> : null}
            {title}
            {PREVIEW_MODE && current && !isBuilt(current) ? (
              <span className={`${badge.info} ml-200`} title={`Shown on sample data. Built for real in ${current.builtIn}.`}>
                Preview · {current.builtIn} · sample data
              </span>
            ) : null}
          </p>
          {DemoControls ? (
            <Suspense fallback={null}>
              <DemoControls onChange={onDemoChange} />
            </Suspense>
          ) : null}
          <div className="min-w-0 text-right">
            <p className="truncate text-300 font-medium" aria-label="Signed in as">
              {name}
            </p>
            <p className="truncate text-200 text-muted-foreground" aria-label="Your roles">
              {roleLine}
            </p>
          </div>
          {profile ? <NotificationBell refreshKey={`${route.path}#${demoEpoch}`} /> : null}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to the light theme' : 'Switch to the dark theme'}
            className="rounded-md p-200 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {isDark ? <Sun aria-hidden="true" className="icon-size-300" /> : <Moon aria-hidden="true" className="icon-size-300" />}
          </button>
        </header>

        <ProfileNotice />

        <main className="mx-auto w-full max-w-7xl flex-1 p-400 md:p-600">
          <Screen key={demoEpoch} route={route} canManageAdmin={canManageAdmin} />
        </main>
      </div>
    </div>
  );
}
