import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { PLANS, planOf, type PlanId } from '@traks/shared';
import { requireAuth } from '../middleware/auth';
import { users } from '../db/schema';
import { createCheckoutSession, createPortalSession, verifyStandardWebhook } from '../lib/dodo';
import type { Bindings, Variables } from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const checkoutSchema = z.object({ plan: z.enum(['pro', 'business']) });
const prefsSchema = z.object({ weeklyReport: z.boolean() });

function productIdFor(env: Bindings, plan: 'pro' | 'business'): string {
  return plan === 'pro' ? env.DODO_PRODUCT_PRO : env.DODO_PRODUCT_BUSINESS;
}

function planForProduct(env: Bindings, productId: string): PlanId | null {
  if (productId === env.DODO_PRODUCT_PRO) return 'pro';
  if (productId === env.DODO_PRODUCT_BUSINESS) return 'business';
  return null;
}

interface DodoSubscriptionEvent {
  type: string;
  data: {
    payload_type?: string;
    subscription_id?: string;
    product_id?: string;
    status?: string;
    customer?: { customer_id?: string; email?: string };
    metadata?: Record<string, string>;
  };
}

export const billingRoute = app
  // Current plan + limits + prefs for the settings page
  .get('/me', requireAuth, async c => {
    const userId = c.get('userId')!;
    const db = c.get('db')!;
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    const plan = planOf(user?.plan);
    return c.json({
      data: {
        plan: plan.id,
        plans: PLANS,
        weeklyReport: user?.weeklyReport ?? true,
        hasBillingAccount: Boolean(user?.dodoCustomerId),
        email: user?.email ?? '',
      },
    });
  })

  .post('/preferences', requireAuth, zValidator('json', prefsSchema), async c => {
    const userId = c.get('userId')!;
    const { weeklyReport } = c.req.valid('json');
    const db = c.get('db')!;
    await db.update(users).set({ weeklyReport, updatedAt: new Date() }).where(eq(users.id, userId));
    return c.json({ data: { weeklyReport } });
  })

  // Start a subscription checkout; responds with the hosted checkout URL
  .post('/checkout', requireAuth, zValidator('json', checkoutSchema), async c => {
    const userId = c.get('userId')!;
    const { plan } = c.req.valid('json');
    const db = c.get('db')!;

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return c.json({ error: 'Not found' }, 404);

    try {
      const session = await createCheckoutSession(c.env, {
        productId: productIdFor(c.env, plan),
        email: user.email,
        name: user.name ?? undefined,
        userId,
        returnUrl: `${c.env.APP_URL}/portal/settings?checkout=success`,
      });
      return c.json({ data: { url: session.checkout_url } });
    } catch (err) {
      console.error('[billing] checkout failed:', err);
      return c.json({ error: 'Could not start checkout' }, 502);
    }
  })

  // Hosted customer portal (manage/cancel subscription)
  .post('/portal', requireAuth, async c => {
    const userId = c.get('userId')!;
    const db = c.get('db')!;
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user?.dodoCustomerId) return c.json({ error: 'No billing account yet' }, 404);

    try {
      const link = await createPortalSession(
        c.env,
        user.dodoCustomerId,
        `${c.env.APP_URL}/portal/settings`
      );
      return c.json({ data: { url: link } });
    } catch (err) {
      console.error('[billing] portal failed:', err);
      return c.json({ error: 'Could not open billing portal' }, 502);
    }
  });

/**
 * Dodo webhook (mounted at /api/webhooks/dodo, outside the RPC chain).
 * Standard Webhooks signature over the raw body; plan changes keyed on
 * metadata.user_id (set at checkout), falling back to customer email.
 */
export const dodoWebhookRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>().post(
  '/',
  async c => {
    const body = await c.req.text();
    const ok = await verifyStandardWebhook(
      c.env.DODO_WEBHOOK_SECRET,
      {
        id: c.req.header('webhook-id'),
        timestamp: c.req.header('webhook-timestamp'),
        signature: c.req.header('webhook-signature'),
      },
      body
    );
    if (!ok) return c.json({ error: 'invalid signature' }, 401);

    const event = JSON.parse(body) as DodoSubscriptionEvent;
    const db = c.get('db')!;

    const userId = event.data.metadata?.user_id;
    const email = event.data.customer?.email;
    const findUser = async () => {
      if (userId) {
        const [u] = await db.select().from(users).where(eq(users.id, userId));
        if (u) return u;
      }
      if (email) {
        const [u] = await db.select().from(users).where(eq(users.email, email));
        if (u) return u;
      }
      return null;
    };

    switch (event.type) {
      case 'subscription.active':
      case 'subscription.renewed':
      case 'subscription.plan_changed': {
        const plan = event.data.product_id ? planForProduct(c.env, event.data.product_id) : null;
        const user = await findUser();
        if (!user || !plan) {
          console.warn(`[billing] webhook ${event.type}: unmatched user/product`, {
            userId,
            email,
            productId: event.data.product_id,
          });
          break;
        }
        await db
          .update(users)
          .set({
            plan,
            dodoCustomerId: event.data.customer?.customer_id ?? user.dodoCustomerId,
            dodoSubscriptionId: event.data.subscription_id ?? user.dodoSubscriptionId,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));
        break;
      }
      case 'subscription.cancelled':
      case 'subscription.expired':
      case 'subscription.failed': {
        const user = await findUser();
        if (!user) break;
        await db
          .update(users)
          .set({ plan: 'free', dodoSubscriptionId: null, updatedAt: new Date() })
          .where(eq(users.id, user.id));
        break;
      }
      default:
        // payment.* and subscription.on_hold are informational for now.
        break;
    }

    return c.json({ ok: true });
  }
);
