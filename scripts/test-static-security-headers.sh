#!/usr/bin/env bash
set -euo pipefail

base_url="${BASE_URL:-http://localhost:8080}"
headers_for() { curl --fail --silent --show-error --dump-header - --output /dev/null "$base_url$1" | tr -d '\r'; }
single_header() {
  local headers="$1" name="$2" count
  count=$(printf '%s\n' "$headers" | grep -ic "^${name}:")
  [ "$count" -eq 1 ] || { echo "Expected one ${name} header, found ${count}"; exit 1; }
  printf '%s\n' "$headers" | grep -i "^${name}:" | sed "s/^${name}:[[:space:]]*//I"
}
assert_contains() { [[ "$1" == *"$2"* ]] || { echo "Expected header to contain: $2"; exit 1; }; }
assert_not_contains() { [[ "$1" != *"$2"* ]] || { echo "Header unexpectedly contains: $2"; exit 1; }; }

race_headers=$(headers_for /race.html)
race_csp=$(single_header "$race_headers" 'Content-Security-Policy')
race_permissions=$(single_header "$race_headers" 'Permissions-Policy')
assert_contains "$race_permissions" 'camera=(self)'
assert_contains "$race_csp" "script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'"
assert_contains "$race_csp" "connect-src 'self' https://cdn.jsdelivr.net"
assert_not_contains "$race_csp" "'unsafe-inline'"
assert_not_contains "$race_csp" 'script-src *'

for path in /login.html /dashboard.html; do
  page_headers=$(headers_for "$path")
  page_csp=$(single_header "$page_headers" 'Content-Security-Policy')
  page_permissions=$(single_header "$page_headers" 'Permissions-Policy')
  assert_contains "$page_permissions" 'camera=()'
  assert_not_contains "$page_csp" 'cdn.jsdelivr.net'
  assert_not_contains "$page_csp" "'unsafe-inline'"
done

for path in /api /api/; do
  api_headers=$(headers_for "$path")
  api_csp=$(single_header "$api_headers" 'Content-Security-Policy')
  api_permissions=$(single_header "$api_headers" 'Permissions-Policy')
  assert_contains "$api_permissions" 'camera=()'
  assert_not_contains "$api_csp" 'cdn.jsdelivr.net'
  [[ ! "$api_csp" =~ script-src[^;]*\'unsafe-inline\' ]] || { echo "API script-src unexpectedly permits unsafe-inline"; exit 1; }
done

echo 'Static-page security header test passed'
