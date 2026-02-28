#!/usr/bin/env bash
#
# Diagnostic script to verify archive data in production D1.
# Run from the repo root: bash scripts/diagnose-archive.sh
#

set -euo pipefail

DB="traks-db-prod"
CONFIG="apps/api/wrangler.toml"

run_sql() {
  local label="$1"
  local sql="$2"
  echo ""
  echo "========================================"
  echo " $label"
  echo "========================================"
  local raw
  raw=$(npx wrangler d1 execute "$DB" --env production --remote --command "$sql" --json -c "$CONFIG" 2>&1) || true

  # Check if it's valid JSON
  if echo "$raw" | jq -e '.[0].results' >/dev/null 2>&1; then
    echo "$raw" | jq -r '.[0].results | if length == 0 then "  (no rows)" else (.[0] | keys_unsorted | join("\t")), (.[] | [.[] | tostring] | join("\t")) end'
  elif echo "$raw" | jq -e '.error' >/dev/null 2>&1; then
    echo "  ERROR: $(echo "$raw" | jq -r '.error.text // .error')"
  else
    echo "  (unexpected output)"
    echo "$raw" | head -5
  fi
}

echo "=== Archive Diagnostics — $(date -u '+%Y-%m-%d %H:%M UTC') ==="

# 1. Archive state
run_sql "Archive State (last archived date per site)" \
  "SELECT s.domain, a.site_id, a.last_archived_date, a.status, a.last_error FROM archive_state a LEFT JOIN sites s ON s.id = a.site_id ORDER BY a.last_archived_date DESC;"

# 2. Sites
run_sql "Registered Sites" \
  "SELECT id, domain FROM sites ORDER BY id;"

# 3. Daily stats for last 7 days
run_sql "Daily Stats (last 7 days)" \
  "SELECT site_id, date, visitors, pageviews, sessions FROM daily_stats WHERE date >= date('now', '-7 days') ORDER BY date DESC, site_id;"

# 4. Zero-data detection
run_sql "Zero-Data Days (visitors=0 in last 7 days)" \
  "SELECT site_id, date, visitors, pageviews FROM daily_stats WHERE date >= date('now', '-7 days') AND visitors = 0;"

# 5. Breakdown table row counts (split into individual queries to avoid D1 API limits)
for tbl in daily_pages daily_referrers daily_locations daily_devices daily_utm daily_events; do
  run_sql "Breakdown: $tbl (last 7 days)" \
    "SELECT date, COUNT(*) as rows FROM $tbl WHERE date >= date('now', '-7 days') GROUP BY date ORDER BY date DESC;"
done

# 6. Gap detection — list dates in last 7 days with no daily_stats rows
run_sql "Gap Detection (dates with no stats in last 7 days)" \
  "WITH RECURSIVE dates(d) AS (SELECT date('now', '-7 days') UNION ALL SELECT date(d, '+1 day') FROM dates WHERE d < date('now', '-1 day')) SELECT d as missing_date FROM dates WHERE d NOT IN (SELECT DISTINCT date FROM daily_stats) ORDER BY d;"

echo ""
echo "========================================"
echo " Done. Review output above for issues."
echo "========================================"
echo ""
echo "Next steps if issues found:"
echo "  - Check worker logs: cd apps/archive && npx wrangler tail traks-archive --env production"
echo "  - Apply migrations: npx wrangler d1 migrations apply traks-db-prod --env production --remote -c apps/api/wrangler.toml"
