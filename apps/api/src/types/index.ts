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
  R2_ACCOUNT_ID: string;
  R2_SQL_TOKEN: string;
  R2_BUCKET_NAME: string;
};

export type Variables = {
  userId?: string;
  userEmail?: string;
  db?: import('drizzle-orm/d1').DrizzleD1Database;
};
