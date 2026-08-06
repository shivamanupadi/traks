/**
 * Web-installer provisioning engine.
 *
 * Pure fetch against the Cloudflare REST API — provisions a complete Traks
 * instance into a USER'S account using tokens they supply, which live only
 * for the duration of the request and are never persisted or logged.
 *
 * Artifacts (worker bundles, web assets, migrations, schema) are loaded
 * lazily from the RELEASES R2 bucket; asset hashes are precomputed at
 * release-upload time, so only the files the upload session actually asks
 * for are ever read.
 *
 * Endpoint shapes were mined from wrangler's source and proven end-to-end
 * against real accounts (installer/test-engine.mjs is the local harness).
 */

const API = 'https://api.cloudflare.com/client/v4';

export interface StepEvent {
  stepId: string;
  label: string;
  status: 'start' | 'ok' | 'fail' | 'retry';
  detail?: string;
}

export interface DeployArtifacts {
  apiWorker: () => Promise<Uint8Array>;
  collectWorker: () => Promise<Uint8Array>;
  webAssets: {
    path: string;
    hash: string;
    size: number;
    contentType: string | null;
    getContent: () => Promise<Uint8Array>;
  }[];
  migrations: { name: string; getSql: () => Promise<string> }[];
  schema: { fields: unknown[] };
  /** Release version from manifest.json — stamped on the instance. */
  version?: string;
}

export interface CustomDomain {
  zoneId: string;
  /** Dashboard hostname (e.g. analytics.example.com, or the apex). */
  apiHostname: string;
  /** Collect-worker hostname (e.g. analytics-collect.example.com). */
  collectHostname: string;
}

export interface EngineCtx {
  apiToken: string;
  accountId: string;
  instance: string;
  catalogToken: string;
  artifacts: DeployArtifacts;
  /** Deploy onto one of the account's own domains instead of workers.dev. */
  customDomain?: CustomDomain;
  /** Wizard session id — stamped on the instance so it can link back to
   *  traks.dev/deploy?instance=<id> for updates. */
  deploySessionId?: string;
  randomHex: (bytes: number) => string;
  emit: (e: StepEvent) => void | Promise<void>;
}

interface CfError extends Error {
  status?: number;
  codes?: number[];
}

export function instanceNames(instance: string) {
  const us = instance.replaceAll('-', '_');
  return {
    apiWorker: `${instance}-api`,
    collectWorker: `${instance}-collect`,
    d1: `${instance}-db`,
    kvTitle: `${instance}-r2sql-cache`,
    bucket: `${instance}-events`,
    stream: `${us}_events_stream`,
    sink: `${us}_events_sink`,
    pipeline: `${us}_events`,
    aeDataset: `${us}_collect_metrics`,
  };
}

type Cf = (
  method: string,
  path: string,
  body?: unknown,
  opts?: { jwt?: string; formData?: FormData; tolerate?: number[] }
) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function makeApi(ctx: { apiToken: string }): Cf {
  return async function cf(method, path, body, { jwt, formData, tolerate = [] } = {}) {
    const headers: Record<string, string> = { Authorization: `Bearer ${jwt ?? ctx.apiToken}` };
    let payload: BodyInit | undefined;
    if (formData) {
      payload = formData;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${API}${path}`, { method, headers, body: payload });
    let data: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      data = await res.json();
    } catch {
      /* non-JSON body */
    }
    if (res.ok && data?.success !== false) return data?.result ?? data;
    const errors: { code: number; message: string }[] = data?.errors ?? [
      { code: res.status, message: res.statusText },
    ];
    if (errors.some(e => tolerate.includes(e.code))) return { tolerated: errors[0].code };
    const err = new Error(errors.map(e => `[${e.code}] ${e.message}`).join('; ')) as CfError;
    err.status = res.status;
    err.codes = errors.map(e => e.code);
    throw err;
  };
}

class StepFailure extends Error {
  stepId: string;
  constructor(stepId: string, message: string) {
    super(message);
    this.stepId = stepId;
  }
}

async function step<T>(
  ctx: { emit: EngineCtx['emit'] },
  stepId: string,
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  await ctx.emit({ stepId, label, status: 'start' });
  try {
    const result = await fn();
    await ctx.emit({ stepId, label, status: 'ok' });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Details are persisted to the registry and can carry an entire upstream
    // HTTP body — bound them where they're produced, not only where read.
    await ctx.emit({ stepId, label, status: 'fail', detail: message.slice(0, MAX_DETAIL) });
    throw new StepFailure(stepId, message);
  }
}

/** Cap on a persisted step detail (upstream bodies can be arbitrarily large). */
const MAX_DETAIL = 300;

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

async function withRetry<T>(
  ctx: { emit: EngineCtx['emit'] },
  stepId: string,
  label: string,
  fn: () => Promise<T>,
  {
    attempts = 5,
    delayMs = 20_000,
    transient,
  }: { attempts?: number; delayMs?: number; transient?: (err: CfError) => boolean } = {}
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (raw) {
      const err = raw as CfError;
      const isTransient = transient
        ? transient(err)
        : [429, 500, 502, 503].includes(err.status ?? 0);
      if (!isTransient || attempt >= attempts) throw err;
      await ctx.emit({ stepId, label, status: 'retry', detail: err.message.slice(0, MAX_DETAIL) });
      await sleep(delayMs);
    }
  }
}

function base64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/* ── steps ───────────────────────────────────────────────────── */

async function workersSubdomain(ctx: EngineCtx, cf: Cf): Promise<string> {
  const res = await cf('GET', `/accounts/${ctx.accountId}/workers/subdomain`);
  if (!res?.subdomain) {
    throw new Error(
      'This account has no workers.dev subdomain registered. Open the Cloudflare dashboard → Workers and register one, then retry.'
    );
  }
  return res.subdomain;
}

async function ensureD1(ctx: EngineCtx, cf: Cf, d1Name: string): Promise<string> {
  return step(ctx, 'd1', 'Create D1 database', async () => {
    const list = await cf(
      'GET',
      `/accounts/${ctx.accountId}/d1/database?name=${d1Name}&per_page=100`
    );
    const existing = (Array.isArray(list) ? list : []).find(
      (d: { name: string }) => d.name === d1Name
    );
    if (existing) return existing.uuid as string;
    const created = await cf('POST', `/accounts/${ctx.accountId}/d1/database`, { name: d1Name });
    return created.uuid as string;
  });
}

async function applyMigrations(ctx: EngineCtx, cf: Cf, d1Id: string): Promise<void> {
  await step(ctx, 'db-migrations', 'Apply database migrations', async () => {
    const q = (sql: string): Promise<any> =>
      // eslint-disable-line @typescript-eslint/no-explicit-any
      cf('POST', `/accounts/${ctx.accountId}/d1/database/${d1Id}/query`, { sql });
    await q(
      'CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT current_timestamp);'
    );
    const appliedRes = await q('SELECT name FROM d1_migrations;');
    const applied = new Set<string>(
      (appliedRes?.[0]?.results ?? []).map((r: { name: string }) => r.name)
    );
    for (const m of ctx.artifacts.migrations) {
      if (applied.has(m.name)) continue;
      const sql = await m.getSql();
      for (const stmt of sql.split('--> statement-breakpoint')) {
        const clean = stmt.trim();
        if (clean) await q(clean);
      }
      await q(`INSERT INTO d1_migrations (name) VALUES ('${m.name.replaceAll("'", "''")}');`);
    }
  });
}

async function ensureKv(ctx: EngineCtx, cf: Cf, title: string): Promise<string> {
  return step(ctx, 'kv', 'Create KV cache namespace', async () => {
    let page = 1;
    for (;;) {
      const list = await cf(
        'GET',
        `/accounts/${ctx.accountId}/storage/kv/namespaces?per_page=100&page=${page}`
      );
      const hit = (list ?? []).find((n: { title: string }) => n.title === title);
      if (hit) return hit.id as string;
      if (!list || list.length < 100) break;
      page++;
    }
    const created = await cf('POST', `/accounts/${ctx.accountId}/storage/kv/namespaces`, { title });
    return created.id as string;
  });
}

async function ensureBucketAndCatalog(ctx: EngineCtx, cf: Cf, bucket: string): Promise<void> {
  await step(ctx, 'bucket', 'Create R2 events bucket', async () => {
    await cf(
      'POST',
      `/accounts/${ctx.accountId}/r2/buckets`,
      { name: bucket },
      { tolerate: [10004] }
    );
  });
  await step(ctx, 'catalog', 'Enable R2 Data Catalog', async () => {
    await cf('POST', `/accounts/${ctx.accountId}/r2-catalog/${bucket}/enable`, undefined, {
      tolerate: [40010, 10021],
    });
    await cf(
      'POST',
      `/accounts/${ctx.accountId}/r2-catalog/${bucket}/credential`,
      { token: ctx.catalogToken },
      { tolerate: [10001, 10021, 40010, 7000, 7003] }
    ).catch(() => undefined);
    await cf('POST', `/accounts/${ctx.accountId}/r2-catalog/${bucket}/maintenance-configs`, {
      compaction: { state: 'enabled', targetSizeMb: 128 },
    }).catch(() => undefined);
    await cf('POST', `/accounts/${ctx.accountId}/r2-catalog/${bucket}/maintenance-configs`, {
      snapshot_expiration: { state: 'enabled', max_snapshot_age: '30d', min_snapshots_to_keep: 5 },
    }).catch(() => undefined);
  });
}

/**
 * Drop a table from the bucket's Iceberg REST catalog. The catalog service
 * remembers tables per warehouse (account_bucket) even across bucket
 * delete/recreate, and Pipelines sinks refuse to write to existing tables —
 * so both destroy and reinstall need to be able to clear stale registrations.
 */
async function dropCatalogTable(
  accountId: string,
  bucket: string,
  token: string,
  namespace: string,
  table: string
): Promise<void> {
  const base = `https://catalog.cloudflarestorage.com/${accountId}/${bucket}`;
  const headers = { Authorization: `Bearer ${token}` };
  let prefix = '';
  const cfg = await fetch(`${base}/v1/config?warehouse=${accountId}_${bucket}`, { headers })
    .then(r => (r.ok ? (r.json() as Promise<any>) : null)) // eslint-disable-line @typescript-eslint/no-explicit-any
    .catch(() => null);
  if (cfg?.overrides?.prefix) prefix = `${encodeURIComponent(cfg.overrides.prefix)}/`;
  const res = await fetch(
    `${base}/v1/${prefix}namespaces/${encodeURIComponent(namespace)}/tables/${encodeURIComponent(table)}`,
    { method: 'DELETE', headers }
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `catalog table drop failed (${res.status}: ${await res.text().catch(() => '')})`
    );
  }
}

async function ensurePipeline(
  ctx: EngineCtx,
  cf: Cf,
  N: ReturnType<typeof instanceNames>
): Promise<string> {
  const base = `/accounts/${ctx.accountId}/pipelines/v1`;

  const streamId = await step(ctx, 'stream', 'Create event stream', async () => {
    const list = await cf('GET', `${base}/streams?per_page=100`);
    const hit = (list ?? []).find((st: { name: string }) => st.name === N.stream);
    if (hit) return hit.id as string;
    const created = await cf('POST', `${base}/streams`, {
      name: N.stream,
      format: { type: 'json' },
      schema: { fields: ctx.artifacts.schema.fields },
      http: { enabled: false, authentication: false, cors: {} },
    });
    return created.id as string;
  });

  await step(ctx, 'sink', 'Create Iceberg sink', async () => {
    const list = await cf('GET', `${base}/sinks?per_page=100`);
    const existing = (
      (list ?? []) as { id: string; name: string; config?: Record<string, unknown> }[]
    ).find(sk => sk.name === N.sink);
    if (existing) {
      const cfg = existing.config ?? {};
      if (cfg.namespace === 'traks' && cfg.table_name === 'events') return;
      // Misconfigured sink from an earlier engine bug: table_name held the
      // full "traks.events" with no namespace, so the table landed in the
      // "default" namespace where dashboard queries never find it. Recreate
      // (pipeline first — it references the sink).
      const pipes = await cf('GET', `${base}/pipelines?per_page=100`);
      const pipe = ((pipes ?? []) as { id: string; name: string }[]).find(
        pl => pl.name === N.pipeline
      );
      if (pipe) await cf('DELETE', `${base}/pipelines/${pipe.id}`);
      await cf('DELETE', `${base}/sinks/${existing.id}`);
    }
    const isExistingTable = (err: CfError): boolean =>
      Boolean(err.codes?.includes(1012)) && /existing catalog table/i.test(err.message);
    const createSink = (): Promise<unknown> =>
      cf('POST', `${base}/sinks`, {
        name: N.sink,
        type: 'r2_data_catalog',
        format: { type: 'parquet' },
        config: {
          account_id: ctx.accountId,
          bucket: N.bucket,
          namespace: 'traks',
          table_name: 'events',
          token: ctx.catalogToken,
        },
      });
    await withRetry(
      ctx,
      'sink',
      'Create Iceberg sink',
      async () => {
        try {
          return await createSink();
        } catch (raw) {
          // Reinstall after destroy: the catalog remembered the previous
          // bucket's table — drop the stale registration and try once more.
          if (isExistingTable(raw as CfError)) {
            await dropCatalogTable(ctx.accountId, N.bucket, ctx.catalogToken, 'traks', 'events');
            return createSink();
          }
          throw raw;
        }
      },
      {
        attempts: 6,
        delayMs: 60_000,
        // 1012 also means "catalog not ready yet" on fresh installs — retry
        // that, but not the existing-table flavor (permanent until dropped).
        transient: err =>
          (Boolean(err.codes?.includes(1012)) && !isExistingTable(err)) ||
          [429, 500].includes(err.status ?? 0),
      }
    );
  });

  await step(ctx, 'pipeline', 'Connect stream to sink', async () => {
    const list = await cf('GET', `${base}/pipelines?per_page=100`);
    if ((list ?? []).some((pl: { name: string }) => pl.name === N.pipeline)) return;
    await cf('POST', `${base}/pipelines`, {
      name: N.pipeline,
      sql: `INSERT INTO ${N.sink} SELECT * FROM ${N.stream}`,
    });
  });

  return streamId;
}

async function scriptExists(ctx: EngineCtx, cf: Cf, name: string): Promise<boolean> {
  try {
    await cf('GET', `/accounts/${ctx.accountId}/workers/services/${name}`);
    return true;
  } catch {
    return false;
  }
}

async function uploadWorker(
  ctx: EngineCtx,
  cf: Cf,
  name: string,
  moduleBytes: Uint8Array,
  metadata: Record<string, unknown>
): Promise<void> {
  const fd = new FormData();
  fd.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
    'metadata.json'
  );
  fd.append(
    'worker.js',
    new Blob([moduleBytes as unknown as ArrayBuffer], { type: 'application/javascript+module' }),
    'worker.js'
  );
  await cf('PUT', `/accounts/${ctx.accountId}/workers/scripts/${name}`, undefined, {
    formData: fd,
  });
  await cf('POST', `/accounts/${ctx.accountId}/workers/scripts/${name}/subdomain`, {
    enabled: true,
    previews_enabled: false,
  });
}

async function uploadAssets(ctx: EngineCtx, cf: Cf, apiWorkerName: string): Promise<string> {
  return step(ctx, 'assets', 'Upload dashboard assets', async () => {
    const manifest: Record<string, { hash: string; size: number }> = {};
    const byHash = new Map<string, DeployArtifacts['webAssets'][number]>();
    for (const asset of ctx.artifacts.webAssets) {
      manifest[asset.path] = { hash: asset.hash, size: asset.size };
      byHash.set(asset.hash, asset);
    }
    const session = await cf(
      'POST',
      `/accounts/${ctx.accountId}/workers/scripts/${apiWorkerName}/assets-upload-session`,
      { manifest }
    );
    if (!session?.jwt) throw new Error('assets-upload-session returned no jwt');
    let completionJwt: string = session.buckets?.length ? '' : session.jwt;
    for (const bucket of session.buckets ?? []) {
      const fd = new FormData();
      for (const hash of bucket as string[]) {
        const asset = byHash.get(hash);
        if (!asset) throw new Error(`upload session requested unknown asset hash ${hash}`);
        const content = await asset.getContent();
        fd.append(
          hash,
          new Blob([base64(content)], { type: asset.contentType ?? 'application/null' }),
          hash
        );
      }
      const res = await cf(
        'POST',
        `/accounts/${ctx.accountId}/workers/assets/upload?base64=true`,
        undefined,
        { jwt: session.jwt, formData: fd }
      );
      if (res?.jwt) completionJwt = res.jwt;
    }
    if (!completionJwt) throw new Error('asset upload did not return a completion token');
    return completionJwt;
  });
}

async function ensureSecrets(
  ctx: EngineCtx,
  cf: Cf,
  N: ReturnType<typeof instanceNames>
): Promise<void> {
  await step(ctx, 'secrets', 'Set secrets', async () => {
    const put = (script: string, name: string, text: string): Promise<unknown> =>
      cf('PUT', `/accounts/${ctx.accountId}/workers/scripts/${script}/secrets`, {
        name,
        text,
        type: 'secret_text',
      });
    const existing = async (script: string): Promise<Set<string>> => {
      try {
        const list = await cf(
          'GET',
          `/accounts/${ctx.accountId}/workers/scripts/${script}/secrets`
        );
        return new Set((list ?? []).map((s: { name: string }) => s.name));
      } catch {
        return new Set();
      }
    };
    const apiSecrets = await existing(N.apiWorker);
    if (!apiSecrets.has('BETTER_AUTH_SECRET')) {
      await put(N.apiWorker, 'BETTER_AUTH_SECRET', ctx.randomHex(32));
    }
    if (!apiSecrets.has('R2_SQL_TOKEN')) {
      await put(N.apiWorker, 'R2_SQL_TOKEN', ctx.catalogToken);
    }
    const collectSecrets = await existing(N.collectWorker);
    if (!collectSecrets.has('VISITOR_HASH_SECRET')) {
      await put(N.collectWorker, 'VISITOR_HASH_SECRET', ctx.randomHex(32));
    }
  });
}

/* ── public API ──────────────────────────────────────────────── */

export interface ProvisionResult {
  apiUrl: string;
  collectUrl: string;
}

export async function provisionInstance(ctx: EngineCtx): Promise<ProvisionResult> {
  const cf = makeApi(ctx);
  const N = instanceNames(ctx.instance);

  const subdomain = await step(ctx, 'preflight', 'Check account readiness', () =>
    workersSubdomain(ctx, cf)
  );
  const collectUrl = ctx.customDomain
    ? `https://${ctx.customDomain.collectHostname}`
    : `https://${N.collectWorker}.${subdomain}.workers.dev`;
  const apiUrl = ctx.customDomain
    ? `https://${ctx.customDomain.apiHostname}`
    : `https://${N.apiWorker}.${subdomain}.workers.dev`;

  const d1Id = await ensureD1(ctx, cf, N.d1);
  await applyMigrations(ctx, cf, d1Id);
  const kvId = await ensureKv(ctx, cf, N.kvTitle);
  await ensureBucketAndCatalog(ctx, cf, N.bucket);
  const streamId = await ensurePipeline(ctx, cf, N);

  await step(ctx, 'collect-worker', 'Deploy collect worker', async () => {
    const exists = await scriptExists(ctx, cf, N.collectWorker);
    await uploadWorker(ctx, cf, N.collectWorker, await ctx.artifacts.collectWorker(), {
      main_module: 'worker.js',
      compatibility_date: '2026-06-01',
      compatibility_flags: ['nodejs_compat'],
      bindings: [
        { type: 'd1', name: 'DB', id: d1Id },
        { type: 'analytics_engine', name: 'METRICS', dataset: N.aeDataset },
        {
          type: 'ratelimit',
          name: 'RATE_LIMIT',
          namespace_id: '1001',
          simple: { limit: 6000, period: 60 },
        },
        { type: 'durable_object_namespace', name: 'LIVE', class_name: 'SiteLiveStore' },
        { type: 'pipelines', name: 'EVENTS', stream: streamId },
        { type: 'plain_text', name: 'ENVIRONMENT', text: 'production' },
      ],
      ...(exists ? {} : { migrations: { new_tag: 'v1', new_sqlite_classes: ['SiteLiveStore'] } }),
    });
  });

  const assetsJwt = await uploadAssets(ctx, cf, N.apiWorker);

  // Pin instance ownership to the deploying identity when the token can
  // reveal it (OAuth sign-in). Token-paste installs leave the claim open.
  const ownerEmail = await userEmail(ctx.apiToken);

  await step(ctx, 'api-worker', 'Deploy dashboard worker', async () => {
    await uploadWorker(ctx, cf, N.apiWorker, await ctx.artifacts.apiWorker(), {
      main_module: 'worker.js',
      compatibility_date: '2026-06-01',
      compatibility_flags: ['nodejs_compat'],
      bindings: [
        { type: 'd1', name: 'DB', id: d1Id },
        { type: 'kv_namespace', name: 'R2SQL_CACHE', namespace_id: kvId },
        // Brute-force guard on /api/auth/* — Better Auth's own limiter is
        // in-memory, i.e. per-isolate and therefore absent on Workers.
        {
          type: 'ratelimit',
          name: 'AUTH_LIMIT',
          namespace_id: '1004',
          simple: { limit: 20, period: 60 },
        },
        {
          type: 'durable_object_namespace',
          name: 'LIVE',
          class_name: 'SiteLiveStore',
          script_name: N.collectWorker,
        },
        { type: 'assets', name: 'ASSETS' },
        { type: 'plain_text', name: 'ENVIRONMENT', text: 'production' },
        { type: 'plain_text', name: 'R2_BUCKET_NAME', text: N.bucket },
        { type: 'plain_text', name: 'R2_ACCOUNT_ID', text: ctx.accountId },
        { type: 'plain_text', name: 'COLLECT_URL', text: collectUrl },
        ...(ownerEmail ? [{ type: 'plain_text', name: 'OWNER_EMAIL', text: ownerEmail }] : []),
        ...(ctx.artifacts.version
          ? [{ type: 'plain_text', name: 'TRAKS_VERSION', text: ctx.artifacts.version }]
          : []),
        ...(ctx.deploySessionId
          ? [{ type: 'plain_text', name: 'DEPLOY_INSTANCE_ID', text: ctx.deploySessionId }]
          : []),
      ],
      assets: {
        jwt: assetsJwt,
        config: {
          not_found_handling: 'single-page-application',
          run_worker_first: ['/api/*'],
        },
      },
    });
  });

  await ensureSecrets(ctx, cf, N);

  if (ctx.customDomain) {
    const { zoneId, apiHostname, collectHostname } = ctx.customDomain;
    await step(ctx, 'custom-domain', `Attach ${apiHostname}`, async () => {
      // Same call wrangler makes for `custom_domain = true` routes: Cloudflare
      // creates the DNS record and edge certificate itself. Overrides make
      // re-runs (and re-pointing a stale record) idempotent.
      const attach = (script: string, hostname: string): Promise<unknown> =>
        cf('PUT', `/accounts/${ctx.accountId}/workers/scripts/${script}/domains/records`, {
          override_scope: true,
          override_existing_origin: true,
          override_existing_dns_record: true,
          origins: [{ hostname, zone_id: zoneId }],
        });
      await attach(N.apiWorker, apiHostname);
      await attach(N.collectWorker, collectHostname);
    });
  }

  await step(ctx, 'smoke', 'Verify the deployment', async () => {
    // Custom domains wait on DNS propagation + edge cert issuance (usually
    // well under a minute, occasionally a few).
    const attempts = ctx.customDomain ? 30 : 9;
    const probe = async (url: string, path: string, expect: string): Promise<void> => {
      for (let i = 0; i < attempts; i++) {
        try {
          const res = await fetch(url + path);
          const body = await res.text();
          if (res.ok && body.includes(expect)) return;
        } catch {
          /* retry */
        }
        await sleep(10_000);
      }
      throw new Error(`${url}${path} did not become healthy`);
    };
    await probe(apiUrl, '/api/health', '"ok"');
    await probe(apiUrl, '/api/config', collectUrl);
    await probe(collectUrl, '/t.js', 'traks');
  });

  return { apiUrl, collectUrl };
}

/**
 * The email behind the token, when it can tell us (OAuth sign-in with
 * User Details Read; account-scoped API tokens can't call /user → undefined).
 */
export async function userEmail(apiToken: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${API}/user`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    const data: any = await res.json(); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!res.ok || data?.success === false) return undefined;
    const email = data?.result?.email;
    return typeof email === 'string' && email.includes('@') ? email : undefined;
  } catch {
    return undefined;
  }
}

/* ── S3 helpers (WebCrypto SigV4, token-derived credentials) ──── */

const sha256Hex = async (s: string | Uint8Array): Promise<string> =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        typeof s === 'string' ? new TextEncoder().encode(s) : (s as BufferSource)
      )
    ),
  ]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

const hmacSha256 = async (key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> => {
  const k = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data));
};

/** Resolve the S3 key id for an API token (account tokens, then user tokens). */
async function s3KeyId(accountId: string, token: string): Promise<string> {
  for (const url of [`${API}/accounts/${accountId}/tokens/verify`, `${API}/user/tokens/verify`]) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json() as Promise<any>) // eslint-disable-line @typescript-eslint/no-explicit-any
      .catch(() => null);
    if (res?.success && res.result?.status === 'active') return res.result.id as string;
  }
  throw new Error('storage token is not a valid, active Cloudflare API token');
}

/**
 * Empty an R2 bucket via the S3 API before deletion (R2 refuses to delete
 * non-empty buckets, and the management API has no purge). Batch
 * DeleteObjects (verified to work on R2 without Content-MD5) keeps this to
 * ~2 subrequests per 1000 objects, safely inside Worker limits.
 */
export async function emptyBucket(
  accountId: string,
  token: string,
  bucket: string
): Promise<number> {
  const keyId = await s3KeyId(accountId, token);
  const secret = await sha256Hex(token);
  const host = `${accountId}.r2.cloudflarestorage.com`;

  const signedFetch = async (
    method: string,
    path: string,
    query: string,
    body: string
  ): Promise<Response> => {
    const amzDate = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
    const datestamp = amzDate.slice(0, 8);
    const payloadHash = await sha256Hex(body);
    const canonicalPath = path.split('/').map(encodeURIComponent).join('/');
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [
      method,
      canonicalPath,
      query,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const scope = `${datestamp}/auto/s3/aws4_request`;
    const sts = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');
    let key = await hmacSha256(new TextEncoder().encode(`AWS4${secret}`), datestamp);
    key = await hmacSha256(key, 'auto');
    key = await hmacSha256(key, 's3');
    key = await hmacSha256(key, 'aws4_request');
    const signature = [...new Uint8Array(await hmacSha256(key, sts))]
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return fetch(`https://${host}${canonicalPath}${query ? `?${query}` : ''}`, {
      method,
      headers: {
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
        Authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body: body || undefined,
    });
  };

  const unescapeXml = (s: string): string =>
    s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  const escapeXml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let total = 0;
  for (let round = 0; round < 500; round++) {
    const listRes = await signedFetch('GET', `/${bucket}/`, 'list-type=2', '');
    if (listRes.status === 404) return total; // bucket already gone
    if (!listRes.ok) throw new Error(`bucket list failed (${listRes.status})`);
    const keys = [...(await listRes.text()).matchAll(/<Key>([^<]+)<\/Key>/g)].map(m =>
      unescapeXml(m[1])
    );
    if (keys.length === 0) return total;
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Delete>${keys
      .map(k => `<Object><Key>${escapeXml(k)}</Key></Object>`)
      .join('')}<Quiet>true</Quiet></Delete>`;
    const delRes = await signedFetch('POST', `/${bucket}/`, 'delete=', xml);
    if (!delRes.ok) throw new Error(`bucket purge failed (${delRes.status})`);
    total += keys.length;
  }
  throw new Error('bucket purge did not converge');
}

export interface DestroyCtx {
  apiToken: string;
  accountId: string;
  instance: string;
  emit: (e: StepEvent) => void | Promise<void>;
  /** R2 objects only die via the S3 API — callers that can sign SigV4 supply
   *  an emptier; without one, a non-empty bucket fails its delete. */
  emptyBucket?: (bucket: string) => Promise<void>;
}

/** Tear down everything provisionInstance created. Idempotent — every delete
 *  tolerates already-gone resources, so partial teardowns can be re-run. */
export async function destroyInstance(ctx: DestroyCtx): Promise<void> {
  const cf = makeApi(ctx);
  const N = instanceNames(ctx.instance);
  const base = `/accounts/${ctx.accountId}/pipelines/v1`;
  const gone = [10007, 10000, 7003, 1000]; // not-found flavors

  await step(ctx, 'workers', 'Delete workers', async () => {
    for (const name of [N.apiWorker, N.collectWorker]) {
      await cf(
        'DELETE',
        `/accounts/${ctx.accountId}/workers/scripts/${name}?force=true`,
        undefined,
        { tolerate: gone }
      ).catch(() => {});
    }
  });

  await step(ctx, 'pipeline-teardown', 'Delete pipeline, sink, stream', async () => {
    const del = async (kind: string, name: string): Promise<void> => {
      const list = await cf('GET', `${base}/${kind}?per_page=100`).catch(() => []);
      const hit = ((list ?? []) as { id: string; name: string }[]).find(x => x.name === name);
      if (hit) await cf('DELETE', `${base}/${kind}/${hit.id}`, undefined, { tolerate: gone });
    };
    await del('pipelines', N.pipeline);
    await del('sinks', N.sink);
    await del('streams', N.stream);
  });

  await step(ctx, 'catalog-teardown', 'Disable catalog, empty and delete bucket', async () => {
    // Drop table registrations first (needs the catalog still enabled): the
    // catalog remembers tables per warehouse name even across bucket
    // delete/recreate, which would break a later reinstall under this name.
    // Both the proper table and the misnamespaced one from the old sink bug.
    await dropCatalogTable(ctx.accountId, N.bucket, ctx.apiToken, 'traks', 'events').catch(
      () => {}
    );
    await dropCatalogTable(ctx.accountId, N.bucket, ctx.apiToken, 'default', 'traks.events').catch(
      () => {}
    );
    await cf('POST', `/accounts/${ctx.accountId}/r2-catalog/${N.bucket}/disable`, undefined, {
      tolerate: gone,
    }).catch(() => {});
    if (ctx.emptyBucket) await ctx.emptyBucket(N.bucket);
    await cf('DELETE', `/accounts/${ctx.accountId}/r2/buckets/${N.bucket}`, undefined, {
      tolerate: gone,
    }).catch(() => {});
  });

  await step(ctx, 'storage-teardown', 'Delete database and KV', async () => {
    const list = await cf(
      'GET',
      `/accounts/${ctx.accountId}/d1/database?name=${N.d1}&per_page=100`
    );
    const db = ((Array.isArray(list) ? list : []) as { uuid: string; name: string }[]).find(
      d => d.name === N.d1
    );
    if (db) {
      await cf('DELETE', `/accounts/${ctx.accountId}/d1/database/${db.uuid}`, undefined, {
        tolerate: gone,
      });
    }
    for (let page = 1; ; page++) {
      const kvList = (await cf(
        'GET',
        `/accounts/${ctx.accountId}/storage/kv/namespaces?per_page=100&page=${page}`
      )) as { id: string; title: string }[] | null;
      const kv = (kvList ?? []).find(n => n.title === N.kvTitle);
      if (kv) {
        await cf('DELETE', `/accounts/${ctx.accountId}/storage/kv/namespaces/${kv.id}`, undefined, {
          tolerate: gone,
        });
        break;
      }
      if (!kvList || kvList.length < 100) break;
    }
  });
}

/** List the account's active zones, for the custom-domain picker (token never stored). */
export async function listZones(
  apiToken: string,
  accountId: string
): Promise<{ id: string; name: string }[]> {
  const res = await fetch(`${API}/zones?account.id=${accountId}&status=active&per_page=50`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  const data: any = await res.json().catch(() => null); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!res.ok || data?.success === false) {
    const msg =
      data?.errors?.map((e: { message: string }) => e.message).join('; ') ?? res.statusText;
    throw new Error(msg);
  }
  return (data.result ?? []).map((z: { id: string; name: string }) => ({
    id: z.id,
    name: z.name,
  }));
}

/** List the accounts a token can act on (never stored). */
export async function listAccounts(apiToken: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch(`${API}/accounts?per_page=50`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  const data: any = await res.json().catch(() => null); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!res.ok || data?.success === false) {
    const msg =
      data?.errors?.map((e: { message: string }) => e.message).join('; ') ?? res.statusText;
    throw new Error(msg);
  }
  return (data.result ?? []).map((a: { id: string; name: string }) => ({
    id: a.id,
    name: a.name,
  }));
}

/** Verify the catalog token: valid + active, and R2-storage capable. */
export async function verifyCatalogToken(
  accountId: string,
  token: string
): Promise<{ ok: boolean; reason?: string }> {
  let tokenId: string | undefined;
  for (const url of [`${API}/accounts/${accountId}/tokens/verify`, `${API}/user/tokens/verify`]) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json() as Promise<any>) // eslint-disable-line @typescript-eslint/no-explicit-any
      .catch(() => null);
    if (res?.success && res.result?.status === 'active') {
      tokenId = res.result.id;
      break;
    }
  }
  if (!tokenId) return { ok: false, reason: 'not a valid, active Cloudflare API token' };

  // S3 ListBuckets with credentials derived from the token proves R2 storage access.
  const secretBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const secret = [...new Uint8Array(secretBytes)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const datestamp = amzDate.slice(0, 8);
  const emptyHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array()))]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const hmac = async (key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> => {
    const k = await crypto.subtle.importKey(
      'raw',
      key as BufferSource,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data));
  };
  const sha256hex = async (s: string): Promise<string> =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${emptyHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['GET', '/', '', canonicalHeaders, signedHeaders, emptyHash].join('\n');
  const scope = `${datestamp}/auto/s3/aws4_request`;
  const sts = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256hex(canonicalRequest)].join('\n');
  let key = await hmac(new TextEncoder().encode(`AWS4${secret}`), datestamp);
  key = await hmac(key, 'auto');
  key = await hmac(key, 's3');
  key = await hmac(key, 'aws4_request');
  const signature = [...new Uint8Array(await hmac(key, sts))]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const res = await fetch(`https://${host}/`, {
    headers: {
      'x-amz-date': amzDate,
      'x-amz-content-sha256': emptyHash,
      Authorization: `AWS4-HMAC-SHA256 Credential=${tokenId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  });
  if (res.status !== 200) {
    return { ok: false, reason: `token lacks R2 storage permissions (S3 returned ${res.status})` };
  }
  return { ok: true };
}
