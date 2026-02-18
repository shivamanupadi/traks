import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { createId } from '@paralleldrive/cuid2';

// ============ Users (synced from Clerk) ============
export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // Clerk user ID
  email: text('email').notNull(),
  name: text('name'),
  imageUrl: text('image_url'),
  plan: text('plan').$type<'free' | 'pro' | 'business'>().default('free').notNull(),
  siteLimit: integer('site_limit').default(5).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// ============ Sites ============
export const sites = sqliteTable(
  'sites',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    domain: text('domain').notNull(),
    timezone: text('timezone').default('UTC').notNull(),
    public: integer('public', { mode: 'boolean' }).default(false).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  table => [
    index('sites_user_id_idx').on(table.userId),
    uniqueIndex('sites_domain_idx').on(table.domain),
  ]
);

// ============ API Keys ============
export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull().default('Default'),
    key: text('key').notNull(), // "pb_live_xxxx"
    lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
  },
  table => [
    uniqueIndex('api_keys_key_idx').on(table.key),
    index('api_keys_site_id_idx').on(table.siteId),
    index('api_keys_user_id_idx').on(table.userId),
  ]
);

// ============ Daily Archive Tables ============

export const dailyStats = sqliteTable(
  'daily_stats',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    date: text('date').notNull(), // YYYY-MM-DD
    visitors: integer('visitors').notNull().default(0),
    pageviews: integer('pageviews').notNull().default(0),
    sessions: integer('sessions').notNull().default(0),
  },
  table => [
    uniqueIndex('daily_stats_site_date_idx').on(table.siteId, table.date),
  ]
);

export const dailyPages = sqliteTable(
  'daily_pages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    pathname: text('pathname').notNull(),
    visitors: integer('visitors').notNull().default(0),
    pageviews: integer('pageviews').notNull().default(0),
  },
  table => [
    index('daily_pages_site_date_idx').on(table.siteId, table.date),
  ]
);

export const dailyReferrers = sqliteTable(
  'daily_referrers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    source: text('source').notNull(),
    visitors: integer('visitors').notNull().default(0),
  },
  table => [
    index('daily_referrers_site_date_idx').on(table.siteId, table.date),
  ]
);

export const dailyLocations = sqliteTable(
  'daily_locations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    type: text('type').notNull(), // 'country' | 'city'
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
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    type: text('type').notNull(), // 'browser' | 'os' | 'device'
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
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    type: text('type').notNull(), // 'source' | 'medium' | 'campaign'
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
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
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
  siteId: text('site_id')
    .primaryKey()
    .references(() => sites.id, { onDelete: 'cascade' }),
  lastArchivedDate: text('last_archived_date'), // YYYY-MM-DD
  lastR2ArchivedDate: text('last_r2_archived_date'),
  status: text('status').$type<'idle' | 'running' | 'error'>().default('idle').notNull(),
  lastError: text('last_error'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
