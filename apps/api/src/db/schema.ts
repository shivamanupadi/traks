import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { createId } from '@paralleldrive/cuid2';
import type { FunnelStep, SegmentFilters } from '@traks/shared';

// ============ Users (owned by Better Auth; app fields alongside) ============
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).default(false).notNull(),
    name: text('name'),
    imageUrl: text('image_url'),
    plan: text('plan').$type<'free' | 'pro' | 'business'>().default('free').notNull(),
    siteLimit: integer('site_limit').default(5).notNull(),
    // Dodo Payments linkage
    dodoCustomerId: text('dodo_customer_id'),
    dodoSubscriptionId: text('dodo_subscription_id'),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  table => [uniqueIndex('users_email_idx').on(table.email)]
);

// ============ Auth (Better Auth core tables) ============
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  table => [
    uniqueIndex('sessions_token_idx').on(table.token),
    index('sessions_user_id_idx').on(table.userId),
  ]
);

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  table => [index('accounts_user_id_idx').on(table.userId)]
);

export const verifications = sqliteTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
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

// ============ Goals (conversion targets: a custom event name or a pathname) ============
export const goals = sqliteTable(
  'goals',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').$type<'event' | 'page'>().notNull(),
    /** event_name for 'event' goals, pathname for 'page' goals. */
    target: text('target').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  table => [index('goals_site_id_idx').on(table.siteId)]
);

// ============ Segments (named saved filter sets) ============
export const segments = sqliteTable(
  'segments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Filter dimensions to apply together, validated by createSegmentSchema. */
    filters: text('filters', { mode: 'json' }).$type<SegmentFilters>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  table => [index('segments_site_id_idx').on(table.siteId)]
);

// ============ Funnels (ordered conversion steps over pages/events) ============
export const funnels = sqliteTable(
  'funnels',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Ordered steps (2-8), validated by createFunnelSchema at the API edge. */
    steps: text('steps', { mode: 'json' }).$type<FunnelStep[]>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  },
  table => [index('funnels_site_id_idx').on(table.siteId)]
);

// ============ Web installer (traks.dev/deploy) instance registry ============
// Tracks wizard deployments into USER accounts. Never stores tokens — only
// non-sensitive state so a returning ?instance= URL can resume its screen.
export const deployInstances = sqliteTable('deploy_instances', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  status: text('status').$type<'new' | 'deploying' | 'ready' | 'failed'>().default('new').notNull(),
  accountId: text('account_id'),
  instanceName: text('instance_name'),
  apiUrl: text('api_url'),
  collectUrl: text('collect_url'),
  error: text('error'),
  /** Step-event log (label/status/detail) for progress replay on resume. */
  steps: text('steps', { mode: 'json' }).$type<
    { stepId: string; label: string; status: string; detail?: string }[]
  >(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
