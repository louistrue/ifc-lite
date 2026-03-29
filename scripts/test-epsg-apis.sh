#!/usr/bin/env bash
# Test script for EPSG lookup APIs
# Run from dev machine: bash scripts/test-epsg-apis.sh
#
# Tests both epsg.io and apps.epsg.org to determine which endpoints
# work, what they return, and whether CORS headers are present.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${YELLOW}→${NC} $1"; }
header() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required dependency: $1" >&2
    exit 1
  fi
}

need_cmd curl
need_cmd python3

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

head_with_origin() {
  curl -sI -H "Origin: https://ifc-lite.local" "$1" 2>/dev/null
}

# ── epsg.io ─────────────────────────────────────────────────────────────

header "epsg.io — Direct code lookup"

echo "  GET https://epsg.io/4326.json"
HTTP=$(curl -s -o "$TMP_DIR/epsg-4326.json" -w "%{http_code}" "https://epsg.io/4326.json" 2>/dev/null || echo "000")
if [ "$HTTP" = "200" ]; then
  pass "HTTP $HTTP"
  NAME=$(python3 -c "import json; d=json.load(open('$TMP_DIR/epsg-4326.json')); print(d.get('name', d.get('results',[{}])[0].get('name','?')))" 2>/dev/null || echo "?")
  info "Name: $NAME"
  CORS=$(head_with_origin "https://epsg.io/4326.json" | grep -i "access-control-allow-origin" || echo "")
  [ -n "$CORS" ] && pass "CORS: $CORS" || fail "No CORS header"
else
  fail "HTTP $HTTP"
fi

echo ""
echo "  GET https://epsg.io/2056.json (Swiss CRS)"
HTTP=$(curl -s -o "$TMP_DIR/epsg-2056.json" -w "%{http_code}" "https://epsg.io/2056.json" 2>/dev/null || echo "000")
if [ "$HTTP" = "200" ]; then
  pass "HTTP $HTTP"
  python3 -c "
import json
d = json.load(open('$TMP_DIR/epsg-2056.json'))
r = d.get('results',[{}])[0]
if 'name' in d:
    r = d
print(f'  Name: {r.get(\"name\",\"?\")}')
print(f'  Kind: {r.get(\"kind\",\"?\")}')
print(f'  Area: {r.get(\"area\",\"?\")}')
print(f'  Unit: {r.get(\"unit\",\"?\")}')
print(f'  Datum: {r.get(\"datum\",\"?\")}')
print(f'  Projection: {r.get(\"projection\",\"?\")}')
print(f'  Keys: {list(r.keys())[:15]}')
" 2>/dev/null || fail "Could not parse JSON"
else
  fail "HTTP $HTTP"
fi

header "epsg.io — Text search"

for QUERY in "tokyo" "switzerland" "web+mercator" "UTM+zone+32N" "abidjan"; do
  echo ""
  URL="https://epsg.io/?q=${QUERY}&format=json"
  echo "  GET $URL"
  HTTP=$(curl -s -o "$TMP_DIR/epsg-search.json" -w "%{http_code}" "$URL" 2>/dev/null || echo "000")
  if [ "$HTTP" = "200" ]; then
    pass "HTTP $HTTP"
    python3 -c "
import json
d = json.load(open('$TMP_DIR/epsg-search.json'))
n = d.get('number_result', 0)
results = d.get('results', [])
print(f'  Results: {n} total, showing first 5')
for r in results[:5]:
    print(f'    {r.get(\"code\",\"?\")} | {r.get(\"name\",\"?\")} | {r.get(\"kind\",\"?\")} | {(r.get(\"area\") or \"?\")[:40]}')
" 2>/dev/null || fail "Could not parse JSON"
    CORS=$(head_with_origin "$URL" | grep -i "access-control-allow-origin" || echo "")
    [ -n "$CORS" ] && pass "CORS: $CORS" || fail "No CORS header"
  elif [ "$HTTP" = "301" ] || [ "$HTTP" = "302" ]; then
    fail "HTTP $HTTP (redirect — search may have moved)"
    LOCATION=$(head_with_origin "$URL" | grep -i "^location:" || echo "  No location header")
    info "$LOCATION"
  else
    fail "HTTP $HTTP"
  fi
done

header "epsg.io — Alternative search endpoints"

for URL in \
  "https://epsg.io/search?q=tokyo&format=json" \
  "https://epsg.io/trans?q=tokyo&format=json" \
  "https://epsg.io/?q=tokyo&format=json&trans=1" \
  "https://epsg.io/?q=tokyo&format=json&trans=0"; do
  echo ""
  echo "  GET $URL"
  HTTP=$(curl -s -o "$TMP_DIR/epsg-alt.json" -w "%{http_code}" "$URL" 2>/dev/null || echo "000")
  if [ "$HTTP" = "200" ]; then
    pass "HTTP $HTTP"
    python3 -c "
import json
d = json.load(open('$TMP_DIR/epsg-alt.json'))
n = d.get('number_result', len(d.get('results', [])))
print(f'  Results: {n}')
for r in d.get('results', [])[:3]:
    print(f'    {r.get(\"code\",\"?\")} | {r.get(\"name\",\"?\")}')
" 2>/dev/null || info "Response is not JSON or different format"
  else
    fail "HTTP $HTTP"
  fi
done

# ── apps.epsg.org ───────────────────────────────────────────────────────

header "apps.epsg.org — Direct code lookup"

echo "  GET https://apps.epsg.org/api/v1/CoordRefSystem/4326"
HTTP=$(curl -s -o "$TMP_DIR/epsg-org-4326.json" -w "%{http_code}" -H "Accept: application/json" "https://apps.epsg.org/api/v1/CoordRefSystem/4326" 2>/dev/null || echo "000")
if [ "$HTTP" = "200" ]; then
  pass "HTTP $HTTP"
  python3 -c "
import json
d = json.load(open('$TMP_DIR/epsg-org-4326.json'))
print(f'  Code: {d.get(\"Code\",\"?\")}')
print(f'  Name: {d.get(\"Name\",\"?\")}')
print(f'  Kind: {d.get(\"Kind\",\"?\")}')
print(f'  Keys: {list(d.keys())[:15]}')
ao = d.get('AreaOfUse', {})
print(f'  AreaOfUse: {ao.get(\"Name\",\"?\")}')
da = d.get('Datum', {})
print(f'  Datum: {da.get(\"Name\",\"?\")}')
" 2>/dev/null || fail "Could not parse JSON"
  CORS=$(head_with_origin "https://apps.epsg.org/api/v1/CoordRefSystem/4326" | grep -i "access-control-allow-origin" || echo "")
  [ -n "$CORS" ] && pass "CORS: $CORS" || fail "No CORS header (browser requests will fail)"
else
  fail "HTTP $HTTP"
fi

header "apps.epsg.org — Search endpoints"

for URL in \
  "https://apps.epsg.org/api/v1/CoordRefSystem?searchText=tokyo&pageSize=5" \
  "https://apps.epsg.org/api/v1/CoordRefSystem?keyword=tokyo&pageSize=5" \
  "https://apps.epsg.org/api/v1/CoordRefSystem?name=tokyo&pageSize=5" \
  "https://apps.epsg.org/api/v1/ProjectedCoordRefSystem?searchText=tokyo&pageSize=5"; do
  echo ""
  echo "  GET $URL"
  HTTP=$(curl -s -o "$TMP_DIR/epsg-org-search.json" -w "%{http_code}" -H "Accept: application/json" "$URL" 2>/dev/null || echo "000")
  if [ "$HTTP" = "200" ]; then
    pass "HTTP $HTTP"
    python3 -c "
import json
d = json.load(open('$TMP_DIR/epsg-org-search.json'))
if isinstance(d, list):
    print(f'  Array response: {len(d)} items')
    for r in d[:3]:
        print(f'    {r.get(\"Code\",\"?\")} | {r.get(\"Name\",\"?\")}')
    if len(d) > 0 and d[0].get('Name','').startswith('A'):
        print('  ⚠ Results start with \"A\" — search parameter may be ignored (alphabetical dump)')
elif isinstance(d, dict):
    print(f'  Object response, keys: {list(d.keys())[:10]}')
    results = d.get('Results', d.get('results', []))
    if isinstance(results, list):
        print(f'  Results: {len(results)} items')
        for r in results[:3]:
            print(f'    {r.get(\"Code\",\"?\")} | {r.get(\"Name\",\"?\")}')
" 2>/dev/null || info "Not JSON"
  else
    fail "HTTP $HTTP"
  fi
done

header "apps.epsg.org — Pagination endpoint"

PAGINATION_URL="https://apps.epsg.org/api/v1/CoordRefSystem?pageSize=5&page=0"
echo ""
echo "  GET $PAGINATION_URL"
HTTP=$(curl -s -o "$TMP_DIR/epsg-org-page.json" -w "%{http_code}" -H "Accept: application/json" "$PAGINATION_URL" 2>/dev/null || echo "000")
if [ "$HTTP" = "200" ]; then
  pass "HTTP $HTTP"
  python3 -c "
import json
d = json.load(open('$TMP_DIR/epsg-org-page.json'))
print(f'  Keys: {list(d.keys())[:10]}')
print(f'  TotalResults: {d.get(\"TotalResults\", \"?\")}')
results = d.get('Results', [])
print(f'  Results: {len(results)} items')
for r in results[:3]:
    print(f'    {r.get(\"Code\",\"?\")} | {r.get(\"Name\",\"?\")}')
" 2>/dev/null || fail "Could not parse JSON"
else
  fail "HTTP $HTTP"
fi

# ── MapTiler Coordinates API (successor to epsg.io search) ──────────────

header "MapTiler Coordinates API (requires key)"

echo "  GET https://api.maptiler.com/coordinates/search/tokyo.json (no key)"
HTTP=$(curl -s -o "$TMP_DIR/maptiler.json" -w "%{http_code}" "https://api.maptiler.com/coordinates/search/tokyo.json" 2>/dev/null || echo "000")
if [ "$HTTP" = "200" ]; then
  pass "HTTP $HTTP (works without key?)"
elif [ "$HTTP" = "401" ] || [ "$HTTP" = "403" ]; then
  info "HTTP $HTTP — requires API key (expected)"
else
  fail "HTTP $HTTP"
fi

# ── Summary ─────────────────────────────────────────────────────────────

header "SUMMARY"

echo ""
echo "  Run this script and share the output so we can see which"
echo "  endpoints work and return correct search results."
echo ""
echo "  Key questions:"
echo "  1. Does epsg.io search (?q=tokyo) return Tokyo results?"
echo "  2. Does epsg.io search have CORS headers?"
echo "  3. Does apps.epsg.org search actually filter or just dump alphabetically?"
echo "  4. Does MapTiler work without a key?"
echo ""
