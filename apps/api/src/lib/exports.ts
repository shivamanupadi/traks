import { drizzle } from 'drizzle-orm/d1';
import { eq, and, isNull } from 'drizzle-orm';
import { previousDayRange, type LiveStoreApi, type LiveExportRow } from '@traks/shared';
import { sites, apiKeys } from '../db/schema';
import type { Bindings } from '../types';

// The DO returns pages of up to 10k rows; ~50k events (~15MB NDJSON) per
// object keeps Worker memory comfortably bounded.
const PAGE_SIZE = 10_000;
const EVENTS_PER_FILE = 50_000;

function toNdjson(rows: LiveExportRow[]): string {
  return rows.map(r => JSON.stringify(r)).join('\n') + '\n';
}

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

/** `<siteId>/<dateKey>.ndjson.gz`, with `.N` suffixes for overflow parts. */
export function exportObjectKey(siteId: string, dateKey: string, part: number): string {
  return part === 0 ? `${siteId}/${dateKey}.ndjson.gz` : `${siteId}/${dateKey}.${part}.ndjson.gz`;
}

async function exportSiteDay(
  env: Bindings,
  site: { siteId: string; key: string; timezone: string }
): Promise<number> {
  const { fromMs, toMs, dateKey } = previousDayRange(new Date(), site.timezone);
  const live = env.LIVE.get(env.LIVE.idFromName(site.key)) as unknown as LiveStoreApi;

  let offset = 0;
  let part = 0;
  let total = 0;
  let buffer: LiveExportRow[] = [];

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return;
    await env.EXPORTS.put(
      exportObjectKey(site.siteId, dateKey, part),
      await gzip(toNdjson(buffer)),
      {
        httpMetadata: { contentType: 'application/gzip' },
      }
    );
    part += 1;
    buffer = [];
  };

  for (;;) {
    const rows = await live.exportEvents(fromMs, toMs, offset, PAGE_SIZE);
    buffer.push(...rows);
    total += rows.length;
    offset += rows.length;
    if (buffer.length >= EVENTS_PER_FILE) await flush();
    if (rows.length < PAGE_SIZE) break;
  }
  await flush();
  return total;
}

/**
 * Nightly cron: dump yesterday's raw events for every export-enabled site
 * into the EXPORTS bucket as gzipped NDJSON, readable directly by DuckDB via
 * the token download route. Reads come from each site's live DO (still well
 * within its ~50h retention at 03:30 UTC), so exports cost no R2 SQL scans.
 */
export async function runNightlyExports(env: Bindings): Promise<void> {
  const db = drizzle(env.DB);
  const exportSites = await db
    .select({ siteId: sites.id, key: apiKeys.key, timezone: sites.timezone })
    .from(sites)
    .innerJoin(apiKeys, eq(sites.id, apiKeys.siteId))
    .where(and(eq(sites.exportEnabled, true), isNull(apiKeys.revokedAt)));

  for (const site of exportSites) {
    try {
      const count = await exportSiteDay(env, site);
      console.log(`[exports] site ${site.siteId}: ${count} events exported`);
    } catch (err) {
      console.error(`[exports] site ${site.siteId} failed:`, err);
    }
  }
}
