#!/usr/bin/env node
/**
 * Node harness for the web-installer engine — proves the pure-REST path
 * (no wrangler, no terraform) against a real Cloudflare account before the
 * engine is embedded in the wizard Worker.
 *
 *   CATALOG_TOKEN=<r2-token> node installer/web/test-engine.mjs provision <instance>
 *   CATALOG_TOKEN=<r2-token> node installer/web/test-engine.mjs destroy <instance>
 *
 * Auth: CLOUDFLARE_API_TOKEN or the local wrangler OAuth session.
 * Artifacts come from the built package (yarn traks:build first).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { provisionInstance, destroyInstance, names } from './engine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'installer/npm/traks-cli/dist');
const require = createRequire(
  path.join(ROOT, 'installer/npm/traks-cli/node_modules/wrangler/package.json')
);
const blake3 = require('blake3-wasm');

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? '4cf68c768770ccda55d287d6ecbdeb4f';
const command = process.argv[2] ?? 'provision';
const instance = process.argv[3] ?? 'traks-web1';

function apiToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const configPath =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library/Preferences/.wrangler/config/default.toml')
      : path.join(os.homedir(), '.config/.wrangler/config/default.toml');
  const m = readFileSync(configPath, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/);
  if (!m) throw new Error('no CLOUDFLARE_API_TOKEN and no wrangler OAuth session');
  return m[1];
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

function loadArtifacts() {
  const webAssets = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, `${prefix}/${entry}`);
      else {
        const ext = entry.includes('.') ? entry.split('.').pop() : '';
        webAssets.push({
          path: `${prefix}/${entry}`,
          content: new Uint8Array(readFileSync(full)),
          contentType: MIME[ext],
        });
      }
    }
  };
  walk(path.join(DIST, 'web'), '');
  const migrations = readdirSync(path.join(DIST, 'migrations'))
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(name => ({ name, sql: readFileSync(path.join(DIST, 'migrations', name), 'utf8') }));
  return {
    apiWorker: new Uint8Array(readFileSync(path.join(DIST, 'api/worker.js'))),
    collectWorker: new Uint8Array(readFileSync(path.join(DIST, 'collect/worker.js'))),
    webAssets,
    migrations,
    schema: JSON.parse(readFileSync(path.join(DIST, 'terraform/pipeline-schema.json'), 'utf8')),
  };
}

/* S3-based bucket emptier for destroy (same derivation as the CLI). */
const sha256hex = d => createHash('sha256').update(d).digest('hex');
async function makeEmptyBucket(catalogToken) {
  const verify = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/tokens/verify`,
    { headers: { Authorization: `Bearer ${catalogToken}` } }
  ).then(r => r.json());
  const keyId = verify?.result?.id;
  if (!keyId) return undefined;
  const secret = sha256hex(catalogToken);
  return async bucket => {
    const host = `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
    const sign = (method, pathname, query) => {
      const now = new Date();
      const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const datestamp = amzDate.slice(0, 8);
      const payloadHash = sha256hex('');
      const canonicalQuery = query
        .split('&').filter(Boolean)
        .map(kv => kv.split('=').map(encodeURIComponent).join('=')).sort().join('&');
      const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
      const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
      const canonicalPath = pathname.split('/').map(encodeURIComponent).join('/');
      const canonicalRequest = [method, canonicalPath, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
      const scope = `${datestamp}/auto/s3/aws4_request`;
      const sts = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
      const hmac = (k, d) => createHmac('sha256', k).update(d).digest();
      const kSigning = hmac(hmac(hmac(hmac(`AWS4${secret}`, datestamp), 'auto'), 's3'), 'aws4_request');
      const signature = createHmac('sha256', kSigning).update(sts).digest('hex');
      return {
        url: `https://${host}${canonicalPath}${query ? `?${query}` : ''}`,
        headers: {
          'x-amz-date': amzDate,
          'x-amz-content-sha256': payloadHash,
          Authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        },
      };
    };
    for (;;) {
      const list = sign('GET', `/${bucket}`, 'list-type=2');
      const res = await fetch(list.url, { headers: list.headers });
      if (res.status !== 200) return;
      const keys = [...(await res.text()).matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
      if (!keys.length) return;
      for (const key of keys) {
        const del = sign('DELETE', `/${bucket}/${key}`, '');
        await fetch(del.url, { method: 'DELETE', headers: del.headers });
      }
    }
  };
}

const catalogToken = process.env.CATALOG_TOKEN ?? '';
if (!catalogToken) {
  console.error('CATALOG_TOKEN required');
  process.exit(1);
}

const started = new Map();
const ctx = {
  apiToken: apiToken(),
  accountId: ACCOUNT_ID,
  instance,
  catalogToken,
  artifacts: existsSync(DIST) ? loadArtifacts() : null,
  hashAsset: (bytes, ext) =>
    blake3.hash(Buffer.from(bytes).toString('base64') + ext).toString('hex').slice(0, 32),
  randomHex: n => randomBytes(n).toString('hex'),
  emptyBucket: await makeEmptyBucket(catalogToken),
  emit: e => {
    if (e.status === 'start') {
      started.set(e.stepId, Date.now());
      process.stdout.write(`  … ${e.label}`);
    } else {
      const ms = Date.now() - (started.get(e.stepId) ?? Date.now());
      const mark = e.status === 'ok' ? '✓' : e.status === 'retry' ? '↻' : '✗';
      process.stdout.write(`\r  ${mark} ${e.label} (${(ms / 1000).toFixed(1)}s)${e.detail ? ` — ${e.detail}` : ''}\n`);
      if (e.status === 'retry') process.stdout.write(`  … ${e.label}`);
    }
  },
};

console.log(`engine ${command} — instance "${instance}" (account ${ACCOUNT_ID})`);
if (command === 'provision') {
  const out = await provisionInstance(ctx);
  console.log(`\n✓ provisioned via pure REST — no wrangler, no terraform`);
  console.log(`  dashboard: ${out.apiUrl}`);
  console.log(`  collect:   ${out.collectUrl}`);
} else if (command === 'destroy') {
  await destroyInstance(ctx);
  console.log('\n✓ destroyed');
} else {
  console.error(`unknown command ${command}`);
  process.exit(1);
}
