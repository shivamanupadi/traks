// Copies country flag SVGs (flag-icons, MIT) into public/flags so the
// dashboard can render <img src="/flags/us.svg">. Only ISO 3166-1 alpha-2
// codes are copied — Cloudflare geo never emits subdivision codes — which
// keeps the shipped asset set (and every wizard deploy) small.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const src = join(dirname(require.resolve('flag-icons/package.json')), 'flags/4x3');
const dest = join(dirname(fileURLToPath(import.meta.url)), '../public/flags');

mkdirSync(dest, { recursive: true });
let count = 0;
for (const file of readdirSync(src)) {
  if (!/^[a-z]{2}\.svg$/.test(file)) continue;
  copyFileSync(join(src, file), join(dest, file));
  count++;
}
console.log(`copy-flags: ${count} flags -> public/flags`);
