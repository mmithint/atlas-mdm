import { Droplets, Flame, Tag, Waypoints, type LucideIcon } from 'lucide-react';

import { categoryBadge } from '@/components/ui';

/**
 * The equipment classes the field form offers (demo-field-form CLASSES), each with its own icon and
 * Oxy category colour, so the Class column can be scanned at a glance.
 */
const KNOWN: Record<string, { icon: LucideIcon; category: number }> = {
  HEATER: { icon: Flame, category: 7 },
  HEATER_TREATER: { icon: Droplets, category: 6 },
  LINE_HEATER: { icon: Waypoints, category: 2 },
};

/** Categories left for other classes; a class always lands on the same one. */
const SPARE = [1, 3, 4, 5, 8];

function spareCategory(value: string): number {
  let hash = 0;
  for (const ch of value) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return SPARE[hash % SPARE.length] ?? 8;
}

/** An equipment or FLOC class as a coloured badge with an icon; the code itself stays the label. */
export function ClassBadge({ value }: { value: string }) {
  const known = KNOWN[value.toUpperCase()];
  const Icon = known?.icon ?? Tag;
  const category = known?.category ?? spareCategory(value.toUpperCase());
  return (
    <span className={categoryBadge[category - 1]}>
      <Icon aria-hidden="true" className="icon-size-100 shrink-0" />
      {value}
    </span>
  );
}
