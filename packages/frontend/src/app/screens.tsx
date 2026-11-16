import { EquipmentDetail } from '@/features/equipment/equipment-detail.component';
import { EquipmentSearch } from '@/features/equipment/equipment-search.component';
import { Spikes } from '@/features/spikes/spikes.component';

import { NoAccess, NotFound, Placeholder } from './placeholder.component';
import type { CurrentRoute } from '@/hooks/use-hash-route';

/**
 * Chooses the screen for the current address. Built screens are listed here; every other
 * route in `routes.ts` shows its placeholder until its phase builds it.
 */
export function Screen({ route, canManageAdmin }: { route: CurrentRoute; canManageAdmin: boolean }) {
  const match = route.match;
  if (!match) return <NotFound path={route.path} />;

  const { route: def, params } = match;
  if (def.needsAdmin && !canManageAdmin) return <NoAccess route={def} />;

  switch (def.id) {
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
