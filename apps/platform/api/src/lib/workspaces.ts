import { and, eq, inArray, isNull, lt, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { createId } from '@paralleldrive/cuid2';
import { apiKeys, sites, users, workspaceMembers, workspaces } from '../db/schema';

export const DEFAULT_WORKSPACE_NAME = 'My Workspace';

/** Subquery: ids of every workspace the user belongs to (any role). */
function memberWorkspaceIds(db: DrizzleD1Database, userId: string) {
  return db
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
}

/**
 * The access rule for sites: workspace membership. The direct-creator arm is
 * deliberately restricted to rows that have NO workspace yet (expand-contract
 * — the column is nullable during rollout). Letting it apply to workspaced
 * rows would mean removing someone from a workspace never revoked access to
 * the sites they happened to create there.
 */
export function siteAccessFilter(
  db: DrizzleD1Database,
  userId: string,
  scopeWorkspaceId?: string
): SQL {
  const base = or(
    and(eq(sites.userId, userId), isNull(sites.workspaceId)),
    inArray(sites.workspaceId, memberWorkspaceIds(db, userId))
  )!;
  // A workspace-bound API token sees exactly one workspace's sites — never
  // the owner's other workspaces, and never legacy un-workspaced rows.
  if (!scopeWorkspaceId) return base;
  return and(eq(sites.workspaceId, scopeWorkspaceId), base)!;
}

type SiteRow = typeof sites.$inferSelect;

/** The site row iff the user may access it, else null (callers 404 on null). */
export async function getAccessibleSite(
  db: DrizzleD1Database,
  userId: string,
  siteId: string,
  scopeWorkspaceId?: string
): Promise<SiteRow | null> {
  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, siteId), siteAccessFilter(db, userId, scopeWorkspaceId)))
    .limit(1);
  return site ?? null;
}

/**
 * Site access WITH the caller's role in its workspace. Members can read;
 * only owners mutate — mutation routes 403 on role !== 'owner'. Legacy
 * sites (no workspace yet) are owner-managed by their creator.
 */
export async function getSiteAccess(
  db: DrizzleD1Database,
  userId: string,
  siteId: string,
  scopeWorkspaceId?: string
): Promise<{ site: SiteRow; role: 'owner' | 'member' } | null> {
  const site = await getAccessibleSite(db, userId, siteId, scopeWorkspaceId);
  if (!site) return null;
  // Legacy un-workspaced row: its creator is effectively its owner.
  if (!site.workspaceId) return { site, role: 'owner' };
  // Membership is the ONLY source of role for a workspaced site. Never fall
  // back to the creator — a removed member would otherwise keep owner rights
  // over every site they had created.
  const membership = await getMembership(db, site.workspaceId, userId);
  if (!membership) return null;
  return { site, role: membership.role };
}

/** Like siteAccessFilter, but only sites the user may MANAGE: workspaces
 *  where they hold the owner role, plus legacy un-workspaced creations. */
export function siteManageFilter(
  db: DrizzleD1Database,
  userId: string,
  scopeWorkspaceId?: string
): SQL {
  const base = or(
    and(eq(sites.userId, userId), isNull(sites.workspaceId)),
    inArray(
      sites.workspaceId,
      db
        .select({ id: workspaceMembers.workspaceId })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.role, 'owner')))
    )
  )!;
  if (!scopeWorkspaceId) return base;
  return and(eq(sites.workspaceId, scopeWorkspaceId), base)!;
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
 * Idempotent bootstrap: the caller's default workspace (their oldest
 * membership), with any of their pre-workspace sites (workspace_id NULL)
 * pulled into it. Only the INSTANCE OWNER self-provisions a workspace when
 * they have none — members exist solely through invitations, so a
 * member with zero memberships gets null (and is evicted, see below), never
 * a fresh workspace to squat on.
 */
export async function ensureDefaultWorkspace(
  db: DrizzleD1Database,
  userId: string
): Promise<string | null> {
  const [membership] = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaceMembers.createdAt)
    .limit(1);
  const [user] = await db
    .select({ isInstanceOwner: users.isInstanceOwner })
    .from(users)
    .where(eq(users.id, userId));
  const isInstanceOwner = user?.isInstanceOwner === true;

  let workspaceId = membership?.workspaceId;
  if (!workspaceId) {
    if (!isInstanceOwner) return null;
    workspaceId = createId();
    // Atomic: a workspace without its owner membership would be unreachable.
    // slug: the org plugin requires one and it's unique — the id always is.
    await db.batch([
      db
        .insert(workspaces)
        .values({ id: workspaceId, name: DEFAULT_WORKSPACE_NAME, slug: workspaceId }),
      db.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner' }),
    ]);
  }

  // Legacy adoption belongs to the instance owner alone. Doing it for a
  // member would silently publish their own un-workspaced sites into a
  // workspace they were merely invited to, exposing them to everyone there.
  if (isInstanceOwner) {
    await db
      .update(sites)
      .set({ workspaceId })
      .where(and(eq(sites.userId, userId), isNull(sites.workspaceId)));
  }

  return workspaceId;
}

/**
 * Members exist only to collaborate on workspaces: a non-owner user left
 * with zero memberships (removed, left, or their workspace was deleted) is
 * evicted from the instance. Sites they created are re-parented to the
 * instance owner (the FK requires a user; the sites themselves live on in
 * their workspaces), then the user row is deleted — cascading accounts and
 * sessions, so their login stops working immediately. A later re-invite
 * simply creates a fresh account.
 */
export async function evictOrphanedMembers(db: DrizzleD1Database): Promise<void> {
  // An invited sign-up exists for a moment with no membership row (the user
  // is created, then the invitation is consumed). Without this grace period a
  // concurrent sweep would delete that brand-new account mid-signup.
  const graceCutoff = new Date(Date.now() - 5 * 60_000);
  const orphans = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.isInstanceOwner, false),
        lt(users.createdAt, graceCutoff),
        notInArray(users.id, db.select({ id: workspaceMembers.userId }).from(workspaceMembers))
      )
    );
  if (orphans.length === 0) return;

  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.isInstanceOwner, true))
    .limit(1);

  for (const orphan of orphans) {
    try {
      if (owner) {
        await db.update(sites).set({ userId: owner.id }).where(eq(sites.userId, orphan.id));
        await db.update(apiKeys).set({ userId: owner.id }).where(eq(apiKeys.userId, orphan.id));
      }
      await db.delete(users).where(eq(users.id, orphan.id));
    } catch (err) {
      // Never fail the caller's request over a stuck row (e.g. a site FK we
      // could not re-parent because no instance owner is flagged). The
      // membership is already gone, so the account is inert either way.
      console.error('[workspaces] eviction failed for user', orphan.id, err);
    }
  }

  // Workspaces left with zero members are unreachable by anyone. Empty ones
  // are dropped; ones still holding sites revert to the instance owner so
  // no analytics data is ever stranded.
  const memberlessWorkspaces = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      notInArray(
        workspaces.id,
        db.select({ id: workspaceMembers.workspaceId }).from(workspaceMembers)
      )
    );
  for (const ws of memberlessWorkspaces) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(sites)
      .where(eq(sites.workspaceId, ws.id));
    if (Number(n) === 0) {
      await db.delete(workspaces).where(eq(workspaces.id, ws.id));
    } else if (owner) {
      await db
        .insert(workspaceMembers)
        .values({ workspaceId: ws.id, userId: owner.id, role: 'owner' })
        .onConflictDoNothing();
    }
  }
}
