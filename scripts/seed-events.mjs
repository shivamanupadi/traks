#!/usr/bin/env node
/**
 * Simulate tracker events by POSTing to the local collect worker.
 *
 * Usage:
 *   node scripts/seed-events.mjs <SITE_KEY> [COUNT]
 *
 * Varies User-Agent + cf-connecting-ip headers per synthetic visitor so the
 * server-side HMAC(ip+ua+siteKey) produces distinct visitor_ids.
 */

const SITE_KEY = process.argv[2];
const COUNT = Number(process.argv[3] || 500);
const URL = 'http://localhost:5010/api/event';

if (!SITE_KEY) {
  console.error('Usage: node scripts/seed-events.mjs <SITE_KEY> [COUNT=500]');
  process.exit(1);
}

const paths = [
  '/',
  '/pricing',
  '/docs',
  '/docs/getting-started',
  '/docs/api',
  '/blog',
  '/blog/hello-world',
  '/blog/cloudflare-r2-sql',
  '/about',
  '/contact',
];

const referrers = [
  '',
  'https://www.google.com/',
  'https://t.co/abc123',
  'https://news.ycombinator.com/',
  'https://github.com/some/repo',
  'https://www.reddit.com/r/programming',
  'https://duckduckgo.com/',
];

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/125.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
];

const utmMix = [
  {},
  { us: 'twitter', um: 'social', uc: 'launch' },
  { us: 'newsletter', um: 'email', uc: 'april-2026' },
  { us: 'google', um: 'cpc', uc: 'brand' },
  { us: 'producthunt', um: 'referral', uc: 'launch' },
];

const eventNames = ['signup_click', 'cta_click', 'pricing_view', 'docs_search'];

// Auto link events the tracker fires for outbound clicks / file downloads
const outboundUrls = [
  'https://github.com/traks/traks',
  'https://twitter.com/traksdev',
  'https://developers.cloudflare.com/r2/',
  'https://news.ycombinator.com/item?id=1',
];
const downloadUrls = [
  'http://localhost/files/whitepaper.pdf',
  'http://localhost/files/media-kit.zip',
  'http://localhost/files/pricing.xlsx',
];

const ipPool = Array.from({ length: 30 }, (_, i) => `203.0.113.${i + 1}`);

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function send(body, ua, ip) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': ua,
      'cf-connecting-ip': ip,
    },
    body: JSON.stringify(body),
  });
  return res.ok;
}

async function run() {
  let ok = 0;
  let failed = 0;
  const start = Date.now();

  for (let i = 0; i < COUNT; i++) {
    const ua = pick(userAgents);
    const ip = pick(ipPool);
    const path = pick(paths);
    const ref = pick(referrers);
    const utm = pick(utmMix);
    const sid = `sid_${Math.floor(Math.random() * 200)}`;

    const pageview = {
      t: 'pageview',
      s: SITE_KEY,
      p: path,
      h: 'localhost',
      r: ref,
      sw: pick([1920, 1440, 1366, 390, 428, 768]),
      sid,
      ...utm,
    };

    const sent = await send(pageview, ua, ip);
    if (sent) ok++;
    else failed++;

    // 20% chance: fire a custom event for this visitor after the pageview
    if (Math.random() < 0.2) {
      const evt = {
        t: 'event',
        s: SITE_KEY,
        p: path,
        h: 'localhost',
        r: ref,
        sw: pageview.sw,
        sid,
        en: pick(eventNames),
        ep:
          Math.random() < 0.6
            ? JSON.stringify({
                plan: pick(['free', 'pro', 'team']),
                source: pick(['nav', 'footer', 'hero']),
              })
            : '',
        ev: Math.random() < 0.3 ? Math.round(Math.random() * 100) : 0,
      };
      const sentEvt = await send(evt, ua, ip);
      if (sentEvt) ok++;
      else failed++;
    }

    // 10% chance: an outbound click or file download (auto link events)
    if (Math.random() < 0.1) {
      const outbound = Math.random() < 0.7;
      const link = {
        t: 'event',
        s: SITE_KEY,
        p: path,
        h: 'localhost',
        r: '',
        sw: pageview.sw,
        sid,
        en: outbound ? 'Outbound Link: Click' : 'File Download',
        ep: JSON.stringify({ url: outbound ? pick(outboundUrls) : pick(downloadUrls) }),
        ev: 0,
      };
      const sentLink = await send(link, ua, ip);
      if (sentLink) ok++;
      else failed++;
    }

    if ((i + 1) % 50 === 0) {
      process.stdout.write(`  ${i + 1}/${COUNT}  ok=${ok} failed=${failed}\n`);
    }
  }

  const dur = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone in ${dur}s — ok=${ok} failed=${failed}`);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
