import { Check, Clock, Minus, Undo2, X, type LucideIcon } from 'lucide-react';

import { Pill } from '@/components/layout';

import { statusDisplay } from './request-model';

const ICON: Readonly<Record<string, LucideIcon>> = {
  PENDING_RESPONSIBLE: Clock,
  PENDING_ACCOUNTABLE: Clock,
  RETURNED: Undo2,
  APPROVED: Check,
  REJECTED: X,
};

/** A request status as the design system's Pill with an icon and its words (never colour alone). Words and tone come from the data. */
/** `quiet`: grey whatever the status (a list of many statuses, where colour would only add noise); the icon and words still say it. */
export function StatusPill({ status, quiet = false }: { status: string; quiet?: boolean }) {
  const display = statusDisplay(status);
  const Icon = ICON[status] ?? Minus;
  return (
    <Pill tone={quiet ? 'neutral' : display.kind}>
      <Icon aria-hidden="true" className="mr-100 icon-size-100" />
      {display.text}
    </Pill>
  );
}
