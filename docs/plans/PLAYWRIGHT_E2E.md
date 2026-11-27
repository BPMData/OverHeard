# Plan: Minimal Playwright Browser E2E Suite & CI Job

> **For Code 6.1 Terra:** Read `AGENTS.md` and `ARCHITECTURE.md` first.
> Model the Playwright setup after `../AllAboard/playwright.config.ts` and `../AllAboard/e2e/serve.ts` (read AllAboard as reference only; do not edit AllAboard).
> Keep Playwright and `e2e/` strictly out of `server.ts` production imports and out of Vitest (`vitest.config.ts` already limits `include` to `server/**/*.test.ts` and `src/**/*.test.{ts,tsx}`).

## Goal

Add real-Chromium browser coverage for the workflows that jsdom cannot test cleanly (SSE live rooms across two browser contexts, Document Picture-in-Picture / caption layout + `?langs=` URL sync, and real-browser storage/offline settings persistence), wired into `.github/workflows/ci.yml`.

---

## Phase 1 — Playwright harness (`package.json`, `playwright.config.ts`, `e2e/serve.ts`)

1. Add `@playwright/test` to `devDependencies` in `package.json` (and run `npm install --legacy-peer-deps --no-audit --no-fund` only for local verification; remember `package-lock.json` is gitignored).
2. Add script `"test:e2e": "playwright test"` to `package.json`. Keep existing `"dev"`, `"build"`, `"start"`, `"lint"`, `"test"`, `"test:watch"`, `"gcp-build"` scripts unchanged.
3. Ensure `server.ts` supports starting cleanly on an ephemeral/configured port for E2E (note `server.ts` already exports `startServer()` with `isMainModule` guard; if `PORT` is currently hardcoded to `const PORT = 3000`, read `Number(process.env.PORT) || 3000` in `server.ts` so `e2e/serve.ts` can boot on port `3100` without colliding with dev port `3000`, while keeping `3000` as the default!).
   - Verify: `AGENTS.md` requires `0.0.0.0:3000` as the server default; `Number(process.env.PORT) || 3000` preserves `3000` when `PORT` is unset (including Cloud Run where Cloud Run sets `PORT=3000` via `--port 3000`).
4. Create `e2e/serve.ts` starting the server on `E2E_PORT` (default `3100`, `NODE_ENV=development` with Vite middleware or built `dist/`).
5. Create `playwright.config.ts` targeting `./e2e` with `Chromium`, `webServer` polling `http://127.0.0.1:3100/api/config`, and `trace: 'retain-on-failure'`.

### Phase 1 Checkpoint
- `npm run lint`
- `npm test -- --run`
- `NODE_ENV=production node --check server.ts`

---

## Phase 2 — Three high-signal E2E specs in `e2e/`

Keep every E2E test independent of live Google Translate / HuggingFace networks by using `page.route(...)` to stub external or `/api/mt` calls deterministically:

1. **`e2e/liveRoom.spec.ts` (Teacher Lecture → Student Room SSE across two contexts):**
   - Teacher context opens `/`, switches to Conversation → Lecture mode, stubs `/api/mt` via `page.route('**/api/mt', ...)` to return deterministic translations, opens room setup, creates a room with PIN `1234`, and notes the room code.
   - Student context opens `/?room=<CODE>`, receives the initial empty/snapshot stream, and waits for live captions.
   - Teacher adds a line via Test/Type input (`Type a line` or Lecture test line), student context asserts the English line and mocked translation appear over live `EventSource`, and teacher clicks **End room** → student context reflects ended state cleanly.
2. **`e2e/captionsAndPip.spec.ts` (Columns, Subtitle, `?langs=`, and Document PiP fallback/launch):**
   - Open `/?langs=es,pt`, verify Spanish and Portuguese columns render.
   - Open `Test Input`, submit a phrase with mocked `/api/mt`, verify both translation columns update and survive switching to `Subtitle` mode.
   - Exercise `Pop out captions` (if `window.documentPictureInPicture` exists in headless Chromium, verify pop-out window opens and receives text + dark-mode toggle; if unsupported in headless mode, assert the unsupported/notice state behaves cleanly without throwing console/page errors).
3. **`e2e/settingsStorage.spec.ts` (Persistence & Settings → Space used on this device):**
   - Open Settings (`VoiceSettingsModal`), change a voice preference and dark/light theme, reload the page, and assert preferences persist in `localStorage`.
   - Open the "Space used on this device" (`StorageManager`) section and assert storage usage categories render cleanly in Chromium with zero uncaught `pageerror`s.

### Phase 2 Checkpoint
```sh
npx playwright install chromium
npm run test:e2e
```

---

## Phase 3 — CI integration (`.github/workflows/ci.yml`)

1. Add an `e2e` job in `.github/workflows/ci.yml` mirroring `AllAboard/.github/workflows/ci.yml`:
   - `npm install --legacy-peer-deps --no-audit --no-fund`
   - `npx playwright install --with-deps chromium`
   - `npm run test:e2e`
   - Upload `playwright-report/` artifact on failure/completion (`if: ${{ !cancelled() }}`).
2. Keep `.github/workflows/deploy.yml` fast (unit tests + lint + build + `smoke.sh`) unless the owner chooses to gate deploys on E2E too.
3. Document `npm run test:e2e` in `ARCHITECTURE.md` §5 and `README.md`.

### Final Verification
```sh
npm test -- --run
npm run lint
npm run build
NODE_ENV=production node --check server.ts
bash scripts/smoke.sh
npm run test:e2e
```
