import type { Period } from './constants';
import type { LiveDimension, LiveFilters } from './live';

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
 * The full previous calendar day in `tz`: [local midnight yesterday, local
 * midnight today), plus its date_key. Used by the nightly export job.
 */
export function previousDayRange(
  now: Date,
  tz: string
): { fromMs: number; toMs: number; dateKey: string } {
  const todayStart = startOfDayInTz(now, tz);
  // A moment safely inside yesterday (12h before today's start dodges DST edges)
  const yesterdayStart = startOfDayInTz(new Date(todayStart.getTime() - 12 * 3600_000), tz);
  const p = partsInTz(yesterdayStart, tz);
  return {
    fromMs: yesterdayStart.getTime(),
    toMs: todayStart.getTime(),
    dateKey: `${p.year}-${pad2(p.month)}-${pad2(p.day)}`,
  };
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

// Whitelist LiveFilters key -> column. Values are escaped; only keys in this
// map may ever reach the SQL text.
const FILTER_COLUMNS: Record<LiveDimension, string> = {
  pathname: 'pathname',
  referrer_hostname: 'referrer_hostname',
  country: 'country',
  region: 'region',
  city: 'city',
  browser: 'browser',
  os: 'os',
  device_type: 'device_type',
  utm_source: 'utm_source',
  utm_medium: 'utm_medium',
  utm_campaign: 'utm_campaign',
};

/** Exact-match dashboard filters as additional AND clauses ('' if none). */
function filterClause(filters?: LiveFilters): string {
  if (!filters) return '';
  let sql = '';
  for (const [key, value] of Object.entries(filters)) {
    const col = FILTER_COLUMNS[key as LiveDimension];
    if (!col || typeof value !== 'string') continue;
    sql += ` AND ${col} = '${esc(value)}'`;
  }
  return sql;
}

function whereSiteAndRange(
  siteKey: string,
  range: { from: string; to: string },
  eventType = 'pageview',
  filters?: LiveFilters
) {
  return (
    `site_id = '${esc(siteKey)}'` +
    ` AND event_type = '${esc(eventType)}'` +
    ` AND ts >= TIMESTAMP '${esc(range.from)}'` +
    ` AND ts < TIMESTAMP '${esc(range.to)}'` +
    filterClause(filters)
  );
}

/**
 * Current + previous period stats in a single scan.
 *
 * previousRange() is contiguous with the current range (prev.to === range.from),
 * so one query over [prev.from, range.to) split with a CASE on the boundary
 * replaces the old two-query pair. R2 SQL bills a 10 MB minimum per query, so
 * fewer round-trips is both faster and cheaper.
 *
 * Rows come back labeled period = 'current' | 'previous'; a window with no
 * events produces no row.
 */
export function buildStatsWithComparisonQuery(
  siteKey: string,
  range: PeriodRange,
  filters?: LiveFilters
) {
  const prev = previousRange(range);
  const periodExpr = `CASE WHEN ts >= TIMESTAMP '${esc(range.from)}' THEN 'current' ELSE 'previous' END`;
  return (table: string) => `
    SELECT
      ${periodExpr} AS period,
      COUNT(*) AS pageviews,
      approx_distinct(visitor_id) AS visitors,
      approx_distinct(session_id) AS sessions
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, { from: prev.from, to: range.to }, 'pageview', filters)}
    GROUP BY ${periodExpr}
  `;
}

/**
 * Per-session rollup for bounce rate, current + previous period in one scan.
 *
 * A bounce is a session with exactly one pageview. Sessions are attributed to
 * the period containing their first pageview. Requires CTE + CASE support,
 * which R2 SQL gained in the 2026 feature waves.
 */
export function buildSessionStatsQuery(siteKey: string, range: PeriodRange, filters?: LiveFilters) {
  const prev = previousRange(range);
  const periodExpr = `CASE WHEN first_hit >= TIMESTAMP '${esc(range.from)}' THEN 'current' ELSE 'previous' END`;
  return (table: string) => `
    WITH session_hits AS (
      SELECT
        session_id,
        MIN(ts) AS first_hit,
        COUNT(*) AS hits
      FROM ${table}
      WHERE ${whereSiteAndRange(siteKey, { from: prev.from, to: range.to }, 'pageview', filters)}
        AND session_id != ''
      GROUP BY session_id
    )
    SELECT
      ${periodExpr} AS period,
      COUNT(*) AS sessions,
      SUM(CASE WHEN hits = 1 THEN 1 ELSE 0 END) AS bounces
    FROM session_hits
    GROUP BY ${periodExpr}
  `;
}

/**
 * Total engaged seconds (tracker 'engagement' events), current + previous
 * period in one scan. Divided by sessions to produce avg visit duration.
 */
export function buildEngagementStatsQuery(
  siteKey: string,
  range: PeriodRange,
  filters?: LiveFilters
) {
  const prev = previousRange(range);
  const periodExpr = `CASE WHEN ts >= TIMESTAMP '${esc(range.from)}' THEN 'current' ELSE 'previous' END`;
  return (table: string) => `
    SELECT
      ${periodExpr} AS period,
      SUM(event_value) AS engaged
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, { from: prev.from, to: range.to }, 'engagement', filters)}
    GROUP BY ${periodExpr}
  `;
}

/** Conversion counts for event-type goals (grouped by event_name). */
export function buildGoalEventsQuery(
  siteKey: string,
  range: PeriodRange,
  eventNames: string[],
  filters?: LiveFilters
) {
  const names = eventNames.map(n => `'${esc(n)}'`).join(', ');
  return (table: string) => `
    SELECT
      event_name AS target,
      COUNT(*) AS events,
      approx_distinct(visitor_id) AS visitors
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range, 'event', filters)}
      AND event_name IN (${names})
    GROUP BY event_name
  `;
}

/** Conversion counts for page-visit goals (grouped by pathname). */
export function buildGoalPagesQuery(
  siteKey: string,
  range: PeriodRange,
  pathnames: string[],
  filters?: LiveFilters
) {
  const paths = pathnames.map(p => `'${esc(p)}'`).join(', ');
  return (table: string) => `
    SELECT
      pathname AS target,
      COUNT(*) AS events,
      approx_distinct(visitor_id) AS visitors
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range, 'pageview', filters)}
      AND pathname IN (${paths})
    GROUP BY pathname
  `;
}

/**
 * Main stats for many sites at once (sites-list page). One GROUP BY site_id
 * query replaces a query per site; the API groups sites by timezone so every
 * site in a call shares the same resolved period window.
 */
export function buildBatchStatsQuery(siteKeys: string[], range: PeriodRange) {
  const keys = siteKeys.map(k => `'${esc(k)}'`).join(', ');
  return (table: string) => `
    SELECT
      site_id,
      COUNT(*) AS pageviews,
      approx_distinct(visitor_id) AS visitors,
      approx_distinct(session_id) AS sessions
    FROM ${table}
    WHERE site_id IN (${keys})
      AND event_type = 'pageview'
      AND ts >= TIMESTAMP '${esc(range.from)}'
      AND ts < TIMESTAMP '${esc(range.to)}'
    GROUP BY site_id
  `;
}

export function buildTimeseriesQuery(siteKey: string, range: PeriodRange, filters?: LiveFilters) {
  const col = granularityColumn(range.granularity);
  return (table: string) => `
    SELECT
      ${col} AS t,
      COUNT(*) AS pageviews,
      approx_distinct(visitor_id) AS visitors,
      approx_distinct(session_id) AS sessions
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range, 'pageview', filters)}
    GROUP BY ${col}
    ORDER BY t ASC
  `;
}

export function buildTopPagesQuery(
  siteKey: string,
  range: PeriodRange,
  filters?: LiveFilters,
  limit = 10
) {
  return (table: string) => `
    SELECT
      pathname,
      COUNT(*) AS pageviews,
      approx_distinct(visitor_id) AS visitors
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range, 'pageview', filters)}
    GROUP BY pathname
    ORDER BY pageviews DESC
    LIMIT ${limit}
  `;
}

/**
 * Entry/exit pages: the pathname of each session's first (or last) pageview.
 * ROW_NUMBER over sessions requires window-function support, which R2 SQL
 * gained in the 2026 feature waves alongside CTEs.
 */
export function buildEntryExitPagesQuery(
  siteKey: string,
  range: PeriodRange,
  kind: 'entry' | 'exit',
  filters?: LiveFilters,
  limit = 10
) {
  const order = kind === 'entry' ? 'ASC' : 'DESC';
  return (table: string) => `
    WITH ranked AS (
      SELECT
        pathname,
        visitor_id,
        ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY ts ${order}) AS rn
      FROM ${table}
      WHERE ${whereSiteAndRange(siteKey, range, 'pageview', filters)}
        AND session_id != ''
    )
    SELECT
      pathname,
      approx_distinct(visitor_id) AS visitors,
      COUNT(*) AS sessions
    FROM ranked
    WHERE rn = 1
    GROUP BY pathname
    ORDER BY visitors DESC
    LIMIT ${limit}
  `;
}

/**
 * Outbound-link / file-download breakdown. Auto link events carry a canonical
 * event_meta of exactly '{"url":"..."}' (collect re-serializes it), so
 * grouping on the raw string is equivalent to grouping by URL - no JSON
 * functions needed. The caller parses the url back out.
 */
export function buildLinkEventsQuery(
  siteKey: string,
  range: PeriodRange,
  eventName: string,
  filters?: LiveFilters,
  limit = 10
) {
  return (table: string) => `
    SELECT
      event_meta AS meta,
      COUNT(*) AS clicks,
      approx_distinct(visitor_id) AS visitors
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range, 'event', filters)}
      AND event_name = '${esc(eventName)}'
      AND event_meta != ''
    GROUP BY event_meta
    ORDER BY clicks DESC
    LIMIT ${limit}
  `;
}

export function buildTopReferrersQuery(
  siteKey: string,
  range: PeriodRange,
  filters?: LiveFilters,
  limit = 10
) {
  return (table: string) => `
    SELECT
      referrer_hostname AS source,
      approx_distinct(visitor_id) AS visitors
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range, 'pageview', filters)}
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
  filters?: LiveFilters,
  limit = 10
) {
  const col = type === 'source' ? 'utm_source' : type === 'medium' ? 'utm_medium' : 'utm_campaign';
  return (table: string) => `
    SELECT
      ${col} AS value,
      approx_distinct(visitor_id) AS visitors,
      approx_distinct(session_id) AS sessions
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range, 'pageview', filters)}
      AND ${col} != ''
    GROUP BY ${col}
    ORDER BY visitors DESC
    LIMIT ${limit}
  `;
}

export function buildLocationsQuery(
  siteKey: string,
  range: PeriodRange,
  type: 'country' | 'region' | 'city',
  filters?: LiveFilters,
  limit = 10
) {
  const col = type;
  return (table: string) => `
    SELECT
      ${col} AS name,
      approx_distinct(visitor_id) AS visitors
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range, 'pageview', filters)}
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
  filters?: LiveFilters,
  limit = 10
) {
  const col = type === 'browser' ? 'browser' : type === 'os' ? 'os' : 'device_type';
  return (table: string) => `
    SELECT
      ${col} AS name,
      approx_distinct(visitor_id) AS visitors
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range, 'pageview', filters)}
      AND ${col} != ''
    GROUP BY ${col}
    ORDER BY visitors DESC
    LIMIT ${limit}
  `;
}

/**
 * Screen-width buckets (Plausible-style breakpoints). The CASE expression is
 * repeated in GROUP BY - R2 SQL supports expression GROUP BY but aliases in
 * GROUP BY are not guaranteed.
 */
export const SCREEN_SIZE_CASE = `CASE WHEN screen_width < 576 THEN 'Mobile' WHEN screen_width < 992 THEN 'Tablet' WHEN screen_width < 1440 THEN 'Laptop' ELSE 'Desktop' END`;

export function buildScreenSizesQuery(siteKey: string, range: PeriodRange, filters?: LiveFilters) {
  return (table: string) => `
    SELECT
      ${SCREEN_SIZE_CASE} AS name,
      approx_distinct(visitor_id) AS visitors
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range, 'pageview', filters)}
      AND screen_width > 0
    GROUP BY ${SCREEN_SIZE_CASE}
    ORDER BY visitors DESC
  `;
}

/**
 * Distinct event_meta groups for one custom event. Props are arbitrary user
 * JSON, so per-key aggregation happens in the API worker after parsing - this
 * query only collapses identical prop-sets (bounded by `limit` groups).
 */
export function buildEventMetaQuery(
  siteKey: string,
  range: PeriodRange,
  eventName: string,
  filters?: LiveFilters,
  limit = 500
) {
  return (table: string) => `
    SELECT
      event_meta AS meta,
      COUNT(*) AS events
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range, 'event', filters)}
      AND event_name = '${esc(eventName)}'
      AND event_meta != ''
    GROUP BY event_meta
    ORDER BY events DESC
    LIMIT ${limit}
  `;
}

/**
 * Realtime = last 5 minutes. Freshness is bounded by the sink's `roll-interval`
 * (60s in our setup script — the documented minimum, safe alongside automatic
 * compaction), not this query.
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

export function buildEventsQuery(
  siteKey: string,
  range: PeriodRange,
  filters?: LiveFilters,
  limit = 20
) {
  return (table: string) => `
    SELECT
      event_name AS name,
      COUNT(*) AS count,
      SUM(event_value) AS total_value
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range, 'event', filters)}
      AND event_name != ''
    GROUP BY event_name
    ORDER BY count DESC
    LIMIT ${limit}
  `;
}
