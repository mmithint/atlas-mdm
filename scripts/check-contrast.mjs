// scripts/check-contrast.mjs — checks the colour tokens in global.css against WCAG 2.2 AA.
//
// Run with `npm run check:contrast` (plain Node; no dependencies).
//
// It reads packages/frontend/src/global.css, resolves every token through the Oxy primitives
// for the light theme (`@theme static`, `@theme`) and the dark theme (`.dark` over light),
// composites translucent colours over the surface they sit on, and prints one row per pair:
// text needs 4.5:1, control outlines and focus or selection indicators need 3:1.
// It exits 1 when any pair is below its minimum.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const css = readFileSync(resolve(root, 'packages/frontend/src/global.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations inside the first `{ … }` that follows `selector`. */
function declarations(selector) {
  const at = css.indexOf(selector);
  if (at < 0) throw new Error(`global.css has no "${selector}" block`);
  let depth = 0;
  let start = -1;
  for (let i = css.indexOf('{', at); i < css.length; i += 1) {
    if (css[i] === '{' && depth++ === 0) start = i + 1;
    else if (css[i] === '}' && --depth === 0) {
      const body = css.slice(start, i);
      return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    }
  }
  throw new Error(`Unclosed "${selector}" block`);
}

const primitives = declarations(':root {');
const light = { ...primitives, ...declarations('@theme static {'), ...declarations('@theme {') };
const dark = { ...light, ...declarations('.dark {') };

function expand(value, vars, seen = new Set()) {
  return value.replace(/var\((--[\w-]+)\)/g, (_, name) => {
    if (seen.has(name)) throw new Error(`Circular token ${name}`);
    if (!(name in vars)) throw new Error(`Unknown token ${name}`);
    return expand(vars[name], vars, new Set([...seen, name]));
  });
}

function parse(text) {
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const rgb = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[/,]\s*([\d.]+))?\s*\)$/i);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: rgb[4] === undefined ? 1 : +rgb[4] };
  throw new Error(`Cannot read colour "${text}"`);
}

const colour = (token, vars) => {
  const name = `--color-${token}`;
  if (!(name in vars)) throw new Error(`global.css has no ${name}`);
  return parse(expand(vars[name], vars));
};

const over = (top, under) => ({
  r: top.r * top.a + under.r * (1 - top.a),
  g: top.g * top.a + under.g * (1 - top.a),
  b: top.b * top.a + under.b * (1 - top.a),
  a: 1,
});

const luminance = ({ r, g, b }) => {
  const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const hex = ({ r, g, b }) => `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

const TEXT = 4.5;
const UI = 3;

/**
 * [foreground, background, minimum, what it is]. A background written `a>b` is token `a`
 * composited over token `b` (for translucent surfaces such as the hover overlay).
 */
const PAIRS = [
  // Page and surfaces
  ['foreground', 'background', TEXT, 'default text on the page'],
  ['card-foreground', 'card', TEXT, 'text on cards'],
  ['popover-foreground', 'popover', TEXT, 'text on popovers'],
  ['muted-foreground', 'background', TEXT, 'muted text on the page'],
  ['muted-foreground', 'card', TEXT, 'muted text on cards'],
  ['muted-foreground', 'muted', TEXT, 'table header text'],
  ['foreground', 'muted', TEXT, 'text on nested blocks'],
  ['accent-foreground', 'accent', TEXT, 'text on hover'],
  ['foreground', 'hover', TEXT, 'text on a hovered row'],
  ['foreground', 'row-hover>card', TEXT, 'text on a hovered table row'],
  ['muted-foreground', 'row-hover>card', TEXT, 'muted text on a hovered table row'],
  ['foreground', 'bg-hover-overlay>card', TEXT, 'text on the hover overlay'],
  ['text-tertiary', 'card', TEXT, 'placeholder and subtle text'],
  ['brand-foreground', 'card', TEXT, 'ID-plate links'],
  ['text-link', 'card', TEXT, 'links'],
  ['text-link-hover', 'card', TEXT, 'links, hovered'],
  // Actions
  ['primary-foreground', 'primary', TEXT, 'primary button'],
  ['text-on-primary', 'primary-hover', TEXT, 'primary button, hovered'],
  ['text-on-primary', 'primary-active', TEXT, 'primary button, pressed'],
  ['secondary-foreground', 'secondary', TEXT, 'secondary button'],
  ['secondary-hover-text', 'secondary-bg', TEXT, 'secondary button, hovered'],
  ['text-link', 'bg-hover-overlay>card', TEXT, 'ghost button, hovered'],
  ['secondary-hover-text', 'card', UI, 'secondary button outline, hovered'],
  ['destructive', 'card', TEXT, 'error text on cards'],
  ['destructive', 'background', TEXT, 'error text on the page'],
  ['text-on-danger', 'danger-solid', TEXT, 'danger button and pill'],
  ['text-on-danger', 'danger-solid-hover', TEXT, 'danger button, hovered'],
  ['text-on-warning', 'warning-solid', TEXT, 'notification count badge'],
  // Status tints
  ['warning-foreground', 'warning', TEXT, 'warning badge'],
  ['success-foreground', 'success', TEXT, 'success badge'],
  ['info-foreground', 'info', TEXT, 'info badge'],
  ['danger-text', 'danger-bg', TEXT, 'danger tint'],
  ...Array.from({ length: 8 }, (_, i) => [`category-${i + 1}-text`, `category-${i + 1}-bg`, TEXT, `category ${i + 1} tag`]),
  // Navigation rail
  ['sidebar-foreground', 'sidebar', TEXT, 'menu text'],
  ['sidebar-muted', 'sidebar', TEXT, 'menu secondary text'],
  ['sidebar-foreground', 'sidebar-accent', TEXT, 'menu item, hovered'],
  ['sidebar-selected-foreground', 'sidebar-selected', TEXT, 'current menu item'],
  ['card-selected-foreground', 'card-selected', TEXT, 'selected metric card: number'],
  ['card-selected-muted', 'card-selected', TEXT, 'selected metric card: label'],
  ['card-selected-border', 'card', UI, 'selected metric card edge against the others'],
  // Controls and indicators (3:1)
  ['input', 'card', UI, 'input outline on cards'],
  ['input', 'background', UI, 'input outline on the page'],
  ['border-control-hover', 'card', UI, 'input outline, hovered'],
  ['ring', 'card', UI, 'focus ring on cards'],
  ['ring', 'background', UI, 'focus ring on the page'],
  ['border-focus', 'card', UI, 'focus outline on cards'],
  ['ring', 'card', UI, 'selected tab underline, chosen heater'],
  ['sidebar-active', 'sidebar', UI, 'current-page bar on the menu'],
  ['ring', 'sidebar', UI, 'focus ring on the menu'],
];

let failures = 0;
const rows = [];
for (const [theme, vars] of [['light', light], ['dark', dark]]) {
  for (const [fg, bg, min, what] of PAIRS) {
    const [top, under] = bg.split('>');
    let back = colour(top, vars);
    if (under) back = over(back, colour(under, vars));
    const front = over(colour(fg, vars), back);
    const r = ratio(front, back);
    const ok = r >= min;
    if (!ok) failures += 1;
    rows.push([theme, what, `${fg} on ${bg.replace('>', ' over ')}`, hex(front), hex(back), r.toFixed(2), `${min}:1`, ok ? 'pass' : 'FAIL']);
  }
}

const head = ['theme', 'pair', 'tokens', 'fg', 'bg', 'ratio', 'min', 'result'];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
console.log(line(head));
console.log(widths.map((w) => '-'.repeat(w)).join('  '));
for (const row of rows) console.log(line(row));
console.log(`\n${rows.length - failures} of ${rows.length} pairs meet WCAG 2.2 AA.`);
if (failures > 0) {
  console.error(`${failures} pair(s) below AA.`);
  process.exit(1);
}
