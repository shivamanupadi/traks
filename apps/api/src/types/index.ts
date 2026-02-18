export type Bindings = {
  DB: D1Database;
  CACHE: KVNamespace;
  ENVIRONMENT: string;
  ALLOWED_ORIGINS: string;
  CLERK_SECRET_KEY: string;
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
};

export type Variables = {
  userId?: string;
  db?: import('drizzle-orm/d1').DrizzleD1Database;
  siteKeyCache?: Map<string, string | null>;
};
