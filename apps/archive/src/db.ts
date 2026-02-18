import { eq, and, isNull, sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import type { DrizzleD1Database } from 'drizzle-orm/d1';

// Re-declare tables inline to avoid cross-app import from apps/api
// These must stay in sync with apps/api/src/db/schema.ts

const sites = sqliteTable(
  'sites',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    domain: text('domain').notNull(),
  }
);

const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    siteId: text('site_id').notNull(),
    key: text('key').notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
  }
);

const dailyStats = sqliteTable(
  'daily_stats',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteId: text('site_id').notNull(),
    date: text('date').notNull(),
    visitors: integer('visitors').notNull().default(0),
    pageviews: integer('pageviews').notNull().default(0),
    sessions: integer('sessions').notNull().default(0),
  },
  table => [
    uniqueIndex('daily_stats_site_date_idx').on(table.siteId, table.date),
  ]
);

const dailyPages = sqliteTable(
  'daily_pages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteId: text('site_id').notNull(),
    date: text('date').notNull(),
    pathname: text('pathname').notNull(),
    visitors: integer('visitors').notNull().default(0),
    pageviews: integer('pageviews').notNull().default(0),
  },
  table => [
    index('daily_pages_site_date_idx').on(table.siteId, table.date),
  ]
);

const dailyReferrers = sqliteTable(
  'daily_referrers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteId: text('site_id').notNull(),
    date: text('date').notNull(),
    source: text('source').notNull(),
    visitors: integer('visitors').notNull().default(0),
  },
  table => [
    index('daily_referrers_site_date_idx').on(table.siteId, table.date),
  ]
);

const dailyLocations = sqliteTable(
  'daily_locations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteId: text('site_id').notNull(),
    date: text('date').notNull(),
    type: text('type').notNull(),
    name: text('name').notNull(),
    visitors: integer('visitors').notNull().default(0),
  },
  table => [
    index('daily_locations_site_date_idx').on(table.siteId, table.date),
  ]
);

const dailyDevices = sqliteTable(
  'daily_devices',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteId: text('site_id').notNull(),
    date: text('date').notNull(),
    type: text('type').notNull(),
    name: text('name').notNull(),
    visitors: integer('visitors').notNull().default(0),
  },
  table => [
    index('daily_devices_site_date_idx').on(table.siteId, table.date),
  ]
);

const dailyUtm = sqliteTable(
  'daily_utm',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteId: text('site_id').notNull(),
    date: text('date').notNull(),
    type: text('type').notNull(),
    value: text('value').notNull(),
    visitors: integer('visitors').notNull().default(0),
    sessions: integer('sessions').notNull().default(0),
  },
  table => [
    index('daily_utm_site_date_idx').on(table.siteId, table.date),
  ]
);

const dailyEvents = sqliteTable(
  'daily_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteId: text('site_id').notNull(),
    date: text('date').notNull(),
    name: text('name').notNull(),
    count: integer('count').notNull().default(0),
    totalValue: real('total_value').notNull().default(0),
  },
  table => [
    index('daily_events_site_date_idx').on(table.siteId, table.date),
  ]
);

export const archiveState = sqliteTable('archive_state', {
  siteId: text('site_id').primaryKey(),
  lastArchivedDate: text('last_archived_date'),
  lastR2ArchivedDate: text('last_r2_archived_date'),
  status: text('status').default('idle').notNull(),
  lastError: text('last_error'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

type DB = DrizzleD1Database;

export interface SiteWithKey {
  id: string;
  domain: string;
  key: string;
}

export async function getAllActiveSites(db: DB): Promise<SiteWithKey[]> {
  const rows = await db
    .select({
      id: sites.id,
      domain: sites.domain,
      key: apiKeys.key,
    })
    .from(sites)
    .innerJoin(apiKeys, eq(sites.id, apiKeys.siteId))
    .where(isNull(apiKeys.revokedAt));

  // Deduplicate: a site with multiple active API keys produces multiple rows
  const seen = new Set<string>();
  return rows.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

export async function upsertDailyStats(
  db: DB,
  siteId: string,
  date: string,
  data: { visitors: number; pageviews: number; sessions: number }
): Promise<void> {
  await db
    .insert(dailyStats)
    .values({ siteId, date, ...data })
    .onConflictDoUpdate({
      target: [dailyStats.siteId, dailyStats.date],
      set: { visitors: sql`excluded.visitors`, pageviews: sql`excluded.pageviews`, sessions: sql`excluded.sessions` },
    });
}

export async function upsertDailyPages(
  db: DB,
  siteId: string,
  date: string,
  rows: { pathname: string; visitors: number; pageviews: number }[]
): Promise<void> {
  if (rows.length === 0) return;
  await db.batch([
    db.delete(dailyPages).where(and(eq(dailyPages.siteId, siteId), eq(dailyPages.date, date))),
    db.insert(dailyPages).values(rows.map(r => ({ siteId, date, ...r }))),
  ]);
}

export async function upsertDailyReferrers(
  db: DB,
  siteId: string,
  date: string,
  rows: { source: string; visitors: number }[]
): Promise<void> {
  if (rows.length === 0) return;
  await db.batch([
    db.delete(dailyReferrers).where(and(eq(dailyReferrers.siteId, siteId), eq(dailyReferrers.date, date))),
    db.insert(dailyReferrers).values(rows.map(r => ({ siteId, date, ...r }))),
  ]);
}

export async function upsertDailyLocations(
  db: DB,
  siteId: string,
  date: string,
  rows: { type: string; name: string; visitors: number }[]
): Promise<void> {
  if (rows.length === 0) return;
  await db.batch([
    db.delete(dailyLocations).where(and(eq(dailyLocations.siteId, siteId), eq(dailyLocations.date, date))),
    db.insert(dailyLocations).values(rows.map(r => ({ siteId, date, ...r }))),
  ]);
}

export async function upsertDailyDevices(
  db: DB,
  siteId: string,
  date: string,
  rows: { type: string; name: string; visitors: number }[]
): Promise<void> {
  if (rows.length === 0) return;
  await db.batch([
    db.delete(dailyDevices).where(and(eq(dailyDevices.siteId, siteId), eq(dailyDevices.date, date))),
    db.insert(dailyDevices).values(rows.map(r => ({ siteId, date, ...r }))),
  ]);
}

export async function upsertDailyUtm(
  db: DB,
  siteId: string,
  date: string,
  rows: { type: string; value: string; visitors: number; sessions: number }[]
): Promise<void> {
  if (rows.length === 0) return;
  await db.batch([
    db.delete(dailyUtm).where(and(eq(dailyUtm.siteId, siteId), eq(dailyUtm.date, date))),
    db.insert(dailyUtm).values(rows.map(r => ({ siteId, date, ...r }))),
  ]);
}

export async function upsertDailyEvents(
  db: DB,
  siteId: string,
  date: string,
  rows: { name: string; count: number; totalValue: number }[]
): Promise<void> {
  if (rows.length === 0) return;
  await db.batch([
    db.delete(dailyEvents).where(and(eq(dailyEvents.siteId, siteId), eq(dailyEvents.date, date))),
    db.insert(dailyEvents).values(rows.map(r => ({ siteId, date, ...r }))),
  ]);
}

export async function updateArchiveState(
  db: DB,
  siteId: string,
  date: string,
  r2Date: string | null,
  status: 'idle' | 'running' | 'error',
  error?: string
): Promise<void> {
  await db
    .insert(archiveState)
    .values({
      siteId,
      lastArchivedDate: date,
      lastR2ArchivedDate: r2Date,
      status,
      lastError: error || null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: archiveState.siteId,
      set: {
        // Only advance lastArchivedDate forward, never roll it back
        lastArchivedDate: sql`MAX(COALESCE(${archiveState.lastArchivedDate}, ''), excluded.last_archived_date)`,
        lastR2ArchivedDate: sql`CASE WHEN excluded.last_r2_archived_date IS NOT NULL THEN MAX(COALESCE(${archiveState.lastR2ArchivedDate}, ''), excluded.last_r2_archived_date) ELSE ${archiveState.lastR2ArchivedDate} END`,
        status: sql`excluded.status`,
        lastError: sql`excluded.last_error`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}
