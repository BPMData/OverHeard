#!/usr/bin/env bash
# Run after npm run build. Exercise the production Node entrypoint (including native
# TypeScript imports), not tsx: CI runs this on the same Node 22 major as AI Studio.
set -euo pipefail
node --version

PORT_URL="http://localhost:3000"
LOG="$(mktemp)"

MT_PROVIDER=gtx NODE_ENV=production node server.ts >"$LOG" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  kill -0 "$SERVER_PID" 2>/dev/null || { cat "$LOG"; exit 1; }
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

echo "--- production room creation, authorization and event stream"
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
const base = 'http://localhost:3000/api/rooms';
const created = await fetch(base, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
});
assert.equal(created.status, 201);
const { code, token } = await created.json();
const patch = { entries: [{ id: 'smoke', timestamp: 1, english: 'Hello classroom.',
  translations: { es: 'Hola clase.' }, failedLangs: {} }], removedIds: [],
  selectedLangs: ['es'], interim: '', liveTranslations: {}, isListening: false };
const publish = async (authorized) => fetch(`${base}/${code}`, { method: 'PUT',
  headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(patch),
});
assert.equal((await publish(false)).status, 403);
assert.equal((await publish(true)).status, 200);
const stream = await fetch(`${base}/${code}/events`, { signal: AbortSignal.timeout(5000) });
assert.equal(stream.status, 200);
assert.match(stream.headers.get('content-type'), /text\/event-stream/);
const reader = stream.body.getReader();
const decoder = new TextDecoder();
let text = '';
while (!text.includes('event: snapshot\ndata: ') || !text.includes('Hola clase.')) {
  const chunk = await reader.read();
  assert.equal(chunk.done, false);
  text += decoder.decode(chunk.value, { stream: true });
}
assert.ok(!text.includes(token));
await reader.cancel();
assert.equal((await fetch(`${base}/${code}`, {
  method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
})).status, 200);
console.log('Room publish and student event stream passed.');
NODE

echo "smoke test passed"
