#!/usr/bin/env node
/**
 * Proves the production build carries none of the client-demo code (FINAL PLAN/11 §8 step 4, APP-D).
 *
 * The demo (`npm run dev:mock`) runs on sample data from `packages/frontend/src/dev-mock/`; every import of it
 * sits behind `import.meta.env.DEV && import.meta.env.MODE === 'mock'`, which Vite turns into `false` in a
 * production build, so the folder should vanish. This script reads the built files and fails if any text that
 * only the demo contains is still there.
 *
 * Run after `npm run build`:  node tools/check_no_demo.mjs   (or: npm run check:no-demo)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = join(import.meta.dirname, '..', 'packages', 'frontend', 'dist');

/** Strings that exist only in dev-mock/ (banner, controls, personas, store). */
const MARKERS = ['DEMO · sample data', 'Reset demo', 'atlas-demo-persona', 'Riley Brooks (sample)', 'Example Heater Co.', 'not mocked'];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

let list;
try {
  list = files(DIST).filter((p) => /\.(js|mjs|html|css)$/.test(p));
} catch {
  console.error(`FAIL no build found at ${DIST}. Run npm run build first.`);
  process.exit(1);
}

const hits = [];
for (const path of list) {
  const text = readFileSync(path, 'utf8');
  for (const marker of MARKERS) if (text.includes(marker)) hits.push(`${relative(DIST, path)}: "${marker}"`);
}

if (hits.length > 0) {
  console.error(`FAIL the production build contains demo code (${hits.length}):`);
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
console.log(`OK  no demo code in ${list.length} built files (${MARKERS.length} markers checked).`);
