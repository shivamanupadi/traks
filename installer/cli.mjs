#!/usr/bin/env node
/**
 * Traks self-host installer.
 *
 * Provisions a complete Traks deployment into a Cloudflare account and keeps
 * it updated. The resource layer (D1, KV, R2 + Data Catalog, pipeline
 * stream/sink) is managed by OpenTofu/Terraform (installer/terraform/main.tf)
 * — real state, ownership tracking, plan/destroy safety. The app layer
 * (worker builds + deploys, D1 migrations, secrets) stays with wrangler;
 * this CLI orchestrates both.
 *
 *   node installer/cli.mjs install   [--instance <name>] [--yes]
 *   node installer/cli.mjs update    [--instance <name>]
 *   node installer/cli.mjs doctor    [--instance <name>]
 *   node installer/cli.mjs adopt    [--instance <name>]   import an existing
 *                                    (pre-Terraform) instance into state
 *   node installer/cli.mjs destroy   --instance <name>
 *
 * Requirements:
 *   - Node 20+, repo dependencies installed (`yarn install`)
 *   - OpenTofu (`brew install opentofu`) or Terraform on PATH
 *   - Cloudflare auth: `npx wrangler login` (or CLOUDFLARE_API_TOKEN)
 *   - CATALOG_TOKEN env var (install/adopt/destroy): an R2 API token with
 *     "Workers R2 SQL Read" + "Workers R2 Data Catalog Write" + "Workers R2
 *     Storage Write". It becomes the catalog service credential and the
 *     worker's query token.
 *
 * Ownership: every instance is a Terraform workspace with its own state
 * file — destroy removes exactly the resources recorded in that state,
 * never a same-named resource it didn't create. Secrets are never stored
 * in state (wrangler-managed) and are never overwritten on re-runs.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TF_DIR = path.join(ROOT, 'installer/terraform');
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

/** App-layer names (workers stay wrangler-managed; resource names live in main.tf). */
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
function wrangler(wranglerArgs, { input, allowFail = false } = {}) {
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

async function ask(question) {
  if (AUTO_YES) fail(`--yes given but input needed: ${question}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
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

/**
 * Token for the Terraform provider: an explicit CLOUDFLARE_API_TOKEN, or the
 * wrangler OAuth session token (refreshed by the resolveAccount whoami call).
 */
function resolveProviderToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const configDir =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library/Preferences/.wrangler/config')
      : path.join(
          process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
          '.wrangler/config'
        );
  const configPath = path.join(configDir, 'default.toml');
  if (existsSync(configPath)) {
    const m = readFileSync(configPath, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/);
    if (m) return m[1];
  }
  fail('No Cloudflare token for Terraform. Run `npx wrangler login` or set CLOUDFLARE_API_TOKEN.');
}

/* ── terraform (resource layer) ──────────────────────────────── */

let TOFU_BIN = null;

function ensureTofu() {
  for (const bin of ['tofu', 'terraform']) {
    const res = spawnSync(bin, ['version'], { encoding: 'utf8' });
    if (res.status === 0) {
      TOFU_BIN = bin;
      console.log(`    ✓ ${res.stdout.split('\n')[0]}`);
      return;
    }
  }
  fail(
    'OpenTofu (or Terraform) is required but not installed.\n' +
      '  Install with:  brew install opentofu\n' +
      '  (or see https://opentofu.org/docs/intro/install/)'
  );
}

function tofu(tofuArgs, { allowFail = false, capture = false } = {}) {
  const res = spawnSync(TOFU_BIN, tofuArgs, {
    cwd: TF_DIR,
    encoding: 'utf8',
    stdio: capture ? undefined : ['inherit', 'inherit', 'inherit'],
    env: {
      ...process.env,
      CLOUDFLARE_API_TOKEN: resolveProviderToken(),
      TF_VAR_instance: INSTANCE,
      TF_VAR_account_id: process.env.CLOUDFLARE_ACCOUNT_ID,
      TF_VAR_catalog_token: process.env.CATALOG_TOKEN ?? '',
      TF_IN_AUTOMATION: '1',
    },
    maxBuffer: 32 * 1024 * 1024,
  });
  const out = capture ? `${res.stdout ?? ''}${res.stderr ?? ''}` : '';
  if (res.status !== 0 && !allowFail) {
    if (capture) console.error(out);
    fail(`${TOFU_BIN} ${tofuArgs.join(' ')} failed`);
  }
  return { ok: res.status === 0, out };
}

/** init once, one workspace per instance — that workspace's state IS the ownership record. */
function tofuPrepare() {
  if (!existsSync(path.join(TF_DIR, '.terraform'))) {
    tofu(['init', '-input=false'], { capture: true });
  }
  const ws = tofu(['workspace', 'list'], { capture: true });
  if (!ws.out.split('\n').some(l => l.replace('*', '').trim() === INSTANCE)) {
    tofu(['workspace', 'new', INSTANCE], { capture: true });
  }
  tofu(['workspace', 'select', INSTANCE], { capture: true });
}

function tofuOutputs() {
  const res = tofu(['output', '-json'], { capture: true });
  const start = res.out.indexOf('{');
  const parsed = JSON.parse(res.out.slice(start));
  return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, v.value]));
}

/* ── preflight ───────────────────────────────────────────────── */

/**
 * Verify tooling + account entitlements before touching anything. Notes:
 *   - Workers, D1, KV, SQLite-backed Durable Objects: free plan is fine
 *   - R2: requires a payment method on file (free tier still bills $0)
 *   - Pipelines + R2 Data Catalog / R2 SQL: beta — entitlement varies
 */
function preflight() {
  step('Preflight: tooling + account entitlements');
  ensureTofu();

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

/* ── R2 S3 API (bucket emptying) ─────────────────────────────── */
//
// Terraform destroys the bucket resource, but a bucket holding flushed
// Iceberg data can't be deleted until emptied — and neither wrangler nor
// the provider does that. S3 credentials derive from the Cloudflare API
// token per R2 docs: access_key_id = token ID, secret = SHA-256 of the
// token value — so CATALOG_TOKEN is all destroy needs.

const sha256hex = data => createHash('sha256').update(data).digest('hex');
const hmacSha256 = (key, data) => createHmac('sha256', key).update(data).digest();

async function s3Request(accountId, accessKeyId, secret, method, path_, query = '') {
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
  const canonicalPath = path_.split('/').map(encodeURIComponent).join('/');
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

/* ── commands ────────────────────────────────────────────────── */

/**
 * Shared pipeline — used by install and update. `tofu apply` is inherently
 * idempotent (it diffs desired vs actual state), and everything wrangler-side
 * re-checks before acting, so a re-run after any failure just continues.
 */
async function provision({ catalogToken }) {
  const account = await resolveAccount();
  preflight();

  step('Resource layer (tofu apply)');
  tofuPrepare();
  tofu(['apply', '-auto-approve', '-input=false']);
  const outputs = tofuOutputs();
  const { stream_id: streamId, d1_id: d1Id, kv_id: kvId } = outputs;
  if (!streamId || !d1Id || !kvId) fail('Terraform outputs incomplete — check tofu state.');

  // Catalog maintenance policies aren't Terraform resources yet — wrangler.
  if (catalogToken) {
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
  // Same pipeline as install: tofu apply diffs against state (creating any
  // resources a newer version introduces), wrangler-side steps re-check
  // before acting. CATALOG_TOKEN is optional — the sink credential is
  // lifecycle-ignored, and maintenance-policy tweaks are skipped without it.
  const { ok } = await provision({ catalogToken: process.env.CATALOG_TOKEN ?? '' });
  console.log(
    ok ? '\n✓ Update complete.' : '\n⚠ Updated, but some smoke tests failed — run `doctor`.'
  );
}

async function doctor() {
  console.log(`Traks doctor — instance "${INSTANCE}"`);
  if (!existsSync(API_TOML)) fail('No generated configs found — run `install` first.');
  await resolveAccount();
  ensureTofu();
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

  step('Resource layer (tofu plan)');
  tofuPrepare();
  const plan = tofu(['plan', '-detailed-exitcode', '-input=false'], {
    allowFail: true,
    capture: true,
  });
  // -detailed-exitcode: 0 = no drift, 2 = pending changes, 1 = error
  console.log(
    plan.ok
      ? '    ✓ resources match state (no drift)'
      : /Plan:/.test(plan.out)
        ? '    ⚠ resource drift detected — run `update`'
        : '    ✗ plan failed — check tofu state'
  );
}

/**
 * Import a pre-Terraform (wrangler-provisioned) instance into state, so
 * update/destroy can manage it. Read-only against Cloudflare: import only
 * writes local state. Safe to re-run; already-imported resources are skipped.
 */
async function adopt() {
  console.log(`Traks adopt — importing instance "${INSTANCE}" into Terraform state`);
  const account = await resolveAccount();
  ensureTofu();
  tofuPrepare();

  const catalogToken = process.env.CATALOG_TOKEN ?? '';

  // Discover existing resource IDs via wrangler.
  const d1 = (parseJsonArray(wrangler(['d1', 'list', '--json']).out) ?? []).find(
    d => d.name === N.d1
  );
  const kv = (parseJsonArray(wrangler(['kv', 'namespace', 'list']).out) ?? []).find(
    n => n.title === N.kvTitle
  );
  const streamId = wrangler(['pipelines', 'streams', 'get', N.stream], {
    allowFail: true,
  }).out.match(/\b[0-9a-f]{32}\b/)?.[0];
  const sinkId = wrangler(['pipelines', 'sinks', 'get', N.sink], { allowFail: true }).out.match(
    /\b[0-9a-f]{32}\b/
  )?.[0];
  const pipelineId = wrangler(['pipelines', 'get', N.pipeline], { allowFail: true }).out.match(
    /\b[0-9a-f]{32}\b/
  )?.[0];

  const state = tofu(['state', 'list'], { allowFail: true, capture: true }).out;
  const imports = [
    ['cloudflare_r2_bucket.events', `${account.id}/${N.bucket}`],
    ['cloudflare_r2_data_catalog.catalog', `${account.id}/${N.bucket}`],
    d1 && ['cloudflare_d1_database.db', `${account.id}/${d1.uuid}`],
    kv && ['cloudflare_workers_kv_namespace.cache', `${account.id}/${kv.id}`],
    streamId && ['cloudflare_pipeline_stream.events', `${account.id}/${streamId}`],
    sinkId && ['cloudflare_pipeline_sink.events', `${account.id}/${sinkId}`],
    pipelineId && ['cloudflare_pipeline.events', `${account.id}/${pipelineId}`],
  ].filter(Boolean);

  for (const [address, id] of imports) {
    if (state.includes(address)) {
      console.log(`    ${address}: already in state — skipping`);
      continue;
    }
    const res = tofu(
      ['import', '-input=false', `-var=catalog_token=${catalogToken}`, address, id],
      { allowFail: true, capture: true }
    );
    console.log(res.ok ? `    ✓ imported ${address}` : `    ✗ ${address}: import failed`);
    if (!res.ok)
      console.log(
        res.out
          .split('\n')
          .filter(l => /Error/.test(l))
          .join('\n')
      );
  }

  step('Verifying adopted state (tofu plan)');
  const plan = tofu(['plan', '-detailed-exitcode', '-input=false'], {
    allowFail: true,
    capture: true,
  });
  if (plan.ok) {
    console.log('    ✓ state matches reality — instance fully adopted');
  } else if (/Plan:/.test(plan.out)) {
    const summary = plan.out.match(/Plan:[^\n]*/)?.[0];
    console.log(
      `    ⚠ ${summary ?? 'drift detected'} — review with \`tofu plan\` before running update`
    );
  } else {
    console.log('    ✗ plan failed — review tofu state manually');
  }
}

async function destroy() {
  if (typeof flag('instance') !== 'string') {
    fail('destroy requires an explicit --instance <name> (refusing to guess).');
  }
  console.log(`This will DELETE workers, database, KV, pipeline, and bucket for "${INSTANCE}".`);
  const typed = AUTO_YES ? INSTANCE : await ask(`Type the instance name to confirm: `);
  if (typed !== INSTANCE) fail('Confirmation did not match.');
  const account = await resolveAccount();
  ensureTofu();

  step('Deleting workers');
  wrangler(['delete', '--name', N.apiWorker, '--force'], { allowFail: true });
  wrangler(['delete', '--name', N.collectWorker, '--force'], { allowFail: true });

  // Buckets holding flushed Iceberg data can't be deleted until emptied.
  const catalogToken = process.env.CATALOG_TOKEN ?? '';
  if (catalogToken) {
    step('Emptying events bucket');
    try {
      const removed = await emptyBucket(account.id, catalogToken);
      console.log(`    emptied ${N.bucket} (${removed} objects)`);
    } catch (err) {
      console.log(`    ⚠ could not empty bucket: ${err.message}`);
    }
  }

  step('Destroying resource layer (tofu destroy)');
  tofuPrepare();
  const res = tofu(['destroy', '-auto-approve', '-input=false'], { allowFail: true });
  if (!res.ok) {
    fail(
      'tofu destroy failed. If the bucket is non-empty, re-run with CATALOG_TOKEN\n' +
        '  set so it can be emptied first; otherwise inspect with `tofu plan`.'
    );
  }
  console.log('\n✓ Destroy complete.');
}

/* ── main ────────────────────────────────────────────────────── */

const commands = { install, update, doctor, adopt, destroy };
if (!commands[command]) {
  fail(`Unknown command "${command}". Use: install | update | doctor | adopt | destroy`);
}
await commands[command]();
