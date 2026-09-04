import { Hono } from 'hono';
import type { Bindings, Variables } from './types';
import { deployRoute, oauthCallback } from './deploy/routes';

export { DeploySession } from './deploy/session';

/**
 * traks.dev home worker: the deploy-wizard BACKEND only. Physically separate
 * from the platform api that ships to customer instances - different worker,
 * different codebase entry. It has no database: the only state is a
 * per-session Durable Object that wipes itself after a day (see
 * deploy/session.ts). The marketing site + wizard UI is the traks-site
 * static worker; this one claims traks.dev/api/* and /deploy/callback via
 * zone routes.
 */
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

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

export default { fetch: app.fetch };
