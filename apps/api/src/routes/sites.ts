import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { createSiteSchema, updateSiteSchema } from '@traks/shared';
import { requireAuth } from '../middleware/auth';
import { sites, apiKeys } from '../db/schema';
import type { Bindings, Variables } from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

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

    const [site] = await db
      .select()
      .from(sites)
      .where(eq(sites.id, siteId));

    if (!site || site.userId !== userId) {
      return c.json({ error: 'Not found' }, 404);
    }

    const keys = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.siteId, siteId));

    return c.json({ data: { ...site, apiKeys: keys } });
  })

  // Update a site
  .patch('/:id', requireAuth, zValidator('json', updateSiteSchema), async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('id');
    const body = c.req.valid('json');
    const db = c.get('db')!;

    const [site] = await db
      .select()
      .from(sites)
      .where(eq(sites.id, siteId));

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

  // Delete a site
  .delete('/:id', requireAuth, async c => {
    const userId = c.get('userId')!;
    const siteId = c.req.param('id');
    const db = c.get('db')!;

    const [site] = await db
      .select()
      .from(sites)
      .where(eq(sites.id, siteId));

    if (!site || site.userId !== userId) {
      return c.json({ error: 'Not found' }, 404);
    }

    await db.delete(sites).where(eq(sites.id, siteId));

    return c.json({ ok: true });
  });
