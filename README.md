# Traks

Self-hosted, privacy-friendly web analytics built entirely on Cloudflare's data
platform: Workers, D1, Pipelines, R2 Data Catalog (Apache Iceberg), and R2 SQL.

## Architecture

Hot/cold split: fresh data is served from per-site Durable Objects in
milliseconds; history is served from Iceberg via R2 SQL.

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

- **`apps/platform/collect`** — ingest Worker. Validates the site key against D1,
  filters bots, computes a Plausible-style daily-rotating visitor ID
  (`HMAC(secret+date, ip+ua+siteKey)` — raw IPs are never stored), enriches
  with Cloudflare geo data, then **dual-writes**: the Pipelines stream
  (`env.EVENTS.send()`, durable system of record) and the site's
  **SiteLiveStore Durable Object** (hot path). Each write fails independently.
- **`SiteLiveStore` DO** (defined in collect, read by api via cross-script
  binding) — one SQLite-backed instance per site holding a rolling ~48h event
  window (today + the previous-day comparison window in any timezone). An
  hourly alarm prunes old rows. Today/realtime queries run against local
  SQLite: **millisecond latency, zero ingest delay**.
  It is also the **realtime push** source: the dashboard opens one WebSocket
  (`/api/analytics/:siteId/stats/realtime/ws`, authenticated by the api worker
  and proxied to the DO over the same binding; WebSocket Hibernation API) and
  receives a frame — visitors in the last 5 minutes, their pages, and their
  city-level coordinates for the globe — whenever a pageview changes the
  picture (coalesced to one query per 2s) plus a 30s tick while subscribed,
  so the count decays as visitors leave. Coordinates come from `request.cf`
  and exist only in this hot window; they are never written to Iceberg. The
  REST `/stats/realtime` route (and 30s polling) remains the fallback.
- **Pipeline** — pass-through `INSERT INTO <sink> SELECT * FROM <stream>`.
  The stream schema lives in `scripts/pipeline-schema.json`.
- **`apps/platform/api`** — dashboard API. Site/user metadata in D1 (drizzle), all
  analytics served by R2 SQL over HTTP
  (`api.sql.cloudflarestorage.com/.../r2-sql/query/<bucket>`).
- **`apps/platform/web`** — dashboard UI.
- **`packages/shared`** — event schema (zod), timezone-aware period math, and
  all R2 SQL query builders.

Bucket keys (`date_key`, `hour_key`, `week_key`) are computed at ingest in the
site's IANA timezone so dashboard buckets align with the user's local clock.

## Cloudflare data platform status (July 2026)

R2 Data Catalog, R2 SQL, and Pipelines are still **open beta** — there has been
no formal GA — but they are production-trending: pricing was published in
May 2026 (billing off until ≥30 days notice), the catalog got a dedicated
dashboard, GraphQL metrics, and Terraform support, and R2 SQL now supports
JOINs, CTEs, CASE, window functions, set operations, and ~200 functions.

Platform features this codebase relies on:

| Feature | Since | Where used |
|---|---|---|
| Streams/sinks/pipelines split, exactly-once Iceberg delivery | Sep 2025 | ingest path |
| `stream` key in `[[pipelines]]` Workers binding (replaces `pipeline`) | Jun 2026 | `apps/platform/collect/wrangler.toml` |
| Automatic compaction (64–512 MB target) | Sep 2025 | `scripts/setup-data-platform.sh` |
| Snapshot expiration incl. data-file cleanup | Dec 2025 / Apr 2026 | `scripts/setup-data-platform.sh` |
| R2 SQL aggregations + `approx_distinct` | Dec 2025 | all stat queries |
| R2 SQL CASE + expression GROUP BY | Mar 2026 | single-scan current/previous comparison |
| R2 SQL CTEs + subqueries | Mar–May 2026 | bounce-rate session rollup |

### Query cost + latency model

The hot path (Durable Objects) serves the most-viewed data (today/realtime)
in milliseconds for ~free. R2 SQL — which will bill **$2.50/TB scanned with a
10 MB minimum per query** — only sees historical-period queries, and those are
minimized:

- today/realtime: served by the site's DO — no R2 SQL at all
- current + previous period stats: **one** scan (CASE split on the boundary)
- bounce rate: one per-session CTE scan (also both periods)
- sites-list batch stats ('today'): DO totals per site; other periods: **one**
  `GROUP BY site_id` query per distinct site timezone
- every R2 SQL result is cached at the edge (Workers Cache API) keyed by the
  SQL text, with `now` quantized to the minute so repeat loads hit the cache:
  60s TTL for `today` (fallback only), 5–15 min for historical periods

## Pricing: what this costs to run

Rates as published May 28, 2026. **Billing for Pipelines, R2 Data Catalog, and
R2 SQL is not yet enabled** (Cloudflare promises ≥30 days notice), so today
the real bill is essentially the $5 Workers Paid base. Estimates below assume
billing is on. Egress is always $0.

| Component | Rate | Monthly free allowance (paid plan) |
|---|---|---|
| Workers Paid base | $5/mo | 10M requests, 30M CPU-ms incl. |
| Workers requests over included | $0.30/M | — |
| Durable Objects requests | $0.15/M | 1M |
| DO duration | $12.50/M GB-s | 400k GB-s |
| DO SQLite writes / reads / storage | $1.00/M rows / $0.001/M rows / $0.20/GB-mo | 50M rows / 25B rows / 5GB |
| Pipelines: ingest → transform → delivery | free → $0.04/GB → $0.06/GB (Parquet) | 50GB per dimension |
| R2 storage | $0.015/GB-mo | 10GB |
| R2 Data Catalog operations | $9.00/M | 1M |
| Catalog compaction | $0.005/GB + $2.00/M objects | 10GB + 1M objects |
| R2 SQL | $2.50/TB scanned (10MB min/query) | 10GB scanned |

### Worked examples

Assumptions: ~0.6KB JSON per event through Pipelines, ~0.15KB/event as
compressed Parquet at rest, dashboards mostly view "today" (DO, ~free), and
only cache-miss historical queries reach R2 SQL.

**Side project — 100k pageviews/mo, 2–3 sites:**
every metered dimension sits inside free allowances (0.25M Worker requests,
0.06GB pipeline volume, ~9GB/mo R2 SQL from occasional historical views).
**Total ≈ $5/mo** (the Workers Paid base).

**Startup — 5M pageviews/mo, 10 sites, team dashboards open all day:**
Workers requests ~11M (events + tracker script + API) → $0.30 over included;
DO ~5M requests → ~$0.60; Pipelines 3GB → free; R2 storage grows
~0.75GB/mo → pennies; R2 SQL ~600 cache-miss historical queries/day × ~30MB
scanned ≈ 540GB/mo → ~$1.35. **Total ≈ $7–8/mo.**

**Scale — 50M pageviews/mo, 100 sites:**
Workers ~105M requests → ~$28.50; DO 50M requests → ~$7.35 (duration and row
writes still near allowances); Pipelines 30GB → free; R2 storage ~90GB after a
year → ~$1.35/mo; compaction ~$0.10; R2 SQL is the swing factor — at ~5,000
cache-miss queries/day × ~100MB scanned ≈ 15TB/mo → ~$37.50.
**Total ≈ $75–85/mo.**

The pattern: the $5 base dominates until millions of pageviews; after that,
raw Worker/DO request volume and R2 SQL scan volume grow linearly with
traffic and dashboard usage respectively. The hot/cold split is what keeps
R2 SQL spend flat-ish — the always-open "today" dashboard never touches it.

Pipelines will bill $0.04/GB transformed + $0.06/GB delivered (Parquet);
catalog compaction $0.005/GB + $2/million objects. Egress is $0.

## Setup

### 1. Provision the data platform (per environment)

```sh
CATALOG_TOKEN=<r2-admin-token> ./scripts/setup-data-platform.sh dev
CATALOG_TOKEN=<r2-admin-token> ./scripts/setup-data-platform.sh prod
```

Creates the bucket, enables the catalog + automatic compaction (128 MB) +
snapshot expiration (30 days / keep 5), then creates the stream, Iceberg sink
(60s roll interval for ~1-minute dashboard freshness), and pipeline. Paste the
printed stream ID into `apps/platform/collect/wrangler.toml`.

### 2. D1 + Workers

```sh
yarn install
yarn workspace @traks/api db:migrate:dev   # or db:migrate:prod
yarn dev                                   # collect :5010, api :5011, web :5012
```

Secrets come from Doppler (see comments in each `wrangler.toml`). The api
Worker needs `R2_SQL_TOKEN` with **Workers R2 SQL Read + Workers R2 Data
Catalog Write + Workers R2 Storage Write** (or an R2 Admin Read & Write account
token), plus `R2_ACCOUNT_ID`. The collect Worker needs
`VISITOR_HASH_SECRET`.

### Auth (Better Auth, self-hosted)

Auth is [Better Auth](https://better-auth.com) running inside the api Worker —
no auth SaaS, no third party. Email + password only; users, sessions, and
credential accounts live in D1 (`users`, `sessions`, `accounts`,
`verifications` in `apps/platform/api/src/db/schema.ts`). Endpoints mount at
`/api/auth/*` (`apps/platform/api/src/lib/auth.ts`); `requireAuth` resolves the session
cookie via `auth.api.getSession`.

**First-run claim**: a fresh instance is unclaimed — `/login` shows a
"create your owner account" screen (driven by `GET /api/claim-status`), and
the first sign-up claims the instance; sign-ups are rejected server-side after
that. Instance hostnames are predictable, so the wizard mints a one-time
`CLAIM_TOKEN` worker secret (re-minted by any wizard run that finds the
instance still unclaimed) and links to `/login?claim=<code>`; the sign-up
hook requires it (plus the `OWNER_EMAIL` pin on OAuth installs). The code is
never persisted on traks.dev. If a pre-existing `users` row matches the claiming email (e.g. the
Clerk-era owner row), its sites and API keys are adopted automatically.
**Recovery** (forgot password, no email sending configured): delete the row
in `accounts` (+ `sessions`) for the owner and re-claim with the same email —
site ownership is re-adopted by email.

Same-origin: the api Worker serves the SPA as its static assets and the API
on one hostname, so the session cookie is first-party by construction; local
dev mirrors this with the vite proxy (`:5012 → :5011`). Secret:
`BETTER_AUTH_SECRET` (Doppler, both configs).

### 3. Seed test data

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

## SaaS layer

- **Plans** (`packages/shared/src/plans.ts`, single source of truth):
  Free ($0: 10k events/mo, 1 site) · Pro ($19: 1M, 10 sites) ·
  Business ($99: 10M, 50 sites). Enforced at ingest
  (monthly quota via the DO usage counter, soft-stop with 10-min recheck)
  and site creation.
- **Billing**: Dodo Payments (merchant of record). Checkout sessions +
  customer portal via `/api/billing`; `/api/webhooks/dodo` (Standard
  Webhooks HMAC) syncs plan state. Secrets: `DODO_API_KEY`,
  `DODO_WEBHOOK_SECRET`; vars: `DODO_API_BASE`, `DODO_PRODUCT_PRO`,
  `DODO_PRODUCT_BUSINESS`. **Gated behind the `BILLING_ENABLED` var**
  (default `"false"` while the Dodo account is in review): when off, checkout/
  portal return 503, the Dodo webhook is inert, and the dashboard shows paid
  plans as "Coming soon". To turn on: set `BILLING_ENABLED="true"`, fill the
  `DODO_PRODUCT_*` vars, and add the `DODO_*` secrets to Doppler.
- **Abuse guards**: plan-aware per-site-key burst limits counted per colo
  (paid: 6,000 events/min ≈ 100/s; free: 1,200/min) — floods get cut while
  legitimate traffic spikes pass; sustained volume is the monthly quota's
  job. Plus isolate-cached key auth in collect (no per-event D1 reads).
- **Ops**: auth is fully self-contained (Better Auth on D1, no sync webhook).
- **Public dashboards**: per-site opt-in; `/share/<siteId>` serves the live
  dashboard through `/api/public`.
- **Web hosting**: the api Worker serves the dashboard + landing + docs as
  its static assets (`[env.production.assets]` → `apps/platform/web/dist`, SPA
  fallback, `run_worker_first` for `/api/*`). One worker, one hostname —
  `cd apps/platform/api && yarn release:prod` builds the web app and ships both
  atomically.

