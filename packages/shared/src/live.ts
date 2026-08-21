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

/** Realtime window result: per-page rows plus the TRUE overall distinct
 *  visitor count - summing per-page rows double-counts multi-page visitors. */
export interface LiveRealtime {
  total: number;
  rows: LiveRealtimeRow[];
  /** Where the active visitors are (rows without coordinates are omitted). */
  locations: LiveRealtimeLocation[];
}

/**
 * Frame pushed over the realtime WebSocket (the DO's `fetch` handler accepts
 * `Upgrade: websocket`; the api worker proxies authenticated dashboards to
 * it). Same shape the REST `/stats/realtime` route returns, so the dashboard
 * can treat a poll and a push identically.
 */
export interface LiveRealtimeFrame {
  type: 'realtime';
  /** Epoch ms the frame was computed at. */
  at: number;
  currentVisitors: number;
  topPages: { path: string; visitors: number }[];
  locations: LiveRealtimeLocation[];
}

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
  /** Active visitors in the last 5 minutes: total, top pages, locations. */
  realtime(nowMs: number): Promise<LiveRealtime>;
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
