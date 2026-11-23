/**
 * Shared class strings for buttons and inputs, so every screen looks the same and the
 * focus ring and disabled state are never forgotten. Plain strings on purpose: join them
 * with `clsx`, not `cn` (tailwind-merge cannot tell the text-size tokens from text colours).
 */

const buttonBase =
  'inline-flex items-center justify-center gap-200 rounded-md px-400 py-200 text-300 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export const button = {
  primary: `${buttonBase} bg-primary text-primary-foreground hover:bg-primary/90`,
  secondary: `${buttonBase} border border-border bg-card text-foreground hover:bg-accent`,
  ghost: `${buttonBase} text-foreground hover:bg-accent`,
  /** A small secondary button for toolbars and table rows. */
  small:
    'inline-flex items-center justify-center gap-100 rounded-md border border-border bg-card px-300 py-100 text-200 font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
} as const;

export const input =
  'w-full rounded-md border border-input bg-card px-300 py-200 text-300 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

/** A compact input for a filter box under a table header (written out, not `input` plus overrides: the classes would clash). */
export const inputCompact =
  'w-full min-w-28 rounded-md border border-input bg-card px-200 py-100 text-200 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

/** A small coloured label. `warning` = needs a person, `success` = done, `info` = FYI. */
export const badge = {
  neutral: 'inline-flex items-center gap-100 rounded-lg bg-muted px-200-nudge py-100-nudge text-200 leading-200 font-medium text-muted-foreground',
  warning: 'inline-flex items-center gap-100 rounded-lg bg-warning px-200-nudge py-100-nudge text-200 leading-200 font-medium text-warning-foreground',
  success: 'inline-flex items-center gap-100 rounded-lg bg-success px-200-nudge py-100-nudge text-200 leading-200 font-medium text-success-foreground',
  info: 'inline-flex items-center gap-100 rounded-lg bg-info px-200-nudge py-100-nudge text-200 leading-200 font-medium text-info-foreground',
} as const;

/**
 * Categorical badges (Oxy category 1-8): a tinted fill, a matching border and text. For telling
 * groups apart (equipment classes, tags), never for status. The label always stays visible: colour
 * alone never carries the meaning. Written out in full so Tailwind sees every class.
 */
const categoryBase = 'inline-flex items-center gap-100 rounded-lg border px-200-nudge py-100-nudge text-200 leading-200 font-medium';
export const categoryBadge = [
  `${categoryBase} border-category-1-border bg-category-1-bg text-category-1-text`,
  `${categoryBase} border-category-2-border bg-category-2-bg text-category-2-text`,
  `${categoryBase} border-category-3-border bg-category-3-bg text-category-3-text`,
  `${categoryBase} border-category-4-border bg-category-4-bg text-category-4-text`,
  `${categoryBase} border-category-5-border bg-category-5-bg text-category-5-text`,
  `${categoryBase} border-category-6-border bg-category-6-bg text-category-6-text`,
  `${categoryBase} border-category-7-border bg-category-7-bg text-category-7-text`,
  `${categoryBase} border-category-8-border bg-category-8-bg text-category-8-text`,
] as const;

/** The card surface used for sections of a page. */
export const card = 'rounded-lg border border-border bg-card text-card-foreground';
