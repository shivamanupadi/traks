/**
 * Web-installer API (public, unauthenticated — it acts on the CALLER'S
 * Cloudflare account using tokens they supply per request; tokens are never
 * stored, logged, or echoed). Powers the traks.dev/deploy wizard.
 *
 * State model mirrors the Cloudflare OS hosted deploy: a registry row per
 * wizard session (?instance=<id> in the URL), holding only non-sensitive
 * resume state — status, chosen names, step log, final URLs.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { deployInstances } from '../db/schema';
import {
  provisionInstance,
  listAccounts,
  verifyCatalogToken,
  type DeployArtifacts,
  type StepEvent,
} from '../lib/deploy-engine';
import type { Bindings, Variables } from '../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const tokenSchema = z.string().min(20).max(300);
const startSchema = z.object({
  apiToken: tokenSchema,
  catalogToken: tokenSchema,
  accountId: z.string().regex(/^[a-f0-9]{32}$/),
  instanceName: z.string().regex(/^[a-z][a-z0-9-]{2,20}$/, 'lowercase letters, digits, and dashes'),
});

async function loadArtifacts(releases: R2Bucket): Promise<DeployArtifacts> {
  const manifestObj = await releases.get('current/manifest.json');
  if (!manifestObj) throw new Error('release artifacts missing — run upload-release');
  const manifest = (await manifestObj.json()) as {
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
  };
}

export const deployRoute = app
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
        const accounts = await listAccounts(c.req.valid('json').apiToken);
        if (accounts.length === 0) {
          return c.json({ error: 'This token cannot access any Cloudflare account' }, 400);
        }
        return c.json({ data: accounts });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'token check failed';
        return c.json({ error: message }, 400);
      }
    }
  )

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

    const { apiToken, catalogToken, accountId, instanceName } = c.req.valid('json');
    const artifacts = await loadArtifacts(c.env.RELEASES);

    const steps: StepEvent[] = [];
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start: controller => {
        const send = (payload: unknown): void =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

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
          await persist('deploying', { error: null, apiUrl: null, collectUrl: null });
          try {
            const result = await provisionInstance({
              apiToken,
              accountId,
              instance: instanceName,
              catalogToken,
              artifacts,
              randomHex: n =>
                [...crypto.getRandomValues(new Uint8Array(n))]
                  .map(b => b.toString(16).padStart(2, '0'))
                  .join(''),
              emit: e => {
                steps.push(e);
                send({ type: 'step', ...e });
              },
            });
            await persist('ready', { apiUrl: result.apiUrl, collectUrl: result.collectUrl });
            send({ type: 'done', ...result });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'deploy failed';
            await persist('failed', { error: message });
            send({ type: 'error', message });
          } finally {
            controller.close();
          }
        };
        void run();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  });
