/**
 * Web-installer API (public, unauthenticated - it acts on the CALLER'S
 * Cloudflare account using tokens they supply per request; tokens are never
 * stored, logged, or echoed). Powers the traks.dev/deploy wizard.
 *
 * State model: no database. A wizard session (?instance=<id> in the URL) is a
 * Durable Object that holds only non-sensitive resume state - status, the
 * names it was bound to, the step log, final URLs - and wipes itself a day
 * after its first write. Instances are discovered live from the user's own
 * Cloudflare account (see discover.ts), never remembered.
 */
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { discoverInstances } from './discover';
import type { SessionState } from './session';
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

/** A live run touches its session at least this often (SSE ping + updatedAt). */
const HEARTBEAT_MS = 20_000;
/** A 'deploying' session quieter than this is dead and may be retaken. Mirrors
 *  RUN_STALE_MS in the wizard UI. */
const RUN_STALE_MS = 3 * 60_000;
const SESSION_ID = /^[a-zA-Z0-9-]{8,64}$/;

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;

/** The session object for a wizard visit (progress replay). */
const sessionOf = (c: Ctx, id: string) =>
  c.env.SESSIONS.get(c.env.SESSIONS.idFromName(`session:${id}`));
/** The run lock for one instance: two tabs cannot provision it at once. */
const lockOf = (c: Ctx, accountId: string, instanceName: string) =>
  c.env.SESSIONS.get(c.env.SESSIONS.idFromName(`lock:${accountId}/${instanceName}`));

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

/** Top-level GET /deploy/callback (registered redirect URI - outside /api). */
export async function oauthCallback(
  c: Context<{ Bindings: Bindings; Variables: Variables }>
): Promise<Response> {
  const url = new URL(c.req.url);
  const state = url.searchParams.get('state') ?? '';
  const [instanceId, nonce] = state.split('.');
  const cookie = getCookie(c, OAUTH_COOKIE) ?? '';
  const [cookieNonce, verifier, cookieInstance, cookieFlow] = cookie.split('.');
  // The registered redirect URI is fixed at /deploy/callback, but each flow
  // has its own page now - return to whichever one started the sign-in.
  // Server-set cookie only; a missing/old cookie falls back to /deploy.
  const flow = cookieFlow === 'update' || cookieFlow === 'destroy' ? cookieFlow : 'deploy';
  const back = (params: string): Response =>
    c.redirect(`/${flow}?instance=${encodeURIComponent(instanceId ?? '')}${params}`);

  const denied = url.searchParams.get('error');
  if (denied) return back(`&oauth_error=${encodeURIComponent(denied)}`);

  const code = url.searchParams.get('code');
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
  if (!manifestObj) throw new Error('release artifacts missing. Run upload-release');
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
 * Authorize a provision/destroy call against a session.
 *
 * Session ids are not secrets, so possession of one must never be
 * sufficient. Two checks:
 *  1. the supplied token really can act on the claimed account, and
 *  2. a session already bound to an account/instance can only be driven by
 *     that same pair - otherwise anyone could repoint someone else's session.
 */
async function authorizeSession(
  session: Pick<SessionState, 'accountId' | 'instanceName'> | null,
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
  if (session?.accountId && session.accountId !== accountId) {
    return 'This deploy session belongs to a different Cloudflare account';
  }
  if (session?.instanceName && session.instanceName !== instanceName) {
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
  return success ? null : c.json({ error: 'Too many requests. Try again shortly' }, 429);
}

export const deployRoute = app
  // Kick off "Sign in with Cloudflare": stash nonce + PKCE verifier in a
  // short-lived cookie and bounce to the dashboard consent screen.
  .get('/oauth/start', async c => {
    if (!c.env.CF_OAUTH_CLIENT_ID) return c.json({ error: 'OAuth not configured' }, 404);
    const instanceId = c.req.query('instance');
    if (!instanceId || !SESSION_ID.test(instanceId)) {
      return c.json({ error: 'instance required' }, 400);
    }
    // Which wizard page started this sign-in - the callback returns there.
    const flowParam = c.req.query('flow');
    const flow = flowParam === 'update' || flowParam === 'destroy' ? flowParam : 'deploy';
    const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    );
    setCookie(c, OAUTH_COOKIE, `${nonce}.${verifier}.${instanceId}.${flow}`, {
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

  // Create a wizard session: just an id. Its Durable Object is created on
  // first write (a run), so an abandoned visit leaves nothing behind at all.
  .post('/instance', async c => {
    const capped = await limited(c, c.env.SESSION_LIMIT);
    if (capped) return capped;
    return c.json({ data: { id: crypto.randomUUID(), status: 'new' } });
  })

  // Resume state for a returning ?instance= visitor. Deliberately projected:
  // the account id is never echoed, and step details (raw upstream error text)
  // are truncated, since a session id is not a secret. An id with no state
  // (never ran, or wiped) is simply a fresh session.
  .get('/instance/:id', async c => {
    const id = c.req.param('id');
    if (!SESSION_ID.test(id)) return c.json({ error: 'Not found' }, 404);
    const state = await sessionOf(c, id).get();
    if (!state) return c.json({ data: { status: 'new' } });
    return c.json({
      data: {
        status: state.status,
        instanceName: state.instanceName,
        apiUrl: state.apiUrl,
        collectUrl: state.collectUrl,
        deployedVersion: state.deployedVersion,
        customDomain: state.customDomain,
        error: state.error ? state.error.slice(0, 300) : state.error,
        steps: (state.steps ?? []).map(st => ({
          ...st,
          detail: st.detail ? st.detail.slice(0, 300) : st.detail,
        })),
        updatedAt: new Date(state.updatedAt).toISOString(),
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
      try {
        const token = c.req.valid('json').apiToken;
        const accounts = await listAccounts(token);
        if (accounts.length === 0) {
          return c.json({ error: 'This token cannot access any Cloudflare account' }, 400);
        }
        // Existing installs, discovered live from the accounts themselves
        // (proving account access via the token is the authorization) - lets
        // the wizard steer returning users into the update path instead of an
        // accidental second instance. OAuth sign-ins can also tell us who this
        // is - the instance's owner account gets pinned to this email at
        // deploy time.
        const [installs, email] = await Promise.all([
          discoverInstances(token, accounts),
          userEmail(token),
        ]);
        return c.json({ data: accounts, email, installs });
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

  // Release notes for every published version, newest first. Written by
  // installer/upload-release.mjs from CHANGELOG.md; read by /update and
  // /changelog on traks.dev and, cross-origin, by instance dashboards.
  .get('/changelog', async c => {
    const obj = await c.env.RELEASES.get('current/changelog.json');
    if (!obj) return c.json({ error: 'No changelog published' }, 404);
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Cache-Control', 'public, max-age=300');
    return c.json({ data: await obj.json() });
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
      const { catalogToken, accountId } = c.req.valid('json');
      const result = await verifyCatalogToken(accountId, catalogToken);
      return c.json({ data: result }, result.ok ? 200 : 400);
    }
  )

  /**
   * What this operation still needs from the operator, asked before the
   * wizard renders its form.
   *
   * Updating a healthy instance consumes no catalog token at all - the sink
   * step short-circuits on an existing sink and the R2_SQL_TOKEN secret is
   * already in place - so the wizard should not send anyone to the Cloudflare
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
      const id = c.req.param('id');
      if (!SESSION_ID.test(id)) return c.json({ error: 'Not found' }, 404);
      const { apiToken, accountId, instanceName, intent } = c.req.valid('json');
      const denied = await authorizeSession(
        await sessionOf(c, id).get(),
        apiToken,
        accountId,
        instanceName
      );
      if (denied) return c.json({ error: denied }, 403);

      if (intent === 'destroy') {
        // A pasted API token signs S3 itself; an OAuth access token cannot.
        const canPurge = await canSignR2(accountId, apiToken);
        return c.json({
          data: {
            catalogTokenNeeded: !canPurge,
            reason: canPurge
              ? null
              : 'Removing your stored analytics needs a Cloudflare API token; the sign-in alone cannot delete R2 objects.',
          },
        });
      }

      const { needed, reason } = await updateNeedsCatalogToken(accountId, apiToken, instanceName);
      return c.json({ data: { catalogTokenNeeded: needed, reason } });
    }
  )

  // Run the deploy, streaming step events as SSE. Idempotent - a retry after
  // a failure resumes from existing resources.
  .post('/instance/:id/provision', zValidator('json', startSchema), async c => {
    const id = c.req.param('id');
    if (!SESSION_ID.test(id)) return c.json({ error: 'Not found' }, 404);
    const session = sessionOf(c, id);
    const state = await session.get();
    // Reject double-starts on this session, but let a stale 'deploying'
    // session (client vanished mid-run, worker died) be retaken -
    // provisioning is idempotent. A live run touches its session at least
    // every HEARTBEAT_MS, so anything quieter than RUN_STALE_MS is dead.
    if (state?.status === 'deploying' && Date.now() - state.updatedAt < RUN_STALE_MS) {
      return c.json({ error: 'Deploy already running' }, 409);
    }

    const { apiToken, catalogToken, accountId, instanceName, customDomain } = c.req.valid('json');
    // Credentials are checked before any artifact read or state write, so a
    // junk-token request costs one upstream call instead of R2 + a run.
    const denied = await authorizeSession(state, apiToken, accountId, instanceName);
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

    // Take the run atomically: two tabs (or a double-click) racing past the
    // read above must not both start provisioning the same instance. The
    // lock is a Durable Object keyed by account + instance, so the check is
    // strongly consistent across sessions.
    const lock = lockOf(c, accountId, instanceName);
    if (!(await lock.acquire(id, RUN_STALE_MS))) {
      return c.json({ error: 'Deploy already running' }, 409);
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
            // Tab refreshed or navigated away - keep provisioning; the row
            // keeps updating and the wizard reattaches by polling it.
            clientGone = true;
          }
        };

        const persist = async (
          status: 'deploying' | 'ready' | 'failed',
          extra: Partial<SessionState> = {}
        ): Promise<void> => {
          await session.update({ status, accountId, instanceName, steps, ...extra });
        };

        // Keep the connection and the session visibly alive through the long
        // quiet stretches (sink creation retries sleep 60 s; the smoke probe
        // can wait minutes on DNS/certs): an SSE comment defeats idle proxy
        // timeouts, and touching updatedAt keeps the wizard's stale-run
        // detection (and the lock's retake guard) honest. touch() only acts
        // while the state is 'deploying', so a late tick can never flip a
        // finished session back.
        const touch = (): Promise<unknown> => Promise.all([session.touch(), lock.touch()]);
        const heartbeat = setInterval(() => {
          if (!clientGone) {
            try {
              controller.enqueue(encoder.encode(': ping\n\n'));
            } catch {
              clientGone = true;
            }
          }
          touch().catch(() => undefined);
        }, HEARTBEAT_MS);

        const run = async (): Promise<void> => {
          await persist('deploying', { error: null, customDomain: customDomain ?? null });
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
            // The claim code is deliberately NOT persisted: it goes to the
            // user's browser over this stream only. A client that lost the
            // stream re-mints one by running Update.
            await persist('ready', {
              apiUrl: result.apiUrl,
              collectUrl: result.collectUrl,
              deployedVersion: artifacts.version,
            });
            await lock.release(id, 'ready');
            send({ type: 'done', ...result });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'deploy failed';
            // A failed UPDATE leaves the previously deployed worker running (a
            // rejected upload never replaces the live one); the session just
            // records the failure. What exists is rediscovered on the next
            // connect, so this status hides nothing.
            await persist('failed', { error: message });
            await lock.release(id, 'failed').catch(() => undefined);
            send({ type: 'error', message });
          } finally {
            clearInterval(heartbeat);
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
    // Keep the run alive past a client disconnect for as long as the runtime
    // allows - the session keeps updating and the wizard reattaches by
    // polling. (A dropped connection can still end the invocation; a retake
    // is then allowed once the session goes quiet for RUN_STALE_MS, and every
    // step is idempotent.)
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

  // Tear down an instance, streaming step events as SSE. Idempotent - every
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
      const id = c.req.param('id');
      if (!SESSION_ID.test(id)) return c.json({ error: 'Not found' }, 404);
      const session = sessionOf(c, id);
      const { apiToken, catalogToken, accountId, instanceName, confirmName } = c.req.valid('json');
      if (confirmName !== instanceName) {
        return c.json({ error: 'Confirmation does not match the instance name' }, 400);
      }
      const denied = await authorizeSession(await session.get(), apiToken, accountId, instanceName);
      if (denied) return c.json({ error: denied }, 403);
      const lock = lockOf(c, accountId, instanceName);
      if (!(await lock.acquire(id, RUN_STALE_MS))) {
        return c.json({ error: 'A run is already in progress for this instance' }, 409);
      }
      await session.update({
        status: 'deploying',
        accountId,
        instanceName,
        steps: [],
        error: null,
      });

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
                  await Promise.all([session.update({ steps }), lock.touch()]).catch(
                    () => undefined
                  );
                },
              });
              await session.update({ status: 'destroyed', steps, error: null });
              await lock.release(id, 'destroyed');
              // Say plainly when the data bucket outlived the teardown  -
              // it keeps costing R2 storage until someone removes it.
              send({
                type: 'done',
                retainedBucket: outcome.retainedBucket,
                retainedReason: outcome.retainedReason,
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : 'destroy failed';
              await session
                .update({ status: 'failed', error: message, steps })
                .catch(() => undefined);
              await lock.release(id, 'failed').catch(() => undefined);
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
