# Traks

Self-hosted, privacy-friendly web analytics built entirely on Cloudflare's data
platform: Workers, D1, Pipelines, R2 Data Catalog (Apache Iceberg), and R2 SQL.

## Architecture

```
customer site
  └─ t.js tracker (packages/tracker)
       │  POST /api/event
       ▼
collect Worker (apps/collect)          ── site-key auth + timezone (D1)
       │  env.EVENTS.send([record])       bot filtering, UA/referrer parsing,
       ▼                                  daily-rotating visitor hash (HMAC)
Pipelines stream (traks_events_stream)
       │  pass-through SQL pipeline
       ▼
Iceberg sink → R2 Data Catalog table `traks.events`
       │  (zstd parquet, 60s roll interval,
       │   automatic compaction + snapshot expiration)
       ▼
R2 SQL  ◄── api Worker (apps/api)      ── Clerk auth, site metadata in D1,
                 ▲                        dashboard aggregation queries
                 │
web dashboard (apps/web)               ── React + TanStack Router
```

- **`apps/collect`** — ingest Worker. Validates the site key against D1,
  filters bots, computes a Plausible-style daily-rotating visitor ID
  (`HMAC(secret+date, ip+ua+siteKey)` — raw IPs are never stored), enriches
  with Cloudflare geo data, and sends the event to the Pipelines **stream
  binding** (`env.EVENTS.send()`).
- **Pipeline** — pass-through `INSERT INTO <sink> SELECT * FROM <stream>`.
  The stream schema lives in `scripts/pipeline-schema.json`.
- **`apps/api`** — dashboard API. Site/user metadata in D1 (drizzle), all
  analytics served by R2 SQL over HTTP
  (`api.sql.cloudflarestorage.com/.../r2-sql/query/<bucket>`).
- **`apps/web`** — dashboard UI.
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
| `stream` key in `[[pipelines]]` Workers binding (replaces `pipeline`) | Jun 2026 | `apps/collect/wrangler.toml` |
| Automatic compaction (64–512 MB target) | Sep 2025 | `scripts/setup-data-platform.sh` |
| Snapshot expiration incl. data-file cleanup | Dec 2025 / Apr 2026 | `scripts/setup-data-platform.sh` |
| R2 SQL aggregations + `approx_distinct` | Dec 2025 | all stat queries |
| R2 SQL CASE + expression GROUP BY | Mar 2026 | single-scan current/previous comparison |
| R2 SQL CTEs + subqueries | Mar–May 2026 | bounce-rate session rollup |

### Query cost model

R2 SQL will bill **$2.50/TB scanned with a 10 MB minimum per query**, so the
API minimizes query count:

- current + previous period stats: **one** scan (CASE split on the boundary)
- bounce rate: one per-session CTE scan (also both periods)
- sites-list batch stats: **one** `GROUP BY site_id` query per distinct site
  timezone, not one per site
- every R2 SQL result is cached at the edge (Workers Cache API) keyed by the
  SQL text, with `now` quantized to the minute so repeat loads hit the cache:
  60s TTL for `today`, 5–15 min for historical periods. Table freshness is
  bounded by the sink roll interval anyway, so the cache hides no data — it
  turns repeat dashboard loads from ~1–3s per tile into cache hits.

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
printed stream ID into `apps/collect/wrangler.toml`.

### 2. D1 + Workers

```sh
yarn install
yarn workspace @traks/api db:migrate:dev   # or db:migrate:prod
yarn dev                                   # collect :5010, api :5011, web :5012
```

Secrets come from Doppler (see comments in each `wrangler.toml`). The api
Worker needs `R2_SQL_TOKEN` with **Workers R2 SQL Read + Workers R2 Data
Catalog Write + Workers R2 Storage Write** (or an R2 Admin Read & Write account
token), plus `R2_ACCOUNT_ID` and `CLERK_SECRET_KEY`. The collect Worker needs
`VISITOR_HASH_SECRET`.

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
