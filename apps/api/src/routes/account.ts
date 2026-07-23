import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { users } from '../db/schema';
import type { Bindings, Variables } from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const prefsSchema = z
  .object({
    weeklyReport: z.boolean().optional(),
    dailyReport: z.boolean().optional(),
  })
  .refine(p => p.weeklyReport !== undefined || p.dailyReport !== undefined, {
    message: 'No preference provided',
  });

export const accountRoute = app
  // Account info + preferences for the settings page
  .get('/me', requireAuth, async c => {
    const userId = c.get('userId')!;
    const db = c.get('db')!;
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    return c.json({
      data: {
        email: user?.email ?? '',
        weeklyReport: user?.weeklyReport ?? true,
        dailyReport: user?.dailyReport ?? false,
      },
    });
  })

  .post('/preferences', requireAuth, zValidator('json', prefsSchema), async c => {
    const userId = c.get('userId')!;
    const { weeklyReport, dailyReport } = c.req.valid('json');
    const db = c.get('db')!;
    await db
      .update(users)
      .set({
        ...(weeklyReport !== undefined ? { weeklyReport } : {}),
        ...(dailyReport !== undefined ? { dailyReport } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    return c.json({ data: { weeklyReport, dailyReport } });
  });
