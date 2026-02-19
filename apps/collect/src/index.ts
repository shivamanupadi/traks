import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { trackingEventSchema } from '@traks/shared';
import { isBot } from './lib/bots';
import { parseUA } from './lib/ua';
import { parseReferrer } from './lib/referrer';
import { TRACKER_SCRIPT } from './lib/tracker-script';

type Bindings = {
  ANALYTICS: AnalyticsEngineDataset;
  DB: D1Database;
  ENVIRONMENT: string;
  VISITOR_HASH_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS: allow all origins (tracker runs on customer sites)
app.use('/*', cors({ origin: '*' }));

// Health check
app.get('/', c => c.json({ name: 'traks-collect', status: 'ok' }));
app.get('/health', c => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Serve the tracking script with aggressive caching
app.get('/t.js', c => {
  return c.text(TRACKER_SCRIPT, 200, {
    'Content-Type': 'application/javascript',
    'Cache-Control': 'public, max-age=86400, s-maxage=604800',
  });
});

// Site key validation cache (in-memory, 5-min TTL per Worker instance)
const siteCache = new Map<string, number>();
const CACHE_TTL = 5 * 60 * 1000;

async function isSiteValid(db: D1Database, siteKey: string): Promise<boolean> {
  const cached = siteCache.get(siteKey);
  if (cached && Date.now() - cached < CACHE_TTL) return true;

  const result = await db
    .prepare('SELECT 1 FROM api_keys WHERE key = ? AND revoked_at IS NULL LIMIT 1')
    .bind(siteKey)
    .first();

  if (result) {
    siteCache.set(siteKey, Date.now());
    return true;
  }
  return false;
}

// Cache the HMAC CryptoKey per day — avoids crypto.subtle.importKey() on every request
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
 * - Raw IP is never stored — only the hash
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

  // Convert first 8 bytes to hex string (64-bit hash — plenty for COUNT DISTINCT)
  const hex = Array.from(hashArray.slice(0, 8), b => b.toString(16).padStart(2, '0')).join('');
  return hex;
}

// Event ingestion endpoint
app.post('/api/event', async c => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'invalid body' }, 400);

  const result = trackingEventSchema.safeParse(body);
  if (!result.success) return c.json({ error: 'invalid event' }, 400);

  const event = result.data;

  // Validate site key
  const valid = await isSiteValid(c.env.DB, event.s);
  if (!valid) {
    console.warn(`[collect] Unknown site key: ${event.s}`);
    return c.json({ error: 'unknown site' }, 403);
  }

  // Bot filtering — silently accept but don't write
  const ua = c.req.header('user-agent') || '';
  if (isBot(ua)) return c.json({ ok: true });

  // Get visitor IP from Cloudflare header
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '0.0.0.0';

  // Compute visitor ID server-side (Plausible-style: HMAC(secret+date, IP+UA+site))
  const visitorId = await generateVisitorId(c.env.VISITOR_HASH_SECRET, ip, ua, event.s);

  // Geo from Cloudflare request
  const cf = (c.req.raw as any).cf || {};
  const country = (cf.country as string) || '';
  const city = (cf.city as string) || '';
  const region = (cf.region as string) || '';

  // Parse referrer
  const { hostname: refHostname, pathname: refPathname } = parseReferrer(event.r);

  // Parse user agent
  const { browser, os, deviceType } = parseUA(ua);

  // Write to Analytics Engine
  try {
    c.env.ANALYTICS.writeDataPoint({
      indexes: [event.s],
      blobs: [
        event.t, // blob1: event_type
        event.p, // blob2: pathname
        event.h, // blob3: hostname
        refHostname, // blob4: referrer_hostname
        refPathname, // blob5: referrer_pathname
        event.us || '', // blob6: utm_source
        event.um || '', // blob7: utm_medium
        event.uc || '', // blob8: utm_campaign
        '', // blob9: free (was utm_term)
        '', // blob10: free (was utm_content)
        country, // blob11: country
        city, // blob12: city
        region, // blob13: region
        browser, // blob14: browser
        os, // blob15: os
        deviceType, // blob16: device_type
        event.sid || '', // blob17: session_id (random token from client)
        visitorId, // blob18: visitor_id (HMAC hash — computed server-side)
        event.en || '', // blob19: event_name
        event.ep || '', // blob20: event_meta
      ],
      doubles: [
        0, // double1: reserved (was is_unique — now using COUNT DISTINCT)
        0, // double2: reserved (was is_session_start)
        0, // double3: reserved (bounce)
        0, // double4: reserved (scroll_depth)
        0, // double5: reserved (time_on_page)
        event.ev || 0, // double6: event_value
        event.sw || 0, // double7: screen_width
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // double8-20: reserved
      ],
    });
  } catch (err) {
    console.error('Analytics Engine write failed:', err);
    return c.json({ error: 'write failed' }, 500);
  }

  return c.json({ ok: true });
});

export default app;
