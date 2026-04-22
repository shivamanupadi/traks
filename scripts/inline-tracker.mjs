#!/usr/bin/env node
/**
 * Read packages/tracker/dist/tracker.js and inline it into
 * apps/collect/src/lib/tracker-script.ts as a TypeScript string export.
 *
 * Run after `yarn workspace @traks/tracker build` so the inlined copy
 * matches the latest source.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const distPath = join(root, 'packages/tracker/dist/tracker.js');
const outPath = join(root, 'apps/collect/src/lib/tracker-script.ts');

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

writeFileSync(outPath, header);
console.log(`Wrote ${minified.length} chars to ${outPath}`);
