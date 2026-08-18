import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { users, workspaces } from '../db/schema';
import { findPendingInvitation } from '../lib/invitations';
import type { Bindings, Variables } from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// The invite id is a bearer credential, so this preview is public by
// necessity (the invitee has no session yet - the org plugin's getInvitation
// requires one). IP-throttled with the same limiter as credential attempts.
// Acceptance is NOT here: existing users accept via the org plugin endpoint,
// new users implicitly via sign-up carrying the token (lib/auth.ts hooks).
export const invitationsRoute = app.get('/:token', async c => {
  if (c.env.AUTH_LIMIT) {
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
    const { success } = await c.env.AUTH_LIMIT.limit({ key: ip });
    if (!success) {
      return c.json({ error: 'Too many attempts. Try again in a minute' }, 429);
    }
  }
  const db = c.get('db')!;
  // Uniform 404 for every invalid case - no oracle for expired vs canceled
  // vs never-existed.
  const invite = await findPendingInvitation(db, c.req.param('token'));
  if (!invite) return c.json({ error: 'Invitation not found or no longer valid' }, 404);

  const [workspace] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, invite.workspaceId));
  const [inviter] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, invite.invitedBy));

  return c.json({
    data: {
      workspaceName: workspace?.name ?? 'a workspace',
      // Display name only - never the inviter's email. This payload is
      // readable by anyone the link is forwarded to.
      invitedBy: inviter?.name || 'A workspace owner',
      role: invite.role,
      email: invite.email,
      expiresAt: invite.expiresAt,
    },
  });
});
