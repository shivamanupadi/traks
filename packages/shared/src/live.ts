/**
 * Contract between the collect worker's SiteLiveStore Durable Object (hot
 * path: a rolling ~48h window of events in per-site SQLite) and the api
 * worker, which reads it through a cross-script Durable Object binding.
 *
 * The DO answers "today" and realtime dashboard queries in milliseconds with
 * zero ingest delay; historical periods stay on Iceberg + R2 SQL (cold path).
 */

/** Columns the DO can produce top-lists for. */
export type LiveDimension =
  | 'pathname'
  | 'referrer_hostname'
  | 'country'
  | 'region'
  | 'city'
  | 'browser'
  | 'os'
  | 'device_type'
  | 'utm_source'
  | 'utm_medium'
  | 'utm_campaign';

/**
 * Dimension -> exact-match value filters, applied on top of every dashboard
 * query (click-to-filter). Keys are the canonical column dimensions.
 */
export type LiveFilters = Partial<Record<LiveDimension, string>>;

/** Dashboard-facing filter parameter names (URL search params / API query). */
export type FilterParam =
  | 'page'
  | 'source'
  | 'utmSource'
  | 'utmMedium'
  | 'utmCampaign'
  | 'country'
  | 'region'
  | 'city'
  | 'browser'
  | 'os'
  | 'device';

/** Filter parameter -> canonical column dimension. */
export const FILTER_PARAM_TO_DIMENSION: Record<FilterParam, LiveDimension> = {
  page: 'pathname',
  source: 'referrer_hostname',
  utmSource: 'utm_source',
  utmMedium: 'utm_medium',
  utmCampaign: 'utm_campaign',
  country: 'country',
  region: 'region',
  city: 'city',
  browser: 'browser',
  os: 'os',
  device: 'device_type',
};

/** Map dashboard filter params to LiveFilters; undefined when nothing is set. */
export function toLiveFilters(
  params: Partial<Record<FilterParam, string | undefined>>
): LiveFilters | undefined {
  const filters: LiveFilters = {};
  for (const [param, dimension] of Object.entries(FILTER_PARAM_TO_DIMENSION) as [
    FilterParam,
    LiveDimension,
  ][]) {
    const value = params[param];
    if (value !== undefined && value !== '') filters[dimension] = value;
  }
  return Object.keys(filters).length > 0 ? filters : undefined;
}

/** The subset of the ingest record the hot path needs. */
export interface LiveEvent {
  ts: number; // epoch ms
  hourKey: string; // YYYY-MM-DDTHH in the site's timezone
  eventType: string; // 'pageview' | 'event'
  pathname: string;
  referrerHostname: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  country: string;
  region: string;
  city: string;
  browser: string;
  os: string;
  deviceType: string;
  screenWidth: number;
  sessionId: string;
  visitorId: string;
  eventName: string;
  /** Custom-event props JSON (canonical `{"url":"..."}` for auto link events). */
  eventMeta: string;
  eventValue: number;
  /**
   * Approximate (city-level) coordinates from Cloudflare's edge geo lookup.
   * Hot path only: they feed the realtime globe and live in the DO's rolling
   * window - never written to the Iceberg system of record.
   */
  latitude?: number | null;
  longitude?: number | null;
}

export interface LiveCounts {
  pageviews: number;
  visitors: number;
  sessions: number;
}

export interface LiveTotals extends LiveCounts {
  bounces: number;
  /** Total engaged seconds ('engagement' events) in the window. */
  engagedSeconds: number;
}

/** A goal definition the DO evaluates (id + what to match). */
export interface LiveGoalTarget {
  id: string;
  type: 'event' | 'page';
  /** event_name, or pathname (may end in '/*' for a section prefix). */
  target: string;
  /** Optional event-prop exact-match condition. */
  propKey?: string | null;
  propValue?: string | null;
}

export interface LiveGoalRow {
  goalId: string;
  events: number;
  visitors: number;
}

export interface LiveTimeseriesRow {
  t: string;
  pageviews: number;
  visitors: number;
  sessions: number;
}

export interface LiveTopListRow {
  name: string;
  visitors: number;
  pageviews: number;
  sessions: number;
  /** ISO country code accompanying region/city rows (for flag display). */
  country?: string;
}

export interface LiveRealtimeRow {
  pathname: string;
  visitors: number;
}

/** One point on the realtime globe: visitors currently active near a city. */
export interface LiveRealtimeLocation {
  latitude: number;
  longitude: number;
  country: string;
  city: string;
  visitors: number;
}

export interface LiveRealtimeNamed {
  name: string;
  visitors: number;
}

/** Realtime window result: per-page rows plus the TRUE overall distinct
 *  visitor count - summing per-page rows double-counts multi-page visitors. */
export interface LiveRealtime {
  total: number;
  rows: LiveRealtimeRow[];
  /** Where the active visitors are (rows without coordinates are omitted). */
  locations: LiveRealtimeLocation[];
  /** External referrer hostnames of the active visitors. */
  referrers: LiveRealtimeNamed[];
  /** ISO country codes of the active visitors. */
  countries: LiveRealtimeNamed[];
}

/**
 * Frame pushed over the realtime WebSocket (the DO's `fetch` handler accepts
 * `Upgrade: websocket`; the api worker proxies authenticated dashboards to
 * it). Same shape the REST `/stats/realtime` route returns, so the dashboard
 * can treat a poll and a push identically. `filters` echoes what the frame
 * was computed with, so a client that just changed filters can drop frames
 * still in flight for the old set.
 */
export interface LiveRealtimeFrame {
  type: 'realtime';
  /** Epoch ms the frame was computed at. */
  at: number;
  filters?: LiveFilters;
  currentVisitors: number;
  topPages: { path: string; visitors: number }[];
  locations: LiveRealtimeLocation[];
  referrers: LiveRealtimeNamed[];
  countries: LiveRealtimeNamed[];
}

/**
 * What a dashboard may send up the realtime socket. Filters are stored per
 * socket (as a hibernation attachment) and every later frame for that socket
 * is computed against them.
 */
export type LiveSocketCommand = { type: 'filters'; filters: LiveFilters };

export interface LiveCustomEventRow {
  name: string;
  count: number;
  totalValue: number;
}

/** Outbound-link / file-download breakdown row (from auto link events). */
export interface LiveLinkRow {
  url: string;
  visitors: number;
  clicks: number;
}

/** Entry/exit pages row: sessions that started (or ended) on the pathname. */
export interface LiveEntryPageRow {
  name: string;
  visitors: number;
  sessions: number;
}

/** Screen-size bucket row (Mobile / Tablet / Laptop / Desktop). */
export interface LiveScreenSizeRow {
  name: string;
  visitors: number;
}

/** One distinct event_meta JSON string and how many events carried it. */
export interface LiveMetaRow {
  meta: string;
  events: number;
}

/**
 * Everything the unfiltered today-dashboard needs, in one RPC. The api's
 * /stats/all hot path previously issued seven parallel RPCs for this - all
 * resolving to the SAME single-threaded object, so they serialized inside it
 * while each paid its own cross-script round-trip.
 */
export interface LiveDashboard {
  main: { current: LiveTotals; previous: LiveTotals };
  timeseries: LiveTimeseriesRow[];
  pages: LiveTopListRow[];
  referrers: LiveTopListRow[];
  /** Country top-list (name = ISO code). */
  locations: LiveTopListRow[];
  browsers: LiveTopListRow[];
  os: LiveTopListRow[];
}

/** RPC surface of SiteLiveStore. All ranges are [fromMs, toMs) epoch ms. */
export interface LiveStoreApi {
  /** Stores the event and returns the site's event count for its calendar month (site tz) - used for quota enforcement. */
  record(event: LiveEvent): Promise<number>;
  /** Wipes all stored data for this site (site deletion). */
  purge(): Promise<void>;
  totals(fromMs: number, toMs: number, filters?: LiveFilters): Promise<LiveCounts>;
  /**
   * Current window [curFromMs, toMs) and comparison window
   * [prevFromMs, prevToMs) in one pass. `prevToMs` defaults to `curFromMs`
   * (contiguous windows) for older callers; the api passes the same-clock
   * window one day earlier, which leaves a gap that is excluded.
   */
  mainStats(
    prevFromMs: number,
    curFromMs: number,
    toMs: number,
    filters?: LiveFilters,
    prevToMs?: number
  ): Promise<{ current: LiveTotals; previous: LiveTotals }>;
  /**
   * The whole unfiltered today-dashboard in one round-trip (see
   * LiveDashboard). Windows follow mainStats: current [curFromMs, toMs),
   * comparison [prevFromMs, prevToMs).
   */
  dashboard(
    prevFromMs: number,
    curFromMs: number,
    toMs: number,
    prevToMs: number
  ): Promise<LiveDashboard>;
  timeseries(fromMs: number, toMs: number, filters?: LiveFilters): Promise<LiveTimeseriesRow[]>;
  topList(
    dimension: LiveDimension,
    fromMs: number,
    toMs: number,
    limit: number,
    filters?: LiveFilters
  ): Promise<LiveTopListRow[]>;
  /** Pageviews referred by known AI assistants, grouped by assistant. */
  aiSources(
    fromMs: number,
    toMs: number,
    limit: number,
    filters?: LiveFilters
  ): Promise<LiveTopListRow[]>;
  /** Active visitors in the last 5 minutes: total, pages, locations, referrers, countries. */
  realtime(nowMs: number, filters?: LiveFilters): Promise<LiveRealtime>;
  /** Conversion counts per goal definition. */
  goalStats(
    fromMs: number,
    toMs: number,
    goals: LiveGoalTarget[],
    filters?: LiveFilters
  ): Promise<LiveGoalRow[]>;
  customEvents(
    fromMs: number,
    toMs: number,
    limit: number,
    filters?: LiveFilters
  ): Promise<LiveCustomEventRow[]>;
  /** Target-URL breakdown for one auto link event (outbound / download). */
  linkClicks(
    eventName: string,
    fromMs: number,
    toMs: number,
    limit: number,
    filters?: LiveFilters
  ): Promise<LiveLinkRow[]>;
  /** Pages sessions started ('entry') or ended ('exit') on. */
  entryExitPages(
    kind: 'entry' | 'exit',
    fromMs: number,
    toMs: number,
    limit: number,
    filters?: LiveFilters
  ): Promise<LiveEntryPageRow[]>;
  /** Visitors bucketed by screen width (Mobile/Tablet/Laptop/Desktop). */
  screenSizes(fromMs: number, toMs: number, filters?: LiveFilters): Promise<LiveScreenSizeRow[]>;
  /** Distinct event_meta groups for one custom event (props parsed by the API). */
  eventMetaGroups(
    eventName: string,
    fromMs: number,
    toMs: number,
    limit: number,
    filters?: LiveFilters
  ): Promise<LiveMetaRow[]>;
}
