import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import type { Bindings, Variables } from './types';
import { getAuth, claimStatus } from './lib/auth';
import { sitesRoute } from './routes/sites';
import { analyticsRoute } from './routes/analytics';
import { meRoute } from './routes/me';
import { deployRoute, oauthCallback } from './routes/deploy';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use('/api/*', async (c, next) => {
  c.set('db', drizzle(c.env.DB));
  await next();
});

// Health — /api/health is the canonical path (the traks.dev/api/* zone route
// only forwards /api/*); the root paths remain for direct worker access.
app.get('/', c => c.json({ name: 'traks-api', status: 'ok' }));
app.get('/health', c => c.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/api/health', c => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Better Auth: sign-up/sign-in/sign-out/session under /api/auth/*
app.on(['GET', 'POST'], '/api/auth/*', c => getAuth(c.env, c.req.url).handler(c.req.raw));

// Login page switch: first-run claim screen vs sign-in screen.
app.get('/api/claim-status', async c => c.json({ claimed: await claimStatus(c.env) }));

// Public instance config for the SPA (pre-auth): where the collect worker
// lives, so install snippets and docs show this deployment's URL rather
// than a baked-in default.
app.get('/api/config', c =>
  c.json({ collectUrl: c.env.COLLECT_URL, oauthEnabled: Boolean(c.env.CF_OAUTH_CLIENT_ID) })
);

// "Sign in with Cloudflare" redirect URI (registered on the OAuth client, so
// it lives at the top level — run_worker_first routes it past the SPA assets).
app.get('/deploy/callback', oauthCallback);

// Routes - chained for Hono RPC type inference
const routes = app
  .route('/api/deploy', deployRoute)
  .route('/api/me', meRoute)
  .route('/api/sites', sitesRoute)
  .route('/api/analytics', analyticsRoute);

// Unmatched non-API paths are SPA routes (/login, /portal/…): serve the
// assets fallback (index.html). Assets that exist never reach the worker.
app.notFound(c => {
  if (!c.req.path.startsWith('/api/') && c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.json({ error: 'Not found' }, 404);
});
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export type AppType = typeof routes;
export default app;
