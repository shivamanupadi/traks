import { drizzle } from 'drizzle-orm/d1';
import { eq, and, isNull, notLike } from 'drizzle-orm';
import {
  TABLE_PROD,
  TABLE_DEV,
  queryR2Sql,
  resolvePeriod,
  buildStatsWithComparisonQuery,
  type PeriodRange,
} from '@traks/shared';
import { users, sites, apiKeys } from '../db/schema';
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

// ============ Email digests (daily + weekly crons) ============

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

export type DigestKind = 'daily' | 'weekly';

/**
 * Yesterday as a full local day in the site's timezone. Derived from the
 * start of "today"; the fixed 24h subtraction can be off by an hour across
 * a DST transition, which is acceptable for an email digest.
 */
function yesterdayRange(now: Date, timezone: string): PeriodRange {
  const today = resolvePeriod('today', now, timezone);
  const from = new Date(Date.parse(today.from) - 24 * 3600 * 1000).toISOString();
  return { from, to: today.from, granularity: 'day', buckets: [] };
}

function digestHtml(rows: DigestRow[], appUrl: string, kind: DigestKind): string {
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
    <h2 style="color:#2D3436;">${kind === 'weekly' ? 'Your week in numbers' : 'Yesterday in numbers'}</h2>
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

export async function runDigest(env: Bindings, kind: DigestKind): Promise<void> {
  const db = drizzle(env.DB);
  const config = r2SqlConfig(env);
  const now = new Date();

  // Users who opted in (per digest kind) and have a real (Clerk-synced) email.
  const optIn = kind === 'weekly' ? users.weeklyReport : users.dailyReport;
  const recipients = await db
    .select()
    .from(users)
    .where(and(eq(optIn, true), notLike(users.email, '%@clerk.user')));

  for (const user of recipients) {
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
        const range =
          kind === 'weekly'
            ? resolvePeriod('7d', now, site.timezone)
            : yesterdayRange(now, site.timezone);
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

      await sendEmail(
        env,
        user.email,
        kind === 'weekly' ? 'Your weekly Traks report' : 'Your daily Traks report',
        digestHtml(rows, env.APP_URL, kind)
      );
    } catch (err) {
      console.error(`[digest] user ${user.id} failed:`, err);
    }
  }
}
