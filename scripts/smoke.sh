#!/usr/bin/env bash
# Run after npm run build. Exercise the production Node entrypoint (including native
# TypeScript imports), not tsx: CI runs this on the same Node 22 major as Cloud Run.
set -euo pipefail
node --version

PORT_URL="http://localhost:3000"
LOG="$(mktemp)"

REPORT_RELAY_URL= REPORT_RELAY_SECRET= MT_PROVIDER=gtx NODE_ENV=production node server.ts >"$LOG" 2>&1 &
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

echo "--- problem reports: status, consent check, manual fallback when sending isn't set up"
curl -sf "$PORT_URL/api/report/status" | grep -q '"automatic":false'
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$PORT_URL/api/report" \
  -H 'Content-Type: application/json' -d '{"category":"translation"}')"
echo "no consent -> $code"; [ "$code" = "400" ]
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$PORT_URL/api/report" \
  -H 'Content-Type: application/json' -d '{"category":"translation","consent":true}')"
echo "not configured -> $code"; [ "$code" = "503" ]

echo "--- production shell, cache headers and offline engines"
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
const base = 'http://localhost:3000';
for (const route of ['/', '/index.html', '/classroom-smoke', '/sw.js']) {
  const response = await fetch(base + route);
  assert.equal(response.status, 200, route);
  assert.equal(response.headers.get('cache-control'), 'no-cache, no-store, must-revalidate', route);
  assert.match(await response.text(), route === '/sw.js' ? /self\.addEventListener/ : /<div id="root">/, route);
}
for (const route of ['/ort/ort-wasm-simd-threaded.jsep.wasm', '/piper/piper_phonemize.wasm', '/bergamot/bergamot-translator-worker.wasm']) {
  const response = await fetch(base + route, { headers: { Range: 'bytes=0-3' } });
  assert.equal(response.status, 206, route);
  assert.match(response.headers.get('content-type') || '', /application\/wasm/, route);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), Uint8Array.of(0, 97, 115, 109), route);
}
for (const dir of ['assets', 'ort', 'piper', 'bergamot']) {
  assert.equal((await fetch(base + '/' + dir + '/missing-file.wasm')).status, 404, dir);
}
NODE

echo "--- production room creation, authorization and event stream"
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
const base = 'http://localhost:3000/api/rooms';
const created = await fetch(base, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '1234' }),
});
assert.equal(created.status, 201);
const { code, token: firstToken } = await created.json();
assert.equal((await fetch(`${base}/${code}/rejoin`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '9999' }),
})).status, 403);
const rejoined = await fetch(`${base}/${code}/rejoin`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '1234' }),
});
assert.equal(rejoined.status, 200);
const { token } = await rejoined.json();
assert.notEqual(token, firstToken);
const patch = { entries: [{ id: 'smoke', timestamp: 1, english: 'Hello classroom.',
  translations: { es: 'Hola clase.' }, failedLangs: {} }], removedIds: [],
  selectedLangs: ['es'], interim: '', liveTranslations: {}, isListening: false };
const publish = async (bearer) => fetch(`${base}/${code}`, { method: 'PUT',
  headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
  body: JSON.stringify(patch),
});
assert.equal((await publish('')).status, 403);
assert.equal((await publish(firstToken)).status, 403);
assert.equal((await publish(token)).status, 200);
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
const restarted = await fetch(`${base}/${code}/rejoin`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '1234' }),
});
assert.equal(restarted.status, 200);
const { token: restartToken, snapshot: restartSnapshot } = await restarted.json();
assert.equal(restartSnapshot.ended, false);
assert.equal((await fetch(`${base}/${code}`, {
  method: 'DELETE', headers: { Authorization: `Bearer ${restartToken}` },
})).status, 200);
console.log('Room publish, PIN rejoin, ended restart, and student event stream passed.');
NODE

echo "smoke test passed"
