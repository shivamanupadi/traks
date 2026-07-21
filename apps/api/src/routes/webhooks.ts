import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema';
import { verifyStandardWebhook } from '../lib/webhooks';
import type { Bindings, Variables } from '../types';

interface ClerkUserEvent {
  type: string;
  data: {
    id: string;
    email_addresses?: { id: string; email_address: string }[];
    primary_email_address_id?: string;
    first_name?: string | null;
    last_name?: string | null;
    image_url?: string | null;
  };
}

/**
 * Clerk webhook (svix / Standard Webhooks). Keeps D1 user records in sync so
 * we have real emails for digests instead of the ensure-user placeholder.
 */
export const clerkWebhookRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>().post(
  '/',
  async c => {
    const body = await c.req.text();
    const ok = await verifyStandardWebhook(
      c.env.CLERK_WEBHOOK_SECRET,
      {
        id: c.req.header('svix-id'),
        timestamp: c.req.header('svix-timestamp'),
        signature: c.req.header('svix-signature'),
      },
      body
    );
    if (!ok) return c.json({ error: 'invalid signature' }, 401);

    const event = JSON.parse(body) as ClerkUserEvent;
    if (event.type !== 'user.created' && event.type !== 'user.updated') {
      return c.json({ ok: true });
    }

    const d = event.data;
    const primary =
      d.email_addresses?.find(e => e.id === d.primary_email_address_id) ?? d.email_addresses?.[0];
    if (!primary) return c.json({ ok: true });

    const name = [d.first_name, d.last_name].filter(Boolean).join(' ') || null;
    const db = c.get('db')!;
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.id, d.id));
    if (existing) {
      await db
        .update(users)
        .set({
          email: primary.email_address,
          name,
          imageUrl: d.image_url ?? null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, d.id));
    } else {
      await db.insert(users).values({
        id: d.id,
        email: primary.email_address,
        name,
        imageUrl: d.image_url ?? null,
      });
    }

    return c.json({ ok: true });
  }
);
