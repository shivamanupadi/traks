import { Hono } from 'hono';
import { z } from 'zod';
import { desc, eq, and, or, isNull } from 'drizzle-orm';
import { validate } from '../lib/validate';
import { requireAuth } from '../middleware/auth';
import { apiTokens } from '../db/schema';
import { getMembership } from '../lib/workspaces';
import { generateTokenSecret, hashToken } from '../lib/tokens';
import type { Bindings, Variables } from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const createTokenSchema = z.object({
  name: z
    .string()
    .max(100)
    .transform(s => s.trim())
    .refine(s => s.length > 0, 'Token name is required'),
  scope: z.enum(['read', 'manage']).default('manage'),
  /** Every token binds to one workspace - site access never crosses it. */
  workspaceId: z.string().min(1).max(64),
});

export const tokensRoute = app
  // List the caller's tokens - metadata only, never secrets or hashes.
  // `?workspaceId=` narrows to tokens bound to that workspace (plus any
  // legacy unscoped ones, which apply everywhere and must stay revocable).
  .get('/', requireAuth, async c => {
    const userId = c.get('userId')!;
    const db = c.get('db')!;
    const workspaceId = c.req.query('workspaceId');
    if (workspaceId && !(await getMembership(db, workspaceId, userId))) {
      return c.json({ error: 'Workspace not found' }, 404);
    }
    const rows = await db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        suffix: apiTokens.suffix,
        scope: apiTokens.scope,
        workspaceId: apiTokens.workspaceId,
        createdAt: apiTokens.createdAt,
        lastUsedAt: apiTokens.lastUsedAt,
      })
      .from(apiTokens)
      .where(
        workspaceId
          ? and(
              eq(apiTokens.userId, userId),
              or(eq(apiTokens.workspaceId, workspaceId), isNull(apiTokens.workspaceId))
            )
          : eq(apiTokens.userId, userId)
      )
      .orderBy(desc(apiTokens.createdAt));
    return c.json({ data: rows });
  })

  // Mint a token. The secret appears in this response and nowhere else.
  .post('/', requireAuth, validate('json', createTokenSchema), async c => {
    const userId = c.get('userId')!;
    const body = c.req.valid('json');
    const db = c.get('db')!;

    // The token can only be bound to a workspace the minter belongs to.
    const membership = await getMembership(db, body.workspaceId, userId);
    if (!membership) return c.json({ error: 'Workspace not found' }, 404);

    const existing = await db
      .select({ id: apiTokens.id })
      .from(apiTokens)
      .where(eq(apiTokens.userId, userId));
    if (existing.length >= 10) return c.json({ error: 'Token limit reached (10)' }, 400);

    const secret = generateTokenSecret();
    const [row] = await db
      .insert(apiTokens)
      .values({
        userId,
        name: body.name,
        workspaceId: body.workspaceId,
        tokenHash: await hashToken(secret),
        suffix: secret.slice(-4),
        scope: body.scope,
      })
      .returning({
        id: apiTokens.id,
        name: apiTokens.name,
        suffix: apiTokens.suffix,
        scope: apiTokens.scope,
        workspaceId: apiTokens.workspaceId,
        createdAt: apiTokens.createdAt,
      });
    return c.json({ data: row, secret }, 201);
  })

  // Revoke - only the owner's own token; effective immediately.
  .delete('/:tokenId', requireAuth, async c => {
    const userId = c.get('userId')!;
    const tokenId = c.req.param('tokenId');
    const db = c.get('db')!;
    const [row] = await db
      .select({ id: apiTokens.id })
      .from(apiTokens)
      .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)));
    if (!row) return c.json({ error: 'Not found' }, 404);
    await db.delete(apiTokens).where(eq(apiTokens.id, tokenId));
    return c.json({ ok: true });
  });
