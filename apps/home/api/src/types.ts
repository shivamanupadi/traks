import type { DeploySession } from './deploy/session';

export type Bindings = {
  /** Per-session deploy state and per-instance run locks; self-wiping after a day. */
  SESSIONS: DurableObjectNamespace<DeploySession>;
  /** Release artifacts (worker bundles, web assets) the wizard provisions from. */
  RELEASES: R2Bucket;
  ENVIRONMENT: string;
  /** "Sign in with Cloudflare" OAuth client (Doppler-managed, prod only  -
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

/** No per-request variables any more (the D1 handle used to live here). */
export type Variables = Record<string, never>;
