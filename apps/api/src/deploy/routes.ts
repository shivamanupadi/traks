/**
 * Web-installer API (public, unauthenticated — it acts on the CALLER'S
 * Cloudflare account using tokens they supply per request; tokens are never
 * stored, logged, or echoed). Powers the traks.dev/deploy wizard.
 *
 * State model mirrors the Cloudflare OS hosted deploy: a registry row per
 * wizard session (?instance=<id> in the URL), holding only non-sensitive
 * resume state — status, chosen names, step log, final URLs.
 */
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { deployInstances } from '../db/schema';
import {
  provisionInstance,
  listAccounts,
  listZones,
  userEmail,
  verifyCatalogToken,
  type CustomDomain,
  type DeployArtifacts,
  type StepEvent,
} from './engine';
import type { Bindings, Variables } from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/* ── "Sign in with Cloudflare" (self-managed OAuth client) ─────────────────
 * Endpoints from https://dash.cloudflare.com/.well-known/openid-configuration.
 * Authorization-code + PKCE; token exchange is client_secret_post. The state
 * nonce + PKCE verifier live in a short-lived HttpOnly cookie (nothing is
 * stored server-side), and the access token is handed to the SPA in the URL
 * fragment so it never transits back to our server.
 */
const CF_OAUTH_AUTH_URL = 'https://dash.cloudflare.com/oauth2/auth';
const CF_OAUTH_TOKEN_URL = 'https://dash.cloudflare.com/oauth2/token';
// Must exactly match the scopes registered on the OAuth client.
const CF_OAUTH_SCOPES = [
  'workers-scripts.write',
  'd1.write',
  'workers-kv-storage.write',
  'pipelines.write',
  'workers-r2.write',
  'r2-catalog.write',
  'r2-catalog-sql.read',
  'account-settings.read',
  'zone.read',
  'workers-routes.write',
  'user-details.read',
];
const OAUTH_COOKIE = 'traks_oauth';

const b64url = (bytes: ArrayBuffer | Uint8Array): string => {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

const redirectUri = (c: Context): string => `${new URL(c.req.url).origin}/deploy/callback`;

/** Top-level GET /deploy/callback (registered redirect URI — outside /api). */
export async function oauthCallback(
  c: Context<{ Bindings: Bindings; Variables: Variables }>
): Promise<Response> {
  const url = new URL(c.req.url);
  const state = url.searchParams.get('state') ?? '';
  const [instanceId, nonce] = state.split('.');
  const back = (params: string): Response =>
    c.redirect(`/deploy?instance=${encodeURIComponent(instanceId ?? '')}${params}`);

  const denied = url.searchParams.get('error');
  if (denied) return back(`&oauth_error=${encodeURIComponent(denied)}`);

  const code = url.searchParams.get('code');
  const cookie = getCookie(c, OAUTH_COOKIE) ?? '';
  const [cookieNonce, verifier] = cookie.split('.');
  deleteCookie(c, OAUTH_COOKIE, { path: '/' });
  if (!code || !instanceId || !nonce || nonce !== cookieNonce || !verifier) {
    return back('&oauth_error=state_mismatch');
  }

  const res = await fetch(CF_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(c),
      client_id: c.env.CF_OAUTH_CLIENT_ID ?? '',
      client_secret: c.env.CF_OAUTH_CLIENT_SECRET ?? '',
      code_verifier: verifier,
    }),
  });
  const data = (await res.json().catch(() => null)) as { access_token?: string } | null;
  if (!res.ok || !data?.access_token) return back('&oauth_error=exchange_failed');
  // Fragment, not query: the token stays in the browser and never reaches us.
  return back(`#cf_token=${encodeURIComponent(data.access_token)}`);
}

const tokenSchema = z.string().min(20).max(2048);
const startSchema = z.object({
  apiToken: tokenSchema,
  catalogToken: tokenSchema,
  accountId: z.string().regex(/^[a-f0-9]{32}$/),
  instanceName: z.string().regex(/^[a-z][a-z0-9-]{2,20}$/, 'lowercase letters, digits, and dashes'),
  // Optional: deploy onto one of the account's own domains. Hostnames are
  // derived server-side from zone + subdomain so they can't point elsewhere.
  customDomain: z
    .object({
      zoneId: z.string().regex(/^[a-f0-9]{32}$/),
      zoneName: z.string().regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i),
      subdomain: z
        .string()
        .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/)
        .or(z.literal('')),
    })
    .optional(),
});

function resolveCustomDomain(
  d: NonNullable<z.infer<typeof startSchema>['customDomain']>
): CustomDomain {
  const apiHostname = d.subdomain ? `${d.subdomain}.${d.zoneName}` : d.zoneName;
  const collectHostname = d.subdomain
    ? `${d.subdomain}-collect.${d.zoneName}`
    : `collect.${d.zoneName}`;
  return { zoneId: d.zoneId, apiHostname, collectHostname };
}

async function loadArtifacts(releases: R2Bucket): Promise<DeployArtifacts> {
  const manifestObj = await releases.get('current/manifest.json');
  if (!manifestObj) throw new Error('release artifacts missing — run upload-release');
  const manifest = (await manifestObj.json()) as {
    version?: string;
    assets: { path: string; hash: string; size: number; contentType: string | null }[];
    migrations: string[];
  };
  const bytes = async (key: string): Promise<Uint8Array> => {
    const obj = await releases.get(key);
    if (!obj) throw new Error(`release artifact missing: ${key}`);
    return new Uint8Array(await obj.arrayBuffer());
  };
  const text = async (key: string): Promise<string> => {
    const obj = await releases.get(key);
    if (!obj) throw new Error(`release artifact missing: ${key}`);
    return obj.text();
  };
  return {
    apiWorker: () => bytes('current/api-worker.js'),
    collectWorker: () => bytes('current/collect-worker.js'),
    webAssets: manifest.assets.map(a => ({
      ...a,
      getContent: () => bytes(`current/assets/${a.hash}`),
    })),
    migrations: manifest.migrations.map(name => ({
      name,
      getSql: () => text(`current/migrations/${name}`),
    })),
    schema: JSON.parse(await text('current/pipeline-schema.json')) as { fields: unknown[] },
    version: manifest.version,
  };
}

export const deployRoute = app
  // Hub-only guard: this router serves traks.dev. The identical bundle ships
  // inside every customer instance (one codebase), where the RELEASES binding
  // is absent — hard-404 everything there so user instances never act as
  // deploy backends (no registry writes, no token-verification oracle).
  .use('*', async (c, next) => {
    if (!c.env.RELEASES) return c.json({ error: 'Not found' }, 404);
    await next();
  })
  // Kick off "Sign in with Cloudflare": stash nonce + PKCE verifier in a
  // short-lived cookie and bounce to the dashboard consent screen.
  .get('/oauth/start', async c => {
    if (!c.env.CF_OAUTH_CLIENT_ID) return c.json({ error: 'OAuth not configured' }, 404);
    const instanceId = c.req.query('instance');
    if (!instanceId || !/^[a-zA-Z0-9-]{8,64}$/.test(instanceId)) {
      return c.json({ error: 'instance required' }, 400);
    }
    const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    );
    setCookie(c, OAUTH_COOKIE, `${nonce}.${verifier}`, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 600,
    });
    const auth = new URL(CF_OAUTH_AUTH_URL);
    auth.searchParams.set('response_type', 'code');
    auth.searchParams.set('client_id', c.env.CF_OAUTH_CLIENT_ID);
    auth.searchParams.set('redirect_uri', redirectUri(c));
    auth.searchParams.set('scope', CF_OAUTH_SCOPES.join(' '));
    auth.searchParams.set('state', `${instanceId}.${nonce}`);
    auth.searchParams.set('code_challenge', challenge);
    auth.searchParams.set('code_challenge_method', 'S256');
    return c.redirect(auth.toString());
  })

  // Create a wizard session.
  .post('/instance', async c => {
    const db = c.get('db')!;
    const [row] = await db.insert(deployInstances).values({}).returning();
    return c.json({ data: { id: row.id, status: row.status } });
  })

  // Resume state for a returning ?instance= visitor.
  .get('/instance/:id', async c => {
    const db = c.get('db')!;
    const [row] = await db
      .select()
      .from(deployInstances)
      .where(eq(deployInstances.id, c.req.param('id')));
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json({ data: row });
  })

  // List the accounts the supplied installer token can act on. Token is
  // used for this one upstream call and discarded.
  .post(
    '/instance/:id/accounts',
    zValidator('json', z.object({ apiToken: tokenSchema })),
    async c => {
      try {
        const token = c.req.valid('json').apiToken;
        const accounts = await listAccounts(token);
        if (accounts.length === 0) {
          return c.json({ error: 'This token cannot access any Cloudflare account' }, 400);
        }
        // OAuth sign-ins can also tell us who this is — the instance's owner
        // account gets pinned to this email at deploy time.
        return c.json({ data: accounts, email: await userEmail(token) });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'token check failed';
        return c.json({ error: message }, 400);
      }
    }
  )

  // List the chosen account's domains for the custom-domain picker. Token is
  // used for this one upstream call and discarded.
  .post(
    '/instance/:id/zones',
    zValidator(
      'json',
      z.object({ apiToken: tokenSchema, accountId: z.string().regex(/^[a-f0-9]{32}$/) })
    ),
    async c => {
      const { apiToken, accountId } = c.req.valid('json');
      try {
        return c.json({ data: await listZones(apiToken, accountId) });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'zone list failed';
        return c.json({ error: message }, 400);
      }
    }
  )

  // Latest published release, for update-available checks. CORS-open: user
  // instances' dashboards call this cross-origin from their own domains.
  .get('/latest-version', async c => {
    if (!c.env.RELEASES) return c.json({ error: 'Not found' }, 404);
    const obj = await c.env.RELEASES.get('current/manifest.json');
    if (!obj) return c.json({ error: 'No release published' }, 404);
    const manifest = (await obj.json()) as { version?: string; uploadedAt?: string };
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Cache-Control', 'public, max-age=300');
    return c.json({ data: { version: manifest.version, uploadedAt: manifest.uploadedAt } });
  })

  // Verify the catalog token against the chosen account.
  .post(
    '/instance/:id/verify-catalog',
    zValidator(
      'json',
      z.object({ catalogToken: tokenSchema, accountId: z.string().regex(/^[a-f0-9]{32}$/) })
    ),
    async c => {
      const { catalogToken, accountId } = c.req.valid('json');
      const result = await verifyCatalogToken(accountId, catalogToken);
      return c.json({ data: result }, result.ok ? 200 : 400);
    }
  )

  // Run the deploy, streaming step events as SSE. Idempotent — a retry after
  // a failure resumes from existing resources.
  .post('/instance/:id/provision', zValidator('json', startSchema), async c => {
    const db = c.get('db')!;
    const id = c.req.param('id');
    const [row] = await db.select().from(deployInstances).where(eq(deployInstances.id, id));
    if (!row) return c.json({ error: 'Not found' }, 404);
    // Reject double-starts, but let a stale 'deploying' row (client vanished
    // mid-run, worker died) be retaken after 90s — provisioning is idempotent.
    const staleMs = 90_000;
    if (
      row.status === 'deploying' &&
      row.updatedAt &&
      Date.now() - new Date(row.updatedAt).getTime() < staleMs
    ) {
      return c.json({ error: 'Deploy already running' }, 409);
    }

    const { apiToken, catalogToken, accountId, instanceName, customDomain } = c.req.valid('json');
    const artifacts = await loadArtifacts(c.env.RELEASES);

    const steps: StepEvent[] = [];
    const encoder = new TextEncoder();
    let runPromise: Promise<void> = Promise.resolve();
    const stream = new ReadableStream({
      start: controller => {
        let clientGone = false;
        const send = (payload: unknown): void => {
          if (clientGone) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          } catch {
            // Tab refreshed or navigated away — keep provisioning; the row
            // keeps updating and the wizard reattaches by polling it.
            clientGone = true;
          }
        };

        const persist = async (
          status: 'deploying' | 'ready' | 'failed',
          extra: Partial<typeof deployInstances.$inferInsert> = {}
        ): Promise<void> => {
          await db
            .update(deployInstances)
            .set({ status, accountId, instanceName, steps, updatedAt: new Date(), ...extra })
            .where(eq(deployInstances.id, id));
        };

        const run = async (): Promise<void> => {
          await persist('deploying', {
            error: null,
            apiUrl: null,
            collectUrl: null,
            customDomain: customDomain ?? null,
          });
          try {
            const result = await provisionInstance({
              apiToken,
              accountId,
              instance: instanceName,
              catalogToken,
              artifacts,
              customDomain: customDomain && resolveCustomDomain(customDomain),
              deploySessionId: id,
              randomHex: n =>
                [...crypto.getRandomValues(new Uint8Array(n))]
                  .map(b => b.toString(16).padStart(2, '0'))
                  .join(''),
              emit: async e => {
                steps.push(e);
                send({ type: 'step', ...e });
                // Persist per event so a refreshed client sees live progress.
                await persist('deploying').catch(() => undefined);
              },
            });
            await persist('ready', { apiUrl: result.apiUrl, collectUrl: result.collectUrl });
            send({ type: 'done', ...result });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'deploy failed';
            await persist('failed', { error: message });
            send({ type: 'error', message });
          } finally {
            try {
              controller.close();
            } catch {
              /* stream already cancelled by the client */
            }
          }
        };
        runPromise = run();
      },
    });
    // Survive client disconnects: a refresh mid-deploy no longer kills the
    // run — it finishes in the background and the wizard resumes by polling.
    try {
      c.executionCtx.waitUntil(runPromise);
    } catch {
      /* executionCtx unavailable (tests) */
    }

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  });
