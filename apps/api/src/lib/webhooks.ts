/**
 * Standard Webhooks (svix-style) signature verification, as used by Clerk.
 * Signed content is `${id}.${timestamp}.${body}`, HMAC-SHA256 with the
 * base64-decoded endpoint secret (whsec_ prefix stripped), base64-encoded,
 * matched against any `v1,<sig>` entry in the header.
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
