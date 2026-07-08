import type { Bindings } from '../types';

/**
 * Minimal Dodo Payments client (raw fetch — the API is bearer-token JSON).
 * Base URL comes from DODO_API_BASE: https://test.dodopayments.com for test
 * mode, https://live.dodopayments.com for live.
 */

interface CheckoutSession {
  session_id: string;
  checkout_url: string;
}

export async function createCheckoutSession(
  env: Bindings,
  opts: { productId: string; email: string; name?: string; userId: string; returnUrl: string }
): Promise<CheckoutSession> {
  const res = await fetch(`${env.DODO_API_BASE}/checkouts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.DODO_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      product_cart: [{ product_id: opts.productId, quantity: 1 }],
      customer: { email: opts.email, name: opts.name || opts.email },
      metadata: { user_id: opts.userId },
      return_url: opts.returnUrl,
    }),
  });
  if (!res.ok) {
    throw new Error(`Dodo checkout failed: HTTP ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as CheckoutSession;
}

export async function createPortalSession(
  env: Bindings,
  customerId: string,
  returnUrl: string
): Promise<string> {
  const url = new URL(`${env.DODO_API_BASE}/customers/${customerId}/customer-portal/session`);
  url.searchParams.set('return_url', returnUrl);
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.DODO_API_KEY}` },
  });
  if (!res.ok) {
    throw new Error(`Dodo portal session failed: HTTP ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { link: string };
  return body.link;
}

/**
 * Standard Webhooks (svix-style) signature verification, as used by Dodo
 * (and Clerk). Signed content is `${id}.${timestamp}.${body}`, HMAC-SHA256
 * with the base64-decoded endpoint secret (whsec_ prefix stripped),
 * base64-encoded, matched against any `v1,<sig>` entry in the header.
 */
export async function verifyStandardWebhook(
  secret: string,
  headers: { id: string | undefined; timestamp: string | undefined; signature: string | undefined },
  body: string,
  toleranceSeconds = 300
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) return false;

  const secretB64 = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const keyBytes = Uint8Array.from(atob(secretB64), ch => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`)
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  return signature
    .split(' ')
    .map(part => (part.includes(',') ? part.split(',')[1] : part))
    .some(sig => sig === expected);
}
