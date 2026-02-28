#!/usr/bin/env bash
#
# Verify that D1 archive data matches Analytics Engine source data.
# Queries AE directly with the same queries the archive worker uses,
# then compares with what's stored in D1.
#
# Prerequisites:
#   export CF_ACCOUNT_ID="your-account-id"
#   export CF_API_TOKEN="your-api-token"
#
# Usage: bash scripts/verify-archive-vs-ae.sh [date]
#   date defaults to yesterday (the most recent archived day)
#

set -euo pipefail

# --- Config ---
DB="traks-db-prod"
WRANGLER_CFG="apps/api/wrangler.toml"
DATASET="traks"
DATE="${1:-$(date -u -v-1d '+%Y-%m-%d' 2>/dev/null || date -u -d 'yesterday' '+%Y-%m-%d')}"

if [ -z "${CF_ACCOUNT_ID:-}" ] || [ -z "${CF_API_TOKEN:-}" ]; then
  echo "ERROR: CF_ACCOUNT_ID and CF_API_TOKEN must be set."
  echo "  export CF_ACCOUNT_ID='your-account-id'"
  echo "  export CF_API_TOKEN='your-api-token'"
  exit 1
fi

AE_URL="https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/analytics_engine/sql"

echo "=== Archive vs AE Verification — Date: $DATE ==="
echo ""

# --- Helpers ---

query_ae() {
  local sql="$1"
  curl -s "$AE_URL" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -d "$sql"
}

query_d1() {
  local sql="$1"
  npx wrangler d1 execute "$DB" --env production --remote --command "$sql" --json -c "$WRANGLER_CFG" 2>/dev/null \
    | jq -r '.[0].results'
}

# --- Get sites and their API keys ---
echo "Fetching sites..."
SITES_JSON=$(query_d1 "SELECT s.id, s.domain, a.key FROM sites s JOIN api_keys a ON a.site_id = s.id ORDER BY s.domain;")
SITE_COUNT=$(echo "$SITES_JSON" | jq 'length')
echo "Found $SITE_COUNT sites."
echo ""

MISMATCHES=0
CHECKS=0

for i in $(seq 0 $((SITE_COUNT - 1))); do
  SITE_ID=$(echo "$SITES_JSON" | jq -r ".[$i].id")
  DOMAIN=$(echo "$SITES_JSON" | jq -r ".[$i].domain")
  SITE_KEY=$(echo "$SITES_JSON" | jq -r ".[$i].key")

  echo "========================================"
  echo " $DOMAIN ($SITE_ID)"
  echo "========================================"

  # --- 1. Compare daily_stats ---
  echo ""
  echo "  [daily_stats]"

  AE_STATS=$(query_ae "SELECT SUM(_sample_interval) AS pageviews, COUNT(DISTINCT blob18) AS visitors, COUNT(DISTINCT blob17) AS sessions FROM $DATASET WHERE index1 = '$SITE_KEY' AND blob1 = 'pageview' AND toDate(timestamp) = '$DATE'")
  AE_VISITORS=$(echo "$AE_STATS" | jq -r '.data[0].visitors // 0')
  AE_PAGEVIEWS=$(echo "$AE_STATS" | jq -r '.data[0].pageviews // 0')
  AE_SESSIONS=$(echo "$AE_STATS" | jq -r '.data[0].sessions // 0')

  D1_STATS=$(query_d1 "SELECT visitors, pageviews, sessions FROM daily_stats WHERE site_id = '$SITE_ID' AND date = '$DATE';")
  D1_VISITORS=$(echo "$D1_STATS" | jq -r '.[0].visitors // "MISSING"')
  D1_PAGEVIEWS=$(echo "$D1_STATS" | jq -r '.[0].pageviews // "MISSING"')
  D1_SESSIONS=$(echo "$D1_STATS" | jq -r '.[0].sessions // "MISSING"')

  CHECKS=$((CHECKS + 3))
  STAT_OK=true
  for metric in visitors pageviews sessions; do
    ae_val=$(eval echo \$AE_$(echo $metric | tr '[:lower:]' '[:upper:]'))
    d1_val=$(eval echo \$D1_$(echo $metric | tr '[:lower:]' '[:upper:]'))
    # Normalize: AE may return floats
    ae_int=$(printf '%.0f' "$ae_val" 2>/dev/null || echo "$ae_val")
    d1_int=$(printf '%.0f' "$d1_val" 2>/dev/null || echo "$d1_val")
    if [ "$ae_int" != "$d1_int" ]; then
      echo "    MISMATCH $metric: AE=$ae_int D1=$d1_int"
      MISMATCHES=$((MISMATCHES + 1))
      STAT_OK=false
    fi
  done
  if $STAT_OK; then
    echo "    OK — visitors=$D1_VISITORS pageviews=$D1_PAGEVIEWS sessions=$D1_SESSIONS"
  fi

  # --- 2. Compare daily_pages count and top page ---
  echo ""
  echo "  [daily_pages]"

  AE_PAGES=$(query_ae "SELECT blob2 AS pathname, SUM(_sample_interval) AS pageviews, COUNT(DISTINCT blob18) AS visitors FROM $DATASET WHERE index1 = '$SITE_KEY' AND blob1 = 'pageview' AND toDate(timestamp) = '$DATE' GROUP BY pathname ORDER BY pageviews DESC LIMIT 500")
  AE_PAGES_COUNT=$(echo "$AE_PAGES" | jq '.data | length')

  D1_PAGES_COUNT=$(query_d1 "SELECT COUNT(*) as cnt FROM daily_pages WHERE site_id = '$SITE_ID' AND date = '$DATE';" | jq '.[0].cnt')

  CHECKS=$((CHECKS + 1))
  if [ "$AE_PAGES_COUNT" != "$D1_PAGES_COUNT" ]; then
    echo "    MISMATCH row count: AE=$AE_PAGES_COUNT D1=$D1_PAGES_COUNT"
    MISMATCHES=$((MISMATCHES + 1))
  else
    echo "    OK — $D1_PAGES_COUNT pages"
  fi

  # Spot-check top page
  if [ "$AE_PAGES_COUNT" -gt 0 ] 2>/dev/null; then
    AE_TOP_PAGE=$(echo "$AE_PAGES" | jq -r '.data[0].pathname')
    AE_TOP_PV=$(echo "$AE_PAGES" | jq -r '.data[0].pageviews' | xargs printf '%.0f')
    D1_TOP=$(query_d1 "SELECT pathname, pageviews FROM daily_pages WHERE site_id = '$SITE_ID' AND date = '$DATE' ORDER BY pageviews DESC LIMIT 1;")
    D1_TOP_PAGE=$(echo "$D1_TOP" | jq -r '.[0].pathname // "MISSING"')
    D1_TOP_PV=$(echo "$D1_TOP" | jq -r '.[0].pageviews // 0')

    CHECKS=$((CHECKS + 1))
    if [ "$AE_TOP_PAGE" != "$D1_TOP_PAGE" ] || [ "$AE_TOP_PV" != "$D1_TOP_PV" ]; then
      echo "    MISMATCH top page: AE='$AE_TOP_PAGE'($AE_TOP_PV) D1='$D1_TOP_PAGE'($D1_TOP_PV)"
      MISMATCHES=$((MISMATCHES + 1))
    else
      echo "    OK — top page: $D1_TOP_PAGE ($D1_TOP_PV pv)"
    fi
  fi

  # --- 3. Compare daily_referrers count ---
  echo ""
  echo "  [daily_referrers]"

  AE_REF=$(query_ae "SELECT blob4 AS source, COUNT(DISTINCT blob18) AS visitors FROM $DATASET WHERE index1 = '$SITE_KEY' AND blob1 = 'pageview' AND blob4 != '' AND toDate(timestamp) = '$DATE' GROUP BY source ORDER BY visitors DESC LIMIT 500")
  AE_REF_COUNT=$(echo "$AE_REF" | jq '.data | length')
  D1_REF_COUNT=$(query_d1 "SELECT COUNT(*) as cnt FROM daily_referrers WHERE site_id = '$SITE_ID' AND date = '$DATE';" | jq '.[0].cnt')

  CHECKS=$((CHECKS + 1))
  if [ "$AE_REF_COUNT" != "$D1_REF_COUNT" ]; then
    echo "    MISMATCH row count: AE=$AE_REF_COUNT D1=$D1_REF_COUNT"
    MISMATCHES=$((MISMATCHES + 1))
  else
    echo "    OK — $D1_REF_COUNT referrers"
  fi

  # --- 4. Compare daily_locations (country) count ---
  echo ""
  echo "  [daily_locations — countries]"

  AE_LOC=$(query_ae "SELECT blob11 AS name, COUNT(DISTINCT blob18) AS visitors FROM $DATASET WHERE index1 = '$SITE_KEY' AND blob1 = 'pageview' AND blob11 != '' AND toDate(timestamp) = '$DATE' GROUP BY name ORDER BY visitors DESC LIMIT 500")
  AE_LOC_COUNT=$(echo "$AE_LOC" | jq '.data | length')
  D1_LOC_COUNT=$(query_d1 "SELECT COUNT(*) as cnt FROM daily_locations WHERE site_id = '$SITE_ID' AND date = '$DATE' AND type = 'country';" | jq '.[0].cnt')

  CHECKS=$((CHECKS + 1))
  if [ "$AE_LOC_COUNT" != "$D1_LOC_COUNT" ]; then
    echo "    MISMATCH row count: AE=$AE_LOC_COUNT D1=$D1_LOC_COUNT"
    MISMATCHES=$((MISMATCHES + 1))
  else
    echo "    OK — $D1_LOC_COUNT countries"
  fi

  # --- 5. Compare daily_devices (browser) count ---
  echo ""
  echo "  [daily_devices — browsers]"

  AE_DEV=$(query_ae "SELECT blob14 AS name, COUNT(DISTINCT blob18) AS visitors FROM $DATASET WHERE index1 = '$SITE_KEY' AND blob1 = 'pageview' AND blob14 != '' AND toDate(timestamp) = '$DATE' GROUP BY name ORDER BY visitors DESC LIMIT 500")
  AE_DEV_COUNT=$(echo "$AE_DEV" | jq '.data | length')
  D1_DEV_COUNT=$(query_d1 "SELECT COUNT(*) as cnt FROM daily_devices WHERE site_id = '$SITE_ID' AND date = '$DATE' AND type = 'browser';" | jq '.[0].cnt')

  CHECKS=$((CHECKS + 1))
  if [ "$AE_DEV_COUNT" != "$D1_DEV_COUNT" ]; then
    echo "    MISMATCH row count: AE=$AE_DEV_COUNT D1=$D1_DEV_COUNT"
    MISMATCHES=$((MISMATCHES + 1))
  else
    echo "    OK — $D1_DEV_COUNT browsers"
  fi

  echo ""
done

# --- Summary ---
echo "========================================"
echo " SUMMARY"
echo "========================================"
echo "  Date:       $DATE"
echo "  Sites:      $SITE_COUNT"
echo "  Checks:     $CHECKS"
echo "  Mismatches: $MISMATCHES"
if [ "$MISMATCHES" -eq 0 ]; then
  echo "  Result:     ALL OK"
else
  echo "  Result:     ISSUES FOUND — review mismatches above"
fi
echo ""
