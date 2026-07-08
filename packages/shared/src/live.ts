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
  | 'city'
  | 'browser'
  | 'os'
  | 'device_type'
  | 'utm_source'
  | 'utm_medium'
  | 'utm_campaign';

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
  city: string;
  browser: string;
  os: string;
  deviceType: string;
  sessionId: string;
  visitorId: string;
  eventName: string;
  eventValue: number;
}

export interface LiveCounts {
  pageviews: number;
  visitors: number;
  sessions: number;
}

export interface LiveTotals extends LiveCounts {
  bounces: number;
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

/** Raw stored row, as returned by exportEvents (snake_case = file/DB shape). */
export interface LiveExportRow {
  ts: number;
  hour_key: string;
  event_type: string;
  pathname: string;
  referrer_hostname: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  country: string;
  city: string;
  browser: string;
  os: string;
  device_type: string;
  session_id: string;
  visitor_id: string;
  event_name: string;
  event_value: number;
}

/** RPC surface of SiteLiveStore. All ranges are [fromMs, toMs) epoch ms. */
export interface LiveStoreApi {
  record(event: LiveEvent): Promise<void>;
  totals(fromMs: number, toMs: number): Promise<LiveCounts>;
  mainStats(
    prevFromMs: number,
    curFromMs: number,
    toMs: number
  ): Promise<{ current: LiveTotals; previous: LiveTotals }>;
  timeseries(fromMs: number, toMs: number): Promise<LiveTimeseriesRow[]>;
  topList(
    dimension: LiveDimension,
    fromMs: number,
    toMs: number,
    limit: number
  ): Promise<LiveTopListRow[]>;
  realtime(nowMs: number): Promise<LiveRealtimeRow[]>;
  customEvents(fromMs: number, toMs: number, limit: number): Promise<LiveCustomEventRow[]>;
  /** Paginated raw dump for the nightly export job (ordered by ts). */
  exportEvents(
    fromMs: number,
    toMs: number,
    offset: number,
    limit: number
  ): Promise<LiveExportRow[]>;
}
