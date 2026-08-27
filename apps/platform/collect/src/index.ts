import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  trackingEventSchema,
  computeBucketKeys,
  normalizeDomain,
  AUTO_EVENTS,
  type ValidatedTrackingEvent,
} from '@traks/shared';
import { parsePlausible, deriveSessionId } from './lib/plausible';
import { botName } from './lib/bots';
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
    // Highest-volume response the product serves - cache it explicitly rather
    // than leaving it to browser heuristics. Short enough that a tracker fix
    // reaches visitors the same day; stale-while-revalidate hides the refetch.
    'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
  });
});

interface SiteAuth {
  valid: boolean;
  timezone: string;
  /** Registered domain, used to reject events forged from other origins. */
  domain: string;
  /** Stable site id. This - never the API key - is the analytics identity:
   *  the Iceberg partition value and the live DO name. Keys can be rotated or
   *  revoked; the id cannot, so history survives a key change. */
  siteId: string;
}

// Isolate-level auth cache: without it every event costs a D1 read (50M
// events/mo = 50M row reads). 60s TTL bounds revocation/plan-change lag.
// Invalid keys are cached too, so key-guessing doesn't hammer D1.
const AUTH_CACHE_TTL_MS = 60_000;
const authCache = new Map<string, { auth: SiteAuth; expires: number }>();
/** Dedupes concurrent first-contact lookups for the same key in one isolate. */
const authInFlight = new Map<string, Promise<SiteAuth>>();

/**
 * Cached site auth, stale-while-revalidate.
 *
 * Returns a hit immediately even once past its TTL and refreshes in the
 * background, because the refresh is a D1 round trip - 50-250ms from a distant
 * colo - and it used to sit inline on the event response every 60s per key per
 * isolate, plus on every cold isolate. Only a key never seen by this isolate
 * blocks. Worst-case revocation lag doubles to ~120s, which is acceptable for
 * a credential that ships publicly in a script tag.
 *
 * `refresh` must only be called after the rate-limit check has passed, so
 * unknown-key floods still cannot amplify into D1.
 */
function authenticateSiteCached(
  db: D1Database,
  siteKey: string,
  background: (p: Promise<unknown>) => void
): SiteAuth | Promise<SiteAuth> {
  const cached = authCache.get(siteKey);
  if (cached) {
    if (cached.expires <= Date.now() && !authInFlight.has(siteKey)) {
      // Stale: serve now, refresh behind the response.
      background(authenticateSite(db, siteKey).catch(() => undefined));
    }
    return cached.auth;
  }
  // First contact for this key in this isolate - must block.
  const inFlight = authInFlight.get(siteKey);
  if (inFlight) return inFlight;
  const p = authenticateSite(db, siteKey).finally(() => authInFlight.delete(siteKey));
  authInFlight.set(siteKey, p);
  return p;
}

/**
 * Validate the site key AND fetch the site's IANA timezone in one D1 hit.
 * Timezone drives how hour/date/week bucket keys are computed so dashboard
 * aggregations align with the user's local clock, not UTC.
 */
async function authenticateSite(db: D1Database, siteKey: string): Promise<SiteAuth> {
  const row = await db
    .prepare(
      `SELECT sites.timezone AS tz, sites.id AS site_id, sites.domain AS domain
       FROM api_keys
       INNER JOIN sites ON sites.id = api_keys.site_id
       WHERE api_keys.key = ? AND api_keys.revoked_at IS NULL
       LIMIT 1`
    )
    .bind(siteKey)
    .first<{ tz: string | null; site_id: string; domain: string | null }>();

  const auth: SiteAuth = row
    ? {
        valid: true,
        timezone: row.tz || 'UTC',
        siteId: row.site_id,
        domain: (row.domain || '').toLowerCase(),
      }
    : { valid: false, timezone: 'UTC', siteId: '', domain: '' };

  if (authCache.size > 10_000) authCache.clear();
  authCache.set(siteKey, { auth, expires: Date.now() + AUTH_CACHE_TTL_MS });
  return auth;
}

// Cache the HMAC CryptoKey per (site-local) day - avoids importKey() per
// request. Keyed by a Map rather than a single slot: `date` is the SITE's
// local date, so an isolate serving sites either side of a date boundary
// (Asia/Kolkata is already on tomorrow while America/LA is on today, for
// several hours daily) alternated dates request to request and re-imported
// the key every time. At most a handful of dates are ever live.
const encoder = new TextEncoder();
const cryptoKeys = new Map<string, CryptoKey>();

async function getDailyCryptoKey(secret: string, date: string): Promise<CryptoKey> {
  // An unset binding would otherwise hash under the literal key "undefined<date>",
  // making every visitor id in the world reproducible by anyone.
  if (!secret) throw new Error('VISITOR_HASH_SECRET is not configured');
  const hit = cryptoKeys.get(date);
  if (hit) return hit;

  const keyData = encoder.encode(secret + date);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  // Yesterday/today/tomorrow across all served timezones is a tiny set; clear
  // wholesale rather than tracking an LRU.
  if (cryptoKeys.size > 8) cryptoKeys.clear();
  cryptoKeys.set(date, key);
  return key;
}

/**
 * Generate a daily-rotating visitor ID server-side.
 * Uses HMAC-SHA256 with a secret + the SITE's calendar date as the key, and
 * IP + User-Agent + site key as the message. Same approach as Plausible.
 *
 * - Same visitor on same day = same hash (accurate daily uniques)
 * - Same visitor on different days = different hash (no cross-day linking)
 * - Raw IP is never stored - only the hash
 *
 * The key MUST rotate on the site's own day boundary: dashboards bucket by
 * site-local date, so a UTC rotation would split one visitor into two inside
 * a single "today" for every non-UTC site.
 */
async function generateVisitorId(
  secret: string,
  ip: string,
  userAgent: string,
  siteKey: string,
  siteDate: string
): Promise<string> {
  const cryptoKey = await getDailyCryptoKey(secret, siteDate);
  const msgData = encoder.encode(ip + userAgent + siteKey);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const hashArray = new Uint8Array(signature);

  // Convert first 8 bytes to hex string (64-bit hash - plenty for distinct counting)
  const hex = Array.from(hashArray.slice(0, 8), b => b.toString(16).padStart(2, '0')).join('');
  return hex;
}

/**
 * Plausible-compatible payloads carry a domain, not a site key. Domains are
 * unique per site (sites_domain_idx), so the domain IS the lookup key. Same
 * stale-while-refresh caching shape as the site-key path.
 */
const domainAuthCache = new Map<string, { auth: SiteAuth; expires: number }>();
const domainAuthInFlight = new Map<string, Promise<SiteAuth>>();

async function authenticateDomain(db: D1Database, domain: string): Promise<SiteAuth> {
  const row = await db
    .prepare(`SELECT timezone AS tz, id AS site_id, domain FROM sites WHERE domain = ? LIMIT 1`)
    .bind(normalizeDomain(domain))
    .first<{ tz: string | null; site_id: string; domain: string | null }>();
  const auth: SiteAuth = row
    ? {
        valid: true,
        timezone: row.tz || 'UTC',
        siteId: row.site_id,
        domain: (row.domain || '').toLowerCase(),
      }
    : { valid: false, timezone: 'UTC', siteId: '', domain: '' };
  if (domainAuthCache.size > 10_000) domainAuthCache.clear();
  domainAuthCache.set(domain, { auth, expires: Date.now() + AUTH_CACHE_TTL_MS });
  return auth;
}

async function authenticateDomainCached(
  db: D1Database,
  domain: string,
  background: (p: Promise<unknown>) => void
): Promise<SiteAuth> {
  const cached = domainAuthCache.get(domain);
  if (cached) {
    if (cached.expires <= Date.now() && !domainAuthInFlight.has(domain)) {
      background(authenticateDomain(db, domain).catch(() => undefined));
    }
    return cached.auth;
  }
  const inFlight = domainAuthInFlight.get(domain);
  if (inFlight) return inFlight;
  const p = authenticateDomain(db, domain).finally(() => domainAuthInFlight.delete(domain));
  domainAuthInFlight.set(domain, p);
  return p;
}

/**
 * Does a browser Origin belong to the site that owns the key? The site key is
 * public (it sits in the page source), so without this anyone could inject
 * events into someone else's dashboard. Deliberately permissive where it must
 * be: subdomains count, and local development is allowed.
 */
function originAllowed(origin: string, domain: string): boolean {
  if (!origin || !domain) return true; // no Origin (server-side) or no domain on file
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')) return true;
  const site = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return host === site || host.endsWith(`.${site}`);
}

// Bodies are a few hundred bytes; anything larger is malformed or hostile and
// must be rejected before it is parsed into the isolate heap.
const MAX_BODY_BYTES = 8 * 1024;

/** `request.cf.latitude`/`longitude` arrive as strings; null when absent or out of range. */
function parseCoordinate(value: string | undefined, limit: number): number | null {
  if (!value) return null;
  const num = Number(value);
  return Number.isFinite(num) && Math.abs(num) <= limit ? num : null;
}

app.post('/api/event', async c => {
  const declared = Number(c.req.header('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return c.json({ error: 'payload too large' }, 413);
  const raw = await c.req.text().catch(() => '');
  if (!raw || raw.length > MAX_BODY_BYTES) return c.json({ error: 'invalid body' }, 400);
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: 'invalid body' }, 400);
  }
  if (!body) return c.json({ error: 'invalid body' }, 400);

  // Plausible-shaped payloads (script short keys or Events API long keys)
  // map onto the native event; everything downstream is shared.
  const pl = parsePlausible(body);
  let event: ValidatedTrackingEvent;
  if (pl) {
    // `s` doubles as rate-limit key and visitor-hash salt; the prefixed
    // domain is stable and can never collide with a real site key.
    event = { s: `d:${pl.domain}`, sid: '', ...pl.event };
  } else {
    const result = trackingEventSchema.safeParse(body);
    if (!result.success) return c.json({ error: 'invalid event' }, 400);
    event = result.data;
  }

  // Bot classification first - cheap regex check before any D1 round-trip.
  // The header is capped first: it feeds the bot regexes, the UA parser, and
  // the visitor HMAC, so an oversized UA would burn CPU on the cheapest
  // request. Bot pageviews are stored under event_type 'bot_pageview' (every
  // human-facing query predicates on event_type, so they never pollute those
  // metrics); bot engagement and custom events are still dropped - counting a
  // crawler's "time on page" or letting it fire conversion events would only
  // corrupt the panels that do look at those types. The one exception is the
  // reserved WebMCP tool-call event: headless/agentic browsers are exactly
  // who invokes a page's WebMCP tools, so their calls must be recorded.
  const ua = (c.req.header('user-agent') || '').slice(0, 512);
  const bot = botName(ua);
  const isWebmcpCall = event.t === 'event' && event.en === AUTO_EVENTS.WEBMCP;
  if (bot && event.t !== 'pageview' && !isWebmcpCall) return c.json({ ok: true });

  // Burst guard first (per colo, per site key): unknown keys must be cut here
  // too, otherwise a flood of random keys becomes an unmetered D1 amplifier.
  const { success } = await c.env.RATE_LIMIT.limit({ key: event.s });
  if (!success) return c.json({ error: 'rate limited' }, 429);

  // Site key validation + timezone/domain fetch. Cached per isolate and served
  // stale while it refreshes behind the response, so only a key this isolate
  // has never seen puts D1 on the critical path. Placed after the rate limit
  // so unknown keys still cannot amplify into D1.
  const site = pl
    ? await authenticateDomainCached(c.env.DB, pl.domain, p => c.executionCtx.waitUntil(p))
    : await authenticateSiteCached(c.env.DB, event.s, p => c.executionCtx.waitUntil(p));
  if (!site.valid) {
    return c.json({ error: 'unknown site' }, 403);
  }

  // The key is public, so the origin is what ties an event to its site.
  if (!originAllowed(c.req.header('origin') || '', site.domain)) {
    return c.json({ error: 'origin not allowed for this site' }, 403);
  }

  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '0.0.0.0';

  // Geo from Cloudflare request
  const cf = (c.req.raw as unknown as { cf?: Record<string, string | undefined> }).cf || {};
  // Arrival time is captured before the response; the deferred work below
  // must not stamp events with whenever the isolate got around to them.
  const now = new Date();

  // Everything past this point - UA/referrer parsing, the visitor-id HMAC,
  // bucket keys, and the dual write - is invisible to the response (always
  // `ok` once auth and origin have passed), so it runs behind it. The visitor
  // pays for validation, the rate-limit check and (only on first contact per
  // isolate) auth; the ~1ms of per-event parsing/crypto no longer sits on
  // their page's request. A failure here is logged and counted instead of
  // becoming a 500 the tracker would ignore anyway.
  c.executionCtx.waitUntil(
    (async () => {
      const country = cf.country || '';
      const city = cf.city || '';
      const region = cf.region || '';
      // City-level coordinates for the realtime globe. Hot path only: they go
      // to the live DO's rolling window, never into the Iceberg record below.
      const latitude = parseCoordinate(cf.latitude, 90);
      const longitude = parseCoordinate(cf.longitude, 180);

      const { hostname: refHostname, pathname: refPathname } = parseReferrer(event.r);
      // Bot rows carry the bot's display name where a browser name would go -
      // the UA parser yields junk for crawler strings, and the Bots panel
      // groups on this column.
      const parsed = parseUA(ua);
      const browser = bot ?? parsed.browser;
      const { os, deviceType } = parsed;
      // Only pageviews are retyped for bots; a bot's WebMCP tool call stays a
      // regular 'event' row (its agent name still lands in `browser` above).
      const eventType = bot && event.t === 'pageview' ? 'bot_pageview' : event.t;

      // Bucket keys are computed in the site's timezone so "today" hourly
      // buckets align with IST (or whatever the site runs on) rather than UTC.
      const { dateKey, hourKey, weekKey } = computeBucketKeys(now, site.timezone);

      // Visitor ID rotates on the same site-local day boundary as the buckets.
      const visitorId = await generateVisitorId(
        c.env.VISITOR_HASH_SECRET,
        ip,
        ua,
        event.s,
        dateKey
      );

      // Plausible has no client session id; approximate its server-side
      // sessionization with a deterministic 30-minute window (lib/plausible.ts).
      const sessionId =
        event.sid ||
        (pl ? await deriveSessionId(c.env.VISITOR_HASH_SECRET, visitorId, now.getTime()) : '');

      // Auto link events (outbound / download): re-serialize props to the exact
      // canonical form '{"url":"..."}' so link panels can GROUP BY the raw
      // event_meta string. User-defined custom events pass through untouched.
      let eventMeta = event.ep || '';
      if (
        event.t === 'event' &&
        (event.en === AUTO_EVENTS.OUTBOUND || event.en === AUTO_EVENTS.DOWNLOAD)
      ) {
        let url = '';
        try {
          url = String((JSON.parse(eventMeta || '{}') as { url?: unknown }).url || '').slice(
            0,
            500
          );
        } catch {
          // Malformed props - drop the URL, keep the event.
        }
        eventMeta = url ? JSON.stringify({ url }) : '';
      }
      // WebMCP tool calls: same canonicalization, exact form
      // '{"tool":"...","status":"ok"|"error"}' so panels can GROUP BY the raw
      // event_meta string and split calls from failures.
      if (isWebmcpCall) {
        let tool = '';
        let status = 'ok';
        try {
          const props = JSON.parse(eventMeta || '{}') as { tool?: unknown; status?: unknown };
          tool = String(props.tool || '').slice(0, 200);
          if (props.status === 'error') status = 'error';
        } catch {
          // Malformed props - keep the event, clear the meta; the WebMCP
          // panel only aggregates rows that name a tool.
        }
        eventMeta = tool ? JSON.stringify({ tool, status }) : '';
      }

      const record = {
        site_id: site.siteId,
        ts: now.getTime(),
        date_key: dateKey,
        hour_key: hourKey,
        week_key: weekKey,
        event_type: eventType,
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
        session_id: sessionId,
        visitor_id: visitorId,
        event_name: event.en || '',
        event_meta: eventMeta,
        event_value: event.ev || 0,
        screen_width: event.sw || 0,
      };

      // Dual write: the Pipelines stream feeds the durable Iceberg table
      // (system of record, historical queries); the site's Durable Object
      // serves "today" and realtime dashboards instantly. Each leg fails
      // independently.
      const liveStub = c.env.LIVE.get(c.env.LIVE.idFromName(site.siteId));
      await Promise.all([
        c.env.EVENTS.send([record]).catch(err => {
          console.error('Pipeline send failed:', err);
          countFailure(c.env, 'pipeline_send_failed', event.s);
        }),
        liveStub
          .record({
            ts: record.ts,
            hourKey: hourKey,
            eventType: eventType,
            pathname: event.p,
            referrerHostname: refHostname,
            utmSource: event.us || '',
            utmMedium: event.um || '',
            utmCampaign: event.uc || '',
            country,
            region,
            city,
            browser,
            os,
            deviceType,
            screenWidth: event.sw || 0,
            sessionId,
            visitorId: visitorId,
            eventName: event.en || '',
            eventMeta: eventMeta,
            eventValue: event.ev || 0,
            latitude,
            longitude,
          })
          .catch(err => {
            console.error('Live store write failed:', err);
            countFailure(c.env, 'live_write_failed', event.s);
          }),
      ]);
    })().catch(err => {
      // Parsing/crypto failed before either sink was reached: the event is
      // dropped. Count it - a spike here means misconfiguration (e.g. an
      // unset VISITOR_HASH_SECRET), not tracker noise.
      console.error('Event processing failed:', err);
      countFailure(c.env, 'ingest_process_failed', event.s);
    })
  );

  // Plausible's tracker treats any 2xx as delivered; mirror its 202.
  return pl ? c.text('ok', 202) : c.json({ ok: true });
});

export default app;
