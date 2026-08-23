import type { Hono } from 'hono';
import type { Period } from '@traks/shared';
import type { Bindings, Variables } from '../types';
import { cacheTtlSeconds } from './cache-ttl';

/**
 * Dashboard pre-warming.
 *
 * Historical panels are served stale-while-revalidate, so a viewer who comes
 * back after a few hours gets an instant response with hours-old numbers
 * while the refresh runs behind it. The cron below keeps the cache FRESH for
 * sites someone looked at recently: at the start of each cache bucket it
 * re-runs the unfiltered dashboard queries for those sites, so the next view
 * is both instant and current.
 *
 * Cost is real - R2 SQL bills a 10 MB minimum per query - so the warm set is
 * deliberately small: only sites viewed in the last PREWARM_HOURS (default 2,
 * 0 disables), only the periods they viewed plus 7d/30d, and only when a new
 * cache bucket has just begun.
 */

/** Per-isolate secret: the cron passes it to the internal warm route, so the
 *  route is unreachable from outside (the value never leaves the worker). */
export const INTERNAL_TOKEN = crypto.randomUUID();
export const INTERNAL_HEADER = 'x-traks-internal';

const KV_PREFIX = 'warm:';
const DEFAULT_HOURS = 2;
const ALWAYS: Period[] = ['7d', '30d'];
/** Periods the DO hot path serves - never worth warming. */
const HOT: ReadonlySet<string> = new Set(['today', 'yesterday']);
const FILTER_KEYS = [
  'page',
  'source',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'country',
  'region',
  'city',
  'browser',
  'os',
  'device',
];

interface WarmRecord {
  periods: Period[];
  at: number;
}

export function prewarmHours(env: Bindings): number {
  const raw = env.PREWARM_HOURS;
  if (raw === undefined || raw === '') return DEFAULT_HOURS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 24) : DEFAULT_HOURS;
}

const lastNoted = new Map<string, number>();
const NOTE_THROTTLE_MS = 5 * 60 * 1000;

/**
 * Record that a site's dashboard was viewed (unfiltered requests only - a
 * filtered view would warm the wrong SQL). Throttled per isolate so a
 * dashboard's dozen panel requests cost one KV write.
 */
export function noteSiteView(
  env: Bindings,
  ctx: ExecutionContext,
  siteId: string,
  query: Record<string, string>
): void {
  const hours = prewarmHours(env);
  if (hours === 0) return;
  if (FILTER_KEYS.some(k => query[k])) return;
  const period = (query.period ?? 'today') as Period;
  const throttleKey = `${siteId}|${period}`;
  const now = Date.now();
  if ((lastNoted.get(throttleKey) ?? 0) > now - NOTE_THROTTLE_MS) return;
  lastNoted.set(throttleKey, now);
  if (lastNoted.size > 2000) lastNoted.clear();

  const key = KV_PREFIX + siteId;
  ctx.waitUntil(
    (async () => {
      let periods: Period[] = [];
      try {
        const prev = await env.R2SQL_CACHE.get<WarmRecord>(key, 'json');
        if (prev?.periods) periods = prev.periods;
      } catch {
        /* KV read failure: start fresh */
      }
      if (!HOT.has(period)) periods = [period, ...periods.filter(p => p !== period)].slice(0, 3);
      const rec: WarmRecord = { periods, at: now };
      await env.R2SQL_CACHE.put(key, JSON.stringify(rec), {
        expirationTtl: Math.max(60, Math.round(hours * 3600)),
      }).catch(err => console.error('[prewarm] KV put failed:', err));
    })()
  );
}

/** True when a cache bucket for this period started within the last minute. */
function bucketJustStarted(period: Period, now: number): boolean {
  const quantum = cacheTtlSeconds(period) * 1000;
  return now % quantum < 60_000;
}

/** Cron entry point: warm every recently viewed site whose bucket just rolled. */
export async function runPrewarm(
  app: Hono<{ Bindings: Bindings; Variables: Variables }>,
  env: Bindings,
  ctx: ExecutionContext
): Promise<void> {
  if (prewarmHours(env) === 0) return;
  const now = Date.now();
  const list = await env.R2SQL_CACHE.list({ prefix: KV_PREFIX, limit: 1000 }).catch(() => null);
  if (!list) return;

  const jobs: Promise<unknown>[] = [];
  for (const { name } of list.keys) {
    const siteId = name.slice(KV_PREFIX.length);
    const rec = await env.R2SQL_CACHE.get<WarmRecord>(name, 'json').catch(() => null);
    const periods = new Set<Period>([...(rec?.periods ?? []), ...ALWAYS]);
    for (const period of periods) {
      if (HOT.has(period) || !bucketJustStarted(period, now)) continue;
      jobs.push(
        Promise.resolve(
          app.request(
            `/api/analytics/internal/warm/${encodeURIComponent(siteId)}?period=${period}`,
            { headers: { [INTERNAL_HEADER]: INTERNAL_TOKEN } },
            env,
            ctx
          )
        )
          .then((res: Response) => {
            if (!res.ok) console.warn(`[prewarm] ${siteId} ${period} -> ${res.status}`);
          })
          .catch((err: unknown) => console.error('[prewarm] failed:', err))
      );
    }
  }
  if (jobs.length) console.log(`[prewarm] warming ${jobs.length} dashboard(s)`);
  await Promise.all(jobs);
}
