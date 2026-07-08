import { Context, Next } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema';
import type { Bindings, Variables } from '../types';

interface ClerkJWTPayload {
  sub: string;
  exp: number;
  iat: number;
  iss: string;
}

let jwksCache: { keys: Map<string, CryptoKey>; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL = 3600000; // 1 hour

// User IDs already confirmed to exist in D1 (isolate lifetime).
const knownUsers = new Set<string>();

function base64UrlDecode(input: string): Uint8Array {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getJWKS(clerkSecretKey: string): Promise<Map<string, CryptoKey>> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_CACHE_TTL) {
    return jwksCache.keys;
  }

  const response = await fetch('https://api.clerk.com/v1/jwks', {
    headers: { Authorization: `Bearer ${clerkSecretKey}` },
  });

  if (!response.ok) throw new Error(`Failed to fetch JWKS: ${response.status}`);

  const jwks: { keys: any[] } = await response.json();
  const keys = new Map<string, CryptoKey>();

  for (const jwk of jwks.keys) {
    if (jwk.kty === 'RSA' && jwk.use === 'sig' && jwk.kid && jwk.n && jwk.e) {
      try {
        const cryptoKey = await crypto.subtle.importKey(
          'jwk',
          { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: jwk.alg || 'RS256', use: 'sig' },
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['verify']
        );
        keys.set(jwk.kid, cryptoKey);
      } catch (err) {
        console.warn('Failed to import JWK', { kid: jwk.kid });
      }
    }
  }

  jwksCache = { keys, fetchedAt: now };
  return keys;
}

async function verifyJWTSignature(token: string, publicKey: CryptoKey): Promise<boolean> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const signatureInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = base64UrlDecode(parts[2]);

    return await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      publicKey,
      signature as unknown as BufferSource,
      signatureInput
    );
  } catch {
    return false;
  }
}

async function verifyClerkToken(token: string, secretKey: string): Promise<ClerkJWTPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));

    if (!header.kid) return null;
    if (payload.exp && payload.exp < Date.now() / 1000) return null;

    const keys = await getJWKS(secretKey);
    let publicKey = keys.get(header.kid);

    if (!publicKey) {
      jwksCache = null;
      const refreshedKeys = await getJWKS(secretKey);
      publicKey = refreshedKeys.get(header.kid);
      if (!publicKey) return null;
    }

    const valid = await verifyJWTSignature(token, publicKey);
    return valid ? payload : null;
  } catch (err) {
    console.error('JWT verification error:', err);
    return null;
  }
}

export async function requireAuth(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next
): Promise<Response | void> {
  // Dev-only auth bypass: ?_skip_auth=<userId>
  if (c.env.ENVIRONMENT === 'development' && c.req.query('_skip_auth')) {
    c.set('userId', c.req.query('_skip_auth')!);
    await next();
    return;
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice(7);
  const payload = await verifyClerkToken(token, c.env.CLERK_SECRET_KEY);
  if (!payload?.sub) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  c.set('userId', payload.sub);

  // Ensure user record exists in D1 - checked at most once per user per
  // isolate; the dashboard fires 7 parallel requests and this SELECT was
  // running on every one of them.
  if (!knownUsers.has(payload.sub)) {
    const db = c.get('db') || drizzle(c.env.DB);
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, payload.sub));
    if (!existing) {
      await db.insert(users).values({
        id: payload.sub,
        email: (payload as any).email || `${payload.sub}@clerk.user`,
        name: (payload as any).name || null,
      });
    }
    if (knownUsers.size > 10_000) knownUsers.clear();
    knownUsers.add(payload.sub);
  }

  await next();
}
