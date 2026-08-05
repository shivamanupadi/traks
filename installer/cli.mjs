#!/usr/bin/env node
/**
 * Traks self-host installer.
 *
 * Provisions a complete Traks deployment into a Cloudflare account and keeps
 * it updated. Wrangler does the heavy lifting, so auth works with either a
 * `wrangler login` OAuth session or a CLOUDFLARE_API_TOKEN env var.
 *
 *   node installer/cli.mjs install   [--instance <name>] [--yes]
 *   node installer/cli.mjs update    [--instance <name>]
 *   node installer/cli.mjs doctor    [--instance <name>]
 *   node installer/cli.mjs destroy   --instance <name>
 *
 * Requirements:
 *   - Node 20+, repo dependencies installed (`yarn install`)
 *   - Cloudflare auth: `npx wrangler login` (or CLOUDFLARE_API_TOKEN)
 *   - CATALOG_TOKEN env var: an R2 API token with "Workers R2 SQL Read" +
 *     "Workers R2 Data Catalog Write" + "Workers R2 Storage Write" (dashboard
 *     shortcut: R2 "Admin Read & Write" account token, plus R2 SQL Read).
 *     It becomes the catalog service credential and the worker's query token.
 *
 * Idempotent: re-running skips resources that exist and never overwrites
 * secrets, so `update` after a `git pull` redeploys code + migrations only.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const command = args[0] ?? 'install';
const flag = name => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1]?.startsWith('--') ? true : (args[i + 1] ?? true)) : undefined;
};
const INSTANCE = typeof flag('instance') === 'string' ? flag('instance') : 'traks';
const AUTO_YES = args.includes('--yes');

if (!/^[a-z][a-z0-9-]{2,20}$/.test(INSTANCE)) {
  fail(`--instance must be lowercase alphanumeric/hyphens (got "${INSTANCE}")`);
}

/** Resource names, all derived from the instance prefix. */
const N = {
  apiWorker: `${INSTANCE}-api`,
  collectWorker: `${INSTANCE}-collect`,
  d1: `${INSTANCE}-db`,
  kvTitle: `${INSTANCE}-r2sql-cache`,
  bucket: `${INSTANCE}-events`,
  stream: `${INSTANCE.replaceAll('-', '_')}_events_stream`,
  sink: `${INSTANCE.replaceAll('-', '_')}_events_sink`,
  pipeline: `${INSTANCE.replaceAll('-', '_')}_events`,
  aeDataset: `${INSTANCE.replaceAll('-', '_')}_collect_metrics`,
};
const API_TOML = path.join(ROOT, 'apps/api', `wrangler.selfhost.toml`);
const COLLECT_TOML = path.join(ROOT, 'apps/collect', `wrangler.selfhost.toml`);

/* ── plumbing ────────────────────────────────────────────────── */

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

function step(msg) {
  console.log(`\n==> ${msg}`);
}

/** Run wrangler; returns stdout+stderr. ok=false instead of throwing when allowFail. */
function wrangler(wranglerArgs, { input, allowFail = false, quiet = false } = {}) {
  const res = spawnSync('npx', ['wrangler', ...wranglerArgs], {
    cwd: ROOT,
    input,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
    maxBuffer: 32 * 1024 * 1024,
  });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  if (res.status !== 0 && !allowFail) {
    console.error(out);
    fail(`wrangler ${wranglerArgs.join(' ')} failed`);
  }
  if (!quiet && res.status !== 0 && allowFail) {
    // caller decides what an acceptable failure looks like
  }
  return { ok: res.status === 0, out };
}

/**
 * Extract the JSON array from wrangler output. Strips ANSI codes, finds the
 * first line that starts an array, and bracket-matches to its true end —
 * warning banners can precede AND follow the JSON (stderr is concatenated
 * after stdout), so greedy regexes are not reliable.
 */
function parseJsonArray(out) {
  const clean = out.replace(/\x1b\[[0-9;]*m/g, '');
  const start = clean.search(/^\[/m);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < clean.length; i++) {
    const ch = clean[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(clean.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function sh(cmd, shArgs) {
  const res = spawnSync(cmd, shArgs, { cwd: ROOT, stdio: 'inherit' });
  if (res.status !== 0) fail(`${cmd} ${shArgs.join(' ')} failed`);
}

async function ask(question, { hidden = false } = {}) {
  if (AUTO_YES) fail(`--yes given but input needed: ${question}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = hidden
    ? await (async () => {
        process.stdout.write(question);
        // readline has no native hidden input; fall back to visible with a warning
        return rl.question('');
      })()
    : await rl.question(question);
  rl.close();
  return answer.trim();
}

async function confirm(question) {
  if (AUTO_YES) return true;
  const a = await ask(`${question} [y/N] `);
  return a.toLowerCase() === 'y' || a.toLowerCase() === 'yes';
}

/* ── auth + account ──────────────────────────────────────────── */

async function resolveAccount() {
  const { ok, out } = wrangler(['whoami'], { allowFail: true });
  if (!ok || out.includes('You are not authenticated')) {
    fail('Not authenticated. Run `npx wrangler login` or set CLOUDFLARE_API_TOKEN.');
  }
  // whoami renders a table of account name / id rows
  const rows = [...out.matchAll(/│\s*([^│]+?)\s*│\s*([0-9a-f]{32})\s*│/g)].map(m => ({
    name: m[1].trim(),
    id: m[2],
  }));
  if (rows.length === 0) fail('No Cloudflare accounts visible to this auth.');
  let account = rows[0];
  if (rows.length > 1) {
    if (process.env.CLOUDFLARE_ACCOUNT_ID) {
      account = rows.find(r => r.id === process.env.CLOUDFLARE_ACCOUNT_ID) ?? rows[0];
    } else {
      console.log('\nThis auth can access multiple Cloudflare accounts:');
      rows.forEach((r, i) => console.log(`  ${i + 1}. ${r.name} (${r.id})`));
      const pick = Number(await ask('Install into which account? [number] '));
      if (!Number.isInteger(pick) || pick < 1 || pick > rows.length) fail('Invalid choice.');
      account = rows[pick - 1];
    }
  }
  process.env.CLOUDFLARE_ACCOUNT_ID = account.id;
  console.log(`Using account: ${account.name} (${account.id})`);
  return account;
}

/* ── preflight ───────────────────────────────────────────────── */

/**
 * Verify account entitlements before touching anything, so a missing
 * prerequisite fails in seconds with instructions instead of mid-install
 * with a raw API error. Notes on what Traks actually needs:
 *   - Workers, D1, KV, SQLite-backed Durable Objects: free plan is fine
 *   - R2: requires a payment method on file (free tier still costs $0)
 *   - Pipelines + R2 Data Catalog / R2 SQL: beta products — entitlement
 *     can vary by account/plan, so probe them directly
 */
function preflight() {
  step('Preflight: account entitlements');

  const r2 = wrangler(['r2', 'bucket', 'list'], { allowFail: true });
  if (!r2.ok) {
    console.error(r2.out.slice(0, 600));
    fail(
      'R2 is not enabled on this account. Open the Cloudflare dashboard → R2\n' +
        '  and enable it (requires adding a payment method; the free tier bills $0).\n' +
        '  Then re-run the installer.'
    );
  }
  console.log('    ✓ R2 enabled');

  const pipelines = wrangler(['pipelines', 'list'], { allowFail: true });
  if (!pipelines.ok) {
    console.error(pipelines.out.slice(0, 600));
    fail(
      'Cloudflare Pipelines is not available on this account (beta product;\n' +
        '  may require the Workers Paid plan). Check Compute → Pipelines in the\n' +
        '  dashboard, then re-run the installer.'
    );
  }
  console.log('    ✓ Pipelines available');
}

/* ── resource provisioning (idempotent) ──────────────────────── */

function ensureD1() {
  step(`D1 database: ${N.d1}`);
  const dbs = parseJsonArray(wrangler(['d1', 'list', '--json']).out) ?? [];
  let db = dbs.find(d => d.name === N.d1);
  if (!db) {
    wrangler(['d1', 'create', N.d1]);
    db = (parseJsonArray(wrangler(['d1', 'list', '--json']).out) ?? []).find(d => d.name === N.d1);
  } else {
    console.log('    exists — reusing');
  }
  if (!db) fail('Could not create/find D1 database');
  return db.uuid;
}

function ensureKv() {
  step(`KV namespace: ${N.kvTitle}`);
  const namespaces = parseJsonArray(wrangler(['kv', 'namespace', 'list']).out) ?? [];
  let ns = namespaces.find(n => n.title === N.kvTitle);
  if (!ns) {
    wrangler(['kv', 'namespace', 'create', N.kvTitle]);
    ns = (parseJsonArray(wrangler(['kv', 'namespace', 'list']).out) ?? []).find(
      n => n.title === N.kvTitle
    );
  } else {
    console.log('    exists — reusing');
  }
  if (!ns) fail('Could not create/find KV namespace');
  return ns.id;
}

function ensureDataPlatform(catalogToken) {
  step(`R2 bucket + Data Catalog: ${N.bucket}`);
  const created = wrangler(['r2', 'bucket', 'create', N.bucket], { allowFail: true });
  if (!created.ok && !/already exists/i.test(created.out)) {
    console.error(created.out);
    fail('R2 bucket creation failed');
  }
  if (!created.ok) console.log('    exists — reusing');

  const cat = wrangler(['r2', 'bucket', 'catalog', 'enable', N.bucket], { allowFail: true });
  if (!cat.ok && !/already (enabled|active)/i.test(cat.out)) {
    console.error(cat.out);
    fail('Data Catalog enable failed');
  }

  wrangler(
    [
      'r2',
      'bucket',
      'catalog',
      'compaction',
      'enable',
      N.bucket,
      '--target-size',
      '128',
      '--token',
      catalogToken,
    ],
    { allowFail: true }
  );
  wrangler(
    [
      'r2',
      'bucket',
      'catalog',
      'snapshot-expiration',
      'enable',
      N.bucket,
      '--older-than-days',
      '30',
      '--retain-last',
      '5',
      '--token',
      catalogToken,
    ],
    { allowFail: true }
  );

  step(`Pipelines stream → Iceberg sink: ${N.stream} → ${N.sink}`);
  // Check-first idempotency: the beta `create` commands don't fail uniformly
  // on duplicates (e.g. re-creating a sink over an existing catalog table
  // errors with "writing to existing Catalog tables is not yet supported"),
  // so existence via `get` is the reliable signal.
  const schemaFile = path.join(ROOT, 'scripts/pipeline-schema.json');
  if (!wrangler(['pipelines', 'streams', 'get', N.stream], { allowFail: true }).ok) {
    wrangler([
      'pipelines',
      'streams',
      'create',
      N.stream,
      '--schema-file',
      schemaFile,
      '--http-enabled',
      'false',
    ]);
  } else {
    console.log(`    stream exists — reusing`);
  }
  const streamGet = wrangler(['pipelines', 'streams', 'get', N.stream]);
  const streamId = streamGet.out.match(/\b([0-9a-f]{32})\b/)?.[1];
  if (!streamId) fail(`Could not determine stream ID for ${N.stream}`);

  if (!wrangler(['pipelines', 'sinks', 'get', N.sink], { allowFail: true }).ok) {
    wrangler([
      'pipelines',
      'sinks',
      'create',
      N.sink,
      '--type',
      'r2-data-catalog',
      '--bucket',
      N.bucket,
      '--namespace',
      'traks',
      '--table',
      'events',
      '--format',
      'parquet',
      '--compression',
      'zstd',
      '--roll-interval',
      '60',
      '--catalog-token',
      catalogToken,
    ]);
  } else {
    console.log(`    sink exists — reusing`);
  }

  if (!wrangler(['pipelines', 'get', N.pipeline], { allowFail: true }).ok) {
    wrangler([
      'pipelines',
      'create',
      N.pipeline,
      '--sql',
      `INSERT INTO ${N.sink} SELECT * FROM ${N.stream}`,
    ]);
  } else {
    console.log(`    pipeline exists — reusing`);
  }

  return streamId;
}

/* ── config generation ───────────────────────────────────────── */

function writeConfigs({ accountId, d1Id, kvId, streamId, collectUrl }) {
  step('Writing wrangler.selfhost.toml for both workers');
  writeFileSync(
    COLLECT_TOML,
    `# Generated by installer/cli.mjs — do not edit by hand; re-run the installer.
name = "${N.collectWorker}"
main = "src/index.ts"
compatibility_date = "2026-06-01"
compatibility_flags = ["nodejs_compat"]
account_id = "${accountId}"

[[d1_databases]]
binding = "DB"
database_name = "${N.d1}"
database_id = "${d1Id}"
migrations_dir = "../api/src/db/migrations"

[[unsafe.bindings]]
name = "RATE_LIMIT"
type = "ratelimit"
namespace_id = "1001"
simple = { limit = 6000, period = 60 }

[[analytics_engine_datasets]]
binding = "METRICS"
dataset = "${N.aeDataset}"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["SiteLiveStore"]

[[durable_objects.bindings]]
name = "LIVE"
class_name = "SiteLiveStore"

[[pipelines]]
binding = "EVENTS"
stream = "${streamId}"

[vars]
ENVIRONMENT = "production"
`
  );

  writeFileSync(
    API_TOML,
    `# Generated by installer/cli.mjs — do not edit by hand; re-run the installer.
name = "${N.apiWorker}"
main = "src/index.ts"
compatibility_date = "2026-06-01"
compatibility_flags = ["nodejs_compat"]
account_id = "${accountId}"

[[d1_databases]]
binding = "DB"
database_name = "${N.d1}"
database_id = "${d1Id}"
migrations_dir = "src/db/migrations"

[[durable_objects.bindings]]
name = "LIVE"
class_name = "SiteLiveStore"
script_name = "${N.collectWorker}"

[[kv_namespaces]]
binding = "R2SQL_CACHE"
id = "${kvId}"

[triggers]
crons = []

[vars]
ENVIRONMENT = "production"
R2_BUCKET_NAME = "${N.bucket}"
R2_ACCOUNT_ID = "${accountId}"
COLLECT_URL = "${collectUrl}"

[assets]
directory = "../web/dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = ["/api/*"]
`
  );
}

/* ── secrets ─────────────────────────────────────────────────── */

function secretList(configPath) {
  const res = wrangler(['secret', 'list', '--config', configPath], { allowFail: true });
  if (!res.ok) return [];
  return (parseJsonArray(res.out) ?? []).map(s => s.name);
}

function ensureSecret(configPath, name, valueFn) {
  const existing = secretList(configPath);
  if (existing.includes(name)) {
    console.log(`    secret ${name}: exists — keeping`);
    return;
  }
  wrangler(['secret', 'put', name, '--config', configPath], { input: valueFn() });
  console.log(`    secret ${name}: set`);
}

/* ── deploy + smoke ──────────────────────────────────────────── */

function deploy(configPath) {
  const res = wrangler(['deploy', '--config', configPath]);
  const url = res.out.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/)?.[0];
  return url ?? null;
}

/** Freshly deployed workers.dev subdomains can take ~1-2 min to resolve — retry. */
async function smoke(url, path_, expect, { attempts = 7, delayMs = 10_000 } = {}) {
  let last = '';
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${url}${path_}`);
      const body = await res.text();
      if (res.ok && (!expect || body.includes(expect))) {
        console.log(`    ✓ ${url}${path_} → ${res.status}`);
        return true;
      }
      last = `${res.status}`;
    } catch (err) {
      last = err.message;
    }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  console.log(`    ✗ ${url}${path_} → ${last} (after ${attempts} attempts)`);
  return false;
}

/* ── commands ────────────────────────────────────────────────── */

/**
 * Shared provision pipeline — used by both install and update, so a newer
 * repo version whose code needs a new resource creates it on `update` the
 * same way `install` would. Every step is idempotent: existing resources
 * are reused, existing secrets are never overwritten, and a re-run after a
 * mid-install failure simply continues where it left off.
 */
async function provision({ catalogToken }) {
  const account = await resolveAccount();
  preflight();

  const d1Id = ensureD1();
  const kvId = ensureKv();

  let streamId;
  if (catalogToken) {
    streamId = ensureDataPlatform(catalogToken);
  } else {
    // Update without CATALOG_TOKEN: verify the platform exists rather than
    // silently skipping — the token is only needed when a new version adds
    // data-platform resources.
    const res = wrangler(['pipelines', 'streams', 'get', N.stream], { allowFail: true });
    streamId = res.out.match(/\b([0-9a-f]{32})\b/)?.[1];
    if (!streamId) {
      fail(
        `Stream ${N.stream} not found and no CATALOG_TOKEN provided.\n` +
          '  Re-run with CATALOG_TOKEN=<token> so the data platform can be provisioned.'
      );
    }
  }

  // Collect worker must exist before the api worker binds its DO class.
  // First deploy with a placeholder COLLECT_URL, learn the real workers.dev
  // URLs from deploy output, then finalize the api config.
  writeConfigs({ accountId: account.id, d1Id, kvId, streamId, collectUrl: 'pending' });

  step('Applying D1 migrations');
  wrangler(['d1', 'migrations', 'apply', N.d1, '--remote', '--config', API_TOML]);

  step('Building web dashboard');
  sh('yarn', ['workspace', '@traks/web', 'build']);

  step(`Deploying ${N.collectWorker}`);
  const collectUrl = deploy(COLLECT_TOML);
  if (!collectUrl) fail('Could not determine collect worker URL from deploy output');
  console.log(`    ${collectUrl}`);

  writeConfigs({ accountId: account.id, d1Id, kvId, streamId, collectUrl });

  step(`Deploying ${N.apiWorker}`);
  const apiUrl = deploy(API_TOML);
  if (!apiUrl) fail('Could not determine api worker URL from deploy output');
  console.log(`    ${apiUrl}`);

  step('Secrets');
  ensureSecret(API_TOML, 'BETTER_AUTH_SECRET', () => randomBytes(32).toString('hex'));
  if (catalogToken) ensureSecret(API_TOML, 'R2_SQL_TOKEN', () => catalogToken);
  ensureSecret(COLLECT_TOML, 'VISITOR_HASH_SECRET', () => randomBytes(32).toString('hex'));

  step('Smoke tests');
  const ok =
    (await smoke(apiUrl, '/api/health', '"ok"')) &&
    (await smoke(apiUrl, '/api/config', collectUrl)) &&
    (await smoke(apiUrl, '/api/claim-status', 'claimed')) &&
    (await smoke(collectUrl, '/t.js', 'traks'));

  return { apiUrl, collectUrl, ok };
}

async function install() {
  console.log(`Traks installer — instance "${INSTANCE}"`);

  const catalogToken = process.env.CATALOG_TOKEN ?? '';
  if (!catalogToken) {
    fail(
      'CATALOG_TOKEN is required. Create an R2 API token with:\n' +
        '    - Workers R2 SQL Read\n' +
        '    - Workers R2 Data Catalog Write\n' +
        '    - Workers R2 Storage Write\n' +
        '  (dashboard: R2 → Manage API Tokens → Admin Read & Write covers the last two)\n' +
        '  then re-run:  CATALOG_TOKEN=<token> node installer/cli.mjs install'
    );
  }

  const { apiUrl, collectUrl, ok } = await provision({ catalogToken });

  console.log(`
${ok ? '✓ Install complete.' : '⚠ Installed, but some smoke tests failed — run `doctor`.'}

  Dashboard:   ${apiUrl}
               (open it and create your owner account — first sign-up claims the instance)

  Tracking snippet (per site — the dashboard shows it with your real site key):
    <script defer data-site="YOUR_SITE_KEY" src="${collectUrl}/t.js"></script>

  Update later: git pull && node installer/cli.mjs update${INSTANCE !== 'traks' ? ` --instance ${INSTANCE}` : ''}
`);
}

async function update() {
  console.log(`Traks update — instance "${INSTANCE}"`);
  // Same idempotent pipeline as install: existing resources are reused, and
  // any resource a newer version introduces gets created here. CATALOG_TOKEN
  // is only required when the new version adds data-platform resources.
  const { ok } = await provision({ catalogToken: process.env.CATALOG_TOKEN ?? '' });
  console.log(
    ok ? '\n✓ Update complete.' : '\n⚠ Updated, but some smoke tests failed — run `doctor`.'
  );
}

async function doctor() {
  console.log(`Traks doctor — instance "${INSTANCE}"`);
  if (!existsSync(API_TOML)) fail('No generated configs found — run `install` first.');
  await resolveAccount();
  const apiToml = readFileSync(API_TOML, 'utf8');
  const collectUrl = apiToml.match(/COLLECT_URL = "([^"]+)"/)?.[1];
  const apiUrl = collectUrl?.replace(`${N.collectWorker}.`, `${N.apiWorker}.`);

  step('Workers');
  if (apiUrl) {
    await smoke(apiUrl, '/api/health', '"ok"');
    await smoke(apiUrl, '/api/config', collectUrl);
  }
  if (collectUrl) await smoke(collectUrl, '/t.js', 'traks');

  step('D1 migrations');
  const mig = wrangler(['d1', 'migrations', 'list', N.d1, '--remote', '--config', API_TOML], {
    allowFail: true,
  });
  console.log(
    /No migrations to apply/.test(mig.out)
      ? '    ✓ up to date'
      : '    ⚠ pending migrations — run `update`'
  );

  step('Pipeline');
  const stream = wrangler(['pipelines', 'streams', 'get', N.stream], { allowFail: true });
  console.log(stream.ok ? `    ✓ stream ${N.stream} exists` : `    ✗ stream ${N.stream} missing`);
}

/* ── R2 S3 API (bucket emptying) ─────────────────────────────── */
//
// Wrangler has no recursive object delete, and a catalog-enabled bucket
// always holds Iceberg metadata. S3 credentials derive from the Cloudflare
// API token per R2 docs: access_key_id = token ID, secret = SHA-256 of the
// token value — so CATALOG_TOKEN is all destroy needs to leave nothing behind.

const sha256hex = data => createHash('sha256').update(data).digest('hex');
const hmacSha256 = (key, data) => createHmac('sha256', key).update(data).digest();

async function s3Request(accountId, accessKeyId, secret, method, path, query = '') {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const datestamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex('');

  const canonicalQuery = query
    .split('&')
    .filter(Boolean)
    .map(kv => kv.split('=').map(encodeURIComponent).join('='))
    .sort()
    .join('&');
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalPath = path.split('/').map(encodeURIComponent).join('/');
  const canonicalRequest = [
    method,
    canonicalPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${datestamp}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kSigning = hmacSha256(
    hmacSha256(hmacSha256(hmacSha256(`AWS4${secret}`, datestamp), 'auto'), 's3'),
    'aws4_request'
  );
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const res = await fetch(`https://${host}${canonicalPath}${query ? `?${query}` : ''}`, {
    method,
    headers: {
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  });
  return { status: res.status, body: await res.text() };
}

/** Delete every object in the bucket. Returns the count, or throws. */
async function emptyBucket(accountId, catalogToken) {
  // The token's ID doubles as the S3 access key; ask Cloudflare for it.
  const verify = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`,
    { headers: { Authorization: `Bearer ${catalogToken}` } }
  ).then(r => r.json());
  const accessKeyId = verify?.result?.id;
  if (!accessKeyId) throw new Error('could not resolve token ID for S3 access');
  const secret = sha256hex(catalogToken);

  let total = 0;
  for (;;) {
    const list = await s3Request(
      accountId,
      accessKeyId,
      secret,
      'GET',
      `/${N.bucket}`,
      'list-type=2'
    );
    if (list.status !== 200) throw new Error(`list objects failed: ${list.status}`);
    const keys = [...list.body.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m =>
      m[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
    );
    if (keys.length === 0) break;
    for (const key of keys) {
      const del = await s3Request(accountId, accessKeyId, secret, 'DELETE', `/${N.bucket}/${key}`);
      if (![200, 204].includes(del.status)) throw new Error(`delete ${key} failed: ${del.status}`);
      total++;
    }
  }
  return total;
}

async function destroy() {
  if (typeof flag('instance') !== 'string') {
    fail('destroy requires an explicit --instance <name> (refusing to guess).');
  }
  console.log(`This will DELETE workers, database, KV, pipeline, and bucket for "${INSTANCE}".`);
  const typed = AUTO_YES ? INSTANCE : await ask(`Type the instance name to confirm: `);
  if (typed !== INSTANCE) fail('Confirmation did not match.');
  await resolveAccount();

  step('Deleting workers');
  wrangler(['delete', '--config', API_TOML, '--force'], { allowFail: true });
  wrangler(['delete', '--config', COLLECT_TOML, '--force'], { allowFail: true });

  step('Deleting pipeline plumbing');
  wrangler(['pipelines', 'delete', N.pipeline, '--force'], { allowFail: true });
  wrangler(['pipelines', 'sinks', 'delete', N.sink, '--force'], { allowFail: true });
  wrangler(['pipelines', 'streams', 'delete', N.stream, '--force'], { allowFail: true });

  step('Deleting D1 + KV');
  wrangler(['d1', 'delete', N.d1, '-y'], { allowFail: true });
  const list = wrangler(['kv', 'namespace', 'list'], { allowFail: true });
  const ns = (parseJsonArray(list.out) ?? []).find(n => n.title === N.kvTitle);
  if (ns) wrangler(['kv', 'namespace', 'delete', '--namespace-id', ns.id], { allowFail: true });

  step('Emptying + deleting R2 bucket');
  wrangler(['r2', 'bucket', 'catalog', 'disable', N.bucket], { allowFail: true, input: 'y\n' });
  const catalogToken = process.env.CATALOG_TOKEN ?? '';
  if (catalogToken) {
    try {
      const removed = await emptyBucket(process.env.CLOUDFLARE_ACCOUNT_ID, catalogToken);
      console.log(`    emptied ${N.bucket} (${removed} objects)`);
    } catch (err) {
      console.log(`    ⚠ could not empty bucket: ${err.message}`);
    }
  }
  const del = wrangler(['r2', 'bucket', 'delete', N.bucket], { allowFail: true });
  if (!del.ok) {
    console.log(
      `    ⚠ bucket ${N.bucket} not deleted${catalogToken ? '' : ' — re-run destroy with CATALOG_TOKEN set to empty it automatically'}`
    );
  }
  console.log('\n✓ Destroy complete (see warnings above, if any).');
}

/* ── main ────────────────────────────────────────────────────── */

const commands = { install, update, doctor, destroy };
if (!commands[command]) {
  fail(`Unknown command "${command}". Use: install | update | doctor | destroy`);
}
await commands[command]();
