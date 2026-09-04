# Changelog

Platform releases only: what a self-hosted instance receives when it updates.
Work on traks.dev itself (landing page, docs, install wizard, operator admin)
ships separately and is not listed here.

## Unreleased

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
