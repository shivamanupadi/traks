import { drizzle } from 'drizzle-orm/d1';
import { and, eq, isNull } from 'drizzle-orm';
import type { LiveStoreApi } from '@traks/shared';
import { sites, apiKeys, users } from '../db/schema';
import { sendEmail } from './ops';
import type { Bindings } from '../types';

// ============ Traffic spike/drop alerts (*/30 cron) ============
//
// Both signals come straight from each site's live DO (memoized ms-latency
// reads over its ~50h window) - no R2 SQL scans, no D1 beyond one join query.
//
// Spike:  last-hour visitors >= max(floor, 3x the trailing-24h hourly average).
// Drop:   zero events for 3h on a site that averaged >= 2 visitors/hour in the
//         24h before the quiet window (i.e. the tracker likely broke - brand
//         new or naturally quiet sites can never trip it).
// Cooldowns are KV keys with a TTL so one spike doesn't email every 30 min.

const HOUR_MS = 3_600_000;
const SPIKE_FLOOR_VISITORS = 10;
const SPIKE_MULTIPLIER = 3;
const DROP_QUIET_HOURS = 3;
const DROP_MIN_HOURLY_BASELINE = 2;
const SPIKE_COOLDOWN_S = 12 * 3600;
const DROP_COOLDOWN_S = 24 * 3600;

interface AlertSite {
  siteId: string;
  siteName: string;
  key: string;
  email: string;
}

/** Send at most one alert of `kind` per site per cooldown window. */
async function sendOncePerCooldown(
  env: Bindings,
  site: AlertSite,
  kind: 'spike' | 'drop',
  cooldownS: number,
  subject: string,
  html: string
): Promise<void> {
  const kvKey = `traffic-alert:${kind}:${site.siteId}`;
  const alreadySent = await env.R2SQL_CACHE.get(kvKey).catch(() => null);
  if (alreadySent !== null) return;
  const sent = await sendEmail(env, site.email, subject, html);
  if (sent) {
    await env.R2SQL_CACHE.put(kvKey, '1', { expirationTtl: cooldownS }).catch(err =>
      console.error('[alerts] cooldown put failed:', err)
    );
  }
}

export async function runTrafficAlerts(env: Bindings): Promise<void> {
  const db = drizzle(env.DB);
  const alertSites: AlertSite[] = await db
    .select({ siteId: sites.id, siteName: sites.name, key: apiKeys.key, email: users.email })
    .from(sites)
    .innerJoin(apiKeys, eq(sites.id, apiKeys.siteId))
    .innerJoin(users, eq(sites.userId, users.id))
    .where(and(eq(users.trafficAlerts, true), isNull(apiKeys.revokedAt)));

  const now = Date.now();
  for (const site of alertSites) {
    try {
      const live = env.LIVE.get(env.LIVE.idFromName(site.key)) as unknown as LiveStoreApi;
      const [lastHour, baseline] = await Promise.all([
        live.totals(now - HOUR_MS, now),
        live.totals(now - 25 * HOUR_MS, now - HOUR_MS),
      ]);
      const avgHourly = baseline.visitors / 24;

      const spikeThreshold = Math.max(
        SPIKE_FLOOR_VISITORS,
        Math.ceil(avgHourly * SPIKE_MULTIPLIER)
      );
      if (lastHour.visitors >= spikeThreshold) {
        await sendOncePerCooldown(
          env,
          site,
          'spike',
          SPIKE_COOLDOWN_S,
          `Traffic spike on ${site.siteName}`,
          `<p><strong>${lastHour.visitors} visitors</strong> in the last hour on ` +
            `<strong>${site.siteName}</strong> — typical is ~${Math.max(1, Math.round(avgHourly))}/hour.</p>` +
            `<p><a href="${env.APP_URL}/portal/site/${site.siteId}">Open the live dashboard</a></p>`
        );
        continue;
      }

      const quiet = await live.totals(now - DROP_QUIET_HOURS * HOUR_MS, now);
      if (quiet.pageviews > 0) continue;
      const prior = await live.totals(
        now - (24 + DROP_QUIET_HOURS) * HOUR_MS,
        now - DROP_QUIET_HOURS * HOUR_MS
      );
      if (prior.visitors / 24 >= DROP_MIN_HOURLY_BASELINE) {
        await sendOncePerCooldown(
          env,
          site,
          'drop',
          DROP_COOLDOWN_S,
          `No traffic on ${site.siteName} for ${DROP_QUIET_HOURS}h`,
          `<p><strong>${site.siteName}</strong> has recorded no events in the last ` +
            `${DROP_QUIET_HOURS} hours, after averaging ~${Math.round(prior.visitors / 24)} visitors/hour. ` +
            `The site or its tracker snippet may be down.</p>` +
            `<p><a href="${env.APP_URL}/portal/site/${site.siteId}">Open the dashboard</a></p>`
        );
      }
    } catch (err) {
      // One site's DO hiccup must not block alerts for the rest.
      console.error(`[alerts] site ${site.siteId} check failed:`, err);
    }
  }
}
