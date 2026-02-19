import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { drizzle } from 'drizzle-orm/d1';
import type { Bindings, Variables } from './types';
import { sitesRoute } from './routes/sites';
import { analyticsRoute } from './routes/analytics';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Create Drizzle instance once per request and cache site keys
app.use('/api/*', async (c, next) => {
  c.set('db', drizzle(c.env.DB));
  c.set('siteKeyCache', new Map());
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
const routes = app.route('/api/sites', sitesRoute).route('/api/analytics', analyticsRoute);

app.notFound(c => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export type AppType = typeof routes;
export default app;
