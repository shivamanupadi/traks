export type Bindings = {
  DB: D1Database;
  /** Static assets (web SPA); absent in local dev where vite serves the SPA. */
  ASSETS?: Fetcher;
  /** Cross-script binding to the collect worker's SiteLiveStore DO (hot path). */
  LIVE: DurableObjectNamespace;
  /** Global (cross-colo) result cache for R2 SQL dashboard queries. */
  R2SQL_CACHE: KVNamespace;
  /** Query telemetry (R2 SQL wall time, rows, cache outcome); optional so
   *  instances deployed before the binding existed keep working. */
  METRICS?: AnalyticsEngineDataset;
  ENVIRONMENT: string;
  /** Better Auth signing secret (Doppler-managed). */
  BETTER_AUTH_SECRET: string;
  /** Cloudflare account ID - an identifier, not a credential ([vars]). */
  R2_ACCOUNT_ID: string;
  R2_SQL_TOKEN: string;
  R2_BUCKET_NAME: string;
  /** Public origin of this deployment's collect worker ([vars]). */
  COLLECT_URL: string;
  /** IP-scoped brute-force guard on /api/auth/* (see wrangler.toml). */
  AUTH_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
  /** Set by the deploy wizard on user instances: the Cloudflare account email
   *  the instance was deployed with. When present, only this email can claim
   *  the instance (first sign-up), and the claim screen locks the field. */
  OWNER_EMAIL?: string;
  /** Set by the deploy wizard on user instances (worker secret): one-time code
   *  that the first sign-up must present to claim the instance. Instance
   *  hostnames are predictable, so without it anyone who finds an unclaimed
   *  instance first could make themselves its owner. Rotated by every wizard
   *  run that finds the instance still unclaimed; shown only on the wizard's
   *  done card. */
  CLAIM_TOKEN?: string;
  /** Set by the deploy wizard on user instances: the release version installed
   *  (manifest.version). Drives the dashboard's update-available banner. */
  TRAKS_VERSION?: string;
  /** Set by the deploy wizard on user instances: the wizard session that owns
   *  this instance, so "Update" links reopen the same session on traks.dev. */
  DEPLOY_INSTANCE_ID?: string;
};

export type Variables = {
  userId?: string;
  userEmail?: string;
  /** Set when the request authenticated with a personal API token. */
  tokenScope?: 'read' | 'manage';
  /** The token's workspace binding - site access is constrained to it. */
  tokenWorkspaceId?: string;
  db?: import('drizzle-orm/d1').DrizzleD1Database;
};
