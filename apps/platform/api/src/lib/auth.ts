import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';
import { and, eq, ne, sql } from 'drizzle-orm';
import { users, sessions, accounts, verifications, sites, apiKeys } from '../db/schema';
import { ensureDefaultWorkspace } from './workspaces';
import type { Bindings } from '../types';

// Once the instance is claimed it stays claimed — skip the D1 count.
let claimedCache = false;
// Marker for a legacy row whose email was freed for an in-flight claim. The
// pairing lives in the DATABASE, not an isolate-local Map: the before- and
// after-hooks can run in different isolates, and a lost pairing meant the
// owner claimed the instance and found none of their sites.
const STASH_SUFFIX = '@claim-pending.invalid';

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
 * freed, so it is parked under a marker address that ENCODES the original —
 * making it discoverable from any isolate and recoverable on retry if the
 * sign-up it was made for fails. Everything that can cheaply invalidate a
 * sign-up (claimed instance, wrong owner email, short password) is checked
 * BEFORE this runs, so the rename is only reached by a request expected to
 * succeed.
 */
async function stashLegacyUser(db: DrizzleD1Database, email: string): Promise<void> {
  const [legacy] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  // Already parked by an earlier attempt that failed downstream — nothing to
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
    // worker, so the origin of the incoming request (request.url — set by the
    // edge, not attacker-controllable) IS the site's canonical origin. Deriving
    // baseURL/trustedOrigins from it keeps CSRF semantics intact (cross-site
    // POSTs carry a mismatched Origin header and are rejected) while letting
    // any deployment — custom domain or bare workers.dev — authenticate
    // without per-instance config.
    baseURL: origin,
    basePath: '/api/auth',
    trustedOrigins: [origin],
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
      },
    }),
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
        // Single-owner instance: the first account claims it, then sign-up
        // closes forever (recovery = delete the accounts row, re-claim).
        // Fast path only: the authoritative guarantee is the partial unique
        // index on accounts(provider_id) WHERE provider_id = 'credential'
        // (migration 0018), which makes a second credential account impossible
        // even when two sign-ups race past this check.
        if (await isClaimed(db)) {
          throw new APIError('FORBIDDEN', { message: 'This instance is already claimed' });
        }
        const email = (ctx.body as { email?: string })?.email?.toLowerCase();
        // Wizard-deployed instances are pinned to the Cloudflare account email
        // captured at deploy time — the owner identity isn't chosen at claim.
        if (env.OWNER_EMAIL && email !== env.OWNER_EMAIL.toLowerCase()) {
          throw new APIError('FORBIDDEN', {
            message: 'This instance can only be claimed by the email it was deployed with',
          });
        }
        if (!email) return;
        // Validate BEFORE touching the legacy row: this hook runs ahead of
        // Better Auth's own body validation, so an obviously-doomed sign-up
        // (short password) must not be allowed to rename anything.
        const password = (ctx.body as { password?: string })?.password ?? '';
        if (password.length < 8) {
          throw new APIError('BAD_REQUEST', {
            message: 'Password must be at least 8 characters',
          });
        }
        await stashLegacyUser(db, email);
      }),
    },
    databaseHooks: {
      user: {
        create: {
          after: async user => {
            await adoptLegacyData(db, user);
            // Adopted (and any future) sites land in the owner's default
            // workspace; runs after adoption so re-parented rows are included.
            await ensureDefaultWorkspace(db, user.id);
          },
        },
      },
    },
  });
}

// One instance per serving origin (apex, www, workers.dev, localhost — a
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
