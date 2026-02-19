import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { createId } from '@paralleldrive/cuid2';

// Re-export shared archive tables so Drizzle Kit migrations still see them
export {
  dailyStats,
  dailyPages,
  dailyReferrers,
  dailyLocations,
  dailyDevices,
  dailyUtm,
  dailyEvents,
  archiveState,
} from '@traks/shared';

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

