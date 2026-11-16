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

/** A small coloured label. `warning` = needs a person, `success` = done, `info` = FYI. */
export const badge = {
  neutral: 'inline-flex items-center rounded-sm bg-muted px-200 py-100 text-200 font-medium text-muted-foreground',
  warning: 'inline-flex items-center rounded-sm bg-warning px-200 py-100 text-200 font-medium text-warning-foreground',
  success: 'inline-flex items-center rounded-sm bg-success px-200 py-100 text-200 font-medium text-success-foreground',
  info: 'inline-flex items-center rounded-sm bg-info px-200 py-100 text-200 font-medium text-info-foreground',
} as const;

/** The card surface used for sections of a page. */
export const card = 'rounded-lg border border-border bg-card text-card-foreground';
