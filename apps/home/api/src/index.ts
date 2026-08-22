import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { Bindings, Variables } from './types';
import { deployInstances } from './db/schema';
import { deployRoute, oauthCallback } from './deploy/routes';

/**
 * traks.dev home worker: the deploy-wizard BACKEND only. Physically separate
 * from the platform api that ships to customer instances - different worker,
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

/**
 * Operator-only deploy counts. Hidden: nothing links here, and without the
 * ADMIN_KEY secret the route is indistinguishable from a 404. Present the key
 * as `Authorization: Bearer <key>` or `?key=<key>` (the latter for a quick
 * browser look; it will appear in your own history/logs, so rotate if shared).
 * Aggregates only by default; `?detail=1` adds the live instances (name, URLs,
 * version, created) - still no tokens, emails, or step logs.
 */
app.get('/api/admin/instances', async c => {
  const expected = c.env.ADMIN_KEY;
  const auth = c.req.header('authorization') ?? '';
  const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : (c.req.query('key') ?? '');
  if (!expected || !timingSafeEqual(supplied, expected)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const db = c.get('db')!;
  const now = Date.now();
  const since = (days: number) => new Date(now - days * 86_400_000);

  const byStatus = await db
    .select({ status: deployInstances.status, n: sql<number>`count(*)` })
    .from(deployInstances)
    .groupBy(deployInstances.status);
  const [accounts] = await db
    .select({
      n: sql<number>`count(distinct ${deployInstances.accountId})`,
    })
    .from(deployInstances)
    .where(eq(deployInstances.status, 'ready'));
  const byVersion = await db
    .select({ version: deployInstances.deployedVersion, n: sql<number>`count(*)` })
    .from(deployInstances)
    .where(eq(deployInstances.status, 'ready'))
    .groupBy(deployInstances.deployedVersion);
  const [recent7] = await db
    .select({ n: sql<number>`count(*)` })
    .from(deployInstances)
    .where(and(eq(deployInstances.status, 'ready'), gte(deployInstances.createdAt, since(7))));
  const [recent30] = await db
    .select({ n: sql<number>`count(*)` })
    .from(deployInstances)
    .where(and(eq(deployInstances.status, 'ready'), gte(deployInstances.createdAt, since(30))));

  const status = Object.fromEntries(byStatus.map(r => [r.status, Number(r.n)]));
  const detail = c.req.query('detail') === '1';
  const instances = detail
    ? await db
        .select({
          instanceName: deployInstances.instanceName,
          apiUrl: deployInstances.apiUrl,
          collectUrl: deployInstances.collectUrl,
          version: deployInstances.deployedVersion,
          createdAt: deployInstances.createdAt,
          updatedAt: deployInstances.updatedAt,
        })
        .from(deployInstances)
        .where(eq(deployInstances.status, 'ready'))
        .orderBy(desc(deployInstances.createdAt))
    : undefined;
  return c.json({
    generatedAt: new Date(now).toISOString(),
    /** Instances currently deployed and healthy as far as the wizard knows. */
    live: status.ready ?? 0,
    /** Distinct Cloudflare accounts behind the live instances. */
    accounts: Number(accounts?.n ?? 0),
    /** Live instances whose last successful run was within the window. */
    newLast7d: Number(recent7?.n ?? 0),
    newLast30d: Number(recent30?.n ?? 0),
    byStatus: status,
    byVersion: Object.fromEntries(byVersion.map(r => [r.version ?? 'unknown', Number(r.n)])),
    ...(instances ? { instances } : {}),
  });
});

function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0 && x.length > 0;
}

app.notFound(c => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export type AppType = typeof routes;

/**
 * Nightly registry sweep. Creating a wizard session is anonymous and cheap, so
 * without this the table only ever grows - every abandoned visit, bot, and
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
