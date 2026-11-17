# OverHeard architecture and refactor plan

This is a plan for whoever does the refactor, whether a person or a coding agent. It describes
the code as it is now, the layout to move toward, and an order of small steps that **don't
change behavior**. Read `AGENTS.md` first: its deployment rules and checks override anything here.

## How to use this document

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
server.ts               Express app: security headers, /api/config, /api/mt, /api/translate,
                        static files and SPA fallback (465 lines)
server/                 mt.ts (provider chain + request coalescing), rooms.ts (live rooms, SSE),
                        rateLimit, usage, clientKeys, shortLink, geminiSingle
src/main.tsx            Picks StudentRoom (?room= or /<code>) or App
src/App.tsx             Caption mode (Columns + Subtitle), header, pop-out, modals, and the
                        host for Conversation mode (2,378 lines)
src/components/         ConversationMode (983 lines: Two-way and Lecture), LectureTranscript,
                        PipSubtitlePortal, modals
src/conversation/       Two-way and Lecture state, speech hooks, lecture translation
src/rooms/              Shared lecture rooms: teacher publishing, student view, protocol
src/tts/                Piper voices and read-aloud playback
src/lib/                Google Drive
src/*.ts                Small shared helpers: onDevice, speechRestart, speechDedupe,
                        liveTranslation, useLiveTranslations, packProgress, pipLines, wakeLock
```

### What is inside `App.tsx`

Find each part by its comment; line numbers drift.

| Part | Landmark comment(s) | Approx. lines |
|---|---|---|
| Web Speech types, URL parsing, timing helpers, storage keys | `interface SpeechRecognitionEvent`, `parseInitialLanguages`, `rejectAfter` | 85–188 |
| Column read-aloud playback | `columnPlayback`, `speakColumnTranslation` | 205–270 |
| ~45 `useState`/`useRef` declarations for every feature | `// Modals & drawers`, `// Speech recognition & permission states`, … | 270–440 |
| Server config and translator preference | `refreshServerConfig`, `mtPreference`, `availableProviders` | 380–480 |
| On-device language pack progress | `packProgress`, `reportPack` | 400–436 |
| Theme sync and browser capability detection | `// Sync dark mode class`, `// Initial browser capability detection` | 481–523 |
| **Translation client**: retry, cache, Auto/on-device/server choice | `fetchTranslationWithRetry`, `fetchMT` | 524–672 |
| Live (interim) translation | `useLiveTranslations(` | 673–682 |
| **Finalized phrase**: per-language MT, then optional Gemini refine | `handleFinalizedPhrase` | 683–775 |
| **Caption speech recognition**: Chrome keep-alive, restart backoff | `startListening`, `stopListening`, `toggleListening` | 776–972 |
| Space bar shortcut, language toggle, font size | `// Spacebar toggles` | 973–1013 |
| **Pop-out window** (Document Picture-in-Picture) | `// Document Picture-in-Picture Pop-Out Window` | 1014–1111 |
| Transcript export, clear, test sentences, lecture import | `// Lecture-compatible JSON Transcript Export` … `applyImportedLecture` | 1112–1390 |
| JSX: banners | `{/* Browser Compatibility Banner */}` | 1395–1447 |
| JSX: **header** (≈330 lines, ~15 controls) | `{/* Top Teacher Control Bar */}` | 1448–1775 |
| JSX: test input bar | `{/* Collapsible Silent Test Input Bar */}` | 1776–1828 |
| JSX: **columns view** | `{/* Main Projector Display Stage */}` | 1829–2156 |
| JSX: subtitle bar | `{/* Fixed Bottom Subtitle Bar */}` | 2157–2287 |
| JSX: Conversation mode, modals, pop-out portal | `<ConversationMode`, `{/* Modals & Portals */}` | 2288–2378 |

### Other problem spots

- **Speech recognition is written three times.** The caption mode recognizer (inline in
  `App.tsx`), `useLectureSpeech` and `useConversationSpeech` each repeat the Chrome keep-alive
  restart, backoff (`speechRestart.ts`) and duplicate filtering (`speechDedupe.ts`).
- **There are two translation clients.** `fetchMT` in `App.tsx` (teacher) and
  `createStudentTranslator` in `src/rooms/translateStudent.ts` each implement on-device first,
  then `/api/mt`, with caching.
- `ConversationMode.tsx` holds both Two-way and Lecture UI, with lecture logic already pulled
  into `useLectureMode`.
- `server.ts` builds the whole Express app inline, so the `/api/mt` and `/api/translate`
  handlers can't be tested without starting a server.

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
  components/  conversation/  rooms/  tts/  lib/   (unchanged)
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

### 9. Server

Move the Express setup from `server.ts` into `server/app.ts` as `createApp(options)`, and the
MT routes into `server/routes/mt.ts`. `server.ts` keeps reading the environment and calling
`listen(3000, '0.0.0.0')`. Then test the routes with the loopback pattern in
`server/rooms.test.ts`. **Server code rules:** erasable TypeScript only (no `enum`,
`namespace`, or constructor parameter properties), `import type` for types, explicit `.ts`
extensions on relative imports, and no React, CSS or devDependencies in the import graph.
Check with `node server.ts` as well as `node --check`.

### Later: changes that alter behavior

Do these only after steps 0–9, each as its own PR, with a note on what users will notice:

- **One speech engine.** Extract the shared recognizer core (keep-alive restart, backoff,
  duplicate filtering, on-device speech) from the three hooks into `src/speech/engine.ts`.
  Caption, Lecture and Two-way modes then each add their own turn/segment logic on top.
- **One translation client** for teacher and student (`useTranslator` and
  `createStudentTranslator`). Students currently force `provider: 'gtx'`; keep that as an
  option.
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
- Live rooms keep state in one process. Don't add anything that assumes more than one
  Cloud Run instance (see `ROOMS.md`).
