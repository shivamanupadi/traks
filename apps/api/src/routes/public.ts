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

// Whole-response edge cache. This is the only unauthenticated, unlimited-
// audience path to a site's live DO, so without it a popular share link
// hits the DO once per viewer per poll. Capped at 60s: a cache hit skips
// the sites.public check, so this also bounds how long a dashboard stays
// reachable after the owner turns sharing off.
const CACHE_TTL_TODAY = 30;
const CACHE_TTL_HISTORY = 60;

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

    const ttl = period === 'today' ? CACHE_TTL_TODAY : CACHE_TTL_HISTORY;
    const cacheKey = new Request(`https://public-cache.traks.internal/${siteId}/${period}`);
    // Cast: type-checked through the Hono RPC AppType under DOM lib types.
    const cache = (caches as unknown as { default: Cache }).default;

    const hit = await cache.match(cacheKey);
    if (hit) return new Response(hit.body, hit);

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

    const body = JSON.stringify({
      data: { site: { name: site.name, domain: site.domain }, stats: result },
    });
    c.executionCtx.waitUntil(
      cache.put(
        cacheKey,
        new Response(body, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=${ttl}`,
          },
        })
      )
    );
    return c.body(body, 200, { 'Content-Type': 'application/json' });
  }
);
