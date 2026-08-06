export type Bindings = {
  /** Deploy-wizard registry (traks-home-db) — sessions only, never tokens. */
  DB: D1Database;
  /** Release artifacts (worker bundles, web assets) the wizard provisions from. */
  RELEASES: R2Bucket;
  ENVIRONMENT: string;
  /** "Sign in with Cloudflare" OAuth client (Doppler-managed, prod only —
   *  absent means the wizard falls back to token paste). */
  CF_OAUTH_CLIENT_ID?: string;
  CF_OAUTH_CLIENT_SECRET?: string;
  /** IP-scoped abuse guards for the public wizard API (see wrangler.toml). */
  VERIFY_LIMIT?: RateLimit;
  SESSION_LIMIT?: RateLimit;
};

interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export type Variables = {
  db?: import('drizzle-orm/d1').DrizzleD1Database;
};
