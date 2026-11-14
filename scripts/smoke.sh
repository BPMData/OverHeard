#!/usr/bin/env bash
# Boots the real server and checks the API responds, without calling any translation service.
set -euo pipefail

PORT_URL="http://localhost:3000"
LOG="$(mktemp)"

MT_PROVIDER=gtx npx tsx server.ts >"$LOG" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  if curl -sf "$PORT_URL/api/config" >/dev/null; then break; fi
  sleep 1
done

echo "--- /api/config"
CONFIG="$(curl -sf "$PORT_URL/api/config")" || { echo "server did not start"; cat "$LOG"; exit 1; }
echo "$CONFIG"
echo "$CONFIG" | grep -q '"mtProvider":"gtx"'

echo "--- /api/mt rejects bad input"
for body in '{"text":"hi","lang":"xx"}' '{"text":"","lang":"es"}' '{}' '{"text":"hola","lang":"es","source":"xx"}' '{"text":"hola","lang":"es","source":"es"}'; do
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$PORT_URL/api/mt" \
    -H 'Content-Type: application/json' -d "$body")"
  echo "$body -> $code"
  [ "$code" = "400" ]
done

echo "--- page loads"
curl -sf "$PORT_URL/" | grep -q '<div id="root">'

echo "smoke test passed"
