#!/usr/bin/env node
/**
 * Read packages/tracker/dist/tracker.js and inline it into
 * apps/platform/collect/src/lib/tracker-script.ts as a TypeScript string export.
 *
 * Run after `yarn workspace @traks/tracker build` so the inlined copy
 * matches the latest source.
 *
 * With --check, writes nothing and exits non-zero if the inlined copy has
 * drifted from the build. This guard exists because the two silently diverged
 * once before: the served script lost the sessionStorage try/catch, and every
 * visitor in Lockdown Mode or a partitioned iframe threw on send and went
 * uncounted. Nothing in the app surfaces that — only this check does.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const distPath = join(root, 'packages/tracker/dist/tracker.js');
const outPath = join(root, 'apps/platform/collect/src/lib/tracker-script.ts');
const checkOnly = process.argv.includes('--check');

const minified = readFileSync(distPath, 'utf8').trim();

// Escape backticks + ${ for safe embedding in a JS template literal.
const escaped = minified.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const header = `/**
 * Minified output of packages/tracker/src/tracker.ts — regenerate with:
 *   yarn workspace @traks/tracker build && node scripts/inline-tracker.mjs
 * Do not hand-edit.
 */
export const TRACKER_SCRIPT = \`${escaped}\`;
`;

if (checkOnly) {
  let current = '';
  try {
    current = readFileSync(outPath, 'utf8');
  } catch {
    /* missing file falls through to the mismatch branch */
  }
  if (current !== header) {
    console.error(
      '\n✗ Tracker drift: the script served at /t.js does not match packages/tracker/dist.\n' +
        '  Fix: yarn workspace @traks/tracker build && node scripts/inline-tracker.mjs\n'
    );
    process.exit(1);
  }
  console.log(`✓ Inlined tracker matches the build (${minified.length} chars)`);
} else {
  writeFileSync(outPath, header);
  console.log(`Wrote ${minified.length} chars to ${outPath}`);
}
