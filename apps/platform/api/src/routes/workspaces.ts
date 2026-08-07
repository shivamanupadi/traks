import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { users, workspaces, workspaceMembers } from '../db/schema';
import { ensureDefaultWorkspace, getMembership } from '../lib/workspaces';
import { roleAllows } from '../lib/permissions';
import type { Bindings, Variables } from '../types';

// Lifecycle (create/rename/delete, invitations, member removal) is handled
// by the Better Auth organization plugin under /api/auth/organization/*.
// These routes are the reads the plugin doesn't provide: the switcher's
// role+siteCount aggregation (plus first-run bootstrap) and a members list
// joined with user identity.
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

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
        slug: workspaces.slug,
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

  // List members (owners only — members don't get the workspace roster)
  .get('/:id/members', requireAuth, async c => {
    const userId = c.get('userId')!;
    const workspaceId = c.req.param('id');
    const db = c.get('db')!;

    const membership = await getMembership(db, workspaceId, userId);
    if (!membership) return c.json({ error: 'Not found' }, 404);
    if (!roleAllows(membership.role, { roster: ['read'] })) {
      return c.json({ error: 'Only workspace owners can view members' }, 403);
    }

    const members = await db
      .select({
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
        email: users.email,
        name: users.name,
        joinedAt: workspaceMembers.createdAt,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .orderBy(workspaceMembers.createdAt);

    return c.json({ data: members });
  });
