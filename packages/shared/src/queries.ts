import type { Period } from './constants';

export interface QueryConfig {
  accountId: string;
  bucketName: string;
  apiToken: string;
  table: string;
}

/**
 * A period resolved against a caller-supplied `now` and IANA timezone.
 * Routes compute this once per request and pass into every builder so that
 * all queries for a single dashboard render operate over the *same* window.
 */
export interface PeriodRange {
  from: string; // UTC RFC3339 timestamp literal for R2 SQL
  to: string;
  granularity: 'hour' | 'day' | 'week';
  /** Ordered list of bucket keys (YYYY-MM-DD, YYYY-MM-DDTHH, or YYYY-Www) for gap-filling timeseries. */
  buckets: string[];
}

interface R2SqlResponse {
  result?: { rows?: Record<string, unknown>[] };
  errors?: { message: string }[];
  success?: boolean;
}

export class R2SqlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'R2SqlError';
  }
}

export async function queryR2Sql<T = Record<string, unknown>>(
  config: QueryConfig,
  buildQuery: (table: string) => string
): Promise<T[]> {
  const sql = buildQuery(config.table);
  const response = await fetch(
    `https://api.sql.cloudflarestorage.com/api/v1/accounts/${config.accountId}/r2-sql/query/${config.bucketName}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new R2SqlError(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  const body = (await response.json()) as R2SqlResponse;
  if (body.errors?.length) {
    throw new R2SqlError(body.errors.map(e => e.message).join('; '));
  }
  return (body.result?.rows ?? []) as T[];
}

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

// ============ Timezone-aware period math ============

/**
 * Convert a UTC moment to its wall-clock parts in a given IANA timezone.
 * Uses the 'en-CA' locale (YYYY-MM-DD) for stable ordering.
 */
function partsInTz(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find(p => p.type === t)!.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24, // Intl sometimes emits '24' at midnight
    minute: get('minute'),
    second: get('second'),
  };
}

/** Returns the UTC Date corresponding to midnight of `date`'s day in `tz`. */
function startOfDayInTz(date: Date, tz: string): Date {
  const p = partsInTz(date, tz);
  // Naive UTC midnight of the same Y-M-D
  const utcMidnight = new Date(Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0));
  // Figure out how far utcMidnight is from actual tz-midnight by rendering it back in tz
  const rendered = partsInTz(utcMidnight, tz);
  const renderedMs = Date.UTC(
    rendered.year,
    rendered.month - 1,
    rendered.day,
    rendered.hour,
    rendered.minute,
    rendered.second
  );
  const targetMs = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0);
  return new Date(utcMidnight.getTime() + (targetMs - renderedMs));
}

function addUTCDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * ISO-8601 week key (YYYY-Www) computed from plain date components.
 * Tz-agnostic — callers pass Y/M/D already rendered in whatever zone they care about.
 */
function isoWeekKeyFromParts(year: number, month: number, day: number): string {
  // ISO week: the Thursday of a week determines its year/week.
  const d = new Date(Date.UTC(year, month - 1, day));
  const isoDay = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - isoDay);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad2(weekNo)}`;
}

/**
 * Compute the three bucket keys (date_key, hour_key, week_key) for an instant,
 * rendered in the site's IANA timezone. Produced by collect at ingest and
 * grouped on at query time.
 */
export function computeBucketKeys(
  now: Date,
  tz: string
): { dateKey: string; hourKey: string; weekKey: string } {
  const p = partsInTz(now, tz);
  const dateKey = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
  const hourKey = `${dateKey}T${pad2(p.hour)}`;
  const weekKey = isoWeekKeyFromParts(p.year, p.month, p.day);
  return { dateKey, hourKey, weekKey };
}

/**
 * Resolve a period to a PeriodRange. All boundaries are aligned to the *site's* timezone —
 * "today" means 00:00 local time in that zone, not UTC midnight.
 *
 * The `buckets` array lets routes zero-fill timeseries gaps.
 */
export function resolvePeriod(period: Period, now: Date, tz: string): PeriodRange {
  const to = now;
  let from: Date;
  let granularity: PeriodRange['granularity'];

  switch (period) {
    case 'today':
      from = startOfDayInTz(now, tz);
      granularity = 'hour';
      break;
    case '7d':
      from = addUTCDays(startOfDayInTz(now, tz), -6);
      granularity = 'day';
      break;
    case '30d':
      from = addUTCDays(startOfDayInTz(now, tz), -29);
      granularity = 'day';
      break;
    case '90d':
      from = addUTCDays(startOfDayInTz(now, tz), -89);
      granularity = 'day';
      break;
    case '6m':
      from = addUTCDays(startOfDayInTz(now, tz), -179);
      granularity = 'day';
      break;
    case '1y':
      from = addUTCDays(startOfDayInTz(now, tz), -364);
      granularity = 'week';
      break;
    case 'all':
      from = new Date(Date.UTC(2000, 0, 1));
      granularity = 'week';
      break;
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    granularity,
    buckets: granularity === 'week' ? [] : generateBuckets(from, to, granularity, tz),
  };
}

/** Previous equal-length window immediately before `range`, used for % comparisons. */
export function previousRange(range: PeriodRange): { from: string; to: string } {
  const curFrom = new Date(range.from).getTime();
  const curTo = new Date(range.to).getTime();
  const span = curTo - curFrom;
  return {
    from: new Date(curFrom - span).toISOString(),
    to: new Date(curFrom).toISOString(),
  };
}

/** Generate the ordered list of bucket keys from `from` (inclusive) to `to` (inclusive). */
function generateBuckets(
  from: Date,
  to: Date,
  granularity: 'hour' | 'day' | 'week',
  tz: string
): string[] {
  const keys: string[] = [];
  if (granularity === 'hour') {
    // Iterate UTC hours, render each as YYYY-MM-DDTHH in the site's timezone
    const startMs = from.getTime();
    const endMs = to.getTime();
    for (let ms = startMs; ms <= endMs; ms += 3600_000) {
      const p = partsInTz(new Date(ms), tz);
      keys.push(`${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}`);
    }
    // Deduplicate in case of DST transitions producing the same hour twice
    return Array.from(new Set(keys));
  }
  if (granularity === 'day') {
    let cursor = startOfDayInTz(from, tz);
    const endDay = startOfDayInTz(to, tz);
    while (cursor.getTime() <= endDay.getTime()) {
      const p = partsInTz(cursor, tz);
      keys.push(`${p.year}-${pad2(p.month)}-${pad2(p.day)}`);
      cursor = addUTCDays(cursor, 1);
    }
  }
  return keys;
}

export function granularityColumn(granularity: 'hour' | 'day' | 'week'): string {
  if (granularity === 'hour') return 'hour_key';
  if (granularity === 'week') return 'week_key';
  return 'date_key';
}

// ============ Query builders ============

function whereSiteAndRange(
  siteKey: string,
  range: { from: string; to: string },
  eventType = 'pageview'
) {
  return (
    `site_id = '${esc(siteKey)}'` +
    ` AND event_type = '${esc(eventType)}'` +
    ` AND ts >= TIMESTAMP '${esc(range.from)}'` +
    ` AND ts < TIMESTAMP '${esc(range.to)}'`
  );
}

export function buildMainStatsQuery(siteKey: string, range: PeriodRange) {
  return (table: string) => `
    SELECT
      COUNT(*) AS pageviews,
      approx_distinct(visitor_id) AS visitors,
      approx_distinct(session_id) AS sessions
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range)}
  `;
}

export function buildPreviousPeriodQuery(siteKey: string, range: PeriodRange) {
  const prev = previousRange(range);
  return (table: string) => `
    SELECT
      COUNT(*) AS pageviews,
      approx_distinct(visitor_id) AS visitors,
      approx_distinct(session_id) AS sessions
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, prev)}
  `;
}

export function buildTimeseriesQuery(siteKey: string, range: PeriodRange) {
  const col = granularityColumn(range.granularity);
  return (table: string) => `
    SELECT
      ${col} AS t,
      COUNT(*) AS pageviews,
      approx_distinct(visitor_id) AS visitors,
      approx_distinct(session_id) AS sessions
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range)}
    GROUP BY ${col}
    ORDER BY t ASC
  `;
}

export function buildTopPagesQuery(siteKey: string, range: PeriodRange, limit = 10) {
  return (table: string) => `
    SELECT
      pathname,
      COUNT(*) AS pageviews,
      approx_distinct(visitor_id) AS visitors
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range)}
    GROUP BY pathname
    ORDER BY pageviews DESC
    LIMIT ${limit}
  `;
}

export function buildTopReferrersQuery(siteKey: string, range: PeriodRange, limit = 10) {
  return (table: string) => `
    SELECT
      referrer_hostname AS source,
      approx_distinct(visitor_id) AS visitors
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range)}
      AND referrer_hostname != ''
    GROUP BY referrer_hostname
    ORDER BY visitors DESC
    LIMIT ${limit}
  `;
}

export function buildUtmQuery(
  siteKey: string,
  range: PeriodRange,
  type: 'source' | 'medium' | 'campaign',
  limit = 10
) {
  const col = type === 'source' ? 'utm_source' : type === 'medium' ? 'utm_medium' : 'utm_campaign';
  return (table: string) => `
    SELECT
      ${col} AS value,
      approx_distinct(visitor_id) AS visitors,
      approx_distinct(session_id) AS sessions
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range)}
      AND ${col} != ''
    GROUP BY ${col}
    ORDER BY visitors DESC
    LIMIT ${limit}
  `;
}

export function buildLocationsQuery(
  siteKey: string,
  range: PeriodRange,
  type: 'country' | 'city',
  limit = 10
) {
  const col = type === 'country' ? 'country' : 'city';
  return (table: string) => `
    SELECT
      ${col} AS name,
      approx_distinct(visitor_id) AS visitors
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range)}
      AND ${col} != ''
    GROUP BY ${col}
    ORDER BY visitors DESC
    LIMIT ${limit}
  `;
}

export function buildDevicesQuery(
  siteKey: string,
  range: PeriodRange,
  type: 'browser' | 'os' | 'device',
  limit = 10
) {
  const col = type === 'browser' ? 'browser' : type === 'os' ? 'os' : 'device_type';
  return (table: string) => `
    SELECT
      ${col} AS name,
      approx_distinct(visitor_id) AS visitors
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range)}
      AND ${col} != ''
    GROUP BY ${col}
    ORDER BY visitors DESC
    LIMIT ${limit}
  `;
}

/**
 * Realtime = last 5 minutes. Freshness is bounded by Pipelines commit cadence (~30s-5min
 * depending on sink `roll-interval`), not this query.
 */
export function buildRealtimeQuery(siteKey: string, now: Date) {
  const range = {
    from: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
    to: now.toISOString(),
  };
  return (table: string) => `
    SELECT
      approx_distinct(visitor_id) AS visitors,
      pathname
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range)}
    GROUP BY pathname
    ORDER BY visitors DESC
    LIMIT 10
  `;
}

export function buildEventsQuery(siteKey: string, range: PeriodRange, limit = 20) {
  return (table: string) => `
    SELECT
      event_name AS name,
      COUNT(*) AS count,
      SUM(event_value) AS total_value
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range, 'event')}
      AND event_name != ''
    GROUP BY event_name
    ORDER BY count DESC
    LIMIT ${limit}
  `;
}
