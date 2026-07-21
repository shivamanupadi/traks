import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { drizzle } from 'drizzle-orm/d1';
import type { Bindings, Variables } from './types';
import { sitesRoute } from './routes/sites';
import { analyticsRoute } from './routes/analytics';
import { exportsRoute } from './routes/exports';
import { publicRoute } from './routes/public';
import { accountRoute } from './routes/account';
import { clerkWebhookRoute } from './routes/webhooks';
import { runNightlyExports } from './lib/exports';
import { runDigest, runFreshnessCheck } from './lib/ops';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use('/api/*', async (c, next) => {
  c.set('db', drizzle(c.env.DB));
  await next();
});

// CORS
app.use(
  '/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

// Health
app.get('/', c => c.json({ name: 'traks-api', status: 'ok' }));
app.get('/health', c => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Routes - chained for Hono RPC type inference
const routes = app
  .route('/api/sites', sitesRoute)
  .route('/api/analytics', analyticsRoute)
  .route('/api/exports', exportsRoute)
  .route('/api/public', publicRoute)
  .route('/api/account', accountRoute);

// Webhooks live outside the RPC chain (external callers, not the web app).
app.route('/api/webhooks/clerk', clerkWebhookRoute);

app.notFound(c => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export type AppType = typeof routes;
export default {
  fetch: app.fetch,
  scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext): void {
    switch (event.cron) {
      case '30 3 * * *': // nightly raw-data exports
        ctx.waitUntil(runNightlyExports(env));
        break;
      case '0 8 * * 1': // Monday weekly email digest
        ctx.waitUntil(runDigest(env, 'weekly'));
        break;
      case '0 4 * * *': // daily email digest (yesterday's numbers)
        ctx.waitUntil(runDigest(env, 'daily'));
        break;
      case '*/30 * * * *': // pipeline freshness healthcheck
        ctx.waitUntil(runFreshnessCheck(env));
        break;
      default:
        console.warn(`[cron] unknown schedule: ${event.cron}`);
    }
  },
};
