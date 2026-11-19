# OverHeard architecture and refactor plan

This is a plan for whoever does the refactor, whether a person or a coding agent. It describes
the code as it is now, the layout to move toward, and an order of small steps that **don't
change behavior**. Read `AGENTS.md` first: its deployment rules and checks override anything here.

## How to use this document

**Setup from a fresh clone:** use Node 22 (`node --version`). Install with
`npm install --legacy-peer-deps --no-audit --no-fund`, the same command CI uses. Don't commit
a `package-lock.json`: the repository has none (there is a `bun.lock`), and CI installs
without one. `scripts/smoke.sh` needs `curl` and a free port 3000. No API keys are needed:
the app and the tests fall back gracefully without them.

Do **one step per pull request** (or per commit, if the owner prefers). A step is finished
only when all of these pass under Node 22:

```sh
npm test -- --run
npm run lint
npm run build
NODE_ENV=production node --check server.ts
bash scripts/smoke.sh
```

Rules for every step:

- **Move, don't rewrite.** Cut and paste the code, keep names and comments, and change only
  imports and parameters. If a step seems to need a behavior change, stop and list it under
  "Later: changes that alter behavior" instead.
- **Add tests first** where the step says so, and confirm they pass on the old code before
  moving anything.
- Don't change user-visible text, CSS class names, `aria-label`s, `localStorage` keys or
  API routes. Tests and saved browser state depend on them.
- Keep the old export names (e.g. `default export App`, `JoinRoomForm`) working.
- When a step is done, update the "Current layout" section below.

## Current layout (November 2026)

```
server.ts               Reads the environment, calls createApp(), and listens on 0.0.0.0:3000
server/app.ts           Express middleware, room routes, static files and SPA fallback
server/routes/mt.ts     /api/config, /api/mt, rate limits and usage
server/development.ts   Vite middleware and development-only WASM file routes
server/                 mt.ts (provider chain + request coalescing), rooms.ts (live rooms, SSE),
                        rateLimit, usage, clientKeys, shortLink
src/main.tsx            Picks StudentRoom (?room= or /<code>) or App
src/App.tsx             Wires caption hooks and views, mode changes, lecture import, modals and
                        the Conversation host (288 lines)
src/app/                Settings and URL sync, browser support, pack progress, main-window theme,
                        browser and microphone permission banners
src/speech/             Caption recognition lifecycle, Space shortcut, Web Speech types
src/captions/           Transcript state and export, column playback, ColumnsView, SubtitleBar,
                        TestInputBar
src/translation/        Server config (provider list), translation cache and retries
src/pip/usePipWindow.ts Pop-out lifecycle, line/layout/size preferences and pop-out theme sync
src/header/             AppHeader, ListenButton, FontSizeControls, DisplayModeSwitch,
                        TranslatorPicker and ClearTranscriptButton
src/components/         ConversationMode (mode switching, shared settings and lifecycle),
                        TwoWayView, LectureView, LectureTranscript, PipSubtitlePortal, modals
src/conversation/       Two-way and Lecture state, speech hooks, lecture translation
src/rooms/              Shared lecture rooms: teacher publishing, student view, protocol
src/tts/                Piper voices, useLecturePlayback (finished lines and live read-aloud),
                        useTwoWayPlayback, liveSegments and useSpeechPlayback re-exports
src/lib/                Google Drive
src/*.ts                Small shared helpers: onDevice, speechRestart, speechDedupe,
                        liveTranslation, useLiveTranslations, packProgress, pipLines, wakeLock
```

### What is inside `App.tsx`

App selects the caption or conversation surface and connects their shared settings and
actions. Caption recognition passes final and interim results to the transcript hook.
Both the projector views and the pop-out read the same transcript and listening state.
Conversation mode stays mounted after its first visit, with its activity controlled by
the display mode.

### Other problem spots

- **Speech recognition is written three times.** The caption mode recognizer (`useCaptionSpeech`), `useLectureSpeech` and `useConversationSpeech` each repeat the Chrome keep-alive
  restart, backoff (`speechRestart.ts`) and duplicate filtering (`speechDedupe.ts`).
- **There are two translation clients.** `fetchMT` in `src/translation/useTranslator.ts` (teacher) and
  `createStudentTranslator` in `src/rooms/translateStudent.ts` each implement on-device first,
  then `/api/mt`, with caching.
- Finished-line lecture playback and live read-aloud share one player and queue in
  `useLecturePlayback`. Its effects run in declaration order (see Traps).

## Target layout

```
src/
  main.tsx
  App.tsx                     ≤ 300 lines: picks the mode and wires hooks to views
  app/
    useAppSettings.ts         theme, font size, languages (?langs=), display mode
    useBrowserSupport.ts      capability detection (speech, PiP, iframe, secure context)
    usePackProgress.ts        on-device download progress
  translation/
    useTranslator.ts          fetchMT + retry + cache + provider tracking + preference
    useServerConfig.ts        /api/config, refine availability, provider list
    refine.ts                 Gemini clean-up of finalized lines
  speech/
    types.ts                  Web Speech API types
    useCaptionSpeech.ts       caption-mode recognizer (start/stop/keep-alive)
  captions/
    useCaptionTranscript.ts   segments, handleFinalizedPhrase, clear, export, test lines
    useColumnPlayback.ts      read-aloud for a column
    ColumnsView.tsx
    SubtitleBar.tsx
    TestInputBar.tsx
  pip/
    usePipWindow.ts           open/close, dark-mode sync, lines and layout prefs
  header/
    AppHeader.tsx             composes the controls below
    ListenButton.tsx
    FontSizeControls.tsx
    DisplayModeSwitch.tsx
    TranslatorPicker.tsx
    ClearTranscriptButton.tsx
  components/  conversation/  rooms/  lib/   (unchanged)
  tts/
    useLecturePlayback.ts     finished lines + live read-aloud (one player, one queue)
    useTwoWayPlayback.ts
    liveSegments.ts           pure rules for which words are settled enough to speak
server.ts                     thin: createApp() + listen on 0.0.0.0:3000
server/
  app.ts                      createApp(): middleware, routes, static/SPA fallback
  routes/mt.ts                /api/mt, /api/translate, /api/config
  (existing modules unchanged)
```

Ownership rule: **each hook owns its state and refs.** `App.tsx` keeps only what several
features share: selected languages, display mode, theme, font size. Replace the
`somethingRef.current = something` mirrors (`selectedLangsRef`, `mtPreferenceRef`,
`geminiRefineEnabledRef`) with a hook parameter plus one internal "latest value" ref.

## Steps

Steps 0–9 don't change behavior. Do them in order: each one makes the next one smaller.

### 0. Safety net (tests only)

Caption mode has the thinnest coverage. Add `src/App.captions.test.tsx` (jsdom, fake
`SpeechRecognition` like `ConversationMode.lecture.test.tsx` uses, fake `fetch`) covering:

- a final result adds a row and fills each language column from `/api/mt`;
- an interim result shows a live translation before the final arrives;
- `fetchMT` reuses one request for the same text and language, and does not retry after a 429;
- with translator preference "On this device", no `/api/mt` call is made (mock `../onDevice`);
- Clear transcript empties the columns; Export JSON downloads the lecture format;
- the space bar toggles listening but not while typing in an input.

### 1. Pure helpers out of `App.tsx`

Move the Web Speech interfaces to `src/speech/types.ts`. Move `parseInitialLanguages`,
`formatTimestamp`, `rejectAfter`, timeouts and storage keys to `src/app/settings.ts` (or next
to their only user). No hooks yet. This is low risk and makes the next diffs readable.

### 2. `useServerConfig` and `useTranslator`

Move `refreshServerConfig`, provider/preference state, `fetchTranslationWithRetry`, `fetchMT`,
the cache and the provider map into `src/translation/`. Return `{ fetchMT, mtPreference,
setMtPreference, availableProviders, lastUsedProvider, lastTranslateMs, … }`. Keep the cache
behavior exactly: a shared promise per key, failures evicted, size-capped.

### 3. `usePackProgress`, `useBrowserSupport`, theme sync

Small, independent effects with their state.

### 4. `useCaptionSpeech`

Move `startListening`, `stopListening`, `toggleListening`, the restart timer and failure refs,
and the unmount cleanup. It takes callbacks (`onFinal`, `onInterim`, `onPermissionDenied`) and
returns `{ isListening, interim, speechIsLocal, notice, start, stop, toggle }`. Keep the space
bar shortcut in `App.tsx` or in a tiny `useHotkey`. **Don't merge it with the other two speech
hooks in this step.**

### 5. `useCaptionTranscript` and `refine.ts`

Move `segments`, `handleFinalizedPhrase` (including the Gemini refine and its history
context), clear, manual test lines, the burst test and JSON export. `refine.ts` holds the
request/merge logic with no React.

### 6. `usePipWindow`

The pop-out: open/close, notices, `pipLines`/`pipLayout` and their storage, and the
dark-class sync for the second window. `PipSubtitlePortal` stays as is.

### 7. Views

Cut the JSX into `ColumnsView`, `SubtitleBar`, `TestInputBar`, banners and `AppHeader` (with
its controls as listed in the target layout). Pass props, not context. Explicit props make
the dependencies visible, and the tree is shallow. When this is done, `App.tsx` should be
under ~300 lines.

### 8. `ConversationMode.tsx`

Split into `TwoWayView` and `LectureView` with a thin `ConversationMode` that switches
between them and keeps the shared settings bar.

### 8b. `useSpeechPlayback.ts`

Move `useTwoWayPlayback` and its types into `src/tts/useTwoWayPlayback.ts`, and rename the
rest to `src/tts/useLecturePlayback.ts`. Re-export both from `useSpeechPlayback.ts` until all
imports are updated. **Don't split live read-aloud out of the lecture hook,** and don't
reorder its `useEffect` calls. `src/tts/liveReadAloud.test.ts` must keep passing unchanged.

### 9. Server

Move the Express setup from `server.ts` into `server/app.ts` as `createApp(options)`, and the
MT routes into `server/routes/mt.ts`. `server.ts` keeps reading the environment and calling
`listen(3000, '0.0.0.0')`. Then test the routes with the loopback pattern in
`server/rooms.test.ts`. **Server code rules:** erasable TypeScript only (no `enum`,
`namespace`, or constructor parameter properties), `import type` for types, explicit `.ts`
extensions on relative imports, and no React, CSS or devDependencies in the import graph.
Check with `node server.ts` as well as `node --check`.

### Later: changes that alter behavior

Do these only after steps 0–9 (including 8b), each as its own PR, with a note on what users will notice:

- **One speech engine.** Extract the shared recognizer core (keep-alive restart, backoff,
  duplicate filtering, on-device speech) from the three hooks into `src/speech/engine.ts`.
  Caption, Lecture and Two-way modes then each add their own turn/segment logic on top.
- **One translation client** for teacher and student (`useTranslator` and
  `createStudentTranslator`). Students currently force `provider: 'gtx'`; keep that as an
  option.
- **Reuse Piper's phonemizer.** `@mintplex-labs/piper-tts-web` builds a new phonemizer
  (635 KB of WebAssembly plus 18 MB of eSpeak data) on every `predict`. That costs about
  0.1 s per piece on a fast laptop and several times that on a phone. It's most noticeable
  at the start of each pause-separated line during live read-aloud. Fixing it means
  patching or forking the library (e.g. with `patch-package`); measure on a school laptop
  first.
- **Live translation for the finalized line.** The final sentence is translated from
  scratch, while its interim chunks were already translated. Reusing them is possible but
  would lower quality; measure before changing it.

## Traps

- `src/rooms/protocol.ts` is imported by **both** the server and the browser. Keep it
  erasable TypeScript with no React or DOM.
- Cache headers (`no-cache, no-store, must-revalidate` for `index.html`, `sw.js` and the
  SPA fallback), `DISABLE_HMR` in `vite.config.ts`, and `metadata.json` must stay as they
  are (see `AGENTS.md`).
- Chrome speech recognition ends by itself every so often; the restart loop and the
  duplicate filter are reset per session on purpose. Move them as they are.
- The pop-out window is a second `document`: theme classes and styles are copied into it.
  Test pop-out changes in real Chrome; jsdom can't open one.
- The UI tests choose jsdom with a `// @vitest-environment jsdom` first line; the default
  environment is Node.
- `ConversationMode.lecture.test.tsx` uses fake timers. New tests in that file must advance
  timers instead of waiting.
- **Live read-aloud** (`useLecturePlayback`) depends on effect order. The effect that handles
  a newly finalized line must run **before** the effect that tracks interim words, and both
  **before** the effect that auto-reads finalized lines. Otherwise a line already read live
  is read again. Pieces play strictly in order through the same player as finished lines.
- With live read-aloud on (the teacher's **While I talk (headphones)** option, saved as
  `lectureLiveReadAloud` in conversation settings), automatic reading doesn't call
  `onBeforePlay` (which pauses the teacher's microphone) unless `live.suspendSpeech` is true. Clicking a line to replay it
  still pauses the mic. Don't "simplify" this.
- The timing constants at the top of `src/tts/liveSegments.ts` and `LIVE_CHUNK_WORDS` /
  `LIVE_THROTTLE_MS` for live translation were tuned with the owner. Don't change them in a
  refactor.
- The Piper worker (`src/tts/piperWorker.ts`) runs one job at a time and warms each voice
  with a throwaway synthesis on preload. Test voice changes in real Chrome, because the
  voice models download from Hugging Face.
- Live rooms keep state in one process. Don't add anything that assumes more than one
  Cloud Run instance (see `ROOMS.md`).
