import { DurableObject } from 'cloudflare:workers';
import type {
  LiveEvent,
  LiveFilters,
  LiveCounts,
  LiveGoalRow,
  LiveGoalTarget,
  LiveTotals,
  LiveDimension,
  LiveTimeseriesRow,
  LiveTopListRow,
  LiveRealtime,
  LiveCustomEventRow,
  LiveLinkRow,
  LiveEntryPageRow,
  LiveScreenSizeRow,
  LiveMetaRow,
} from '@traks/shared';
import {
  SCREEN_SIZE_CASE,
  AI_HOSTNAME_IN,
  aiSourceCaseSql,
  escapeLike,
  isPagePrefix,
  propLikePatterns,
} from '@traks/shared';

// "Today" plus the full previous-day comparison window needs at most 48h in
// any timezone; prune with margin.
const RETENTION_MS = 50 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
/**
 * How many events may be recorded before the monthly counters are written to
 * SQLite. Bounds counter drift to this many events in the worst case (object
 * evicted between persists) while removing ~98% of the row writes that
 * per-event persistence cost. The hourly prune alarm also flushes them, so
 * drift is bounded by time as well as by count.
 */
const COUNTER_PERSIST_EVERY = 50;

// Writes go to SQLite on the same tick they arrive. An earlier version held
// events in memory behind a 1s timer to batch inserts, but a pending timer
// does not keep a Durable Object alive: on eviction the buffer was dropped.
// For a low-traffic site - never reaching the batch size, so ALWAYS flushing
// on the timer - that meant losing a batch on every eviction, leaving live
// stats permanently short of the Iceberg system of record. The buffer remains
// only as the insert path's staging array, drained on every record().

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
  /** In-memory running monthly counters (authoritative between flushes). */
  private monthCounts = new Map<string, number>();
  private memo = new Map<string, { expires: number; value: unknown }>();
  /** Avoids an async storage.getAlarm() round-trip on every record(). */
  private alarmArmed = false;
  /** Months whose in-memory counter is ahead of the `usage` table. */
  private dirtyMonths = new Set<string>();
  /** Events recorded since the counters were last persisted. */
  private countsSincePersist = 0;

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
      -- Nearly every dashboard read predicates on
      --   event_type = 'pageview' AND ts >= ? AND ts < ?
      -- so the plain ts index still leaves engagement/custom-event rows to be
      -- scanned and filtered. The composite lets SQLite seek straight to the
      -- pageview rows in the window, which matters because these scans run on
      -- a single-threaded object that ingest shares.
      CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events (event_type, ts);
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

    for (const e of events) this.dirtyMonths.add(e.hourKey.slice(0, 7));
    this.countsSincePersist += events.length;
    if (this.countsSincePersist >= COUNTER_PERSIST_EVERY) this.persistCounts();
  }

  /**
   * Write the in-memory monthly counters to SQLite.
   *
   * Deliberately NOT done per event. Nothing reads the `usage` table on the
   * hot path - monthCounts is authoritative in memory - so the table is only
   * a durable copy for when the object is evicted. Rewriting one integer on
   * every event made it the second-largest source of billable row writes
   * (Cloudflare bills per row written), for no observable benefit. Persisting
   * every COUNTER_PERSIST_EVERY events removes ~98% of those writes and caps
   * the worst case at that many events of counter drift, and only if the
   * object is evicted between persists. Reads, freshness and event durability
   * are untouched: event rows are still written on arrival.
   */
  private persistCounts(): void {
    if (this.dirtyMonths.size === 0) return;
    for (const month of this.dirtyMonths) {
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
    this.dirtyMonths.clear();
    this.countsSincePersist = 0;
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
      // The page filter alone also understands the '/section/*' prefix syntax.
      if (col === 'pathname' && isPagePrefix(value)) {
        const prefix = value.slice(0, -2);
        sql += ` AND (${col} = ? OR ${col} LIKE ? ESCAPE '\\')`;
        params.push(prefix, `${escapeLike(prefix)}/%`);
        continue;
      }
      sql += ` AND ${col} = ?`;
      params.push(value);
    }
    return { sql, params };
  }

  /** Stable memo-key fragment for a filter set. */
  /** Percent-escape the key separators so two different filter sets can never
   *  serialize to the same memo key ({os:'a&b=c'} vs {os:'a', b:'c'}). */
  private static esc(v: string): string {
    return v.replace(/%/g, '%25').replace(/&/g, '%26').replace(/=/g, '%3D');
  }

  private static filterKey(filters?: LiveFilters): string {
    if (!filters) return '';
    return Object.entries(filters)
      .filter(([, v]) => typeof v === 'string')
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k}=${SiteLiveStore.esc(v as string)}`)
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

    // Durability over batching: persist on arrival (see the note on FLUSH_MAX).
    this.flushBuffer();

    // Arm the retention alarm. The flag is only latched AFTER the alarm is
    // actually scheduled - setting it first meant one failed setAlarm() (or an
    // alarm handler that exhausted its retries) permanently disarmed pruning
    // for the life of the instance, and rows then grew without bound.
    if (!this.alarmArmed) {
      try {
        if ((await this.ctx.storage.getAlarm()) === null) {
          await this.ctx.storage.setAlarm(Date.now() + PRUNE_INTERVAL_MS);
        }
        this.alarmArmed = true;
      } catch (err) {
        this.alarmArmed = false; // retry on the next event
        console.error('[live-store] failed to arm prune alarm:', err);
      }
    }
    return count;
  }

  async purge(): Promise<void> {
    this.buffer = [];
    this.monthCounts.clear();
    this.dirtyMonths.clear();
    this.countsSincePersist = 0;
    this.memo.clear();
    this.alarmArmed = false;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async alarm(): Promise<void> {
    this.flushBuffer();
    // Bound counter drift by time as well as by event count: an object that
    // goes quiet mid-batch still has its counters durable within the hour.
    this.persistCounts();
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
          // No pageview row does NOT mean an empty period: engagement events
          // can exist without one, and discarding them reported a false 100%
          // drop in visit duration against the comparison window.
          return {
            pageviews: n(stat?.pageviews),
            visitors: n(stat?.visitors),
            sessions: n(stat?.sessions),
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
    // Region/city rows also carry the country code so the UI can show a flag;
    // grouping by (name, country) keeps same-named places apart.
    const withCountry = dimension === 'region' || dimension === 'city';
    return this.memoized(
      `topList:${col}:${SiteLiveStore.q(fromMs)}:${SiteLiveStore.q(toMs)}:${boundedLimit}:${SiteLiveStore.filterKey(filters)}`,
      MEMO_TTL_MS,
      () =>
        this.sql
          .exec(
            `SELECT ${col} AS name,${withCountry ? ' country,' : ''}
                    COUNT(DISTINCT visitor_id) AS visitors,
                    COUNT(*) AS pageviews,
                    COUNT(DISTINCT session_id) AS sessions
             FROM events
             WHERE event_type = 'pageview' AND ts >= ? AND ts < ? AND ${col} != ''${f.sql}
             GROUP BY ${withCountry ? `${col}, country` : col}
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
            ...(withCountry ? { country: String(r.country ?? '') } : {}),
          }))
    );
  }

  /** Pageviews referred by known AI assistants, grouped by assistant name.
   *  Classification is query-time from referrer_hostname (shared/ai-sources). */
  async aiSources(
    fromMs: number,
    toMs: number,
    limit: number,
    filters?: LiveFilters
  ): Promise<LiveTopListRow[]> {
    const boundedLimit = Math.max(1, Math.min(100, limit));
    const f = SiteLiveStore.filterSql(filters);
    const caseExpr = aiSourceCaseSql('referrer_hostname');
    return this.memoized(
      `aiSources:${SiteLiveStore.q(fromMs)}:${SiteLiveStore.q(toMs)}:${boundedLimit}:${SiteLiveStore.filterKey(filters)}`,
      MEMO_TTL_MS,
      () =>
        this.sql
          .exec(
            `SELECT ${caseExpr} AS name,
                    COUNT(DISTINCT visitor_id) AS visitors,
                    COUNT(*) AS pageviews,
                    COUNT(DISTINCT session_id) AS sessions
             FROM events
             WHERE event_type = 'pageview' AND ts >= ? AND ts < ?
               AND referrer_hostname IN (${AI_HOSTNAME_IN})${f.sql}
             GROUP BY ${caseExpr}
             ORDER BY visitors DESC
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

  async realtime(nowMs: number): Promise<LiveRealtime> {
    return this.memoized(`realtime:${SiteLiveStore.q(nowMs)}`, MEMO_TTL_REALTIME_MS, () => {
      const from = nowMs - 5 * 60 * 1000;
      // Distinct across ALL pages - a visitor on 3 pages is still 1 visitor
      // (and the per-page top-10 below can't be summed to get this).
      const total = n(
        this.sql
          .exec(
            `SELECT COUNT(DISTINCT visitor_id) AS c
             FROM events
             WHERE event_type = 'pageview' AND ts >= ? AND ts < ?`,
            from,
            nowMs
          )
          .toArray()[0]?.c
      );
      const rows = this.sql
        .exec(
          `SELECT pathname, COUNT(DISTINCT visitor_id) AS visitors
           FROM events
           WHERE event_type = 'pageview' AND ts >= ? AND ts < ?
           GROUP BY pathname
           ORDER BY visitors DESC
           LIMIT 10`,
          from,
          nowMs
        )
        .toArray()
        .map(r => ({ pathname: String(r.pathname), visitors: n(r.visitors) }));
      return { total, rows };
    });
  }

  async goalStats(
    fromMs: number,
    toMs: number,
    goalDefs: LiveGoalTarget[],
    filters?: LiveFilters
  ): Promise<LiveGoalRow[]> {
    const defs = goalDefs.slice(0, 50);
    if (defs.length === 0) return [];
    // Plain goals batch into one IN/GROUP BY query per kind; prop-filtered
    // event goals and '/section/*' prefix page goals each need their own
    // WHERE, so they run as individual single-row counts.
    const hasProp = (g: LiveGoalTarget): boolean => Boolean(g.propKey && g.propValue);
    const plainEvents = defs.filter(g => g.type === 'event' && !hasProp(g));
    const plainPages = defs.filter(g => g.type === 'page' && !isPagePrefix(g.target));
    const special = defs.filter(
      g => (g.type === 'event' && hasProp(g)) || (g.type === 'page' && isPagePrefix(g.target))
    );
    const f = SiteLiveStore.filterSql(filters);
    const defKey = defs
      .map(
        g =>
          `${g.id}\u0001${g.type}\u0001${g.target}\u0001${g.propKey ?? ''}\u0001${g.propValue ?? ''}`
      )
      .join('\u0002');
    const memoKey = `goals:${SiteLiveStore.q(fromMs)}:${SiteLiveStore.q(toMs)}:${defKey}:${SiteLiveStore.filterKey(filters)}`;
    return this.memoized(memoKey, MEMO_TTL_MS, () => {
      const rows: LiveGoalRow[] = [];
      const batch = (
        goalList: LiveGoalTarget[],
        eventType: string,
        col: 'event_name' | 'pathname'
      ): void => {
        if (goalList.length === 0) return;
        const targets = [...new Set(goalList.map(g => g.target))];
        const marks = targets.map(() => '?').join(', ');
        const byTarget = new Map<string, { events: number; visitors: number }>();
        for (const r of this.sql
          .exec(
            `SELECT ${col} AS target, COUNT(*) AS events,
                    COUNT(DISTINCT visitor_id) AS visitors
             FROM events
             WHERE event_type = '${eventType}' AND ts >= ? AND ts < ?${f.sql}
               AND ${col} IN (${marks})
             GROUP BY ${col}`,
            fromMs,
            toMs,
            ...f.params,
            ...targets
          )
          .toArray()) {
          byTarget.set(String(r.target), { events: n(r.events), visitors: n(r.visitors) });
        }
        for (const g of goalList) {
          const hit = byTarget.get(g.target);
          if (hit) rows.push({ goalId: g.id, ...hit });
        }
      };
      batch(plainEvents, 'event', 'event_name');
      batch(plainPages, 'pageview', 'pathname');

      for (const g of special) {
        let cond: string;
        const params: (string | number)[] = [fromMs, toMs, ...f.params];
        if (g.type === 'event') {
          const patterns = propLikePatterns(g.propKey!, g.propValue!);
          const like = patterns.map(() => `event_meta LIKE ? ESCAPE '\\'`).join(' OR ');
          cond = `event_type = 'event' AND event_name = ? AND (${like})`;
          params.push(g.target, ...patterns);
        } else {
          const prefix = g.target.slice(0, -2);
          cond = `event_type = 'pageview' AND (pathname = ? OR pathname LIKE ? ESCAPE '\\')`;
          params.push(prefix, `${escapeLike(prefix)}/%`);
        }
        const [r] = this.sql
          .exec(
            `SELECT COUNT(*) AS events, COUNT(DISTINCT visitor_id) AS visitors
             FROM events
             WHERE ts >= ? AND ts < ?${f.sql} AND ${cond}`,
            ...params
          )
          .toArray();
        if (r) rows.push({ goalId: g.id, events: n(r.events), visitors: n(r.visitors) });
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
      `eventMeta:${SiteLiveStore.esc(eventName)}:${SiteLiveStore.q(fromMs)}:${SiteLiveStore.q(toMs)}:${boundedLimit}:${SiteLiveStore.filterKey(filters)}`,
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
      `linkClicks:${SiteLiveStore.esc(eventName)}:${SiteLiveStore.q(fromMs)}:${SiteLiveStore.q(toMs)}:${boundedLimit}:${SiteLiveStore.filterKey(filters)}`,
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
