import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, lt } from 'drizzle-orm';
import type { Bindings, Variables } from './types';
import { deployInstances } from './db/schema';
import { deployRoute, oauthCallback } from './deploy/routes';

/**
 * traks.dev home worker: the deploy-wizard BACKEND only. Physically separate
 * from the platform api that ships to customer instances — different worker,
 * different codebase entry, different D1. The marketing site + wizard UI is
 * the traks-site static worker; this one claims traks.dev/api/* and
 * /deploy/callback via zone routes.
 */
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use('/api/*', async (c, next) => {
  c.set('db', drizzle(c.env.DB));
  await next();
});

app.get('/', c => c.json({ name: 'traks-home-api', status: 'ok' }));
app.get('/api/health', c => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Wizard bootstrap config: is "Sign in with Cloudflare" available?
app.get('/api/config', c => c.json({ oauthEnabled: Boolean(c.env.CF_OAUTH_CLIENT_ID) }));

// "Sign in with Cloudflare" redirect URI (registered on the OAuth client).
app.get('/deploy/callback', oauthCallback);

const routes = app.route('/api/deploy', deployRoute);

app.notFound(c => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export type AppType = typeof routes;

/**
 * Nightly registry sweep. Creating a wizard session is anonymous and cheap, so
 * without this the table only ever grows — every abandoned visit, bot, and
 * probe leaves a row behind. Only sessions that never got past 'new' are
 * removed, and only after a day: anything that reached deploying/ready/failed
 * is real deployment history and is kept.
 */
async function sweepAbandonedSessions(env: Bindings): Promise<void> {
  const db = drizzle(env.DB);
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db
    .delete(deployInstances)
    .where(and(eq(deployInstances.status, 'new'), lt(deployInstances.createdAt, cutoff)));
}

export default {
  fetch: app.fetch,
  scheduled: async (
    _event: unknown,
    env: Bindings,
    ctx: { waitUntil(p: Promise<unknown>): void }
  ) => {
    ctx.waitUntil(sweepAbandonedSessions(env).catch(err => console.error('[sweep] failed:', err)));
  },
};
