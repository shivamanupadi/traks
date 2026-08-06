#!/usr/bin/env node
/**
 * Build the release artifacts the traks.dev/deploy wizard provisions from:
 * prebuilt worker bundles, the web dist, and D1 migrations.
 *
 *   node installer/build-release.mjs
 *
 * Output: installer/dist/{api,collect,web,migrations}
 * Worker bundles come from `wrangler deploy --dry-run --outdir` (the same
 * esbuild pipeline a real deploy uses). Upload with installer/web/upload-release.mjs.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, copyFileSync, cpSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'installer/dist');

function run(cmd, args, cwd = ROOT) {
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`✗ ${cmd} ${args.join(' ')} failed`);
    process.exit(1);
  }
}

function bundleWorker(app, outName) {
  const outdir = path.join(DIST, outName);
  run(
    'npx',
    ['wrangler', 'deploy', '--dry-run', `--outdir=${outdir}`],
    path.join(ROOT, 'apps', app)
  );
  // wrangler writes one bundled .js (name varies) — normalize to worker.js
  const js = readdirSync(outdir).find(f => f.endsWith('.js'));
  if (!js) {
    console.error(`✗ no bundle produced for ${app}`);
    process.exit(1);
  }
  if (js !== 'worker.js') copyFileSync(path.join(outdir, js), path.join(outdir, 'worker.js'));
  console.log(
    `  dist/${outName}/worker.js (${(statSync(path.join(outdir, 'worker.js')).size / 1024).toFixed(0)} KB)`
  );
}

console.log('==> Cleaning');
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

console.log('==> Building web dashboard');
run('yarn', ['workspace', '@traks/web', 'build']);
cpSync(path.join(ROOT, 'apps/web/dist'), path.join(DIST, 'web'), { recursive: true });

console.log('==> Bundling workers');
bundleWorker('api', 'api');
bundleWorker('collect', 'collect');

console.log('==> Migrations');
mkdirSync(path.join(DIST, 'migrations'), { recursive: true });
for (const f of readdirSync(path.join(ROOT, 'apps/api/src/db/migrations'))) {
  if (f.endsWith('.sql')) {
    copyFileSync(
      path.join(ROOT, 'apps/api/src/db/migrations', f),
      path.join(DIST, 'migrations', f)
    );
  }
}

console.log('\n✓ Release built at installer/dist — upload with:');
console.log('  CATALOG_TOKEN=<token> node installer/web/upload-release.mjs');
