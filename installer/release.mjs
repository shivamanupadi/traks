#!/usr/bin/env node
/**
 * One-command platform release: version, build, upload, commit, tag.
 *
 *   yarn traks:release          # patch bump (0.1.0 → 0.1.1)
 *   yarn traks:release minor    # 0.1.0 → 0.2.0
 *   yarn traks:release major    # 0.1.0 → 1.0.0
 *
 * The bump is anchored to the PUBLISHED version (traks.dev latest-version):
 * bump only when the local version equals what's live; a local version
 * already ahead (failed prior attempt, manual bump) is used as-is - so
 * re-running after a failed upload never double-bumps.
 *
 * The version commit + tag happen only after a successful upload.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(ROOT, 'package.json');

const level = process.argv[2] ?? 'patch';
if (!['patch', 'minor', 'major'].includes(level)) {
  console.error(`usage: yarn traks:release [patch|minor|major] (got "${level}")`);
  process.exit(1);
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`✗ ${cmd} ${args.join(' ')} failed`);
    process.exit(1);
  }
}

const bump = (v, lvl) => {
  const [ma, mi, pa] = v.split('.').map(Number);
  if (lvl === 'major') return `${ma + 1}.0.0`;
  if (lvl === 'minor') return `${ma}.${mi + 1}.0`;
  return `${ma}.${mi}.${pa + 1}`;
};

const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
// Cache-buster: the endpoint is edge-cached 5 min for instance banners, but
// the release anchor must read the origin's current truth.
const live = await fetch(`https://traks.dev/api/deploy/latest-version?bust=${Date.now()}`)
  .then(r => (r.ok ? r.json() : null))
  .catch(() => null);
const liveVersion = live?.data?.version;

let version = pkg.version;
if (liveVersion === pkg.version) {
  version = bump(pkg.version, level);
  pkg.version = version;
  writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`version: ${liveVersion} (published) → ${version}`);
} else {
  console.log(
    `version: keeping local ${pkg.version} (published is ${liveVersion ?? 'unknown'} - already bumped)`
  );
}

run('node', ['installer/build-release.mjs']);
run('node', ['installer/upload-release.mjs']);

// Record the release in git only once it's actually published.
run('git', ['add', 'package.json']);
const staged = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: ROOT });
if (staged.status !== 0) {
  run('git', ['commit', '-m', `Release v${version}`]);
}
const tagged = spawnSync('git', ['rev-parse', `v${version}`], { cwd: ROOT, stdio: 'ignore' });
if (tagged.status !== 0) {
  run('git', ['tag', `v${version}`]);
}
console.log(`\n✓ Traks ${version} released (tagged v${version})`);
