import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Bindings, Variables } from './types';
import { getAuth, claimStatus } from './lib/auth';
import { workspaces } from './db/schema';
import { getMembership } from './lib/workspaces';
import { roleAllows } from './lib/permissions';
import { sitesRoute } from './routes/sites';
import { analyticsRoute } from './routes/analytics';
import { meRoute } from './routes/me';
import { workspacesRoute } from './routes/workspaces';
import { invitationsRoute } from './routes/invitations';
import { tokensRoute } from './routes/tokens';
import { mcpHandler } from './routes/mcp';
import { requireAuth } from './middleware/auth';

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
// Organization-plugin endpoints that embed the member roster or invitation
// list — i.e. other people's email addresses. The plugin gates them on mere
// membership, but our policy reserves the roster for owners (roster:read), so
// they are checked here before the plugin ever sees them. Without this, our
// owner-only /api/workspaces/:id/members would be trivially bypassed.
const ROSTER_PATHS = new Set([
  '/api/auth/organization/list-members',
  '/api/auth/organization/get-full-organization',
  '/api/auth/organization/list-invitations',
]);

app.on(['GET', 'POST'], '/api/auth/*', async c => {
  const url = new URL(c.req.url);
  const path = url.pathname;
  const isCredentialAttempt =
    c.req.method === 'POST' && (path.includes('/sign-in') || path.includes('/sign-up'));
  if (isCredentialAttempt && c.env.AUTH_LIMIT) {
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
    const { success } = await c.env.AUTH_LIMIT.limit({ key: ip });
    if (!success) {
      return c.json({ error: 'Too many attempts — try again in a minute' }, 429);
    }
  }

  if (ROSTER_PATHS.has(path)) {
    const session = await getAuth(c.env, c.req.url).api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Unauthorized' }, 401);
    const db = c.get('db')!;

    // Same resolution order the plugin uses: explicit id, then slug, then the
    // session's active organization.
    let workspaceId = url.searchParams.get('organizationId') ?? undefined;
    const slug = url.searchParams.get('organizationSlug');
    if (!workspaceId && slug) {
      const [row] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.slug, slug))
        .limit(1);
      workspaceId = row?.id;
    }
    if (!workspaceId) {
      workspaceId =
        (session.session as { activeOrganizationId?: string }).activeOrganizationId ?? undefined;
    }
    // Unresolvable target fails closed rather than deferring to the plugin.
    if (!workspaceId) return c.json({ error: 'Not found' }, 404);

    const membership = await getMembership(db, workspaceId, session.user.id);
    if (!membership || !roleAllows(membership.role, { roster: ['read'] })) {
      return c.json({ error: 'Only workspace owners can view members' }, 403);
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
  .route('/api/workspaces', workspacesRoute)
  .route('/api/invitations', invitationsRoute)
  .route('/api/sites', sitesRoute)
  .route('/api/analytics', analyticsRoute)
  .route('/api/tokens', tokensRoute);

// MCP endpoint (Streamable HTTP, stateless): registered after the routes it
// dispatches into, closing over `app` so tool calls run in-process through
// the same middleware, validation, and permission checks as the dashboard.
app.post(
  '/api/mcp',
  requireAuth,
  mcpHandler((path, init, c) => Promise.resolve(app.request(path, init, c.env, c.executionCtx)))
);
// Stateless transport: no SSE stream to resume, no session to delete.
app.on(['GET', 'DELETE'], '/api/mcp', c => c.json({ error: 'Method not allowed' }, 405));

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
