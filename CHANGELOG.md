# Changelog

Platform releases only: what a self-hosted instance receives when it updates.
Work on traks.dev itself (landing page, docs, install wizard, operator admin)
ships separately and is not listed here.

## Unreleased

## 0.1.47 - 2026-11-03

### Fixed

- The events bucket no longer grows by gigabytes. Every minute the analytics table wrote a new copy of its metadata file and never removed the old ones, so the bucket filled with copies of a file only the newest of which is used, along with growing storage and operation counts. The instance now tells the table to keep only its last 10 metadata files and, once a day, removes the old copies already in the bucket. Your analytics data is not touched. Buckets that already grew shrink back within a day of updating. Snapshot history is now kept for 2 days instead of 30, applied the next time you run Update from traks.dev.

## 0.1.46 - 2026-10-28

### Changed

- Custom ranges are picked on a calendar instead of two browser date fields. It opens under the period switch with quick ranges beside it (this or last month, this or last quarter, year to date, last year). From and To above the calendar show the two days; click From or To, then a day, to set that end. The selected end stays selected, and days that would put the range backwards are greyed out. Click the month title to jump by month, then by year, to any day since 2000. The calendar button keeps its size while a range is active, so the switch no longer shifts; the range's days show above the chart and in the button's tooltip. On phones the same calendar opens from the period menu.
- The line under the site dashboard header is gone.
- Each account can now add up to 10 sites (was 5). Accounts on the old limit move up when the instance updates; a limit you set by hand, including 0 for unlimited, is kept.

## 0.1.45 - 2026-10-28

### Added

- Sort your sites. The Sites page has a sort menu next to search: date added (the order so far), name, or visitors today, busiest first. Your choice is remembered in this browser.
- Custom date ranges. The period picker has a calendar option for any span of whole days, both ends included and counted in the site's timezone, so you can report on a campaign or a billing month. Ranges are shareable links (`?period=2026-03-01..2026-03-15`) and are accepted by the API and every MCP tool that takes a period. Public share pages keep the preset periods. A range that runs into today trails live numbers by a few minutes.
- Filter by custom property. Click a property in a custom event's breakdown to filter the dashboard to the visits that carried it: their pageviews, goals and visit duration all count, while a page tagged with a different value (another tenant in the same visit) stays out. Combine up to five. The API takes the same filter as `props={"spaceid":"organizer-123","eventid":"event-456"}`, and saved segments keep it.

### Changed

- The site dashboard header is restyled: hand-drawn sticker icons for its actions with no borders around them, a larger site name with its domain, Public and live count on one line, and the period picker as a switch whose ink thumb slides to the selected period. Everything in it works as before.
- The Page flow card is redesigned and now sits directly above Goals. The page in the middle shows its visits and how they split (continued, left the site, started here), each neighbouring page shows its share of those visits with a line to the middle sized by it, and the page picker sits beside the title. Following a page builds a trail you can step back through. The paths API (`/stats/paths`) also returns these `totals`.
- Scrapers that run a real browser no longer count as visitors. Pageviews from cloud and hosting networks (AWS, Google Cloud, OVH, Hetzner, DigitalOcean and similar), from browsers that report being automated (Puppeteer, Playwright, Selenium), and from Cloudflare-verified crawlers using a browser user agent are now counted in the Bots panel, named "Datacenter (network)" (e.g. "Datacenter (AWS)"), "Automated Browser" or "Verified bot (category)"; verified crawlers appear under the matching Bots tab (Search, AI or Social). Custom events from cloud networks are kept aside rather than discarded: they don't count toward goals, but they aren't lost. Sites crawled this way will see visitor counts drop toward what other analytics tools report. People on consumer VPNs are still counted.

### Fixed

- Pageviews sent to the Plausible-compatible endpoint now keep their custom properties (they were dropped; custom events kept theirs), and so do Plausible engagement beacons, so visit duration follows a property filter. Properties sent as a JSON string are stored in compact form so they match filters and goal conditions exactly.

## 0.1.44 - 2026-10-16

### Added

- Page flow: a new dashboard card shows, for one page, which pages visits came from right before it and went to right after it. It starts on your top page (or the page you're filtered to); pick another, or click a page on either side to follow the path a step further. Reloads don't count as a step, and dashboard filters select whole visits. Agents can ask the same question for a page or a section such as `/docs/*` with the new `get_paths` MCP tool.
- Conversions by source: a new card under Goals shows, for each UTM source, medium or campaign, the visits it brought, how many completed a goal (any goal, or one you pick) and the conversion rate. A visit is credited to the tags on its first page. The card appears once a site has a goal. Available to agents as the new `get_attribution` MCP tool.
- The Bots panel has tabs for search engines, AI crawlers, social link previews and other bots, each showing that group's top bots. Agents get each bot's category (search, AI, social, SEO, monitoring or other) from `get_bot_stats`. Google's Vertex AI crawler is now recognised as an AI crawler.

### Changed

- The dashboard works on phones and tablets. The header tabs fold into a menu, the period picker becomes a single dropdown, the metric tiles sit in two rows of three, funnels show one bar per step, and nothing scrolls sideways down to 320px wide. Form fields no longer make iOS zoom in when you tap them.
- UTM tags now last the whole visit. Before, only the landing pageview carried a visit's UTM source, medium and campaign; now every pageview, custom event and engagement ping in that session carries them too (a session ends after 30 minutes idle, and a new tagged link replaces the tags). Filtering by a UTM value now shows the whole visit's pages, goals, bounce rate and duration. From this update onwards, UTM-filtered views show more pageviews and conversions than before; visitor counts per UTM value are unchanged. Visitors pick up the new tracker within a day (the script is cached for up to an hour, then refreshed in the background).

### Fixed

- On touch screens, a saved segment's delete button was invisible because it only appeared on hover. It now shows on touch screens.
- The timezone picker opens scrolled to the current timezone instead of the top of the list.

## 0.1.43 - 2026-09-23

### Changed

- Removed an unused rate-limit check from the public dashboard API. Public dashboards behave exactly as in 0.1.42.

## 0.1.42 - 2026-09-23

### Added

- Public dashboards: the new Share button on a site makes its dashboard public at `/share/<site id>`. Traffic is always shown; goals, funnels and custom events are each opt-in. Visitors can switch periods and filter, but never see the live view, links, bots or agent tools.
- An API tokens tab lists your tokens with their scope, last use and creation date, shows a new token once with a copy button, and revokes a token after a confirmation.
- "Contact us", in the account menu and as a new mail icon in the header, shows the contact details in place instead of opening a mail client.

### Changed

- Goals are scorecards: each goal's conversion rate over a bar filled to that rate, with edit, duplicate and delete in a menu on the tile.
- Funnels show one column per step with the sessions lost since the previous step. The funnel form is one row per step, and steps can be reordered by dragging or with the arrow keys.
- The All goals and All funnels drawers are cards with an always-visible menu, and opening a form from a drawer closes the drawer first.
- Settings has a card per setting, says in words whether you are an owner or a member, and lists every site's timezone next to the current time in the chosen zone. Members now see the reporting timezone.
- Tokens moved from the MCP server page to the API tokens tab, and the account menu links to traks.dev instead.
- On the site dashboard, Custom events sit beside Links and Agent tools beside Bots, with Goals and Funnels closing the page.

### Fixed

- A goal could not be saved as a page visit if a property filter had been typed while it was an event goal.
- The goal and funnel forms no longer flag empty fields before you type, and no longer jump while a property filter is half filled.
- Switching workspaces in Settings no longer keeps the previous workspace's timezone selected.

## 0.1.41 - 2026-09-10

### Added

- The MCP server page is built around connecting a client: pick Claude Code, Claude Desktop, Cursor, VS Code, Windsurf or Zed and get that client's exact config, create a token in place and it is filled into the snippet, and a tool reference lists every tool and which ones need a Manage token.
- "Contact us" in the account menu opens a mail to hello@traks.dev.

### Changed

- Switching the period no longer looks like a dead click: the refresh icon spins and the panels dim while the new period's numbers load.
- "Yesterday" is scanned once per day instead of every 15 minutes, and the dashboard prefetches it behind today's view so the first click of the day is instant.

## 0.1.40 - 2026-09-04

### Changed

- Settings is a single card again: the side navigation was removed, since three sections never needed one.
- The account menu is reordered (MCP server & tokens, Check for updates, Destroy this instance, Sign out) and no longer repeats the version and instance name that the header pill already shows.
- The destroy briefing is shorter and easier to scan: what gets removed as a short list, the events-bucket caveat as a callout, and a "Continue on traks.dev" button that makes clear nothing is deleted until the wizard confirms.

## 0.1.39 - 2026-09-04

### Added

- `/api/health` reports the instance's running `version`, so anything that can reach the dashboard can read it without a Cloudflare token.
- Destroy this instance from the account menu: a briefing of exactly what gets deleted, then the traks.dev destroy wizard opens with the instance pre-filled.

### Changed

- The API tab is now "MCP server" at `/portal/mcp`; the old `/portal/api` address redirects.
- The dashboard's Update link now tells traks.dev which instance is asking (its own address, name, and version) instead of a wizard session id, so the update page shows it immediately and pre-selects it after sign-in. traks.dev keeps no record of instances.

### Fixed

- Historical queries retry once when R2 SQL reports a transient edge connection failure (error 80001) instead of failing the dashboard panel.

## 0.1.38 - 2026-08-27

### Added

- Bot traffic and WebMCP agent tool calls get their own analytics in the dashboard.

## 0.1.37 - 2026-08-24

### Changed

- Performance pass across ingest, queries, and the dashboard, removing work that was being done twice.

## 0.1.36 - 2026-08-24

### Added

- The collect Worker accepts Plausible-compatible event payloads, so a site can migrate by pointing Plausible's script at a Traks instance.

## 0.1.35 - 2026-08-23

### Fixed

- The api Worker failed to boot in some cases because the pre-warm token was generated at startup; it is now created lazily.

## 0.1.34 - 2026-08-23

### Changed

- Dashboard breakdowns are read with one GROUPING SETS scan instead of eight separate queries, cutting R2 SQL cost and latency for historical periods.

## 0.1.33 - 2026-08-23

### Added

- A pre-warm cron keeps the historical caches fresh for sites viewed in the last few hours, so returning to a dashboard is instant and current.

## 0.1.32 - 2026-08-23

### Changed

- Historical queries bound the table's ingest-time partition so R2 SQL skips whole manifests, and query timings are logged for telemetry.

## 0.1.31 - 2026-08-21

### Changed

- Panel rows use the shared inset tone.

## 0.1.30 - 2026-08-21

### Added

- The live-visitors pill in the header opens a filterable realtime map.

## 0.1.29 - 2026-08-21

### Changed

- The realtime globe was rewritten from scratch.

## 0.1.28 - 2026-08-21

### Added

- Realtime dashboard updates over WebSocket and a live visitor globe.

## 0.1.27 - 2026-08-19

### Changed

- Settings page: side navigation with scroll-spy and one card of label/control sections.
- Members page: roster table with pending invites and an always-visible invite panel.
- API and MCP page: three-step connect strip over a per-workspace tokens table.
- The site favicon refreshes on every save.

### Fixed

- Pre-launch audit: first-run claim code, token scope, period math, and tracker clamps.

## 0.1.26 - 2026-08-18

### Changed

- Brand logos in the install-guide picker, smoother scroll lock in drawers, and copy cleanup.

## 0.1.25 - 2026-08-18

### Changed

- Goal and funnel management redesigned around drawers with rebuilt forms.

## 0.1.24 - 2026-08-14

### Added

- The tracker pre-loads an event queue on `window.traks`, so calls made before the script finishes loading are not lost.

### Fixed

- Pageview loss in some navigation patterns, funnel snapshot drift, and gaps in the MCP tools.

## 0.1.23 - 2026-08-14

### Added

- Check for updates on demand from the account menu.
- Read-only API tokens can use the MCP transport.

### Changed

- The chart returns to the ink line, the site header sticks under the app header, and the site page gets real tooltips and a quieter funnels panel.

## 0.1.22 - 2026-08-14

### Added

- MCP server and API tokens, so coding agents can operate Traks.
- API tokens and MCP have their own tab, and the agent skill has a header tab.
- API tokens are bound to a single workspace.

### Changed

- Flattened controls, a lighter ground, filled inputs, and stat-rail tiles beside the chart.

## 0.1.21 - 2026-08-14

### Added

- Install guides, personalized with your site key inside the dashboard.
- Goals and funnel steps can match on event props and on `/*` page prefixes.
- Separate flows for adding, managing, and editing goals.

### Changed

- The surface palette is warmed to Porcelain, and Goals, Custom Events, and Links become full-width tiles.

## 0.1.20 - 2026-08-14

### Added

- AI assistants are tracked as their own traffic channel, classified from the referrer.

## 0.1.19 - 2026-08-14

### Changed

- The running version moves out of the user menu into a header pill.
- Site tiles lose their chrome so the hue lives only in the chart line, and browser and OS rows use full-color brand logos.

### Fixed

- Unfiltered bundle data no longer re-seeds after a filter chip lands.
- Site creation shows success with the site's favicon and the snippet below it.

## 0.1.18 - 2026-08-14

### Changed

- No platform changes; this release accompanied the split of the traks.dev wizard into deploy, update, and destroy pages.

## 0.1.17 - 2026-08-14

### Fixed

- Sites created before favicon support get their favicon backfilled on any edit.

## 0.1.16 - 2026-08-14

### Added

- Country flags, site favicons, and browser, OS, and device icons across the dashboard.

## 0.1.15 - 2026-08-07

### Changed

- Every form is validated, starting with the site domain.

## 0.1.14 - 2026-08-07

### Added

- Workspaces: sites are grouped under workspaces with membership-based access.
- Workspace invitations and role-based access control.

### Changed

- Performance pass across the dashboard.

## 0.1.13 - 2026-08-06

### Changed

- No platform changes; rebuild of the previous release.

## 0.1.12 - 2026-08-06

### Added

- Dashboard failure states and stable panel rows.

### Changed

- Two privacy cleanups in what the dashboard stores and shows.

## 0.1.11 - 2026-08-06

### Changed

- Bounded historical scans, request fan-out, and storage growth.

## 0.1.10 - 2026-08-06

### Fixed

- Corrected the numbers the dashboard shows across periods and panels.

## 0.1.9 - 2026-08-06

### Added

- Per-site rate limits at ingest.
- Origin-bound ingest: a site key accepts events only from its registered domain, its subdomains, and localhost.

## 0.1.8 - 2026-08-06

### Added

- Stable site identity, durable ingest, and a safe first-run claim for a fresh instance.

## 0.1.7 - 2026-08-06

### Fixed

- Visitor IDs rotate on the site's own day boundary instead of UTC.
- Dashboard failure modes surface as errors instead of empty panels.

## 0.1.6 - 2026-08-06

### Fixed

- "Online now" counted distinct visitors instead of summing per-page counts.

## 0.1.5 - 2026-08-06

### Fixed

- A missing Iceberg table on a fresh instance is treated as zero events, not a query failure.

## 0.1.4 - 2026-08-06

### Added

- The installed version is shown in the dashboard.

## 0.1.3 - 2026-08-06

### Changed

- No platform changes; rebuild of the previous release.

## 0.1.2 - 2026-08-06

### Changed

- No platform changes; release tooling only.

## 0.1.1 - 2026-08-06

### Added

- First installable release: pageviews, custom events, goals, funnels, and saved segments; a hot path for today and realtime served from Durable Objects and a cold path for history on Iceberg and R2 SQL; self-hosted sign-in with Better Auth; and the `t.js` tracker.
