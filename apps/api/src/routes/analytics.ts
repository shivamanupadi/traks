import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { isArchivedPeriod, PERIODS, type Period } from '@traks/shared';
import { requireAuth } from '../middleware/auth';
import { sites, apiKeys } from '../db/schema';
import {
  queryAnalyticsEngine,
  buildMainStatsQuery,
  buildPreviousPeriodQuery,
  buildTimeseriesQuery,
  buildTopPagesQuery,
  buildTopReferrersQuery,
  buildUtmQuery,
  buildLocationsQuery,
  buildDevicesQuery,
  buildRealtimeQuery,
  buildEventsQuery,
} from '../lib/queries';
import {
  getDateRange,
  queryArchivedStats,
  queryArchivedTimeseries,
  queryArchivedPages,
  queryArchivedReferrers,
  queryArchivedLocations,
  queryArchivedDevices,
  queryArchivedUtm,
  queryArchivedEvents,
} from '../lib/archived-queries';
import type { Bindings, Variables } from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Persistent site key cache across requests (survives within the same Worker isolate)
const siteKeyTTL = 5 * 60_000; // 5 minutes
const siteKeyStore = new Map<string, { key: string | null; at: number }>();

// Helper: get the site's active API key, cached across requests
async function getCachedSiteKey(c: any, siteId: string, userId: string): Promise<string | null> {
  const cacheKey = `${siteId}:${userId}`;
  const cached = siteKeyStore.get(cacheKey);
  if (cached && Date.now() - cached.at < siteKeyTTL) {
    return cached.key;
  }

  const db = c.get('db')!;
  const [result] = await db
    .select({ key: apiKeys.key })
    .from(sites)
    .innerJoin(apiKeys, eq(sites.id, apiKeys.siteId))
    .where(and(eq(sites.id, siteId), eq(sites.userId, userId), isNull(apiKeys.revokedAt)))
    .limit(1);

  const key = result?.key || null;
  siteKeyStore.set(cacheKey, { key, at: Date.now() });
  return key;
}

// Helper: verify site ownership (for archived queries that don't need the API key)
async function verifySiteOwnership(c: any, siteId: string, userId: string): Promise<boolean> {
  const db = c.get('db')!;
  const [result] = await db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.userId, userId)))
    .limit(1);
  return !!result;
}

function getQueryConfig(c: any): { accountId: string; apiToken: string; dataset: string } {
  return {
    accountId: c.env.CF_ACCOUNT_ID,
    apiToken: c.env.CF_API_TOKEN,
    dataset: c.env.ENVIRONMENT === 'production' ? '"traks"' : '"traks-dev"',
  };
}

// Query schemas for zValidator - enables Hono RPC type inference
const periodQuery = z.object({
  period: z.enum(PERIODS).default('7d'),
});
const batchQuery = z.object({
  period: z.enum(PERIODS).default('7d'),
  siteIds: z.string().optional(),
});
const locationQuery = z.object({
  period: z.enum(PERIODS).default('7d'),
  type: z.enum(['country', 'city']).default('country'),
});
const deviceQuery = z.object({
  period: z.enum(PERIODS).default('7d'),
  type: z.enum(['browser', 'os', 'device']).default('browser'),
});
const utmQuery = z.object({
  period: z.enum(PERIODS).default('7d'),
  type: z.enum(['source', 'medium', 'campaign']).default('source'),
});

// Cache durations by period
function getCacheMaxAge(period: Period): number {
  switch (period) {
    case 'today':
      return 30; // 30s for today
    case '7d':
      return 120; // 2min
    case '30d':
      return 300; // 5min
    case '90d':
      return 600; // 10min
    case '6m':
      return 1800; // 30min
    case '1y':
      return 3600; // 1hr
    case 'all':
      return 3600; // 1hr
    default:
      return 60;
  }
}

function setCacheHeaders(c: any, period: Period): void {
  c.header('Cache-Control', `private, max-age=${getCacheMaxAge(period)}`);
}

// KV cache TTLs (seconds) - match getCacheMaxAge
function getKvTtl(period: Period): number {
  switch (period) {
    case 'today':
      return 60; // KV minimum is 60s
    case '7d':
      return 120;
    case '30d':
      return 300;
    case '90d':
      return 600;
    default:
      return 60;
  }
}

async function kvGet<T>(kv: KVNamespace, key: string): Promise<T | null> {
  try {
    return await kv.get(key, 'json');
  } catch {
    return null; // treat KV errors as cache miss
  }
}

async function kvPut(kv: KVNamespace, key: string, value: unknown, period: Period): Promise<void> {
  try {
    await kv.put(key, JSON.stringify(value), { expirationTtl: getKvTtl(period) });
  } catch {
    /* best-effort */
  }
}

export const analyticsRoute = app
  // Batch stats for all user's sites (used on sites list page)
  .get('/batch/stats', requireAuth, zValidator('query', batchQuery), async c => {
    const userId = c.get('userId')!;
    const { period, siteIds: siteIdsParam } = c.req.valid('query');
    const db = c.get('db')!;
    const siteIdList = siteIdsParam ? siteIdsParam.split(',').filter(Boolean) : null;

    // Get user's sites with their active API keys, optionally filtered by siteIds
    const conditions = [eq(sites.userId, userId), isNull(apiKeys.revokedAt)];
    if (siteIdList && siteIdList.length > 0) {
      conditions.push(inArray(sites.id, siteIdList));
    }

    const siteKeys = await db
      .select({ siteId: sites.id, key: apiKeys.key })
      .from(sites)
      .innerJoin(apiKeys, eq(sites.id, apiKeys.siteId))
      .where(and(...conditions));

    if (siteKeys.length === 0) return c.json({ data: {} });

    const results: Record<string, { visitors: number; pageviews: number; sessions: number }> = {};

    if (isArchivedPeriod(period)) {
      const { from, to } = getDateRange(period);
      await Promise.all(
        siteKeys.map(async ({ siteId }) => {
          results[siteId] = await queryArchivedStats(db, siteId, from, to);
        })
      );
    } else {
      const config = getQueryConfig(c);
      const kv = c.env.CACHE;
      await Promise.all(
        siteKeys.map(async ({ siteId, key }) => {
          const cacheKey = `batch:${siteId}:${period}`;
          const cached = await kvGet<{ visitors: number; pageviews: number; sessions: number }>(
            kv,
            cacheKey
          );
          if (cached) {
            results[siteId] = cached;
            return;
          }
          const [current] = await queryAnalyticsEngine(config, buildMainStatsQuery(key, period));
          const data = {
            visitors: Number(current?.visitors || 0),
            pageviews: Number(current?.pageviews || 0),
            sessions: Number(current?.sessions || 0),
          };
          results[siteId] = data;
          c.executionCtx.waitUntil(kvPut(kv, cacheKey, data, period));
        })
      );
    }

    setCacheHeaders(c, period);
    return c.json({ data: results });
  })

  // All stats in a single request (used on site analytics page)
  .get('/:siteId/stats/all', requireAuth, zValidator('query', periodQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const { period } = c.req.valid('query');

    if (isArchivedPeriod(period)) {
      if (!(await verifySiteOwnership(c, siteId, userId)))
        return c.json({ error: 'Not found' }, 404);

      const db = c.get('db')!;
      const { from, to } = getDateRange(period);

      const [stats, timeseries, pages, referrers, locations, browsers, os] = await Promise.all([
        queryArchivedStats(db, siteId, from, to),
        queryArchivedTimeseries(db, siteId, from, to, period),
        queryArchivedPages(db, siteId, from, to),
        queryArchivedReferrers(db, siteId, from, to),
        queryArchivedLocations(db, siteId, from, to, 'country'),
        queryArchivedDevices(db, siteId, from, to, 'browser'),
        queryArchivedDevices(db, siteId, from, to, 'os'),
      ]);

      setCacheHeaders(c, period);
      return c.json({
        data: {
          main: {
            ...stats,
            bounceRate: 0,
            visitorsChange: 0,
            pageviewsChange: 0,
            sessionsChange: 0,
          },
          timeseries,
          pages,
          referrers,
          locations,
          browsers,
          os,
        },
      });
    }

    const siteKey = await getCachedSiteKey(c, siteId, userId);
    if (!siteKey) return c.json({ error: 'Not found' }, 404);

    // KV cache check
    const kv = c.env.CACHE;
    const cacheKey = `stats:${siteId}:${period}`;
    const cached = await kvGet<any>(kv, cacheKey);
    if (cached) {
      setCacheHeaders(c, period);
      return c.json({ data: cached });
    }

    const config = getQueryConfig(c);

    const [
      [current],
      [previous],
      timeseriesRows,
      pagesRows,
      referrersRows,
      locationsRows,
      browsersRows,
      osRows,
    ] = await Promise.all([
      queryAnalyticsEngine(config, buildMainStatsQuery(siteKey, period)),
      queryAnalyticsEngine(config, buildPreviousPeriodQuery(siteKey, period)),
      queryAnalyticsEngine(config, buildTimeseriesQuery(siteKey, period)),
      queryAnalyticsEngine(config, buildTopPagesQuery(siteKey, period)),
      queryAnalyticsEngine(config, buildTopReferrersQuery(siteKey, period)),
      queryAnalyticsEngine(config, buildLocationsQuery(siteKey, period, 'country')),
      queryAnalyticsEngine(config, buildDevicesQuery(siteKey, period, 'browser')),
      queryAnalyticsEngine(config, buildDevicesQuery(siteKey, period, 'os')),
    ]);

    const cur = {
      visitors: Number(current?.visitors || 0),
      pageviews: Number(current?.pageviews || 0),
      sessions: Number(current?.sessions || 0),
    };
    const prev = {
      visitors: Number(previous?.visitors || 0),
      pageviews: Number(previous?.pageviews || 0),
      sessions: Number(previous?.sessions || 0),
    };

    const pctChange = (c: number, p: number): number =>
      p === 0 ? (c > 0 ? 100 : 0) : Math.round(((c - p) / p) * 100);

    const formatDevices = (rows: any[]) => {
      const totalVisitors = rows.reduce((sum: number, r: any) => sum + Number(r.visitors || 0), 0);
      return rows.map((row: any) => {
        const visitors = Number(row.visitors || 0);
        return {
          name: row.name,
          visitors,
          percentage: totalVisitors > 0 ? Math.round((visitors / totalVisitors) * 100) : 0,
        };
      });
    };

    const responseData = {
      main: {
        visitors: cur.visitors,
        pageviews: cur.pageviews,
        sessions: cur.sessions,
        bounceRate: 0,
        visitorsChange: pctChange(cur.visitors, prev.visitors),
        pageviewsChange: pctChange(cur.pageviews, prev.pageviews),
        sessionsChange: pctChange(cur.sessions, prev.sessions),
      },
      timeseries: timeseriesRows.map((row: any) => ({
        date: row.t,
        visitors: Number(row.visitors || 0),
        pageviews: Number(row.pageviews || 0),
        sessions: Number(row.sessions || 0),
      })),
      pages: pagesRows.map((row: any) => ({
        name: row.pathname,
        visitors: Number(row.visitors || 0),
        pageviews: Number(row.pageviews || 0),
      })),
      referrers: referrersRows.map((row: any) => ({
        name: row.source,
        visitors: Number(row.visitors || 0),
      })),
      locations: locationsRows.map((row: any) => ({
        name: row.name,
        code: row.name,
        visitors: Number(row.visitors || 0),
      })),
      browsers: formatDevices(browsersRows),
      os: formatDevices(osRows),
    };

    // Store in KV cache (fire-and-forget)
    c.executionCtx.waitUntil(kvPut(kv, cacheKey, responseData, period));

    setCacheHeaders(c, period);
    return c.json({ data: responseData });
  })

  // Main stats (visitors, pageviews, sessions + comparison)
  .get('/:siteId/stats/main', requireAuth, zValidator('query', periodQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const { period } = c.req.valid('query');

    if (isArchivedPeriod(period)) {
      if (!(await verifySiteOwnership(c, siteId, userId)))
        return c.json({ error: 'Not found' }, 404);

      const db = c.get('db')!;
      const { from, to } = getDateRange(period);
      const stats = await queryArchivedStats(db, siteId, from, to);

      setCacheHeaders(c, period);
      return c.json({
        data: {
          ...stats,
          bounceRate: 0,
          visitorsChange: 0,
          pageviewsChange: 0,
          sessionsChange: 0,
        },
      });
    }

    const siteKey = await getCachedSiteKey(c, siteId, userId);
    if (!siteKey) return c.json({ error: 'Not found' }, 404);

    const config = getQueryConfig(c);
    const [[current], [previous]] = await Promise.all([
      queryAnalyticsEngine(config, buildMainStatsQuery(siteKey, period)),
      queryAnalyticsEngine(config, buildPreviousPeriodQuery(siteKey, period)),
    ]);

    const cur = {
      visitors: Number(current?.visitors || 0),
      pageviews: Number(current?.pageviews || 0),
      sessions: Number(current?.sessions || 0),
    };
    const prev = {
      visitors: Number(previous?.visitors || 0),
      pageviews: Number(previous?.pageviews || 0),
      sessions: Number(previous?.sessions || 0),
    };

    const pctChange = (cur: number, prev: number): number =>
      prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 100);

    setCacheHeaders(c, period);
    return c.json({
      data: {
        visitors: cur.visitors,
        pageviews: cur.pageviews,
        sessions: cur.sessions,
        bounceRate: 0,
        visitorsChange: pctChange(cur.visitors, prev.visitors),
        pageviewsChange: pctChange(cur.pageviews, prev.pageviews),
        sessionsChange: pctChange(cur.sessions, prev.sessions),
      },
    });
  })

  // Timeseries data for charts
  .get('/:siteId/stats/timeseries', requireAuth, zValidator('query', periodQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const { period } = c.req.valid('query');

    if (isArchivedPeriod(period)) {
      if (!(await verifySiteOwnership(c, siteId, userId)))
        return c.json({ error: 'Not found' }, 404);

      const db = c.get('db')!;
      const { from, to } = getDateRange(period);
      const data = await queryArchivedTimeseries(db, siteId, from, to, period);

      setCacheHeaders(c, period);
      return c.json({ data });
    }

    const siteKey = await getCachedSiteKey(c, siteId, userId);
    if (!siteKey) return c.json({ error: 'Not found' }, 404);

    const config = getQueryConfig(c);
    const rows = await queryAnalyticsEngine(config, buildTimeseriesQuery(siteKey, period));

    const data = rows.map((row: any) => ({
      date: row.t,
      visitors: Number(row.visitors || 0),
      pageviews: Number(row.pageviews || 0),
      sessions: Number(row.sessions || 0),
    }));

    setCacheHeaders(c, period);
    return c.json({ data });
  })

  // Top pages
  .get('/:siteId/stats/pages', requireAuth, zValidator('query', periodQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const { period } = c.req.valid('query');

    if (isArchivedPeriod(period)) {
      if (!(await verifySiteOwnership(c, siteId, userId)))
        return c.json({ error: 'Not found' }, 404);

      const db = c.get('db')!;
      const { from, to } = getDateRange(period);
      const data = await queryArchivedPages(db, siteId, from, to);

      setCacheHeaders(c, period);
      return c.json({ data });
    }

    const siteKey = await getCachedSiteKey(c, siteId, userId);
    if (!siteKey) return c.json({ error: 'Not found' }, 404);

    const config = getQueryConfig(c);
    const rows = await queryAnalyticsEngine(config, buildTopPagesQuery(siteKey, period));

    const data = rows.map((row: any) => ({
      name: row.pathname,
      visitors: Number(row.visitors || 0),
      pageviews: Number(row.pageviews || 0),
    }));

    setCacheHeaders(c, period);
    return c.json({ data });
  })

  // Top referrers
  .get('/:siteId/stats/referrers', requireAuth, zValidator('query', periodQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const { period } = c.req.valid('query');

    if (isArchivedPeriod(period)) {
      if (!(await verifySiteOwnership(c, siteId, userId)))
        return c.json({ error: 'Not found' }, 404);

      const db = c.get('db')!;
      const { from, to } = getDateRange(period);
      const data = await queryArchivedReferrers(db, siteId, from, to);

      setCacheHeaders(c, period);
      return c.json({ data });
    }

    const siteKey = await getCachedSiteKey(c, siteId, userId);
    if (!siteKey) return c.json({ error: 'Not found' }, 404);

    const config = getQueryConfig(c);
    const rows = await queryAnalyticsEngine(config, buildTopReferrersQuery(siteKey, period));

    const data = rows.map((row: any) => ({
      name: row.source,
      visitors: Number(row.visitors || 0),
    }));

    setCacheHeaders(c, period);
    return c.json({ data });
  })

  // UTM breakdown
  .get('/:siteId/stats/utm', requireAuth, zValidator('query', utmQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const { period, type } = c.req.valid('query');

    if (isArchivedPeriod(period)) {
      if (!(await verifySiteOwnership(c, siteId, userId)))
        return c.json({ error: 'Not found' }, 404);

      const db = c.get('db')!;
      const { from, to } = getDateRange(period);
      const data = await queryArchivedUtm(db, siteId, from, to, type);

      setCacheHeaders(c, period);
      return c.json({ data });
    }

    const siteKey = await getCachedSiteKey(c, siteId, userId);
    if (!siteKey) return c.json({ error: 'Not found' }, 404);

    const config = getQueryConfig(c);
    const rows = await queryAnalyticsEngine(config, buildUtmQuery(siteKey, period, type));

    const data = rows.map((row: any) => ({
      name: row.value,
      visitors: Number(row.visitors || 0),
      sessions: Number(row.sessions || 0),
    }));

    setCacheHeaders(c, period);
    return c.json({ data });
  })

  // Locations
  .get('/:siteId/stats/locations', requireAuth, zValidator('query', locationQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const { period, type } = c.req.valid('query');

    if (isArchivedPeriod(period)) {
      if (!(await verifySiteOwnership(c, siteId, userId)))
        return c.json({ error: 'Not found' }, 404);

      const db = c.get('db')!;
      const { from, to } = getDateRange(period);
      const data = await queryArchivedLocations(db, siteId, from, to, type);

      setCacheHeaders(c, period);
      return c.json({ data });
    }

    const siteKey = await getCachedSiteKey(c, siteId, userId);
    if (!siteKey) return c.json({ error: 'Not found' }, 404);

    const config = getQueryConfig(c);
    const rows = await queryAnalyticsEngine(config, buildLocationsQuery(siteKey, period, type));

    const data = rows.map((row: any) => ({
      name: row.name,
      code: row.name,
      visitors: Number(row.visitors || 0),
    }));

    setCacheHeaders(c, period);
    return c.json({ data });
  })

  // Devices / Browser / OS
  .get('/:siteId/stats/devices', requireAuth, zValidator('query', deviceQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const { period, type } = c.req.valid('query');

    if (isArchivedPeriod(period)) {
      if (!(await verifySiteOwnership(c, siteId, userId)))
        return c.json({ error: 'Not found' }, 404);

      const db = c.get('db')!;
      const { from, to } = getDateRange(period);
      const data = await queryArchivedDevices(db, siteId, from, to, type);

      setCacheHeaders(c, period);
      return c.json({ data });
    }

    const siteKey = await getCachedSiteKey(c, siteId, userId);
    if (!siteKey) return c.json({ error: 'Not found' }, 404);

    const config = getQueryConfig(c);
    const rows = await queryAnalyticsEngine(config, buildDevicesQuery(siteKey, period, type));

    const totalVisitors = rows.reduce((sum: number, r: any) => sum + Number(r.visitors || 0), 0);
    const data = rows.map((row: any) => {
      const visitors = Number(row.visitors || 0);
      return {
        name: row.name,
        visitors,
        percentage: totalVisitors > 0 ? Math.round((visitors / totalVisitors) * 100) : 0,
      };
    });

    setCacheHeaders(c, period);
    return c.json({ data });
  })

  // Realtime
  .get('/:siteId/stats/realtime', requireAuth, async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');

    const siteKey = await getCachedSiteKey(c, siteId, userId);
    if (!siteKey) return c.json({ error: 'Not found' }, 404);

    const config = getQueryConfig(c);
    const rows = await queryAnalyticsEngine(config, buildRealtimeQuery(siteKey));

    const currentVisitors = rows.reduce((sum: number, r: any) => sum + Number(r.visitors || 0), 0);
    const topPages = rows.map((row: any) => ({
      path: row.pathname,
      visitors: Number(row.visitors || 0),
    }));

    c.header('Cache-Control', 'private, max-age=10');
    return c.json({ data: { currentVisitors, topPages } });
  })

  // Custom events
  .get('/:siteId/stats/events', requireAuth, zValidator('query', periodQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const { period } = c.req.valid('query');

    if (isArchivedPeriod(period)) {
      if (!(await verifySiteOwnership(c, siteId, userId)))
        return c.json({ error: 'Not found' }, 404);

      const db = c.get('db')!;
      const { from, to } = getDateRange(period);
      const data = await queryArchivedEvents(db, siteId, from, to);

      setCacheHeaders(c, period);
      return c.json({ data });
    }

    const siteKey = await getCachedSiteKey(c, siteId, userId);
    if (!siteKey) return c.json({ error: 'Not found' }, 404);

    const config = getQueryConfig(c);
    const rows = await queryAnalyticsEngine(config, buildEventsQuery(siteKey, period));

    const data = rows.map((row: any) => ({
      name: row.name,
      count: Number(row.count || 0),
      totalValue: Number(row.total_value || 0),
    }));

    setCacheHeaders(c, period);
    return c.json({ data });
  });
