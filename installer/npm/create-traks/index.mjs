#!/usr/bin/env node
// `npm create traks` front door — delegates to @traks/cli's install command.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let cli;
try {
  cli = require.resolve('@traks/cli/cli.mjs');
} catch {
  console.error('✗ @traks/cli not found — try again with: npx create-traks@latest');
  process.exit(1);
}
const res = spawnSync(process.execPath, [cli, 'install', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(res.status ?? 1);
