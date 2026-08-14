import { Hono } from 'hono';
import { z } from 'zod';
import { validate } from '../lib/validate';
import { eq, sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import {
  createSiteSchema,
  updateSiteSchema,
  allSitesTimezoneSchema,
  createGoalSchema,
  createFunnelSchema,
  createSegmentSchema,
} from '@traks/shared';
import { requireAuth } from '../middleware/auth';
import { sites, apiKeys, goals, funnels, segments, users } from '../db/schema';
import {
  siteAccessFilter,
  siteManageFilter,
  getAccessibleSite,
  getSiteAccess,
  getMembership,
  ensureDefaultWorkspace,
} from '../lib/workspaces';
import { roleAllows } from '../lib/permissions';
import { fetchSiteFavicon } from '../lib/favicon';
import type { Bindings, Variables } from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/** Resolve the domain's favicon and stamp it on the site row. Runs behind
 *  waitUntil so saving a site never waits on someone else's web server. */
async function refreshFavicon(
  db: NonNullable<Variables['db']>,
  siteId: string,
  domain: string
): Promise<void> {
  try {
    const favicon = await fetchSiteFavicon(domain);
    if (favicon) await db.update(sites).set({ favicon }).where(eq(sites.id, siteId));
  } catch {
    /* favicon is decorative — never let it surface an error */
  }
}

const listSitesQuery = z.object({ workspaceId: z.string().optional() });

type ManageCheck = { ok: true } | { ok: false; status: 403 | 404; error: string };

/** Site mutations evaluate the declared policy (lib/permissions.ts): the
 *  caller's workspace role must grant the requested `site` permission. */
async function checkManage(
  db: NonNullable<Variables['db']>,
  userId: string,
  siteId: string,
  action: 'update' | 'delete' | 'configure',
  scopeWorkspaceId?: string
): Promise<ManageCheck> {
  const access = await getSiteAccess(db, userId, siteId, scopeWorkspaceId);
  if (!access) return { ok: false, status: 404, error: 'Not found' };
  if (!roleAllows(access.role, { site: [action] })) {
    return { ok: false, status: 403, error: 'Your workspace role does not allow this change' };
  }
  return { ok: true };
}

export const sitesRoute = app
  // List the sites the user can access, optionally scoped to one workspace
  .get('/', requireAuth, validate('query', listSitesQuery), async c => {
    const userId = c.get('userId')!;
    const { workspaceId } = c.req.valid('query');
    const db = c.get('db')!;

    if (workspaceId) {
      const tokenWs = c.get('tokenWorkspaceId');
      if (tokenWs && workspaceId !== tokenWs) return c.json({ error: 'Not found' }, 404);
      const membership = await getMembership(db, workspaceId, userId);
      if (!membership) return c.json({ error: 'Not found' }, 404);
      const workspaceSites = await db
        .select()
        .from(sites)
        .where(eq(sites.workspaceId, workspaceId));
      return c.json({ data: workspaceSites });
    }

    const userSites = await db.select().from(sites).where(siteAccessFilter(db, userId, c.get('tokenWorkspaceId')));

    return c.json({ data: userSites });
  })

  // Create a new site
  .post('/', requireAuth, validate('json', createSiteSchema), async c => {
    const userId = c.get('userId')!;
    const body = c.req.valid('json');
    const db = c.get('db')!;

    // Resolve the target workspace: the requested one (must be a member) or
    // the user's default. Every new site lands in a workspace, and only
    // workspace OWNERS create sites — members are view-only.
    let workspaceId = body.workspaceId;
    const tokenWs = c.get('tokenWorkspaceId');
    if (tokenWs) {
      if (workspaceId && workspaceId !== tokenWs) return c.json({ error: 'Not found' }, 404);
      workspaceId = tokenWs;
    }
    if (!workspaceId) {
      const defaultWorkspaceId = await ensureDefaultWorkspace(db, userId);
      if (!defaultWorkspaceId) return c.json({ error: 'You are not in any workspace' }, 403);
      workspaceId = defaultWorkspaceId;
    }
    const membership = await getMembership(db, workspaceId, userId);
    if (!membership) return c.json({ error: 'Workspace not found' }, 404);
    if (!roleAllows(membership.role, { site: ['create'] })) {
      return c.json({ error: 'Only workspace owners can add sites' }, 403);
    }

    // Sites were the only unbounded resource (goals/segments/funnels are all
    // capped), and each one adds a Durable Object plus a slot in every batch
    // fan-out. siteLimit has been on the users table all along, unenforced.
    const [owner] = await db
      .select({ siteLimit: users.siteLimit })
      .from(users)
      .where(eq(users.id, userId));
    const limit = owner?.siteLimit ?? 0;
    if (limit > 0) {
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)` })
        .from(sites)
        .where(eq(sites.userId, userId));
      if (Number(n) >= limit) {
        return c.json({ error: `Site limit reached (${limit})` }, 403);
      }
    }

    const siteId = createId();
    const siteKey = `pb_live_${createId()}`;

    // One atomic batch: a site whose key insert failed separately would be
    // listed in the UI yet unusable for ingest, with no way to repair it.
    try {
      await db.batch([
        db.insert(sites).values({
          id: siteId,
          userId,
          workspaceId,
          name: body.name,
          domain: body.domain,
          timezone: body.timezone,
        }),
        db.insert(apiKeys).values({
          siteId,
          userId,
          key: siteKey,
          name: 'Default',
        }),
      ]);
    } catch (err: any) {
      if (err?.message?.includes('UNIQUE constraint failed')) {
        return c.json({ error: 'A site for this domain already exists' }, 409);
      }
      throw err;
    }

    c.executionCtx.waitUntil(refreshFavicon(db, siteId, body.domain));

    const [site] = await db.select().from(sites).where(eq(sites.id, siteId));

    return c.json({ data: site, key: siteKey }, 201);
  })

  // Set one timezone across sites — the given workspace's sites (requires
  // the owner role there), or every manageable site when none is given.
  // Static path — declared before the /:id routes so it can't be shadowed.
  .post('/timezone', requireAuth, validate('json', allSitesTimezoneSchema), async c => {
    const userId = c.get('userId')!;
    const { timezone, workspaceId } = c.req.valid('json');
    const db = c.get('db')!;

    if (workspaceId) {
      const tokenWs = c.get('tokenWorkspaceId');
      if (tokenWs && workspaceId !== tokenWs) return c.json({ error: 'Not found' }, 404);
      const membership = await getMembership(db, workspaceId, userId);
      if (!membership) return c.json({ error: 'Not found' }, 404);
      if (!roleAllows(membership.role, { site: ['update'] })) {
        return c.json({ error: 'Your workspace role does not allow this change' }, 403);
      }
      await db
        .update(sites)
        .set({ timezone, updatedAt: new Date() })
        .where(eq(sites.workspaceId, workspaceId));
      return c.json({ data: { timezone } });
    }

    await db
      .update(sites)
      .set({ timezone, updatedAt: new Date() })
      .where(siteManageFilter(db, userId, c.get('tokenWorkspaceId')));

    return c.json({ data: { timezone } });
  })

  // Get site details + API key (role included so the UI can hide manage
  // affordances for members)
  .get('/:id', requireAuth, async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('id');
    const db = c.get('db')!;

    const access = await getSiteAccess(db, userId, siteId, c.get('tokenWorkspaceId'));
    if (!access) return c.json({ error: 'Not found' }, 404);

    // The ingest key is withheld from view-only members: it is a write
    // credential for the buyer's pipeline, and members never install snippets.
    const keys = roleAllows(access.role, { site: ['update'] })
      ? await db.select().from(apiKeys).where(eq(apiKeys.siteId, siteId))
      : [];

    return c.json({ data: { ...access.site, apiKeys: keys, role: access.role } });
  })

  // Update a site (owners only)
  .patch('/:id', requireAuth, validate('json', updateSiteSchema), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('id');
    const body = c.req.valid('json');
    const db = c.get('db')!;

    const manageSite = await checkManage(db, userId, siteId, 'update', c.get('tokenWorkspaceId'));
    if (!manageSite.ok) return c.json({ error: manageSite.error }, manageSite.status);

    const [before] = await db
      .select({ domain: sites.domain, favicon: sites.favicon })
      .from(sites)
      .where(eq(sites.id, siteId));

    try {
      await db
        .update(sites)
        .set({
          name: body.name,
          domain: body.domain,
          ...(body.timezone ? { timezone: body.timezone } : {}),
          updatedAt: new Date(),
        })
        .where(eq(sites.id, siteId));
    } catch (err: any) {
      if (err?.message?.includes('UNIQUE constraint failed')) {
        return c.json({ error: 'Domain is already in use' }, 409);
      }
      throw err;
    }

    // Refetch on domain change, and also when the row has no favicon yet —
    // that backfills sites created before favicons existed on any edit.
    if (before && (before.domain !== body.domain || !before.favicon)) {
      c.executionCtx.waitUntil(refreshFavicon(db, siteId, body.domain));
    }

    const [updated] = await db.select().from(sites).where(eq(sites.id, siteId));

    return c.json({ data: updated });
  })

  // List goals for a site
  .get('/:id/goals', requireAuth, async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('id');
    const db = c.get('db')!;

    if (!(await getAccessibleSite(db, userId, siteId, c.get('tokenWorkspaceId')))) return c.json({ error: 'Not found' }, 404);

    const siteGoals = await db.select().from(goals).where(eq(goals.siteId, siteId));
    return c.json({ data: siteGoals });
  })

  // Create a goal
  .post('/:id/goals', requireAuth, validate('json', createGoalSchema), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('id');
    const body = c.req.valid('json');
    const db = c.get('db')!;

    const manage = await checkManage(db, userId, siteId, 'configure', c.get('tokenWorkspaceId'));
    if (!manage.ok) return c.json({ error: manage.error }, manage.status);

    // Bound per-site goal count (query cost scales with the IN list).
    const existing = await db.select({ id: goals.id }).from(goals).where(eq(goals.siteId, siteId));
    if (existing.length >= 50) return c.json({ error: 'Goal limit reached (50 per site)' }, 400);

    const goalId = createId();
    await db.insert(goals).values({
      id: goalId,
      siteId,
      name: body.name,
      type: body.type,
      target: body.target,
      propKey: body.propKey || null,
      propValue: body.propValue || null,
    });
    const [goal] = await db.select().from(goals).where(eq(goals.id, goalId));
    return c.json({ data: goal }, 201);
  })

  // Update a goal (same shape as create — name, type, target)
  .patch('/:id/goals/:goalId', requireAuth, validate('json', createGoalSchema), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('id');
    const goalId = c.req.param('goalId');
    const body = c.req.valid('json');
    const db = c.get('db')!;

    const manage = await checkManage(db, userId, siteId, 'configure', c.get('tokenWorkspaceId'));
    if (!manage.ok) return c.json({ error: manage.error }, manage.status);

    const [existing] = await db
      .select({ siteId: goals.siteId })
      .from(goals)
      .where(eq(goals.id, goalId));
    if (!existing || existing.siteId !== siteId) return c.json({ error: 'Not found' }, 404);

    await db
      .update(goals)
      .set({
        name: body.name,
        type: body.type,
        target: body.target,
        propKey: body.propKey || null,
        propValue: body.propValue || null,
      })
      .where(eq(goals.id, goalId));
    const [goal] = await db.select().from(goals).where(eq(goals.id, goalId));
    return c.json({ data: goal });
  })

  // Delete a goal
  .delete('/:id/goals/:goalId', requireAuth, async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('id');
    const goalId = c.req.param('goalId');
    const db = c.get('db')!;

    const manage = await checkManage(db, userId, siteId, 'configure', c.get('tokenWorkspaceId'));
    if (!manage.ok) return c.json({ error: manage.error }, manage.status);

    const [goal] = await db
      .select({ siteId: goals.siteId })
      .from(goals)
      .where(eq(goals.id, goalId));
    if (!goal || goal.siteId !== siteId) return c.json({ error: 'Not found' }, 404);

    await db.delete(goals).where(eq(goals.id, goalId));
    return c.json({ ok: true });
  })

  // List segments for a site
  .get('/:id/segments', requireAuth, async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('id');
    const db = c.get('db')!;

    if (!(await getAccessibleSite(db, userId, siteId, c.get('tokenWorkspaceId')))) return c.json({ error: 'Not found' }, 404);

    const siteSegments = await db.select().from(segments).where(eq(segments.siteId, siteId));
    return c.json({ data: siteSegments });
  })

  // Create a segment
  .post('/:id/segments', requireAuth, validate('json', createSegmentSchema), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('id');
    const body = c.req.valid('json');
    const db = c.get('db')!;

    const manage = await checkManage(db, userId, siteId, 'configure', c.get('tokenWorkspaceId'));
    if (!manage.ok) return c.json({ error: manage.error }, manage.status);

    const existing = await db
      .select({ id: segments.id })
      .from(segments)
      .where(eq(segments.siteId, siteId));
    if (existing.length >= 50) return c.json({ error: 'Segment limit reached (50 per site)' }, 400);

    const segmentId = createId();
    await db.insert(segments).values({
      id: segmentId,
      siteId,
      name: body.name,
      filters: body.filters,
    });
    const [segment] = await db.select().from(segments).where(eq(segments.id, segmentId));
    return c.json({ data: segment }, 201);
  })

  // Delete a segment
  .delete('/:id/segments/:segmentId', requireAuth, async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('id');
    const segmentId = c.req.param('segmentId');
    const db = c.get('db')!;

    const manage = await checkManage(db, userId, siteId, 'configure', c.get('tokenWorkspaceId'));
    if (!manage.ok) return c.json({ error: manage.error }, manage.status);

    const [segment] = await db
      .select({ siteId: segments.siteId })
      .from(segments)
      .where(eq(segments.id, segmentId));
    if (!segment || segment.siteId !== siteId) return c.json({ error: 'Not found' }, 404);

    await db.delete(segments).where(eq(segments.id, segmentId));
    return c.json({ ok: true });
  })

  // List funnels for a site
  .get('/:id/funnels', requireAuth, async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('id');
    const db = c.get('db')!;

    if (!(await getAccessibleSite(db, userId, siteId, c.get('tokenWorkspaceId')))) return c.json({ error: 'Not found' }, 404);

    const siteFunnels = await db.select().from(funnels).where(eq(funnels.siteId, siteId));
    return c.json({ data: siteFunnels });
  })

  // Create a funnel
  .post('/:id/funnels', requireAuth, validate('json', createFunnelSchema), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('id');
    const body = c.req.valid('json');
    const db = c.get('db')!;

    const manage = await checkManage(db, userId, siteId, 'configure', c.get('tokenWorkspaceId'));
    if (!manage.ok) return c.json({ error: manage.error }, manage.status);

    // Bound per-site funnel count (each funnel stat render is a paid R2 SQL scan).
    const existing = await db
      .select({ id: funnels.id })
      .from(funnels)
      .where(eq(funnels.siteId, siteId));
    if (existing.length >= 20) return c.json({ error: 'Funnel limit reached (20 per site)' }, 400);

    const funnelId = createId();
    await db.insert(funnels).values({
      id: funnelId,
      siteId,
      name: body.name,
      steps: body.steps,
    });
    const [funnel] = await db.select().from(funnels).where(eq(funnels.id, funnelId));
    return c.json({ data: funnel }, 201);
  })

  // Update a funnel (same shape as create — name + ordered steps)
  .patch('/:id/funnels/:funnelId', requireAuth, validate('json', createFunnelSchema), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('id');
    const funnelId = c.req.param('funnelId');
    const body = c.req.valid('json');
    const db = c.get('db')!;

    const manage = await checkManage(db, userId, siteId, 'configure', c.get('tokenWorkspaceId'));
    if (!manage.ok) return c.json({ error: manage.error }, manage.status);

    const [existing] = await db
      .select({ siteId: funnels.siteId })
      .from(funnels)
      .where(eq(funnels.id, funnelId));
    if (!existing || existing.siteId !== siteId) return c.json({ error: 'Not found' }, 404);

    await db
      .update(funnels)
      .set({ name: body.name, steps: body.steps })
      .where(eq(funnels.id, funnelId));
    const [funnel] = await db.select().from(funnels).where(eq(funnels.id, funnelId));
    return c.json({ data: funnel });
  })

  // Delete a funnel
  .delete('/:id/funnels/:funnelId', requireAuth, async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('id');
    const funnelId = c.req.param('funnelId');
    const db = c.get('db')!;

    const manage = await checkManage(db, userId, siteId, 'configure', c.get('tokenWorkspaceId'));
    if (!manage.ok) return c.json({ error: manage.error }, manage.status);

    const [funnel] = await db
      .select({ siteId: funnels.siteId })
      .from(funnels)
      .where(eq(funnels.id, funnelId));
    if (!funnel || funnel.siteId !== siteId) return c.json({ error: 'Not found' }, 404);

    await db.delete(funnels).where(eq(funnels.id, funnelId));
    return c.json({ ok: true });
  })

  // Delete a site (owners only; also purges its live DO)
  .delete('/:id', requireAuth, async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('id');
    const db = c.get('db')!;

    const manage = await checkManage(db, userId, siteId, 'delete', c.get('tokenWorkspaceId'));
    if (!manage.ok) return c.json({ error: manage.error }, manage.status);

    await db.delete(sites).where(eq(sites.id, siteId));

    c.executionCtx.waitUntil(
      (async () => {
        // Wipe the site's live DO storage (one DO per site id).
        const stub = c.env.LIVE.get(c.env.LIVE.idFromName(siteId)) as unknown as {
          purge: () => Promise<void>;
        };
        await stub.purge().catch(err => console.error('[sites] DO purge failed:', err));
      })().catch(err => console.error('[sites] cleanup failed:', err))
    );

    return c.json({ ok: true });
  });
