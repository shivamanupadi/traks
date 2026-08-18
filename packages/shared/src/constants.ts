/**
 * Iceberg table schema for Traks events.
 *
 * Written by the collect Worker via the Pipelines binding.
 * Queried by the api Worker via R2 SQL.
 *
 * NOT partitioned: the Pipelines R2 Data Catalog sink exposes no partition
 * spec (checked Aug 2026), so R2 SQL prunes only on Parquet row-group min/max
 * statistics. Because rows land in arrival order that prunes `ts` well, which
 * is why every query builder filters on the time range first; `site_id` prunes
 * weakly, though each instance's bucket only ever holds its own sites. Revisit
 * if Cloudflare ships partitioned sinks.
 *
 * date_key and hour_key are computed at ingest time to avoid relying on date
 * functions in R2 SQL (which only guarantees EXTRACT).
 */

export const EVENT_TYPES = {
  PAGEVIEW: 'pageview',
  EVENT: 'event',
} as const;

/**
 * Reserved event names the tracker fires automatically. Stored as regular
 * custom events with a canonical `event_meta` of `{"url":"..."}` (the collect
 * worker re-serializes it), so link panels can GROUP BY the raw meta string
 * on both the hot and cold paths without JSON functions.
 */
export const AUTO_EVENTS = {
  OUTBOUND: 'Outbound Link: Click',
  DOWNLOAD: 'File Download',
} as const;

export const PERIODS = ['today', 'yesterday', '7d', '30d', '90d', '6m', '1y', 'all'] as const;
export type Period = (typeof PERIODS)[number];

// Both envs use `traks.events` - physical isolation is per-bucket (R2_BUCKET_NAME env),
// so the namespace/table pair can match without collision. Keeps naming symmetric.
export const TABLE_PROD = 'traks.events';
export const TABLE_DEV = 'traks.events';
