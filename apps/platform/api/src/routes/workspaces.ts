import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { createWorkspaceSchema, updateWorkspaceSchema } from '@traks/shared';
import { requireAuth } from '../middleware/auth';
import { sites, workspaces, workspaceMembers } from '../db/schema';
import { ensureDefaultWorkspace, getMembership } from '../lib/workspaces';
import type { Bindings, Variables } from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Bound workspace growth like every other resource (sites are capped per
// user, goals/segments/funnels per site).
const MAX_WORKSPACES_PER_USER = 20;

export const workspacesRoute = app
  // List the caller's workspaces. Also the bootstrap point: guarantees a
  // default workspace exists and legacy sites are adopted into it.
  .get('/', requireAuth, async c => {
    const userId = c.get('userId')!;
    const db = c.get('db')!;

    await ensureDefaultWorkspace(db, userId);

    const rows = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        role: workspaceMembers.role,
        createdAt: workspaces.createdAt,
        siteCount: sql<number>`(SELECT count(*) FROM sites WHERE sites.workspace_id = ${workspaces.id})`,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, userId))
      .orderBy(workspaces.createdAt);

    return c.json({ data: rows });
  })

  // Create a workspace; the creator becomes its owner.
  .post('/', requireAuth, zValidator('json', createWorkspaceSchema), async c => {
    const userId = c.get('userId')!;
    const db = c.get('db')!;
    const { name } = c.req.valid('json');

    const [{ n }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId));
    if (Number(n) >= MAX_WORKSPACES_PER_USER) {
      return c.json({ error: `Workspace limit reached (${MAX_WORKSPACES_PER_USER})` }, 403);
    }

    const workspaceId = createId();
    // Atomic: a workspace without its owner membership would be unreachable.
    await db.batch([
      db.insert(workspaces).values({ id: workspaceId, name }),
      db.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner' }),
    ]);

    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    return c.json({ data: { ...workspace, role: 'owner' as const } }, 201);
  })

  // Rename a workspace (owner only).
  .patch('/:id', requireAuth, zValidator('json', updateWorkspaceSchema), async c => {
    const userId = c.get('userId')!;
    const workspaceId = c.req.param('id');
    const { name } = c.req.valid('json');
    const db = c.get('db')!;

    const membership = await getMembership(db, workspaceId, userId);
    if (!membership) return c.json({ error: 'Not found' }, 404);
    if (membership.role !== 'owner') {
      return c.json({ error: 'Only a workspace owner can rename it' }, 403);
    }

    await db
      .update(workspaces)
      .set({ name, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));

    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    return c.json({ data: workspace });
  })

  // Delete a workspace (owner only, must be empty, never the last one).
  .delete('/:id', requireAuth, async c => {
    const userId = c.get('userId')!;
    const workspaceId = c.req.param('id');
    const db = c.get('db')!;

    const membership = await getMembership(db, workspaceId, userId);
    if (!membership) return c.json({ error: 'Not found' }, 404);
    if (membership.role !== 'owner') {
      return c.json({ error: 'Only a workspace owner can delete it' }, 403);
    }

    // Refuse rather than cascade: deleting sites drops their analytics
    // identity (DO + partition), far too destructive to imply from here.
    const [{ n: siteCount }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(sites)
      .where(eq(sites.workspaceId, workspaceId));
    if (Number(siteCount) > 0) {
      return c.json({ error: 'Move or delete its sites first' }, 409);
    }

    const [{ n: total }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId));
    if (Number(total) <= 1) {
      return c.json({ error: 'You need at least one workspace' }, 409);
    }

    // Memberships cascade with the workspace row.
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    return c.json({ ok: true });
  });
