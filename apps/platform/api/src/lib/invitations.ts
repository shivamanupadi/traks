import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { workspaceInvitations, workspaceMembers } from '../db/schema';

type InvitationRow = typeof workspaceInvitations.$inferSelect;

/**
 * The pending invitation for an invite-link id, iff still usable and the
 * presented email matches its pinned recipient. Null otherwise — callers
 * reject uniformly, no oracle for which check failed. Lifecycle writes go
 * through the Better Auth organization plugin; this read (plus
 * consumeInvitation) exists only for the sign-up gate, where the invitee has
 * no session yet and the plugin's acceptInvitation cannot run.
 */
export async function findPendingInvitation(
  db: DrizzleD1Database,
  invitationId: string,
  email?: string
): Promise<InvitationRow | null> {
  if (!invitationId || invitationId.length > 64) return null;
  const [invite] = await db
    .select()
    .from(workspaceInvitations)
    .where(eq(workspaceInvitations.id, invitationId))
    .limit(1);
  if (!invite) return null;
  if (invite.status !== 'pending') return null;
  if (invite.expiresAt.getTime() < Date.now()) return null;
  if (email && invite.email.toLowerCase() !== email.toLowerCase()) return null;
  return invite;
}

/** Mark the invitation accepted and add the member — atomically, so a used
 *  invite can never exist without its membership (or vice versa). */
export async function consumeInvitation(
  db: DrizzleD1Database,
  invite: InvitationRow,
  userId: string
): Promise<void> {
  await db.batch([
    db
      .update(workspaceInvitations)
      .set({ status: 'accepted' })
      .where(eq(workspaceInvitations.id, invite.id)),
    db
      .insert(workspaceMembers)
      .values({ workspaceId: invite.workspaceId, userId, role: invite.role as 'owner' | 'member' })
      .onConflictDoNothing(),
  ]);
}
