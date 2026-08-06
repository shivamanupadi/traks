export type Bindings = {
  DB: D1Database;
  /** Static assets (web SPA); absent in local dev where vite serves the SPA. */
  ASSETS?: Fetcher;
  /** Cross-script binding to the collect worker's SiteLiveStore DO (hot path). */
  LIVE: DurableObjectNamespace;
  /** Global (cross-colo) result cache for R2 SQL dashboard queries. */
  R2SQL_CACHE: KVNamespace;
  ENVIRONMENT: string;
  /** Better Auth signing secret (Doppler-managed). */
  BETTER_AUTH_SECRET: string;
  /** Cloudflare account ID — an identifier, not a credential ([vars]). */
  R2_ACCOUNT_ID: string;
  R2_SQL_TOKEN: string;
  R2_BUCKET_NAME: string;
  /** Public origin of this deployment's collect worker ([vars]). */
  COLLECT_URL: string;
  /** Release artifacts (worker bundles, web assets) for the deploy wizard. */
  RELEASES: R2Bucket;
};

export type Variables = {
  userId?: string;
  userEmail?: string;
  db?: import('drizzle-orm/d1').DrizzleD1Database;
};
