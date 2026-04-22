/**
 * Iceberg table schema for Traks events.
 *
 * Written by the collect Worker via the Pipelines binding.
 * Queried by the api Worker via R2 SQL.
 *
 * Partitioned by (site_id, day(ts)) in Iceberg — filtering by site_id and ts
 * enables partition pruning in R2 SQL.
 *
 * date_key and hour_key are computed at ingest time to avoid relying on date
 * functions in R2 SQL (which only guarantees EXTRACT).
 */

export const EVENT_TYPES = {
  PAGEVIEW: 'pageview',
  EVENT: 'event',
} as const;

export const PERIODS = ['today', '7d', '30d', '90d', '6m', '1y', 'all'] as const;
export type Period = (typeof PERIODS)[number];

// Both envs use `traks.events` — physical isolation is per-bucket (R2_BUCKET_NAME env),
// so the namespace/table pair can match without collision. Keeps naming symmetric.
export const TABLE_PROD = 'traks.events';
export const TABLE_DEV = 'traks.events';
