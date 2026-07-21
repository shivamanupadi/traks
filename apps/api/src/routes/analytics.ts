import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import {
  PERIODS,
  TABLE_PROD,
  TABLE_DEV,
  R2SqlError,
  resolvePeriod,
  previousRange,
  type Period,
  type PeriodRange,
  type LiveStoreApi,
  type LiveTotals,
} from '@traks/shared';
import { requireAuth } from '../middleware/auth';
import { sites, apiKeys } from '../db/schema';
import {
  queryR2Sql,
  buildStatsWithComparisonQuery,
  buildSessionStatsQuery,
  buildBatchStatsQuery,
  buildTimeseriesQuery,
  buildTopPagesQuery,
  buildTopReferrersQuery,
  buildUtmQuery,
  buildLocationsQuery,
  buildDevicesQuery,
  buildRealtimeQuery,
  buildEventsQuery,
} from '../lib/queries';
import type { Bindings, Variables } from '../types';

type Env = { Bindings: Bindings; Variables: Variables };
type AppContext = Context<Env>;

const app = new Hono<Env>();

interface SiteRecord {
  siteId: string;
  key: string;
  timezone: string;
}

// Isolate-level memo for site lookups. The dashboard fires 7 parallel tile
// requests that each need the same site record; this collapses the repeated
// D1 round-trips. Positive results only, so a newly created site is visible
// immediately; key revocation propagates within the TTL.
const SITE_CACHE_TTL_MS = 60_000;
const siteCache = new Map<string, { site: SiteRecord; expires: number }>();

async function getSite(c: AppContext, siteId: string, userId: string): Promise<SiteRecord | null> {
  const cacheKey = `${userId}:${siteId}`;
  const cached = siteCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.site;

  const db = c.get('db')!;
  const [result] = await db
    .select({ siteId: sites.id, key: apiKeys.key, timezone: sites.timezone })
    .from(sites)
    .innerJoin(apiKeys, eq(sites.id, apiKeys.siteId))
    .where(and(eq(sites.id, siteId), eq(sites.userId, userId), isNull(apiKeys.revokedAt)))
    .limit(1);

  if (result) {
    if (siteCache.size > 5_000) siteCache.clear();
    siteCache.set(cacheKey, { site: result, expires: Date.now() + SITE_CACHE_TTL_MS });
  }
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

/** Result cache TTL per period. Long windows barely change; today tracks ingest. */
function cacheTtlSeconds(period: Period): number {
  switch (period) {
    case 'today':
      return 60;
    case '7d':
      return 300;
    default:
      return 900;
  }
}

/**
 * `now` quantized to the minute. Query builders embed `now` in the SQL text;
 * quantizing makes repeated loads produce byte-identical SQL (the cache key)
 * while shifting windows by at most 60s - less than ingest latency.
 */
function queryTime(): Date {
  return new Date(Math.floor(Date.now() / 60_000) * 60_000);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * queryR2Sql behind two cache layers: the per-colo Workers Cache API (fastest,
 * free) and a KV namespace (global — a scan any colo already paid for is
 * reused worldwide for the TTL). KV reads/writes are wrapped so a KV outage
 * degrades to the old per-colo behavior instead of failing the request.
 */
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

  const hit = await cache.match(cacheKey);
  if (hit) return (await hit.json()) as T[];

  const kvHit = await c.env.R2SQL_CACHE.get(key, 'text').catch(() => null);
  if (kvHit !== null) {
    const rows = JSON.parse(kvHit) as T[];
    // Backfill the colo cache so subsequent local hits skip KV too.
    c.executionCtx.waitUntil(
      cache.put(
        cacheKey,
        new Response(kvHit, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=${ttlSeconds}`,
          },
        })
      )
    );
    return rows;
  }

  const rows = await queryR2Sql<T>(config, () => sql);
  const body = JSON.stringify(rows);
  c.executionCtx.waitUntil(
    Promise.all([
      cache.put(
        cacheKey,
        new Response(body, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=${ttlSeconds}`,
          },
        })
      ),
      // KV requires a TTL of at least 60s; every period TTL already is.
      c.env.R2SQL_CACHE.put(key, body, { expirationTtl: Math.max(60, ttlSeconds) }).catch(err =>
        console.error('[analytics] KV cache put failed:', err)
      ),
    ])
  );
  return rows;
}

const periodQuery = z.object({
  period: z.enum(PERIODS).default('today'),
});
const batchQuery = z.object({
  period: z.enum(PERIODS).default('today'),
  siteIds: z.string().optional(),
});
const locationQuery = z.object({
  period: z.enum(PERIODS).default('today'),
  type: z.enum(['country', 'city']).default('country'),
});
const deviceQuery = z.object({
  period: z.enum(PERIODS).default('today'),
  type: z.enum(['browser', 'os', 'device']).default('browser'),
});
const utmQuery = z.object({
  period: z.enum(PERIODS).default('today'),
  type: z.enum(['source', 'medium', 'campaign']).default('source'),
});

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

/** Build the MainStats payload from current/previous totals (either path). */
function mainStatsPayload(cur: LiveTotals, prev: LiveTotals) {
  const rate = (t: LiveTotals): number =>
    t.sessions > 0 ? Math.round((t.bounces / t.sessions) * 100) : 0;
  const curBounce = rate(cur);
  const prevBounce = rate(prev);

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
  };
}

/**
 * Assemble MainStats from the two single-scan R2 SQL comparison queries.
 * Each query returns up to two rows labeled 'current' / 'previous';
 * a window with no events simply has no row.
 */
function assembleMainStats(statRows: PeriodStatsRow[], sessionRows: SessionStatsRow[]) {
  const totals = (period: string): LiveTotals => {
    const stat = statRows.find(r => r.period === period);
    const session = sessionRows.find(r => r.period === period);
    return {
      pageviews: toNumber(stat?.pageviews),
      visitors: toNumber(stat?.visitors),
      sessions: toNumber(stat?.sessions),
      bounces: toNumber(session?.bounces),
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

function liveStore(c: AppContext, siteKey: string): LiveStoreApi {
  const ns = c.env.LIVE;
  return ns.get(ns.idFromName(siteKey)) as unknown as LiveStoreApi;
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
      console.error(`[analytics] R2 SQL failed: ${err.message}`);
      return c.json({ error: 'analytics query failed', detail: err.message }, 502);
    }
    throw err;
  }
}

const appWithBatch = app
  // Batch stats for all user's sites (used on sites list page)
  .get('/batch/stats', requireAuth, zValidator('query', batchQuery), async c => {
    const userId = c.get('userId')!;
    const { period, siteIds: siteIdsParam } = c.req.valid('query');
    const db = c.get('db')!;
    const siteIdList = siteIdsParam ? siteIdsParam.split(',').filter(Boolean) : null;

    const conditions = [eq(sites.userId, userId), isNull(apiKeys.revokedAt)];
    if (siteIdList && siteIdList.length > 0) {
      conditions.push(inArray(sites.id, siteIdList));
    }

    const siteRecords = await db
      .select({ siteId: sites.id, key: apiKeys.key, timezone: sites.timezone })
      .from(sites)
      .innerJoin(apiKeys, eq(sites.id, apiKeys.siteId))
      .where(and(...conditions));

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
          siteRecords.map(async ({ siteId, key, timezone }) => {
            const range = resolvePeriod('today', liveNow, timezone);
            const t = await liveStore(c, key).totals(ms(range.from), ms(range.to));
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
              group.map(g => g.key),
              range
            )
          );
          const keyToSiteId = new Map(group.map(g => [g.key, g.siteId]));
          for (const row of rows) {
            const siteId = keyToSiteId.get(row.site_id);
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

/**
 * Full dashboard payload for a site — DO hot path for 'today', cached R2 SQL
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
      const live = liveStore(c, site.key);
      const from = ms(range.from);
      const to = ms(range.to);
      const [main, timeseriesRows, pages, referrers, locations, browsers, osList] =
        await Promise.all([
          live.mainStats(ms(prev.from), from, to),
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
        locations: locations.map(r => ({ name: r.name, code: r.name, visitors: r.visitors })),
        browsers: formatDevices(browsers.map(r => ({ name: r.name, visitors: r.visitors }))),
        os: formatDevices(osList.map(r => ({ name: r.name, visitors: r.visitors }))),
      };
    } catch (err) {
      logLiveFallback(err);
    }
  }

  const range = resolvePeriod(period, queryTime(), site.timezone);
  const ttl = cacheTtlSeconds(period);

  const outcome = await runQueries(c, () =>
    Promise.all([
      cachedR2Sql<PeriodStatsRow>(c, ttl, buildStatsWithComparisonQuery(site.key, range)),
      cachedR2Sql<SessionStatsRow>(c, ttl, buildSessionStatsQuery(site.key, range)),
      cachedR2Sql<{ t: string; visitors: unknown; pageviews: unknown; sessions: unknown }>(
        c,
        ttl,
        buildTimeseriesQuery(site.key, range)
      ),
      cachedR2Sql<{ pathname: string; visitors: unknown; pageviews: unknown }>(
        c,
        ttl,
        buildTopPagesQuery(site.key, range)
      ),
      cachedR2Sql<{ source: string; visitors: unknown }>(
        c,
        ttl,
        buildTopReferrersQuery(site.key, range)
      ),
      cachedR2Sql<{ name: string; visitors: unknown }>(
        c,
        ttl,
        buildLocationsQuery(site.key, range, 'country')
      ),
      cachedR2Sql<{ name: string; visitors: unknown }>(
        c,
        ttl,
        buildDevicesQuery(site.key, range, 'browser')
      ),
      cachedR2Sql<{ name: string; visitors: unknown }>(
        c,
        ttl,
        buildDevicesQuery(site.key, range, 'os')
      ),
    ])
  );
  if (outcome instanceof Response) return outcome;

  const [
    statRows,
    sessionRows,
    timeseriesRows,
    pagesRows,
    referrersRows,
    locationsRows,
    browsersRows,
    osRows,
  ] = outcome;

  return {
    main: assembleMainStats(statRows, sessionRows),
    timeseries: fillTimeseries(
      timeseriesRows.map(r => ({
        t: r.t,
        visitors: toNumber(r.visitors),
        pageviews: toNumber(r.pageviews),
        sessions: toNumber(r.sessions),
      })),
      range
    ),
    pages: pagesRows.map(r => ({
      name: r.pathname,
      visitors: toNumber(r.visitors),
      pageviews: toNumber(r.pageviews),
    })),
    referrers: referrersRows.map(r => ({
      name: r.source,
      visitors: toNumber(r.visitors),
    })),
    locations: locationsRows.map(r => ({
      name: r.name,
      code: r.name,
      visitors: toNumber(r.visitors),
    })),
    browsers: formatDevices(
      browsersRows.map(r => ({ name: r.name, visitors: toNumber(r.visitors) }))
    ),
    os: formatDevices(osRows.map(r => ({ name: r.name, visitors: toNumber(r.visitors) }))),
  };
}

// Chain continues from appWithBatch so the Hono RPC AppType keeps every route.
export const analyticsRoute = appWithBatch
  // All stats in a single request (used on site analytics page)
  .get('/:siteId/stats/all', requireAuth, zValidator('query', periodQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const { period } = c.req.valid('query');

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    const result = await fetchDashboard(c, site, period);
    if (result instanceof Response) return result;
    return c.json({ data: result });
  })

  .get('/:siteId/stats/main', requireAuth, zValidator('query', periodQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const { period } = c.req.valid('query');

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    if (period === 'today') {
      try {
        const range = resolvePeriod('today', new Date(), site.timezone);
        const prev = previousRange(range);
        const { current, previous } = await liveStore(c, site.key).mainStats(
          ms(prev.from),
          ms(range.from),
          ms(range.to)
        );
        return c.json({ data: mainStatsPayload(current, previous) });
      } catch (err) {
        logLiveFallback(err);
      }
    }

    const range = resolvePeriod(period, queryTime(), site.timezone);
    const ttl = cacheTtlSeconds(period);

    const outcome = await runQueries(c, () =>
      Promise.all([
        cachedR2Sql<PeriodStatsRow>(c, ttl, buildStatsWithComparisonQuery(site.key, range)),
        cachedR2Sql<SessionStatsRow>(c, ttl, buildSessionStatsQuery(site.key, range)),
      ])
    );
    if (outcome instanceof Response) return outcome;

    const [statRows, sessionRows] = outcome;
    return c.json({ data: assembleMainStats(statRows, sessionRows) });
  })

  .get('/:siteId/stats/timeseries', requireAuth, zValidator('query', periodQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const { period } = c.req.valid('query');

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    if (period === 'today') {
      try {
        const range = resolvePeriod('today', new Date(), site.timezone);
        const rows = await liveStore(c, site.key).timeseries(ms(range.from), ms(range.to));
        return c.json({ data: fillTimeseries(rows, range) });
      } catch (err) {
        logLiveFallback(err);
      }
    }

    const range = resolvePeriod(period, queryTime(), site.timezone);
    const ttl = cacheTtlSeconds(period);

    const outcome = await runQueries(c, () =>
      cachedR2Sql<{ t: string; visitors: unknown; pageviews: unknown; sessions: unknown }>(
        c,
        ttl,
        buildTimeseriesQuery(site.key, range)
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

  .get('/:siteId/stats/pages', requireAuth, zValidator('query', periodQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const { period } = c.req.valid('query');

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    if (period === 'today') {
      try {
        const range = resolvePeriod('today', new Date(), site.timezone);
        const rows = await liveStore(c, site.key).topList(
          'pathname',
          ms(range.from),
          ms(range.to),
          10
        );
        return c.json({
          data: rows.map(r => ({ name: r.name, visitors: r.visitors, pageviews: r.pageviews })),
        });
      } catch (err) {
        logLiveFallback(err);
      }
    }

    const range = resolvePeriod(period, queryTime(), site.timezone);
    const ttl = cacheTtlSeconds(period);

    const outcome = await runQueries(c, () =>
      cachedR2Sql<{ pathname: string; visitors: unknown; pageviews: unknown }>(
        c,
        ttl,
        buildTopPagesQuery(site.key, range)
      )
    );
    if (outcome instanceof Response) return outcome;

    return c.json({
      data: outcome.map(r => ({
        name: r.pathname,
        visitors: toNumber(r.visitors),
        pageviews: toNumber(r.pageviews),
      })),
    });
  })

  .get('/:siteId/stats/referrers', requireAuth, zValidator('query', periodQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const { period } = c.req.valid('query');

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    if (period === 'today') {
      try {
        const range = resolvePeriod('today', new Date(), site.timezone);
        const rows = await liveStore(c, site.key).topList(
          'referrer_hostname',
          ms(range.from),
          ms(range.to),
          10
        );
        return c.json({ data: rows.map(r => ({ name: r.name, visitors: r.visitors })) });
      } catch (err) {
        logLiveFallback(err);
      }
    }

    const range = resolvePeriod(period, queryTime(), site.timezone);
    const ttl = cacheTtlSeconds(period);

    const outcome = await runQueries(c, () =>
      cachedR2Sql<{ source: string; visitors: unknown }>(
        c,
        ttl,
        buildTopReferrersQuery(site.key, range)
      )
    );
    if (outcome instanceof Response) return outcome;

    return c.json({
      data: outcome.map(r => ({ name: r.source, visitors: toNumber(r.visitors) })),
    });
  })

  .get('/:siteId/stats/utm', requireAuth, zValidator('query', utmQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const { period, type } = c.req.valid('query');

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    if (period === 'today') {
      try {
        const range = resolvePeriod('today', new Date(), site.timezone);
        const dimension =
          type === 'source' ? 'utm_source' : type === 'medium' ? 'utm_medium' : 'utm_campaign';
        const rows = await liveStore(c, site.key).topList(
          dimension,
          ms(range.from),
          ms(range.to),
          10
        );
        return c.json({
          data: rows.map(r => ({ name: r.name, visitors: r.visitors, sessions: r.sessions })),
        });
      } catch (err) {
        logLiveFallback(err);
      }
    }

    const range = resolvePeriod(period, queryTime(), site.timezone);
    const ttl = cacheTtlSeconds(period);

    const outcome = await runQueries(c, () =>
      cachedR2Sql<{ value: string; visitors: unknown; sessions: unknown }>(
        c,
        ttl,
        buildUtmQuery(site.key, range, type)
      )
    );
    if (outcome instanceof Response) return outcome;

    return c.json({
      data: outcome.map(r => ({
        name: r.value,
        visitors: toNumber(r.visitors),
        sessions: toNumber(r.sessions),
      })),
    });
  })

  .get('/:siteId/stats/locations', requireAuth, zValidator('query', locationQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const { period, type } = c.req.valid('query');

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    if (period === 'today') {
      try {
        const range = resolvePeriod('today', new Date(), site.timezone);
        const rows = await liveStore(c, site.key).topList(type, ms(range.from), ms(range.to), 10);
        return c.json({
          data: rows.map(r => ({ name: r.name, code: r.name, visitors: r.visitors })),
        });
      } catch (err) {
        logLiveFallback(err);
      }
    }

    const range = resolvePeriod(period, queryTime(), site.timezone);
    const ttl = cacheTtlSeconds(period);

    const outcome = await runQueries(c, () =>
      cachedR2Sql<{ name: string; visitors: unknown }>(
        c,
        ttl,
        buildLocationsQuery(site.key, range, type)
      )
    );
    if (outcome instanceof Response) return outcome;

    return c.json({
      data: outcome.map(r => ({ name: r.name, code: r.name, visitors: toNumber(r.visitors) })),
    });
  })

  .get('/:siteId/stats/devices', requireAuth, zValidator('query', deviceQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const { period, type } = c.req.valid('query');

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    if (period === 'today') {
      try {
        const range = resolvePeriod('today', new Date(), site.timezone);
        const dimension = type === 'browser' ? 'browser' : type === 'os' ? 'os' : 'device_type';
        const rows = await liveStore(c, site.key).topList(
          dimension,
          ms(range.from),
          ms(range.to),
          10
        );
        return c.json({
          data: formatDevices(rows.map(r => ({ name: r.name, visitors: r.visitors }))),
        });
      } catch (err) {
        logLiveFallback(err);
      }
    }

    const range = resolvePeriod(period, queryTime(), site.timezone);
    const ttl = cacheTtlSeconds(period);

    const outcome = await runQueries(c, () =>
      cachedR2Sql<{ name: string; visitors: unknown }>(
        c,
        ttl,
        buildDevicesQuery(site.key, range, type)
      )
    );
    if (outcome instanceof Response) return outcome;

    return c.json({
      data: formatDevices(outcome.map(r => ({ name: r.name, visitors: toNumber(r.visitors) }))),
    });
  })

  .get('/:siteId/stats/realtime', requireAuth, async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    // Realtime is the DO's home turf: events are queryable the moment they
    // arrive, vs waiting out the Iceberg sink roll on the fallback path.
    try {
      const rows = await liveStore(c, site.key).realtime(Date.now());
      return c.json({
        data: {
          currentVisitors: rows.reduce((s, r) => s + r.visitors, 0),
          topPages: rows.map(r => ({ path: r.pathname, visitors: r.visitors })),
        },
      });
    } catch (err) {
      logLiveFallback(err);
    }

    const outcome = await runQueries(c, () =>
      cachedR2Sql<{ visitors: unknown; pathname: string }>(
        c,
        30,
        buildRealtimeQuery(site.key, queryTime())
      )
    );
    if (outcome instanceof Response) return outcome;

    const currentVisitors = outcome.reduce((s, r) => s + toNumber(r.visitors), 0);
    return c.json({
      data: {
        currentVisitors,
        topPages: outcome.map(r => ({ path: r.pathname, visitors: toNumber(r.visitors) })),
      },
    });
  })

  .get('/:siteId/stats/events', requireAuth, zValidator('query', periodQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const { period } = c.req.valid('query');

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    if (period === 'today') {
      try {
        const range = resolvePeriod('today', new Date(), site.timezone);
        const rows = await liveStore(c, site.key).customEvents(ms(range.from), ms(range.to), 20);
        return c.json({
          data: rows.map(r => ({ name: r.name, count: r.count, totalValue: r.totalValue })),
        });
      } catch (err) {
        logLiveFallback(err);
      }
    }

    const range = resolvePeriod(period, queryTime(), site.timezone);
    const ttl = cacheTtlSeconds(period);

    const outcome = await runQueries(c, () =>
      cachedR2Sql<{ name: string; count: unknown; total_value: unknown }>(
        c,
        ttl,
        buildEventsQuery(site.key, range)
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
  });
