import { drizzle } from 'drizzle-orm/d1';
import { getAllActiveSites } from './db';
import { archiveSiteDay } from './archiver';
import type { QueryConfig } from '@traks/shared';
import type { ArchiveMessage } from './types';

export interface Env {
  DB: D1Database;
  ARCHIVE_BUCKET: R2Bucket;
  ARCHIVE_QUEUE?: Queue<ArchiveMessage>;
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  ENVIRONMENT: string;
}

function getYesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default {
  // Producer: enqueue yesterday's archive for all active sites
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const yesterday = getYesterday();
    const db = drizzle(env.DB);

    console.log(`[archive] Producer starting, archiving ${yesterday}`);

    const sites = await getAllActiveSites(db);
    if (sites.length === 0) {
      console.log('[archive] No active sites found, skipping');
      return;
    }

    console.log(`[archive] Found ${sites.length} active site(s)`);

    const messages = sites.map(site => ({
      body: { siteId: site.id, siteKey: site.key, domain: site.domain, date: yesterday },
    }));

    // If queue is available (deployed), enqueue messages
    if (env.ARCHIVE_QUEUE) {
      for (let i = 0; i < messages.length; i += 25) {
        await env.ARCHIVE_QUEUE.sendBatch(messages.slice(i, i + 25));
      }
      console.log(`[archive] Enqueued ${messages.length} archive message(s)`);
    } else {
      // Local dev fallback: process directly
      console.log(`[archive] No queue available, processing ${messages.length} message(s) directly`);
      const config: QueryConfig = {
        accountId: env.CF_ACCOUNT_ID,
        apiToken: env.CF_API_TOKEN,
        dataset: env.ENVIRONMENT === 'production' ? '"traks"' : '"traks-dev"',
      };
      for (const msg of messages) {
        const { siteId, siteKey, domain, date } = msg.body;
        try {
          await archiveSiteDay(db, env.ARCHIVE_BUCKET, config, { id: siteId, domain, key: siteKey }, date);
          console.log(`[archive] Completed ${siteId} for ${date}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[archive] Failed ${siteId} for ${date}: ${message}`);
        }
      }
    }
  },

  // Consumer: process one archive message at a time (max_batch_size=1)
  async queue(batch: MessageBatch<ArchiveMessage>, env: Env): Promise<void> {
    const db = drizzle(env.DB);
    const config: QueryConfig = {
      accountId: env.CF_ACCOUNT_ID,
      apiToken: env.CF_API_TOKEN,
      dataset: env.ENVIRONMENT === 'production' ? '"traks"' : '"traks-dev"',
    };

    for (const msg of batch.messages) {
      const { siteId, siteKey, domain, date } = msg.body;
      const site = { id: siteId, domain, key: siteKey };

      try {
        await archiveSiteDay(db, env.ARCHIVE_BUCKET, config, site, date);
        msg.ack();
        console.log(`[archive] Completed ${siteId} for ${date}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[archive] Failed ${siteId} for ${date}: ${message}`);
        msg.retry();
      }
    }
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Manual trigger for testing (dev only)
    if (url.pathname === '/trigger' && env.ENVIRONMENT === 'development') {
      ctx.waitUntil(this.scheduled({} as ScheduledEvent, env, ctx));
      return new Response(JSON.stringify({ status: 'triggered' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not found', { status: 404 });
  },
};
