import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { createSiteSchema, updateSiteSchema, planOf } from '@traks/shared';
import { requireAuth } from '../middleware/auth';
import { sites, apiKeys, users } from '../db/schema';
import type { Bindings, Variables } from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const exportToggleSchema = z.object({ enabled: z.boolean() });

/** Long random read-only secret for the public export download URLs. */
function generateExportToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `exp_${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
}

export const sitesRoute = app
  // List user's sites
  .get('/', requireAuth, async c => {
    const userId = c.get('userId')!;
    const db = c.get('db')!;

    const userSites = await db.select().from(sites).where(eq(sites.userId, userId));

    return c.json({ data: userSites });
  })

  // Create a new site
  .post('/', requireAuth, zValidator('json', createSiteSchema), async c => {
    const userId = c.get('userId')!;
    const body = c.req.valid('json');
    const db = c.get('db')!;

    // Plan site limit
    const [user] = await db.select({ plan: users.plan }).from(users).where(eq(users.id, userId));
    const plan = planOf(user?.plan);
    const existing = await db.select({ id: sites.id }).from(sites).where(eq(sites.userId, userId));
    if (existing.length >= plan.siteLimit) {
      return c.json(
        { error: `The ${plan.name} plan allows ${plan.siteLimit} site(s). Upgrade to add more.` },
        403
      );
    }

    const siteId = createId();
    const siteKey = `pb_live_${createId()}`;

    await db.insert(sites).values({
      id: siteId,
      userId,
      name: body.name,
      domain: body.domain,
      timezone: body.timezone,
    });

    await db.insert(apiKeys).values({
      siteId,
      userId,
      key: siteKey,
      name: 'Default',
    });

    const [site] = await db.select().from(sites).where(eq(sites.id, siteId));

    return c.json({ data: site, key: siteKey }, 201);
  })

  // Get site details + API key
  .get('/:id', requireAuth, async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('id');
    const db = c.get('db')!;

    const [site] = await db.select().from(sites).where(eq(sites.id, siteId));

    if (!site || site.userId !== userId) {
      return c.json({ error: 'Not found' }, 404);
    }

    const keys = await db.select().from(apiKeys).where(eq(apiKeys.siteId, siteId));

    return c.json({ data: { ...site, apiKeys: keys } });
  })

  // Update a site
  .patch('/:id', requireAuth, zValidator('json', updateSiteSchema), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('id');
    const body = c.req.valid('json');
    const db = c.get('db')!;

    const [site] = await db.select().from(sites).where(eq(sites.id, siteId));

    if (!site || site.userId !== userId) {
      return c.json({ error: 'Not found' }, 404);
    }

    try {
      await db
        .update(sites)
        .set({
          name: body.name,
          domain: body.domain,
          updatedAt: new Date(),
        })
        .where(eq(sites.id, siteId));
    } catch (err: any) {
      if (err?.message?.includes('UNIQUE constraint failed')) {
        return c.json({ error: 'Domain is already in use' }, 409);
      }
      throw err;
    }

    const [updated] = await db.select().from(sites).where(eq(sites.id, siteId));

    return c.json({ data: updated });
  })

  // Toggle public share dashboard
  .post('/:id/public', requireAuth, zValidator('json', exportToggleSchema), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('id');
    const { enabled } = c.req.valid('json');
    const db = c.get('db')!;

    const [site] = await db.select().from(sites).where(eq(sites.id, siteId));
    if (!site || site.userId !== userId) {
      return c.json({ error: 'Not found' }, 404);
    }

    await db
      .update(sites)
      .set({ public: enabled, updatedAt: new Date() })
      .where(eq(sites.id, siteId));

    return c.json({ data: { enabled } });
  })

  // Toggle nightly raw-data export; generates the access token on first enable
  .post('/:id/export', requireAuth, zValidator('json', exportToggleSchema), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('id');
    const { enabled } = c.req.valid('json');
    const db = c.get('db')!;

    const [site] = await db.select().from(sites).where(eq(sites.id, siteId));
    if (!site || site.userId !== userId) {
      return c.json({ error: 'Not found' }, 404);
    }

    // Exports are a paid-plan feature (disable is always allowed).
    if (enabled) {
      const [user] = await db.select({ plan: users.plan }).from(users).where(eq(users.id, userId));
      if (!planOf(user?.plan).exports) {
        return c.json({ error: 'Data export requires a paid plan.' }, 403);
      }
    }

    const exportToken = site.exportToken ?? generateExportToken();
    await db
      .update(sites)
      .set({ exportEnabled: enabled, exportToken, updatedAt: new Date() })
      .where(eq(sites.id, siteId));

    return c.json({ data: { enabled, token: exportToken } });
  })

  // Delete a site (also purges its live DO and export files)
  .delete('/:id', requireAuth, async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('id');
    const db = c.get('db')!;

    const [site] = await db.select().from(sites).where(eq(sites.id, siteId));

    if (!site || site.userId !== userId) {
      return c.json({ error: 'Not found' }, 404);
    }

    // Grab keys before the cascade delete removes them.
    const keys = await db
      .select({ key: apiKeys.key })
      .from(apiKeys)
      .where(eq(apiKeys.siteId, siteId));

    await db.delete(sites).where(eq(sites.id, siteId));

    c.executionCtx.waitUntil(
      (async () => {
        // Wipe the site's live DO storage (one DO per key).
        for (const { key } of keys) {
          const stub = c.env.LIVE.get(c.env.LIVE.idFromName(key)) as unknown as {
            purge: () => Promise<void>;
          };
          await stub.purge().catch(err => console.error('[sites] DO purge failed:', err));
        }
        // Remove export files.
        let cursor: string | undefined;
        do {
          const listed = await c.env.EXPORTS.list({ prefix: `${siteId}/`, cursor });
          if (listed.objects.length > 0) {
            await c.env.EXPORTS.delete(listed.objects.map(o => o.key));
          }
          cursor = listed.truncated ? listed.cursor : undefined;
        } while (cursor);
      })().catch(err => console.error('[sites] cleanup failed:', err))
    );

    return c.json({ ok: true });
  });
