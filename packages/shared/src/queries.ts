import { BLOB, DOUBLE } from './constants';
import type { Period } from './constants';

export interface QueryConfig {
  accountId: string;
  apiToken: string;
  dataset: string;
}

export async function queryAnalyticsEngine<T = any>(
  config: QueryConfig,
  buildQuery: (dataset: string) => string
): Promise<T[]> {
  const sql = buildQuery(config.dataset);
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiToken}` },
      body: sql,
    }
  );

  if (!response.ok) {
    const text = await response.text();
    console.error(`Analytics Engine query failed: ${response.status} ${text}`);
    return [];
  }

  const result: any = await response.json();
  return result.data || [];
}

function periodToInterval(period: Period): string {
  switch (period) {
    case 'today':
      return "'1' DAY";
    case '7d':
      return "'7' DAY";
    case '30d':
      return "'30' DAY";
    case '90d':
      return "'90' DAY";
    default:
      return "'7' DAY";
  }
}

function periodToGranularity(period: Period): string {
  switch (period) {
    case 'today':
      return 'toStartOfHour';
    case '7d':
      return 'toStartOfDay';
    case '30d':
      return 'toStartOfDay';
    case '90d':
      return 'toStartOfDay';
    default:
      return 'toStartOfDay';
  }
}

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

export function buildMainStatsQuery(siteKey: string, period: Period) {
  const interval = periodToInterval(period);
  const key = esc(siteKey);
  return (dataset: string) => `
    SELECT
      SUM(_sample_interval) AS pageviews,
      COUNT(DISTINCT ${BLOB.VISITOR_ID}) AS visitors,
      COUNT(DISTINCT ${BLOB.SESSION_ID}) AS sessions
    FROM ${dataset}
    WHERE
      index1 = '${key}'
      AND ${BLOB.EVENT_TYPE} = 'pageview'
      AND timestamp >= NOW() - INTERVAL ${interval}
  `;
}

export function buildPreviousPeriodQuery(siteKey: string, period: Period) {
  const interval = periodToInterval(period);
  const key = esc(siteKey);
  return (dataset: string) => `
    SELECT
      SUM(_sample_interval) AS pageviews,
      COUNT(DISTINCT ${BLOB.VISITOR_ID}) AS visitors,
      COUNT(DISTINCT ${BLOB.SESSION_ID}) AS sessions
    FROM ${dataset}
    WHERE
      index1 = '${key}'
      AND ${BLOB.EVENT_TYPE} = 'pageview'
      AND timestamp >= NOW() - INTERVAL ${interval} - INTERVAL ${interval}
      AND timestamp < NOW() - INTERVAL ${interval}
  `;
}

export function buildTimeseriesQuery(siteKey: string, period: Period) {
  const interval = periodToInterval(period);
  const granularity = periodToGranularity(period);
  const key = esc(siteKey);
  return (dataset: string) => `
    SELECT
      ${granularity}(timestamp) AS t,
      SUM(_sample_interval) AS pageviews,
      COUNT(DISTINCT ${BLOB.VISITOR_ID}) AS visitors,
      COUNT(DISTINCT ${BLOB.SESSION_ID}) AS sessions
    FROM ${dataset}
    WHERE
      index1 = '${key}'
      AND ${BLOB.EVENT_TYPE} = 'pageview'
      AND timestamp >= NOW() - INTERVAL ${interval}
    GROUP BY t
    ORDER BY t ASC
  `;
}

export function buildTopPagesQuery(siteKey: string, period: Period, limit = 10) {
  const interval = periodToInterval(period);
  const key = esc(siteKey);
  return (dataset: string) => `
    SELECT
      ${BLOB.PATHNAME} AS pathname,
      SUM(_sample_interval) AS pageviews,
      COUNT(DISTINCT ${BLOB.VISITOR_ID}) AS visitors
    FROM ${dataset}
    WHERE
      index1 = '${key}'
      AND ${BLOB.EVENT_TYPE} = 'pageview'
      AND timestamp >= NOW() - INTERVAL ${interval}
    GROUP BY pathname
    ORDER BY pageviews DESC
    LIMIT ${limit}
  `;
}

export function buildTopReferrersQuery(siteKey: string, period: Period, limit = 10) {
  const interval = periodToInterval(period);
  const key = esc(siteKey);
  return (dataset: string) => `
    SELECT
      ${BLOB.REFERRER_HOSTNAME} AS source,
      COUNT(DISTINCT ${BLOB.VISITOR_ID}) AS visitors
    FROM ${dataset}
    WHERE
      index1 = '${key}'
      AND ${BLOB.EVENT_TYPE} = 'pageview'
      AND ${BLOB.REFERRER_HOSTNAME} != ''
      AND timestamp >= NOW() - INTERVAL ${interval}
    GROUP BY source
    ORDER BY visitors DESC
    LIMIT ${limit}
  `;
}

export function buildUtmQuery(
  siteKey: string,
  period: Period,
  type: 'source' | 'medium' | 'campaign',
  limit = 10
) {
  const interval = periodToInterval(period);
  const key = esc(siteKey);
  const blobCol =
    type === 'source' ? BLOB.UTM_SOURCE : type === 'medium' ? BLOB.UTM_MEDIUM : BLOB.UTM_CAMPAIGN;
  return (dataset: string) => `
    SELECT
      ${blobCol} AS value,
      COUNT(DISTINCT ${BLOB.VISITOR_ID}) AS visitors,
      COUNT(DISTINCT ${BLOB.SESSION_ID}) AS sessions
    FROM ${dataset}
    WHERE
      index1 = '${key}'
      AND ${BLOB.EVENT_TYPE} = 'pageview'
      AND ${blobCol} != ''
      AND timestamp >= NOW() - INTERVAL ${interval}
    GROUP BY value
    ORDER BY visitors DESC
    LIMIT ${limit}
  `;
}

export function buildLocationsQuery(
  siteKey: string,
  period: Period,
  type: 'country' | 'city',
  limit = 10
) {
  const interval = periodToInterval(period);
  const key = esc(siteKey);
  const blobCol = type === 'country' ? BLOB.COUNTRY : BLOB.CITY;
  return (dataset: string) => `
    SELECT
      ${blobCol} AS name,
      COUNT(DISTINCT ${BLOB.VISITOR_ID}) AS visitors
    FROM ${dataset}
    WHERE
      index1 = '${key}'
      AND ${BLOB.EVENT_TYPE} = 'pageview'
      AND ${blobCol} != ''
      AND timestamp >= NOW() - INTERVAL ${interval}
    GROUP BY name
    ORDER BY visitors DESC
    LIMIT ${limit}
  `;
}

export function buildDevicesQuery(
  siteKey: string,
  period: Period,
  type: 'browser' | 'os' | 'device',
  limit = 10
) {
  const interval = periodToInterval(period);
  const key = esc(siteKey);
  const blobCol = type === 'browser' ? BLOB.BROWSER : type === 'os' ? BLOB.OS : BLOB.DEVICE_TYPE;
  return (dataset: string) => `
    SELECT
      ${blobCol} AS name,
      COUNT(DISTINCT ${BLOB.VISITOR_ID}) AS visitors
    FROM ${dataset}
    WHERE
      index1 = '${key}'
      AND ${BLOB.EVENT_TYPE} = 'pageview'
      AND ${blobCol} != ''
      AND timestamp >= NOW() - INTERVAL ${interval}
    GROUP BY name
    ORDER BY visitors DESC
    LIMIT ${limit}
  `;
}

export function buildRealtimeQuery(siteKey: string) {
  const key = esc(siteKey);
  return (dataset: string) => `
    SELECT
      COUNT(DISTINCT ${BLOB.VISITOR_ID}) AS visitors,
      ${BLOB.PATHNAME} AS pathname
    FROM ${dataset}
    WHERE
      index1 = '${key}'
      AND ${BLOB.EVENT_TYPE} = 'pageview'
      AND timestamp >= NOW() - INTERVAL '5' MINUTE
    GROUP BY pathname
    ORDER BY visitors DESC
    LIMIT 10
  `;
}

export function buildEventsQuery(siteKey: string, period: Period, limit = 20) {
  const interval = periodToInterval(period);
  const key = esc(siteKey);
  return (dataset: string) => `
    SELECT
      ${BLOB.EVENT_NAME} AS name,
      SUM(_sample_interval) AS count,
      SUM(${DOUBLE.EVENT_VALUE} * _sample_interval) AS total_value
    FROM ${dataset}
    WHERE
      index1 = '${key}'
      AND ${BLOB.EVENT_TYPE} = 'event'
      AND ${BLOB.EVENT_NAME} != ''
      AND timestamp >= NOW() - INTERVAL ${interval}
    GROUP BY name
    ORDER BY count DESC
    LIMIT ${limit}
  `;
}

// ============ Daily archive query builders ============
// These use toDate(timestamp) = 'YYYY-MM-DD' for exact day filtering

export function buildDailyStatsQuery(siteKey: string, date: string, toDate?: string) {
  const key = esc(siteKey);
  const d = esc(date);
  const dateFilter = toDate
    ? `toDate(timestamp) >= '${d}' AND toDate(timestamp) <= '${esc(toDate)}'`
    : `toDate(timestamp) = '${d}'`;
  return (dataset: string) => `
    SELECT
      SUM(_sample_interval) AS pageviews,
      COUNT(DISTINCT ${BLOB.VISITOR_ID}) AS visitors,
      COUNT(DISTINCT ${BLOB.SESSION_ID}) AS sessions
    FROM ${dataset}
    WHERE
      index1 = '${key}'
      AND ${BLOB.EVENT_TYPE} = 'pageview'
      AND ${dateFilter}
  `;
}

export function buildDailyPagesQuery(siteKey: string, date: string, toDate?: string, limit = 500) {
  const key = esc(siteKey);
  const d = esc(date);
  const dateFilter = toDate
    ? `toDate(timestamp) >= '${d}' AND toDate(timestamp) <= '${esc(toDate)}'`
    : `toDate(timestamp) = '${d}'`;
  return (dataset: string) => `
    SELECT
      ${BLOB.PATHNAME} AS pathname,
      SUM(_sample_interval) AS pageviews,
      COUNT(DISTINCT ${BLOB.VISITOR_ID}) AS visitors
    FROM ${dataset}
    WHERE
      index1 = '${key}'
      AND ${BLOB.EVENT_TYPE} = 'pageview'
      AND ${dateFilter}
    GROUP BY pathname
    ORDER BY pageviews DESC
    LIMIT ${limit}
  `;
}

export function buildDailyReferrersQuery(
  siteKey: string,
  date: string,
  toDate?: string,
  limit = 500
) {
  const key = esc(siteKey);
  const d = esc(date);
  const dateFilter = toDate
    ? `toDate(timestamp) >= '${d}' AND toDate(timestamp) <= '${esc(toDate)}'`
    : `toDate(timestamp) = '${d}'`;
  return (dataset: string) => `
    SELECT
      ${BLOB.REFERRER_HOSTNAME} AS source,
      COUNT(DISTINCT ${BLOB.VISITOR_ID}) AS visitors
    FROM ${dataset}
    WHERE
      index1 = '${key}'
      AND ${BLOB.EVENT_TYPE} = 'pageview'
      AND ${BLOB.REFERRER_HOSTNAME} != ''
      AND ${dateFilter}
    GROUP BY source
    ORDER BY visitors DESC
    LIMIT ${limit}
  `;
}

export function buildDailyLocationsQuery(
  siteKey: string,
  date: string,
  type: 'country' | 'city',
  toDate?: string,
  limit = 500
) {
  const key = esc(siteKey);
  const d = esc(date);
  const blobCol = type === 'country' ? BLOB.COUNTRY : BLOB.CITY;
  const dateFilter = toDate
    ? `toDate(timestamp) >= '${d}' AND toDate(timestamp) <= '${esc(toDate)}'`
    : `toDate(timestamp) = '${d}'`;
  return (dataset: string) => `
    SELECT
      ${blobCol} AS name,
      COUNT(DISTINCT ${BLOB.VISITOR_ID}) AS visitors
    FROM ${dataset}
    WHERE
      index1 = '${key}'
      AND ${BLOB.EVENT_TYPE} = 'pageview'
      AND ${blobCol} != ''
      AND ${dateFilter}
    GROUP BY name
    ORDER BY visitors DESC
    LIMIT ${limit}
  `;
}

export function buildDailyDevicesQuery(
  siteKey: string,
  date: string,
  type: 'browser' | 'os' | 'device',
  toDate?: string,
  limit = 500
) {
  const key = esc(siteKey);
  const d = esc(date);
  const blobCol = type === 'browser' ? BLOB.BROWSER : type === 'os' ? BLOB.OS : BLOB.DEVICE_TYPE;
  const dateFilter = toDate
    ? `toDate(timestamp) >= '${d}' AND toDate(timestamp) <= '${esc(toDate)}'`
    : `toDate(timestamp) = '${d}'`;
  return (dataset: string) => `
    SELECT
      ${blobCol} AS name,
      COUNT(DISTINCT ${BLOB.VISITOR_ID}) AS visitors
    FROM ${dataset}
    WHERE
      index1 = '${key}'
      AND ${BLOB.EVENT_TYPE} = 'pageview'
      AND ${blobCol} != ''
      AND ${dateFilter}
    GROUP BY name
    ORDER BY visitors DESC
    LIMIT ${limit}
  `;
}

export function buildDailyUtmQuery(
  siteKey: string,
  date: string,
  type: 'source' | 'medium' | 'campaign',
  toDate?: string,
  limit = 500
) {
  const key = esc(siteKey);
  const d = esc(date);
  const blobCol =
    type === 'source' ? BLOB.UTM_SOURCE : type === 'medium' ? BLOB.UTM_MEDIUM : BLOB.UTM_CAMPAIGN;
  const dateFilter = toDate
    ? `toDate(timestamp) >= '${d}' AND toDate(timestamp) <= '${esc(toDate)}'`
    : `toDate(timestamp) = '${d}'`;
  return (dataset: string) => `
    SELECT
      ${blobCol} AS value,
      COUNT(DISTINCT ${BLOB.VISITOR_ID}) AS visitors,
      COUNT(DISTINCT ${BLOB.SESSION_ID}) AS sessions
    FROM ${dataset}
    WHERE
      index1 = '${key}'
      AND ${BLOB.EVENT_TYPE} = 'pageview'
      AND ${blobCol} != ''
      AND ${dateFilter}
    GROUP BY value
    ORDER BY visitors DESC
    LIMIT ${limit}
  `;
}

export function buildDailyEventsQuery(siteKey: string, date: string, toDate?: string, limit = 500) {
  const key = esc(siteKey);
  const d = esc(date);
  const dateFilter = toDate
    ? `toDate(timestamp) >= '${d}' AND toDate(timestamp) <= '${esc(toDate)}'`
    : `toDate(timestamp) = '${d}'`;
  return (dataset: string) => `
    SELECT
      ${BLOB.EVENT_NAME} AS name,
      SUM(_sample_interval) AS count,
      SUM(${DOUBLE.EVENT_VALUE} * _sample_interval) AS total_value
    FROM ${dataset}
    WHERE
      index1 = '${key}'
      AND ${BLOB.EVENT_TYPE} = 'event'
      AND ${BLOB.EVENT_NAME} != ''
      AND ${dateFilter}
    GROUP BY name
    ORDER BY count DESC
    LIMIT ${limit}
  `;
}

export function buildDailyTimeseriesQuery(siteKey: string, date: string, toDate?: string) {
  const key = esc(siteKey);
  const d = esc(date);
  const dateFilter = toDate
    ? `toDate(timestamp) >= '${d}' AND toDate(timestamp) <= '${esc(toDate)}'`
    : `toDate(timestamp) = '${d}'`;
  return (dataset: string) => `
    SELECT
      toStartOfDay(timestamp) AS t,
      SUM(_sample_interval) AS pageviews,
      COUNT(DISTINCT ${BLOB.VISITOR_ID}) AS visitors,
      COUNT(DISTINCT ${BLOB.SESSION_ID}) AS sessions
    FROM ${dataset}
    WHERE
      index1 = '${key}'
      AND ${BLOB.EVENT_TYPE} = 'pageview'
      AND ${dateFilter}
    GROUP BY t
    ORDER BY t ASC
  `;
}
