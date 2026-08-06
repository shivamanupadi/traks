#!/usr/bin/env node
/**
 * Upload the built package artifacts to the traks-releases R2 bucket, which
 * the traks.dev/deploy wizard worker reads when provisioning user instances.
 *
 *   CATALOG_TOKEN=<r2-token> node installer/upload-release.mjs
 *
 * Layout in the bucket (single "current" channel for now):
 *   current/manifest.json      { version, assets: [{path,hash,size,contentType}], migrations: [names] }
 *   current/api-worker.js
 *   current/collect-worker.js
 *   current/pipeline-schema.json
 *   current/migrations/<name>.sql
 *   current/assets/<hash>      raw asset bytes
 *
 * Asset hashes are computed here (wrangler-compatible BLAKE3) so the worker
 * engine never needs to hash anything at runtime.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'installer/dist');
const BUCKET = 'traks-releases';
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? '4cf68c768770ccda55d287d6ecbdeb4f';
// blake3-wasm ships inside wrangler (resolved via the api workspace) — the
// same implementation wrangler uses for asset hashes, which must match.
const apiRequire = createRequire(path.join(ROOT, 'apps/platform/api/package.json'));
const require = createRequire(apiRequire.resolve('wrangler/package.json'));
const blake3 = require('blake3-wasm');

// Release-upload credential: env override, else the traks-home Doppler project.
let token = process.env.CATALOG_TOKEN;
if (!token) {
  try {
    token = execSync('doppler secrets get CATALOG_TOKEN --plain -p traks-home -c prd', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    /* doppler unavailable — fall through to the error below */
  }
}
if (!token) {
  console.error('CATALOG_TOKEN required (R2 storage write) — set it or log in to Doppler');
  process.exit(1);
}

// Version guard: an upload under an unchanged version is invisible to
// deployed instances (the update banner compares manifest.version).
const localVersion = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
// Cache-buster: must see the origin's current truth, not the 5-min edge cache.
const live = await fetch(`https://traks.dev/api/deploy/latest-version?bust=${Date.now()}`)
  .then(r => (r.ok ? r.json() : null))
  .catch(() => null);
if (live?.data?.version === localVersion && process.env.FORCE_RELEASE !== '1') {
  console.error(
    `✗ version ${localVersion} is already the published release — bump the root package.json version first (or FORCE_RELEASE=1 to overwrite in place)`
  );
  process.exit(1);
}

const sha256hex = d => createHash('sha256').update(d).digest('hex');
const verify = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/tokens/verify`,
  { headers: { Authorization: `Bearer ${token}` } }
).then(r => r.json());
const keyId = verify?.result?.id;
if (!keyId) {
  console.error('token verify failed');
  process.exit(1);
}
const secret = sha256hex(token);
const host = `${ACCOUNT_ID}.r2.cloudflarestorage.com`;

async function putObject(key, bytes, contentType = 'application/octet-stream') {
  const now = new Date();
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const datestamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(bytes);
  const canonicalPath = `/${BUCKET}/${key}`.split('/').map(encodeURIComponent).join('/');
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    'PUT',
    canonicalPath,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${datestamp}/auto/s3/aws4_request`;
  const sts = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const hmac = (k, d) => createHmac('sha256', k).update(d).digest();
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secret}`, datestamp), 'auto'), 's3'), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(sts).digest('hex');
  const res = await fetch(`https://${host}${canonicalPath}`, {
    method: 'PUT',
    headers: {
      'content-type': contentType,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      Authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: bytes,
  });
  if (res.status !== 200) throw new Error(`PUT ${key} → ${res.status}: ${await res.text()}`);
}

const MIME = {
  html: 'text/html',
  js: 'text/javascript',
  css: 'text/css',
  svg: 'image/svg+xml',
  png: 'image/png',
  ico: 'image/x-icon',
  json: 'application/json',
  txt: 'text/plain',
  webmanifest: 'application/manifest+json',
};

const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

console.log(`uploading release ${version} → r2://${BUCKET}/current/`);

const assets = [];
const walk = (dir, prefix) => {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, `${prefix}/${entry}`);
    else {
      const bytes = readFileSync(full);
      const ext = entry.includes('.') ? entry.split('.').pop() : '';
      const hash = blake3
        .hash(bytes.toString('base64') + ext)
        .toString('hex')
        .slice(0, 32);
      assets.push({
        path: `${prefix}/${entry}`,
        hash,
        size: bytes.length,
        contentType: MIME[ext] ?? null,
      });
      uploads.push(
        putObject(`current/assets/${hash}`, bytes, MIME[ext] ?? 'application/octet-stream')
      );
    }
  }
};
const uploads = [];
walk(path.join(DIST, 'web'), '');

const migrations = readdirSync(path.join(DIST, 'migrations'))
  .filter(f => f.endsWith('.sql'))
  .sort();
for (const name of migrations) {
  uploads.push(
    putObject(
      `current/migrations/${name}`,
      readFileSync(path.join(DIST, 'migrations', name)),
      'text/plain'
    )
  );
}
uploads.push(
  putObject(
    'current/api-worker.js',
    readFileSync(path.join(DIST, 'api/worker.js')),
    'text/javascript'
  )
);
uploads.push(
  putObject(
    'current/collect-worker.js',
    readFileSync(path.join(DIST, 'collect/worker.js')),
    'text/javascript'
  )
);
uploads.push(
  putObject(
    'current/pipeline-schema.json',
    readFileSync(path.join(ROOT, 'scripts/pipeline-schema.json')),
    'application/json'
  )
);

await Promise.all(uploads);
await putObject(
  'current/manifest.json',
  Buffer.from(
    JSON.stringify({ version, uploadedAt: new Date().toISOString(), assets, migrations }, null, 2)
  ),
  'application/json'
);
console.log(
  `✓ ${assets.length} assets, ${migrations.length} migrations, 2 workers, schema, manifest`
);
