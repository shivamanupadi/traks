import { drizzle } from 'drizzle-orm/d1';
import { eq, and, inArray, isNull, notLike } from 'drizzle-orm';
import {
  TABLE_PROD,
  TABLE_DEV,
  queryR2Sql,
  resolvePeriod,
  buildStatsWithComparisonQuery,
  planOf,
} from '@traks/shared';
import { users, sites, apiKeys, opsState } from '../db/schema';
import type { Bindings } from '../types';

function r2SqlConfig(env: Bindings) {
  return {
    accountId: env.R2_ACCOUNT_ID,
    bucketName: env.R2_BUCKET_NAME,
    apiToken: env.R2_SQL_TOKEN,
    table: env.ENVIRONMENT === 'production' ? TABLE_PROD : TABLE_DEV,
  };
}

export async function sendEmail(
  env: Bindings,
  to: string,
  subject: string,
  html: string
): Promise<boolean> {
  try {
    await env.EMAIL.send({ to, from: env.EMAIL_FROM, subject, html });
    return true;
  } catch (err) {
    console.error(`[email] send to ${to} failed:`, err);
    return false;
  }
}

export async function alertAdmin(env: Bindings, subject: string, html: string): Promise<void> {
  if (!env.ADMIN_EMAIL) return;
  await sendEmail(env, env.ADMIN_EMAIL, `[traks ${env.ENVIRONMENT}] ${subject}`, html);
}

// ============ Pipeline freshness healthcheck (*/30 cron) ============

async function getOpsValue(env: Bindings, key: string): Promise<string | null> {
  const db = drizzle(env.DB);
  const [row] = await db.select().from(opsState).where(eq(opsState.key, key));
  return row?.value ?? null;
}

async function setOpsValue(env: Bindings, key: string, value: string): Promise<void> {
  const db = drizzle(env.DB);
  await db
    .insert(opsState)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: opsState.key, set: { value, updatedAt: new Date() } });
}

/**
 * Alerts (once per transition) when no events have landed in Iceberg for 2h.
 * Can't distinguish "pipeline broken" from "genuinely zero traffic", so the
 * alert says to verify — for a product with any steady traffic it's a strong
 * signal the stream→sink path is stuck.
 */
export async function runFreshnessCheck(env: Bindings): Promise<void> {
  const config = r2SqlConfig(env);
  const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();

  let status: 'healthy' | 'stale';
  try {
    const rows = await queryR2Sql<{ latest: unknown }>(
      config,
      table => `SELECT MAX(ts) AS latest FROM ${table} WHERE ts >= TIMESTAMP '${twoHoursAgo}'`
    );
    status = rows[0]?.latest ? 'healthy' : 'stale';
  } catch (err) {
    console.error('[ops] freshness query failed:', err);
    status = 'stale';
  }

  const previous = await getOpsValue(env, 'pipeline_status');
  if (previous !== status) {
    await setOpsValue(env, 'pipeline_status', status);
    if (status === 'stale' && previous !== null) {
      await alertAdmin(
        env,
        'Pipeline may be stuck',
        `<p>No events have landed in the Iceberg table in the last 2 hours ` +
          `(or the R2 SQL healthcheck itself failed). If traffic is expected, ` +
          `check the Pipelines dashboard for dropped events and the sink status.</p>`
      );
    } else if (status === 'healthy' && previous === 'stale') {
      await alertAdmin(env, 'Pipeline recovered', '<p>Events are flowing into Iceberg again.</p>');
    }
  }
}

// ============ Weekly email digest (Monday 08:00 UTC cron) ============

const fmt = (n: number): string => new Intl.NumberFormat('en-US').format(n);
const arrow = (change: number): string =>
  change > 0 ? `▲ ${change}%` : change < 0 ? `▼ ${Math.abs(change)}%` : '—';

interface DigestRow {
  name: string;
  domain: string;
  visitors: number;
  pageviews: number;
  visitorsChange: number;
}

function digestHtml(rows: DigestRow[], appUrl: string): string {
  const items = rows
    .map(
      r => `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">
          <strong>${r.name}</strong><br/><span style="color:#888;font-size:12px;">${r.domain}</span>
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">${fmt(r.visitors)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">${fmt(r.pageviews)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">${arrow(r.visitorsChange)}</td>
      </tr>`
    )
    .join('');
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;">
    <h2 style="color:#2D3436;">Your week in numbers</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;color:#2D3436;">
      <tr>
        <th style="text-align:left;padding:8px 12px;color:#888;font-weight:500;">Site</th>
        <th style="text-align:right;padding:8px 12px;color:#888;font-weight:500;">Visitors</th>
        <th style="text-align:right;padding:8px 12px;color:#888;font-weight:500;">Pageviews</th>
        <th style="text-align:right;padding:8px 12px;color:#888;font-weight:500;">vs prev</th>
      </tr>
      ${items}
    </table>
    <p style="margin-top:16px;"><a href="${appUrl}/portal/sites" style="color:#9b72cf;">Open dashboard →</a></p>
    <p style="color:#B5B0AA;font-size:12px;">You can turn this digest off in Settings.</p>
  </div>`;
}

export async function runWeeklyDigest(env: Bindings): Promise<void> {
  const db = drizzle(env.DB);
  const config = r2SqlConfig(env);
  const now = new Date();

  // Paid-plan users who opted in and have a real (Clerk-synced) email.
  const recipients = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.weeklyReport, true),
        inArray(users.plan, ['pro', 'business']),
        notLike(users.email, '%@clerk.user')
      )
    );

  for (const user of recipients) {
    if (!planOf(user.plan).weeklyReports) continue;
    try {
      const userSites = await db
        .select({
          name: sites.name,
          domain: sites.domain,
          timezone: sites.timezone,
          key: apiKeys.key,
        })
        .from(sites)
        .innerJoin(apiKeys, eq(sites.id, apiKeys.siteId))
        .where(and(eq(sites.userId, user.id), isNull(apiKeys.revokedAt)));
      if (userSites.length === 0) continue;

      const rows: DigestRow[] = [];
      for (const site of userSites) {
        const range = resolvePeriod('7d', now, site.timezone);
        const stats = await queryR2Sql<{
          period: string;
          visitors: unknown;
          pageviews: unknown;
        }>(config, buildStatsWithComparisonQuery(site.key, range));
        const cur = stats.find(r => r.period === 'current');
        const prev = stats.find(r => r.period === 'previous');
        const visitors = Number(cur?.visitors ?? 0) || 0;
        const prevVisitors = Number(prev?.visitors ?? 0) || 0;
        rows.push({
          name: site.name,
          domain: site.domain,
          visitors,
          pageviews: Number(cur?.pageviews ?? 0) || 0,
          visitorsChange:
            prevVisitors === 0
              ? visitors > 0
                ? 100
                : 0
              : Math.round(((visitors - prevVisitors) / prevVisitors) * 100),
        });
      }

      await sendEmail(env, user.email, 'Your weekly Traks report', digestHtml(rows, env.APP_URL));
    } catch (err) {
      console.error(`[digest] user ${user.id} failed:`, err);
    }
  }
}
