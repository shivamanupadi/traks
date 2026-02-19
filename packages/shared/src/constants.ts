/**
 * Analytics Engine column mapping.
 *
 * INDEX: site API key (all queries filter on this)
 *
 * BLOBS (strings - dimensions for GROUP BY / filtering):
 *   blob1  = event_type        ("pageview" | "event")
 *   blob2  = pathname          ("/pricing", "/blog/post-1")
 *   blob3  = hostname          ("sketchmat.com")
 *   blob4  = referrer_hostname ("google.com", "t.co", "" for direct)
 *   blob5  = referrer_pathname (full referrer path)
 *   blob6  = utm_source        ("twitter", "newsletter")
 *   blob7  = utm_medium        ("social", "email", "cpc")
 *   blob8  = utm_campaign      ("launch-2025")
 *   blob9  = free (was utm_term)
 *   blob10 = free (was utm_content)
 *   blob11 = country           (from cf.country, "US", "IN")
 *   blob12 = city              (from cf.city)
 *   blob13 = region            (from cf.region)
 *   blob14 = browser           ("Chrome", "Firefox", "Safari")
 *   blob15 = os                ("Windows", "macOS", "iOS", "Android")
 *   blob16 = device_type       ("desktop", "mobile", "tablet")
 *   blob17 = session_id        (random token from client sessionStorage)
 *   blob18 = visitor_id        (server-side HMAC: daily_salt + IP + UA + site_key)
 *   blob19 = event_name        (custom events: "signup_click")
 *   blob20 = event_meta        (JSON string for custom event props)
 *
 * DOUBLES (numbers - metrics for aggregation):
 *   double1 = reserved           (was is_unique - now using COUNT(DISTINCT visitor_id))
 *   double2 = reserved           (was is_session_start - now using COUNT(DISTINCT session_id))
 *   double3 = reserved (bounce)
 *   double4 = reserved (scroll_depth)
 *   double5 = reserved (time_on_page)
 *   double6 = event_value        (numeric value for custom events)
 *   double7 = screen_width       (pixels)
 */

export const BLOB = {
  EVENT_TYPE: 'blob1',
  PATHNAME: 'blob2',
  HOSTNAME: 'blob3',
  REFERRER_HOSTNAME: 'blob4',
  REFERRER_PATHNAME: 'blob5',
  UTM_SOURCE: 'blob6',
  UTM_MEDIUM: 'blob7',
  UTM_CAMPAIGN: 'blob8',
  // blob9: free (was utm_term)
  // blob10: free (was utm_content)
  COUNTRY: 'blob11',
  CITY: 'blob12',
  REGION: 'blob13',
  BROWSER: 'blob14',
  OS: 'blob15',
  DEVICE_TYPE: 'blob16',
  SESSION_ID: 'blob17',
  VISITOR_ID: 'blob18',
  EVENT_NAME: 'blob19',
  EVENT_META: 'blob20',
} as const;

export const DOUBLE = {
  EVENT_VALUE: 'double6',
  SCREEN_WIDTH: 'double7',
} as const;

export const EVENT_TYPES = {
  PAGEVIEW: 'pageview',
  EVENT: 'event',
} as const;

export const PERIODS = ['today', '7d', '30d', '90d', '6m', '1y', 'all'] as const;
export type Period = (typeof PERIODS)[number];

export type ArchivedPeriod = '6m' | '1y' | 'all';
export const isArchivedPeriod = (p: Period): p is ArchivedPeriod =>
  p === '6m' || p === '1y' || p === 'all';

// Dataset name - overridden per environment via query config
export const DATASET_PROD = 'traks';
export const DATASET_DEV = 'traks-dev';
