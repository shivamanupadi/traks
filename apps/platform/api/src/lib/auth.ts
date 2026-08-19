import { betterAuth } from 'better-auth';
import { organization } from 'better-auth/plugins';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';
import { and, eq, ne, sql } from 'drizzle-orm';
import {
  users,
  sessions,
  accounts,
  verifications,
  sites,
  apiKeys,
  workspaces,
  workspaceMembers,
  workspaceInvitations,
} from '../db/schema';
import { ensureDefaultWorkspace, evictOrphanedMembers } from './workspaces';
import { findPendingInvitation, consumeInvitation } from './invitations';
import { ac, workspaceRoles } from './permissions';
import type { Bindings } from '../types';

// Once the instance is claimed it stays claimed - skip the D1 count.
let claimedCache = false;
// Marker for a legacy row whose email was freed for an in-flight claim. The
// pairing lives in the DATABASE, not an isolate-local Map: the before- and
// after-hooks can run in different isolates, and a lost pairing meant the
// owner claimed the instance and found none of their sites.
const STASH_SUFFIX = '@claim-pending.invalid';

/** Constant-time string compare for the claim code (no early-exit on length). */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0 && x.length > 0;
}

async function isClaimed(db: DrizzleD1Database): Promise<boolean> {
  if (claimedCache) return true;
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(accounts)
    .where(eq(accounts.providerId, 'credential'));
  claimedCache = (row?.n ?? 0) > 0;
  return claimedCache;
}

/**
 * First-run claim support: a pre-Better-Auth `users` row (Clerk-era owner, or
 * a recovery re-claim) holds the email the owner signs up with. The unique
 * email index means sign-up cannot insert the new row until that email is
 * freed, so it is parked under a marker address that ENCODES the original -
 * making it discoverable from any isolate and recoverable on retry if the
 * sign-up it was made for fails. Everything that can cheaply invalidate a
 * sign-up (claimed instance, wrong owner email, short password) is checked
 * BEFORE this runs, so the rename is only reached by a request expected to
 * succeed.
 */
async function stashLegacyUser(db: DrizzleD1Database, email: string): Promise<void> {
  const [legacy] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  // Already parked by an earlier attempt that failed downstream - nothing to
  // do, and the retry will still find it by marker. The stash is therefore
  // idempotent and self-healing rather than one-shot destructive.
  if (!legacy) return;
  await db
    .update(users)
    .set({ email: `${email}${STASH_SUFFIX}` })
    .where(eq(users.id, legacy.id));
}

async function adoptLegacyData(
  db: DrizzleD1Database,
  newUser: { id: string; email: string }
): Promise<void> {
  // Look the pairing up by the marker address rather than an in-memory map, so
  // it survives the before/after hooks landing in different isolates.
  const [legacy] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, `${newUser.email}${STASH_SUFFIX}`));
  if (!legacy || legacy.id === newUser.id) return;
  await db.update(sites).set({ userId: newUser.id }).where(eq(sites.userId, legacy.id));
  await db.update(apiKeys).set({ userId: newUser.id }).where(eq(apiKeys.userId, legacy.id));
  await db.delete(users).where(and(eq(users.id, legacy.id), ne(users.id, newUser.id)));
}

// Return type deliberately inferred: betterAuth's generic Auth<TOptions> is
// narrower than Auth<BetterAuthOptions> and there is no stable name for it.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function createAuth(env: Bindings, origin: string) {
  const db = drizzle(env.DB);

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    // Domain-agnostic by design: the SPA and API are served by this same
    // worker, so the origin of the incoming request (request.url - set by the
    // edge, not attacker-controllable) IS the site's canonical origin. Deriving
    // baseURL/trustedOrigins from it keeps CSRF semantics intact (cross-site
    // POSTs carry a mismatched Origin header and are rejected) while letting
    // any deployment - custom domain or bare workers.dev - authenticate
    // without per-instance config.
    baseURL: origin,
    basePath: '/api/auth',
    trustedOrigins: [origin],
    // Attack-surface reduction: organization endpoints the dashboard never
    // calls are 404'd outright. Several of them (list-members,
    // get-full-organization) return other people's email addresses to any
    // member, and the rest are membership-probing oracles we gain nothing
    // from exposing. Paths are base-path-relative.
    disabledPaths: [
      '/organization/list-members',
      '/organization/get-full-organization',
      '/organization/get-active-member-role',
      '/organization/check-slug',
      '/organization/list-user-invitations',
      '/organization/get-invitation',
      '/organization/reject-invitation',
    ],
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        // Organization plugin models, mapped onto the workspace tables below.
        workspaces,
        workspaceMembers,
        workspaceInvitations,
      },
    }),
    plugins: [
      organization({
        // Declarative policy: plugin endpoints AND our site routes evaluate
        // the same statements/roles (lib/permissions.ts).
        ac,
        roles: workspaceRoles,
        // Workspaces predate the plugin - its models are mapped onto the
        // existing tables so sites.workspace_id and the access filters in
        // lib/workspaces.ts keep working unchanged.
        schema: {
          organization: { modelName: 'workspaces' },
          member: { modelName: 'workspaceMembers', fields: { organizationId: 'workspaceId' } },
          invitation: {
            modelName: 'workspaceInvitations',
            fields: { organizationId: 'workspaceId', inviterId: 'invitedBy' },
          },
        },
        creatorRole: 'owner',
        organizationLimit: 20,
        // Members are guests on someone else's Cloudflare account: only the
        // instance owner may create workspaces (each new workspace is a door
        // to creating sites, DOs, and R2 partitions the buyer pays for).
        allowUserToCreateOrganization: async user => {
          const [row] = await db
            .select({ isInstanceOwner: users.isInstanceOwner })
            .from(users)
            .where(eq(users.id, user.id));
          return row?.isInstanceOwner === true;
        },
        invitationExpiresIn: 7 * 24 * 60 * 60, // links travel by hand - give them a week
        // No sendInvitationEmail on purpose: deployed instances cannot send
        // email, so the UI surfaces the invite link for out-of-band delivery.
        organizationHooks: {
          beforeDeleteOrganization: async ({ organization: org, user }) => {
            // Refuse rather than cascade: deleting sites drops their
            // analytics identity (DO + partition) - far too destructive to
            // imply from a workspace delete.
            const [{ n: siteCount }] = await db
              .select({ n: sql<number>`count(*)` })
              .from(sites)
              .where(eq(sites.workspaceId, org.id));
            if (Number(siteCount) > 0) {
              throw new APIError('BAD_REQUEST', { message: 'Move or delete its sites first' });
            }
            const [{ n: memberships }] = await db
              .select({ n: sql<number>`count(*)` })
              .from(workspaceMembers)
              .where(eq(workspaceMembers.userId, user.id));
            if (Number(memberships) <= 1) {
              throw new APIError('BAD_REQUEST', { message: 'You need at least one workspace' });
            }
          },
          // Losing the last membership evicts a member from the instance
          // (see evictOrphanedMembers). The plugin's leave endpoint fires no
          // member hooks, so it's swept in the global after-hook below.
          afterRemoveMember: async () => {
            await evictOrphanedMembers(db);
          },
          afterDeleteOrganization: async () => {
            // Deleting a workspace cascades its memberships - members whose
            // last workspace this was are orphaned and must be evicted too.
            await evictOrphanedMembers(db);
          },
          beforeRemoveMember: async ({ member }) => {
            // A workspace with sites but no owner would be unmanageable.
            if (member.role !== 'owner') return;
            const [{ n }] = await db
              .select({ n: sql<number>`count(*)` })
              .from(workspaceMembers)
              .where(
                and(
                  eq(workspaceMembers.workspaceId, member.organizationId),
                  eq(workspaceMembers.role, 'owner')
                )
              );
            if (Number(n) <= 1) {
              throw new APIError('BAD_REQUEST', {
                message: 'A workspace needs at least one owner',
              });
            }
          },
        },
      }),
    ],
    user: {
      fields: { image: 'imageUrl' },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 1 week
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },
    hooks: {
      before: createAuthMiddleware(async ctx => {
        if (ctx.path !== '/sign-up/email') return;
        const body = ctx.body as {
          email?: string;
          password?: string;
          inviteToken?: string;
          claimToken?: string;
        };
        const email = body?.email?.toLowerCase();
        // Validate BEFORE any side effect: this hook runs ahead of Better
        // Auth's own body validation, so an obviously-doomed sign-up (short
        // password) must not be allowed to rename anything.
        const password = body?.password ?? '';
        if (password.length < 8) {
          throw new APIError('BAD_REQUEST', {
            message: 'Password must be at least 8 characters',
          });
        }
        // Claimed instance: sign-up is closed EXCEPT to a valid workspace
        // invitation (link-based - deployed instances cannot send email).
        // Rejections are uniform: no oracle for expired vs revoked vs bogus.
        if (await isClaimed(db)) {
          const invite = body?.inviteToken
            ? await findPendingInvitation(db, body.inviteToken, email)
            : null;
          if (!invite) {
            throw new APIError('FORBIDDEN', { message: 'This instance is already claimed' });
          }
          return;
        }
        // First-run claim path. Wizard-deployed instances carry a one-time
        // claim code (worker secret, shown only on the wizard's done card):
        // the instance URL is predictable, so possession of the code - not
        // arrival order - is what makes someone the owner.
        if (env.CLAIM_TOKEN && !safeEqual(body?.claimToken ?? '', env.CLAIM_TOKEN)) {
          throw new APIError('FORBIDDEN', {
            message:
              'A valid claim code is required. Use the link from the traks.dev deploy page, or run Update there to get a new one.',
          });
        }
        // Wizard-deployed instances are also pinned to the Cloudflare account
        // email captured at deploy time - the owner identity isn't chosen at
        // claim.
        if (env.OWNER_EMAIL && email !== env.OWNER_EMAIL.toLowerCase()) {
          throw new APIError('FORBIDDEN', {
            message: 'This instance can only be claimed by the email it was deployed with',
          });
        }
        if (!email) return;
        await stashLegacyUser(db, email);
      }),
      after: createAuthMiddleware(async ctx => {
        if (ctx.path === '/organization/leave') {
          await evictOrphanedMembers(db);
          return;
        }
        if (ctx.path !== '/sign-up/email') return;
        // Post-signup wiring needs the request context (was the sign-up an
        // invite acceptance?), which databaseHooks don't carry - hence here.
        const user = ctx.context.newSession?.user;
        if (!user) return;
        const token = (ctx.body as { inviteToken?: string })?.inviteToken;
        // Re-validated rather than carried over from the before-hook: the two
        // can run in different isolates, like the claim stash below. The
        // branch turns on a CONSUMED invitation, never on the token field
        // merely being present - otherwise a junk inviteToken on an unclaimed
        // instance would take the member path and leave the claimer with no
        // owner flag and no workspace, bricking a fresh install.
        const invite = token ? await findPendingInvitation(db, token, user.email) : null;
        if (invite) {
          // Invited members join exactly the invited workspace - no personal
          // default workspace is created for them.
          await consumeInvitation(db, invite, user.id);
          return;
        }
        await adoptLegacyData(db, user);
        // A non-invited sign-up only exists on the claim path (the before-
        // hook rejects it otherwise): this user IS the instance owner.
        await db.update(users).set({ isInstanceOwner: true }).where(eq(users.id, user.id));
        // Adopted (and any future) sites land in the owner's default
        // workspace; runs after adoption so re-parented rows are included.
        await ensureDefaultWorkspace(db, user.id);
      }),
    },
  });
}

// One instance per serving origin (apex, www, workers.dev, localhost - a
// small bounded set), so per-request calls stay cheap.
const authInstances = new Map<string, ReturnType<typeof createAuth>>();

export function getAuth(env: Bindings, requestUrl: string): ReturnType<typeof createAuth> {
  const origin = new URL(requestUrl).origin;
  let instance = authInstances.get(origin);
  if (!instance) {
    if (authInstances.size > 16) authInstances.clear();
    instance = createAuth(env, origin);
    authInstances.set(origin, instance);
  }
  return instance;
}

/** Public status for the login page: claim screen vs sign-in screen. */
export async function claimStatus(env: Bindings): Promise<boolean> {
  return isClaimed(drizzle(env.DB));
}
