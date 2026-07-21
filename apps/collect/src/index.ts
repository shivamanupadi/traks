import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { trackingEventSchema, computeBucketKeys } from '@traks/shared';
import { isBot } from './lib/bots';
import { parseUA } from './lib/ua';
import { parseReferrer } from './lib/referrer';
import { TRACKER_SCRIPT } from './lib/tracker-script';
import { SiteLiveStore } from './live-store';

export { SiteLiveStore };

type Bindings = {
  EVENTS: {
    send: (records: Record<string, unknown>[]) => Promise<void>;
  };
  LIVE: DurableObjectNamespace<SiteLiveStore>;
  DB: D1Database;
  RATE_LIMIT: { limit: (opts: { key: string }) => Promise<{ success: boolean }> };
  /** Ingest failure counters (Workers Analytics Engine). */
  METRICS?: AnalyticsEngineDataset;
  ENVIRONMENT: string;
  VISITOR_HASH_SECRET: string;
};

/**
 * Count an ingest failure per site key so capacity problems (e.g. a site
 * outgrowing its live DO) surface as a queryable trend instead of buried
 * console noise. Never throws - metrics must not break ingest.
 */
function countFailure(env: Bindings, kind: string, siteKey: string): void {
  try {
    env.METRICS?.writeDataPoint({
      blobs: [kind, siteKey],
      doubles: [1],
      indexes: [siteKey],
    });
  } catch {
    // Analytics Engine unavailable - nothing to do.
  }
}

const app = new Hono<{ Bindings: Bindings }>();

// CORS: allow all origins (tracker runs on customer sites)
app.use('/*', cors({ origin: '*' }));

// Health check
app.get('/', c => c.json({ name: 'traks-collect', status: 'ok' }));
app.get('/health', c => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.get('/t.js', c => {
  return c.text(TRACKER_SCRIPT, 200, {
    'Content-Type': 'application/javascript',
  });
});

interface SiteAuth {
  valid: boolean;
  timezone: string;
}

// Isolate-level auth cache: without it every event costs a D1 read (50M
// events/mo = 50M row reads). 60s TTL bounds revocation/plan-change lag.
// Invalid keys are cached too, so key-guessing doesn't hammer D1.
const AUTH_CACHE_TTL_MS = 60_000;
const authCache = new Map<string, { auth: SiteAuth; expires: number }>();

/**
 * Validate the site key AND fetch the site's IANA timezone in one D1 hit.
 * Timezone drives how hour/date/week bucket keys are computed so dashboard
 * aggregations align with the user's local clock, not UTC.
 */
async function authenticateSite(db: D1Database, siteKey: string): Promise<SiteAuth> {
  const cached = authCache.get(siteKey);
  if (cached && cached.expires > Date.now()) return cached.auth;

  const row = await db
    .prepare(
      `SELECT sites.timezone AS tz
       FROM api_keys
       INNER JOIN sites ON sites.id = api_keys.site_id
       WHERE api_keys.key = ? AND api_keys.revoked_at IS NULL
       LIMIT 1`
    )
    .bind(siteKey)
    .first<{ tz: string | null }>();

  const auth: SiteAuth = row
    ? { valid: true, timezone: row.tz || 'UTC' }
    : { valid: false, timezone: 'UTC' };

  if (authCache.size > 10_000) authCache.clear();
  authCache.set(siteKey, { auth, expires: Date.now() + AUTH_CACHE_TTL_MS });
  return auth;
}

// Cache the HMAC CryptoKey per day - avoids crypto.subtle.importKey() on every request
const encoder = new TextEncoder();
let cachedKeyDate = '';
let cachedCryptoKey: CryptoKey | null = null;

async function getDailyCryptoKey(secret: string): Promise<CryptoKey> {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  if (cachedKeyDate === date && cachedCryptoKey) return cachedCryptoKey;

  const keyData = encoder.encode(secret + date);
  cachedCryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  cachedKeyDate = date;
  return cachedCryptoKey;
}

/**
 * Generate a daily-rotating visitor ID server-side.
 * Uses HMAC-SHA256 with a secret + today's date as the key,
 * and IP + User-Agent + site key as the message.
 * This is the same approach as Plausible Analytics.
 *
 * - Same visitor on same day = same hash (accurate daily uniques)
 * - Same visitor on different days = different hash (privacy: no cross-day linking)
 * - Raw IP is never stored - only the hash
 */
async function generateVisitorId(
  secret: string,
  ip: string,
  userAgent: string,
  siteKey: string
): Promise<string> {
  const cryptoKey = await getDailyCryptoKey(secret);
  const msgData = encoder.encode(ip + userAgent + siteKey);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const hashArray = new Uint8Array(signature);

  // Convert first 8 bytes to hex string (64-bit hash - plenty for distinct counting)
  const hex = Array.from(hashArray.slice(0, 8), b => b.toString(16).padStart(2, '0')).join('');
  return hex;
}

app.post('/api/event', async c => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'invalid body' }, 400);

  const result = trackingEventSchema.safeParse(body);
  if (!result.success) return c.json({ error: 'invalid event' }, 400);

  const event = result.data;

  // Bot filter first — cheap regex check avoids a D1 round-trip for crawler traffic.
  const ua = c.req.header('user-agent') || '';
  if (isBot(ua)) return c.json({ ok: true });

  // Site key validation + timezone/plan fetch (isolate-cached, one D1 query/min).
  const site = await authenticateSite(c.env.DB, event.s);
  if (!site.valid) {
    console.warn(`[collect] Unknown site key: ${event.s}`);
    return c.json({ error: 'unknown site' }, 403);
  }

  // Burst guard (per colo, per site key): floods get cut here. No product
  // quotas — this is purely an abuse backstop.
  const { success } = await c.env.RATE_LIMIT.limit({ key: event.s });
  if (!success) return c.json({ error: 'rate limited' }, 429);

  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '0.0.0.0';

  // Compute visitor ID server-side (Plausible-style: HMAC(secret+date, IP+UA+site))
  const visitorId = await generateVisitorId(c.env.VISITOR_HASH_SECRET, ip, ua, event.s);

  // Geo from Cloudflare request
  const cf = (c.req.raw as unknown as { cf?: Record<string, string | undefined> }).cf || {};
  const country = cf.country || '';
  const city = cf.city || '';
  const region = cf.region || '';

  // Parse referrer
  const { hostname: refHostname, pathname: refPathname } = parseReferrer(event.r);

  // Parse user agent
  const { browser, os, deviceType } = parseUA(ua);

  const now = new Date();
  // Bucket keys are computed in the site's timezone so "today" hourly buckets
  // align with IST (or whatever the site runs on) rather than UTC.
  const { dateKey, hourKey, weekKey } = computeBucketKeys(now, site.timezone);

  const record = {
    site_id: event.s,
    ts: now.getTime(),
    date_key: dateKey,
    hour_key: hourKey,
    week_key: weekKey,
    event_type: event.t,
    pathname: event.p,
    hostname: event.h,
    referrer_hostname: refHostname,
    referrer_pathname: refPathname,
    utm_source: event.us || '',
    utm_medium: event.um || '',
    utm_campaign: event.uc || '',
    country,
    city,
    region,
    browser,
    os,
    device_type: deviceType,
    session_id: event.sid || '',
    visitor_id: visitorId,
    event_name: event.en || '',
    event_meta: event.ep || '',
    event_value: event.ev || 0,
    screen_width: event.sw || 0,
  };

  // Dual write: the Pipelines stream feeds the durable Iceberg table (system
  // of record, historical queries); the site's Durable Object serves "today"
  // and realtime dashboards instantly. Each leg fails independently.
  const liveStub = c.env.LIVE.get(c.env.LIVE.idFromName(event.s));
  c.executionCtx.waitUntil(
    Promise.all([
      c.env.EVENTS.send([record]).catch(err => {
        console.error('Pipeline send failed:', err);
        countFailure(c.env, 'pipeline_send_failed', event.s);
      }),
      liveStub
        .record({
          ts: record.ts,
          hourKey: hourKey,
          eventType: event.t,
          pathname: event.p,
          referrerHostname: refHostname,
          utmSource: event.us || '',
          utmMedium: event.um || '',
          utmCampaign: event.uc || '',
          country,
          city,
          browser,
          os,
          deviceType,
          sessionId: event.sid || '',
          visitorId: visitorId,
          eventName: event.en || '',
          eventValue: event.ev || 0,
        })
        .catch(err => {
          console.error('Live store write failed:', err);
          countFailure(c.env, 'live_write_failed', event.s);
        }),
    ])
  );

  return c.json({ ok: true });
});

export default app;
