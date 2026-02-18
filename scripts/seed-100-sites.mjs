#!/usr/bin/env node
/**
 * Seed 100 sites with 2 years of archive data.
 *
 * Generates SQL files in /tmp/traks-seed/ and executes them via wrangler.
 * Keeps 2 existing sites, creates 98 new ones.
 *
 * Usage:
 *   node scripts/seed-100-sites.mjs              # generate + execute
 *   node scripts/seed-100-sites.mjs --dry-run    # generate SQL files only
 */

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';

const DRY_RUN = process.argv.includes('--dry-run');
const DB_NAME = 'traks-db-dev';
const API_DIR = 'apps/api';
const OUT_DIR = '/tmp/traks-seed';
const USER_ID = 'user_33oZZ5yChFk4G8NHDChhJ48vEYk';
const TOTAL_SITES = 100;

// Existing sites to keep
const EXISTING_SITES = [
  { id: 's39aynhi6lidkelhbmy170lt', name: 'Temporium', domain: 'temporium.xyz' },
  { id: 'n8tt7spmuz8j4f10drk0lpvt', name: 'FlareDesk', domain: 'flaredesk.dev' },
];

const DAYS = 730;

// ─── Site Name / Domain Generation ──────────────────────────────────────────

const prefixes = [
  'Cloud', 'Data', 'Pixel', 'Orbit', 'Flux', 'Neon', 'Hyper', 'Turbo', 'Zero',
  'Pulse', 'Wave', 'Core', 'Edge', 'Sync', 'Flow', 'Code', 'Byte', 'Link',
  'Grid', 'Spark', 'Rush', 'Blaze', 'Prime', 'Stack', 'Swift', 'Bright',
  'Clear', 'Deep', 'Fast', 'True', 'Open', 'Blue', 'Red', 'Green', 'Iron',
];
const suffixes = [
  'Hub', 'Lab', 'Desk', 'Base', 'Kit', 'Box', 'Tap', 'Run', 'Pad', 'Forge',
  'Works', 'Mind', 'Dock', 'Spot', 'Nest', 'Port', 'Vault', 'Ship', 'Trail',
  'Hive', 'Lens', 'Mesh', 'Node', 'Realm', 'Scope', 'Logic', 'Craft', 'Ware',
];
const tlds = ['.com', '.dev', '.io', '.co', '.app', '.xyz', '.ai', '.so', '.sh'];

function generateSites(count) {
  const sites = [];
  const usedDomains = new Set(EXISTING_SITES.map(s => s.domain));

  for (let i = 0; i < count; i++) {
    let name, domain;
    do {
      const p = prefixes[Math.floor(Math.random() * prefixes.length)];
      const s = suffixes[Math.floor(Math.random() * suffixes.length)];
      name = `${p}${s}`;
      const tld = tlds[Math.floor(Math.random() * tlds.length)];
      domain = `${name.toLowerCase()}${tld}`;
    } while (usedDomains.has(domain));
    usedDomains.add(domain);

    const id = crypto.randomBytes(12).toString('base64url').slice(0, 24).toLowerCase();
    sites.push({ id, name, domain });
  }
  return sites;
}

function generateApiKey() {
  return 'pb_live_' + crypto.randomBytes(16).toString('base64url').slice(0, 24).toLowerCase();
}

function cuid() {
  return crypto.randomBytes(12).toString('base64url').slice(0, 24).toLowerCase();
}

// ─── Archive Data Generation (same logic as seed-archive.mjs) ───────────────

const pages = ['/', '/pricing', '/blog', '/docs', '/about', '/contact', '/features', '/changelog', '/login', '/signup'];
const referrers = ['google.com', 't.co', 'reddit.com', 'github.com', 'news.ycombinator.com', 'facebook.com', 'linkedin.com'];
const countries = ['US', 'IN', 'GB', 'DE', 'FR', 'CA', 'AU', 'JP', 'BR', 'NL'];
const cities = ['San Francisco', 'Mumbai', 'London', 'Berlin', 'Paris', 'Toronto', 'Sydney', 'Tokyo', 'São Paulo', 'Amsterdam'];
const browsers = ['Chrome', 'Firefox', 'Safari', 'Edge'];
const oses = ['Windows', 'macOS', 'iOS', 'Android', 'Linux'];
const devices = ['desktop', 'mobile', 'tablet'];
const utmSources = ['google', 'twitter', 'newsletter', 'producthunt', 'reddit'];
const utmMediums = ['cpc', 'social', 'email', 'organic'];
const utmCampaigns = ['launch-2025', 'summer-sale', 'q4-push', 'brand'];
const eventNames = ['signup_click', 'demo_request', 'pricing_view', 'download_pdf', 'share_click'];

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr, count) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function esc(s) {
  return s.replace(/'/g, "''");
}

function dateStr(daysAgo) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

// Each site gets a random "scale" so some are big, some are small
function siteScale() {
  // 0.2 to 2.0 — most sites are small, a few are large
  return 0.2 + Math.random() * 1.8;
}

function generateArchiveSQL(siteId, scale) {
  const statsRows = [];
  const pagesRows = [];
  const referrersRows = [];
  const locationsRows = [];
  const devicesRows = [];
  const utmRows = [];
  const eventsRows = [];

  for (let i = 1; i <= DAYS; i++) {
    const date = dateStr(i);
    // Growth: older days less traffic
    const gf = 0.3 + 0.7 * (1 - i / DAYS);
    // Weekend dip
    const day = new Date(date).getUTCDay();
    const wf = (day === 0 || day === 6) ? 0.6 : 1.0;
    const factor = gf * wf * scale;

    const visitors = Math.max(1, Math.round(rand(80, 300) * factor));
    const pageviews = Math.round(visitors * (1.5 + Math.random() * 1.5));
    const sessions = Math.round(visitors * (1.0 + Math.random() * 0.3));
    statsRows.push(`('${siteId}','${date}',${visitors},${pageviews},${sessions})`);

    const dayPages = pick(pages, rand(5, 8));
    let pvLeft = pageviews;
    for (let j = 0; j < dayPages.length; j++) {
      const isLast = j === dayPages.length - 1;
      const pv = isLast ? pvLeft : Math.round(pvLeft * (0.2 + Math.random() * 0.3));
      pvLeft -= pv;
      if (pvLeft < 0) pvLeft = 0;
      const vis = Math.round(pv * (0.5 + Math.random() * 0.3));
      pagesRows.push(`('${siteId}','${date}','${esc(dayPages[j])}',${vis},${pv})`);
    }

    for (const ref of pick(referrers, rand(3, 5))) {
      referrersRows.push(`('${siteId}','${date}','${esc(ref)}',${Math.max(1, Math.round(rand(5, 50) * factor))})`);
    }

    for (const c of pick(countries, rand(4, 7))) {
      locationsRows.push(`('${siteId}','${date}','country','${esc(c)}',${Math.max(1, Math.round(rand(5, 60) * factor))})`);
    }
    for (const c of pick(cities, rand(3, 5))) {
      locationsRows.push(`('${siteId}','${date}','city','${esc(c)}',${Math.max(1, Math.round(rand(3, 30) * factor))})`);
    }

    for (const b of pick(browsers, rand(2, 4))) {
      devicesRows.push(`('${siteId}','${date}','browser','${esc(b)}',${Math.max(1, Math.round(rand(10, 80) * factor))})`);
    }
    for (const o of pick(oses, rand(2, 4))) {
      devicesRows.push(`('${siteId}','${date}','os','${esc(o)}',${Math.max(1, Math.round(rand(10, 60) * factor))})`);
    }
    for (const d of devices) {
      devicesRows.push(`('${siteId}','${date}','device','${esc(d)}',${Math.max(1, Math.round(rand(5, 100) * factor))})`);
    }

    for (const s of pick(utmSources, rand(2, 4))) {
      const vis = Math.max(1, Math.round(rand(3, 30) * factor));
      utmRows.push(`('${siteId}','${date}','source','${esc(s)}',${vis},${Math.round(vis * (1 + Math.random() * 0.2))})`);
    }
    for (const m of pick(utmMediums, rand(2, 3))) {
      const vis = Math.max(1, Math.round(rand(3, 20) * factor));
      utmRows.push(`('${siteId}','${date}','medium','${esc(m)}',${vis},${Math.round(vis * (1 + Math.random() * 0.2))})`);
    }
    for (const c of pick(utmCampaigns, rand(1, 3))) {
      const vis = Math.max(1, Math.round(rand(2, 15) * factor));
      utmRows.push(`('${siteId}','${date}','campaign','${esc(c)}',${vis},${Math.round(vis * (1 + Math.random() * 0.2))})`);
    }

    for (const e of pick(eventNames, rand(2, 4))) {
      const count = Math.max(1, Math.round(rand(1, 40) * factor));
      const totalValue = Math.round(count * Math.random() * 10 * 100) / 100;
      eventsRows.push(`('${siteId}','${date}','${esc(e)}',${count},${totalValue})`);
    }
  }

  return { statsRows, pagesRows, referrersRows, locationsRows, devicesRows, utmRows, eventsRows };
}

function emitBatched(lines, table, columns, rows, batchSize = 80) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    lines.push(`INSERT INTO ${table} (${columns}) VALUES ${batch.join(',')};`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

function d1Exec(file, label) {
  if (DRY_RUN) {
    console.log(`  [dry-run] Would execute: ${file}`);
    return;
  }
  try {
    execSync(
      `npx wrangler d1 execute ${DB_NAME} --remote --file="${file}"`,
      { cwd: join(process.cwd(), API_DIR), stdio: 'pipe', encoding: 'utf-8' }
    );
    console.log(`  ✓ ${label}`);
  } catch (err) {
    console.error(`  ✗ ${label}: ${err.stderr?.slice(0, 200) || err.message}`);
    throw err;
  }
}

async function main() {
  console.log(`Seeding ${TOTAL_SITES} sites with ${DAYS} days of archive data\n`);

  // Clean output dir
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  // 1) Generate new sites + API keys
  const newSites = generateSites(TOTAL_SITES - EXISTING_SITES.length);
  const allSites = [...EXISTING_SITES, ...newSites];

  console.log(`Creating ${newSites.length} new sites...`);
  const setupLines = [];
  const now = Math.floor(Date.now() / 1000);
  for (const site of newSites) {
    const keyId = cuid();
    const apiKey = generateApiKey();
    setupLines.push(
      `INSERT OR IGNORE INTO sites (id, user_id, name, domain, timezone, public, created_at, updated_at) VALUES ('${site.id}', '${USER_ID}', '${esc(site.name)}', '${esc(site.domain)}', 'UTC', 0, ${now}, ${now});`
    );
    setupLines.push(
      `INSERT OR IGNORE INTO api_keys (id, site_id, user_id, name, key, created_at) VALUES ('${keyId}', '${site.id}', '${USER_ID}', 'Default', '${apiKey}', ${now});`
    );
  }

  const setupFile = join(OUT_DIR, '00-sites.sql');
  writeFileSync(setupFile, setupLines.join('\n'));
  d1Exec(setupFile, `${newSites.length} sites + API keys`);

  // 2) Generate archive data per site (split into files of ~5 sites each to stay under D1 limits)
  const SITES_PER_BATCH = 5;
  const totalBatches = Math.ceil(allSites.length / SITES_PER_BATCH);

  console.log(`\nGenerating archive data (${totalBatches} batches of ${SITES_PER_BATCH} sites)...\n`);

  for (let b = 0; b < totalBatches; b++) {
    const batchSites = allSites.slice(b * SITES_PER_BATCH, (b + 1) * SITES_PER_BATCH);
    const batchNum = String(b + 1).padStart(2, '0');
    const siteNames = batchSites.map(s => s.name || s.id.slice(0, 8)).join(', ');

    // Each table gets its own file per batch to stay under size limits
    const tables = {
      stats: { cols: 'site_id, date, visitors, pageviews, sessions', rows: [] },
      pages: { cols: 'site_id, date, pathname, visitors, pageviews', rows: [] },
      referrers: { cols: 'site_id, date, source, visitors', rows: [] },
      locations: { cols: 'site_id, date, type, name, visitors', rows: [] },
      devices: { cols: 'site_id, date, type, name, visitors', rows: [] },
      utm: { cols: 'site_id, date, type, value, visitors, sessions', rows: [] },
      events: { cols: 'site_id, date, name, count, total_value', rows: [] },
    };

    for (const site of batchSites) {
      const scale = EXISTING_SITES.find(s => s.id === site.id) ? 1.0 : siteScale();
      const data = generateArchiveSQL(site.id, scale);
      tables.stats.rows.push(...data.statsRows);
      tables.pages.rows.push(...data.pagesRows);
      tables.referrers.rows.push(...data.referrersRows);
      tables.locations.rows.push(...data.locationsRows);
      tables.devices.rows.push(...data.devicesRows);
      tables.utm.rows.push(...data.utmRows);
      tables.events.rows.push(...data.eventsRows);
    }

    // Write and execute each table separately
    for (const [tableName, { cols, rows }] of Object.entries(tables)) {
      const lines = [];
      // Delete existing data for these sites first
      for (const site of batchSites) {
        lines.push(`DELETE FROM daily_${tableName} WHERE site_id = '${site.id}';`);
      }
      emitBatched(lines, `daily_${tableName}`, cols, rows);

      const fileName = join(OUT_DIR, `${batchNum}-${tableName}.sql`);
      writeFileSync(fileName, lines.join('\n'));
      d1Exec(fileName, `batch ${batchNum} daily_${tableName} (${rows.length} rows)`);
    }

    // Archive state
    const stateLines = [];
    const latestDate = dateStr(1);
    for (const site of batchSites) {
      stateLines.push(`INSERT OR REPLACE INTO archive_state (site_id, last_archived_date, last_r2_archived_date, status, updated_at) VALUES ('${site.id}', '${latestDate}', '${latestDate}', 'idle', ${now});`);
    }
    const stateFile = join(OUT_DIR, `${batchNum}-state.sql`);
    writeFileSync(stateFile, stateLines.join('\n'));
    d1Exec(stateFile, `batch ${batchNum} archive_state`);

    const pct = Math.round(((b + 1) / totalBatches) * 100);
    console.log(`  [${pct}%] Batch ${batchNum}/${totalBatches} done (${siteNames})\n`);
  }

  // 3) Summary
  console.log('═══ Done ═══');
  console.log(`Sites: ${allSites.length}`);
  console.log(`Days per site: ${DAYS}`);
  console.log(`SQL files: ${OUT_DIR}`);

  if (!DRY_RUN) {
    // Quick verification
    const result = execSync(
      `npx wrangler d1 execute ${DB_NAME} --remote --json --command="SELECT COUNT(*) as sites FROM sites WHERE user_id = '${USER_ID}'"`,
      { cwd: join(process.cwd(), API_DIR), encoding: 'utf-8' }
    );
    const count = JSON.parse(result)[0]?.results?.[0]?.sites;
    console.log(`Verified: ${count} sites in D1`);

    const statsResult = execSync(
      `npx wrangler d1 execute ${DB_NAME} --remote --json --command="SELECT COUNT(*) as rows FROM daily_stats"`,
      { cwd: join(process.cwd(), API_DIR), encoding: 'utf-8' }
    );
    const statsCount = JSON.parse(statsResult)[0]?.results?.[0]?.rows;
    console.log(`Verified: ${statsCount} rows in daily_stats`);
  }
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
