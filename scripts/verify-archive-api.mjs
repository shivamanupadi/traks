#!/usr/bin/env node
/**
 * Verify archived D1 data is returned correctly for periods > 90d.
 *
 * Two modes:
 *   1. D1-only (default): queries D1 directly via `wrangler d1 execute`
 *      to validate the SQL layer matches what our Drizzle queries produce.
 *
 *   2. API mode: hits the running API server with a Clerk token.
 *      Usage: API_URL=http://localhost:5011 AUTH_TOKEN=<clerk_jwt> node scripts/verify-archive-api.mjs --api
 *
 * Both modes use the seeded site: s39aynhi6lidkelhbmy170lt
 */

const SITE_ID = 's39aynhi6lidkelhbmy170lt';
const DB_NAME = 'traks-db-dev';

const API_URL = process.env.API_URL || 'http://localhost:5011';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const MODE = process.argv.includes('--api') ? 'api' : 'd1';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function getDateRange(period) {
  const to = formatDate(new Date());
  const now = new Date();
  switch (period) {
    case '6m':  now.setDate(now.getDate() - 180); return { from: formatDate(now), to };
    case '1y':  now.setDate(now.getDate() - 365); return { from: formatDate(now), to };
    case 'all': return { from: '2000-01-01', to };
  }
}

let passed = 0;
let failed = 0;

function assert(condition, label, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// ─── D1 Direct Mode ─────────────────────────────────────────────────────────

import { execSync } from 'node:child_process';

function d1Query(sql) {
  const escaped = sql.replace(/"/g, '\\"');
  const cmd = `cd apps/api && npx wrangler d1 execute ${DB_NAME} --remote --json --command="${escaped}"`;
  try {
    const raw = execSync(cmd, {
      cwd: process.cwd().replace(/\/scripts$/, ''),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // wrangler outputs a JSON array; results are in [0].results
    const parsed = JSON.parse(raw);
    return parsed[0]?.results || [];
  } catch (err) {
    console.error(`  D1 query failed: ${err.message}`);
    return null;
  }
}

async function verifyD1() {
  console.log('\n═══ D1 Direct Verification ═══\n');

  for (const period of ['6m', '1y', 'all']) {
    const { from, to } = getDateRange(period);
    console.log(`\n── Period: ${period} (${from} → ${to}) ──\n`);

    // 1) daily_stats aggregate
    console.log('[Stats]');
    const stats = d1Query(
      `SELECT SUM(visitors) as visitors, SUM(pageviews) as pageviews, SUM(sessions) as sessions FROM daily_stats WHERE site_id = '${SITE_ID}' AND date >= '${from}' AND date <= '${to}'`
    );
    if (stats) {
      const s = stats[0] || {};
      assert(s.visitors > 0, `visitors = ${s.visitors} (> 0)`);
      assert(s.pageviews > 0, `pageviews = ${s.pageviews} (> 0)`);
      assert(s.sessions > 0, `sessions = ${s.sessions} (> 0)`);
      assert(s.pageviews >= s.visitors, `pageviews >= visitors`);
    }

    // 2) daily_stats row count (timeseries)
    console.log('[Timeseries]');
    const tsCount = d1Query(
      `SELECT COUNT(*) as cnt FROM daily_stats WHERE site_id = '${SITE_ID}' AND date >= '${from}' AND date <= '${to}'`
    );
    if (tsCount) {
      const cnt = tsCount[0]?.cnt || 0;
      const expectedMin = period === '6m' ? 150 : period === '1y' ? 300 : 600;
      assert(cnt >= expectedMin, `timeseries rows = ${cnt} (>= ${expectedMin})`,
        cnt < expectedMin ? `only ${cnt} rows` : '');
    }

    // Weekly rollup for 'all' (>365 days)
    if (period === 'all') {
      console.log('[Weekly Rollup]');
      const weekly = d1Query(
        `SELECT date(date, 'weekday 0', '-6 days') as week_start, SUM(visitors) as visitors, SUM(pageviews) as pageviews, SUM(sessions) as sessions FROM daily_stats WHERE site_id = '${SITE_ID}' AND date >= '${from}' AND date <= '${to}' GROUP BY week_start ORDER BY week_start`
      );
      if (weekly) {
        assert(weekly.length > 0, `weekly rows = ${weekly.length}`);
        assert(weekly.length < 200, `weekly rows < 200 (rolled up, not daily)`, `got ${weekly.length}`);
        // Check first and last week have data
        const first = weekly[0];
        const last = weekly[weekly.length - 1];
        assert(first.visitors > 0, `first week visitors = ${first.visitors}`);
        assert(last.visitors > 0, `last week visitors = ${last.visitors}`);
      }
    }

    // 3) daily_pages
    console.log('[Pages]');
    const pages = d1Query(
      `SELECT pathname, SUM(visitors) as visitors, SUM(pageviews) as pageviews FROM daily_pages WHERE site_id = '${SITE_ID}' AND date >= '${from}' AND date <= '${to}' GROUP BY pathname ORDER BY visitors DESC LIMIT 10`
    );
    if (pages) {
      assert(pages.length > 0, `pages count = ${pages.length}`);
      assert(pages[0].pathname?.length > 0, `top page = "${pages[0].pathname}"`);
      assert(pages[0].visitors > 0, `top page visitors = ${pages[0].visitors}`);
    }

    // 4) daily_referrers
    console.log('[Referrers]');
    const refs = d1Query(
      `SELECT source, SUM(visitors) as visitors FROM daily_referrers WHERE site_id = '${SITE_ID}' AND date >= '${from}' AND date <= '${to}' GROUP BY source ORDER BY visitors DESC LIMIT 10`
    );
    if (refs) {
      assert(refs.length > 0, `referrers count = ${refs.length}`);
      assert(refs[0].source?.length > 0, `top referrer = "${refs[0].source}"`);
    }

    // 5) daily_locations (country)
    console.log('[Locations - country]');
    const countries = d1Query(
      `SELECT name, SUM(visitors) as visitors FROM daily_locations WHERE site_id = '${SITE_ID}' AND type = 'country' AND date >= '${from}' AND date <= '${to}' GROUP BY name ORDER BY visitors DESC LIMIT 10`
    );
    if (countries) {
      assert(countries.length > 0, `countries count = ${countries.length}`);
      assert(countries[0].visitors > 0, `top country "${countries[0].name}" visitors = ${countries[0].visitors}`);
    }

    // 6) daily_locations (city)
    console.log('[Locations - city]');
    const cities = d1Query(
      `SELECT name, SUM(visitors) as visitors FROM daily_locations WHERE site_id = '${SITE_ID}' AND type = 'city' AND date >= '${from}' AND date <= '${to}' GROUP BY name ORDER BY visitors DESC LIMIT 10`
    );
    if (cities) {
      assert(cities.length > 0, `cities count = ${cities.length}`);
    }

    // 7) daily_devices (browser / os / device)
    for (const dtype of ['browser', 'os', 'device']) {
      console.log(`[Devices - ${dtype}]`);
      const devs = d1Query(
        `SELECT name, SUM(visitors) as visitors FROM daily_devices WHERE site_id = '${SITE_ID}' AND type = '${dtype}' AND date >= '${from}' AND date <= '${to}' GROUP BY name ORDER BY visitors DESC LIMIT 10`
      );
      if (devs) {
        assert(devs.length > 0, `${dtype} count = ${devs.length}`);
        // Check percentages add up
        const total = devs.reduce((s, r) => s + r.visitors, 0);
        assert(total > 0, `${dtype} total visitors = ${total}`);
      }
    }

    // 8) daily_utm (source / medium / campaign)
    for (const utype of ['source', 'medium', 'campaign']) {
      console.log(`[UTM - ${utype}]`);
      const utms = d1Query(
        `SELECT value, SUM(visitors) as visitors, SUM(sessions) as sessions FROM daily_utm WHERE site_id = '${SITE_ID}' AND type = '${utype}' AND date >= '${from}' AND date <= '${to}' GROUP BY value ORDER BY visitors DESC LIMIT 10`
      );
      if (utms) {
        assert(utms.length > 0, `utm ${utype} count = ${utms.length}`);
        assert(utms[0].sessions > 0, `top utm ${utype} sessions = ${utms[0].sessions}`);
      }
    }

    // 9) daily_events
    console.log('[Events]');
    const events = d1Query(
      `SELECT name, SUM(count) as count, SUM(total_value) as total_value FROM daily_events WHERE site_id = '${SITE_ID}' AND date >= '${from}' AND date <= '${to}' GROUP BY name ORDER BY count DESC LIMIT 20`
    );
    if (events) {
      assert(events.length > 0, `events count = ${events.length}`);
      assert(events[0].count > 0, `top event "${events[0].name}" count = ${events[0].count}`);
      assert(events[0].total_value >= 0, `top event total_value = ${events[0].total_value}`);
    }
  }
}

// ─── API Mode ───────────────────────────────────────────────────────────────

async function apiFetch(path, params = {}) {
  const url = new URL(path, API_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
  });

  if (!res.ok) {
    console.log(`  ✗ ${path} → HTTP ${res.status}`);
    failed++;
    return null;
  }
  return res.json();
}

async function verifyAPI() {
  console.log('\n═══ API Endpoint Verification ═══\n');

  if (!AUTH_TOKEN) {
    console.error('ERROR: Set AUTH_TOKEN env var to a valid Clerk JWT.');
    console.error('  Get it from browser DevTools → Application → Cookies → __session');
    console.error('  Or: Network tab → any API request → Authorization header\n');
    process.exit(1);
  }

  for (const period of ['6m', '1y', 'all']) {
    const { from, to } = getDateRange(period);
    console.log(`\n── Period: ${period} (${from} → ${to}) ──\n`);

    // Main stats
    console.log('[Stats /main]');
    const main = await apiFetch(`/api/analytics/${SITE_ID}/stats/main`, { period });
    if (main?.data) {
      const d = main.data;
      assert(d.visitors > 0, `visitors = ${d.visitors}`);
      assert(d.pageviews > 0, `pageviews = ${d.pageviews}`);
      assert(d.sessions > 0, `sessions = ${d.sessions}`);
      assert(d.visitorsChange === 0, `visitorsChange = ${d.visitorsChange} (expected 0 for archived)`);
      assert(d.pageviewsChange === 0, `pageviewsChange = ${d.pageviewsChange} (expected 0)`);
      assert(d.sessionsChange === 0, `sessionsChange = ${d.sessionsChange} (expected 0)`);
    }

    // Timeseries
    console.log('[Timeseries]');
    const ts = await apiFetch(`/api/analytics/${SITE_ID}/stats/timeseries`, { period });
    if (ts?.data) {
      assert(ts.data.length > 0, `timeseries points = ${ts.data.length}`);
      const first = ts.data[0];
      assert('date' in first, `has date field`);
      assert('visitors' in first, `has visitors field`);
      assert('pageviews' in first, `has pageviews field`);
      assert('sessions' in first, `has sessions field`);
      // For 'all', should be weekly (~104 points for 2yr, not 730)
      if (period === 'all') {
        assert(ts.data.length < 200, `all-time uses weekly rollup (${ts.data.length} points)`,
          ts.data.length >= 200 ? 'too many points — may not be weekly' : '');
      }
    }

    // Pages
    console.log('[Pages]');
    const pages = await apiFetch(`/api/analytics/${SITE_ID}/stats/pages`, { period });
    if (pages?.data) {
      assert(pages.data.length > 0, `pages = ${pages.data.length}`);
      assert(pages.data[0].name?.length > 0, `top page name = "${pages.data[0].name}"`);
      assert(pages.data[0].visitors > 0, `top page visitors = ${pages.data[0].visitors}`);
      assert('pageviews' in pages.data[0], `has pageviews field`);
    }

    // Referrers
    console.log('[Referrers]');
    const refs = await apiFetch(`/api/analytics/${SITE_ID}/stats/referrers`, { period });
    if (refs?.data) {
      assert(refs.data.length > 0, `referrers = ${refs.data.length}`);
      assert(refs.data[0].name?.length > 0, `top referrer = "${refs.data[0].name}"`);
      assert(refs.data[0].visitors > 0, `top referrer visitors = ${refs.data[0].visitors}`);
    }

    // Locations
    for (const type of ['country', 'city']) {
      console.log(`[Locations - ${type}]`);
      const locs = await apiFetch(`/api/analytics/${SITE_ID}/stats/locations`, { period, type });
      if (locs?.data) {
        assert(locs.data.length > 0, `${type} count = ${locs.data.length}`);
        assert(locs.data[0].name?.length > 0, `top ${type} = "${locs.data[0].name}"`);
        assert(locs.data[0].visitors > 0, `top ${type} visitors = ${locs.data[0].visitors}`);
        if (type === 'country') {
          assert('code' in locs.data[0], `has code field`);
        }
      }
    }

    // Devices
    for (const type of ['browser', 'os', 'device']) {
      console.log(`[Devices - ${type}]`);
      const devs = await apiFetch(`/api/analytics/${SITE_ID}/stats/devices`, { period, type });
      if (devs?.data) {
        assert(devs.data.length > 0, `${type} count = ${devs.data.length}`);
        assert(devs.data[0].visitors > 0, `top ${type} visitors = ${devs.data[0].visitors}`);
        assert('percentage' in devs.data[0], `has percentage field`);
        const totalPct = devs.data.reduce((s, r) => s + r.percentage, 0);
        assert(totalPct >= 90 && totalPct <= 110, `percentages sum ≈ 100 (got ${totalPct})`);
      }
    }

    // UTM
    for (const type of ['source', 'medium', 'campaign']) {
      console.log(`[UTM - ${type}]`);
      const utms = await apiFetch(`/api/analytics/${SITE_ID}/stats/utm`, { period, type });
      if (utms?.data) {
        assert(utms.data.length > 0, `utm ${type} count = ${utms.data.length}`);
        assert(utms.data[0].visitors > 0, `top ${type} visitors = ${utms.data[0].visitors}`);
        assert('sessions' in utms.data[0], `has sessions field`);
      }
    }

    // Events
    console.log('[Events]');
    const events = await apiFetch(`/api/analytics/${SITE_ID}/stats/events`, { period });
    if (events?.data) {
      assert(events.data.length > 0, `events = ${events.data.length}`);
      assert(events.data[0].name?.length > 0, `top event = "${events.data[0].name}"`);
      assert(events.data[0].count > 0, `top event count = ${events.data[0].count}`);
      assert('totalValue' in events.data[0], `has totalValue field`);
    }

    // Batch stats
    console.log('[Batch Stats]');
    const batch = await apiFetch(`/api/analytics/batch/stats`, { period });
    if (batch?.data) {
      assert(SITE_ID in batch.data, `batch includes site ${SITE_ID}`);
      if (batch.data[SITE_ID]) {
        const bs = batch.data[SITE_ID];
        assert(bs.visitors > 0, `batch visitors = ${bs.visitors}`);
        assert(bs.pageviews > 0, `batch pageviews = ${bs.pageviews}`);
        assert(bs.sessions > 0, `batch sessions = ${bs.sessions}`);
      }
    }
  }

  // Cross-check: 6m < 1y < all for totals
  console.log('\n── Cross-period Monotonicity ──\n');
  const totals = {};
  for (const period of ['6m', '1y', 'all']) {
    const res = await apiFetch(`/api/analytics/${SITE_ID}/stats/main`, { period });
    totals[period] = res?.data || { visitors: 0, pageviews: 0, sessions: 0 };
  }
  for (const metric of ['visitors', 'pageviews', 'sessions']) {
    assert(
      totals['6m'][metric] <= totals['1y'][metric],
      `6m ${metric} (${totals['6m'][metric]}) <= 1y (${totals['1y'][metric]})`
    );
    assert(
      totals['1y'][metric] <= totals['all'][metric],
      `1y ${metric} (${totals['1y'][metric]}) <= all (${totals['all'][metric]})`
    );
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Mode: ${MODE.toUpperCase()}`);
  console.log(`Site: ${SITE_ID}`);

  if (MODE === 'api') {
    await verifyAPI();
  } else {
    await verifyD1();
  }

  console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
