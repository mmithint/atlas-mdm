import {
  Bell,
  BookOpenCheck,
  ClipboardCheck,
  FilePlus2,
  FileSpreadsheet,
  Flame,
  Gauge,
  House,
  Settings,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';

import { hrefFor } from './router';
import { isBuilt, menuRoutes, type ScreenId } from './routes';

const ICONS: Partial<Record<ScreenId, LucideIcon>> = {
  home: House,
  approvals: ClipboardCheck,
  equipment: Flame,
  field: Wrench,
  'new-field': FilePlus2,
  rules: BookOpenCheck,
  measures: Gauge,
  export: FileSpreadsheet,
  notifications: Bell,
  admin: Settings,
};

/** A page reached from a menu entry highlights its parent entry. */
const PARENT: Partial<Record<ScreenId, ScreenId>> = {
  'equipment-detail': 'equipment',
  request: 'approvals',
  'new-heater': 'equipment',
  rule: 'rules',
};

/**
 * The menu. Admin entries appear only for people with the admin right (a convenience:
 * the server checks the right again on every admin action). Screens that a later phase
 * builds are shown dimmed with a note, so nobody wonders why they are empty. In the demo build
 * (`preview`, FINAL PLAN/11) every page opens, so no entry is dimmed; the page header says "Preview".
 */
export function Nav({
  current,
  canManageAdmin,
  onNavigate,
  preview = false,
  collapsed = false,
}: {
  current: ScreenId | null;
  canManageAdmin: boolean;
  onNavigate?: () => void;
  preview?: boolean;
  /** Icons only (the desktop rail is folded); the titles stay for screen readers and show as a tooltip. */
  collapsed?: boolean;
}) {
  const active = current ? (PARENT[current] ?? current) : null;
  return (
    <nav aria-label="Main" className={clsx('flex-1 overflow-y-auto py-300', collapsed ? 'px-200' : 'px-300')}>
      <ul className="space-y-100">
        {menuRoutes(canManageAdmin).map((route) => {
          const Icon = ICONS[route.id];
          const isCurrent = route.id === active;
          const built = preview || isBuilt(route);
          return (
            <li key={route.id}>
              <a
                href={hrefFor(route.pattern)}
                onClick={onNavigate}
                aria-current={isCurrent ? 'page' : undefined}
                title={built ? (collapsed ? route.title : undefined) : collapsed ? `${route.title} · built in ${route.builtIn}` : `Built in ${route.builtIn}`}
                className={clsx(
                  'flex items-center rounded-md text-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-active',
                  collapsed ? 'justify-center px-200 py-200' : 'gap-300 border-l-4 px-300 py-200',
                  isCurrent
                    ? 'border-sidebar-active bg-sidebar-accent font-medium text-sidebar-foreground'
                    : 'border-transparent text-sidebar-foreground hover:bg-sidebar-accent',
                  built ? '' : 'opacity-70'
                )}
              >
                {Icon ? <Icon aria-hidden="true" className="icon-size-300 shrink-0" /> : null}
                <span className={collapsed ? 'sr-only' : 'min-w-0 flex-1 truncate'}>{route.title}</span>
                {built || collapsed ? null : <span className="text-100 uppercase tracking-wide text-sidebar-muted">soon</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
