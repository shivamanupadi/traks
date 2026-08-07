import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { users } from '../db/schema';
import type { Bindings, Variables } from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

export const meRoute = app.get('/', requireAuth, async c => {
  const userId = c.get('userId')!;
  const db = c.get('db')!;

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isInstanceOwner: users.isInstanceOwner,
    })
    .from(users)
    .where(eq(users.id, userId));

  if (!user) return c.json({ error: 'Not found' }, 404);

  return c.json({ data: user });
});
