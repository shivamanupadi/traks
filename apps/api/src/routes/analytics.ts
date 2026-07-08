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
  type PeriodRange,
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

async function getSite(c: AppContext, siteId: string, userId: string): Promise<SiteRecord | null> {
  const db = c.get('db')!;
  const [result] = await db
    .select({ siteId: sites.id, key: apiKeys.key, timezone: sites.timezone })
    .from(sites)
    .innerJoin(apiKeys, eq(sites.id, apiKeys.siteId))
    .where(and(eq(sites.id, siteId), eq(sites.userId, userId), isNull(apiKeys.revokedAt)))
    .limit(1);
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

/**
 * Assemble MainStats from the two single-scan comparison queries.
 * Each query returns up to two rows labeled 'current' / 'previous';
 * a window with no events simply has no row.
 */
function assembleMainStats(statRows: PeriodStatsRow[], sessionRows: SessionStatsRow[]) {
  const pick = <T extends { period: string }>(rows: T[], period: string) =>
    rows.find(r => r.period === period);

  const cur = pick(statRows, 'current');
  const prev = pick(statRows, 'previous');
  const curSessions = pick(sessionRows, 'current');
  const prevSessions = pick(sessionRows, 'previous');

  const bounceRate = (row?: SessionStatsRow): number => {
    const total = toNumber(row?.sessions);
    return total > 0 ? Math.round((toNumber(row?.bounces) / total) * 100) : 0;
  };

  const curBounce = bounceRate(curSessions);
  const prevBounce = bounceRate(prevSessions);

  return {
    visitors: toNumber(cur?.visitors),
    pageviews: toNumber(cur?.pageviews),
    sessions: toNumber(cur?.sessions),
    bounceRate: curBounce,
    visitorsChange: pctChange(toNumber(cur?.visitors), toNumber(prev?.visitors)),
    pageviewsChange: pctChange(toNumber(cur?.pageviews), toNumber(prev?.pageviews)),
    sessionsChange: pctChange(toNumber(cur?.sessions), toNumber(prev?.sessions)),
    // Percentage-point delta, not relative change - conventional for bounce rate.
    bounceRateChange: curBounce - prevBounce,
  };
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

export const analyticsRoute = app
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

    const config = getQueryConfig(c);
    const now = new Date();

    // Sites with no events still need an entry so tiles render zeros.
    const results: Record<string, { visitors: number; pageviews: number; sessions: number }> = {};
    for (const { siteId } of siteRecords) {
      results[siteId] = { visitors: 0, pageviews: 0, sessions: 0 };
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
          const rows = await queryR2Sql<{
            site_id: string;
            visitors: unknown;
            pageviews: unknown;
            sessions: unknown;
          }>(
            config,
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
  })

  // All stats in a single request (used on site analytics page)
  .get('/:siteId/stats/all', requireAuth, zValidator('query', periodQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const { period } = c.req.valid('query');

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    const now = new Date();
    const range = resolvePeriod(period, now, site.timezone);
    const config = getQueryConfig(c);

    const outcome = await runQueries(c, () =>
      Promise.all([
        queryR2Sql<PeriodStatsRow>(config, buildStatsWithComparisonQuery(site.key, range)),
        queryR2Sql<SessionStatsRow>(config, buildSessionStatsQuery(site.key, range)),
        queryR2Sql<{ t: string; visitors: unknown; pageviews: unknown; sessions: unknown }>(
          config,
          buildTimeseriesQuery(site.key, range)
        ),
        queryR2Sql<{ pathname: string; visitors: unknown; pageviews: unknown }>(
          config,
          buildTopPagesQuery(site.key, range)
        ),
        queryR2Sql<{ source: string; visitors: unknown }>(
          config,
          buildTopReferrersQuery(site.key, range)
        ),
        queryR2Sql<{ name: string; visitors: unknown }>(
          config,
          buildLocationsQuery(site.key, range, 'country')
        ),
        queryR2Sql<{ name: string; visitors: unknown }>(
          config,
          buildDevicesQuery(site.key, range, 'browser')
        ),
        queryR2Sql<{ name: string; visitors: unknown }>(
          config,
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

    return c.json({
      data: {
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
      },
    });
  })

  .get('/:siteId/stats/main', requireAuth, zValidator('query', periodQuery), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const { period } = c.req.valid('query');

    const site = await getSite(c, siteId, userId);
    if (!site) return c.json({ error: 'Not found' }, 404);

    const range = resolvePeriod(period, new Date(), site.timezone);
    const config = getQueryConfig(c);

    const outcome = await runQueries(c, () =>
      Promise.all([
        queryR2Sql<PeriodStatsRow>(config, buildStatsWithComparisonQuery(site.key, range)),
        queryR2Sql<SessionStatsRow>(config, buildSessionStatsQuery(site.key, range)),
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

    const range = resolvePeriod(period, new Date(), site.timezone);
    const config = getQueryConfig(c);

    const outcome = await runQueries(c, () =>
      queryR2Sql<{ t: string; visitors: unknown; pageviews: unknown; sessions: unknown }>(
        config,
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

    const range = resolvePeriod(period, new Date(), site.timezone);
    const config = getQueryConfig(c);

    const outcome = await runQueries(c, () =>
      queryR2Sql<{ pathname: string; visitors: unknown; pageviews: unknown }>(
        config,
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

    const range = resolvePeriod(period, new Date(), site.timezone);
    const config = getQueryConfig(c);

    const outcome = await runQueries(c, () =>
      queryR2Sql<{ source: string; visitors: unknown }>(
        config,
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

    const range = resolvePeriod(period, new Date(), site.timezone);
    const config = getQueryConfig(c);

    const outcome = await runQueries(c, () =>
      queryR2Sql<{ value: string; visitors: unknown; sessions: unknown }>(
        config,
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

    const range = resolvePeriod(period, new Date(), site.timezone);
    const config = getQueryConfig(c);

    const outcome = await runQueries(c, () =>
      queryR2Sql<{ name: string; visitors: unknown }>(
        config,
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

    const range = resolvePeriod(period, new Date(), site.timezone);
    const config = getQueryConfig(c);

    const outcome = await runQueries(c, () =>
      queryR2Sql<{ name: string; visitors: unknown }>(
        config,
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

    const config = getQueryConfig(c);
    const outcome = await runQueries(c, () =>
      queryR2Sql<{ visitors: unknown; pathname: string }>(
        config,
        buildRealtimeQuery(site.key, new Date())
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

    const range = resolvePeriod(period, new Date(), site.timezone);
    const config = getQueryConfig(c);

    const outcome = await runQueries(c, () =>
      queryR2Sql<{ name: string; count: unknown; total_value: unknown }>(
        config,
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
