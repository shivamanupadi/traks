import { sql, eq, and, gte, lte, desc, sum } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { ArchivedPeriod } from '@traks/shared';
import {
  dailyStats,
  dailyPages,
  dailyReferrers,
  dailyLocations,
  dailyDevices,
  dailyUtm,
  dailyEvents,
} from '../db/schema';

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function getDateRange(period: ArchivedPeriod): { from: string; to: string } {
  const to = formatDate(new Date());
  const now = new Date();
  switch (period) {
    case '6m':
      now.setDate(now.getDate() - 180);
      return { from: formatDate(now), to };
    case '1y':
      now.setDate(now.getDate() - 365);
      return { from: formatDate(now), to };
    case 'all':
      return { from: '2000-01-01', to };
  }
}

export async function queryArchivedStats(
  db: DrizzleD1Database,
  siteId: string,
  from: string,
  to: string
) {
  const [row] = await db
    .select({
      visitors: sum(dailyStats.visitors).mapWith(Number),
      pageviews: sum(dailyStats.pageviews).mapWith(Number),
      sessions: sum(dailyStats.sessions).mapWith(Number),
    })
    .from(dailyStats)
    .where(
      and(eq(dailyStats.siteId, siteId), gte(dailyStats.date, from), lte(dailyStats.date, to))
    );

  return {
    visitors: row?.visitors || 0,
    pageviews: row?.pageviews || 0,
    sessions: row?.sessions || 0,
  };
}

export async function queryArchivedTimeseries(
  db: DrizzleD1Database,
  siteId: string,
  from: string,
  to: string,
  period: ArchivedPeriod
) {
  // For 'all' with >365 days, roll up to weekly
  const daysDiff =
    (new Date(to).getTime() - new Date(from).getTime()) / (1000 * 60 * 60 * 24);
  const useWeekly = period === 'all' && daysDiff > 365;

  if (useWeekly) {
    // Group by ISO week start (Monday) using strftime
    const rows = await db
      .select({
        date: sql<string>`date(${dailyStats.date}, 'weekday 0', '-6 days')`.as('week_start'),
        visitors: sum(dailyStats.visitors).mapWith(Number),
        pageviews: sum(dailyStats.pageviews).mapWith(Number),
        sessions: sum(dailyStats.sessions).mapWith(Number),
      })
      .from(dailyStats)
      .where(
        and(eq(dailyStats.siteId, siteId), gte(dailyStats.date, from), lte(dailyStats.date, to))
      )
      .groupBy(sql`week_start`)
      .orderBy(sql`week_start`);

    return rows.map(r => ({
      date: r.date,
      visitors: r.visitors || 0,
      pageviews: r.pageviews || 0,
      sessions: r.sessions || 0,
    }));
  }

  // Daily granularity
  const rows = await db
    .select({
      date: dailyStats.date,
      visitors: dailyStats.visitors,
      pageviews: dailyStats.pageviews,
      sessions: dailyStats.sessions,
    })
    .from(dailyStats)
    .where(
      and(eq(dailyStats.siteId, siteId), gte(dailyStats.date, from), lte(dailyStats.date, to))
    )
    .orderBy(dailyStats.date);

  return rows.map(r => ({
    date: r.date,
    visitors: r.visitors,
    pageviews: r.pageviews,
    sessions: r.sessions,
  }));
}

export async function queryArchivedPages(
  db: DrizzleD1Database,
  siteId: string,
  from: string,
  to: string,
  limit = 10
) {
  const rows = await db
    .select({
      name: dailyPages.pathname,
      visitors: sum(dailyPages.visitors).mapWith(Number),
      pageviews: sum(dailyPages.pageviews).mapWith(Number),
    })
    .from(dailyPages)
    .where(
      and(eq(dailyPages.siteId, siteId), gte(dailyPages.date, from), lte(dailyPages.date, to))
    )
    .groupBy(dailyPages.pathname)
    .orderBy(desc(sum(dailyPages.visitors)))
    .limit(limit);

  return rows.map(r => ({
    name: r.name,
    visitors: r.visitors || 0,
    pageviews: r.pageviews || 0,
  }));
}

export async function queryArchivedReferrers(
  db: DrizzleD1Database,
  siteId: string,
  from: string,
  to: string,
  limit = 10
) {
  const rows = await db
    .select({
      name: dailyReferrers.source,
      visitors: sum(dailyReferrers.visitors).mapWith(Number),
    })
    .from(dailyReferrers)
    .where(
      and(
        eq(dailyReferrers.siteId, siteId),
        gte(dailyReferrers.date, from),
        lte(dailyReferrers.date, to)
      )
    )
    .groupBy(dailyReferrers.source)
    .orderBy(desc(sum(dailyReferrers.visitors)))
    .limit(limit);

  return rows.map(r => ({
    name: r.name,
    visitors: r.visitors || 0,
  }));
}

export async function queryArchivedLocations(
  db: DrizzleD1Database,
  siteId: string,
  from: string,
  to: string,
  type: string,
  limit = 10
) {
  const rows = await db
    .select({
      name: dailyLocations.name,
      visitors: sum(dailyLocations.visitors).mapWith(Number),
    })
    .from(dailyLocations)
    .where(
      and(
        eq(dailyLocations.siteId, siteId),
        eq(dailyLocations.type, type),
        gte(dailyLocations.date, from),
        lte(dailyLocations.date, to)
      )
    )
    .groupBy(dailyLocations.name)
    .orderBy(desc(sum(dailyLocations.visitors)))
    .limit(limit);

  return rows.map(r => ({
    name: r.name,
    code: r.name,
    visitors: r.visitors || 0,
  }));
}

export async function queryArchivedDevices(
  db: DrizzleD1Database,
  siteId: string,
  from: string,
  to: string,
  type: string,
  limit = 10
) {
  const rows = await db
    .select({
      name: dailyDevices.name,
      visitors: sum(dailyDevices.visitors).mapWith(Number),
    })
    .from(dailyDevices)
    .where(
      and(
        eq(dailyDevices.siteId, siteId),
        eq(dailyDevices.type, type),
        gte(dailyDevices.date, from),
        lte(dailyDevices.date, to)
      )
    )
    .groupBy(dailyDevices.name)
    .orderBy(desc(sum(dailyDevices.visitors)))
    .limit(limit);

  const totalVisitors = rows.reduce((s, r) => s + (r.visitors || 0), 0);
  return rows.map(r => {
    const visitors = r.visitors || 0;
    return {
      name: r.name,
      visitors,
      percentage: totalVisitors > 0 ? Math.round((visitors / totalVisitors) * 100) : 0,
    };
  });
}

export async function queryArchivedUtm(
  db: DrizzleD1Database,
  siteId: string,
  from: string,
  to: string,
  type: string,
  limit = 10
) {
  const rows = await db
    .select({
      name: dailyUtm.value,
      visitors: sum(dailyUtm.visitors).mapWith(Number),
      sessions: sum(dailyUtm.sessions).mapWith(Number),
    })
    .from(dailyUtm)
    .where(
      and(
        eq(dailyUtm.siteId, siteId),
        eq(dailyUtm.type, type),
        gte(dailyUtm.date, from),
        lte(dailyUtm.date, to)
      )
    )
    .groupBy(dailyUtm.value)
    .orderBy(desc(sum(dailyUtm.visitors)))
    .limit(limit);

  return rows.map(r => ({
    name: r.name,
    visitors: r.visitors || 0,
    sessions: r.sessions || 0,
  }));
}

export async function queryArchivedEvents(
  db: DrizzleD1Database,
  siteId: string,
  from: string,
  to: string,
  limit = 20
) {
  const rows = await db
    .select({
      name: dailyEvents.name,
      count: sum(dailyEvents.count).mapWith(Number),
      totalValue: sum(dailyEvents.totalValue).mapWith(Number),
    })
    .from(dailyEvents)
    .where(
      and(
        eq(dailyEvents.siteId, siteId),
        gte(dailyEvents.date, from),
        lte(dailyEvents.date, to)
      )
    )
    .groupBy(dailyEvents.name)
    .orderBy(desc(sum(dailyEvents.count)))
    .limit(limit);

  return rows.map(r => ({
    name: r.name,
    count: r.count || 0,
    totalValue: r.totalValue || 0,
  }));
}
