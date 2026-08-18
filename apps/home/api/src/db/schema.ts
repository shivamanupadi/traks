import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { createId } from '@paralleldrive/cuid2';

// Deploy-wizard registry - the ONLY table in the home (traks.dev) database.
// Tracks wizard deployments into USER accounts. Never stores tokens - only
// non-sensitive state so a returning ?instance= URL can resume its screen.
// Completely separate from the platform schema that ships to customer
// instances; nothing here ever appears in a customer's D1.
export const deployInstances = sqliteTable('deploy_instances', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  status: text('status')
    .$type<'new' | 'deploying' | 'ready' | 'failed' | 'destroyed'>()
    .default('new')
    .notNull(),
  accountId: text('account_id'),
  instanceName: text('instance_name'),
  apiUrl: text('api_url'),
  collectUrl: text('collect_url'),
  error: text('error'),
  /** Release version installed by the last successful run (manifest.version). */
  deployedVersion: text('deployed_version'),
  /** Custom-domain choice, so updates re-deploy onto the same hostnames. */
  customDomain: text('custom_domain', { mode: 'json' }).$type<{
    zoneId: string;
    zoneName: string;
    subdomain: string;
  } | null>(),
  /** Step-event log (label/status/detail) for progress replay on resume. */
  steps: text('steps', { mode: 'json' }).$type<
    { stepId: string; label: string; status: string; detail?: string }[]
  >(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
