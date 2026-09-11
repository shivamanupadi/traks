import { Hono } from 'hono';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { validate } from '../lib/validate';
import { requireAuth } from '../middleware/auth';
import { getSiteAccess } from '../lib/workspaces';
import { roleAllows } from '../lib/permissions';
import { securitySiteSettings, securityIpLogs, securityAccessAudit } from '../db/schema';
import type { Bindings, Variables } from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

async function requireSecurity(
  db: NonNullable<Variables['db']>,
  userId: string,
  siteId: string,
  scopeWorkspaceId?: string
) {
  const access = await getSiteAccess(db, userId, siteId, scopeWorkspaceId);
  if (!access) return { ok: false as const, status: 404 as const, error: 'Not found' };
  if (!roleAllows(access.role, { security: ['read'] })) {
    return {
      ok: false as const,
      status: 403 as const,
      error: 'Security mode is limited to workspace owners',
    };
  }
  return { ok: true as const };
}

const settingsBody = z.object({
  enabled: z.boolean(),
});

export const securityRoute = app
  .get('/:siteId', requireAuth, async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const db = c.get('db')!;
    const gate = await requireSecurity(db, userId, siteId, c.get('tokenWorkspaceId'));
    if (!gate.ok) return c.json({ error: gate.error }, gate.status);

    const [row] = await db
      .select()
      .from(securitySiteSettings)
      .where(eq(securitySiteSettings.siteId, siteId))
      .limit(1);
    return c.json({
      data: {
        enabled: row?.enabled === true,
        retentionDays: row?.retentionDays ?? 90,
        geoNote: 'IP-based location is city/ISP-level approximate, not GPS-precise.',
      },
    });
  })

  .put('/:siteId', requireAuth, validate('json', settingsBody), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const { enabled } = c.req.valid('json');
    const db = c.get('db')!;
    const gate = await requireSecurity(db, userId, siteId, c.get('tokenWorkspaceId'));
    if (!gate.ok) return c.json({ error: gate.error }, gate.status);

    await db
      .insert(securitySiteSettings)
      .values({ siteId, enabled, retentionDays: 90 })
      .onConflictDoUpdate({
        target: securitySiteSettings.siteId,
        set: { enabled },
      });
    await db.insert(securityAccessAudit).values({
      id: createId(),
      userId,
      siteId,
      action: enabled ? 'enable' : 'disable',
    });
    return c.json({ data: { enabled } });
  })

  .get('/:siteId/logs', requireAuth, async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('siteId');
    const db = c.get('db')!;
    const gate = await requireSecurity(db, userId, siteId, c.get('tokenWorkspaceId'));
    if (!gate.ok) return c.json({ error: gate.error }, gate.status);

    const rows = await db
      .select()
      .from(securityIpLogs)
      .where(eq(securityIpLogs.siteId, siteId))
      .orderBy(desc(securityIpLogs.ts))
      .limit(200);

    await db.insert(securityAccessAudit).values({
      id: createId(),
      userId,
      siteId,
      action: 'view',
    });

    return c.json({
      data: rows.map(r => ({
        id: r.id,
        ip: r.ipRaw,
        country: r.country,
        city: r.city,
        isp: r.isp,
        sessionId: r.sessionId,
        ts: r.ts,
      })),
      geoNote: 'IP-based location is city/ISP-level approximate, not GPS-precise.',
    });
  });

export async function purgeExpiredSecurityLogs(db: D1Database): Promise<void> {
  const now = Date.now();
  await db.prepare(`DELETE FROM security_ip_logs WHERE expires_at < ?`).bind(now).run();
}
