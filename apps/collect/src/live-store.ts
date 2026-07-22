import { DurableObject } from 'cloudflare:workers';
import type {
  LiveEvent,
  LiveFilters,
  LiveCounts,
  LiveGoalRow,
  LiveTotals,
  LiveDimension,
  LiveTimeseriesRow,
  LiveTopListRow,
  LiveRealtimeRow,
  LiveCustomEventRow,
  LiveLinkRow,
  LiveEntryPageRow,
  LiveScreenSizeRow,
  LiveMetaRow,
  LiveExportRow,
} from '@traks/shared';
import { SCREEN_SIZE_CASE } from '@traks/shared';

// "Today" plus the full previous-day comparison window needs at most 48h in
// any timezone; prune with margin.
const RETENTION_MS = 50 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

// Write batching: buffer incoming events in memory and flush to SQLite in one
// synchronous burst. record() then returns without a pending storage write,
// so the output gate doesn't hold the RPC response on a commit - much higher
// per-object ingest throughput. Bounded loss window: if the isolate dies
// before a flush, at most FLUSH_MAX events (or ~1s) of *hot-path* data are
// lost; the Pipelines->Iceberg leg (system of record) is unaffected.
const FLUSH_MAX = 64;
const FLUSH_DELAY_MS = 1000;

// Read memoization: dashboards poll every 15-30s per open viewer, each poll
// fanning into ~7 scan queries. Memoizing results for a few seconds makes
// read load constant in viewer count instead of linear.
const MEMO_TTL_MS = 10_000;
const MEMO_TTL_REALTIME_MS = 5_000;
// Timestamp args are quantized into buckets for the memo key: callers pass
// `now`-derived bounds that move every request, but bounds within the same
// bucket produce the same answer to within the memo TTL anyway.
const MEMO_QUANTUM_MS = 10_000;

// Whitelist LiveDimension -> column. Values are used verbatim in SQL, so only
// entries in this map may ever be interpolated.
const DIMENSION_COLUMNS: Record<LiveDimension, string> = {
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

const EMPTY_TOTALS: LiveTotals = {
  pageviews: 0,
  visitors: 0,
  sessions: 0,
  bounces: 0,
  engagedSeconds: 0,
};

const n = (v: unknown): number => Number(v ?? 0) || 0;

/**
 * Hot-path analytics store: one instance per site (idFromName(siteKey)).
 *
 * The collect Worker records every event here at ingest, so "today" and
 * realtime dashboard queries are answered from local SQLite in milliseconds
 * with zero ingest delay - no waiting for the Iceberg sink roll. An hourly
 * alarm prunes events older than the retention window; long-range queries
 * are served from Iceberg/R2 SQL instead.
 */
export class SiteLiveStore extends DurableObject<unknown> {
  private sql: SqlStorage;
  private buffer: LiveEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** In-memory running monthly counters (authoritative between flushes). */
  private monthCounts = new Map<string, number>();
  private memo = new Map<string, { expires: number; value: unknown }>();
  /** Avoids an async storage.getAlarm() round-trip on every record(). */
  private alarmArmed = false;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS events (
        ts INTEGER NOT NULL,
        hour_key TEXT NOT NULL,
        event_type TEXT NOT NULL,
        pathname TEXT NOT NULL DEFAULT '',
        referrer_hostname TEXT NOT NULL DEFAULT '',
        utm_source TEXT NOT NULL DEFAULT '',
        utm_medium TEXT NOT NULL DEFAULT '',
        utm_campaign TEXT NOT NULL DEFAULT '',
        country TEXT NOT NULL DEFAULT '',
        city TEXT NOT NULL DEFAULT '',
        browser TEXT NOT NULL DEFAULT '',
        os TEXT NOT NULL DEFAULT '',
        device_type TEXT NOT NULL DEFAULT '',
        session_id TEXT NOT NULL DEFAULT '',
        visitor_id TEXT NOT NULL DEFAULT '',
        event_name TEXT NOT NULL DEFAULT '',
        event_value REAL NOT NULL DEFAULT 0,
        event_meta TEXT NOT NULL DEFAULT '',
        region TEXT NOT NULL DEFAULT '',
        screen_width INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts);
      CREATE TABLE IF NOT EXISTS usage (
        month TEXT PRIMARY KEY,
        events INTEGER NOT NULL DEFAULT 0
      );
    `);
    // Migrations for DO instances created before these columns existed:
    // CREATE TABLE IF NOT EXISTS leaves their old schema untouched.
    const existing = new Set(
      this.sql
        .exec(`SELECT name FROM pragma_table_info('events')`)
        .toArray()
        .map(r => String(r.name))
    );
    const added: [string, string][] = [
      ['event_meta', `TEXT NOT NULL DEFAULT ''`],
      ['region', `TEXT NOT NULL DEFAULT ''`],
      ['screen_width', `INTEGER NOT NULL DEFAULT 0`],
    ];
    for (const [col, ddl] of added) {
      if (!existing.has(col)) {
        this.sql.exec(`ALTER TABLE events ADD COLUMN ${col} ${ddl}`);
      }
    }
  }

  /**
   * Drain the write buffer into SQLite and persist the monthly counters.
   * Synchronous on purpose: DO request handling is single-threaded, so a
   * flush at the top of a read can never interleave with a record().
   */
  private flushBuffer(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0) return;
    const events = this.buffer;
    this.buffer = [];

    for (const e of events) {
      this.sql.exec(
        `INSERT INTO events (
          ts, hour_key, event_type, pathname, referrer_hostname,
          utm_source, utm_medium, utm_campaign, country, city,
          browser, os, device_type, session_id, visitor_id,
          event_name, event_value, event_meta, region, screen_width
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        e.ts,
        e.hourKey,
        e.eventType,
        e.pathname,
        e.referrerHostname,
        e.utmSource,
        e.utmMedium,
        e.utmCampaign,
        e.country,
        e.city,
        e.browser,
        e.os,
        e.deviceType,
        e.sessionId,
        e.visitorId,
        e.eventName,
        e.eventValue,
        e.eventMeta,
        e.region,
        e.screenWidth
      );
    }

    // Persist the in-memory counters for every month this batch touched.
    const months = new Set<string>();
    for (const e of events) months.add(e.hourKey.slice(0, 7));
    for (const month of months) {
      const count = this.monthCounts.get(month);
      if (count === undefined) continue;
      this.sql.exec(
        `INSERT INTO usage (month, events) VALUES (?, ?)
         ON CONFLICT(month) DO UPDATE SET events = ?`,
        month,
        count,
        count
      );
    }
  }

  /**
   * Serve a read through the short-TTL memo. The underlying query runs
   * against fully flushed data, so freshness is bounded only by the TTL.
   */
  private memoized<T>(key: string, ttlMs: number, fn: () => T): T {
    const now = Date.now();
    const hit = this.memo.get(key);
    if (hit && hit.expires > now) return hit.value as T;
    this.flushBuffer();
    const value = fn();
    if (this.memo.size > 500) this.memo.clear();
    this.memo.set(key, { expires: now + ttlMs, value });
    return value;
  }

  /** Quantize a moving timestamp bound into a stable memo-key bucket. */
  private static q(ms: number): number {
    return Math.floor(ms / MEMO_QUANTUM_MS);
  }

  /**
   * Exact-match dashboard filters as parameterized AND clauses. Columns come
   * only from the DIMENSION_COLUMNS whitelist; values are bound parameters.
   */
  private static filterSql(filters?: LiveFilters): { sql: string; params: string[] } {
    if (!filters) return { sql: '', params: [] };
    let sql = '';
    const params: string[] = [];
    for (const [key, value] of Object.entries(filters)) {
      const col = DIMENSION_COLUMNS[key as LiveDimension];
      if (!col || typeof value !== 'string') continue;
      sql += ` AND ${col} = ?`;
      params.push(value);
    }
    return { sql, params };
  }

  /** Stable memo-key fragment for a filter set. */
  private static filterKey(filters?: LiveFilters): string {
    if (!filters) return '';
    return Object.entries(filters)
      .filter(([, v]) => typeof v === 'string')
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
  }

  async record(e: LiveEvent): Promise<number> {
    this.buffer.push(e);

    // Monthly usage counter (calendar month in the site's tz, from hour_key).
    // Survives event pruning, so quota enforcement sees the full month.
    const month = e.hourKey.slice(0, 7);
    let count = this.monthCounts.get(month);
    if (count === undefined) {
      const row = this.sql.exec('SELECT events FROM usage WHERE month = ?', month).toArray()[0] as
        | { events?: unknown }
        | undefined;
      count = n(row?.events);
    }
    count += 1;
    this.monthCounts.set(month, count);

    if (this.buffer.length >= FLUSH_MAX) {
      this.flushBuffer();
    } else if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushBuffer();
      }, FLUSH_DELAY_MS);
    }

    if (!this.alarmArmed) {
      this.alarmArmed = true;
      if ((await this.ctx.storage.getAlarm()) === null) {
        await this.ctx.storage.setAlarm(Date.now() + PRUNE_INTERVAL_MS);
      }
    }
    return count;
  }

  async purge(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.buffer = [];
    this.monthCounts.clear();
    this.memo.clear();
    this.alarmArmed = false;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async alarm(): Promise<void> {
    this.flushBuffer();
    this.sql.exec('DELETE FROM events WHERE ts < ?', Date.now() - RETENTION_MS);
    const remaining = n(this.sql.exec('SELECT COUNT(*) AS c FROM events').one().c);
    // Keep pruning while data remains; a fresh event re-arms the alarm.
    if (remaining > 0) {
      await this.ctx.storage.setAlarm(Date.now() + PRUNE_INTERVAL_MS);
    } else {
      this.alarmArmed = false;
    }
  }

  async totals(fromMs: number, toMs: number, filters?: LiveFilters): Promise<LiveCounts> {
    const f = SiteLiveStore.filterSql(filters);
    return this.memoized(
      `totals:${SiteLiveStore.q(fromMs)}:${SiteLiveStore.q(toMs)}:${SiteLiveStore.filterKey(filters)}`,
      MEMO_TTL_MS,
      () => {
        const row = this.sql
          .exec(
            `SELECT COUNT(*) AS pageviews,
                    COUNT(DISTINCT visitor_id) AS visitors,
                    COUNT(DISTINCT session_id) AS sessions
             FROM events
             WHERE event_type = 'pageview' AND ts >= ? AND ts < ?${f.sql}`,
            fromMs,
            toMs,
            ...f.params
          )
          .one();
        return {
          pageviews: n(row.pageviews),
          visitors: n(row.visitors),
          sessions: n(row.sessions),
        };
      }
    );
  }

  async mainStats(
    prevFromMs: number,
    curFromMs: number,
    toMs: number,
    filters?: LiveFilters
  ): Promise<{ current: LiveTotals; previous: LiveTotals }> {
    const f = SiteLiveStore.filterSql(filters);
    return this.memoized(
      `mainStats:${SiteLiveStore.q(prevFromMs)}:${SiteLiveStore.q(curFromMs)}:${SiteLiveStore.q(toMs)}:${SiteLiveStore.filterKey(filters)}`,
      MEMO_TTL_MS,
      () => {
        const statRows = this.sql
          .exec(
            `SELECT CASE WHEN ts >= ? THEN 'current' ELSE 'previous' END AS period,
                    COUNT(*) AS pageviews,
                    COUNT(DISTINCT visitor_id) AS visitors,
                    COUNT(DISTINCT session_id) AS sessions
             FROM events
             WHERE event_type = 'pageview' AND ts >= ? AND ts < ?${f.sql}
             GROUP BY period`,
            curFromMs,
            prevFromMs,
            toMs,
            ...f.params
          )
          .toArray();

        // Bounce = session with exactly one pageview; sessions attributed to the
        // period containing their first pageview (mirrors the R2 SQL cold path).
        const bounceRows = this.sql
          .exec(
            `WITH s AS (
               SELECT session_id, MIN(ts) AS first_hit, COUNT(*) AS hits
               FROM events
               WHERE event_type = 'pageview' AND session_id != '' AND ts >= ? AND ts < ?${f.sql}
               GROUP BY session_id
             )
             SELECT CASE WHEN first_hit >= ? THEN 'current' ELSE 'previous' END AS period,
                    SUM(hits = 1) AS bounces
             FROM s
             GROUP BY period`,
            prevFromMs,
            toMs,
            ...f.params,
            curFromMs
          )
          .toArray();

        // Engaged seconds from tracker engagement pings (visit duration).
        const engagementRows = this.sql
          .exec(
            `SELECT CASE WHEN ts >= ? THEN 'current' ELSE 'previous' END AS period,
                    SUM(event_value) AS engaged
             FROM events
             WHERE event_type = 'engagement' AND ts >= ? AND ts < ?${f.sql}
             GROUP BY period`,
            curFromMs,
            prevFromMs,
            toMs,
            ...f.params
          )
          .toArray();

        const build = (period: string): LiveTotals => {
          const stat = statRows.find(r => r.period === period);
          const bounce = bounceRows.find(r => r.period === period);
          const engagement = engagementRows.find(r => r.period === period);
          if (!stat) return { ...EMPTY_TOTALS };
          return {
            pageviews: n(stat.pageviews),
            visitors: n(stat.visitors),
            sessions: n(stat.sessions),
            bounces: n(bounce?.bounces),
            engagedSeconds: n(engagement?.engaged),
          };
        };

        return { current: build('current'), previous: build('previous') };
      }
    );
  }

  async timeseries(
    fromMs: number,
    toMs: number,
    filters?: LiveFilters
  ): Promise<LiveTimeseriesRow[]> {
    const f = SiteLiveStore.filterSql(filters);
    return this.memoized(
      `timeseries:${SiteLiveStore.q(fromMs)}:${SiteLiveStore.q(toMs)}:${SiteLiveStore.filterKey(filters)}`,
      MEMO_TTL_MS,
      () =>
        this.sql
          .exec(
            `SELECT hour_key AS t,
                    COUNT(*) AS pageviews,
                    COUNT(DISTINCT visitor_id) AS visitors,
                    COUNT(DISTINCT session_id) AS sessions
             FROM events
             WHERE event_type = 'pageview' AND ts >= ? AND ts < ?${f.sql}
             GROUP BY hour_key
             ORDER BY t ASC`,
            fromMs,
            toMs,
            ...f.params
          )
          .toArray()
          .map(r => ({
            t: String(r.t),
            pageviews: n(r.pageviews),
            visitors: n(r.visitors),
            sessions: n(r.sessions),
          }))
    );
  }

  async topList(
    dimension: LiveDimension,
    fromMs: number,
    toMs: number,
    limit: number,
    filters?: LiveFilters
  ): Promise<LiveTopListRow[]> {
    const col = DIMENSION_COLUMNS[dimension];
    if (!col) throw new Error(`Unknown dimension: ${dimension}`);
    const orderBy = dimension === 'pathname' ? 'pageviews' : 'visitors';
    const boundedLimit = Math.max(1, Math.min(100, limit));
    const f = SiteLiveStore.filterSql(filters);
    return this.memoized(
      `topList:${col}:${SiteLiveStore.q(fromMs)}:${SiteLiveStore.q(toMs)}:${boundedLimit}:${SiteLiveStore.filterKey(filters)}`,
      MEMO_TTL_MS,
      () =>
        this.sql
          .exec(
            `SELECT ${col} AS name,
                    COUNT(DISTINCT visitor_id) AS visitors,
                    COUNT(*) AS pageviews,
                    COUNT(DISTINCT session_id) AS sessions
             FROM events
             WHERE event_type = 'pageview' AND ts >= ? AND ts < ? AND ${col} != ''${f.sql}
             GROUP BY ${col}
             ORDER BY ${orderBy} DESC
             LIMIT ?`,
            fromMs,
            toMs,
            ...f.params,
            boundedLimit
          )
          .toArray()
          .map(r => ({
            name: String(r.name),
            visitors: n(r.visitors),
            pageviews: n(r.pageviews),
            sessions: n(r.sessions),
          }))
    );
  }

  async realtime(nowMs: number): Promise<LiveRealtimeRow[]> {
    return this.memoized(`realtime:${SiteLiveStore.q(nowMs)}`, MEMO_TTL_REALTIME_MS, () =>
      this.sql
        .exec(
          `SELECT pathname, COUNT(DISTINCT visitor_id) AS visitors
           FROM events
           WHERE event_type = 'pageview' AND ts >= ? AND ts < ?
           GROUP BY pathname
           ORDER BY visitors DESC
           LIMIT 10`,
          nowMs - 5 * 60 * 1000,
          nowMs
        )
        .toArray()
        .map(r => ({ pathname: String(r.pathname), visitors: n(r.visitors) }))
    );
  }

  async exportEvents(
    fromMs: number,
    toMs: number,
    offset: number,
    limit: number
  ): Promise<LiveExportRow[]> {
    // Not memoized: paginated bulk reads, each page requested exactly once.
    this.flushBuffer();
    return this.sql
      .exec(
        `SELECT ts, hour_key, event_type, pathname, referrer_hostname,
                utm_source, utm_medium, utm_campaign, country, region, city,
                browser, os, device_type, screen_width, session_id, visitor_id,
                event_name, event_meta, event_value
         FROM events
         WHERE ts >= ? AND ts < ?
         ORDER BY ts ASC
         LIMIT ? OFFSET ?`,
        fromMs,
        toMs,
        Math.max(1, Math.min(10_000, limit)),
        Math.max(0, offset)
      )
      .toArray() as unknown as LiveExportRow[];
  }

  async goalStats(
    fromMs: number,
    toMs: number,
    eventNames: string[],
    pathnames: string[],
    filters?: LiveFilters
  ): Promise<LiveGoalRow[]> {
    const events = eventNames.slice(0, 50);
    const pages = pathnames.slice(0, 50);
    if (events.length === 0 && pages.length === 0) return [];
    const f = SiteLiveStore.filterSql(filters);
    const memoKey = `goals:${SiteLiveStore.q(fromMs)}:${SiteLiveStore.q(toMs)}:${events.join('\u0001')}:${pages.join('\u0001')}:${SiteLiveStore.filterKey(filters)}`;
    return this.memoized(memoKey, MEMO_TTL_MS, () => {
      const rows: LiveGoalRow[] = [];
      if (events.length > 0) {
        const marks = events.map(() => '?').join(', ');
        for (const r of this.sql
          .exec(
            `SELECT event_name AS target, COUNT(*) AS events,
                    COUNT(DISTINCT visitor_id) AS visitors
             FROM events
             WHERE event_type = 'event' AND ts >= ? AND ts < ?${f.sql}
               AND event_name IN (${marks})
             GROUP BY event_name`,
            fromMs,
            toMs,
            ...f.params,
            ...events
          )
          .toArray()) {
          rows.push({
            target: String(r.target),
            kind: 'event',
            events: n(r.events),
            visitors: n(r.visitors),
          });
        }
      }
      if (pages.length > 0) {
        const marks = pages.map(() => '?').join(', ');
        for (const r of this.sql
          .exec(
            `SELECT pathname AS target, COUNT(*) AS events,
                    COUNT(DISTINCT visitor_id) AS visitors
             FROM events
             WHERE event_type = 'pageview' AND ts >= ? AND ts < ?${f.sql}
               AND pathname IN (${marks})
             GROUP BY pathname`,
            fromMs,
            toMs,
            ...f.params,
            ...pages
          )
          .toArray()) {
          rows.push({
            target: String(r.target),
            kind: 'page',
            events: n(r.events),
            visitors: n(r.visitors),
          });
        }
      }
      return rows;
    });
  }

  async customEvents(
    fromMs: number,
    toMs: number,
    limit: number,
    filters?: LiveFilters
  ): Promise<LiveCustomEventRow[]> {
    const boundedLimit = Math.max(1, Math.min(100, limit));
    const f = SiteLiveStore.filterSql(filters);
    return this.memoized(
      `customEvents:${SiteLiveStore.q(fromMs)}:${SiteLiveStore.q(toMs)}:${boundedLimit}:${SiteLiveStore.filterKey(filters)}`,
      MEMO_TTL_MS,
      () =>
        this.sql
          .exec(
            `SELECT event_name AS name, COUNT(*) AS count, SUM(event_value) AS totalValue
             FROM events
             WHERE event_type = 'event' AND event_name != '' AND ts >= ? AND ts < ?${f.sql}
             GROUP BY event_name
             ORDER BY count DESC
             LIMIT ?`,
            fromMs,
            toMs,
            ...f.params,
            boundedLimit
          )
          .toArray()
          .map(r => ({ name: String(r.name), count: n(r.count), totalValue: n(r.totalValue) }))
    );
  }

  async screenSizes(
    fromMs: number,
    toMs: number,
    filters?: LiveFilters
  ): Promise<LiveScreenSizeRow[]> {
    const f = SiteLiveStore.filterSql(filters);
    return this.memoized(
      `screenSizes:${SiteLiveStore.q(fromMs)}:${SiteLiveStore.q(toMs)}:${SiteLiveStore.filterKey(filters)}`,
      MEMO_TTL_MS,
      () =>
        this.sql
          .exec(
            `SELECT ${SCREEN_SIZE_CASE} AS name,
                    COUNT(DISTINCT visitor_id) AS visitors
             FROM events
             WHERE event_type = 'pageview' AND screen_width > 0
               AND ts >= ? AND ts < ?${f.sql}
             GROUP BY ${SCREEN_SIZE_CASE}
             ORDER BY visitors DESC`,
            fromMs,
            toMs,
            ...f.params
          )
          .toArray()
          .map(r => ({ name: String(r.name), visitors: n(r.visitors) }))
    );
  }

  async eventMetaGroups(
    eventName: string,
    fromMs: number,
    toMs: number,
    limit: number,
    filters?: LiveFilters
  ): Promise<LiveMetaRow[]> {
    const boundedLimit = Math.max(1, Math.min(500, limit));
    const f = SiteLiveStore.filterSql(filters);
    return this.memoized(
      `eventMeta:${eventName}:${SiteLiveStore.q(fromMs)}:${SiteLiveStore.q(toMs)}:${boundedLimit}:${SiteLiveStore.filterKey(filters)}`,
      MEMO_TTL_MS,
      () =>
        this.sql
          .exec(
            `SELECT event_meta AS meta, COUNT(*) AS events
             FROM events
             WHERE event_type = 'event' AND event_name = ? AND event_meta != ''
               AND ts >= ? AND ts < ?${f.sql}
             GROUP BY event_meta
             ORDER BY events DESC
             LIMIT ?`,
            eventName,
            fromMs,
            toMs,
            ...f.params,
            boundedLimit
          )
          .toArray()
          .map(r => ({ meta: String(r.meta), events: n(r.events) }))
    );
  }

  async linkClicks(
    eventName: string,
    fromMs: number,
    toMs: number,
    limit: number,
    filters?: LiveFilters
  ): Promise<LiveLinkRow[]> {
    const boundedLimit = Math.max(1, Math.min(100, limit));
    const f = SiteLiveStore.filterSql(filters);
    return this.memoized(
      `linkClicks:${eventName}:${SiteLiveStore.q(fromMs)}:${SiteLiveStore.q(toMs)}:${boundedLimit}:${SiteLiveStore.filterKey(filters)}`,
      MEMO_TTL_MS,
      () =>
        this.sql
          .exec(
            `SELECT event_meta AS meta, COUNT(*) AS clicks,
                    COUNT(DISTINCT visitor_id) AS visitors
             FROM events
             WHERE event_type = 'event' AND event_name = ? AND event_meta != ''
               AND ts >= ? AND ts < ?${f.sql}
             GROUP BY event_meta
             ORDER BY clicks DESC
             LIMIT ?`,
            eventName,
            fromMs,
            toMs,
            ...f.params,
            boundedLimit
          )
          .toArray()
          .map(r => ({
            url: parseMetaUrl(String(r.meta)),
            clicks: n(r.clicks),
            visitors: n(r.visitors),
          }))
    );
  }

  async entryExitPages(
    kind: 'entry' | 'exit',
    fromMs: number,
    toMs: number,
    limit: number,
    filters?: LiveFilters
  ): Promise<LiveEntryPageRow[]> {
    const order = kind === 'entry' ? 'ASC' : 'DESC';
    const boundedLimit = Math.max(1, Math.min(100, limit));
    const f = SiteLiveStore.filterSql(filters);
    return this.memoized(
      `entryExit:${kind}:${SiteLiveStore.q(fromMs)}:${SiteLiveStore.q(toMs)}:${boundedLimit}:${SiteLiveStore.filterKey(filters)}`,
      MEMO_TTL_MS,
      () =>
        this.sql
          .exec(
            `WITH ranked AS (
               SELECT pathname, visitor_id,
                      ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY ts ${order}) AS rn
               FROM events
               WHERE event_type = 'pageview' AND session_id != ''
                 AND ts >= ? AND ts < ?${f.sql}
             )
             SELECT pathname AS name,
                    COUNT(DISTINCT visitor_id) AS visitors,
                    COUNT(*) AS sessions
             FROM ranked
             WHERE rn = 1
             GROUP BY pathname
             ORDER BY visitors DESC
             LIMIT ?`,
            fromMs,
            toMs,
            ...f.params,
            boundedLimit
          )
          .toArray()
          .map(r => ({ name: String(r.name), visitors: n(r.visitors), sessions: n(r.sessions) }))
    );
  }
}

/** Extract the url from canonical link-event meta ('{"url":"..."}'). */
function parseMetaUrl(meta: string): string {
  try {
    return String((JSON.parse(meta) as { url?: unknown }).url || meta);
  } catch {
    return meta;
  }
}
