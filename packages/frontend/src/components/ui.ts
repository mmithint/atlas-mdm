/**
 * Shared class strings for buttons and inputs, so every screen looks the same and the
 * focus ring and disabled state are never forgotten. Plain strings on purpose: join them
 * with `clsx`, not `cn` (tailwind-merge cannot tell the text-size tokens from text colours).
 */

/**
 * Oxy button system. Every button: a 150ms colour and shadow change (none for people who ask for
 * reduced motion); on keyboard focus only, a 2px focus outline 2px out with a 4px soft halo; when
 * disabled, grey text on a faint fill with a quiet border and no shadow. Heights: 28 small,
 * 32 default, 40 large. Corners: 8px, 6px on small.
 */
const buttonCore =
  'inline-flex items-center justify-center border font-medium transition-[color,background-color,border-color,box-shadow] duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:ring-4 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:border-divider disabled:bg-hover-overlay disabled:text-disabled-foreground disabled:shadow-none';
const sizeDefault = 'h-800 gap-200 rounded-xl px-300 text-300';
const sizeSmall = 'h-700 gap-100 rounded-lg px-300 text-200';
const sizeLarge = 'h-1000 gap-200 rounded-xl px-400 text-300';

// The border colour is set by each look, never by the core: two border colours in one class list
// would leave the winner to the stylesheet's order (that hid the outlined buttons' border).
const filled = 'border-transparent bg-primary text-primary-foreground hover:bg-primary-hover hover:shadow-primary-hover active:bg-primary-active';
const outlined =
  'border-secondary-border bg-secondary text-secondary-foreground hover:border-secondary-hover-text hover:text-secondary-hover-text';

export const button = {
  /** Filled: the one main action of a page, a form or a dialog. */
  primary: `${buttonCore} ${sizeDefault} ${filled}`,
  /** Outlined: every other action. */
  secondary: `${buttonCore} ${sizeDefault} ${outlined}`,
  /** Text only: a quiet action that sits among other content. */
  ghost: `${buttonCore} ${sizeDefault} border-transparent bg-transparent text-link hover:bg-hover-overlay disabled:bg-transparent`,
  /** Filled red: an action that rejects, withdraws or removes. */
  danger: `${buttonCore} ${sizeDefault} border-transparent bg-danger-solid text-on-danger hover:bg-danger-solid-hover`,
  /** A small outlined button for toolbars and table rows. */
  small: `${buttonCore} ${sizeSmall} ${outlined}`,
  /** A large filled button, for a screen with one action (sign in). */
  large: `${buttonCore} ${sizeLarge} ${filled}`,
} as const;

/**
 * Inputs: a control-strength outline (3:1), blue on hover and on focus with the soft halo, subtle
 * placeholder text. At least 32px tall like a button, so they line up in a row; text areas grow.
 */
const inputCore =
  'w-full rounded-lg border border-input bg-card text-foreground transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none placeholder:text-subtle-foreground hover:border-control-hover focus:border-ring focus:outline-none focus:ring-4 focus:ring-focus-ring disabled:cursor-not-allowed disabled:border-divider disabled:bg-hover-overlay disabled:text-disabled-foreground';

export const input = `${inputCore} min-h-800 px-300 py-100 text-300`;

/** A compact input for a filter box under a table header: 28px, like a small button. */
export const inputCompact = `${inputCore} min-h-700 min-w-28 px-200 py-100 text-200`;

/**
 * A small coloured label with a tinted fill, a border and text of the same hue. `warning` = needs a
 * person, `success` = done, `info` = FYI, `danger` = refused or failed, `neutral` = no state.
 */
const badgeBase = 'inline-flex items-center gap-100 rounded-lg border px-200-nudge py-100-nudge text-200 leading-200 font-medium';
export const badge = {
  neutral: `${badgeBase} border-border bg-muted text-muted-foreground`,
  warning: `${badgeBase} border-warning-border bg-warning text-warning-foreground`,
  success: `${badgeBase} border-success-border bg-success text-success-foreground`,
  info: `${badgeBase} border-info-border bg-info text-info-foreground`,
  danger: `${badgeBase} border-danger-border bg-danger-bg text-danger-text`,
} as const;

/** Engineering tags and other primary equipment identifiers, wherever they appear in the app. */
export const identifierBadge = `${badge.info} font-monospace`;

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
