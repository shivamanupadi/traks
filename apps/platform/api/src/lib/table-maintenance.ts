import type { Bindings } from '../types';

/**
 * Iceberg table hygiene for the events table.
 *
 * Every Pipelines commit (one per sink roll, i.e. up to once a minute) and
 * every compaction writes a complete new `*.metadata.json`. Iceberg keeps the
 * superseded copies unless the table opts into deleting them, and each copy
 * lists every retained snapshot - so by default the bucket grows by hundreds
 * of KB per commit, forever (5+ GB in three weeks on a real instance, ~88% of
 * the bucket; the events themselves were ~100 MB).
 *
 * Once a day this:
 *  0. makes sure catalog compaction, snapshot expiration and their stored
 *     credential are in place (see ensureCatalogMaintenance);
 *  1. sets `write.metadata.delete-after-commit.enabled` +
 *     `write.metadata.previous-versions-max` on the table, so every later
 *     commit (the Pipelines writer honours them - verified) deletes the
 *     copy that falls out of the metadata log;
 *  2. deletes the superseded `*.metadata.json` files that predate (1) -
 *     never the current file, anything in its metadata-log, or anything
 *     newer than the oldest of those, and never manifests or data files.
 *
 * Runs inside the instance with its own R2_SQL_TOKEN (the catalog token the
 * wizard installed), so existing installs heal after their next update
 * without being asked for a token again.
 */

/** Bumped when the job gains a step, so updated instances run it at once. */
const KV_DONE = 'maint:v2';
/** S3 continuation token when a backlog spans several runs. */
const KV_CURSOR = 'maint:metadata:cursor';
const DONE_TTL = 24 * 60 * 60;
/** Back-off after a failed run, so a broken credential isn't retried each minute. */
const FAIL_TTL = 60 * 60;
/** List pages (1000 keys each) per run; a larger backlog continues next minute. */
const MAX_PAGES = 10;
const PROPS = {
  'write.metadata.delete-after-commit.enabled': 'true',
  'write.metadata.previous-versions-max': '10',
};

interface TableResponse {
  'metadata-location': string;
  metadata: {
    properties?: Record<string, string>;
    'metadata-log'?: { 'metadata-file': string }[];
  };
}

export async function runTableMaintenance(env: Bindings, table: string): Promise<void> {
  if (!env.R2_SQL_TOKEN || !env.R2_ACCOUNT_ID || !env.R2_BUCKET_NAME) return;
  if (await env.R2SQL_CACHE.get(KV_DONE)) return;
  try {
    const result = await maintain(env, table);
    if (result.complete) {
      await env.R2SQL_CACHE.put(KV_DONE, new Date().toISOString(), { expirationTtl: DONE_TTL });
    }
    console.log(`[maintenance] ${JSON.stringify(result)}`);
  } catch (err) {
    console.error('[maintenance] failed:', err instanceof Error ? err.message : err);
    await env.R2SQL_CACHE.put(KV_DONE, 'failed', { expirationTtl: FAIL_TTL }).catch(() => {});
  }
}

interface MaintenanceConfigs {
  result?: {
    maintenance_config?: {
      compaction?: { state?: string };
      snapshot_expiration?: { state?: string };
    };
    credential_status?: string;
  };
}

/**
 * Catalog-side maintenance: compaction (merges the per-minute files AND the
 * per-commit manifests - without it a table passes R2 SQL's 5000-manifest
 * scan limit within days and 7D/30D stop loading), snapshot expiration, and
 * the stored credential both of them run with. The wizard sets these, but
 * older wizards swallowed failures, so the instance re-checks and repairs.
 * Settings that are already enabled are left as the owner configured them.
 */
async function ensureCatalogMaintenance(
  account: string,
  bucket: string,
  token: string
): Promise<string[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/r2-catalog/${encodeURIComponent(bucket)}`;
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(url + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`r2-catalog ${method} ${path} ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  };
  const { result } = await call<MaintenanceConfigs>('GET', '/maintenance-configs');
  const cfg = result?.maintenance_config ?? {};
  const fixed: string[] = [];
  if (result?.credential_status !== 'present') {
    await call('POST', '/credential', { token });
    fixed.push('credential');
  }
  if (cfg.compaction?.state !== 'enabled') {
    await call('POST', '/maintenance-configs', {
      compaction: { state: 'enabled', target_size_mb: 128 },
    });
    fixed.push('compaction');
  }
  if (cfg.snapshot_expiration?.state !== 'enabled') {
    await call('POST', '/maintenance-configs', {
      snapshot_expiration: { state: 'enabled', max_snapshot_age: '2d', min_snapshots_to_keep: 5 },
    });
    fixed.push('snapshot_expiration');
  }
  return fixed;
}

async function maintain(
  env: Bindings,
  table: string
): Promise<{
  catalogFixed: string[] | string;
  propsSet: boolean;
  deleted: number;
  complete: boolean;
}> {
  const account = env.R2_ACCOUNT_ID;
  const bucket = env.R2_BUCKET_NAME;
  const token = env.R2_SQL_TOKEN;

  // 0. Catalog maintenance. Its own failure (e.g. a hand-made token without
  // catalog edit) is reported, not fatal: metadata pruning still runs.
  const catalogFixed = await ensureCatalogMaintenance(account, bucket, token).catch(
    (err: unknown) => `failed: ${err instanceof Error ? err.message : String(err)}`
  );

  const [namespace, name] = table.split('.');
  const catalog = new Catalog(account, bucket, token);
  const tablePath = await catalog.tablePath(namespace, name);

  // 1. Table properties (idempotent; only commits when something differs).
  let t = await catalog.get<TableResponse>(tablePath);
  const props = t.metadata.properties ?? {};
  const missing = Object.entries(PROPS).filter(([k, v]) => props[k] !== v);
  if (missing.length > 0) {
    await catalog.post(tablePath, {
      requirements: [],
      updates: [{ action: 'set-properties', updates: Object.fromEntries(missing) }],
    });
  }

  // 2. Superseded metadata files.
  const keyOf = (s3: string): string => s3.slice(s3.indexOf(`${bucket}/`) + bucket.length + 1);
  const metaDir = keyOf(t['metadata-location']).replace(/[^/]+$/, '');
  // The directory also holds every manifest, so a big backlog is listed
  // across runs; the cursor carries the position between them.
  const s3 = await R2S3.create(account, token, bucket);
  const cursor = (await env.R2SQL_CACHE.get(KV_CURSOR)) ?? undefined;
  const { keys, next } = await s3.list(metaDir, MAX_PAGES, cursor);
  const candidates = keys.filter(k => k.endsWith('.metadata.json'));

  // Re-read right before deleting: a commit may have landed since step 1.
  t = await catalog.get<TableResponse>(tablePath);
  const keep = new Set([
    keyOf(t['metadata-location']),
    ...(t.metadata['metadata-log'] ?? []).map(e => keyOf(e['metadata-file'])),
  ]);
  const version = (k: string): number => Number(/\/(\d+)-[^/]+$/.exec(k)?.[1] ?? NaN);
  const oldestKept = Math.min(...[...keep].map(version));
  const victims = candidates.filter(
    k => !keep.has(k) && Number.isFinite(version(k)) && version(k) < oldestKept
  );
  await s3.deleteMany(victims);

  if (next) await env.R2SQL_CACHE.put(KV_CURSOR, next, { expirationTtl: DONE_TTL });
  else await env.R2SQL_CACHE.delete(KV_CURSOR);
  return { catalogFixed, propsSet: missing.length > 0, deleted: victims.length, complete: !next };
}

/* ── Iceberg REST catalog ─────────────────────────────────────── */

class Catalog {
  private base: string;
  constructor(
    private account: string,
    private bucket: string,
    private token: string
  ) {
    this.base = `https://catalog.cloudflarestorage.com/${account}/${bucket}`;
  }

  async tablePath(namespace: string, table: string): Promise<string> {
    const cfg = await this.get<{ overrides?: { prefix?: string } }>(
      `/v1/config?warehouse=${this.account}_${this.bucket}`
    );
    const prefix = cfg.overrides?.prefix ? `${encodeURIComponent(cfg.overrides.prefix)}/` : '';
    return `/v1/${prefix}namespaces/${encodeURIComponent(namespace)}/tables/${encodeURIComponent(table)}`;
  }

  get<T>(path: string): Promise<T> {
    return this.call<T>('GET', path);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.call<T>('POST', path, body);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.base + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`catalog ${method} ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
}

/* ── R2 S3 API (SigV4 with token-derived credentials) ─────────── */

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256Hex = async (s: string): Promise<string> =>
  hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const hmac = async (key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> => {
  const k = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
};
/** RFC 3986 encoding as SigV4 canonical query strings require. */
const rfc3986 = (s: string): string =>
  encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const xmlUnescape = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

class R2S3 {
  private constructor(
    private host: string,
    private keyId: string,
    private secret: string,
    private bucket: string
  ) {}

  /** S3 credentials of an API token: key id = token id, secret = sha256(token). */
  static async create(account: string, token: string, bucket: string): Promise<R2S3> {
    for (const url of [
      `https://api.cloudflare.com/client/v4/accounts/${account}/tokens/verify`,
      'https://api.cloudflare.com/client/v4/user/tokens/verify',
    ]) {
      const res = (await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .catch(() => null)) as {
        success?: boolean;
        result?: { id?: string; status?: string };
      } | null;
      if (res?.success && res.result?.status === 'active' && res.result.id) {
        return new R2S3(
          `${account}.r2.cloudflarestorage.com`,
          res.result.id,
          await sha256Hex(token),
          bucket
        );
      }
    }
    throw new Error('R2_SQL_TOKEN is not an active API token');
  }

  /** Up to maxPages of keys from `start`; `next` is set when more remain. */
  async list(
    prefix: string,
    maxPages: number,
    start?: string
  ): Promise<{ keys: string[]; next?: string }> {
    const keys: string[] = [];
    let token = start;
    for (let page = 0; page < maxPages; page++) {
      const params: [string, string][] = [
        ...(token ? [['continuation-token', token] as [string, string]] : []),
        ['list-type', '2'],
        ['prefix', prefix],
      ];
      const query = params.map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`).join('&');
      const res = await this.request('GET', query, '');
      if (!res.ok) throw new Error(`S3 list ${res.status}`);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(xmlUnescape(m[1]));
      token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1];
      if (!/<IsTruncated>true<\/IsTruncated>/.test(xml) || !token) return { keys };
      token = xmlUnescape(token);
    }
    return { keys, next: token };
  }

  async deleteMany(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const xml = `<?xml version="1.0" encoding="UTF-8"?><Delete>${keys
        .slice(i, i + 1000)
        .map(k => `<Object><Key>${xmlEscape(k)}</Key></Object>`)
        .join('')}<Quiet>true</Quiet></Delete>`;
      const res = await this.request('POST', 'delete=', xml);
      const text = await res.text();
      if (!res.ok || text.includes('<Error>')) {
        throw new Error(`S3 delete ${res.status}: ${text.slice(0, 200)}`);
      }
    }
  }

  private async request(method: string, query: string, body: string): Promise<Response> {
    const amzDate = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
    const datestamp = amzDate.slice(0, 8);
    const payloadHash = await sha256Hex(body);
    const path = `/${encodeURIComponent(this.bucket)}/`;
    const headers = `host:${this.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signed = 'host;x-amz-content-sha256;x-amz-date';
    const canonical = [method, path, query, headers, signed, payloadHash].join('\n');
    const scope = `${datestamp}/auto/s3/aws4_request`;
    const sts = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonical)].join('\n');
    let key = await hmac(enc.encode(`AWS4${this.secret}`), datestamp);
    for (const part of ['auto', 's3', 'aws4_request']) key = await hmac(key, part);
    const signature = hex(await hmac(key, sts));
    return fetch(`https://${this.host}${path}?${query}`, {
      method,
      headers: {
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
        Authorization: `AWS4-HMAC-SHA256 Credential=${this.keyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
      },
      body: body || undefined,
    });
  }
}
