import { and, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { createId } from '@paralleldrive/cuid2';
import { sites, workspaceMembers, workspaces } from '../db/schema';

export const DEFAULT_WORKSPACE_NAME = 'My Workspace';

/** Subquery: ids of every workspace the user belongs to (any role). */
function memberWorkspaceIds(db: DrizzleD1Database, userId: string) {
  return db
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
}

/**
 * The access rule for sites: workspace membership, with a direct-creator
 * fallback for rows whose workspace_id hasn't been backfilled yet
 * (expand-contract — the column is nullable during rollout).
 */
export function siteAccessFilter(db: DrizzleD1Database, userId: string): SQL {
  return or(eq(sites.userId, userId), inArray(sites.workspaceId, memberWorkspaceIds(db, userId)))!;
}

type SiteRow = typeof sites.$inferSelect;

/** The site row iff the user may access it, else null (callers 404 on null). */
export async function getAccessibleSite(
  db: DrizzleD1Database,
  userId: string,
  siteId: string
): Promise<SiteRow | null> {
  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, siteId), siteAccessFilter(db, userId)))
    .limit(1);
  return site ?? null;
}

type MembershipRow = typeof workspaceMembers.$inferSelect;

export async function getMembership(
  db: DrizzleD1Database,
  workspaceId: string,
  userId: string
): Promise<MembershipRow | null> {
  const [membership] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return membership ?? null;
}

/**
 * Idempotent bootstrap: every user has at least one workspace, and any of
 * their pre-workspace sites (workspace_id NULL) are pulled into it. Called on
 * claim and on workspace listing, so both fresh and already-claimed instances
 * converge without a data migration.
 */
export async function ensureDefaultWorkspace(
  db: DrizzleD1Database,
  userId: string
): Promise<string> {
  const [membership] = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaceMembers.createdAt)
    .limit(1);

  let workspaceId = membership?.workspaceId;
  if (!workspaceId) {
    workspaceId = createId();
    // Atomic: a workspace without its owner membership would be unreachable.
    await db.batch([
      db.insert(workspaces).values({ id: workspaceId, name: DEFAULT_WORKSPACE_NAME }),
      db.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner' }),
    ]);
  }

  await db
    .update(sites)
    .set({ workspaceId })
    .where(and(eq(sites.userId, userId), isNull(sites.workspaceId)));

  return workspaceId;
}
