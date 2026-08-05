#!/usr/bin/env node
/**
 * Build the publishable @traks/cli package: prebuilt worker bundles, web
 * dist, migrations, and Terraform config — everything the packaged-mode
 * installer deploys, so buyers never need this repo.
 *
 *   node installer/build-package.mjs
 *
 * Output: installer/npm/traks-cli/{cli.mjs, dist/**}
 * Worker bundles come from `wrangler deploy --dry-run --outdir` (the same
 * esbuild pipeline a real deploy uses).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, copyFileSync, cpSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(ROOT, 'installer/npm/traks-cli');
const DIST = path.join(PKG, 'dist');

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

console.log('==> Terraform config + schema');
mkdirSync(path.join(DIST, 'terraform'), { recursive: true });
copyFileSync(path.join(ROOT, 'installer/terraform/main.tf'), path.join(DIST, 'terraform/main.tf'));
copyFileSync(
  path.join(ROOT, 'scripts/pipeline-schema.json'),
  path.join(DIST, 'terraform/pipeline-schema.json')
);

console.log('==> CLI');
copyFileSync(path.join(ROOT, 'installer/cli.mjs'), path.join(PKG, 'cli.mjs'));

console.log('==> Package dependencies (pinned wrangler)');
run('npm', ['install', '--no-package-lock', '--no-audit', '--no-fund'], PKG);

console.log('\n✓ Package built at installer/npm/traks-cli — run it with:');
console.log(
  '  CATALOG_TOKEN=<token> node installer/npm/traks-cli/cli.mjs install --instance <name>'
);
