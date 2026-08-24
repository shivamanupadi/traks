/**
 * Plausible-compatible event payloads.
 *
 * Plausible's tracker script POSTs short keys (n/u/d/r/w/h/p) and its public
 * Events API documents long keys (name/url/domain/referrer/props/revenue) to
 * the same path this worker already serves, `POST /api/event`. Payloads are
 * told apart from our own tracker's by shape: ours always carries the site
 * key `s`; Plausible's never does and always carries a domain + url.
 *
 * Differences from the native path, by design:
 * - The site is resolved by its (unique) domain instead of a site key.
 * - UTM tags are extracted server-side from the url's query string.
 * - Plausible has no client session id (it sessionizes server-side with a
 *   30-minute inactivity window); the collect worker derives a deterministic
 *   session id from the visitor id + a fixed 30-minute clock bucket instead.
 *   Fixed windows are not inactivity windows, so visit counts and durations
 *   for Plausible-sourced traffic are close but not identical to Plausible's.
 */

export interface PlausiblePayload {
  domain: string;
  /** Mapped onto the native tracker-event fields. */
  event: {
    t: 'pageview' | 'event' | 'engagement';
    p: string;
    h: string;
    r: string;
    sw: number;
    us?: string;
    um?: string;
    uc?: string;
    en?: string;
    ep?: string;
    ev?: number;
  };
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * Parse a Plausible-shaped body. Returns null when the body is not
 * Plausible-shaped (native payloads, garbage) - the caller then falls through
 * to the native schema, whose own validation still applies.
 */
export function parsePlausible(body: unknown): PlausiblePayload | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.s === 'string') return null; // native payload
  const name = str(b.n ?? b.name, 256);
  const url = str(b.u ?? b.url, 2048);
  const domain = str(b.d ?? b.domain, 256).toLowerCase();
  if (!name || !url || !domain) return null;

  let hostname = '';
  let pathname = '/';
  let us: string | undefined;
  let um: string | undefined;
  let uc: string | undefined;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname.toLowerCase();
    pathname = parsed.pathname || '/';
    // Legacy hash-routing mode: the meaningful path lives in the fragment.
    if ((b.h === 1 || b.h === '1' || b.h === true) && parsed.hash) {
      pathname += parsed.hash;
    }
    us = parsed.searchParams.get('utm_source')?.slice(0, 256) || undefined;
    um = parsed.searchParams.get('utm_medium')?.slice(0, 256) || undefined;
    uc = parsed.searchParams.get('utm_campaign')?.slice(0, 256) || undefined;
  } catch {
    return null;
  }

  // Props: the script sends a JSON string under p (in hash mode p is NOT
  // props - it collides with the legacy meta key - so only trust objects
  // there), the Events API sends an object under props.
  let ep: string | undefined;
  const rawProps = b.props ?? b.p;
  if (typeof rawProps === 'object' && rawProps !== null) {
    const json = JSON.stringify(rawProps);
    if (json.length <= 1024 && json !== '{}') ep = json;
  } else if (typeof rawProps === 'string' && rawProps.length <= 1024 && rawProps !== '{}') {
    ep = rawProps;
  }

  // Events API revenue: { currency, amount }. Amount only - single-currency
  // sums are the site owner's concern, matching our native ev semantics.
  let ev: number | undefined;
  const revenue = b.revenue as { amount?: unknown } | undefined;
  if (revenue && typeof revenue === 'object') {
    const amount = Number(revenue.amount);
    if (Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000) ev = amount;
  }

  const sw = typeof b.w === 'number' && b.w > 0 && b.w <= 10000 ? Math.round(b.w) : 0;
  const r = str(b.r ?? b.referrer, 2048);

  if (name === 'pageview') {
    return { domain, event: { t: 'pageview', p: pathname, h: hostname, r, sw, us, um, uc } };
  }
  if (name === 'engagement') {
    // Plausible's engagement beacon carries engagement time in ms under `e`.
    const seconds = Number(b.e);
    return {
      domain,
      event: {
        t: 'engagement',
        p: pathname,
        h: hostname,
        r,
        sw,
        us,
        um,
        uc,
        ev: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds / 1000, 86_400) : 0,
      },
    };
  }
  return {
    domain,
    event: { t: 'event', p: pathname, h: hostname, r, sw, us, um, uc, en: name, ep, ev },
  };
}

/** Plausible sessionizes server-side; approximate with fixed 30-min windows. */
export const SESSION_WINDOW_MS = 30 * 60 * 1000;

export async function deriveSessionId(
  secret: string,
  visitorId: string,
  now: number
): Promise<string> {
  const bucket = Math.floor(now / SESSION_WINDOW_MS);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret + '|session'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${visitorId}|${bucket}`)
  );
  return [...new Uint8Array(sig)]
    .slice(0, 12)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
