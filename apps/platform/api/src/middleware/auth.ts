import { Context, Next } from 'hono';
import { eq } from 'drizzle-orm';
import { getAuth } from '../lib/auth';
import { resolveToken, TOKEN_PREFIX } from '../lib/tokens';
import { apiTokens } from '../db/schema';
import type { Bindings, Variables } from '../types';

/** For routes that must never be driven by an API token (workspace/member
 *  management, token minting): reject bearer-token requests outright. */
export async function sessionOnly(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next
): Promise<Response | void> {
  if (c.req.header('authorization')?.startsWith(`Bearer ${TOKEN_PREFIX}`)) {
    return c.json({ error: 'Not available to API tokens' }, 403);
  }
  await next();
}

// lastUsedAt exists to answer "is this token still used?" - minute precision
// is plenty. Unthrottled, the touch was a D1 WRITE on every authenticated
// READ: an MCP session or polling dashboard on a token wrote D1 dozens of
// times a minute for a column nobody reads that often.
const LAST_USED_THROTTLE_MS = 60_000;
const lastUsedTouched = new Map<string, number>();

/**
 * Session auth (dashboard cookie) or a personal API token
 * (`Authorization: Bearer traks_pat_…` - coding agents and the MCP
 * endpoint). Tokens resolve to their owner's userId, so every downstream
 * permission check works identically for both. Read-scoped tokens are
 * limited to GET requests.
 */
export async function requireAuth(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next
): Promise<Response | void> {
  const bearer = c.req.header('authorization');
  if (bearer?.startsWith(`Bearer ${TOKEN_PREFIX}`)) {
    const db = c.get('db')!;
    const token = await resolveToken(db, bearer.slice('Bearer '.length));
    if (!token) return c.json({ error: 'Invalid API token' }, 401);
    // Read-only means read-only ROUTES. The MCP transport is always a POST
    // envelope, so it is exempt here - its tool calls dispatch internally as
    // real GET/POST/PATCH requests and pass through this check again, where
    // a write tool under a read token is rejected.
    if (token.scope === 'read' && c.req.method !== 'GET' && c.req.path !== '/api/mcp') {
      return c.json({ error: 'This API token is read-only' }, 403);
    }
    c.set('userId', token.userId);
    c.set('tokenScope', token.scope);
    c.set('tokenWorkspaceId', token.workspaceId ?? undefined);
    // Touch lastUsedAt out-of-band and at most once a minute per token per
    // isolate; per-request precision isn't needed.
    const now = Date.now();
    if ((lastUsedTouched.get(token.id) ?? 0) <= now - LAST_USED_THROTTLE_MS) {
      lastUsedTouched.set(token.id, now);
      if (lastUsedTouched.size > 1000) lastUsedTouched.clear();
      try {
        c.executionCtx.waitUntil(
          db
            .update(apiTokens)
            .set({ lastUsedAt: new Date() })
            .where(eq(apiTokens.id, token.id))
            .then(() => undefined)
        );
      } catch {
        /* executionCtx unavailable (tests) */
      }
    }
    await next();
    return;
  }

  const session = await getAuth(c.env, c.req.url).api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('userId', session.user.id);
  c.set('userEmail', session.user.email);

  await next();
}
