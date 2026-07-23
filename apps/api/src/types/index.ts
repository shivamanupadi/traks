export type Bindings = {
  DB: D1Database;
  /** Cross-script binding to the collect worker's SiteLiveStore DO (hot path). */
  LIVE: DurableObjectNamespace;
  /** Global (cross-colo) result cache for R2 SQL dashboard queries. */
  R2SQL_CACHE: KVNamespace;
  /** Transactional email (Cloudflare Email Service, open beta). */
  EMAIL: {
    send: (msg: {
      to: string | { email: string; name?: string };
      from: string | { email: string; name?: string };
      subject: string;
      html?: string;
      text?: string;
    }) => Promise<{ messageId?: string }>;
  };
  ENVIRONMENT: string;
  ALLOWED_ORIGINS: string;
  APP_URL: string;
  EMAIL_FROM: string;
  CLERK_SECRET_KEY: string;
  CLERK_WEBHOOK_SECRET: string;
  R2_ACCOUNT_ID: string;
  R2_SQL_TOKEN: string;
  R2_BUCKET_NAME: string;
};

export type Variables = {
  userId?: string;
  db?: import('drizzle-orm/d1').DrizzleD1Database;
};
