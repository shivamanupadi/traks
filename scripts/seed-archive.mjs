/**
 * Seed script: generates 2 years of dummy archive data for a site.
 * Outputs SQL to stdout. Pipe to wrangler d1 execute --file.
 *
 * Usage: node scripts/seed-archive.mjs > /tmp/seed-archive.sql
 */

const SITE_ID = 's39aynhi6lidkelhbmy170lt';
const DAYS = 730; // 2 years

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

// Growth factor: older days have less traffic, newer days have more
function growthFactor(daysAgo) {
  // Linear growth from 0.3 to 1.0 over 2 years
  return 0.3 + 0.7 * (1 - daysAgo / DAYS);
}

// Weekend dip
function weekendFactor(date) {
  const d = new Date(date);
  const day = d.getUTCDay();
  return (day === 0 || day === 6) ? 0.6 : 1.0;
}

const lines = [];
lines.push('-- Seed archive data for site ' + SITE_ID);
lines.push(`DELETE FROM daily_stats WHERE site_id = '${SITE_ID}';`);
lines.push(`DELETE FROM daily_pages WHERE site_id = '${SITE_ID}';`);
lines.push(`DELETE FROM daily_referrers WHERE site_id = '${SITE_ID}';`);
lines.push(`DELETE FROM daily_locations WHERE site_id = '${SITE_ID}';`);
lines.push(`DELETE FROM daily_devices WHERE site_id = '${SITE_ID}';`);
lines.push(`DELETE FROM daily_utm WHERE site_id = '${SITE_ID}';`);
lines.push(`DELETE FROM daily_events WHERE site_id = '${SITE_ID}';`);
lines.push(`DELETE FROM archive_state WHERE site_id = '${SITE_ID}';`);

// Batch inserts
const statsRows = [];
const pagesRows = [];
const referrersRows = [];
const locationsRows = [];
const devicesRows = [];
const utmRows = [];
const eventsRows = [];

for (let i = 1; i <= DAYS; i++) {
  const date = dateStr(i);
  const gf = growthFactor(i);
  const wf = weekendFactor(date);
  const factor = gf * wf;

  // Stats
  const visitors = Math.round(rand(80, 300) * factor);
  const pageviews = Math.round(visitors * (1.5 + Math.random() * 1.5));
  const sessions = Math.round(visitors * (1.0 + Math.random() * 0.3));
  statsRows.push(`('${SITE_ID}','${date}',${visitors},${pageviews},${sessions})`);

  // Pages (5-8 per day)
  const dayPages = pick(pages, rand(5, 8));
  let pvLeft = pageviews;
  for (let j = 0; j < dayPages.length; j++) {
    const isLast = j === dayPages.length - 1;
    const pv = isLast ? pvLeft : Math.round(pvLeft * (0.2 + Math.random() * 0.3));
    pvLeft -= pv;
    if (pvLeft < 0) pvLeft = 0;
    const vis = Math.round(pv * (0.5 + Math.random() * 0.3));
    pagesRows.push(`('${SITE_ID}','${date}','${esc(dayPages[j])}',${vis},${pv})`);
  }

  // Referrers (3-5 per day)
  const dayRefs = pick(referrers, rand(3, 5));
  for (const ref of dayRefs) {
    const vis = Math.round(rand(5, 50) * factor);
    referrersRows.push(`('${SITE_ID}','${date}','${esc(ref)}',${vis})`);
  }

  // Locations
  const dayCountries = pick(countries, rand(4, 7));
  for (const c of dayCountries) {
    const vis = Math.round(rand(5, 60) * factor);
    locationsRows.push(`('${SITE_ID}','${date}','country','${esc(c)}',${vis})`);
  }
  const dayCities = pick(cities, rand(3, 5));
  for (const c of dayCities) {
    const vis = Math.round(rand(3, 30) * factor);
    locationsRows.push(`('${SITE_ID}','${date}','city','${esc(c)}',${vis})`);
  }

  // Devices
  for (const b of pick(browsers, rand(2, 4))) {
    const vis = Math.round(rand(10, 80) * factor);
    devicesRows.push(`('${SITE_ID}','${date}','browser','${esc(b)}',${vis})`);
  }
  for (const o of pick(oses, rand(2, 4))) {
    const vis = Math.round(rand(10, 60) * factor);
    devicesRows.push(`('${SITE_ID}','${date}','os','${esc(o)}',${vis})`);
  }
  for (const d of devices) {
    const vis = Math.round(rand(5, 100) * factor);
    devicesRows.push(`('${SITE_ID}','${date}','device','${esc(d)}',${vis})`);
  }

  // UTM
  for (const s of pick(utmSources, rand(2, 4))) {
    const vis = Math.round(rand(3, 30) * factor);
    const sess = Math.round(vis * (1 + Math.random() * 0.2));
    utmRows.push(`('${SITE_ID}','${date}','source','${esc(s)}',${vis},${sess})`);
  }
  for (const m of pick(utmMediums, rand(2, 3))) {
    const vis = Math.round(rand(3, 20) * factor);
    const sess = Math.round(vis * (1 + Math.random() * 0.2));
    utmRows.push(`('${SITE_ID}','${date}','medium','${esc(m)}',${vis},${sess})`);
  }
  for (const c of pick(utmCampaigns, rand(1, 3))) {
    const vis = Math.round(rand(2, 15) * factor);
    const sess = Math.round(vis * (1 + Math.random() * 0.2));
    utmRows.push(`('${SITE_ID}','${date}','campaign','${esc(c)}',${vis},${sess})`);
  }

  // Events
  for (const e of pick(eventNames, rand(2, 4))) {
    const count = Math.round(rand(1, 40) * factor);
    const totalValue = Math.round(count * (Math.random() * 10) * 100) / 100;
    eventsRows.push(`('${SITE_ID}','${date}','${esc(e)}',${count},${totalValue})`);
  }
}

// Emit batched inserts (D1 max ~100 rows per insert to be safe)
function emitBatched(table, columns, rows, batchSize = 80) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    lines.push(`INSERT INTO ${table} (${columns}) VALUES ${batch.join(',')};`);
  }
}

emitBatched('daily_stats', 'site_id, date, visitors, pageviews, sessions', statsRows);
emitBatched('daily_pages', 'site_id, date, pathname, visitors, pageviews', pagesRows);
emitBatched('daily_referrers', 'site_id, date, source, visitors', referrersRows);
emitBatched('daily_locations', 'site_id, date, type, name, visitors', locationsRows);
emitBatched('daily_devices', 'site_id, date, type, name, visitors', devicesRows);
emitBatched('daily_utm', 'site_id, date, type, value, visitors, sessions', utmRows);
emitBatched('daily_events', 'site_id, date, name, count, total_value', eventsRows);

// Archive state
const latestDate = dateStr(1);
lines.push(`INSERT INTO archive_state (site_id, last_archived_date, last_r2_archived_date, status, updated_at) VALUES ('${SITE_ID}', '${latestDate}', '${latestDate}', 'idle', ${Math.floor(Date.now() / 1000)});`);

console.log(lines.join('\n'));
