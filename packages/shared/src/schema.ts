import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

// ============ Daily Archive Tables ============
// Shared between apps/api (reads) and apps/archive (writes).
// FK constraints are defined in the API app's migration files, not here.

export const dailyStats = sqliteTable(
  'daily_stats',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteId: text('site_id').notNull(),
    date: text('date').notNull(),
    visitors: integer('visitors').notNull().default(0),
    pageviews: integer('pageviews').notNull().default(0),
    sessions: integer('sessions').notNull().default(0),
  },
  table => [uniqueIndex('daily_stats_site_date_idx').on(table.siteId, table.date)]
);

export const dailyPages = sqliteTable(
  'daily_pages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteId: text('site_id').notNull(),
    date: text('date').notNull(),
    pathname: text('pathname').notNull(),
    visitors: integer('visitors').notNull().default(0),
    pageviews: integer('pageviews').notNull().default(0),
  },
  table => [index('daily_pages_site_date_idx').on(table.siteId, table.date)]
);

export const dailyReferrers = sqliteTable(
  'daily_referrers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteId: text('site_id').notNull(),
    date: text('date').notNull(),
    source: text('source').notNull(),
    visitors: integer('visitors').notNull().default(0),
  },
  table => [index('daily_referrers_site_date_idx').on(table.siteId, table.date)]
);

export const dailyLocations = sqliteTable(
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
    index('daily_locations_site_type_date_idx').on(table.siteId, table.type, table.date),
  ]
);

export const dailyDevices = sqliteTable(
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
    index('daily_devices_site_type_date_idx').on(table.siteId, table.type, table.date),
  ]
);

export const dailyUtm = sqliteTable(
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
    index('daily_utm_site_type_date_idx').on(table.siteId, table.type, table.date),
  ]
);

export const dailyEvents = sqliteTable(
  'daily_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteId: text('site_id').notNull(),
    date: text('date').notNull(),
    name: text('name').notNull(),
    count: integer('count').notNull().default(0),
    totalValue: real('total_value').notNull().default(0),
  },
  table => [index('daily_events_site_date_idx').on(table.siteId, table.date)]
);

export const archiveState = sqliteTable('archive_state', {
  siteId: text('site_id').primaryKey(),
  lastArchivedDate: text('last_archived_date'),
  lastR2ArchivedDate: text('last_r2_archived_date'),
  status: text('status').default('idle').notNull(),
  lastError: text('last_error'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});
