import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import type { Bindings, Variables } from './types';
import { getAuth, claimStatus } from './lib/auth';
import { sitesRoute } from './routes/sites';
import { analyticsRoute } from './routes/analytics';
import { meRoute } from './routes/me';

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
// Credential attempts are IP-throttled first — reads (session lookups) are
// left alone so an open dashboard is never throttled out of its own session.
app.on(['GET', 'POST'], '/api/auth/*', async c => {
  const path = new URL(c.req.url).pathname;
  const isCredentialAttempt =
    c.req.method === 'POST' && (path.includes('/sign-in') || path.includes('/sign-up'));
  if (isCredentialAttempt && c.env.AUTH_LIMIT) {
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
    const { success } = await c.env.AUTH_LIMIT.limit({ key: ip });
    if (!success) {
      return c.json({ error: 'Too many attempts — try again in a minute' }, 429);
    }
  }
  return getAuth(c.env, c.req.url).handler(c.req.raw);
});

// Login page switch: first-run claim screen vs sign-in screen. On unclaimed
// wizard-deployed instances the owner email is fixed at deploy time — expose
// it (pre-claim only) so the claim form can prefill and lock the field.
app.get('/api/claim-status', async c => {
  const claimed = await claimStatus(c.env);
  return c.json({ claimed, ownerEmail: !claimed ? c.env.OWNER_EMAIL : undefined });
});

// Public instance config for the SPA (pre-auth): where the collect worker
// lives, so install snippets and docs show this deployment's URL rather
// than a baked-in default.
app.get('/api/config', c =>
  c.json({
    collectUrl: c.env.COLLECT_URL,
    version: c.env.TRAKS_VERSION,
    deployInstanceId: c.env.DEPLOY_INSTANCE_ID,
  })
);

// Routes - chained for Hono RPC type inference
const routes = app
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
