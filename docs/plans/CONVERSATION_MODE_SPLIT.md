# Plan: Split `src/tts/voices.ts` and `src/components/ConversationMode.tsx`

> **For Code 6.1 Terra:** Read `AGENTS.md` and `ARCHITECTURE.md` first.
> **Behavior-preserving refactor only.** Do not change user-visible text, CSS class names, DOM hierarchy inside `.conversation-settings`, `aria-label`s, `title`s, `localStorage` keys, or existing export names (`ConversationMode`, `PIPER_VOICES`, etc.).

## Why a prior attempt failed (read carefully before editing)

`src/components/ConversationMode.tsx` (820 lines, 32 React hooks) handles **both** Two-Way (including `FaceToFaceView`) and Lecture modes inside one component. A naive component split breaks for three specific reasons:

1. **Flat toolbar DOM / CSS layout:** Both modes share one `<div className="conversation-settings">` flex container (lines 503–675). Wrapping mode-specific buttons in extra `<div>` elements breaks `.conversation-settings` wrapping and responsive toolbar layout (`ConversationMode.css`). Use React fragments (`<>...</>`) inside toolbars so the rendered DOM elements stay identical.
2. **Single `useConversationSettings` source of truth:** Calling `useConversationSettings()` separately in child components creates two divergent `useState` copies. Keep `useConversationSettings(initialLanguage)` once in `ConversationMode.tsx` and pass `settings` / `setSettings` down.
3. **Preserved state across `App.tsx` mode switches (`hidden={!active}`):** `App.tsx` keeps `<ConversationMode />` mounted after first visit and toggles `hidden={!active}`. Two-Way `messages` (`useReducer(messagesReducer, [])`) and `spoken` refs must stay mounted in memory when switching to Columns/Subtitle or toggling between `two-way` and `lecture`.

---

## Phase 1 — Split static voice catalog out of `src/tts/voices.ts` (845 lines)

1. Create `src/tts/voiceCatalog.ts` containing the static types, constants, and catalog tables currently in `src/tts/voices.ts`:
   - `PiperLanguage`, `VoiceEngine`, `PiperVoiceOption`
   - `MMS_VOICE_BASE_URL`, `MMS_ATTRIBUTION`, `voiceEngine`, `mmsVoiceUrl`, `mmsVoice` (internal helper)
   - `BROWSER_VOICE_ID`, `BROWSER_VOICE_LABEL`, `VOICE_PREFS_STORAGE_KEY`, `VOICE_PREFS_EVENT`
   - `PIPER_VOICES`, `DEFAULT_PIPER_VOICE_ID`, `PIPER_MODEL_BYTES`, `PIPER_DEFAULT_MODEL_BYTES`, `PIPER_RUNTIME_BYTES`
2. In `src/tts/voices.ts`:
   - Import from `./voiceCatalog` AND **re-export** all moved symbols (`export { ... } from './voiceCatalog'; export type { ... } from './voiceCatalog';`) so every existing caller (`voices.test.ts`, `piperWorker.ts`, `piperClient.ts`, `voiceStorage.ts`, `VoiceSelect.tsx`, `StudentRoom.tsx`, etc.) keeps working untouched.
   - Keep runtime lookup/preference functions and hooks in `src/tts/voices.ts`: `hasPiperVoices`, `voicesForLanguage`, `findPiperVoice`, `voicePreviewText`, `isValidVoiceForLanguage`, `resolveVoiceId`, `loadVoicePreferences`, `saveVoicePreferences`, `useVoicePreferences`, `voiceDownloadBytes`, `voiceDownloadLabel`.

### Phase 1 Checkpoint
```sh
npm test -- --run src/tts/voices.test.ts src/components/VoiceSettingsModal.test.tsx
npm test -- --run
npm run lint
```

---

## Phase 2 — Extract Lecture workspace hook & toolbar from `ConversationMode.tsx`

1. Create `src/conversation/useLectureWorkspace.ts`:
   - Owns all lecture-specific state, refs, and effects currently in `ConversationMode.tsx`:
     - `activeRoomCode`, `shareSetupOpen`, `roomJustEnded`, `previousRoomCode`, `handleRoomCodeChange`
     - `roomControlsId`, `lectureToolsId`, `roomCodeRef` (+ `useEffect` focusing `roomCodeRef` when `shareSetupOpen` opens)
     - `driveStatus`, `setDriveStatus`
     - `lecturePlaybackLang`, `setLecturePlaybackLang`, `lectureReadAloud`, `setLectureReadAloud`
     - `useLectureMode(...)`, `translateLiveSpeech`, `lectureLangs`, `effectiveLectureLang`, `useLecturePlayback(...)`
     - `wasLecturePlaying` ref + resume `useEffect`
     - `lectureState` object
     - `importedLecture` sync `useEffect` (`lastImportedSeq` ref — switches `settings.mode` to `'lecture'` and calls `lecture.replace`)
     - `startLecture` handler
   - Expose `{ lecture, lectureState, lecturePlayback, lectureLangs, effectiveLectureLang, lecturePlaybackLang, setLecturePlaybackLang, lectureReadAloud, setLectureReadAloud, activeRoomCode, shareSetupOpen, setShareSetupOpen, roomJustEnded, handleRoomCodeChange, roomControlsId, lectureToolsId, roomCodeRef, driveStatus, setDriveStatus, startLecture, stopLectureWorkspace }`.
2. Create `src/components/LectureToolbar.tsx` (optional or co-located cleanly):
   - Extract the Lecture middle toolbar fragment (`<div className="lecture-teaching-controls" ...>` lines 537–579) and the `<div className="lecture-bar">` + `<PlaybackToolbar>` block (lines 692–752) + `driveArchive` helper, keeping **exact** class names, `aria-*` attributes, and element order.
3. Wire `useLectureWorkspace` into `ConversationMode.tsx` and confirm zero behavior or DOM changes.

### Phase 2 Checkpoint
```sh
npm test -- --run src/components/ConversationMode.lecture.test.tsx src/components/ConversationMode.readAloud.test.tsx src/components/ConversationMode.onDevice.test.tsx src/App.conversation.test.tsx
npm run lint
```

---

## Phase 3 — Extract Two-Way workspace hook from `ConversationMode.tsx`

1. Create `src/conversation/useTwoWayWorkspace.ts`:
   - Owns all two-way state, refs, and effects currently in `ConversationMode.tsx`:
     - `messages`, `dispatch`, `onCorrectMessage`
     - `sender`, `setSender`, `text`, `setText`, `newMessage`, `setNewMessage`
     - `thread`, `nextButton`, `fileInput`, `following`, `requests`, `spoken` refs
     - `send`, `useConversationSpeech(...)`, `useTwoWayPlayback(...)`
     - `nextButton.current?.focus()` effect (when `manualTurns && speech.isListening`)
     - `keydown` listener (`Space`, `ShiftLeft`, `ShiftRight`)
     - Message translation `useEffect` (`requests.current` dedupe + `dispatch({ type: 'resolve', ... })`)
     - Auto read-aloud `useEffect` (`spoken.current` dedupe + `twoWayPlayback.enqueueAuto`) + `spoken` sync when `!settings.readAloud`
     - Auto-scroll `useEffect` (`following.current` / `setNewMessage(true)`)
     - `start`, `startFrom`, `exportJson`, `importJson`, `stopTwoWayWorkspace`
   - Note: Keep calling `useTwoWayWorkspace` unconditionally in `ConversationMode.tsx` (NOT conditionally mounted `{!isLecture && ...}`), so switching between `two-way` and `lecture` or hiding `ConversationMode` preserves `messages` and `spoken` refs in memory exactly as today!
2. Shrink `ConversationMode.tsx` to ≤ ~220 lines:
   - Owns only: `useConversationSettings`, `useVoicePreferences`, `updateVoicePref`, `useWakeLock(active)`, `controlsOpen`, `fullscreen`, `uiError`, `isVoiceSettingsOpen`, `isGuideOpen`, `root` ref, `useLanguagesNeedingOnline`, the active/submode stop `useEffect`, `stopConversationAndCleanup`, `exit`, `goHome`, `switchSubMode`, `toggleFullscreen`, and rendering the shell + `LectureView` / `FaceToFaceView` / `TwoWayView` + modals.
3. Update `ARCHITECTURE.md` §4 (`voiceCatalog.ts`, `useLectureWorkspace.ts`, `useTwoWayWorkspace.ts`, updated `ConversationMode.tsx` line count) and `TODO.md`.

### Final Verification
```sh
npm test -- --run
npm run lint
npm run build
NODE_ENV=production node --check server.ts
bash scripts/smoke.sh
```
