import { AUTO_EVENTS } from './constants';
import type { Period } from './constants';
import type { LiveDimension, LiveFilters } from './live';
import { AI_HOSTNAME_IN, aiSourceCaseSql } from './ai-sources';

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
  /** IANA zone the boundaries were aligned to; previousRange() shifts in it. */
  tz: string;
  /** Calendar-day length of the period (0 for 'all'); previousRange() shifts by this. */
  days: number;
}

interface R2SqlResponse {
  result?: { rows?: Record<string, unknown>[] };
  errors?: { code?: number; message: string }[];
  success?: boolean;
}

/**
 * R2 SQL error 80001 is "edge service connection failure" and the docs say to
 * retry it. It is transient plumbing, not a query problem, and surfacing it
 * turns one dropped connection into a 502 on a dashboard panel.
 */
const R2SQL_TRANSIENT_CODE = 80001;

export class R2SqlError extends Error {
  /** True for errors the R2 SQL docs mark as retryable (edge connection failures). */
  readonly transient: boolean;
  constructor(message: string, transient = false) {
    super(message);
    this.name = 'R2SqlError';
    this.transient = transient;
  }
}

export interface R2SqlResult<T> {
  rows: T[];
  /** Wall-clock time of the HTTP round trip, ms. */
  ms: number;
  /** HTTP status of the R2 SQL response (0 when the fetch itself failed). */
  status: number;
}

/**
 * Partition-pruning predicate switch. Pipelines-created Iceberg tables are
 * partitioned on the system column `__ingest_ts`; bounding it lets R2 SQL skip
 * whole manifests instead of only pruning files on `ts` min/max stats. Events
 * are ingested within seconds of `ts`, so a +/- 1h envelope is safe. If an
 * instance's table somehow lacks the column (an older/foreign sink), the
 * executor flips this off for the isolate and the caller retries without it.
 */
let ingestPrune = true;
export function setIngestPrune(on: boolean): void {
  ingestPrune = on;
}
export function isIngestPrune(): boolean {
  return ingestPrune;
}
const INGEST_ENVELOPE_MS = 60 * 60 * 1000;
function ingestBounds(from: string, to: string): string {
  if (!ingestPrune) return '';
  const lo = new Date(new Date(from).getTime() - INGEST_ENVELOPE_MS);
  const hi = new Date(new Date(to).getTime() + INGEST_ENVELOPE_MS);
  if (Number.isNaN(lo.getTime()) || Number.isNaN(hi.getTime())) return '';
  return (
    ` AND __ingest_ts >= TIMESTAMP '${lo.toISOString()}'` +
    ` AND __ingest_ts < TIMESTAMP '${hi.toISOString()}'`
  );
}

/** True when an R2 SQL error means the table has no `__ingest_ts` column. */
export function isMissingIngestTs(err: unknown): boolean {
  return err instanceof R2SqlError && /__ingest_ts/i.test(err.message);
}

export async function queryR2SqlWithStats<T = Record<string, unknown>>(
  config: QueryConfig,
  buildQuery: (table: string) => string
): Promise<R2SqlResult<T>> {
  const sql = buildQuery(config.table);
  const started = Date.now();
  try {
    return await runR2Sql<T>(config, sql, started);
  } catch (err) {
    if (err instanceof R2SqlError && err.transient) return runR2Sql<T>(config, sql, started);
    throw err;
  }
}

async function runR2Sql<T>(
  config: QueryConfig,
  sql: string,
  started: number
): Promise<R2SqlResult<T>> {
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
    // A fresh instance has no Iceberg table until the pipeline sink's first
    // flush creates it (minutes after the first event) - an absent table
    // means "no events yet", not a failure. [40010] = iceberg table not found.
    if (response.status === 404 && text.includes('40010')) {
      return { rows: [], ms: Date.now() - started, status: response.status };
    }
    throw new R2SqlError(
      `HTTP ${response.status}: ${text.slice(0, 500)}`,
      text.includes(String(R2SQL_TRANSIENT_CODE))
    );
  }

  const body = (await response.json()) as R2SqlResponse;
  if (body.errors?.length) {
    throw new R2SqlError(
      body.errors.map(e => e.message).join('; '),
      body.errors.some(e => e.code === R2SQL_TRANSIENT_CODE)
    );
  }
  return {
    rows: (body.result?.rows ?? []) as T[],
    ms: Date.now() - started,
    status: response.status,
  };
}

export async function queryR2Sql<T = Record<string, unknown>>(
  config: QueryConfig,
  buildQuery: (table: string) => string
): Promise<T[]> {
  return (await queryR2SqlWithStats<T>(config, buildQuery)).rows;
}

function esc(value: string): string {
  return value.replace(/'/g, "''");
}

/** Escape LIKE metacharacters in user-supplied text, for use with ESCAPE '\'. */
export function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** True when a page target uses the trailing `/*` section-prefix syntax. */
export function isPagePrefix(target: string): boolean {
  return target.endsWith('/*') && target.length > 2;
}

/** SQL matching a page target: exact, or prefix for '/docs/*' - the bare
 *  prefix itself plus everything under it (never '/docsfoo'). */
export function pathMatchSql(col: string, target: string): string {
  if (!isPagePrefix(target)) return `${col} = '${esc(target)}'`;
  const prefix = target.slice(0, -2);
  return `(${col} = '${esc(prefix)}' OR ${col} LIKE '${esc(escapeLike(prefix))}/%' ESCAPE '\\')`;
}

/**
 * LIKE patterns matching one `"key":"value"` pair inside event_meta, which
 * stores the tracker's flat JSON.stringify of scalar props verbatim. Values
 * that could have been sent as JSON numbers/booleans also get an unquoted
 * variant. Escaped for `LIKE ... ESCAPE '\'`.
 */
export function propLikePatterns(key: string, value: string): string[] {
  const patterns = [`%${escapeLike(`${JSON.stringify(key)}:${JSON.stringify(value)}`)}%`];
  if (/^-?\d+(\.\d+)?$/.test(value) || value === 'true' || value === 'false') {
    patterns.push(`%${escapeLike(`${JSON.stringify(key)}:${value}`)}%`);
  }
  return patterns;
}

/** SQL condition for an event-prop exact match against event_meta. */
export function propMatchSql(key: string, value: string): string {
  const conds = propLikePatterns(key, value).map(p => `event_meta LIKE '${esc(p)}' ESCAPE '\\'`);
  return conds.length === 1 ? conds[0] : `(${conds.join(' OR ')})`;
}

// ============ Timezone-aware period math ============

/**
 * Intl.DateTimeFormat construction dominates this function - measured ~46µs to
 * build one versus ~2.2µs to reuse it. computeBucketKeys() calls this on every
 * ingested event, so the formatters are cached per timezone. The set of
 * timezones an isolate sees is bounded by the sites it serves; the cap is a
 * belt-and-braces guard against unbounded growth.
 */
const tzFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let fmt = tzFormatters.get(tz);
  if (!fmt) {
    if (tzFormatters.size > 200) tzFormatters.clear();
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    tzFormatters.set(tz, fmt);
  }
  return fmt;
}

/**
 * Convert a UTC moment to its wall-clock parts in a given IANA timezone.
 * Uses the 'en-CA' locale (YYYY-MM-DD) for stable ordering.
 */
function partsInTz(date: Date, tz: string) {
  const parts = formatterFor(tz).formatToParts(date);
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

/**
 * Local midnight `n` calendar days from `date` in `tz`.
 *
 * Adding n*24h to a local-midnight instant is wrong across a DST transition:
 * the result lands an hour early or late, so the SQL window boundary drifts
 * off the day boundary the buckets are built on (one day silently gains or
 * loses an hour, and the comparison period inherits the skew). Stepping to
 * roughly local NOON of the target day and re-snapping to that day's midnight
 * is immune, because noon is never within an hour of a transition.
 */
function startOfDayNDays(date: Date, tz: string, n: number): Date {
  const noonish = new Date(startOfDayInTz(date, tz).getTime() + n * 86_400_000 + 12 * 3_600_000);
  return startOfDayInTz(noonish, tz);
}

/** Floor for the 'all time' window - predates any possible event. */
const ALL_TIME_FLOOR_MS = Date.UTC(2000, 0, 1);

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * ISO-8601 week key (YYYY-Www) computed from plain date components.
 * Tz-agnostic - callers pass Y/M/D already rendered in whatever zone they care about.
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
 * Resolve a period to a PeriodRange. All boundaries are aligned to the *site's* timezone -
 * "today" means 00:00 local time in that zone, not UTC midnight.
 *
 * The `buckets` array lets routes zero-fill timeseries gaps.
 */
export function resolvePeriod(period: Period, now: Date, tz: string): PeriodRange {
  let to = now;
  let from: Date;
  let granularity: PeriodRange['granularity'];
  let days: number;

  switch (period) {
    case 'today':
      from = startOfDayInTz(now, tz);
      granularity = 'hour';
      days = 1;
      break;
    case 'yesterday':
      to = startOfDayInTz(now, tz);
      from = startOfDayNDays(now, tz, -1);
      granularity = 'hour';
      days = 1;
      break;
    case '7d':
      from = startOfDayNDays(now, tz, -6);
      granularity = 'day';
      days = 7;
      break;
    case '30d':
      from = startOfDayNDays(now, tz, -29);
      granularity = 'day';
      days = 30;
      break;
    case '90d':
      from = startOfDayNDays(now, tz, -89);
      granularity = 'day';
      days = 90;
      break;
    case '6m':
      from = startOfDayNDays(now, tz, -179);
      granularity = 'day';
      days = 180;
      break;
    case '1y':
      from = startOfDayNDays(now, tz, -364);
      granularity = 'week';
      days = 365;
      break;
    case 'all':
      from = new Date(ALL_TIME_FLOOR_MS);
      granularity = 'week';
      days = 0;
      break;
  }

  // generateBuckets treats `to` as inclusive; 'yesterday' is a closed window
  // ending exactly on today's midnight, so back off 1ms to keep today's first
  // hour bucket out.
  const bucketsTo = period === 'yesterday' ? new Date(to.getTime() - 1) : to;

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    granularity,
    buckets: granularity === 'week' ? [] : generateBuckets(from, bucketsTo, granularity, tz),
    tz,
    days,
  };
}

/**
 * Comparison window for `range`: the same clock window one period earlier.
 *
 * Both bounds shift back by the period's calendar-day length in the site's
 * timezone, so a partial current period is compared against the *same portion*
 * of the previous one - 'today' at 10:00 compares with yesterday 00:00-10:00,
 * '7d' with the seven days before it up to the same time of day. (Mirroring
 * the elapsed span backwards from `from`, as this used to, compared this
 * morning with yesterday *afternoon* and produced a large spurious % change
 * every day.)
 *
 * The window is therefore NOT contiguous with `range` in general: there is a
 * gap [prev.to, range.from) that single-scan comparison queries must exclude.
 */
export function previousRange(range: PeriodRange): { from: string; to: string } {
  const curFrom = new Date(range.from);
  const curTo = new Date(range.to);
  // 'all' starts at the epoch floor (2000-01-01), so mirroring its span would
  // scan ~26 further years of partitions that cannot contain data - doubling
  // the cost of the most expensive view to compare against a guaranteed zero.
  // Collapse it to an empty window instead.
  if (curFrom.getTime() <= ALL_TIME_FLOOR_MS || !range.days) {
    return { from: curFrom.toISOString(), to: curFrom.toISOString() };
  }
  const tz = range.tz || 'UTC';
  // `from` is a local midnight: step it back by whole calendar days (DST-safe).
  const prevFrom = startOfDayNDays(curFrom, tz, -range.days);
  // `to` is an arbitrary instant (usually now): keep its local time-of-day on
  // the shifted day so both windows cover the same local hours even when the
  // period straddles a DST change.
  const intoDay = curTo.getTime() - startOfDayInTz(curTo, tz).getTime();
  const prevTo = new Date(startOfDayNDays(curTo, tz, -range.days).getTime() + intoDay);
  return { from: prevFrom.toISOString(), to: prevTo.toISOString() };
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
    // Step by local calendar days, not +24h: after a DST transition a 24h step
    // from local midnight lands at 23:00/01:00 local and the rendered keys
    // drift by a day (today's bucket vanished from the chart for up to 90 days
    // after each transition, and the DST day appeared twice).
    const dayKey = (d: Date): string => {
      const p = partsInTz(d, tz);
      return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
    };
    let cursor = startOfDayInTz(from, tz);
    const endKey = dayKey(to);
    // Hard cap well above any period length - guards against a pathological
    // zone where the stepping never reaches endKey.
    for (let i = 0; i < 800; i++) {
      const key = dayKey(cursor);
      keys.push(key);
      if (key >= endKey) break;
      cursor = startOfDayNDays(cursor, tz, 1);
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

/** Exact-match dashboard filters as additional AND clauses ('' if none).
 *  The page filter alone also understands the '/section/*' prefix syntax. */
function filterClause(filters?: LiveFilters): string {
  if (!filters) return '';
  let sql = '';
  for (const [key, value] of Object.entries(filters)) {
    const col = FILTER_COLUMNS[key as LiveDimension];
    if (!col || typeof value !== 'string') continue;
    if (col === 'pathname' && isPagePrefix(value)) {
      sql += ` AND ${pathMatchSql(col, value)}`;
      continue;
    }
    sql += ` AND ${col} = '${esc(value)}'`;
  }
  return sql;
}

/** `eventType: null` = no type predicate (callers that pin a type per branch,
 *  e.g. the consolidated special-goals scan mixing event and pageview goals). */
function whereSiteAndRange(
  siteKey: string,
  range: { from: string; to: string },
  eventType: string | null = 'pageview',
  filters?: LiveFilters
) {
  return (
    `site_id = '${esc(siteKey)}'` +
    (eventType === null ? '' : ` AND event_type = '${esc(eventType)}'`) +
    ` AND ts >= TIMESTAMP '${esc(range.from)}'` +
    ` AND ts < TIMESTAMP '${esc(range.to)}'` +
    ingestBounds(range.from, range.to) +
    filterClause(filters)
  );
}

/**
 * WHERE fragment covering the current window plus its comparison window in a
 * single scan: [prev.from, range.to) minus the gap [prev.to, range.from)
 * between them (see previousRange). Rows are then split with a CASE on
 * range.from. R2 SQL bills a 10 MB minimum per query, so one scan over both
 * windows is both faster and cheaper than two.
 */
function whereSiteAndComparison(
  siteKey: string,
  range: PeriodRange,
  eventType: string,
  filters?: LiveFilters
): string {
  const prev = previousRange(range);
  let sql = whereSiteAndRange(siteKey, { from: prev.from, to: range.to }, eventType, filters);
  if (prev.to !== range.from) {
    sql += ` AND (ts < TIMESTAMP '${esc(prev.to)}' OR ts >= TIMESTAMP '${esc(range.from)}')`;
  }
  return sql;
}

/**
 * Current + previous period stats in a single scan.
 *
 * Rows come back labeled period = 'current' | 'previous'; a window with no
 * events produces no row.
 */
export function buildStatsWithComparisonQuery(
  siteKey: string,
  range: PeriodRange,
  filters?: LiveFilters
) {
  const periodExpr = `CASE WHEN ts >= TIMESTAMP '${esc(range.from)}' THEN 'current' ELSE 'previous' END`;
  return (table: string) => `
    SELECT
      ${periodExpr} AS period,
      COUNT(*) AS pageviews,
      approx_distinct(visitor_id) AS visitors,
      approx_distinct(session_id) AS sessions
    FROM ${table}
    WHERE ${whereSiteAndComparison(siteKey, range, 'pageview', filters)}
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
  const periodExpr = `CASE WHEN first_hit >= TIMESTAMP '${esc(range.from)}' THEN 'current' ELSE 'previous' END`;
  return (table: string) => `
    WITH session_hits AS (
      SELECT
        session_id,
        MIN(ts) AS first_hit,
        COUNT(*) AS hits
      FROM ${table}
      WHERE ${whereSiteAndComparison(siteKey, range, 'pageview', filters)}
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
  const periodExpr = `CASE WHEN ts >= TIMESTAMP '${esc(range.from)}' THEN 'current' ELSE 'previous' END`;
  return (table: string) => `
    SELECT
      ${periodExpr} AS period,
      SUM(event_value) AS engaged
    FROM ${table}
    WHERE ${whereSiteAndComparison(siteKey, range, 'engagement', filters)}
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

/**
 * One prop-filtered event goal. These can't join the batched IN/GROUP BY
 * query: two goals on the same event with different prop conditions would
 * collapse into one row there.
 */
export function buildGoalEventPropQuery(
  siteKey: string,
  range: PeriodRange,
  target: string,
  propKey: string,
  propValue: string,
  filters?: LiveFilters
) {
  return (table: string) => `
    SELECT
      COUNT(*) AS events,
      approx_distinct(visitor_id) AS visitors
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range, 'event', filters)}
      AND event_name = '${esc(target)}'
      AND ${propMatchSql(propKey, propValue)}
  `;
}

/** A "special" goal: prop-filtered event goal or '/section/*' page-prefix goal. */
export interface SpecialGoalDef {
  type: 'event' | 'page';
  target: string;
  propKey?: string | null;
  propValue?: string | null;
}

/** The WHERE branch matching one special goal (each pins its own event_type). */
function specialGoalCond(g: SpecialGoalDef): string {
  return g.type === 'event'
    ? `(event_type = 'event' AND event_name = '${esc(g.target)}' AND ${propMatchSql(g.propKey!, g.propValue!)})`
    : `(event_type = 'pageview' AND ${pathMatchSql('pathname', g.target)})`;
}

/**
 * ALL special goals in one scan via conditional aggregation, instead of one
 * R2 SQL scan per goal (N+1 in goal count, each billed at the 10 MB scan
 * minimum). Returns a single row with events_<i>/visitors_<i> columns in
 * input order - the same numbers the per-goal queries produce, since SUM and
 * approx_distinct both ignore the NULLs the CASE emits for non-matching rows.
 */
export function buildSpecialGoalsQuery(
  siteKey: string,
  range: PeriodRange,
  goalDefs: SpecialGoalDef[],
  filters?: LiveFilters
) {
  const conds = goalDefs.map(specialGoalCond);
  const cols = conds.map(
    (cond, i) =>
      `SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END) AS events_${i},
      approx_distinct(CASE WHEN ${cond} THEN visitor_id END) AS visitors_${i}`
  );
  return (table: string) => `
    SELECT
      ${cols.join(',\n      ')}
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range, null, filters)}
      AND (${conds.join(' OR ')})
  `;
}

/** One section-prefix page goal ('/docs/*') - LIKE can't ride the IN batch. */
export function buildGoalPagePrefixQuery(
  siteKey: string,
  range: PeriodRange,
  target: string,
  filters?: LiveFilters
) {
  return (table: string) => `
    SELECT
      COUNT(*) AS events,
      approx_distinct(visitor_id) AS visitors
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range, 'pageview', filters)}
      AND ${pathMatchSql('pathname', target)}
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
 * Ordered funnel completion counts in one scan.
 *
 * Per session, take the first-occurrence time of each step (MIN over a CASE),
 * then count a session into step N only when steps 0..N all occurred and
 * their first occurrences are non-decreasing in time. This is first-touch
 * ordering - the standard funnel approximation; a session that re-enters a
 * step later doesn't change its counted position.
 *
 * NULL comparisons make missing steps drop out naturally: if sN is NULL,
 * `sN >= sN-1` is NULL, the CASE falls to ELSE 0.
 */
export function buildFunnelQuery(
  siteKey: string,
  range: PeriodRange,
  steps: { type: 'event' | 'page'; target: string; propKey?: string; propValue?: string }[],
  filters?: LiveFilters
) {
  const conds = steps.map(s => {
    if (s.type === 'page') {
      return `(event_type = 'pageview' AND ${pathMatchSql('pathname', s.target)})`;
    }
    const prop = s.propKey && s.propValue ? ` AND ${propMatchSql(s.propKey, s.propValue)}` : '';
    return `(event_type = 'event' AND event_name = '${esc(s.target)}'${prop})`;
  });
  const stepCols = conds
    .map((cond, i) => `MIN(CASE WHEN ${cond} THEN ts END) AS s${i}`)
    .join(',\n        ');
  const chain: string[] = [];
  const counts = conds
    .map((_, i) => {
      chain.push(i === 0 ? 's0 IS NOT NULL' : `s${i} >= s${i - 1}`);
      return `SUM(CASE WHEN ${chain.join(' AND ')} THEN 1 ELSE 0 END) AS c${i}`;
    })
    .join(',\n      ');
  return (table: string) => `
    WITH step_times AS (
      SELECT
        session_id,
        ${stepCols}
      FROM ${table}
      WHERE site_id = '${esc(siteKey)}'
        AND ts >= TIMESTAMP '${esc(range.from)}'
        AND ts < TIMESTAMP '${esc(range.to)}'${ingestBounds(range.from, range.to)}
        AND session_id != ''
        AND (${conds.join(' OR ')})${filterClause(filters)}
      GROUP BY session_id
    )
    SELECT
      ${counts}
    FROM step_times
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
      AND ts < TIMESTAMP '${esc(range.to)}'${ingestBounds(range.from, range.to)}
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
  // Region/city rows also carry the country code so the UI can show a flag;
  // grouping by (name, country) keeps same-named places in different
  // countries as distinct rows.
  const select = type === 'country' ? `${col} AS name` : `${col} AS name, country`;
  const groupBy = type === 'country' ? col : `${col}, country`;
  return (table: string) => `
    SELECT
      ${select},
      approx_distinct(visitor_id) AS visitors
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range, 'pageview', filters)}
      AND ${col} != ''
    GROUP BY ${groupBy}
    ORDER BY visitors DESC
    LIMIT ${limit}
  `;
}

/**
 * AI assistants as a traffic channel: pageviews referred by known AI tools
 * (ChatGPT, Claude, Perplexity, …), grouped by assistant. Classified at
 * query time from referrer_hostname - see shared/src/ai-sources.ts.
 */
export function buildAiSourcesQuery(
  siteKey: string,
  range: PeriodRange,
  filters?: LiveFilters,
  limit = 10
) {
  const caseExpr = aiSourceCaseSql('referrer_hostname');
  return (table: string) => `
    SELECT
      ${caseExpr} AS name,
      approx_distinct(visitor_id) AS visitors
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range, 'pageview', filters)}
      AND referrer_hostname IN (${AI_HOSTNAME_IN})
    GROUP BY ${caseExpr}
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

// ============ Combined dashboard breakdowns (one scan) ============

export type BreakdownDim =
  | 'page'
  | 'referrer'
  | 'utm_source'
  | 'utm_medium'
  | 'utm_campaign'
  | 'country'
  | 'region'
  | 'city'
  | 'browser'
  | 'os'
  | 'device'
  | 'screen'
  | 'ai';

export interface BreakdownRow {
  dim: BreakdownDim;
  name: string;
  /** Country code for region/city rows (and the country itself for country rows). */
  country: string;
  pageviews: unknown;
  visitors: unknown;
  sessions: unknown;
}

/**
 * Every dashboard breakdown panel from ONE scan. The per-panel builders above
 * each re-read the same rows; GROUPING SETS computes all thirteen groupings
 * in a single pass over the window, and a window function keeps the top
 * `limit` of each. Row shapes match the per-panel queries exactly (same
 * aggregates, same exclusions), so the API can serve either.
 *
 * Mechanics: grouping columns are COALESCE'd to '' so a real value is never
 * NULL - in GROUPING SETS output a NULL grouping column therefore means "not
 * part of this set", which is how `dim` is recovered. region/city sets also
 * group by country so the UI can show a flag; the CASE that assigns `dim`
 * tests region/city before country for that reason.
 */
export function buildBreakdownsQuery(
  siteKey: string,
  range: PeriodRange,
  filters?: LiveFilters,
  limit = 10
) {
  const c = (col: string): string => `COALESCE(${col}, '')`;
  const screen = `CASE WHEN screen_width > 0 THEN ${SCREEN_SIZE_CASE} ELSE '' END`;
  const ai = `CASE WHEN referrer_hostname IN (${AI_HOSTNAME_IN}) THEN ${aiSourceCaseSql('referrer_hostname')} ELSE '' END`;
  const exprs: Record<string, string> = {
    page: c('pathname'),
    referrer: c('referrer_hostname'),
    utm_source: c('utm_source'),
    utm_medium: c('utm_medium'),
    utm_campaign: c('utm_campaign'),
    country: c('country'),
    region: c('region'),
    city: c('city'),
    browser: c('browser'),
    os: c('os'),
    device: c('device_type'),
    screen,
    ai,
  };
  const selectCols = Object.entries(exprs)
    .map(([k, e]) => `${e} AS d_${k}`)
    .join(',\n        ');
  const sets = [
    `(${exprs.page})`,
    `(${exprs.referrer})`,
    `(${exprs.utm_source})`,
    `(${exprs.utm_medium})`,
    `(${exprs.utm_campaign})`,
    `(${exprs.country})`,
    `(${exprs.region}, ${exprs.country})`,
    `(${exprs.city}, ${exprs.country})`,
    `(${exprs.browser})`,
    `(${exprs.os})`,
    `(${exprs.device})`,
    `(${screen})`,
    `(${ai})`,
  ].join(',\n        ');
  // Order matters: region/city sets also carry d_country.
  const dimCase = [
    'page',
    'referrer',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'region',
    'city',
    'country',
    'browser',
    'os',
    'device',
    'screen',
    'ai',
  ]
    .map(k => `WHEN d_${k} IS NOT NULL THEN '${k}'`)
    .join(' ');
  const nameExpr = `COALESCE(d_page, d_referrer, d_utm_source, d_utm_medium, d_utm_campaign, d_region, d_city, d_country, d_browser, d_os, d_device, d_screen, d_ai)`;
  return (table: string) => `
    WITH g AS (
      SELECT
        ${selectCols},
        COUNT(*) AS pageviews,
        approx_distinct(visitor_id) AS visitors,
        approx_distinct(session_id) AS sessions
      FROM ${table}
      WHERE ${whereSiteAndRange(siteKey, range, 'pageview', filters)}
      GROUP BY GROUPING SETS (
        ${sets}
      )
    ),
    labeled AS (
      SELECT
        CASE ${dimCase} END AS dim,
        ${nameExpr} AS name,
        COALESCE(d_country, '') AS country,
        pageviews,
        visitors,
        sessions
      FROM g
    ),
    ranked AS (
      SELECT
        dim, name, country, pageviews, visitors, sessions,
        ROW_NUMBER() OVER (
          PARTITION BY dim
          ORDER BY CASE WHEN dim = 'page' THEN CAST(pageviews AS BIGINT) ELSE CAST(visitors AS BIGINT) END DESC, name ASC
        ) AS rn
      FROM labeled
      WHERE dim IS NOT NULL AND (dim = 'page' OR name != '')
    )
    SELECT dim, name, country, pageviews, visitors, sessions
    FROM ranked
    WHERE rn <= ${Math.max(1, Math.floor(limit))}
    ORDER BY dim, rn
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
 * (60s in our setup script - the documented minimum, safe alongside automatic
 * compaction), not this query.
 */
/** Overall distinct visitors in the 5-min window - per-page rows can't be
 *  summed for this (multi-page visitors would double-count). */
export function buildRealtimeTotalQuery(siteKey: string, now: Date) {
  const range = {
    from: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
    to: now.toISOString(),
  };
  return (table: string) => `
    SELECT approx_distinct(visitor_id) AS visitors
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range)}
  `;
}

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

/**
 * WebMCP tool-call groups: one row per canonical '{"tool":...,"status":...}'
 * meta string (ingest canonicalizes it, like link events) with call count and
 * summed duration (event_value = ms). The route folds tool+status pairs into
 * per-tool rows with calls / errors / avg duration.
 */
export function buildWebmcpQuery(siteKey: string, range: PeriodRange, filters?: LiveFilters) {
  return (table: string) => `
    SELECT
      event_meta AS meta,
      COUNT(*) AS calls,
      SUM(event_value) AS total_ms
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range, 'event', filters)}
      AND event_name = '${esc(AUTO_EVENTS.WEBMCP)}'
      AND event_meta != ''
    GROUP BY event_meta
    ORDER BY calls DESC
    LIMIT 500
  `;
}

/**
 * Bot visits grouped by bot name. Ingest stores bot pageviews under
 * event_type 'bot_pageview' with the display name in `browser`, so no other
 * builder (all predicated on 'pageview'/'event') ever sees these rows.
 */
export function buildBotsQuery(
  siteKey: string,
  range: PeriodRange,
  filters?: LiveFilters,
  limit = 20
) {
  return (table: string) => `
    SELECT
      browser AS name,
      approx_distinct(visitor_id) AS visitors,
      COUNT(*) AS pageviews
    FROM ${table}
    WHERE ${whereSiteAndRange(siteKey, range, 'bot_pageview', filters)}
    GROUP BY browser
    ORDER BY visitors DESC, pageviews DESC
    LIMIT ${limit}
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
