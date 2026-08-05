import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';
import { and, eq, ne, sql } from 'drizzle-orm';
import { users, sessions, accounts, verifications, sites, apiKeys } from '../db/schema';
import type { Bindings } from '../types';

// Once the instance is claimed it stays claimed — skip the D1 count.
let claimedCache = false;
// email -> legacy user id, bridging the sign-up before/after hooks.
const pendingAdoptions = new Map<string, string>();

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
 * a recovery re-claim) holds the email the owner signs up with. Free the email
 * before sign-up creates the new row, then transfer site ownership after.
 */
async function stashLegacyUser(db: DrizzleD1Database, email: string): Promise<void> {
  const [legacy] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!legacy) return;
  await db
    .update(users)
    .set({ email: `legacy-${legacy.id}@migrated.invalid` })
    .where(eq(users.id, legacy.id));
  pendingAdoptions.set(email, legacy.id);
}

async function adoptLegacyData(
  db: DrizzleD1Database,
  newUser: { id: string; email: string }
): Promise<void> {
  const legacyId = pendingAdoptions.get(newUser.email);
  if (!legacyId || legacyId === newUser.id) return;
  pendingAdoptions.delete(newUser.email);
  await db.update(sites).set({ userId: newUser.id }).where(eq(sites.userId, legacyId));
  await db.update(apiKeys).set({ userId: newUser.id }).where(eq(apiKeys.userId, legacyId));
  await db.delete(users).where(and(eq(users.id, legacyId), ne(users.id, newUser.id)));
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
        if (await isClaimed(db)) {
          throw new APIError('FORBIDDEN', { message: 'This instance is already claimed' });
        }
        const email = (ctx.body as { email?: string })?.email?.toLowerCase();
        if (email) await stashLegacyUser(db, email);
      }),
    },
    databaseHooks: {
      user: {
        create: {
          after: async user => {
            await adoptLegacyData(db, user);
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
