/**
 * Personal API tokens: the credential a coding agent presents to the MCP
 * endpoint (and any /api route) as `Authorization: Bearer traks_pat_…`.
 * Secrets are random, shown once at creation, and stored only as SHA-256.
 */
import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { apiTokens } from '../db/schema';

export const TOKEN_PREFIX = 'traks_pat_';

export function generateTokenSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return TOKEN_PREFIX + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashToken(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface ResolvedToken {
  id: string;
  userId: string;
  scope: 'read' | 'manage';
  workspaceId: string | null;
}

/** Look up a presented secret; null when unknown. High-entropy secrets make
 *  plain SHA-256 (no salt/KDF) appropriate here. */
export async function resolveToken(
  db: DrizzleD1Database,
  secret: string
): Promise<ResolvedToken | null> {
  if (!secret.startsWith(TOKEN_PREFIX)) return null;
  const tokenHash = await hashToken(secret);
  const [row] = await db
    .select({
      id: apiTokens.id,
      userId: apiTokens.userId,
      scope: apiTokens.scope,
      workspaceId: apiTokens.workspaceId,
    })
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, tokenHash));
  return row ?? null;
}
