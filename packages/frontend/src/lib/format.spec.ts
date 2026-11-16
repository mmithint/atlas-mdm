import { describe, expect, it } from 'vitest';

import { BLANK, formatDecimal, formatPercent, formatUtc, isBlank, orBlank } from './format';

describe('blanks stay blank', () => {
  it('treats null, undefined and empty or spaces-only text as blank', () => {
    for (const v of [null, undefined, '', '   ']) expect(isBlank(v)).toBe(true);
    for (const v of [0, '0', 'a', ' a ']) expect(isBlank(v)).toBe(false);
  });

  it('shows a dash for a blank and keeps a real zero', () => {
    expect(orBlank(null)).toBe(BLANK);
    expect(orBlank('')).toBe(BLANK);
    expect(orBlank(0)).toBe('0');
    expect(orBlank('SYN-TAG-1')).toBe('SYN-TAG-1');
  });
});

describe('formatDecimal', () => {
  it.each([
    ['2.5000', '2.5'],
    ['10.0000', '10'],
    [2.25, '2.25'],
    ['0.1', '0.1'],
    ['0', '0'],
    ['1234.5', '1234.5'],
  ])('shows %j as %s', (value, text) => {
    expect(formatDecimal(value)).toBe(text);
  });

  it('keeps a blank blank (a missing heat duty is not zero) and returns non-numbers unchanged', () => {
    expect(formatDecimal(null)).toBe(BLANK);
    expect(formatDecimal('')).toBe(BLANK);
    expect(formatDecimal('n/a')).toBe('n/a');
  });
});

describe('formatPercent', () => {
  it('rounds to one decimal and drops a trailing zero', () => {
    expect(formatPercent(60)).toBe('60%');
    expect(formatPercent(33.333)).toBe('33.3%');
    expect(formatPercent(100)).toBe('100%');
    expect(formatPercent(0)).toBe('0%');
  });

  it('keeps a blank blank', () => {
    expect(formatPercent(null)).toBe(BLANK);
    expect(formatPercent(undefined)).toBe(BLANK);
    expect(formatPercent(Number.NaN)).toBe(BLANK);
  });
});

describe('formatUtc', () => {
  it('shows a UTC timestamp with its zone, whatever the browser zone is', () => {
    expect(formatUtc(new Date('2026-11-14T09:30:00Z'))).toBe('14 Nov 2026, 09:30 UTC');
    expect(formatUtc('2026-11-14T23:59:00Z')).toBe('14 Nov 2026, 23:59 UTC');
  });

  it('keeps a blank or unreadable value blank', () => {
    expect(formatUtc(null)).toBe(BLANK);
    expect(formatUtc('')).toBe(BLANK);
    expect(formatUtc('not a date')).toBe(BLANK);
  });
});
