import type { ReactNode } from 'react';

import { Approvals } from '@/features/approvals/approvals.component';
import { RequestDetail } from '@/features/approvals/request-detail.component';
import { EquipmentDetail } from '@/features/equipment/equipment-detail.component';
import { EquipmentSearch } from '@/features/equipment/equipment-search.component';
import { Spikes } from '@/features/spikes/spikes.component';

import { NoAccess, NotFound, Placeholder } from './placeholder.component';
import { PREVIEW_MODE } from './preview';
import { isBuilt, type ScreenId } from './routes';
import type { CurrentRoute } from '@/hooks/use-hash-route';

/**
 * Pages a later phase builds, shown on sample data in the demo build only (`npm run dev:mock`,
 * FINAL PLAN/11 APP-D). Each entry is the real screen component; its phase moves it into the switch below
 * when it calls real functions. A page not listed here shows its placeholder, in the demo too.
 */
const PREVIEW_SCREENS: Partial<Record<ScreenId, (params: Record<string, string>) => ReactNode>> = {};

/**
 * Chooses the screen for the current address. Built screens are listed here; every other
 * route in `routes.ts` shows its placeholder until its phase builds it.
 */
export function Screen({
  route,
  canManageAdmin,
  preview = PREVIEW_MODE,
}: {
  route: CurrentRoute;
  canManageAdmin: boolean;
  /** Replaced in tests; true only under `npm run dev:mock`. */
  preview?: boolean;
}) {
  const match = route.match;
  if (!match) return <NotFound path={route.path} />;

  const { route: def, params } = match;
  if (def.needsAdmin && !canManageAdmin) return <NoAccess route={def} />;

  if (preview && !isBuilt(def)) {
    const make = PREVIEW_SCREENS[def.id];
    if (make) return make(params);
  }

  switch (def.id) {
    case 'approvals':
      return <Approvals />;
    case 'request':
      return <RequestDetail key={params['id']} idText={params['id'] ?? ''} />;
    case 'equipment':
      return <EquipmentSearch />;
    case 'equipment-detail':
      return <EquipmentDetail key={params['id']} idText={params['id'] ?? ''} />;
    case 'spikes':
      return <Spikes />;
    default:
      return <Placeholder route={def} />;
  }
}
