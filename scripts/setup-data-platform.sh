#!/usr/bin/env bash
#
# Provision the Traks data platform on Cloudflare for one environment:
#
#   R2 bucket -> R2 Data Catalog (Iceberg) -> automatic table maintenance
#   Pipelines stream -> pass-through pipeline -> Iceberg sink (traks.events)
#
# Usage:
#   CATALOG_TOKEN=<token> ./scripts/setup-data-platform.sh dev
#   CATALOG_TOKEN=<token> ./scripts/setup-data-platform.sh prod
#
# CATALOG_TOKEN needs "Workers R2 Data Catalog Write" + "Workers R2 Storage
# Write" permission groups (dashboard shortcut: R2 "Admin Read & Write" account
# token). It is stored by Cloudflare as the service credential that compaction,
# snapshot-expiration, and the Iceberg sink use.
#
# Idempotency: `create` commands fail if the resource already exists — comment
# out completed steps when re-running, or delete the resource first. Pipeline
# SQL is immutable after creation (delete + recreate to change it).
#
# After running, paste the printed stream ID into the [[pipelines]] binding in
# apps/collect/wrangler.toml (`stream = "<id>"`).

set -euo pipefail

ENV="${1:-}"
if [[ "$ENV" != "dev" && "$ENV" != "prod" ]]; then
  echo "Usage: CATALOG_TOKEN=<token> $0 <dev|prod>" >&2
  exit 1
fi
: "${CATALOG_TOKEN:?Set CATALOG_TOKEN (see header comment for required scopes)}"

if [[ "$ENV" == "prod" ]]; then
  BUCKET="traks-events"
  STREAM="traks_events_stream"
  SINK="traks_events_sink"
  PIPELINE="traks_events"
else
  BUCKET="traks-events-dev"
  STREAM="traks_events_dev_stream"
  SINK="traks_events_dev_sink"
  PIPELINE="traks_events_dev"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRANGLER="npx wrangler"

echo "==> [1/6] R2 bucket: $BUCKET"
$WRANGLER r2 bucket create "$BUCKET"

echo "==> [2/6] Enable R2 Data Catalog on $BUCKET"
$WRANGLER r2 bucket catalog enable "$BUCKET"

echo "==> [3/6] Enable automatic compaction (target 128 MB - recommended for streaming ingest)"
$WRANGLER r2 bucket catalog compaction enable "$BUCKET" \
  --target-size 128 \
  --token "$CATALOG_TOKEN"

echo "==> [4/6] Enable snapshot expiration (30 days, keep >= 5; also reclaims unreferenced data files)"
$WRANGLER r2 bucket catalog snapshot-expiration enable "$BUCKET" \
  --older-than-days 30 \
  --retain-last 5 \
  --token "$CATALOG_TOKEN"

echo "==> [5/6] Pipelines stream + Iceberg sink"
# HTTP ingest disabled: events only enter through the collect Worker binding.
$WRANGLER pipelines streams create "$STREAM" \
  --schema-file "$SCRIPT_DIR/pipeline-schema.json" \
  --http-enabled false

# roll-interval 60s is the documented minimum and is safe now that automatic
# compaction merges the small files it produces; it bounds dashboard/realtime
# staleness at ~1 minute (was 300s default).
$WRANGLER pipelines sinks create "$SINK" \
  --type r2-data-catalog \
  --bucket "$BUCKET" \
  --namespace traks \
  --table events \
  --format parquet \
  --compression zstd \
  --roll-interval 60 \
  --catalog-token "$CATALOG_TOKEN"

echo "==> [6/6] Pass-through pipeline: $STREAM -> $SINK"
$WRANGLER pipelines create "$PIPELINE" \
  --sql "INSERT INTO $SINK SELECT * FROM $STREAM"

echo
echo "Done. Next steps:"
echo "  1. Copy the stream ID above into apps/collect/wrangler.toml ([[pipelines]] stream = ...)"
echo "  2. Verify with: $WRANGLER r2 sql query \"<ACCOUNT_ID>_$BUCKET\" 'SELECT COUNT(*) FROM traks.events'"
echo "     (token in WRANGLER_R2_SQL_AUTH_TOKEN; needs Workers R2 SQL Read as well)"
