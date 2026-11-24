/**
 * Every screen of the app, in one table (FINAL PLAN/03 section 2.1).
 *
 * Screens that are not built yet still have a route, so the menu, the links between
 * screens and the profile-aware gating exist from the start; they show a short
 * "built in APP-n" page (app/placeholder). `builtIn` names the phase that fills them.
 *
 * Addresses use the hash (`#/equipment/12?field=tag`): a static host needs no server
 * fallback for them, and a link can be pasted into a message.
 */

export type ScreenId =
  | 'home'
  | 'approvals'
  | 'request'
  | 'equipment'
  | 'equipment-detail'
  | 'field'
  | 'new-heater'
  | 'new-field'
  | 'rules'
  | 'rule'
  | 'measures'
  | 'export'
  | 'notifications'
  | 'admin'
  | 'spikes';

export interface RouteDef {
  id: ScreenId;
  /** Screen code from the plan (S-1 ... S-13); the spike page has none. */
  screen: string | null;
  title: string;
  /** What the screen is for, in a plain sentence (shown on placeholders). */
  summary: string;
  /** Path pattern; `:name` matches one segment. More specific patterns come first. */
  pattern: string;
  /** Shown in the menu. */
  inMenu: boolean;
  /** Only people with the admin right see it in the menu and may open it. */
  needsAdmin: boolean;
  /** The phase that builds the screen. */
  builtIn: string;
}

/** Phases whose screens exist; every other route shows a placeholder (and a "soon" mark in the menu). */
export const BUILT_PHASES: readonly string[] = ['APP-2', 'APP-4'];

export const isBuilt = (route: RouteDef): boolean => BUILT_PHASES.includes(route.builtIn);

export const ROUTES: readonly RouteDef[] = [
  {
    id: 'home',
    screen: 'S-1',
    title: 'Home',
    summary: 'Requests waiting for you; for approvers and admins, data quality and the request pipeline.',
    pattern: '/',
    inMenu: true,
    needsAdmin: false,
    builtIn: 'APP-8',
  },
  {
    id: 'equipment',
    screen: 'S-4',
    title: 'Equipment',
    summary: 'Find a heater by tag, serial number, equipment number, FLOC, manufacturer, class or profit centre.',
    pattern: '/equipment',
    inMenu: true,
    needsAdmin: false,
    builtIn: 'APP-2',
  },
  {
    id: 'approvals',
    screen: 'S-2',
    title: 'Approvals',
    summary: 'The change requests waiting for you, by stage; approve, reject or return them.',
    pattern: '/approvals',
    inMenu: true,
    needsAdmin: false,
    builtIn: 'APP-4',
  },
  {
    id: 'request',
    screen: 'S-3',
    title: 'Request',
    summary: 'One change request: values, approval checks, evidence, history and routing.',
    pattern: '/requests/:id',
    inMenu: false,
    needsAdmin: false,
    builtIn: 'APP-4',
  },
  {
    id: 'equipment-detail',
    screen: 'S-5',
    title: 'Equipment details',
    summary: 'The golden record, grouped field values, provenance and change requests for one equipment item.',
    pattern: '/equipment/:id',
    inMenu: false,
    needsAdmin: false,
    builtIn: 'APP-2',
  },
  {
    id: 'field',
    screen: 'S-6',
    title: 'Field view',
    summary: 'Find a heater on site, mark each field verified or correct it, add a photo.',
    pattern: '/field',
    inMenu: true,
    needsAdmin: false,
    builtIn: 'APP-7',
  },
  {
    id: 'new-heater',
    screen: 'S-7',
    title: 'New heater',
    summary: 'Ask for a heater that is missing from the master data. Built only if the client confirms it (Q-452).',
    pattern: '/new-heater',
    inMenu: false,
    needsAdmin: false,
    builtIn: 'APP-X',
  },
  // {
  //   id: 'new-field',
  //   screen: 'S-8',
  //   title: 'New field request',
  //   summary: 'Ask for a field (characteristic) that SAP does not have yet.',
  //   pattern: '/new-field',
  //   inMenu: true,
  //   needsAdmin: false,
  //   builtIn: 'APP-9',
  // },
  {
    id: 'rules',
    screen: 'S-9',
    title: 'Rules',
    summary: 'The business rules that check heater data: catalogue, editor, test, preview, publish.',
    pattern: '/rules',
    inMenu: true,
    needsAdmin: false,
    builtIn: 'APP-5',
  },
  {
    id: 'rule',
    screen: 'S-9',
    title: 'Rule',
    summary: 'One business rule: its SQL, tests, preview of the requests it would create, versions and runs.',
    pattern: '/rules/:id',
    inMenu: false,
    needsAdmin: false,
    builtIn: 'APP-5',
  },
  // {
  //   id: 'measures',
  //   screen: 'S-10',
  //   title: 'Verification',
  //   summary: 'How far each heater and business unit is verified, toward the 75% target.',
  //   pattern: '/measures',
  //   inMenu: true,
  //   needsAdmin: false,
  //   builtIn: 'APP-9',
  // },
  {
    id: 'export',
    screen: 'S-11',
    title: 'EVOLVE export',
    summary: 'The files generated for the SAP loader, with every changed row, old value, new value and approver.',
    pattern: '/export',
    inMenu: true,
    needsAdmin: false,
    builtIn: 'APP-9',
  },
  // {
  //   id: 'notifications',
  //   screen: 'S-12',
  //   title: 'Notifications',
  //   summary: 'What happened to your requests, and which topics you follow.',
  //   pattern: '/notifications',
  //   inMenu: true,
  //   needsAdmin: false,
  //   builtIn: 'APP-8',
  // },
  {
    id: 'admin',
    screen: 'S-13',
    title: 'Admin',
    summary: 'People and roles, approval routes, drop-down values, mandatory fields, the route check.',
    pattern: '/admin',
    inMenu: true,
    needsAdmin: true,
    builtIn: 'APP-9',
  },
  {
    id: 'spikes',
    screen: null,
    title: 'Spikes',
    summary: 'Temporary technical checks from the build phase. Removed in APP-10.',
    pattern: '/spikes',
    inMenu: false,
    needsAdmin: false,
    builtIn: 'APP-0 (temporary)',
  },
];

export interface RouteMatch {
  route: RouteDef;
  params: Record<string, string>;
}

const splitPath = (path: string): string[] => path.split('/').filter((s) => s.length > 0);

/** Matches a path such as `/equipment/12` against the table; null when nothing fits. */
export function matchRoute(path: string): RouteMatch | null {
  const segments = splitPath(path);
  for (const route of ROUTES) {
    const pattern = splitPath(route.pattern);
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let fits = true;
    pattern.forEach((part, i) => {
      const actual = segments[i] ?? '';
      if (part.startsWith(':')) {
        try {
          params[part.slice(1)] = decodeURIComponent(actual);
        } catch {
          fits = false;
        }
      } else if (part !== actual) {
        fits = false;
      }
    });
    if (fits) return { route, params };
  }
  return null;
}

/** The menu entries a person may see. */
export function menuRoutes(canManageAdmin: boolean): RouteDef[] {
  return ROUTES.filter((r) => r.inMenu && (!r.needsAdmin || canManageAdmin));
}

export function routeById(id: ScreenId): RouteDef {
  const found = ROUTES.find((r) => r.id === id);
  if (!found) throw new Error(`Unknown route ${id}`);
  return found;
}

/** A page reached from a list belongs under it: the menu highlights the list, the breadcrumb shows it. */
export const PARENT_SCREEN: Partial<Record<ScreenId, ScreenId>> = {
  'equipment-detail': 'equipment',
  request: 'approvals',
  'new-heater': 'equipment',
  rule: 'rules',
};

/** The way to a screen, from Home: Home, its list when it has one, then the screen itself. */
export function breadcrumbOf(id: ScreenId): RouteDef[] {
  const parent = PARENT_SCREEN[id];
  const trail = [parent ? routeById(parent) : null, routeById(id)].filter((r): r is RouteDef => r !== null);
  return id === 'home' ? trail : [routeById('home'), ...trail];
}
