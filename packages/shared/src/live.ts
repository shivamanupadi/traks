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

export interface LiveGoalRow {
  /** The matched event_name or pathname. */
  target: string;
  kind: 'event' | 'page';
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
}

export interface LiveRealtimeRow {
  pathname: string;
  visitors: number;
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
  /** Stores the event and returns the site's event count for its calendar month (site tz) — used for quota enforcement. */
  record(event: LiveEvent): Promise<number>;
  /** Wipes all stored data for this site (site deletion). */
  purge(): Promise<void>;
  totals(fromMs: number, toMs: number, filters?: LiveFilters): Promise<LiveCounts>;
  mainStats(
    prevFromMs: number,
    curFromMs: number,
    toMs: number,
    filters?: LiveFilters
  ): Promise<{ current: LiveTotals; previous: LiveTotals }>;
  timeseries(fromMs: number, toMs: number, filters?: LiveFilters): Promise<LiveTimeseriesRow[]>;
  topList(
    dimension: LiveDimension,
    fromMs: number,
    toMs: number,
    limit: number,
    filters?: LiveFilters
  ): Promise<LiveTopListRow[]>;
  realtime(nowMs: number): Promise<LiveRealtimeRow[]>;
  /** Conversion counts for goal targets (event names + pathnames). */
  goalStats(
    fromMs: number,
    toMs: number,
    eventNames: string[],
    pathnames: string[],
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
