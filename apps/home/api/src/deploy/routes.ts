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
import { and, eq, inArray } from 'drizzle-orm';
import { deployInstances } from '../db/schema';
import {
  provisionInstance,
  canSignR2,
  destroyInstance,
  emptyBucket,
  listAccounts,
  listZones,
  updateNeedsCatalogToken,
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
  const [cookieNonce, verifier, cookieInstance] = cookie.split('.');
  deleteCookie(c, OAUTH_COOKIE, { path: '/' });
  // The instance id is bound to the cookie, not just carried in `state`:
  // otherwise a crafted start URL could land a victim's completed sign-in on
  // a session row chosen by someone else.
  if (
    !code ||
    !instanceId ||
    !nonce ||
    nonce !== cookieNonce ||
    !verifier ||
    instanceId !== cookieInstance
  ) {
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
  // Optional: a re-provision of a healthy instance never reads it (see
  // /preflight). Provisioning still refuses to run without one when the sink
  // or the query secret actually has to be created.
  catalogToken: tokenSchema.optional(),
  accountId: z.string().regex(/^[a-f0-9]{32}$/),
  instanceName: z.string().regex(/^[a-z][a-z0-9-]{2,20}$/, 'lowercase letters, digits, and dashes'),
  // Optional: deploy onto one of the account's own domains. Hostnames are
  // derived server-side from zone + subdomain so they can't point elsewhere.
  customDomain: z
    .object({
      zoneId: z.string().regex(/^[a-f0-9]{32}$/),
      zoneName: z
        .string()
        .max(253)
        .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i),
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

/**
 * Authorize a provision/destroy call against a registry row.
 *
 * Instance ids are not secrets (a deployed instance can surface its own id),
 * so possession of an id must never be sufficient. Two checks:
 *  1. the supplied token really can act on the claimed account, and
 *  2. a row already bound to an account/instance can only be driven by that
 *     same pair — otherwise anyone could repoint or retire someone else's row.
 */
async function authorizeRow(
  row: { accountId: string | null; instanceName: string | null; status: string },
  apiToken: string,
  accountId: string,
  instanceName: string
): Promise<string | null> {
  let accounts: { id: string }[];
  try {
    accounts = await listAccounts(apiToken);
  } catch {
    return 'Could not verify the token against Cloudflare';
  }
  if (!accounts.some(a => a.id === accountId)) {
    return 'This token cannot act on the selected Cloudflare account';
  }
  if (row.accountId && row.accountId !== accountId) {
    return 'This deploy session belongs to a different Cloudflare account';
  }
  if (row.instanceName && row.instanceName !== instanceName) {
    return 'This deploy session belongs to a different instance';
  }
  return null;
}

const clientIp = (c: Context): string =>
  c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';

/** Apply an IP-scoped limiter; returns a 429 response when exhausted. */
async function limited(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  limiter: { limit(o: { key: string }): Promise<{ success: boolean }> } | undefined
): Promise<Response | null> {
  if (!limiter) return null; // binding absent (local dev)
  const { success } = await limiter.limit({ key: clientIp(c) });
  return success ? null : c.json({ error: 'Too many requests — try again shortly' }, 429);
}

export const deployRoute = app
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
    setCookie(c, OAUTH_COOKIE, `${nonce}.${verifier}.${instanceId}`, {
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
    const capped = await limited(c, c.env.SESSION_LIMIT);
    if (capped) return capped;
    const db = c.get('db')!;
    const [row] = await db.insert(deployInstances).values({}).returning();
    return c.json({ data: { id: row.id, status: row.status } });
  })

  // Resume state for a returning ?instance= visitor.
  // Resume state for a returning ?instance= visitor. Deliberately projected:
  // the account id is never echoed, and step details (raw upstream error text)
  // are truncated, since an instance id is not a secret.
  .get('/instance/:id', async c => {
    const db = c.get('db')!;
    const [row] = await db
      .select({
        status: deployInstances.status,
        instanceName: deployInstances.instanceName,
        apiUrl: deployInstances.apiUrl,
        collectUrl: deployInstances.collectUrl,
        deployedVersion: deployInstances.deployedVersion,
        customDomain: deployInstances.customDomain,
        steps: deployInstances.steps,
        error: deployInstances.error,
        updatedAt: deployInstances.updatedAt,
      })
      .from(deployInstances)
      .where(eq(deployInstances.id, c.req.param('id')));
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json({
      data: {
        ...row,
        error: row.error ? row.error.slice(0, 300) : row.error,
        steps: (row.steps ?? []).map(st => ({
          ...st,
          detail: st.detail ? st.detail.slice(0, 300) : st.detail,
        })),
      },
    });
  })

  // List the accounts the supplied installer token can act on. Token is
  // used for this one upstream call and discarded.
  .post(
    '/instance/:id/accounts',
    zValidator('json', z.object({ apiToken: tokenSchema })),
    async c => {
      const capped = await limited(c, c.env.VERIFY_LIMIT);
      if (capped) return capped;
      const db = c.get('db')!;
      const [session] = await db
        .select({ id: deployInstances.id })
        .from(deployInstances)
        .where(eq(deployInstances.id, c.req.param('id')));
      if (!session) return c.json({ error: 'Not found' }, 404);
      try {
        const token = c.req.valid('json').apiToken;
        const accounts = await listAccounts(token);
        if (accounts.length === 0) {
          return c.json({ error: 'This token cannot access any Cloudflare account' }, 400);
        }
        // Existing installs in these accounts (proving account access via the
        // token is the authorization) — lets the wizard steer returning users
        // into the update path instead of an accidental second instance.
        const db = c.get('db')!;
        const rows = await db
          .select({
            id: deployInstances.id,
            accountId: deployInstances.accountId,
            instanceName: deployInstances.instanceName,
            apiUrl: deployInstances.apiUrl,
            deployedVersion: deployInstances.deployedVersion,
            customDomain: deployInstances.customDomain,
            updatedAt: deployInstances.updatedAt,
          })
          .from(deployInstances)
          .where(
            and(
              eq(deployInstances.status, 'ready'),
              inArray(
                deployInstances.accountId,
                accounts.map(a => a.id)
              )
            )
          );
        // One entry per account+instance, newest session wins (updates create
        // a fresh session row for the same instance).
        const byInstance = new Map<string, (typeof rows)[number]>();
        for (const r of rows) {
          const key = `${r.accountId}/${r.instanceName}`;
          const prev = byInstance.get(key);
          if (!prev || (r.updatedAt ?? 0) > (prev.updatedAt ?? 0)) byInstance.set(key, r);
        }
        // OAuth sign-ins can also tell us who this is — the instance's owner
        // account gets pinned to this email at deploy time.
        return c.json({
          data: accounts,
          email: await userEmail(token),
          installs: [...byInstance.values()],
        });
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
      const capped = await limited(c, c.env.VERIFY_LIMIT);
      if (capped) return capped;
      const db = c.get('db')!;
      const [session] = await db
        .select({ id: deployInstances.id })
        .from(deployInstances)
        .where(eq(deployInstances.id, c.req.param('id')));
      if (!session) return c.json({ error: 'Not found' }, 404);
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
      const capped = await limited(c, c.env.VERIFY_LIMIT);
      if (capped) return capped;
      const db = c.get('db')!;
      const [session] = await db
        .select({ id: deployInstances.id })
        .from(deployInstances)
        .where(eq(deployInstances.id, c.req.param('id')));
      if (!session) return c.json({ error: 'Not found' }, 404);
      const { catalogToken, accountId } = c.req.valid('json');
      const result = await verifyCatalogToken(accountId, catalogToken);
      return c.json({ data: result }, result.ok ? 200 : 400);
    }
  )

  /**
   * What this operation still needs from the operator, asked before the
   * wizard renders its form.
   *
   * Updating a healthy instance consumes no catalog token at all — the sink
   * step short-circuits on an existing sink and the R2_SQL_TOKEN secret is
   * already in place — so the wizard should not send anyone to the Cloudflare
   * dashboard to mint one. Destroying, by contrast, needs a token that can
   * sign S3 requests, because R2 will not delete a bucket with objects in it
   * and only the S3 API can remove them.
   */
  .post(
    '/instance/:id/preflight',
    zValidator(
      'json',
      z.object({
        apiToken: tokenSchema,
        accountId: z.string().regex(/^[a-f0-9]{32}$/),
        instanceName: z.string().regex(/^[a-z][a-z0-9-]{2,20}$/),
        intent: z.enum(['update', 'destroy']),
      })
    ),
    async c => {
      const capped = await limited(c, c.env.VERIFY_LIMIT);
      if (capped) return capped;
      const db = c.get('db')!;
      const id = c.req.param('id');
      const [row] = await db.select().from(deployInstances).where(eq(deployInstances.id, id));
      if (!row) return c.json({ error: 'Not found' }, 404);
      const { apiToken, accountId, instanceName, intent } = c.req.valid('json');
      const denied = await authorizeRow(row, apiToken, accountId, instanceName);
      if (denied) return c.json({ error: denied }, 403);

      if (intent === 'destroy') {
        // A pasted API token signs S3 itself; an OAuth access token cannot.
        const canPurge = await canSignR2(accountId, apiToken);
        return c.json({
          data: {
            catalogTokenNeeded: !canPurge,
            reason: canPurge
              ? null
              : 'Removing your stored analytics needs a Cloudflare API token — the sign-in alone cannot delete R2 objects.',
          },
        });
      }

      const { needed, reason } = await updateNeedsCatalogToken(accountId, apiToken, instanceName);
      return c.json({ data: { catalogTokenNeeded: needed, reason } });
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
    // mid-run, worker died) be retaken — provisioning is idempotent. The window
    // must exceed the longest silent step: the smoke probe can wait ~5 min on
    // DNS + certificate issuance without emitting anything.
    const staleMs = 7 * 60_000;
    if (
      row.status === 'deploying' &&
      row.updatedAt &&
      Date.now() - new Date(row.updatedAt).getTime() < staleMs
    ) {
      return c.json({ error: 'Deploy already running' }, 409);
    }

    const { apiToken, catalogToken, accountId, instanceName, customDomain } = c.req.valid('json');
    // Credentials are checked before any artifact read or registry write, so a
    // junk-token request costs one upstream call instead of R2 + D1 + a run.
    const denied = await authorizeRow(row, apiToken, accountId, instanceName);
    if (denied) return c.json({ error: denied }, 403);

    // Without a token, confirm the run genuinely does not need one. First
    // installs always do; updates only when the sink or the query secret has
    // to be created. Checked here as well as in the wizard so the API is
    // safe to call directly.
    if (!catalogToken) {
      const { needed, reason } = await updateNeedsCatalogToken(accountId, apiToken, instanceName);
      if (needed) {
        return c.json(
          { error: `${reason ?? 'This deploy needs a catalog token.'} Add one and try again.` },
          400
        );
      }
    }
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
              // Empty only on the verified-unnecessary path above, where no
              // step reads it.
              catalogToken: catalogToken ?? '',
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
            await persist('ready', {
              apiUrl: result.apiUrl,
              collectUrl: result.collectUrl,
              deployedVersion: artifacts.version ?? null,
            });
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
  })

  // Tear down an instance, streaming step events as SSE. Idempotent — every
  // delete tolerates already-gone resources. The confirmation name is checked
  // server-side too; tokens are used for this run only and never stored.
  .post(
    '/instance/:id/destroy',
    zValidator(
      'json',
      z.object({
        apiToken: tokenSchema,
        // Only needed for OAuth sign-ins: pasted installer tokens carry R2
        // storage write themselves, but OAuth access tokens can't derive S3
        // credentials for the bucket purge.
        catalogToken: tokenSchema.optional(),
        accountId: z.string().regex(/^[a-f0-9]{32}$/),
        instanceName: z.string().regex(/^[a-z][a-z0-9-]{2,20}$/),
        confirmName: z.string().max(64),
      })
    ),
    async c => {
      const db = c.get('db')!;
      const id = c.req.param('id');
      const [row] = await db.select().from(deployInstances).where(eq(deployInstances.id, id));
      if (!row) return c.json({ error: 'Not found' }, 404);
      const { apiToken, catalogToken, accountId, instanceName, confirmName } = c.req.valid('json');
      if (confirmName !== instanceName) {
        return c.json({ error: 'Confirmation does not match the instance name' }, 400);
      }
      const denied = await authorizeRow(row, apiToken, accountId, instanceName);
      if (denied) return c.json({ error: denied }, 403);

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
              clientGone = true;
            }
          };

          const run = async (): Promise<void> => {
            try {
              const outcome = await destroyInstance({
                apiToken,
                accountId,
                instance: instanceName,
                emptyBucket: async bucket => {
                  await emptyBucket(accountId, catalogToken ?? apiToken, bucket);
                },
                emit: async e => {
                  steps.push(e);
                  send({ type: 'step', ...e });
                  await db
                    .update(deployInstances)
                    .set({ steps, updatedAt: new Date() })
                    .where(eq(deployInstances.id, id))
                    .catch(() => undefined);
                },
              });
              // Retire every session that points at this instance so the
              // wizard stops offering it as an existing install.
              await db
                .update(deployInstances)
                .set({ status: 'destroyed', updatedAt: new Date() })
                .where(
                  and(
                    eq(deployInstances.accountId, accountId),
                    eq(deployInstances.instanceName, instanceName)
                  )
                );
              await db
                .update(deployInstances)
                .set({ status: 'destroyed', steps, error: null, updatedAt: new Date() })
                .where(eq(deployInstances.id, id));
              // Say plainly when the data bucket outlived the teardown —
              // it keeps costing R2 storage until someone removes it.
              send({
                type: 'done',
                retainedBucket: outcome.retainedBucket,
                retainedReason: outcome.retainedReason,
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : 'destroy failed';
              await db
                .update(deployInstances)
                .set({ error: message, steps, updatedAt: new Date() })
                .where(eq(deployInstances.id, id))
                .catch(() => undefined);
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
    }
  );
