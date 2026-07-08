import { DurableObject } from 'cloudflare:workers';
import type {
  LiveEvent,
  LiveCounts,
  LiveTotals,
  LiveDimension,
  LiveTimeseriesRow,
  LiveTopListRow,
  LiveRealtimeRow,
  LiveCustomEventRow,
} from '@traks/shared';

// "Today" plus the full previous-day comparison window needs at most 48h in
// any timezone; prune with margin.
const RETENTION_MS = 50 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

// Whitelist LiveDimension -> column. Values are used verbatim in SQL, so only
// entries in this map may ever be interpolated.
const DIMENSION_COLUMNS: Record<LiveDimension, string> = {
  pathname: 'pathname',
  referrer_hostname: 'referrer_hostname',
  country: 'country',
  city: 'city',
  browser: 'browser',
  os: 'os',
  device_type: 'device_type',
  utm_source: 'utm_source',
  utm_medium: 'utm_medium',
  utm_campaign: 'utm_campaign',
};

const EMPTY_TOTALS: LiveTotals = { pageviews: 0, visitors: 0, sessions: 0, bounces: 0 };

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
        event_value REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts);
    `);
  }

  async record(e: LiveEvent): Promise<void> {
    this.sql.exec(
      `INSERT INTO events (
        ts, hour_key, event_type, pathname, referrer_hostname,
        utm_source, utm_medium, utm_campaign, country, city,
        browser, os, device_type, session_id, visitor_id,
        event_name, event_value
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      e.eventValue
    );
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + PRUNE_INTERVAL_MS);
    }
  }

  async alarm(): Promise<void> {
    this.sql.exec('DELETE FROM events WHERE ts < ?', Date.now() - RETENTION_MS);
    const remaining = n(this.sql.exec('SELECT COUNT(*) AS c FROM events').one().c);
    // Keep pruning while data remains; a fresh event re-arms the alarm.
    if (remaining > 0) {
      await this.ctx.storage.setAlarm(Date.now() + PRUNE_INTERVAL_MS);
    }
  }

  async totals(fromMs: number, toMs: number): Promise<LiveCounts> {
    const row = this.sql
      .exec(
        `SELECT COUNT(*) AS pageviews,
                COUNT(DISTINCT visitor_id) AS visitors,
                COUNT(DISTINCT session_id) AS sessions
         FROM events
         WHERE event_type = 'pageview' AND ts >= ? AND ts < ?`,
        fromMs,
        toMs
      )
      .one();
    return { pageviews: n(row.pageviews), visitors: n(row.visitors), sessions: n(row.sessions) };
  }

  async mainStats(
    prevFromMs: number,
    curFromMs: number,
    toMs: number
  ): Promise<{ current: LiveTotals; previous: LiveTotals }> {
    const statRows = this.sql
      .exec(
        `SELECT CASE WHEN ts >= ? THEN 'current' ELSE 'previous' END AS period,
                COUNT(*) AS pageviews,
                COUNT(DISTINCT visitor_id) AS visitors,
                COUNT(DISTINCT session_id) AS sessions
         FROM events
         WHERE event_type = 'pageview' AND ts >= ? AND ts < ?
         GROUP BY period`,
        curFromMs,
        prevFromMs,
        toMs
      )
      .toArray();

    // Bounce = session with exactly one pageview; sessions attributed to the
    // period containing their first pageview (mirrors the R2 SQL cold path).
    const bounceRows = this.sql
      .exec(
        `WITH s AS (
           SELECT session_id, MIN(ts) AS first_hit, COUNT(*) AS hits
           FROM events
           WHERE event_type = 'pageview' AND session_id != '' AND ts >= ? AND ts < ?
           GROUP BY session_id
         )
         SELECT CASE WHEN first_hit >= ? THEN 'current' ELSE 'previous' END AS period,
                SUM(hits = 1) AS bounces
         FROM s
         GROUP BY period`,
        prevFromMs,
        toMs,
        curFromMs
      )
      .toArray();

    const build = (period: string): LiveTotals => {
      const stat = statRows.find(r => r.period === period);
      const bounce = bounceRows.find(r => r.period === period);
      if (!stat) return { ...EMPTY_TOTALS };
      return {
        pageviews: n(stat.pageviews),
        visitors: n(stat.visitors),
        sessions: n(stat.sessions),
        bounces: n(bounce?.bounces),
      };
    };

    return { current: build('current'), previous: build('previous') };
  }

  async timeseries(fromMs: number, toMs: number): Promise<LiveTimeseriesRow[]> {
    return this.sql
      .exec(
        `SELECT hour_key AS t,
                COUNT(*) AS pageviews,
                COUNT(DISTINCT visitor_id) AS visitors,
                COUNT(DISTINCT session_id) AS sessions
         FROM events
         WHERE event_type = 'pageview' AND ts >= ? AND ts < ?
         GROUP BY hour_key
         ORDER BY t ASC`,
        fromMs,
        toMs
      )
      .toArray()
      .map(r => ({
        t: String(r.t),
        pageviews: n(r.pageviews),
        visitors: n(r.visitors),
        sessions: n(r.sessions),
      }));
  }

  async topList(
    dimension: LiveDimension,
    fromMs: number,
    toMs: number,
    limit: number
  ): Promise<LiveTopListRow[]> {
    const col = DIMENSION_COLUMNS[dimension];
    if (!col) throw new Error(`Unknown dimension: ${dimension}`);
    const orderBy = dimension === 'pathname' ? 'pageviews' : 'visitors';
    return this.sql
      .exec(
        `SELECT ${col} AS name,
                COUNT(DISTINCT visitor_id) AS visitors,
                COUNT(*) AS pageviews,
                COUNT(DISTINCT session_id) AS sessions
         FROM events
         WHERE event_type = 'pageview' AND ts >= ? AND ts < ? AND ${col} != ''
         GROUP BY ${col}
         ORDER BY ${orderBy} DESC
         LIMIT ?`,
        fromMs,
        toMs,
        Math.max(1, Math.min(100, limit))
      )
      .toArray()
      .map(r => ({
        name: String(r.name),
        visitors: n(r.visitors),
        pageviews: n(r.pageviews),
        sessions: n(r.sessions),
      }));
  }

  async realtime(nowMs: number): Promise<LiveRealtimeRow[]> {
    return this.sql
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
      .map(r => ({ pathname: String(r.pathname), visitors: n(r.visitors) }));
  }

  async customEvents(fromMs: number, toMs: number, limit: number): Promise<LiveCustomEventRow[]> {
    return this.sql
      .exec(
        `SELECT event_name AS name, COUNT(*) AS count, SUM(event_value) AS totalValue
         FROM events
         WHERE event_type = 'event' AND event_name != '' AND ts >= ? AND ts < ?
         GROUP BY event_name
         ORDER BY count DESC
         LIMIT ?`,
        fromMs,
        toMs,
        Math.max(1, Math.min(100, limit))
      )
      .toArray()
      .map(r => ({ name: String(r.name), count: n(r.count), totalValue: n(r.totalValue) }));
  }
}
