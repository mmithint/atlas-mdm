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
};

/**
 * The menu. Admin entries appear only for people with the admin right (a convenience:
 * the server checks the right again on every admin action). Screens that a later phase
 * builds are shown dimmed with a note, so nobody wonders why they are empty.
 */
export function Nav({
  current,
  canManageAdmin,
  onNavigate,
}: {
  current: ScreenId | null;
  canManageAdmin: boolean;
  onNavigate?: () => void;
}) {
  const active = current ? (PARENT[current] ?? current) : null;
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-300 py-300">
      <ul className="space-y-100">
        {menuRoutes(canManageAdmin).map((route) => {
          const Icon = ICONS[route.id];
          const isCurrent = route.id === active;
          const built = isBuilt(route);
          return (
            <li key={route.id}>
              <a
                href={hrefFor(route.pattern)}
                onClick={onNavigate}
                aria-current={isCurrent ? 'page' : undefined}
                title={built ? undefined : `Built in ${route.builtIn}`}
                className={[
                  'flex items-center gap-300 rounded-md border-l-4 px-300 py-200 text-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-active',
                  isCurrent
                    ? 'border-sidebar-active bg-sidebar-accent font-medium text-sidebar-foreground'
                    : 'border-transparent text-sidebar-foreground hover:bg-sidebar-accent',
                  built ? '' : 'opacity-70',
                ].join(' ')}
              >
                {Icon ? <Icon aria-hidden="true" className="icon-size-300 shrink-0" /> : null}
                <span className="min-w-0 flex-1 truncate">{route.title}</span>
                {built ? null : <span className="text-100 uppercase tracking-wide text-sidebar-muted">soon</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
