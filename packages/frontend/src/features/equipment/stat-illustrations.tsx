/**
 * Line illustrations for the metric cards: two-tone, the outline in the text colour and one accent in the
 * card's status colour (both theme tokens, so they follow light and dark). Drawn on a 48 grid with 1.5px
 * strokes, like the icon set. Decorative only: every card says the same thing in words.
 */
import type { ReactNode } from 'react';

import type { StatTone } from './stats';

/**
 * The accent of each tone: the status text colours, which keep contrast on a card in both themes (the solid
 * status fills are too dark on a dark card). All of them are used by classes, so Tailwind always emits them.
 */
const ACCENT: Record<StatTone, string> = {
  neutral: 'var(--color-ring)',
  success: 'var(--color-success-foreground)',
  warning: 'var(--color-warning-foreground)',
  info: 'var(--color-info-foreground)',
  danger: 'var(--color-destructive)',
};

type Drawing = (accent: string) => ReactNode;

const line = { fill: 'none', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** A fired heater: the firebox with its flame, the stack, and a wisp of heat. */
const heater: Drawing = (a) => (
  <>
    <rect x="7" y="19" width="28" height="22" rx="2" stroke="currentColor" {...line} />
    <path d="M28 19V7h5v12" stroke="currentColor" {...line} />
    <path d="M4 41h40" stroke="currentColor" {...line} />
    <path d="M12 27h4M12 31h4" stroke="currentColor" {...line} />
    <path d="M24 36c-3 0-5-2-5-4.5 0-3 3-4.5 2.5-8 2.5 1.5 3.5 3 3.5 4.5 1-1 1.5-2 1.5-3 1.5 1.5 2.5 3.5 2.5 6.5 0 2.5-2 4.5-5 4.5z" stroke={a} {...line} />
    <path d="M30.5 4c-1.5 1 1.5 2-0 3" stroke={a} {...line} />
  </>
);

/** Fully verified: a clipboard with a check. */
const verified: Drawing = (a) => (
  <>
    <rect x="10" y="8" width="26" height="34" rx="3" stroke="currentColor" {...line} />
    <rect x="17" y="5" width="12" height="6" rx="2" stroke="currentColor" {...line} />
    <path d="M15 18h16M15 23h10" stroke="currentColor" {...line} />
    <path d="M16 32l4.5 4.5L31 26" stroke={a} {...line} strokeWidth={2} />
  </>
);

/** Under half verified: a gauge with its needle low (a wide dial, so it fills the grid like the others). */
const gauge: Drawing = (a) => (
  // Raised 6 so the dial sits in the middle of the grid like the other drawings (it spans 11 to 39), and the
  // corner watermark keeps as much of it as of the others.
  <g transform="translate(0 -6)">
    <path d="M3 38a21 21 0 0 1 42 0" stroke="currentColor" {...line} />
    <path d="M9.15 23.15l3.2 3.2M24 17v4.5M38.85 23.15l-3.2 3.2" stroke="currentColor" {...line} />
    <path d="M3 38a21 21 0 0 1 6.15-14.85" stroke={a} {...line} strokeWidth={3} />
    <path d="M24 38l-10.5-8" stroke={a} {...line} strokeWidth={2} />
    <circle cx="24" cy="38" r="2.5" stroke="currentColor" {...line} />
    <path d="M2 45h44" stroke="currentColor" {...line} />
  </g>
);

/** With open requests: a change request waiting, with a clock. */
const request: Drawing = (a) => (
  <>
    <path d="M12 6h15l8 8v26a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" stroke="currentColor" {...line} />
    <path d="M27 6v8h8" stroke="currentColor" {...line} />
    <path d="M15 20h12M15 25h8" stroke="currentColor" {...line} />
    <circle cx="33" cy="35" r="8" stroke={a} {...line} fill="var(--color-card)" />
    <path d="M33 31v4l2.5 2" stroke={a} {...line} />
  </>
);

/** Missing heat duty: a thermometer with no reading, and a question. */
const thermometer: Drawing = (a) => (
  <>
    <path d="M17 29V9a4 4 0 0 1 8 0v20a7 7 0 1 1-8 0z" stroke="currentColor" {...line} />
    <path d="M21 13v4M21 21v4" stroke="currentColor" {...line} strokeDasharray="1 3" />
    <circle cx="21" cy="35" r="3" stroke="currentColor" {...line} />
    <path d="M32 12a4 4 0 1 1 5.5 3.7c-1 .4-1.5 1.2-1.5 2.3v1" stroke={a} {...line} strokeWidth={2} />
    <path d="M36 24h.01" stroke={a} {...line} strokeWidth={2.5} />
  </>
);

/** Returned to me: a document with a return arrow. */
const returned: Drawing = (a) => (
  <>
    <path d="M8 10a2 2 0 0 1 2-2h12l8 8v22a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z" stroke="currentColor" {...line} />
    <path d="M22 8v8h8M13 22h10M13 27h6" stroke="currentColor" {...line} />
    <path d="M30 22h6a6 6 0 0 1 0 12h-8M33 19l-3 3 3 3" stroke={a} {...line} strokeWidth={2} />
  </>
);

/** Approved: a shield with a check. */
const approved: Drawing = (a) => (
  <>
    <path d="M24 5l15 5v11c0 10-6.5 17-15 21C15 38 9 31 9 21V10z" stroke="currentColor" {...line} />
    <path d="M16.5 24l5 5 10-10" stroke={a} {...line} strokeWidth={2} />
  </>
);

const DRAWINGS: Record<string, Drawing> = { all: heater, verified, low: gauge, open: request, duty: thermometer, returned, approved };

/** `onSelected`: drawn on a selected (navy) card, so the accent takes the card's light blue instead of the tone. */
export function StatIllustration({ id, tone, className, onSelected = false }: { id: string; tone: StatTone; className?: string; onSelected?: boolean }) {
  const draw = DRAWINGS[id] ?? heater;
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" className={className}>
      {draw(onSelected ? 'var(--color-card-selected-muted)' : ACCENT[tone])}
    </svg>
  );
}
