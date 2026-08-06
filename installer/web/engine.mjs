/**
 * Traks web-installer provisioning engine.
 *
 * Pure-fetch, runtime-agnostic: no wrangler, no terraform, no node APIs —
 * the same module runs in the node test harness and inside the installer
 * Worker that powers traks.dev/deploy. Every Cloudflare interaction is a
 * REST call; endpoint shapes were mined from wrangler's own source.
 *
 * provisionInstance(ctx) drives a full install and reports progress via
 * ctx.emit({ stepId, label, status: 'start'|'ok'|'fail'|'retry', detail? }).
 * destroyInstance(ctx) tears one down. Both are idempotent: list-before-
 * create everywhere, secrets never rotated, safe to re-run after failures.
 *
 * ctx = {
 *   apiToken,        // Cloudflare auth (OAuth access token or API token)
 *   accountId,
 *   instance,        // name prefix, e.g. "traks"
 *   catalogToken,    // R2 token: storage write + catalog write + SQL read
 *   artifacts: {     // provided by the caller (release bundle)
 *     apiWorker,     // string|Uint8Array — bundled api worker.js
 *     collectWorker, // string|Uint8Array — bundled collect worker.js
 *     webAssets,     // [{ path: "/index.html", content: Uint8Array, contentType }]
 *     migrations,    // [{ name: "0000_x.sql", sql }] sorted ascending
 *     schema,        // pipeline-schema.json object ({ fields: [...] })
 *   },
 *   hashAsset,       // (bytes: Uint8Array, extension: string) => 32-hex string (BLAKE3, wrangler-compatible)
 *   randomHex,       // (bytes: number) => hex string (secret generation)
 *   emit,            // progress callback
 * }
 */

const API = 'https://api.cloudflare.com/client/v4';

export function names(instance) {
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

class StepError extends Error {
  constructor(stepId, message) {
    super(message);
    this.stepId = stepId;
  }
}

function makeApi(ctx) {
  return async function cf(method, path, body, { jwt, formData, tolerate = [] } = {}) {
    const headers = { Authorization: `Bearer ${jwt ?? ctx.apiToken}` };
    let payload;
    if (formData) {
      payload = formData; // fetch sets multipart boundary
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${API}${path}`, { method, headers, body: payload });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON body */
    }
    if (res.ok && data?.success !== false) return data?.result ?? data;
    const errors = data?.errors ?? [{ code: res.status, message: res.statusText }];
    if (errors.some(e => tolerate.includes(e.code))) return { tolerated: errors[0].code };
    const err = new Error(errors.map(e => `[${e.code}] ${e.message}`).join('; '));
    err.status = res.status;
    err.codes = errors.map(e => e.code);
    throw err;
  };
}

async function step(ctx, stepId, label, fn) {
  ctx.emit({ stepId, label, status: 'start' });
  try {
    const result = await fn();
    ctx.emit({ stepId, label, status: 'ok' });
    return result;
  } catch (err) {
    ctx.emit({ stepId, label, status: 'fail', detail: err.message });
    throw new StepError(stepId, err.message);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Retry helper for Cloudflare-side transients (rate limits, catalog propagation). */
async function withRetry(ctx, stepId, label, fn, { attempts = 5, delayMs = 20_000, transient } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isTransient = transient ? transient(err) : [429, 500, 502, 503].includes(err.status);
      if (!isTransient || attempt >= attempts) throw err;
      ctx.emit({ stepId, label, status: 'retry', detail: err.message });
      await sleep(delayMs);
    }
  }
}

const enc = new TextEncoder();
const toBytes = v => (typeof v === 'string' ? enc.encode(v) : v);

function base64(bytes) {
  // chunked to stay under argument limits for large assets
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/* ── resource steps ──────────────────────────────────────────── */

async function ensureD1(ctx, cf, N) {
  return step(ctx, 'd1', 'Create D1 database', async () => {
    const list = await cf('GET', `/accounts/${ctx.accountId}/d1/database?name=${N.d1}&per_page=100`);
    const existing = (Array.isArray(list) ? list : []).find(d => d.name === N.d1);
    if (existing) return existing.uuid;
    const created = await cf('POST', `/accounts/${ctx.accountId}/d1/database`, { name: N.d1 });
    return created.uuid;
  });
}

async function applyMigrations(ctx, cf, N, d1Id) {
  return step(ctx, 'migrations', 'Apply database migrations', async () => {
    const q = sql =>
      cf('POST', `/accounts/${ctx.accountId}/d1/database/${d1Id}/query`, { sql });
    await q(
      'CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT current_timestamp);'
    );
    const appliedRes = await q('SELECT name FROM d1_migrations;');
    const applied = new Set(
      (appliedRes?.[0]?.results ?? []).map(r => r.name)
    );
    let ran = 0;
    for (const m of ctx.artifacts.migrations) {
      if (applied.has(m.name)) continue;
      // drizzle emits "--> statement-breakpoint" between statements; the D1
      // query endpoint wants one statement batch per call.
      for (const stmt of m.sql.split('--> statement-breakpoint')) {
        const clean = stmt.trim();
        if (clean) await q(clean);
      }
      await q(`INSERT INTO d1_migrations (name) VALUES ('${m.name.replaceAll("'", "''")}');`);
      ran++;
    }
    return ran;
  });
}

async function ensureKv(ctx, cf, N) {
  return step(ctx, 'kv', 'Create KV cache namespace', async () => {
    let page = 1;
    for (;;) {
      const list = await cf(
        'GET',
        `/accounts/${ctx.accountId}/storage/kv/namespaces?per_page=100&page=${page}`
      );
      const hit = (list ?? []).find(n => n.title === N.kvTitle);
      if (hit) return hit.id;
      if (!list || list.length < 100) break;
      page++;
    }
    const created = await cf('POST', `/accounts/${ctx.accountId}/storage/kv/namespaces`, {
      title: N.kvTitle,
    });
    return created.id;
  });
}

async function ensureBucketAndCatalog(ctx, cf, N) {
  await step(ctx, 'bucket', 'Create R2 events bucket', async () => {
    // 10004: bucket already exists
    await cf('POST', `/accounts/${ctx.accountId}/r2/buckets`, { name: N.bucket }, { tolerate: [10004] });
  });
  await step(ctx, 'catalog', 'Enable R2 Data Catalog', async () => {
    // 40010: catalog already enabled (observed); tolerate idempotent re-enable
    await cf('POST', `/accounts/${ctx.accountId}/r2-catalog/${N.bucket}/enable`, undefined, {
      tolerate: [40010, 10021],
    });
    // Store the service credential + maintenance policies; best-effort — the
    // sink carries its own token, these govern background compaction.
    await cf(
      'POST',
      `/accounts/${ctx.accountId}/r2-catalog/${N.bucket}/credential`,
      { token: ctx.catalogToken },
      { tolerate: [10001, 10021, 40010, 7000, 7003] }
    ).catch(() => {});
    await cf(
      'POST',
      `/accounts/${ctx.accountId}/r2-catalog/${N.bucket}/maintenance-configs`,
      { compaction: { state: 'enabled', targetSizeMb: 128 } }
    ).catch(() => {});
    await cf(
      'POST',
      `/accounts/${ctx.accountId}/r2-catalog/${N.bucket}/maintenance-configs`,
      { snapshot_expiration: { state: 'enabled', max_snapshot_age: '30d', min_snapshots_to_keep: 5 } }
    ).catch(() => {});
  });
}

async function ensurePipeline(ctx, cf, N) {
  const base = `/accounts/${ctx.accountId}/pipelines/v1`;

  const streamId = await step(ctx, 'stream', 'Create event stream', async () => {
    const list = await cf('GET', `${base}/streams?per_page=100`);
    const hit = (list ?? []).find(st => st.name === N.stream);
    if (hit) return hit.id;
    const created = await cf('POST', `${base}/streams`, {
      name: N.stream,
      format: { type: 'json' },
      schema: { fields: ctx.artifacts.schema.fields },
      http: { enabled: false, authentication: false, cors: {} },
    });
    return created.id;
  });

  const sinkId = await step(ctx, 'sink', 'Create Iceberg sink', async () => {
    const list = await cf('GET', `${base}/sinks?per_page=100`);
    const hit = (list ?? []).find(sk => sk.name === N.sink);
    if (hit) return hit.id;
    const create = () =>
      cf('POST', `${base}/sinks`, {
        name: N.sink,
        type: 'r2_data_catalog',
        format: { type: 'parquet' },
        config: {
          account_id: ctx.accountId,
          bucket: N.bucket,
          table_name: 'traks.events',
          token: ctx.catalogToken,
        },
      });
    // 1012: catalog still releasing a previous same-name instance's table
    const created = await withRetry(ctx, 'sink', 'Create Iceberg sink', create, {
      attempts: 6,
      delayMs: 60_000,
      transient: err => err.codes?.includes(1012) || [429, 500].includes(err.status),
    });
    return created.id;
  });

  await step(ctx, 'pipeline', 'Connect stream to sink', async () => {
    const list = await cf('GET', `${base}/pipelines?per_page=100`);
    if ((list ?? []).some(pl => pl.name === N.pipeline)) return;
    await cf('POST', `${base}/pipelines`, {
      name: N.pipeline,
      sql: `INSERT INTO ${N.sink} SELECT * FROM ${N.stream}`,
    });
  });

  return { streamId, sinkId };
}

/* ── workers ─────────────────────────────────────────────────── */

async function workersSubdomain(ctx, cf) {
  const res = await cf('GET', `/accounts/${ctx.accountId}/workers/subdomain`);
  if (!res?.subdomain) {
    throw new Error(
      'This account has no workers.dev subdomain registered. Open the Cloudflare dashboard → Workers and register one, then retry.'
    );
  }
  return res.subdomain;
}

async function scriptExists(ctx, cf, name) {
  try {
    await cf('GET', `/accounts/${ctx.accountId}/workers/services/${name}`);
    return true;
  } catch {
    return false;
  }
}

async function uploadWorker(ctx, cf, name, moduleBytes, metadata) {
  const fd = new FormData();
  fd.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
    'metadata.json'
  );
  fd.append(
    'worker.js',
    new Blob([toBytes(moduleBytes)], { type: 'application/javascript+module' }),
    'worker.js'
  );
  await cf('PUT', `/accounts/${ctx.accountId}/workers/scripts/${name}`, undefined, {
    formData: fd,
  });
  // enable workers.dev route
  await cf('POST', `/accounts/${ctx.accountId}/workers/scripts/${name}/subdomain`, {
    enabled: true,
    previews_enabled: false,
  });
}

async function deployCollect(ctx, cf, N, d1Id, streamId) {
  return step(ctx, 'collect-worker', 'Deploy collect worker', async () => {
    const exists = await scriptExists(ctx, cf, N.collectWorker);
    const metadata = {
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
    };
    await uploadWorker(ctx, cf, N.collectWorker, ctx.artifacts.collectWorker, metadata);
  });
}

async function uploadAssets(ctx, cf, N) {
  return step(ctx, 'assets', 'Upload dashboard assets', async () => {
    const manifest = {};
    const byHash = new Map();
    for (const asset of ctx.artifacts.webAssets) {
      const ext = asset.path.includes('.') ? asset.path.split('.').pop() : '';
      const hash = ctx.hashAsset(asset.content, ext);
      manifest[asset.path] = { hash, size: asset.content.length };
      byHash.set(hash, asset);
    }
    const session = await cf(
      'POST',
      `/accounts/${ctx.accountId}/workers/scripts/${N.apiWorker}/assets-upload-session`,
      { manifest }
    );
    if (!session?.jwt) throw new Error('assets-upload-session returned no jwt');
    let completionJwt = session.buckets?.length ? '' : session.jwt;
    for (const bucket of session.buckets ?? []) {
      const fd = new FormData();
      for (const hash of bucket) {
        const asset = byHash.get(hash);
        fd.append(
          hash,
          new Blob([base64(toBytes(asset.content))], {
            type: asset.contentType ?? 'application/null',
          }),
          hash
        );
      }
      const res = await cf('POST', `/accounts/${ctx.accountId}/workers/assets/upload?base64=true`, undefined, {
        jwt: session.jwt,
        formData: fd,
      });
      if (res?.jwt) completionJwt = res.jwt;
    }
    if (!completionJwt) throw new Error('asset upload did not return a completion token');
    return completionJwt;
  });
}

async function deployApi(ctx, cf, N, { d1Id, kvId, collectUrl, assetsJwt }) {
  return step(ctx, 'api-worker', 'Deploy dashboard worker', async () => {
    const metadata = {
      main_module: 'worker.js',
      compatibility_date: '2026-06-01',
      compatibility_flags: ['nodejs_compat'],
      bindings: [
        { type: 'd1', name: 'DB', id: d1Id },
        { type: 'kv_namespace', name: 'R2SQL_CACHE', namespace_id: kvId },
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
      ],
      assets: {
        jwt: assetsJwt,
        config: {
          not_found_handling: 'single-page-application',
          run_worker_first: ['/api/*'],
        },
      },
    };
    await uploadWorker(ctx, cf, N.apiWorker, ctx.artifacts.apiWorker, metadata);
  });
}

async function ensureSecrets(ctx, cf, N) {
  return step(ctx, 'secrets', 'Set secrets', async () => {
    const put = (script, name, text) =>
      cf('PUT', `/accounts/${ctx.accountId}/workers/scripts/${script}/secrets`, {
        name,
        text,
        type: 'secret_text',
      });
    const existing = async script => {
      try {
        const list = await cf('GET', `/accounts/${ctx.accountId}/workers/scripts/${script}/secrets`);
        return new Set((list ?? []).map(s => s.name));
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

async function smoke(ctx, apiUrl, collectUrl) {
  return step(ctx, 'smoke', 'Verify the deployment', async () => {
    const probe = async (url, path, expect) => {
      for (let i = 0; i < 9; i++) {
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
}

/* ── public API ──────────────────────────────────────────────── */

export async function provisionInstance(ctx) {
  const cf = makeApi(ctx);
  const N = names(ctx.instance);

  const subdomain = await step(ctx, 'preflight', 'Check account readiness', () =>
    workersSubdomain(ctx, cf)
  );
  const collectUrl = `https://${N.collectWorker}.${subdomain}.workers.dev`;
  const apiUrl = `https://${N.apiWorker}.${subdomain}.workers.dev`;

  const d1Id = await ensureD1(ctx, cf, N);
  await applyMigrations(ctx, cf, N, d1Id);
  const kvId = await ensureKv(ctx, cf, N);
  await ensureBucketAndCatalog(ctx, cf, N);
  const { streamId } = await ensurePipeline(ctx, cf, N);
  await deployCollect(ctx, cf, N, d1Id, streamId);
  const assetsJwt = await uploadAssets(ctx, cf, N);
  await deployApi(ctx, cf, N, { d1Id, kvId, collectUrl, assetsJwt });
  await ensureSecrets(ctx, cf, N);
  await smoke(ctx, apiUrl, collectUrl);

  return { apiUrl, collectUrl, d1Id, kvId, streamId };
}

export async function destroyInstance(ctx) {
  const cf = makeApi(ctx);
  const N = names(ctx.instance);
  const base = `/accounts/${ctx.accountId}/pipelines/v1`;
  const gone = [10007, 10000, 7003, 1000]; // not-found flavors

  await step(ctx, 'workers', 'Delete workers', async () => {
    for (const name of [N.apiWorker, N.collectWorker]) {
      await cf('DELETE', `/accounts/${ctx.accountId}/workers/scripts/${name}?force=true`, undefined, {
        tolerate: gone,
      }).catch(() => {});
    }
  });

  await step(ctx, 'pipeline-teardown', 'Delete pipeline, sink, stream', async () => {
    const del = async (kind, name) => {
      const list = await cf('GET', `${base}/${kind}?per_page=100`).catch(() => []);
      const hit = (list ?? []).find(x => x.name === name);
      if (hit) await cf('DELETE', `${base}/${kind}/${hit.id}`, undefined, { tolerate: gone });
    };
    await del('pipelines', N.pipeline);
    await del('sinks', N.sink);
    await del('streams', N.stream);
  });

  await step(ctx, 'catalog-teardown', 'Disable catalog, empty and delete bucket', async () => {
    await cf('POST', `/accounts/${ctx.accountId}/r2-catalog/${N.bucket}/disable`, undefined, {
      tolerate: gone,
    }).catch(() => {});
    // R2 objects use the S3 API; the caller supplies an emptier when needed.
    if (ctx.emptyBucket) await ctx.emptyBucket(N.bucket);
    await cf('DELETE', `/accounts/${ctx.accountId}/r2/buckets/${N.bucket}`, undefined, {
      tolerate: gone,
    }).catch(() => {});
  });

  await step(ctx, 'storage-teardown', 'Delete database and KV', async () => {
    const list = await cf('GET', `/accounts/${ctx.accountId}/d1/database?name=${N.d1}&per_page=100`);
    const db = (Array.isArray(list) ? list : []).find(d => d.name === N.d1);
    if (db) await cf('DELETE', `/accounts/${ctx.accountId}/d1/database/${db.uuid}`, undefined, { tolerate: gone });
    let page = 1;
    for (;;) {
      const kvList = await cf('GET', `/accounts/${ctx.accountId}/storage/kv/namespaces?per_page=100&page=${page}`);
      const kv = (kvList ?? []).find(n => n.title === N.kvTitle);
      if (kv) {
        await cf('DELETE', `/accounts/${ctx.accountId}/storage/kv/namespaces/${kv.id}`, undefined, { tolerate: gone });
        break;
      }
      if (!kvList || kvList.length < 100) break;
      page++;
    }
  });
}
