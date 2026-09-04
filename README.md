# Traks

**Self-hosted, privacy-friendly web analytics built entirely on Cloudflare.**

Traks is a lightweight, cookie-free analytics platform that runs end to end on
Cloudflare's data platform — Workers, Durable Objects, D1, Pipelines, R2 Data
Catalog (Apache Iceberg), and R2 SQL. No servers to manage, no third-party
services in the data path, and no personal data stored.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![Built on Cloudflare](https://img.shields.io/badge/built%20on-Cloudflare-orange)

Open source under the MIT license. Free to run, forever: the only cost is your
own Cloudflare usage, which stays inside the free allowances for most sites.
Install it at [traks.dev](https://traks.dev); read the release notes at
[traks.dev/changelog](https://traks.dev/changelog).

## Highlights

- **Privacy-first** — no cookies, no fingerprinting persistence. Visitors are
  counted with a Plausible-style daily-rotating hash
  (`HMAC(secret + date, ip + ua + siteKey)`); raw IP addresses are never stored.
- **Realtime by default** — a hot/cold split serves "today" and live views from
  per-site SQLite Durable Objects in milliseconds, with zero ingest delay. A
  WebSocket pushes live visitors, pages, referrers, and city-level map dots to
  the dashboard as they happen.
- **Cheap at any scale** — history lives in Apache Iceberg on R2 and is queried
  with R2 SQL, edge-cached, and scan-minimized. A side project runs for ~$5/mo;
  50M pageviews/mo lands around $75–85/mo (see [cost model](#what-it-costs-to-run)).
- **Fully self-contained** — auth is [Better Auth](https://better-auth.com)
  on D1 (no auth SaaS), the world map is self-hosted (no tile servers), and the
  dashboard never calls a third party.
- **Agent-ready** — analytics are exposed to AI agents via MCP/WebMCP tools,
  with bot and agent traffic classified and reported alongside human traffic.
- **Tiny tracker** — a single `t.js` script tag, served inline from the edge.

## Architecture

Fresh data is served from per-site Durable Objects in milliseconds; history is
served from Iceberg via R2 SQL.

```
customer site
  └─ t.js tracker (packages/tracker)
       │  POST /api/event
       ▼
collect Worker (apps/platform/collect)            ── site-key auth + timezone (D1)
       │                                    bot filtering, UA/referrer parsing,
       │  dual write                        daily-rotating visitor hash (HMAC)
       ├────────────────────────────┐
       ▼ env.EVENTS.send()          ▼ env.LIVE (SiteLiveStore DO)
Pipelines stream                 HOT PATH: per-site SQLite DO
       │  pass-through pipeline     rolling ~48h event window
       ▼                            zero ingest delay, ms queries
Iceberg sink → R2 Data Catalog      serves: today, realtime
  table `traks.events`                      ▲
  (zstd parquet, 60s roll,                  │
   auto compaction +                        │
   snapshot expiration)                     │
       ▼                                    │
COLD PATH: R2 SQL ◄── api Worker (apps/platform/api) ── Better Auth, D1 metadata
  serves: 7d/30d/90d/1y/all   ▲                today/realtime → DO
  (edge-cached 5-15 min)      │                history → R2 SQL
                              │                (DO failure → R2 SQL fallback)
                 web dashboard (apps/platform/web)
```

### How the pieces fit

- **`apps/platform/collect`** — ingest Worker. Validates the site key against
  D1, filters bots, computes the daily-rotating visitor ID, enriches events
  with Cloudflare geo data, then **dual-writes**: to the Pipelines stream
  (durable system of record) and to the site's **SiteLiveStore Durable Object**
  (hot path). Each write fails independently.
- **`SiteLiveStore` DO** — one SQLite-backed instance per site holding a
  rolling ~48h event window (today plus the previous-day comparison window in
  any timezone). Today/realtime queries run against local SQLite with
  millisecond latency. It is also the **realtime push** source: the dashboard
  opens one authenticated WebSocket (WebSocket Hibernation API) and receives a
  frame — live visitors, their pages, referrers, countries, and city-level
  coordinates — whenever a pageview changes the picture, plus a 30s tick so
  counts decay as visitors leave. Coordinates exist only in this hot window
  and are never written to Iceberg.
- **Pipeline** — pass-through `INSERT INTO <sink> SELECT * FROM <stream>`;
  the stream schema lives in `scripts/pipeline-schema.json`.
- **`apps/platform/api`** — dashboard API. Site/user metadata in D1 (Drizzle);
  historical analytics served by R2 SQL over HTTP, cached at the edge. Also
  serves the dashboard SPA as static assets, so the session cookie is
  first-party by construction.
- **`apps/platform/web`** — the dashboard UI, including the live view with a
  self-hosted dotted world map generated from Natural Earth data.
- **`apps/home`** — the traks.dev site: landing page, docs, and the install
  wizard. The wizard backend has no database and keeps no record of anyone's
  instance: instances are discovered live from the user's own Cloudflare
  account on each sign-in, and a run's progress lives in a Durable Object
  that wipes itself after a day.
- **`packages/tracker`** — the `t.js` tracking snippet.
- **`packages/shared`** — event schema (zod), timezone-aware period math, and
  all R2 SQL query builders.

Bucket keys (`date_key`, `hour_key`, `week_key`) are computed at ingest in the
site's IANA timezone, so dashboard buckets align with the user's local clock.

## Repository layout

```
apps/
  home/            traks.dev site (landing, docs, install wizard)
    api/           home API Worker
    web/           home web app
  platform/        the analytics product
    collect/       ingest Worker + SiteLiveStore Durable Object
    api/           dashboard API Worker (auth, R2 SQL, static assets)
    web/           dashboard SPA
packages/
  tracker/         t.js tracking script
  shared/          event schema, period math, R2 SQL query builders
  eslint-config/   shared lint config
  typescript-config/ shared tsconfig
installer/         release build + upload tooling
scripts/           data-platform provisioning, seeding, tracker inlining
```

Monorepo managed with Yarn workspaces + Turborepo. Requires Node ≥ 20.

## Getting started

### Use Traks

You do not need this repository to run Traks. Open
[traks.dev/deploy](https://traks.dev/deploy), sign in with Cloudflare, and the
wizard provisions everything into your own account in about two minutes:
both Workers, D1, KV, the R2 bucket with Data Catalog, the Pipelines stream
and Iceberg sink. Updates and removal are one click each at
[traks.dev/update](https://traks.dev/update) and
[traks.dev/destroy](https://traks.dev/destroy). traks.dev keeps no record of
your instance; every visit rediscovers it from your account.

### Develop Traks

The rest of this section is for working on the platform itself.

Secrets come from Doppler and nowhere else (see [Development](#development)).
The maintainers' projects are `traks-api`, `traks-collect`, and `traks-home`;
to run the platform locally you need Doppler projects of your own with those
names and the keys listed below.

**1. Provision a dev data platform** (once per Cloudflare account; reads
`CATALOG_TOKEN` from Doppler `traks-home/prd`):

```sh
./scripts/setup-data-platform.sh dev
```

This creates the R2 bucket, enables the Data Catalog with automatic compaction
(128 MB) and snapshot expiration (30 days / keep 5), then creates the stream,
Iceberg sink (60 s roll interval for ~1-minute dashboard freshness), and
pipeline. Paste the printed stream ID into
`apps/platform/collect/wrangler.toml`.

**2. Migrate D1 and start the dev servers:**

```sh
yarn install
yarn workspace @traks/platform-api db:migrate:dev
yarn dev                                            # collect :5010, api :5011, web :5012, home :5013/:5014
```

| Doppler project (dev config) | Keys                                                              |
| ---------------------------- | ----------------------------------------------------------------- |
| `traks-api`                  | `BETTER_AUTH_SECRET`, `R2_SQL_TOKEN` (Workers R2 SQL Read on the warehouse bucket) |
| `traks-collect`              | `VISITOR_HASH_SECRET`                                             |
| `traks-home`                 | none required                                                     |

**3. Seed test data:**

```sh
node scripts/seed-events.mjs <SITE_KEY> 500
```

### Useful commands

```sh
# Ad-hoc queries (token needs Workers R2 SQL Read)
WRANGLER_R2_SQL_AUTH_TOKEN=<token> npx wrangler r2 sql query \
  "<ACCOUNT_ID>_traks-events-dev" "SELECT COUNT(*) FROM traks.events"

# Catalog / maintenance status
npx wrangler r2 bucket catalog get traks-events-dev

# Pipeline plumbing
npx wrangler pipelines list
npx wrangler pipelines streams list
npx wrangler pipelines sinks list
```

> **Warning:** never delete objects manually in the catalog-enabled bucket —
> data/metadata files under the warehouse prefix are Iceberg table state.

## Authentication

Auth is [Better Auth](https://better-auth.com) running inside the api Worker —
no auth SaaS, no third party. Email + password only; users, sessions, and
credential accounts live in D1.

**First-run claim:** a fresh instance is unclaimed — `/login` shows a "create
your owner account" screen, and the first sign-up claims the instance;
sign-ups are rejected server-side after that. The install wizard mints a
one-time `CLAIM_TOKEN` worker secret and links to `/login?claim=<code>` so
predictable instance hostnames can't be hijacked.

**Recovery** (forgot password, no email sending configured): delete the
owner's row in `accounts` (+ `sessions`) and re-claim with the same email —
site ownership is re-adopted by email.

## What it costs to run

Everything runs inside a Cloudflare Workers Paid plan. Billing for Pipelines,
R2 Data Catalog, and R2 SQL has been live since 3 Aug 2026; each has a monthly
free allowance that most sites never exhaust, so the bill for a small install
is essentially the $5/mo Workers Paid base. With published rates applied:

| Scale        | Traffic                   | Estimated monthly cost    |
| ------------ | ------------------------- | ------------------------- |
| Side project | 100k pageviews, 2–3 sites | **≈ $5** (base plan only) |
| Startup      | 5M pageviews, 10 sites    | **≈ $7–8**                |
| Scale        | 50M pageviews, 100 sites  | **≈ $75–85**              |

The hot/cold split is what keeps costs flat: the always-open "today" dashboard
is served by Durable Objects for ~free, historical queries are minimized to
single scans (CASE split for current + previous period comparisons) and cached
at the edge for 5–15 minutes, and egress is always $0.

<details>
<summary>Full rate table</summary>

| Component                                | Rate                                       | Monthly free allowance (paid plan) |
| ---------------------------------------- | ------------------------------------------ | ---------------------------------- |
| Workers Paid base                        | $5/mo                                      | 10M requests, 30M CPU-ms incl.     |
| Workers requests over included           | $0.30/M                                    | —                                  |
| Durable Objects requests                 | $0.15/M                                    | 1M                                 |
| DO duration                              | $12.50/M GB-s                              | 400k GB-s                          |
| DO SQLite writes / reads / storage       | $1.00/M rows / $0.001/M rows / $0.20/GB-mo | 50M / 25B rows / 5GB               |
| Pipelines: ingest → transform → delivery | free → $0.04/GB → $0.06/GB (Parquet)       | 50GB per dimension                 |
| R2 storage                               | $0.015/GB-mo                               | 10GB                               |
| R2 Data Catalog operations               | $9.00/M                                    | 1M                                 |
| Catalog compaction                       | $0.005/GB + $2.00/M objects                | 10GB + 1M objects                  |
| R2 SQL                                   | $2.50/TB scanned (10MB min/query)          | 10GB scanned                       |

</details>

## Cloudflare data platform status

R2 Data Catalog, R2 SQL, and Pipelines are still **open beta** (as of
Sep 2026) but production-trending: pricing is published and billing has been
on since Aug 2026, the catalog has a dedicated dashboard, GraphQL metrics, and
Terraform support, and R2 SQL supports JOINs, CTEs, CASE, window functions,
set operations, exact `COUNT(DISTINCT)`, and ~200 functions.

Known platform gaps this codebase works around: catalog sinks have no
user-defined partition spec and cannot be modified or re-attached to an
existing table (so a sink's roll interval is fixed for the table's lifetime),
stream schemas are immutable, R2 SQL has no timezone conversion and no
metrics dataset for bytes scanned, and every R2 SQL query bills a 10 MB
minimum.

Platform features this codebase relies on:

| Feature                                                      | Since               | Where used                            |
| ------------------------------------------------------------ | ------------------- | ------------------------------------- |
| Streams/sinks/pipelines split, exactly-once Iceberg delivery | Sep 2025            | ingest path                           |
| `stream` key in `[[pipelines]]` Workers binding              | Jun 2026            | `apps/platform/collect/wrangler.toml` |
| Automatic compaction (64–512 MB target)                      | Sep 2025            | `scripts/setup-data-platform.sh`      |
| Snapshot expiration incl. data-file cleanup                  | Dec 2025 / Apr 2026 | `scripts/setup-data-platform.sh`      |
| R2 SQL aggregations + `approx_distinct`                      | Dec 2025            | all stat queries                      |
| R2 SQL CASE + expression GROUP BY                            | Mar 2026            | single-scan period comparison         |
| R2 SQL CTEs + subqueries                                     | Mar–May 2026        | bounce-rate session rollup            |

## Abuse guards

Ingest is protected without any per-event database reads: the collect Worker
applies per-site-key burst limits counted per colo, caches site-key auth per
isolate, and accepts events only from the site's registered domain, its
subdomains, and localhost.

## Development

```sh
yarn dev          # run all apps (collect :5010, api :5011, web :5012)
yarn lint         # lint all workspaces
yarn type-check   # typecheck all workspaces
yarn build        # build all workspaces
yarn check:ci     # everything CI runs: format, lint, build, db, tracker
```

**Secrets come from Doppler only.** Nothing reads a secret from the shell
environment or a local file. The `dev` scripts download each Worker's dev
config (`traks-api`, `traks-collect`, `traks-home`) into a git-ignored
`.dev.vars.doppler` and hand it to `wrangler dev`; the release and setup
scripts under `installer/` and `scripts/` read `traks-home/prd`. Running any of
them needs `doppler login` and access to those projects (or Doppler projects of
your own with the same names and keys: `VISITOR_HASH_SECRET` for collect,
`BETTER_AUTH_SECRET` and `R2_SQL_TOKEN` for the api, `ADMIN_KEY` for home).

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md)
for the setup, the checks to run, and how release notes work. Security issues
go through [SECURITY.md](SECURITY.md), not the public tracker.

## License

[MIT](LICENSE) © 2026 Shivaprasad Manupadi
