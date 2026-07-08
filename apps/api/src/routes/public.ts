import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, isNull } from 'drizzle-orm';
import { PERIODS } from '@traks/shared';
import { sites, apiKeys } from '../db/schema';
import { fetchDashboard } from './analytics';
import type { Bindings, Variables } from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const periodQuery = z.object({ period: z.enum(PERIODS).default('today') });

/**
 * Unauthenticated dashboard for sites whose owner enabled public sharing.
 * Serves the same payload as the authed /stats/all via fetchDashboard;
 * exposure is opt-in per site (sites.public).
 */
export const publicRoute = app.get(
  '/:siteId/stats/all',
  zValidator('query', periodQuery),
  async c => {
    const siteId = c.req.param('siteId');
    const { period } = c.req.valid('query');
    const db = c.get('db')!;

    const [site] = await db
      .select({
        siteId: sites.id,
        key: apiKeys.key,
        timezone: sites.timezone,
        name: sites.name,
        domain: sites.domain,
      })
      .from(sites)
      .innerJoin(apiKeys, eq(sites.id, apiKeys.siteId))
      .where(and(eq(sites.id, siteId), eq(sites.public, true), isNull(apiKeys.revokedAt)))
      .limit(1);
    if (!site) return c.json({ error: 'Not found' }, 404);

    const result = await fetchDashboard(c, site, period);
    if (result instanceof Response) return result;
    return c.json({
      data: { site: { name: site.name, domain: site.domain }, stats: result },
    });
  }
);
