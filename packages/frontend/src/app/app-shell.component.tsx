import { Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import clsx from 'clsx';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';

import oxyLogo from '@/assets/oxy-logo.png';
import { badge } from '@/components/ui';
import { NotificationBell } from '@/features/notifications/notification-bell.component';
import { useAuth } from '@/hooks/auth.context';
import { useHashRoute } from '@/hooks/use-hash-route';

import { AccountMenu } from './account-menu.component';
import { Breadcrumb } from './breadcrumb.component';
import { Nav } from './nav.component';
import { PREVIEW_MODE } from './preview';
import { ProfileNotice } from './profile-notice.component';
import { useProfile } from './profile.context';
import { isBuilt, type ScreenId } from './routes';
import { Screen } from './screens';

const MAX_ROLES_SHOWN = 3;

/** Up to two letters for the avatar: first and last word of the name ("(sample)" and the like are skipped), or null for an e-mail. */
const initialsOf = (name: string): string | null => {
  if (name.includes('@')) return null;
  const words = name.split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  if (words.length === 0) return null;
  const first = words[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1] ?? '') : '';
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
};

/** List screens whose table scrolls inside the page on a wide screen, so the toolbar and pager stay in view. */
const FILL_SCREENS: ReadonlySet<ScreenId> = new Set<ScreenId>(['equipment', 'approvals']);

/** The folded rail is a per-browser convenience; storage can be blocked, so a failure just means "expanded". */
const RAIL_KEY = 'atlas.nav-collapsed';
const readRailCollapsed = (): boolean => {
  try {
    return window.localStorage.getItem(RAIL_KEY) === '1';
  } catch {
    return false;
  }
};
const writeRailCollapsed = (collapsed: boolean) => {
  try {
    window.localStorage.setItem(RAIL_KEY, collapsed ? '1' : '0');
  } catch {
    // Not remembered; the rail still folds for this visit.
  }
};

/**
 * The presenter's persona switch and Reset demo (FINAL PLAN/11 §3), `npm run dev:mock` only. The condition is
 * written out so the production build drops the import and the whole dev-mock folder with it.
 */
const DemoControls =
  import.meta.env.DEV && import.meta.env.MODE === 'mock' ? lazy(() => import('@/dev-mock/demo-controls.component')) : null;

/**
 * The frame around every screen: one navigation rail containing global controls and account
 * context, plus the current screen. On a phone the rail slides in from the left; on a wide
 * screen it folds to icons only. The window itself never scrolls; the page area does.
 */
export function AppShell() {
  const route = useHashRoute();
  const { state, reload } = useProfile();
  const { session } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(readRailCollapsed);
  const toggleRail = () =>
    setRailCollapsed((was) => {
      writeRailCollapsed(!was);
      return !was;
    });
  // The phone drawer always shows the labels.
  const collapsed = railCollapsed && !menuOpen;
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
  const fills = current !== null && FILL_SCREENS.has(current.id);
  const fullWidth = fills || current?.id === 'equipment-detail' || current?.id === 'home' || current?.id === 'field';

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
  const initials = profile?.displayName ? initialsOf(profile.displayName) : null;
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
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      {menuOpen ? (
        <button
          type="button"
          aria-label="Close the menu"
          className="fixed inset-0 z-20 bg-mask md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-30 flex w-sidebar flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[transform,width] duration-200 motion-reduce:transition-none md:relative md:h-full md:shrink-0 md:translate-x-0',
          menuOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed ? 'md:w-sidebar-rail' : 'md:w-sidebar'
        )}
      >
        <div className={clsx('flex h-header shrink-0 items-center gap-300 border-b border-sidebar-border', collapsed ? 'justify-center px-200' : 'px-400')}>
          {/* The mark is drawn for a white ground, so it sits on a white disc; on the dark menu that keeps its colours. */}
          <img src={oxyLogo} alt="Oxy" className="icon-size-600 shrink-0 rounded-full bg-sidebar-logo object-contain" />
          {collapsed ? null : (
            <div className="min-w-0 flex-1">
              <p className="text-400 font-bold leading-400 tracking-wide">ATLAS</p>
              <p className="text-200 leading-200 text-sidebar-muted">Heater master data</p>
            </div>
          )}
          <button
            type="button"
            aria-label="Close the menu"
            className="rounded-md p-100 text-sidebar-muted hover:bg-sidebar-accent md:hidden"
            onClick={() => setMenuOpen(false)}
          >
            <X aria-hidden="true" className="icon-size-300" />
          </button>
        </div>
        <button
          type="button"
          onClick={toggleRail}
          aria-label={railCollapsed ? 'Expand the menu' : 'Collapse the menu'}
          aria-expanded={!railCollapsed}
          title={railCollapsed ? 'Expand the menu' : 'Collapse the menu'}
          className="absolute -right-300 top-[43px] z-10 hidden cursor-pointer rounded-md border border-border bg-card p-100 text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex"
        >
          {railCollapsed ? <PanelLeftOpen aria-hidden="true" className="icon-size-200" /> : <PanelLeftClose aria-hidden="true" className="icon-size-200" />}
        </button>
        <Nav current={current?.id ?? null} canManageAdmin={canManageAdmin} onNavigate={() => setMenuOpen(false)} preview={PREVIEW_MODE} collapsed={collapsed} />
        <div
          className={clsx(
            'shrink-0 border-t border-sidebar-border',
            collapsed ? 'flex flex-col items-center gap-200 p-200' : 'space-y-300 p-300'
          )}
        >
          {!collapsed && DemoControls ? (
            <Suspense fallback={null}>
              <DemoControls onChange={onDemoChange} />
            </Suspense>
          ) : null}
          {/* Notifications, then the person: their avatar opens a menu with the light or dark theme. */}
          {profile ? <NotificationBell refreshKey={`${route.path}#${demoEpoch}`} placement="sidebar" showLabel={!collapsed} /> : null}
          <AccountMenu name={name} roleLine={roleLine} initials={initials} collapsed={collapsed} />
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ProfileNotice />

        {/* The page area scrolls, not the window. A list screen fills it instead, so only its table scrolls. */}
        <main className="min-h-0 flex-1 overflow-y-auto">
          {/* List screens use the full width for their wide tables; other pages keep a readable maximum width. */}
          <div
            className={clsx(
              'mx-auto w-full p-400 md:p-600',
              fills && 'md:flex md:h-full md:flex-col',
              !fullWidth && 'max-w-7xl'
            )}
          >
            <div className="mb-400 flex min-w-0 items-center gap-200">
              <button
                type="button"
                aria-label="Open the menu"
                aria-expanded={menuOpen}
                className="shrink-0 rounded-md p-200 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
                onClick={() => setMenuOpen(true)}
              >
                <Menu aria-hidden="true" className="icon-size-300" />
              </button>
              <div className="min-w-0 flex-1">{current ? <Breadcrumb current={current.id} /> : null}</div>
              {PREVIEW_MODE && current && !isBuilt(current) ? (
                <span className={badge.info} title={`Shown on sample data. Built for real in ${current.builtIn}.`}>
                  Preview · {current.builtIn} · sample data
                </span>
              ) : null}
            </div>
            <Screen key={demoEpoch} route={route} canManageAdmin={canManageAdmin} />
          </div>
        </main>
      </div>
    </div>
  );
}
