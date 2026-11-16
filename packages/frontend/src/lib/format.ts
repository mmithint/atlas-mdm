/**
 * Display formatting. One rule runs through all of it: a blank stays blank. A missing
 * heat duty is "—", never "0": zero is a real value and a blank is not
 * ("blank values show as blank, never as zero", REF-13 to 21 analysis).
 */

export const BLANK = '—';

/** True for null, undefined and text that is empty or only spaces. */
export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/** Text for a cell: the value, or a dash when it is blank. */
export function orBlank(value: string | number | null | undefined): string {
  return isBlank(value) ? BLANK : String(value);
}

/**
 * A decimal as people read it: `2.5000` becomes `2.5`, `10.0000` becomes `10`.
 * Accepts the invariant text the gold views give (no thousands separators) or a number.
 * Anything that is not a number is returned unchanged, and a blank stays blank.
 */
export function formatDecimal(value: string | number | null | undefined, maxFractionDigits = 4): string {
  if (isBlank(value)) return BLANK;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
    useGrouping: false,
  }).format(n);
}

/** A percentage between 0 and 100 such as 60 → `60%`, 33.33 → `33.3%`; blank stays blank. */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return BLANK;
  return `${formatDecimal(Math.round(value * 10) / 10, 1)}%`;
}

const utcFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

/** A UTC timestamp as `14 Nov 2026, 09:30 UTC`; blank or unreadable stays blank. */
export function formatUtc(value: Date | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return BLANK;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return BLANK;
  return `${utcFormatter.format(date)} UTC`;
}
