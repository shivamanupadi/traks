import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import {
  queryAnalyticsEngine,
  buildDailyStatsQuery,
  buildDailyPagesQuery,
  buildDailyReferrersQuery,
  buildDailyLocationsQuery,
  buildDailyDevicesQuery,
  buildDailyUtmQuery,
  buildDailyEventsQuery,
} from '@traks/shared';
import type { QueryConfig } from '@traks/shared';
import {
  upsertDailyStats,
  upsertDailyPages,
  upsertDailyReferrers,
  upsertDailyLocations,
  upsertDailyDevices,
  upsertDailyUtm,
  upsertDailyEvents,
  updateArchiveState,
  archiveState,
} from './db';
import type { SiteWithKey } from './db';

export async function archiveSiteDay(
  db: DrizzleD1Database,
  bucket: R2Bucket,
  config: QueryConfig,
  site: SiteWithKey,
  dateStr: string
): Promise<void> {
  console.log(`[archive] Archiving site ${site.id} (${site.domain}) for ${dateStr}`);

  try {
    // Fire all 12 queries in parallel
    const [
      statsRows,
      pagesRows,
      referrersRows,
      countriesRows,
      citiesRows,
      browsersRows,
      osRows,
      devicesRows,
      utmSourceRows,
      utmMediumRows,
      utmCampaignRows,
      eventsRows,
    ] = await Promise.all([
      queryAnalyticsEngine(config, buildDailyStatsQuery(site.key, dateStr)),
      queryAnalyticsEngine(config, buildDailyPagesQuery(site.key, dateStr)),
      queryAnalyticsEngine(config, buildDailyReferrersQuery(site.key, dateStr)),
      queryAnalyticsEngine(config, buildDailyLocationsQuery(site.key, dateStr, 'country')),
      queryAnalyticsEngine(config, buildDailyLocationsQuery(site.key, dateStr, 'city')),
      queryAnalyticsEngine(config, buildDailyDevicesQuery(site.key, dateStr, 'browser')),
      queryAnalyticsEngine(config, buildDailyDevicesQuery(site.key, dateStr, 'os')),
      queryAnalyticsEngine(config, buildDailyDevicesQuery(site.key, dateStr, 'device')),
      queryAnalyticsEngine(config, buildDailyUtmQuery(site.key, dateStr, 'source')),
      queryAnalyticsEngine(config, buildDailyUtmQuery(site.key, dateStr, 'medium')),
      queryAnalyticsEngine(config, buildDailyUtmQuery(site.key, dateStr, 'campaign')),
      queryAnalyticsEngine(config, buildDailyEventsQuery(site.key, dateStr)),
    ]);

    // Write aggregated summaries to D1
    const stats = statsRows[0] || { visitors: 0, pageviews: 0, sessions: 0 };
    await upsertDailyStats(db, site.id, dateStr, {
      visitors: Number(stats.visitors || 0),
      pageviews: Number(stats.pageviews || 0),
      sessions: Number(stats.sessions || 0),
    });

    await upsertDailyPages(
      db,
      site.id,
      dateStr,
      pagesRows.map((r: any) => ({
        pathname: r.pathname,
        visitors: Number(r.visitors || 0),
        pageviews: Number(r.pageviews || 0),
      }))
    );

    await upsertDailyReferrers(
      db,
      site.id,
      dateStr,
      referrersRows.map((r: any) => ({
        source: r.source,
        visitors: Number(r.visitors || 0),
      }))
    );

    // Locations: merge countries and cities with type prefix
    const locationRows = [
      ...countriesRows.map((r: any) => ({
        type: 'country' as const,
        name: r.name,
        visitors: Number(r.visitors || 0),
      })),
      ...citiesRows.map((r: any) => ({
        type: 'city' as const,
        name: r.name,
        visitors: Number(r.visitors || 0),
      })),
    ];
    await upsertDailyLocations(db, site.id, dateStr, locationRows);

    // Devices: merge browser, os, device with type prefix
    const deviceRows = [
      ...browsersRows.map((r: any) => ({
        type: 'browser' as const,
        name: r.name,
        visitors: Number(r.visitors || 0),
      })),
      ...osRows.map((r: any) => ({
        type: 'os' as const,
        name: r.name,
        visitors: Number(r.visitors || 0),
      })),
      ...devicesRows.map((r: any) => ({
        type: 'device' as const,
        name: r.name,
        visitors: Number(r.visitors || 0),
      })),
    ];
    await upsertDailyDevices(db, site.id, dateStr, deviceRows);

    // UTM: merge source, medium, campaign with type prefix
    const utmRows = [
      ...utmSourceRows.map((r: any) => ({
        type: 'source' as const,
        value: r.value,
        visitors: Number(r.visitors || 0),
        sessions: Number(r.sessions || 0),
      })),
      ...utmMediumRows.map((r: any) => ({
        type: 'medium' as const,
        value: r.value,
        visitors: Number(r.visitors || 0),
        sessions: Number(r.sessions || 0),
      })),
      ...utmCampaignRows.map((r: any) => ({
        type: 'campaign' as const,
        value: r.value,
        visitors: Number(r.visitors || 0),
        sessions: Number(r.sessions || 0),
      })),
    ];
    await upsertDailyUtm(db, site.id, dateStr, utmRows);

    await upsertDailyEvents(
      db,
      site.id,
      dateStr,
      eventsRows.map((r: any) => ({
        name: r.name,
        count: Number(r.count || 0),
        totalValue: Number(r.total_value || 0),
      }))
    );

    // Write raw JSONL to R2
    const [year, month, day] = dateStr.split('-');
    const r2Key = `raw/${site.id}/${year}/${month}/${day}/events.jsonl`;
    const allResults = {
      stats: statsRows,
      pages: pagesRows,
      referrers: referrersRows,
      locations: { countries: countriesRows, cities: citiesRows },
      devices: { browsers: browsersRows, os: osRows, devices: devicesRows },
      utm: { source: utmSourceRows, medium: utmMediumRows, campaign: utmCampaignRows },
      events: eventsRows,
    };

    const jsonlLines = Object.entries(allResults).map(
      ([key, value]) => JSON.stringify({ type: key, date: dateStr, siteId: site.id, data: value })
    );
    await bucket.put(r2Key, jsonlLines.join('\n'));

    // Update archive state
    await updateArchiveState(db, site.id, dateStr, dateStr, 'idle');

    console.log(`[archive] Completed site ${site.id} for ${dateStr}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[archive] Error archiving site ${site.id}: ${message}`);
    // Don't update lastArchivedDate on error — only log the error status
    // The queue will retry, and we don't want to roll back a successful date
    try {
      await db
        .update(archiveState)
        .set({ status: 'error', lastError: message, updatedAt: new Date() })
        .where(eq(archiveState.siteId, site.id));
    } catch { /* best-effort */ }
    throw error;
  }
}
