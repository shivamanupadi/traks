import { Context, Next } from 'hono';
import { getAuth } from '../lib/auth';
import type { Bindings, Variables } from '../types';

export async function requireAuth(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next
): Promise<Response | void> {
  const session = await getAuth(c.env, c.req.url).api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('userId', session.user.id);
  c.set('userEmail', session.user.email);

  await next();
}
