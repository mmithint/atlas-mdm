import { CircleCheck, CircleDot, CirclePause, CircleSlash, Flame, Snowflake, type LucideIcon } from 'lucide-react';

import { badge, categoryBadge } from '@/components/ui';
import { formatPercent } from '@/lib/format';

/**
 * Badges for the coded columns of the equipment table. Fired / unfired is a kind of heater, so it
 * takes a category colour; the user and FLOC statuses and the verified share are states, so they
 * take the status colours. The code stays the label; the meaning is the tooltip and is read out.
 */

const FIRED: Record<string, { icon: LucideIcon; category: number }> = {
  FIRED: { icon: Flame, category: 3 },
  UNFIRED: { icon: Snowflake, category: 1 },
};

/** A heater's fuel type: fired or unfired. Any other value is shown as it is. */
export function FiredBadge({ value }: { value: string }) {
  const known = FIRED[value.toUpperCase()];
  if (!known) return <span className={categoryBadge[7]}>{value}</span>;
  const Icon = known.icon;
  return (
    <span className={categoryBadge[known.category - 1]}>
      <Icon aria-hidden="true" className="icon-size-100 shrink-0" />
      {value}
    </span>
  );
}

type Tone = keyof typeof badge;

/** SAP user statuses of an equipment and of a FLOC. Codes not listed here show as neutral, with no meaning guessed. */
const STATUS: Record<string, { meaning: string; tone: Tone; icon: LucideIcon }> = {
  OPER: { meaning: 'Operating', tone: 'success', icon: CircleCheck },
  ACTV: { meaning: 'Active', tone: 'success', icon: CircleCheck },
  AVFS: { meaning: 'Available for service', tone: 'info', icon: CircleDot },
  NOPE: { meaning: 'Not operating', tone: 'warning', icon: CirclePause },
  DECM: { meaning: 'Decommissioned', tone: 'neutral', icon: CircleSlash },
};

export function StatusBadge({ value }: { value: string }) {
  const known = STATUS[value.toUpperCase()];
  if (!known) return <span className={badge.neutral}>{value}</span>;
  const Icon = known.icon;
  return (
    <span className={badge[known.tone]} title={known.meaning}>
      <Icon aria-hidden="true" className="icon-size-100 shrink-0" />
      {value}
      <span className="sr-only"> ({known.meaning})</span>
    </span>
  );
}

/** How much of a heater has been verified: all of it is done, under half needs a person. */
export function VerifiedBadge({ pct }: { pct: number }) {
  const tone: Tone = pct >= 100 ? 'success' : pct < 50 ? 'warning' : 'neutral';
  return (
    <span className={`${badge[tone]} tabular-nums`}>
      {pct >= 100 ? <CircleCheck aria-hidden="true" className="icon-size-100 shrink-0" /> : null}
      {formatPercent(pct)}
    </span>
  );
}
