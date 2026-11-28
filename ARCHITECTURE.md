# OverHeard — System Architecture

> **Audience:** any developer or coding agent arriving "blind." Read [`AGENTS.md`](AGENTS.md) first:
> its Cloud Run deployment contract and Node 22 rules override anything else here.
> For live lecture room behavior and limits, read [`ROOMS.md`](ROOMS.md). For planned work, see [`TODO.md`](TODO.md).
> If the code disagrees with this file, trust the code and update this file.

---

## 1. What it is

**OverHeard** is a real-time classroom speech transcription, multi-language translation, neural read-aloud, two-way conference, and shared student lecture-room web app — built for teachers and schools with **zero required logins or accounts** and zero required server secrets.

**Design values to preserve:**
- **No accounts, no required API keys:** runs out of the box using Chrome's Web Speech API, on-device translation/voices where available, and free `gtx` fallback on `/api/mt`.
- **Single-page-app simplicity on a cheap Chromebook or tablet:** offline-capable translation/TTS models stay cached on the device in Cache Storage / OPFS; no heavy backend database.
- **Privacy & school-network compatibility:** non-sensitive Google OAuth scope only (`drive.file`, enforced by `src/lib/googleScopes.test.ts`), `freeOnly` guard on live interim speech and student rooms, and static WASM assets hosted without COEP restrictions so school Wi-Fi and Google popups work.

---

## 2. If you change this behavior

| Behavior | Where it is decided | What to verify |
|---|---|---|
| Starting or retiring a microphone | [Recognizer setup and teardown](src/speech/recognition.ts), [restart backoff](src/speechRestart.ts) | A retired mic cannot restart itself. On a clean end mid-clause, [captions](src/App.captions.test.tsx) keep finalized lines, [lecture](src/components/ConversationMode.lecture.test.tsx) saves the trailing words as a line, and [two-way mode](src/conversation/useConversationSpeech.test.ts) carries them into the current turn. |
| Passing a two-way turn | [Two-way speech hook](src/conversation/useConversationSpeech.ts) | The pause runs from the last new words, even across a mic restart. A same-language handoff starts a fresh session on the existing mic. [Turn tests](src/conversation/useConversationSpeech.test.ts) |
| Showing live two-way captions | [Face-to-face readers](src/components/FaceToFaceView.tsx) and [side-by-side history](src/components/TwoWayView.tsx) | Interim words update the live line. Completed messages update when their speaker, translation or display settings change. [Two-reader regression](src/components/ConversationMode.faceToFace.test.tsx) |
| Saving or opening lecture files | [Lecture JSON and live room protocol](src/rooms/protocol.ts), [Google Drive client](src/lib/googleDrive.ts) | A saved lecture with 2,001 lines reopens within the 8 MB file limit. A live room caps its transcript at 2,000 lines. Only `drive.file` scope is used. [Round-trip and limit tests](src/rooms/protocol.test.ts) · [OAuth scope test](src/lib/googleScopes.test.ts) |
| Reusing a translation request | [Browser cache](src/translation/translationCache.ts), [teacher client](src/translation/useTranslator.ts), [student client](src/rooms/translateStudent.ts) | Concurrent calls share a promise. A late failure after eviction preserves the replacement. Finalized captions can reuse live work, and student fallback uses free translation. [Eviction race](src/translation/useTranslator.test.ts) · [Caption requests](src/App.captions.test.tsx) · [Student requests](src/rooms/translateStudent.test.ts) |
| Server startup or production imports | [Server entry](server.ts), [Express app](server/app.ts), [Node boot test](server/nodeBoot.test.ts), [smoke script](scripts/smoke.sh) | Plain Node 22 loads `server.ts` and `server/app.ts` with native type stripping, serves `/api/config`, and passes live room SSE smoke checks. |

To reproduce device-specific speech behavior, open the app with `?debugSpeech=1` and use substitute classroom phrases. In a fake-timer test, pass the observed sequence to `speech.replay`. Each step can specify the delay since the previous event in `afterMs`. For results, preserve the browser's `resultIndex`, transcript revisions and final flags. The [speech harness and example trace](src/speech/__fixtures__/speechHarness.ts) show the format.

---

## 3. Design choices and rationale (why it is built this way)

| Decision | Choice made | Why (and what alternatives were avoided) |
|---|---|---|
| **Student room transport** | **Server-Sent Events (`EventSource`)** on `/api/rooms/:code/events` (`server/rooms.ts`) | Students are strictly read-only listeners of teacher transcripts. SSE uses plain HTTP, reconnects automatically on flaky school Wi-Fi, requires no WebSocket client bundle, and avoids Socket.IO overhead. Requires `--concurrency 1000` and `--timeout 3600` on Cloud Run (`ROOMS.md`). |
| **Live room storage** | **In-memory per process** (max 100 rooms, 200 readers/room, 8 h idle TTL) | Temporary live rooms avoid database/bucket ops and keep student sync fast. Trade-off: Cloud Run must stay at **max instances = 1** and deploys clear active live rooms. Teachers can export portable JSON or save a lecture file through the browser’s Google Drive integration. Real-account Drive verification is tracked in TODO.md. Durable server-side rooms remain future work. |
| **Translation chain** | **Device-first** (Chrome Translator API → Bergamot / Opus-MT WASM) → `/api/mt` (`gtx` → optional `google-cloud`) | Minimizes latency and API spend in classrooms. Live interim speech and student pages send `freeOnly: true` so speculative typing/speaking never spends paid Google Cloud quota. Pending identical `/api/mt` requests coalesce in memory (`server/mt.ts`). |
| **Single-threaded WASM + OAuth headers** | `Cross-Origin-Opener-Policy: same-origin-allow-popups`, **no `COEP`** (`server/app.ts`) | Setting `COEP: require-corp` would unlock multi-threaded WASM (`SharedArrayBuffer`), but breaks Google OAuth sign-in popups and cross-origin Google Picker iframes (`cross-origin-resource-policy: same-site`). Piper, Meta MMS, Bergamot, and Opus-MT all run cleanly single-threaded in Web Workers. |
| **Dual neural TTS engines** | **Piper TTS** (`@mintplex-labs/piper-tts-web`) + **Meta MMS** (`src/tts/mmsEngine.ts`) in one worker (`src/tts/piperWorker.ts`) | Piper covers major languages well with eSpeak/pinyin phonemes, while low-resource languages (Swahili, Haitian Creole, Somali, Indonesian, Turkish) use character-tokenized Meta MMS VITS models (`int8` ONNX). Both cache in OPFS and fall back to `window.speechSynthesis`. |
| **Keep `ConversationMode` mounted** | Rendered conditionally with `hidden={!active}` once visited (`src/App.tsx`) | Preserves the in-memory two-way conversation thread and lecture transcript when switching back and forth between Columns / Subtitle and Conversation mode during a class session. |
| **TypeScript server execution** | **Node 22 native type stripping** (`node server.ts`) | Eliminates a server transpile step in Cloud Run Buildpacks. Requires strictly erasable TS (`import type`, `.ts` extensions on relative server imports, no `enum`/`namespace`/parameter properties), enforced by `server/nodeBoot.test.ts` and `scripts/smoke.sh`. |

---

## 4. Current layout

```text
server.ts               Reads env, exports startServer(), runs when invoked as main (0.0.0.0:3000)
server/
  app.ts                Express middleware (COOP header), room router, static dist/ headers & SPA fallback
  routes/mt.ts          /api/config, /api/mt, per-session & per-IP rate limits, [usage] logger
  report.ts             /api/report and /api/report/status: problem reports to a GitHub issue and the email relay (docs/REPORTS.md)
  development.ts        Vite middleware and dev-only /ort/, /piper/ & /bergamot/ runtime routes (lazy-imported only in dev)
  mt.ts                 Provider chain (gtx / google-cloud), 10-min benching, pending-request coalescing
  rooms.ts              In-memory live rooms, salted PIN hash + bearer token rotation, SSE delta/snapshot stream
  budget.ts, rateLimit.ts, usage.ts, clientKeys.ts, shortLink.ts, config.ts
  nodeBoot.test.ts      Plain Node 22 import check over server.ts & server/app.ts

src/
  main.tsx              Routes ?room= or /<code> to StudentRoom; otherwise mounts App
  App.tsx               App shell: picks Columns / Subtitle / Conversation and wires hooks to views
  app/                  useAppSettings (theme, font, ?langs=, mode), useBrowserSupport, usePackProgress, banners
  speech/               Shared recognizer setup/teardown (recognition.ts), useCaptionSpeech, Space hotkey, types
  captions/             useCaptionTranscript, useColumnPlayback, ColumnsView, SubtitleBar, TestInputBar
  translation/          protocol.ts (shared HTTP contract), useServerConfig, useTranslator, useDeviceFirstTranslator, translationCache,
                        useLanguagesNeedingOnline, bergamot/ (Bergamot + Opus-MT workers & Cache Storage store)
  pip/                  usePipWindow, copyStyles (Document Picture-in-Picture lifecycle & theme sync)
  header/               AppHeader, ListenButton, FontSizeControls, DisplayModeSwitch, TranslatorPicker, ClearTranscriptButton
  components/
    ConversationMode.tsx  Shared Two-way & Lecture workspace coordinator
    ConversationToolbar.tsx, LectureToolbar.tsx  Shared toolbar and lecture room controls
    TwoWayView.tsx, FaceToFaceView.tsx, LectureView.tsx, LectureTranscript.tsx, PipSubtitlePortal.tsx
    DriveLectureActions.tsx, DriveSaveModal.tsx, VoiceSettingsModal.tsx, LanguageModal.tsx,
    AboutModal.tsx, StorageManager.tsx, PackProgressPanel.tsx
  conversation/         useTwoWayWorkspace, useLectureWorkspace, state/reducers, speech hooks, locales, translateMessage
  report/               "Something not working?" form, diagnostics, and the report format shared with the server (protocol.ts)
  rooms/                TeacherRoomControls, StudentRoom, protocol.ts (shared with server), translateStudent, LecturePip/Files
  tts/                  voiceCatalog.ts (static catalog), voices.ts (selection and prefs), piperClient, piperWorker, mmsEngine, mmsTokenizer,
                        useLecturePlayback, useTwoWayPlayback, liveSegments, VoiceSelect, voiceStorage
  lib/                  googleConfig.ts, googleDrive.ts (GIS OAuth + Picker + Drive v3, drive.file scope only)
  storage/              Settings → "Space used on this device" registry joining voices and translation packs
  *.ts                  Shared helpers: onDevice, speechRestart, speechDedupe, liveTranslation,
                        useLiveTranslations, packProgress, pipLines, wakeLock, captionColors, offline
```

### Ownership & state rules

- **Each feature hook owns its state and internal "latest value" refs:** `App.tsx` keeps only cross-cutting state (`selectedLangs`, `displayMode`, `fontSize`, `isDark`, modal flags).
- **Explicit props over React context:** Component trees are shallow (`App` → views/header/ConversationMode), so passing explicit props keeps data dependencies visible and easy to unit-test.
- **`src/rooms/protocol.ts` is shared across server and browser:** keep it strictly erasable TypeScript with zero React, CSS, or DOM imports.
- **`src/translation/protocol.ts` is shared across server and browser:** keep its HTTP contract strictly erasable and free of browser or server dependencies.

---

## 5. Development, setup, and verification

Use Node 22 and install dependencies with `npm ci`. The repository and the Cloud Run source upload include `package-lock.json`. When changing dependencies, run `npm install` and include the updated lockfile in the same pull request. The repository’s `.npmrc` supplies the peer-dependency settings.

Local development needs no server keys. The server defaults to GTX. Browser Drive configuration lives in `src/lib/googleConfig.ts`.

### Release checks

| When | What runs |
|---|---|
| Pull request or push to main | [CI](.github/workflows/ci.yml) runs TypeScript and React hooks lint, Prettier, Vitest, the Vite build, a Node 22 syntax check, and the production smoke script. A separate Chromium job builds the app and runs the classroom flows and installed-app upgrade test. |
| Push to main with a change outside Markdown, or manual deploy workflow | [Deployment](.github/workflows/deploy.yml) installs from the same npm lockfile and repeats lint, Vitest, build, syntax and smoke checks. The production browser upgrade test must pass before authentication. Prettier runs in CI. Markdown-only pushes skip deployment so a documentation edit preserves active rooms. |
| Cloud Run source upload | Actions authenticates with the existing GitHub secret `GCP_SA_KEY`. The [upload check](scripts/check-upload.sh) verifies that gcloud includes the npm lockfile and excludes generated credential files. `gcloud run deploy --source .` sends the source to Google Cloud, where the Node buildpack installs dependencies and runs `gcp-build`. The service starts with `node server.ts` on port 3000. A missing `dist/index.html` stops startup. |

To reproduce the checks with an unused port 3000 and Chromium installed:

```sh
npm ci
npm test -- --run
npm run lint
npx prettier --check .
npm run build
NODE_ENV=production node --check server.ts
bash scripts/smoke.sh
npx playwright install chromium
npm run test:e2e
```

The smoke script checks the running production API, room authorization and streaming, shell cache headers, WASM bytes and missing asset responses. Playwright serves the built app with Node on port 3100 (`E2E_PORT` overrides it). The upgrade test serves two successive releases on its own loopback port and reopens the installed app offline.

### Offline updates

The [build step](scripts/build-offline.ts) copies the required ONNX, Piper and Bergamot engine files and writes the shell version, precache URLs and SHA-256 runtime hashes into the [service worker](public/sw.js). A missing engine file fails the build. HTML and the worker are served with `no-cache, no-store, must-revalidate` so browsers can discover a release.

A first online visit saves the app shell. Engine files are cached on first use. During an update, the worker fetches and verifies changed files for engines this browser already used before activating. Unchanged files keep their existing copies. The first upgrade from unversioned runtime entries refreshes those entries. Downloaded language models keep their separate Cache Storage and voice models stay in OPFS, so replacing the app or engine preserves the teacher’s downloads.

---

## 6. Known traps (read before editing)

- **Cache headers & template leftovers:** Preserve `Cache-Control: no-cache, no-store, must-revalidate` for `index.html`, `sw.js`, and the SPA fallback (`server/app.ts`), `DISABLE_HMR` in `vite.config.ts`, and `metadata.json` (`AGENTS.md`).
- **Web Speech restart behavior:** Chrome speech recognition ends on silence; `src/speechRestart.ts` and `src/speechDedupe.ts` reset per session intentionally across all three speech hooks (`useCaptionSpeech`, `useLectureSpeech`, `useConversationSpeech`). Any shared consolidation must preserve two-way recognizer reuse and lecture trailing-word capture.
- **Document Picture-in-Picture (`usePipWindow` / `PipSubtitlePortal`):** Opens a second `document` whose theme classes and styles are copied over. Test PiP visual changes in real Chrome; jsdom cannot open a PiP window.
- **Vitest environment:** Default test environment is `node` (`vitest.config.ts`); UI tests opt into jsdom via `// @vitest-environment jsdom` on line 1. `ConversationMode.lecture.test.tsx` uses fake timers — advance timers explicitly rather than waiting.
- **Live read-aloud effect order (`src/tts/useLecturePlayback.ts`):** The effect handling newly finalized lines must run **before** the interim-tracking effect, and both **before** auto-reading finalized lines. Otherwise a line already read live is spoken twice. Do not reorder its `useEffect` calls or split live read-aloud into a separate queue.
- **Live read-aloud mic suspension:** When **While I talk (headphones)** (`lectureLiveReadAloud`) is enabled, auto-reading passes `suspendSpeech: false` so the teacher's mic stays live; clicking a line to replay still calls `onBeforePlay` to pause the mic. Do not "simplify" this away.
- **Tuned timing constants:** Do not alter the constants at the top of `src/tts/liveSegments.ts` or `LIVE_CHUNK_WORDS` / `LIVE_THROTTLE_MS` during refactors without owner approval.
- **Piper & Meta MMS worker (`src/tts/piperWorker.ts`):** Runs one synthesis job at a time and warms each Piper voice with a throwaway synthesis on preload. Meta MMS voices (`mms-tts-<iso3>`) are CC BY-NC 4.0 models served from `https://bpmdata.github.io/overheard-voices` and cached in OPFS under `mms/` (see [`docs/mms-voices.md`](docs/mms-voices.md)).
- **On-device translation models (`src/translation/bergamot/`):** Bergamot (15 languages) + Opus-MT Transformers.js (Swahili) run in Web Workers reading strictly from Cache Storage `overheard-bergamot-v1` (see [`docs/offline-translation.md`](docs/offline-translation.md)).
- **One Cloud Run instance:** Keep `--max-instances 1` (`ROOMS.md`) until shared room state and pub/sub exist.
