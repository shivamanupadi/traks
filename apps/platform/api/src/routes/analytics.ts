import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { validate } from '../lib/validate';
import { eq, and, inArray } from 'drizzle-orm';
import {
  PERIODS,
  AUTO_EVENTS,
  TABLE_PROD,
  TABLE_DEV,
  R2SqlError,
  resolvePeriod,
  previousRange,
  type Period,
  type PeriodRange,
  type LiveStoreApi,
  type LiveTotals,
  type LiveFilters,
  type LiveRealtimeLocation,
  toLiveFilters,
} from '@traks/shared';
import { requireAuth } from '../middleware/auth';
import { cacheTtlSeconds } from '../lib/cache-ttl';
import { noteSiteView, INTERNAL_HEADER, getInternalToken } from '../lib/prewarm';
import { siteAccessFilter } from '../lib/workspaces';
import { sites, goals, funnels } from '../db/schema';
import type { BreakdownDim, BreakdownRow } from '../lib/queries';
import {
  queryR2SqlWithStats,
  buildBreakdownsQuery,
  isMissingIngestTs,
  setIngestPrune,
  isIngestPrune,
  buildStatsWithComparisonQuery,
  buildSessionStatsQuery,
  buildBatchStatsQuery,
  buildTimeseriesQuery,
  buildTopPagesQuery,
  buildEntryExitPagesQuery,
  buildLinkEventsQuery,
  buildTopReferrersQuery,
  buildAiSourcesQuery,
  buildUtmQuery,
  buildLocationsQuery,
  buildDevicesQuery,
  buildScreenSizesQuery,
  buildEventMetaQuery,
  buildRealtimeTotalQuery,
  buildRealtimeQuery,
  buildEventsQuery,
  buildEngagementStatsQuery,
  buildGoalEventsQuery,
  buildGoalPagesQuery,
  buildGoalEventPropQuery,
  buildGoalPagePrefixQuery,
  isPagePrefix,
  buildFunnelQuery,
} from '../lib/queries';
import type { Bindings, Variables } from '../types';

type Env = { Bindings: Bindings; Variables: Variables };
type AppContext = Context<Env>;

const app = new Hono<Env>();

interface SiteRecord {
  siteId: string;
  timezone: string;
}

/**
 * Site lookup scoped to what the caller may access. Deliberately NOT memoized:
 * the row this returns doubles as the authorization decision, and an
 * isolate-local cache would keep answering for a user whose membership was
 * just revoked (no cross-isolate invalidation exists) and would serve a stale
 * timezone after a settings change. It is one indexed D1 read, negligible
 * beside the R2 SQL scan every caller goes on to make.
 */
async function getSite(c: AppContext, siteId: string, userId: string): Promise<SiteRecord | null> {
  const db = c.get('db')!;
  const [result] = await db
    .select({ siteId: sites.id, timezone: sites.timezone })
    .from(sites)
    .where(and(eq(sites.id, siteId), siteAccessFilter(db, userId, c.get('tokenWorkspaceId'))))
    .limit(1);

  if (result) noteSiteView(c.env, c.executionCtx, result.siteId, c.req.query());
  return result ?? null;
}

function getQueryConfig(c: AppContext): {
  accountId: string;
  bucketName: string;
  apiToken: string;
  table: string;
} {
  return {
    accountId: c.env.R2_ACCOUNT_ID,
    bucketName: c.env.R2_BUCKET_NAME,
    apiToken: c.env.R2_SQL_TOKEN,
    table: c.env.ENVIRONMENT === 'production' ? TABLE_PROD : TABLE_DEV,
  };
}

// ============ R2 SQL result caching ============
//
// Each R2 SQL query is a distributed scan over Parquet in R2 - typically
// 0.5-3s and (once billing lands) a 10 MB minimum charge. Table freshness is
// bounded by the sink roll interval (>= 60s), so briefly caching results hides
// no data and turns repeat dashboard loads / polls into cache hits.

/** How far 'today' funnel windows trail real time, covering the Iceberg
 *  sink's ~60s roll so a window is only queried once fully written. */
const FUNNEL_SINK_LAG_MS = 90_000;

/**
 * `now` quantized to the period's cache TTL. Query builders embed `now` in the
 * SQL text, and the SQL text IS the cache key - so quantizing any finer than
 * the TTL would mint a new key every tick and make the cache unreachable
 * (every dashboard tile re-scanning R2 on a timer). Windows shift by at most
 * one TTL, which is far below the sink's roll interval anyway.
 */
function queryTime(period: Period = 'today'): Date {
  const quantum = cacheTtlSeconds(period) * 1000;
  return new Date(Math.floor(Date.now() / quantum) * quantum);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * How long a KV entry outlives its logical freshness. Past `fetchedAt +
 * ttlSeconds` the rows are stale but still returned instantly while a refresh
 * runs behind the response - without this, every TTL boundary handed the next
 * viewer a full cold scan (0.5-3s per query, up to nine of them in parallel).
 */
const STALE_GRACE_SECONDS = 24 * 60 * 60;

interface CachedPayload<T> {
  rows: T[];
  fetchedAt: number;
}

/**
 * Entries written before results carried a timestamp are bare arrays. Treat
 * them as infinitely stale so they are served once and immediately refreshed
 * into the new shape - without this, the deploy that ships this code would
 * read `.rows` off an array and hand every dashboard `undefined`.
 */
function asPayload<T>(parsed: unknown): CachedPayload<T> {
  if (Array.isArray(parsed)) return { rows: parsed as T[], fetchedAt: 0 };
  return parsed as CachedPayload<T>;
}

/**
 * Coalesces identical in-flight scans within one isolate. Two panels are built
 * to emit byte-identical SQL precisely so they share a cache entry, but they
 * fire in the same tick - without this both miss and both pay for the scan.
 */
const inFlightScans = new Map<string, Promise<unknown[]>>();

/**
 * queryR2Sql behind three cache layers: the per-colo Workers Cache API
 * (fastest, free), a KV namespace (global - a scan any colo already paid for
 * is reused worldwide), and an isolate-local in-flight map that stops
 * concurrent duplicates. KV reads/writes are wrapped so a KV outage degrades
 * to per-colo behavior instead of failing the request. Results are served
 * stale-while-revalidate: freshness is bounded by ttlSeconds, but a viewer
 * never waits for a scan when any usable copy exists.
 */
/**
 * One telemetry row per cache decision. `outcome` is colo-hit | kv-hit |
 * kv-stale (served stale, refreshed behind) | scan (viewer waited) |
 * scan-bg (background refresh) | error. Doubles: wall ms, rows, SQL bytes,
 * 1 when the ingest-ts partition predicate was active. Cheap enough to log
 * hits too - that is what gives the cache-hit ratio.
 */
function recordQueryMetric(
  c: AppContext,
  outcome: string,
  ms: number,
  rows: number,
  sqlBytes: number
): void {
  const kind = (c.req.routePath || c.req.path).replace(/^\/api\/sites\/:[^/]+\/?/, '') || 'root';
  const period = c.req.query('period') ?? '';
  const site = c.req.param('siteId') ?? '';
  try {
    c.env.METRICS?.writeDataPoint({
      blobs: [kind, period, outcome, c.env.TRAKS_VERSION ?? ''],
      doubles: [ms, rows, sqlBytes, isIngestPrune() ? 1 : 0],
      indexes: [site.slice(0, 96)],
    });
  } catch {
    /* telemetry must never fail a request */
  }
  if (outcome === 'scan' || outcome === 'scan-bg' || outcome === 'error') {
    console.log(
      `[r2sql] kind=${kind} period=${period} outcome=${outcome} ms=${ms} rows=${rows} prune=${isIngestPrune() ? 1 : 0}`
    );
  }
}

async function cachedR2Sql<T = Record<string, unknown>>(
  c: AppContext,
  ttlSeconds: number,
  buildQuery: (table: string) => string
): Promise<T[]> {
  const config = getQueryConfig(c);
  const sql = buildQuery(config.table);
  const key = await sha256Hex(`${config.bucketName}|${sql}`);
  const cacheKey = new Request(`https://r2sql-cache.traks.internal/${key}`);
  // Cast: the web app type-checks this file through the Hono RPC AppType
  // import under DOM lib types, where CacheStorage has no `default`.
  const cache = (caches as unknown as { default: Cache }).default;

  /**
   * Execute with the partition predicate; if this instance's table has no
   * `__ingest_ts` column the executor reports it, we disable the predicate
   * for the isolate and rebuild the SQL once without it.
   */
  const execute = async (): Promise<{ rows: T[]; ms: number }> => {
    const started = Date.now();
    try {
      return await queryR2SqlWithStats<T>(config, () => sql);
    } catch (err) {
      if (isMissingIngestTs(err) && isIngestPrune()) {
        setIngestPrune(false);
        console.warn('[r2sql] table has no __ingest_ts column; partition predicate disabled');
        const retry = await queryR2SqlWithStats<T>(config, buildQuery);
        return { rows: retry.rows, ms: Date.now() - started };
      }
      throw err;
    }
  };

  /** Run the scan once per key per isolate and populate both caches. */
  const runScan = (background = false): Promise<T[]> => {
    const existing = inFlightScans.get(key);
    if (existing) return existing as Promise<T[]>;

    const p = execute()
      .then(({ rows, ms }) => {
        recordQueryMetric(c, background ? 'scan-bg' : 'scan', ms, rows.length, sql.length);
        return rows;
      })
      .catch(err => {
        recordQueryMetric(c, 'error', 0, 0, sql.length);
        throw err;
      })
      .then(rows => {
        const payload: CachedPayload<T> = { rows, fetchedAt: Date.now() };
        const body = JSON.stringify(payload);
        c.executionCtx.waitUntil(
          Promise.all([
            cache.put(
              cacheKey,
              new Response(body, {
                headers: {
                  'Content-Type': 'application/json',
                  // The colo copy expires at the logical TTL; KV holds the
                  // stale copy that makes revalidation invisible.
                  'Cache-Control': `public, max-age=${ttlSeconds}`,
                },
              })
            ),
            // KV's minimum TTL is 60s. Sub-minute results (realtime) would be
            // served well past their intended freshness, so they stay
            // per-colo only.
            ttlSeconds >= 60
              ? c.env.R2SQL_CACHE.put(key, body, {
                  expirationTtl: ttlSeconds + STALE_GRACE_SECONDS,
                }).catch(err => console.error('[analytics] KV cache put failed:', err))
              : Promise.resolve(),
          ])
        );
        return rows;
      })
      .finally(() => inFlightScans.delete(key));

    if (inFlightScans.size > 500) inFlightScans.clear();
    inFlightScans.set(key, p as Promise<unknown[]>);
    return p;
  };

  const hit = await cache.match(cacheKey);
  if (hit) {
    const payload = asPayload<T>(await hit.json());
    // Colo entries expire at the logical TTL, so a hit here is always fresh
    // - except a legacy bare-array entry, which is refreshed in the
    // background rather than blocking this request.
    if (payload.fetchedAt === 0) c.executionCtx.waitUntil(runScan(true).then(() => undefined));
    recordQueryMetric(c, 'colo-hit', 0, payload.rows.length, sql.length);
    return payload.rows;
  }

  const kvHit = await c.env.R2SQL_CACHE.get(key, 'text').catch(() => null);
  if (kvHit !== null) {
    const payload = asPayload<T>(JSON.parse(kvHit));
    const ageSeconds = (Date.now() - payload.fetchedAt) / 1000;
    if (ageSeconds < ttlSeconds) {
      // Fresh: backfill the colo cache so subsequent local hits skip KV too.
      c.executionCtx.waitUntil(
        cache.put(
          cacheKey,
          new Response(kvHit, {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': `public, max-age=${Math.max(1, Math.round(ttlSeconds - ageSeconds))}`,
            },
          })
        )
      );
      recordQueryMetric(c, 'kv-hit', 0, payload.rows.length, sql.length);
      return payload.rows;
    }
    // Stale: hand back the old rows now, refresh behind the response.
    c.executionCtx.waitUntil(runScan(true).then(() => undefined));
    recordQueryMetric(c, 'kv-stale', 0, payload.rows.length, sql.length);
    return payload.rows;
  }

  // Nothing cached anywhere - this one has to wait.
  return runScan();
}

// Click-to-filter params (exact match). Flat query-string fields, mapped to
// canonical LiveFilters dimensions by parseFilters below.
const filterFields = {
  page: z.string().max(2048).optional(),
  source: z.string().max(256).optional(),
  utmSource: z.string().max(256).optional(),
  utmMedium: z.string().max(256).optional(),
  utmCampaign: z.string().max(256).optional(),
  country: z.string().max(64).optional(),
  region: z.string().max(128).optional(),
  city: z.string().max(128).optional(),
  browser: z.string().max(64).optional(),
  os: z.string().max(64).optional(),
  device: z.string().max(32).optional(),
};

type FilterParams = { [K in keyof typeof filterFields]?: string };

function parseFilters(q: FilterParams): LiveFilters | undefined {
  return toLiveFilters(q);
}

const filterQuery = z.object({ ...filterFields });

const periodQuery = z.object({
  period: z.enum(PERIODS).default('today'),
  ...filterFields,
});
const batchQuery = z.object({
  period: z.enum(PERIODS).default('today'),
  siteIds: z.string().optional(),
});
const locationQuery = z.object({
  period: z.enum(PERIODS).default('today'),
  type: z.enum(['country', 'region', 'city']).default('country'),
  ...filterFields,
});
const deviceQuery = z.object({
  period: z.enum(PERIODS).default('today'),
  type: z.enum(['browser', 'os', 'device', 'size']).default('browser'),
  ...filterFields,
});
const eventPropsQuery = z.object({
  period: z.enum(PERIODS).default('today'),
  event: z.string().min(1).max(256),
  ...filterFields,
});
const utmQuery = z.object({
  period: z.enum(PERIODS).default('today'),
  type: z.enum(['source', 'medium', 'campaign']).default('source'),
  ...filterFields,
});
const pagesQuery = z.object({
  period: z.enum(PERIODS).default('today'),
  type: z.enum(['top', 'entry', 'exit']).default('top'),
  ...filterFields,
});
const linksQuery = z.object({
  period: z.enum(PERIODS).default('today'),
  type: z.enum(['outbound', 'download']).default('outbound'),
  ...filterFields,
});

/** Extract the url from canonical link-event meta ('{"url":"..."}'). */
function parseMetaUrl(meta: string): string {
  try {
    return String((JSON.parse(meta) as { url?: unknown }).url || meta);
  } catch {
    return meta;
  }
}

/**
 * Aggregate distinct event_meta groups into per-property value counts.
 * Scalar props only (string/number/boolean); nested values are skipped.
 * Returns the top values per key, keys ordered by total events.
 */
function aggregateMetaProps(
  rows: { meta: string; events: number }[],
  valuesPerKey = 10
): { key: string; value: string; events: number }[] {
  const byKey = new Map<string, Map<string, number>>();
  for (const row of rows) {
    let props: Record<string, unknown>;
    try {
      props = JSON.parse(row.meta) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof props !== 'object' || props === null || Array.isArray(props)) continue;
    for (const [key, raw] of Object.entries(props)) {
      const t = typeof raw;
      if (t !== 'string' && t !== 'number' && t !== 'boolean') continue;
      const value = String(raw).slice(0, 300);
      let values = byKey.get(key);
      if (!values) byKey.set(key, (values = new Map()));
      values.set(value, (values.get(value) ?? 0) + row.events);
    }
  }
  const keyTotals = Array.from(byKey.entries()).map(([key, values]) => ({
    key,
    values,
    total: Array.from(values.values()).reduce((s, v) => s + v, 0),
  }));
  keyTotals.sort((a, b) => b.total - a.total);
  const out: { key: string; value: string; events: number }[] = [];
  for (const { key, values } of keyTotals) {
    const sorted = Array.from(values.entries()).sort((a, b) => b[1] - a[1]);
    for (const [value, events] of sorted.slice(0, valuesPerKey)) {
      out.push({ key, value, events });
    }
  }
  return out;
}

const pctChange = (cur: number, prev: number): number =>
  prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 100);

const toNumber = (v: unknown): number => Number(v ?? 0) || 0;

interface PeriodStatsRow {
  period: string;
  pageviews: unknown;
  visitors: unknown;
  sessions: unknown;
}

interface SessionStatsRow {
  period: string;
  sessions: unknown;
  bounces: unknown;
}

interface EngagementStatsRow {
  period: string;
  engaged: unknown;
}

/** Build the MainStats payload from current/previous totals (either path). */
function mainStatsPayload(cur: LiveTotals, prev: LiveTotals) {
  const rate = (t: LiveTotals): number =>
    t.sessions > 0 ? Math.min(100, Math.round((t.bounces / t.sessions) * 100)) : 0;
  const duration = (t: LiveTotals): number =>
    t.sessions > 0 ? Math.round(t.engagedSeconds / t.sessions) : 0;
  const curBounce = rate(cur);
  const prevBounce = rate(prev);
  const curDuration = duration(cur);

  return {
    visitors: cur.visitors,
    pageviews: cur.pageviews,
    sessions: cur.sessions,
    bounceRate: curBounce,
    visitorsChange: pctChange(cur.visitors, prev.visitors),
    pageviewsChange: pctChange(cur.pageviews, prev.pageviews),
    sessionsChange: pctChange(cur.sessions, prev.sessions),
    // Percentage-point delta, not relative change - conventional for bounce rate.
    bounceRateChange: curBounce - prevBounce,
    avgDuration: curDuration,
    avgDurationChange: pctChange(curDuration, duration(prev)),
  };
}

/**
 * Assemble MainStats from the two single-scan R2 SQL comparison queries.
 * Each query returns up to two rows labeled 'current' / 'previous';
 * a window with no events simply has no row.
 */
function assembleMainStats(
  statRows: PeriodStatsRow[],
  sessionRows: SessionStatsRow[],
  engagementRows: EngagementStatsRow[]
) {
  const totals = (period: string): LiveTotals => {
    const stat = statRows.find(r => r.period === period);
    const session = sessionRows.find(r => r.period === period);
    const engagement = engagementRows.find(r => r.period === period);
    // Sessions come from the session scan's exact COUNT(*), not the stats
    // scan's approx_distinct: bounces are exact, and dividing an exact
    // numerator by an estimated denominator can push bounce rate past 100%.
    // Fall back to the estimate only if the session scan returned no row.
    const exactSessions = toNumber(session?.sessions);
    return {
      pageviews: toNumber(stat?.pageviews),
      visitors: toNumber(stat?.visitors),
      sessions: exactSessions || toNumber(stat?.sessions),
      bounces: toNumber(session?.bounces),
      engagedSeconds: toNumber(engagement?.engaged),
    };
  };
  return mainStatsPayload(totals('current'), totals('previous'));
}

// ============ Hot path: live stats Durable Object ============
//
// For "today" and realtime, the collect worker's per-site Durable Object
// answers from local SQLite in milliseconds with zero ingest delay. Every
// today-branch is wrapped in try/catch: on any failure the route falls
// through to the Iceberg/R2 SQL cold path below it.

function liveStore(c: AppContext, siteId: string): LiveStoreApi {
  const ns = c.env.LIVE;
  return ns.get(ns.idFromName(siteId)) as unknown as LiveStoreApi;
}

const ms = (iso: string): number => Date.parse(iso);

function logLiveFallback(err: unknown): void {
  console.error('[analytics] live store failed, falling back to R2 SQL:', err);
}

function formatDevices(rows: { name: string; visitors: number }[]) {
  const total = rows.reduce((s, r) => s + r.visitors, 0);
  return rows.map(r => ({
    name: r.name,
    visitors: r.visitors,
    percentage: total > 0 ? Math.round((r.visitors / total) * 100) : 0,
  }));
}

/**
 * Zero-fill a timeseries result against the expected bucket keys from the period.
 * R2 SQL returns rows only for buckets that had data; the chart wants contiguous points.
 * Skipped for 'all' / weekly granularity where the start point is unbounded.
 */
function fillTimeseries(
  rows: { t: string; visitors: number; pageviews: number; sessions: number }[],
  range: PeriodRange
): { date: string; visitors: number; pageviews: number; sessions: number }[] {
  if (range.buckets.length === 0) {
    return rows.map(r => ({
      date: r.t,
      visitors: r.visitors,
      pageviews: r.pageviews,
      sessions: r.sessions,
    }));
  }
  const byKey = new Map(rows.map(r => [r.t, r]));
  return range.buckets.map(key => {
    const row = byKey.get(key);
    return {
      date: key,
      visitors: row ? row.visitors : 0,
      pageviews: row ? row.pageviews : 0,
      sessions: row ? row.sessions : 0,
    };
  });
}

/** Wraps a query path so R2SqlError surfaces as HTTP 502 instead of a silent empty response. */
async function runQueries<T>(c: AppContext, fn: () => Promise<T>): Promise<T | Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof R2SqlError) {
      // Full detail goes to the instance owner's logs; the response stays
      // generic - the upstream body echoes SQL fragments and schema names.
      console.error(`[analytics] R2 SQL failed: ${err.message}`);
      return c.json({ error: 'analytics query failed' }, 502);
    }
    throw err;
  }
}

/** Upper bound on sites per batch-stats request (D1 bind params + DO fan-out). */
const MAX_BATCH_SITES = 100;

const appWithBatch = app
  // Batch stats for all user's sites (used on sites list page)
  .get('/batch/stats', requireAuth, validate('query', batchQuery), async c => {
    const userId = c.get('userId')!;
    const { period, siteIds: siteIdsParam } = c.req.valid('query');
    const db = c.get('db')!;
    // Bounded: each id becomes a D1 bind parameter and (on 'today') a DO
    // subrequest, so an unbounded list blows D1's parameter ceiling and the
    // per-request subrequest budget. Dedup too - a repeated id multiplied both.
    const siteIdList = siteIdsParam
      ? [...new Set(siteIdsParam.split(',').filter(Boolean))].slice(0, MAX_BATCH_SITES)
      : null;

    const conditions = [siteAccessFilter(db, userId, c.get('tokenWorkspaceId'))];
    if (siteIdList && siteIdList.length > 0) {
      conditions.push(inArray(sites.id, siteIdList));
    }

    const siteRecords = await db
      .select({ siteId: sites.id, timezone: sites.timezone })
      .from(sites)
      .where(and(...conditions))
      .limit(MAX_BATCH_SITES);

    if (siteRecords.length === 0) return c.json({ data: {} });

    const now = queryTime();
    const ttl = cacheTtlSeconds(period);

    // Sites with no events still need an entry so tiles render zeros.
    const results: Record<string, { visitors: number; pageviews: number; sessions: number }> = {};
    for (const { siteId } of siteRecords) {
      results[siteId] = { visitors: 0, pageviews: 0, sessions: 0 };
    }

    // Hot path: today comes straight from each site's live DO.
    if (period === 'today') {
      try {
        const liveNow = new Date();
        await Promise.all(
          siteRecords.map(async ({ siteId, timezone }) => {
            const range = resolvePeriod('today', liveNow, timezone);
            const t = await liveStore(c, siteId).totals(ms(range.from), ms(range.to));
            results[siteId] = {
              visitors: t.visitors,
              pageviews: t.pageviews,
              sessions: t.sessions,
            };
          })
        );
        return c.json({ data: results });
      } catch (err) {
        logLiveFallback(err);
      }
    }

    // One GROUP BY site_id query per distinct timezone (sites in the same zone
    // share a period window) instead of one query per site.
    const byTimezone = new Map<string, typeof siteRecords>();
    for (const record of siteRecords) {
      const group = byTimezone.get(record.timezone);
      if (group) group.push(record);
      else byTimezone.set(record.timezone, [record]);
    }

    const outcome = await runQueries(c, async () => {
      await Promise.all(
        Array.from(byTimezone.entries()).map(async ([timezone, group]) => {
          const range = resolvePeriod(period, now, timezone);
          const rows = await cachedR2Sql<{
            site_id: string;
            visitors: unknown;
            pageviews: unknown;
            sessions: unknown;
          }>(
            c,
            ttl,
            buildBatchStatsQuery(
              group.map(g => g.siteId),
              range
            )
          );
          const known = new Set(group.map(g => g.siteId));
          for (const row of rows) {
            const siteId = known.has(String(row.site_id)) ? String(row.site_id) : undefined;
            if (!siteId) continue;
            results[siteId] = {
              visitors: toNumber(row.visitors),
              pageviews: toNumber(row.pageviews),
              sessions: toNumber(row.sessions),
            };
          }
        })
      );
      return results;
    });

    if (outcome instanceof Response) return outcome;
    return c.json({ data: outcome });
  });

// ============ Combined breakdowns ============

/** Unified shape every breakdown panel is mapped from. */
interface PanelRow {
  name: string;
  country: string;
  pageviews: number;
  visitors: number;
  sessions: number;
}

/**
 * Per-isolate switch: the combined GROUPING SETS scan is the default; if R2
 * SQL rejects it (feature gap, budget gate on a huge site) we fall back to
 * the per-panel query for the rest of the isolate's life and log once.
 */
let combinedBreakdowns = true;

function legacyBreakdown(
  siteId: string,
  range: PeriodRange,
  filters: LiveFilters | undefined,
  dim: BreakdownDim
): (table: string) => string {
  switch (dim) {
    case 'page':
      return buildTopPagesQuery(siteId, range, filters);
    case 'referrer':
      return buildTopReferrersQuery(siteId, range, filters);
    case 'utm_source':
      return buildUtmQuery(siteId, range, 'source', filters);
    case 'utm_medium':
      return buildUtmQuery(siteId, range, 'medium', filters);
    case 'utm_campaign':
      return buildUtmQuery(siteId, range, 'campaign', filters);
    case 'country':
    case 'region':
    case 'city':
      return buildLocationsQuery(siteId, range, dim, filters);
    case 'browser':
      return buildDevicesQuery(siteId, range, 'browser', filters);
    case 'os':
      return buildDevicesQuery(siteId, range, 'os', filters);
    case 'device':
      return buildDevicesQuery(siteId, range, 'device', filters);
    case 'screen':
      return buildScreenSizesQuery(siteId, range, filters);
    case 'ai':
      return buildAiSourcesQuery(siteId, range, filters);
  }
}

/** Map a legacy per-panel row (pathname/source/value/name) into PanelRow. */
function legacyRow(dim: BreakdownDim, r: Record<string, unknown>): PanelRow {
  const name = String(r.pathname ?? r.source ?? r.value ?? r.name ?? '');
  return {
    name,
    country: dim === 'country' ? name : String(r.country ?? ''),
    pageviews: toNumber(r.pageviews),
    visitors: toNumber(r.visitors),
    sessions: toNumber(r.sessions),
  };
}

/**
 * One breakdown panel. Every panel for the same (site, window, filters) is
 * served from the single combined scan - byte-identical SQL, so the cache and
 * in-flight coalescing turn thirteen panel requests into one R2 SQL query.
 */
async function cachedBreakdown(
  c: AppContext,
  ttl: number,
  siteId: string,
  range: PeriodRange,
  filters: LiveFilters | undefined,
  dim: BreakdownDim
): Promise<PanelRow[]> {
  if (combinedBreakdowns) {
    try {
      const rows = await cachedR2Sql<BreakdownRow>(
        c,
        ttl,
        buildBreakdownsQuery(siteId, range, filters)
      );
      return rows
        .filter(r => r.dim === dim)
        .map(r => ({
          name: String(r.name ?? ''),
          country: String(r.country ?? ''),
          pageviews: toNumber(r.pageviews),
          visitors: toNumber(r.visitors),
          sessions: toNumber(r.sessions),
        }));
    } catch (err) {
      if (!(err instanceof R2SqlError)) throw err;
      combinedBreakdowns = false;
      console.warn(
        `[analytics] combined breakdown scan rejected, using per-panel queries: ${err.message.slice(0, 200)}`
      );
    }
  }
  const rows = await cachedR2Sql<Record<string, unknown>>(
    c,
    ttl,
    legacyBreakdown(siteId, range, filters, dim)
  );
  return rows.map(r => legacyRow(dim, r));
}

/**
 * Full dashboard payload for a site - DO hot path for 'today', cached R2 SQL
 * cold path otherwise. Shared by the authed /stats/all route and the public
 * share-page route. Returns a Response only on query failure (502).
 */
export async function fetchDashboard(
  c: AppContext,
  site: SiteRecord,
  period: Period
): Promise<Response | Record<string, unknown>> {
  // Hot path: the whole today-dashboard from the site's live DO.
  if (period === 'today') {
    try {
      const range = resolvePeriod('today', new Date(), site.timezone);
      const prev = previousRange(range);
      const live = liveStore(c, site.siteId);
      const from = ms(range.from);
      const to = ms(range.to);
      const [main, timeseriesRows, pages, referrers, locations, browsers, osList] =
        await Promise.all([
          live.mainStats(ms(prev.from), from, to, undefined, ms(prev.to)),
          live.timeseries(from, to),
          live.topList('pathname', from, to, 10),
          live.topList('referrer_hostname', from, to, 10),
          live.topList('country', from, to, 10),
          live.topList('browser', from, to, 10),
          live.topList('os', from, to, 10),
        ]);
      return {
        main: mainStatsPayload(main.current, main.previous),
        timeseries: fillTimeseries(timeseriesRows, range),
        pages: pages.map(r => ({
          name: r.name,
          visitors: r.visitors,
          pageviews: r.pageviews,
        })),
        referrers: referrers.map(r => ({ name: r.name, visitors: r.visitors })),
        locations: locations.map(r => ({
          name: r.name,
          code: r.name,
          country: r.name,
          visitors: r.visitors,
        })),
        browsers: formatDevices(browsers.map(r => ({ name: r.name, visitors: r.visitors }))),
        os: formatDevices(osList.map(r => ({ name: r.name, visitors: r.visitors }))),
      };
    } catch (err) {
      logLiveFallback(err);
    }
  }

  const range = resolvePeriod(period, queryTime(period), site.timezone);
  const ttl = cacheTtlSeconds(period);

  const outcome = await runQueries(c, () =>
    Promise.all([
      cachedR2Sql<PeriodStatsRow>(c, ttl, buildStatsWithComparisonQuery(site.siteId, range)),
      cachedR2Sql<SessionStatsRow>(c, ttl, buildSessionStatsQuery(site.siteId, range)),
      cachedR2Sql<EngagementStatsRow>(c, ttl, buildEngagementStatsQuery(site.siteId, range)),
      cachedR2Sql<{ t: string; visitors: unknown; pageviews: unknown; sessions: unknown }>(
        c,
        ttl,
        buildTimeseriesQuery(site.siteId, range)
      ),
      cachedBreakdown(c, ttl, site.siteId, range, undefined, 'page'),
      cachedBreakdown(c, ttl, site.siteId, range, undefined, 'referrer'),
      cachedBreakdown(c, ttl, site.siteId, range, undefined, 'country'),
      cachedBreakdown(c, ttl, site.siteId, range, undefined, 'browser'),
      cachedBreakdown(c, ttl, site.siteId, range, undefined, 'os'),
    ])
  );
  if (outcome instanceof Response) return outcome;

  const [
    statRows,
    sessionRows,
    engagementRows,
    timeseriesRows,
    pagesRows,
    referrersRows,
    locationsRows,
    browsersRows,
    osRows,
  ] = outcome;

  return {
    main: assembleMainStats(statRows, sessionRows, engagementRows),
    timeseries: fillTimeseries(
      timeseriesRows.map(r => ({
        t: r.t,
        visitors: toNumber(r.visitors),
        pageviews: toNumber(r.pageviews),
        sessions: toNumber(r.sessions),
      })),
      range
    ),
    pages: pagesRows.map(r => ({ name: r.name, visitors: r.visitors, pageviews: r.pageviews })),
    referrers: referrersRows.map(r => ({ name: r.name, visitors: r.visitors })),
    locations: locationsRows.map(r => ({
      name: r.name,
      code: r.name,
      country: r.name,
      visitors: r.visitors,
    })),
    browsers: formatDevices(browsersRows.map(r => ({ name: r.name, visitors: r.visitors }))),
    os: formatDevices(osRows.map(r => ({ name: r.name, visitors: r.visitors }))),
  };
}

// Chain continues from appWithBatch so the Hono RPC AppType keeps every route.
export const analyticsRoute = appWithBatch
  // All stats in a single request (used on site analytics page)
  /**
   * Pre-warm hook for the cron (see lib/prewarm.ts). Guarded by a per-isolate
   * random token that only the scheduled handler knows - there is no way to
   * reach it from outside. Runs the unfiltered dashboard queries so their
   * cache entries are fresh; the payload itself is discarded.
   */
  .get('/internal/warm/:siteId', validate('query', periodQuery), async c => {
    if (c.req.header(INTERNAL_HEADER) !== getInternalToken())
      return c.json({ error: 'Not found' }, 404);
    const db = c.get('db')!;
    const [site] = await db
      .select({ siteId: sites.id, timezone: sites.timezone })
      .from(sites)
      .where(eq(sites.id, c.req.param('siteId')))
      .limit(1);
    if (!site) return c.json({ error: 'Not found' }, 404);
    const result = await fetchDashboard(c, site, c.req.valid('query').period);
    if (result instanceof Response) return result;
    return c.body(null, 204);
  })

  .get('/:siteId/stats/all', requireAuth, validate('query', periodQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const query = c.req.valid('query');
    const { period } = query;
    // This route serves the whole unfiltered dashboard in one scan and has no
    // filtered variant. Accepting filter params and ignoring them would return
    // site-wide numbers under a filter chip - refuse instead.
    if (Object.keys(parseFilters(query) ?? {}).length > 0) {
      return c.json(
        { error: 'stats/all does not support filters; use the per-panel endpoints' },
        400
      );
    }

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    const result = await fetchDashboard(c, site, period);
    if (result instanceof Response) return result;
    return c.json({ data: result });
  })

  .get('/:siteId/stats/main', requireAuth, validate('query', periodQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const query = c.req.valid('query');
    const { period } = query;
    const filters = parseFilters(query);

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    if (period === 'today') {
      try {
        const range = resolvePeriod('today', new Date(), site.timezone);
        const prev = previousRange(range);
        const { current, previous } = await liveStore(c, site.siteId).mainStats(
          ms(prev.from),
          ms(range.from),
          ms(range.to),
          filters,
          ms(prev.to)
        );
        return c.json({ data: mainStatsPayload(current, previous) });
      } catch (err) {
        logLiveFallback(err);
      }
    }

    const range = resolvePeriod(period, queryTime(period), site.timezone);
    const ttl = cacheTtlSeconds(period);

    const outcome = await runQueries(c, () =>
      Promise.all([
        cachedR2Sql<PeriodStatsRow>(
          c,
          ttl,
          buildStatsWithComparisonQuery(site.siteId, range, filters)
        ),
        cachedR2Sql<SessionStatsRow>(c, ttl, buildSessionStatsQuery(site.siteId, range, filters)),
        cachedR2Sql<EngagementStatsRow>(
          c,
          ttl,
          buildEngagementStatsQuery(site.siteId, range, filters)
        ),
      ])
    );
    if (outcome instanceof Response) return outcome;

    const [statRows, sessionRows, engagementRows] = outcome;
    return c.json({ data: assembleMainStats(statRows, sessionRows, engagementRows) });
  })

  .get('/:siteId/stats/timeseries', requireAuth, validate('query', periodQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const query = c.req.valid('query');
    const { period } = query;
    const filters = parseFilters(query);

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    if (period === 'today') {
      try {
        const range = resolvePeriod('today', new Date(), site.timezone);
        const rows = await liveStore(c, site.siteId).timeseries(
          ms(range.from),
          ms(range.to),
          filters
        );
        return c.json({ data: fillTimeseries(rows, range) });
      } catch (err) {
        logLiveFallback(err);
      }
    }

    const range = resolvePeriod(period, queryTime(period), site.timezone);
    const ttl = cacheTtlSeconds(period);

    const outcome = await runQueries(c, () =>
      cachedR2Sql<{ t: string; visitors: unknown; pageviews: unknown; sessions: unknown }>(
        c,
        ttl,
        buildTimeseriesQuery(site.siteId, range, filters)
      )
    );
    if (outcome instanceof Response) return outcome;

    return c.json({
      data: fillTimeseries(
        outcome.map(r => ({
          t: r.t,
          visitors: toNumber(r.visitors),
          pageviews: toNumber(r.pageviews),
          sessions: toNumber(r.sessions),
        })),
        range
      ),
    });
  })

  .get('/:siteId/stats/pages', requireAuth, validate('query', pagesQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const query = c.req.valid('query');
    const { period, type } = query;
    const filters = parseFilters(query);

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    if (period === 'today') {
      try {
        const range = resolvePeriod('today', new Date(), site.timezone);
        if (type === 'top') {
          const rows = await liveStore(c, site.siteId).topList(
            'pathname',
            ms(range.from),
            ms(range.to),
            10,
            filters
          );
          return c.json({
            data: rows.map(r => ({ name: r.name, visitors: r.visitors, pageviews: r.pageviews })),
          });
        }
        const rows = await liveStore(c, site.siteId).entryExitPages(
          type,
          ms(range.from),
          ms(range.to),
          10,
          filters
        );
        return c.json({
          data: rows.map(r => ({ name: r.name, visitors: r.visitors, pageviews: r.sessions })),
        });
      } catch (err) {
        logLiveFallback(err);
      }
    }

    const range = resolvePeriod(period, queryTime(period), site.timezone);
    const ttl = cacheTtlSeconds(period);

    if (type !== 'top') {
      const outcome = await runQueries(c, () =>
        cachedR2Sql<{ pathname: string; visitors: unknown; sessions: unknown }>(
          c,
          ttl,
          buildEntryExitPagesQuery(site.siteId, range, type, filters)
        )
      );
      if (outcome instanceof Response) return outcome;

      return c.json({
        data: outcome.map(r => ({
          name: r.pathname,
          visitors: toNumber(r.visitors),
          pageviews: toNumber(r.sessions),
        })),
      });
    }

    const outcome = await runQueries(c, () =>
      cachedBreakdown(c, ttl, site.siteId, range, filters, 'page')
    );
    if (outcome instanceof Response) return outcome;

    return c.json({
      data: outcome.map(r => ({
        name: r.name,
        visitors: r.visitors,
        pageviews: r.pageviews,
      })),
    });
  })

  .get('/:siteId/stats/links', requireAuth, validate('query', linksQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const query = c.req.valid('query');
    const { period, type } = query;
    const filters = parseFilters(query);
    const eventName = type === 'outbound' ? AUTO_EVENTS.OUTBOUND : AUTO_EVENTS.DOWNLOAD;

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    if (period === 'today') {
      try {
        const range = resolvePeriod('today', new Date(), site.timezone);
        const rows = await liveStore(c, site.siteId).linkClicks(
          eventName,
          ms(range.from),
          ms(range.to),
          10,
          filters
        );
        return c.json({
          data: rows.map(r => ({ name: r.url, visitors: r.visitors, clicks: r.clicks })),
        });
      } catch (err) {
        logLiveFallback(err);
      }
    }

    const range = resolvePeriod(period, queryTime(period), site.timezone);
    const ttl = cacheTtlSeconds(period);

    const outcome = await runQueries(c, () =>
      cachedR2Sql<{ meta: string; clicks: unknown; visitors: unknown }>(
        c,
        ttl,
        buildLinkEventsQuery(site.siteId, range, eventName, filters)
      )
    );
    if (outcome instanceof Response) return outcome;

    return c.json({
      data: outcome.map(r => ({
        name: parseMetaUrl(r.meta),
        visitors: toNumber(r.visitors),
        clicks: toNumber(r.clicks),
      })),
    });
  })

  .get('/:siteId/stats/referrers', requireAuth, validate('query', periodQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const query = c.req.valid('query');
    const { period } = query;
    const filters = parseFilters(query);

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    if (period === 'today') {
      try {
        const range = resolvePeriod('today', new Date(), site.timezone);
        const rows = await liveStore(c, site.siteId).topList(
          'referrer_hostname',
          ms(range.from),
          ms(range.to),
          10,
          filters
        );
        return c.json({ data: rows.map(r => ({ name: r.name, visitors: r.visitors })) });
      } catch (err) {
        logLiveFallback(err);
      }
    }

    const range = resolvePeriod(period, queryTime(period), site.timezone);
    const ttl = cacheTtlSeconds(period);

    const outcome = await runQueries(c, () =>
      cachedBreakdown(c, ttl, site.siteId, range, filters, 'referrer')
    );
    if (outcome instanceof Response) return outcome;

    return c.json({
      data: outcome.map(r => ({ name: r.name, visitors: r.visitors })),
    });
  })

  // AI assistants as a traffic channel: visits referred by ChatGPT, Claude,
  // Perplexity and friends, grouped by assistant (classified from
  // referrer_hostname at query time - see shared/src/ai-sources.ts).
  .get('/:siteId/stats/ai-sources', requireAuth, validate('query', periodQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const query = c.req.valid('query');
    const { period } = query;
    const filters = parseFilters(query);

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    if (period === 'today') {
      try {
        const range = resolvePeriod('today', new Date(), site.timezone);
        const rows = await liveStore(c, site.siteId).aiSources(
          ms(range.from),
          ms(range.to),
          10,
          filters
        );
        return c.json({ data: rows.map(r => ({ name: r.name, visitors: r.visitors })) });
      } catch (err) {
        logLiveFallback(err);
      }
    }

    const range = resolvePeriod(period, queryTime(period), site.timezone);
    const ttl = cacheTtlSeconds(period);

    const outcome = await runQueries(c, () =>
      cachedBreakdown(c, ttl, site.siteId, range, filters, 'ai')
    );
    if (outcome instanceof Response) return outcome;

    return c.json({
      data: outcome.map(r => ({ name: r.name, visitors: r.visitors })),
    });
  })

  .get('/:siteId/stats/utm', requireAuth, validate('query', utmQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const query = c.req.valid('query');
    const { period, type } = query;
    const filters = parseFilters(query);

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    if (period === 'today') {
      try {
        const range = resolvePeriod('today', new Date(), site.timezone);
        const dimension =
          type === 'source' ? 'utm_source' : type === 'medium' ? 'utm_medium' : 'utm_campaign';
        const rows = await liveStore(c, site.siteId).topList(
          dimension,
          ms(range.from),
          ms(range.to),
          10,
          filters
        );
        return c.json({
          data: rows.map(r => ({ name: r.name, visitors: r.visitors, sessions: r.sessions })),
        });
      } catch (err) {
        logLiveFallback(err);
      }
    }

    const range = resolvePeriod(period, queryTime(period), site.timezone);
    const ttl = cacheTtlSeconds(period);

    const outcome = await runQueries(c, () =>
      cachedBreakdown(c, ttl, site.siteId, range, filters, `utm_${type}` as BreakdownDim)
    );
    if (outcome instanceof Response) return outcome;

    return c.json({
      data: outcome.map(r => ({
        name: r.name,
        visitors: r.visitors,
        sessions: r.sessions,
      })),
    });
  })

  .get('/:siteId/stats/locations', requireAuth, validate('query', locationQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const query = c.req.valid('query');
    const { period, type } = query;
    const filters = parseFilters(query);

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    if (period === 'today') {
      try {
        const range = resolvePeriod('today', new Date(), site.timezone);
        const rows = await liveStore(c, site.siteId).topList(
          type,
          ms(range.from),
          ms(range.to),
          10,
          filters
        );
        return c.json({
          data: rows.map(r => ({
            name: r.name,
            code: r.name,
            country: type === 'country' ? r.name : (r.country ?? ''),
            visitors: r.visitors,
          })),
        });
      } catch (err) {
        logLiveFallback(err);
      }
    }

    const range = resolvePeriod(period, queryTime(period), site.timezone);
    const ttl = cacheTtlSeconds(period);

    const outcome = await runQueries(c, () =>
      cachedBreakdown(c, ttl, site.siteId, range, filters, type)
    );
    if (outcome instanceof Response) return outcome;

    return c.json({
      data: outcome.map(r => ({
        name: r.name,
        code: r.name,
        country: type === 'country' ? r.name : r.country,
        visitors: r.visitors,
      })),
    });
  })

  .get('/:siteId/stats/devices', requireAuth, validate('query', deviceQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const query = c.req.valid('query');
    const { period, type } = query;
    const filters = parseFilters(query);

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    if (period === 'today') {
      try {
        const range = resolvePeriod('today', new Date(), site.timezone);
        let rows: { name: string; visitors: number }[];
        if (type === 'size') {
          rows = await liveStore(c, site.siteId).screenSizes(ms(range.from), ms(range.to), filters);
        } else {
          const dimension = type === 'browser' ? 'browser' : type === 'os' ? 'os' : 'device_type';
          rows = await liveStore(c, site.siteId).topList(
            dimension,
            ms(range.from),
            ms(range.to),
            10,
            filters
          );
        }
        return c.json({
          data: formatDevices(rows.map(r => ({ name: r.name, visitors: r.visitors }))),
        });
      } catch (err) {
        logLiveFallback(err);
      }
    }

    const range = resolvePeriod(period, queryTime(period), site.timezone);
    const ttl = cacheTtlSeconds(period);

    const outcome = await runQueries(c, () =>
      cachedBreakdown(c, ttl, site.siteId, range, filters, type === 'size' ? 'screen' : type)
    );
    if (outcome instanceof Response) return outcome;

    return c.json({
      data: formatDevices(outcome.map(r => ({ name: r.name, visitors: r.visitors }))),
    });
  })

  .get('/:siteId/stats/goals', requireAuth, validate('query', periodQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const query = c.req.valid('query');
    const { period } = query;
    const filters = parseFilters(query);

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    const db = c.get('db')!;
    const siteGoals = await db.select().from(goals).where(eq(goals.siteId, siteId));
    if (siteGoals.length === 0) return c.json({ data: [] });

    // Plain goals keep the batched IN/GROUP BY queries; prop-filtered event
    // goals and '/section/*' prefix page goals each run their own count -
    // two goals on one event with different prop conditions can't share a
    // GROUP BY event_name row.
    const hasProp = (g: (typeof siteGoals)[number]): boolean => Boolean(g.propKey && g.propValue);
    const isSpecial = (g: (typeof siteGoals)[number]): boolean =>
      (g.type === 'event' && hasProp(g)) || (g.type === 'page' && isPagePrefix(g.target));
    const eventNames = siteGoals.filter(g => g.type === 'event' && !hasProp(g)).map(g => g.target);
    const pathnames = siteGoals
      .filter(g => g.type === 'page' && !isPagePrefix(g.target))
      .map(g => g.target);
    const specialGoals = siteGoals.filter(isSpecial);

    const respond = (
      byGoal: Map<string, { events: number; visitors: number }>,
      totalVisitors: number
    ): Response => {
      const data = siteGoals.map(goal => {
        const row = byGoal.get(goal.id);
        const uniques = row?.visitors ?? 0;
        return {
          id: goal.id,
          name: goal.name,
          type: goal.type,
          target: goal.target,
          propKey: goal.propKey,
          propValue: goal.propValue,
          uniques,
          events: row?.events ?? 0,
          conversionRate: totalVisitors > 0 ? Math.round((uniques / totalVisitors) * 1000) / 10 : 0,
        };
      });
      data.sort((a, b) => b.uniques - a.uniques);
      return c.json({ data });
    };

    if (period === 'today') {
      try {
        const range = resolvePeriod('today', new Date(), site.timezone);
        const live = liveStore(c, site.siteId);
        const [rows, totals] = await Promise.all([
          live.goalStats(
            ms(range.from),
            ms(range.to),
            siteGoals.map(g => ({
              id: g.id,
              type: g.type,
              target: g.target,
              propKey: g.propKey,
              propValue: g.propValue,
            })),
            filters
          ),
          live.totals(ms(range.from), ms(range.to), filters),
        ]);
        return respond(
          new Map(rows.map(r => [r.goalId, { events: r.events, visitors: r.visitors }])),
          totals.visitors
        );
      } catch (err) {
        logLiveFallback(err);
      }
    }

    const range = resolvePeriod(period, queryTime(period), site.timezone);
    const ttl = cacheTtlSeconds(period);

    const outcome = await runQueries(c, () =>
      Promise.all([
        // Same SQL as stats/main -> shared cache entry, no extra scan.
        cachedR2Sql<PeriodStatsRow>(
          c,
          ttl,
          buildStatsWithComparisonQuery(site.siteId, range, filters)
        ),
        eventNames.length > 0
          ? cachedR2Sql<{ target: string; events: unknown; visitors: unknown }>(
              c,
              ttl,
              buildGoalEventsQuery(site.siteId, range, eventNames, filters)
            )
          : Promise.resolve([]),
        pathnames.length > 0
          ? cachedR2Sql<{ target: string; events: unknown; visitors: unknown }>(
              c,
              ttl,
              buildGoalPagesQuery(site.siteId, range, pathnames, filters)
            )
          : Promise.resolve([]),
        Promise.all(
          specialGoals.map(g =>
            cachedR2Sql<{ events: unknown; visitors: unknown }>(
              c,
              ttl,
              g.type === 'event'
                ? buildGoalEventPropQuery(
                    site.siteId,
                    range,
                    g.target,
                    g.propKey!,
                    g.propValue!,
                    filters
                  )
                : buildGoalPagePrefixQuery(site.siteId, range, g.target, filters)
            )
          )
        ),
      ])
    );
    if (outcome instanceof Response) return outcome;

    const [statRows, eventRows, pageRows, specialRows] = outcome;
    const totalVisitors = toNumber(statRows.find(r => r.period === 'current')?.visitors);
    const byGoal = new Map<string, { events: number; visitors: number }>();
    for (const goal of siteGoals) {
      if (isSpecial(goal)) continue;
      const rows = goal.type === 'event' ? eventRows : pageRows;
      const row = rows.find(r => r.target === goal.target);
      if (row) {
        byGoal.set(goal.id, { events: toNumber(row.events), visitors: toNumber(row.visitors) });
      }
    }
    specialGoals.forEach((goal, i) => {
      const [row] = specialRows[i] ?? [];
      if (row) {
        byGoal.set(goal.id, { events: toNumber(row.events), visitors: toNumber(row.visitors) });
      }
    });
    return respond(byGoal, totalVisitors);
  })

  // Funnel completion stats. Always answered from R2 SQL - funnels need
  // cross-event ordering per session, which the live DO doesn't track - so
  // 'today' numbers trail ingest by the sink roll interval (~1 min).
  .get('/:siteId/stats/funnel/:funnelId', requireAuth, validate('query', periodQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const funnelId = c.req.param('funnelId');
    const query = c.req.valid('query');
    const { period } = query;
    const filters = parseFilters(query);

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    const db = c.get('db')!;
    const [funnel] = await db.select().from(funnels).where(eq(funnels.id, funnelId));
    if (!funnel || funnel.siteId !== siteId) return c.json({ error: 'Not found' }, 404);

    // Funnels are R2-only, and each funnel's SQL caches independently. A
    // 'today' window ending at the current minute reads an Iceberg table
    // the sink is still writing (~60s roll), so two funnels scanned seconds
    // apart cached contradictory snapshots of the same step. Lagging the
    // reference behind the sink makes every scan of a window deterministic
    // - all funnel tiles agree, at the cost of 'today' trailing ~2 minutes.
    const funnelRef =
      period === 'today'
        ? new Date(Math.floor((Date.now() - FUNNEL_SINK_LAG_MS) / 60_000) * 60_000)
        : queryTime(period);
    const range = resolvePeriod(period, funnelRef, site.timezone);
    const outcome = await runQueries(c, () =>
      cachedR2Sql<Record<string, unknown>>(
        c,
        cacheTtlSeconds(period),
        buildFunnelQuery(site.siteId, range, funnel.steps, filters)
      )
    );
    if (outcome instanceof Response) return outcome;

    const row = outcome[0] ?? {};
    const counts = funnel.steps.map((_, i) => toNumber(row[`c${i}`]));
    const first = counts[0] ?? 0;
    const pct = (num: number, den: number): number =>
      den > 0 ? Math.round((num / den) * 1000) / 10 : 0;

    return c.json({
      data: {
        id: funnel.id,
        name: funnel.name,
        steps: funnel.steps.map((s, i) => ({
          ...s,
          sessions: counts[i],
          rateFromFirst: i === 0 ? 100 : pct(counts[i], first),
          rateFromPrev: i === 0 ? 100 : pct(counts[i], counts[i - 1]),
        })),
      },
    });
  })

  .get('/:siteId/stats/realtime', requireAuth, validate('query', filterQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const filters = parseFilters(c.req.valid('query'));

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    // Realtime is the DO's home turf: events are queryable the moment they
    // arrive, vs waiting out the Iceberg sink roll on the fallback path.
    try {
      const live = await liveStore(c, site.siteId).realtime(Date.now(), filters);
      return c.json({
        data: {
          currentVisitors: live.total,
          topPages: live.rows.map(r => ({ path: r.pathname, visitors: r.visitors })),
          locations: live.locations ?? [],
          referrers: live.referrers ?? [],
          countries: live.countries ?? [],
        },
      });
    } catch (err) {
      logLiveFallback(err);
    }

    const outcome = await runQueries(c, () =>
      cachedR2Sql<{ visitors: unknown; pathname: string }>(
        c,
        30,
        buildRealtimeQuery(site.siteId, queryTime())
      )
    );
    if (outcome instanceof Response) return outcome;

    const totalOutcome = await runQueries(c, () =>
      cachedR2Sql<{ visitors: unknown }>(c, 30, buildRealtimeTotalQuery(site.siteId, queryTime()))
    );
    if (totalOutcome instanceof Response) return totalOutcome;
    return c.json({
      data: {
        currentVisitors: toNumber(totalOutcome[0]?.visitors),
        topPages: outcome.map(r => ({ path: r.pathname, visitors: toNumber(r.visitors) })),
        // Coordinates, referrers and countries live only in the DO's hot
        // window; the cold path (also unfiltered) returns the basics.
        locations: [] as LiveRealtimeLocation[],
        referrers: [] as { name: string; visitors: number }[],
        countries: [] as { name: string; visitors: number }[],
      },
    });
  })

  /**
   * Realtime over WebSocket: the dashboard subscribes once and the site's
   * live DO pushes a frame (same shape as /stats/realtime) whenever the
   * picture changes, plus a 30s tick while subscribed. Session auth only in
   * practice - browsers cannot attach a bearer header to an upgrade - and
   * the DO never sees an unauthenticated socket: access is checked here,
   * then the upgrade is proxied over the cross-script binding.
   */
  .get('/:siteId/stats/realtime/ws', requireAuth, validate('query', filterQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const filters = parseFilters(c.req.valid('query'));

    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
      return c.json({ error: 'Expected a WebSocket upgrade' }, 426);
    }

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    const ns = c.env.LIVE;
    const stub = ns.get(ns.idFromName(site.siteId));
    // Forward the upgrade verbatim (headers carry the handshake) on a clean
    // internal URL carrying the validated initial filters; the dashboard can
    // change them later with a `filters` command on the socket.
    const target = new URL('https://live.traks.internal/realtime');
    if (filters) target.searchParams.set('filters', JSON.stringify(filters));
    return stub.fetch(new Request(target, c.req.raw));
  })

  .get('/:siteId/stats/events', requireAuth, validate('query', periodQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const query = c.req.valid('query');
    const { period } = query;
    const filters = parseFilters(query);

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    if (period === 'today') {
      try {
        const range = resolvePeriod('today', new Date(), site.timezone);
        const rows = await liveStore(c, site.siteId).customEvents(
          ms(range.from),
          ms(range.to),
          20,
          filters
        );
        return c.json({
          data: rows.map(r => ({ name: r.name, count: r.count, totalValue: r.totalValue })),
        });
      } catch (err) {
        logLiveFallback(err);
      }
    }

    const range = resolvePeriod(period, queryTime(period), site.timezone);
    const ttl = cacheTtlSeconds(period);

    const outcome = await runQueries(c, () =>
      cachedR2Sql<{ name: string; count: unknown; total_value: unknown }>(
        c,
        ttl,
        buildEventsQuery(site.siteId, range, filters)
      )
    );
    if (outcome instanceof Response) return outcome;

    return c.json({
      data: outcome.map(r => ({
        name: r.name,
        count: toNumber(r.count),
        totalValue: toNumber(r.total_value),
      })),
    });
  })

  .get('/:siteId/stats/event-props', requireAuth, validate('query', eventPropsQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const query = c.req.valid('query');
    const { period, event } = query;
    const filters = parseFilters(query);

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    if (period === 'today') {
      try {
        const range = resolvePeriod('today', new Date(), site.timezone);
        const rows = await liveStore(c, site.siteId).eventMetaGroups(
          event,
          ms(range.from),
          ms(range.to),
          500,
          filters
        );
        return c.json({ data: aggregateMetaProps(rows) });
      } catch (err) {
        logLiveFallback(err);
      }
    }

    const range = resolvePeriod(period, queryTime(period), site.timezone);
    const ttl = cacheTtlSeconds(period);

    const outcome = await runQueries(c, () =>
      cachedR2Sql<{ meta: string; events: unknown }>(
        c,
        ttl,
        buildEventMetaQuery(site.siteId, range, event, filters)
      )
    );
    if (outcome instanceof Response) return outcome;

    return c.json({
      data: aggregateMetaProps(outcome.map(r => ({ meta: r.meta, events: toNumber(r.events) }))),
    });
  });
