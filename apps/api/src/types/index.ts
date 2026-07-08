export type Bindings = {
  DB: D1Database;
  /** Cross-script binding to the collect worker's SiteLiveStore DO (hot path). */
  LIVE: DurableObjectNamespace;
  ENVIRONMENT: string;
  ALLOWED_ORIGINS: string;
  CLERK_SECRET_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_SQL_TOKEN: string;
  R2_BUCKET_NAME: string;
};

export type Variables = {
  userId?: string;
  db?: import('drizzle-orm/d1').DrizzleD1Database;
};
