# TODO

## How OverHeard is used

1. **Projector / smartboard:** the teacher presents, and captions float over the slides in the
   pop-out (Document Picture-in-Picture) window.
2. **Laptop on the desk:** the teacher carries the laptop to a student or small group, sets it
   down in front of everyone, and shows live captions in the column view.
3. **Conversation mode:** a one-on-one, two-way conversation with a student, or English ↔
   English with a deaf or hard-of-hearing person.

---

## Open

### Test a dedicated Android tablet for Grandpa (Fully Kiosk Browser)

Goal: a tablet that only runs OverHeard Conversation mode, survives reboots, and needs no
help from him.

1. First, check speech on any Android phone in Chrome: run the Grandpa scenario for 5+
   minutes. Watch for dropped turns, restart chimes, and the 2.5 s pause handoff.
2. Serve OverHeard over HTTPS, then install it as a PWA (Chrome menu → Install app).
3. Install Fully Kiosk Browser (Plus license, about €8). Set: start URL = OverHeard, launch
   on boot, keep screen on, hide status/navigation bars, PIN to exit, auto-grant microphone.
4. Try motion/camera wake, a power-cycle (does it come back on its own?), and remote admin.
5. Hardware: stand, always-on charger, and a clip-on mic if he speaks softly.
6. Fallback if Fully Kiosk isn't needed: Android screen pinning with a PIN to unpin.

If Chrome's speech handling on Android is the weak point, consider a Capacitor wrapper that
uses Android's native `SpeechRecognizer`.

### Face-to-face layout for a tablet (pinned)

Pinned until OverHeard is used on a tablet. In Conversation mode, split the screen top and
bottom and rotate the top half 180°. Two people facing each other across a tablet lying flat
can then each read their own side of the conversation right way up.

### Rework the column view for the "laptop on the desk" use case

Not specified yet. Starting points: readable from across a desk at a slight angle, less
chrome around the captions, and possibly a one-language-at-a-time layout for a single
student. Decide after using it with a small group.

### Split up `src/App.tsx` (about 2,000 lines)

It works, but everything lives in one component: captioning, speech recognition, translation,
the pop-out window, the language modal and the header, so any change risks a side effect. Fix
sooner rather than later, but carefully:

- Do it as its own PR with **no behavior changes**, in small steps, running CI after each.
- Suggested pieces: a speech hook for caption mode (start/stop, restart backoff, on-device
  speech), a translation hook (`fetchMT`, the cache, Auto / On this device logic, the Gemini
  clean-up), the on-device download state (`packProgress`, `reportPack`), the header and
  translator picker as components, and the transcript export.
- Conversation mode already lives in its own files and shows the pattern.
- Test coverage of the caption path is thin, so add tests around `handleFinalizedPhrase` and
  `fetchMT` *before* moving them.

### Small cleanups

- `getOnDeviceTranslator`, `prepareOnDeviceTranslators` and `translateGoogleCloud` / `translateGtx`
  take an argument that can be a language code *or* a helper function. It works but is
  confusing; switch to an options object.
- Old branches in the repo: `ci-tests`, `fast-live-translation`, `popout-compact`,
  `popout-lines` and merged feature branches. Delete once you're sure nothing is on them.
- `PLAN.md` was Codex's plan for Conversation mode and is finished. Delete it, or keep it as
  history (the Conversation mode spec below links to nothing there).
- `ON_DEVICE_TIMEOUT_MS` in `src/App.tsx` is 10 s for the "On this device" mode, deliberately
  longer than the online translators' 2.5 s so slow results can be measured. Revisit it once
  you've seen real timings on the school MacBooks.

### If many teachers use it

- The Cloud Run service is set to a maximum of **1 instance**. That's fine for dozens of
  teachers, since the server mostly waits on other services. If you raise it, each instance
  keeps its own rate limits, translation cache, daily spending guards and "benched translator"
  list, so the guards become *per instance*. Divide the daily caps accordingly.
- Watch the `[usage]` lines in the Cloud Run logs: active tabs, requests per translator,
  throttling, and how much of today's spending guards are used.
- If the link spreads beyond people you trust, add an access code. Anyone with the URL can
  currently use your translation quota.
- Switch Gemini to a cheaper model by setting `GEMINI_MODEL` to the Flash-Lite model ID shown in
  AI Studio's model picker. Test one sentence afterwards: the code sets a thinking level that
  some models may not accept.

---

## Done

### Conversation mode

Built from the spec below (PRs #9 and #10). Turns switch automatically after silence, or
manually with Space / **Next speaker**. Each side has a typed name and language, saved between
visits. Messages never expire, and the thread scrolls all the way back. It also has ⇄ to
correct a misattributed message, full screen, read aloud, CSV export and import, and typed
messages. Translation works from any language, not just English, on all three online
translators and on Chrome's on-device translator. With **On this device**, Start downloads
every pack both people need (translation in both directions and a speech pack for each
language) and shows the download progress.

Code: `src/conversation/` (state, locales, speech hook, translation chunking) and
`src/components/ConversationMode.tsx`.

The checklist in section 1.7 is for re-testing on a new device. It isn't ticked off here.

<details>
<summary>Original spec (implemented), kept for reference</summary>

#### Spec: turn-based, text-message-style live translation

> Written as an implementation spec for an AI coding agent. Follow it closely; where it says
> "must", treat that as an acceptance criterion.

### 1.1 Goal

A new display mode, **Conversation**, for two people taking turns talking. It looks like a
text-message thread. When one person finishes speaking, their words "arrive" as a message
bubble in the other person's language, with the original underneath in smaller text.

Example: the teacher (English) talks with a student (Spanish).
- The teacher speaks English. A bubble appears on the student's side in Spanish, with the
  English original underneath.
- The student speaks Spanish. A bubble appears on the teacher's side in English, with the
  Spanish original underneath.

**English ↔ English must be supported.** Both sides are English and nothing is translated, so
it works as a two-way live captioner with names on each side. Intended use: talking with a
deaf or hard-of-hearing relative, who reads what the other person says and replies by
speaking.

**It must work hands-free.** After someone stops talking, the app switches to listening for
the other person on its own. The deaf/elderly user must never have to press anything. The
person running the app learns to leave a few seconds of silence at the end of each turn.

**Layout:** the conversation thread fills the screen, like a full-screen chat app. Unlike
the column view, nothing ever times out or disappears. The whole conversation stays
scrollable, so anyone can scroll back up to reread earlier messages at any time.

### 1.2 Requirements

**Sides and names**
- There are exactly two sides, **A** (left, normally the teacher) and **B** (right).
- Each side has a **display name** that the user types into a text field in a small
  settings bar above the thread, for example "Mr. Murphy" / "Students" or
  "Bryan" / "Grandpa". Defaults: `"Me"` and `"Student"`. The name labels that side's
  bubbles, turn button and "Listening for…" indicator.
- Each side has a **language**: English (`en`) plus every language in `SUPPORTED_LANGUAGES`
  (`src/constants.ts`). Defaults: A = `en`, B = the first language in the current `?langs=`
  selection, or `es` if there is none.
- Both sides may use the same language. When they do, no translation happens: bubbles show
  the text only, with no "original" line.
- Names and languages must persist across reloads in `localStorage` under the key
  `overheard.conversation`. Store
  `{ a: { name, lang }, b: { name, lang }, switchAfterMs, readAloud }`. Wrap every read and
  write in try/catch; the app must work if storage is blocked.

**Taking turns: automatic, hands-free**
- The Web Speech API can't tell *who* is speaking or which language is being spoken, and
  one recognizer listens for one language at a time. So the app keeps track of whose turn
  it is and switches turns automatically after silence.
- A single **Start conversation** / **Stop conversation** button controls everything. Start
  begins listening for side A (whoever is set as the starting speaker; default A).
- **The turn loop:**
  1. Set `recognition.lang` to the current speaker's locale (see 1.4) and call `start()`
     with `continuous = true` and `interimResults = true`.
  2. While they talk, show their words live in a "typing" bubble on their side of the
     thread.
  3. Final results are appended, space-separated, to the speaker's **draft**.
  4. Once the speaker has said something, a silence lasting `switchAfterMs` sends the
     draft. Silence is measured from the last result of any kind, interim or final, so a
     long word or slow phrase doesn't count as silence. The default is 2500 ms; a setting
     offers 1.5 s, 2.5 s, 3.5 s and 5 s.
  5. Sending stops the recognizer and immediately starts step 1 for the **other** side.
- **Waiting for a reply never times out.** If the current side hasn't said anything yet,
  keep listening indefinitely. Treat Chrome's `no-speech` error and `onend` as "restart and
  keep waiting", using the backoff in `src/speechRestart.ts`. Grandpa may take a while to
  answer, and the app must still be listening when he does.
- A clear **"Listening for {name}…"** indicator shows whose turn it is: a large pulsing
  label in that side's color at the bottom of the screen.
- **Manual overrides** for the person running the app (never required):
  - Each side has a small **"{name}'s turn"** button that switches the turn immediately,
    sending any current draft first.
  - **Left Shift** = A's turn, **Right Shift** = B's turn. Ignore these while focus is in an
    `<input>`, `<textarea>` or `<select>`.
  - Use these when the same person wants to say two things in a row, or the app switched
    too early.
- **Known limitation, show in the UI help text:** the speaker is decided by whose turn it
  is, not by voice. If both people talk at once, or the wrong person answers, the bubble
  lands on the wrong side. Each bubble gets a small **⇄** button that moves it to the other
  side. If the languages differ, it is re-translated in the other direction.
- Errors:
  - `not-allowed`: show the existing microphone-permission banner and stop the
    conversation.
  - `language-not-supported`: stop the conversation and show "Speech recognition doesn't
    support {language} in this browser."

**Typing (secondary, for when speech can't be used)**
- A collapsed "Type a message" row under the thread. When opened, it shows a text box and a
  sender picker (A or B). Enter sends. Typed messages are translated and shown exactly like
  spoken ones. Typing doesn't change whose turn it is.

**Message bubbles**
- Thread layout: side A's messages are left-aligned and side B's are right-aligned, like a
  phone chat. Each bubble shows:
  - The sender's name and a timestamp (`HH:MM`), in small text.
  - The **text in the reader's language**, large. It uses the global font size from the
    existing `A-` / `A+` controls (`fontSize` state). It is colored from
    `src/captionColors.tsx`: side A uses `ENGLISH_CAPTION_COLOR` when its language is
    English, otherwise `languageCaptionColor(0)`; side B uses `languageCaptionColor(1)`.
    Use `captionTextStyle()` so light mode gets the black highlight.
  - The **original text**, about 60% size and muted, only when the two languages differ.
  - While translating: the original shown large, with a pulsing "Translating…" label. When
    the translation arrives it replaces the large text.
  - On failure: the original large, plus a small amber "translation unavailable" note.
- Right-to-left languages (`ar`, `prs`, `ps`) must render their text with `dir="rtl"`, using
  `LANGUAGE_MAP[code].dir`.
- **Nothing is ever removed automatically.** Keep every message for the whole session, and
  keep the thread scrollable all the way back to the first message.
- The thread auto-scrolls to the newest message unless the user has scrolled up. In that
  case show a "↓ New message" pill that scrolls down when clicked. Scrolling back down to
  the bottom resumes auto-scroll.
- Conversation mode is full-screen: the thread fills the window. Only a thin settings bar
  (names, languages, switch delay, Start/Stop, Clear, Export, Exit) sits above it, and the
  "Listening for…" indicator and collapsed typing row sit below it. Use the browser's
  Fullscreen API with a **Full screen** button, and exit cleanly on Esc.
- A **Clear conversation** button asks for confirmation, then empties the thread. This is
  the only way messages are removed.
- **Export:** a download button saves the conversation as CSV (UTF-8 with BOM, same as the
  existing transcript export). Columns: timestamp, sender name, original language, original
  text, translated language, translated text.

**Optional, only once everything above works**
- **Read aloud:** a toggle that speaks each received message in the listener's language with
  `speechSynthesis`, picking a voice whose `lang` starts with the target language code.
  Pause the recognizer while the voice is speaking, so the app doesn't caption itself or
  count its own voice as the next speaker. Off by default.

### 1.3 Where it lives in the code

- Add `'conversation'` to `DisplayMode` in `src/types.ts`. Add a third button next to the
  existing **Columns** / **Subtitle** buttons in `src/App.tsx` (search for
  `setDisplayMode('subtitle')`).
- **Entering conversation mode** must stop the main caption recognizer: call the existing
  `stopListening()`. It also hides the Start Listening button, the language picker and the
  pop-out button. **Leaving** returns to the previous mode with captioning stopped.
- The global **Spacebar** start/stop shortcut in `src/App.tsx` must do nothing while in
  conversation mode. Conversation mode uses the Shift keys instead.
- `src/App.tsx` is already very large, so do **not** build the mode inside it. Create:
  - `src/components/ConversationMode.tsx`: the whole UI. Receives `fontSize`, `isDark`
    and the translate function as props.
  - `src/conversation/useConversationSpeech.ts`: a hook that owns its own
    `SpeechRecognition` instance, the turn loop, drafts, the silence timer and error
    handling.
  - `src/conversation/state.ts`: pure functions and a reducer for messages and turns, so
    they can be unit tested without a browser.
  - `src/conversation/locales.ts`: maps language codes to speech locales (see 1.4).

### 1.4 Speech recognition locales

`recognition.lang` needs a BCP-47 locale, not our two-letter codes. Use this map, and fall
back to the bare code when a language isn't in it:

| Code | Speech locale | Note |
|---|---|---|
| `en` | `en-US` | |
| `es` | `es-US` | US Spanish; `es-MX` is an alternative |
| `pt` | `pt-BR` | |
| `ar` | `ar-SA` | Consider a dialect setting later, e.g. `ar-EG` |
| `zh` | `zh-CN` | Mandarin, Simplified |
| `vi` | `vi-VN` | |
| `fr` | `fr-FR` | |
| `uk` | `uk-UA` | |
| `ru` | `ru-RU` | |
| `ht` | `ht-HT` | **Unverified**, may be unsupported |
| `so` | `so-SO` | **Unverified** |
| `prs` | `fa-AF` | **Unverified**; Dari. `fa-IR` (Persian) is the closest fallback |
| `ps` | `ps-AF` | **Unverified** |

The unverified ones rely on the `language-not-supported` handling in 1.2, which sends the
user to the text box. Do not hide them from the picker.

### 1.5 Translation must work from any language, not just English

Every translator currently assumes English is the source language. Generalize it:

- **Client:** in `src/App.tsx`, `fetchMT(text, lang)` becomes
  `fetchMT(text, target, source = 'en')`. Include `source` in the client cache key.
  Existing caption code keeps calling it without `source`. Pass `fetchMT` into
  `ConversationMode`. If `source === target`, return the text unchanged without calling
  anything.
- **Server, `/api/mt` in `server.ts`:**
  - Accept an optional `source` field. Default `'en'`. It must be `'en'` or a key of
    `SUPPORTED_LANGUAGES`; return 400 otherwise.
  - Reject `source === lang` with a 400; the client never sends that.
  - Pass `source` through `machineTranslator.translate(text, lang, preferred, source)`.
- **`server/mt.ts`:**
  - `translateGtx(text, code, source = 'en')`: replace the hard-coded `sl=en` with
    `sl=${toGoogleCode(source)}`.
  - `translateGoogleCloud(text, code, apiKey, source = 'en')`: replace `source: 'en'`.
  - `createMachineTranslator().translate(text, code, preferred?, source = 'en')`: add
    `source` to the cache key and pass it to `callProvider`.
  - The Gemini single-translation prompt in `server.ts`
    (`` `Translate into ${...}` ``) becomes
    `Translate from {source name} into {target name}`. Use `'English'` for `en`.
- **On-device, `src/onDevice.ts`:**
  - `getOnDeviceTranslator(code)` becomes `getOnDeviceTranslator(target, source = 'en')`.
  - Cache key: `` `${source}>${target}` ``.
  - Call `availability()` and `create()` with
    `{ sourceLanguage: toTranslatorCode(source), targetLanguage: toTranslatorCode(target) }`.
  - Make the same change to `translateOnDevice` and `prepareOnDeviceTranslators`.
  - In conversation mode with "On this device" selected, prepare both directions
    (A→B and B→A) when the user presses **Start conversation**, since downloads need a user
    gesture.
  - On-device **speech** in conversation mode: call
    `prepareOnDeviceSpeech(locale)` for the speaking side's locale at the start of each
    turn, and set `recognition.processLocally` from the result. Fall back to cloud speech,
    and show the existing 🎙 local/cloud badge.
- **Skip the Gemini refinement pass** (`/api/translate`) in conversation mode for now. It
  assumes English input.
- The translator picker (Auto / On this device / Free / Google Cloud / Gemini) applies in
  conversation mode as well.

### 1.6 Tests (must pass in CI: `npm run lint`, `npm test`, `npm run build`, `bash scripts/smoke.sh`)

- `src/conversation/state.test.ts`:
  - Appending final results to a draft.
  - Sending a draft creates a message with the correct side, languages and status.
  - Switching turns manually sends the current speaker's draft first.
  - An empty draft sends nothing and doesn't switch turns.
  - With fake timers: after a result, `switchAfterMs` of silence sends the draft and moves
    the turn to the other side. An interim result inside the window resets the timer.
  - With fake timers: with no speech at all, the turn never switches, however long it waits.
  - ⇄ moves a message to the other side and swaps its languages.
  - Same-language messages need no translation.
- `src/conversation/locales.test.ts`: the mapping table and the fallback to the bare code.
- `server/mt.test.ts`:
  - `translateGtx` puts `sl=es` in the URL when `source` is `es`.
  - `translateGoogleCloud` sends `source`.
  - The translator cache keeps `es→en` and `en→es` apart for the same text.
- `src/onDevice.test.ts`:
  - The translator cache keys on the language pair.
  - `availability()` receives the right `sourceLanguage`.
- `scripts/smoke.sh`: add checks that `/api/mt` returns 400 for `{"text":"hola","lang":"es","source":"xx"}`
  and for `source` equal to `lang`. Keep the existing checks. Do not call real translation
  services in the smoke test.
- Existing tests must keep passing. Existing caption behavior must be unchanged.

### 1.7 Acceptance checklist (manual, in desktop Chrome, using the published URL in its own tab)

- [ ] English ↔ Spanish: teacher speaks, and a Spanish bubble appears on the student's side
      with the English underneath. Student speaks Spanish, and an English bubble appears on
      the teacher's side.
- [ ] English ↔ English with custom names ("Bryan" / "Grandpa"): bubbles show plain captions,
      no "original" line, no translation calls (check the Network tab).
- [ ] Hands-free: press Start once, then take turns talking with about 3 s pauses. Turns
      alternate A → B → A with no button presses.
- [ ] The second person can wait 30+ seconds before answering, and their reply is still
      captioned on their side.
- [ ] The manual "{name}'s turn" buttons and Shift keys override the turn.
- [ ] ⇄ moves a misattributed bubble to the other side.
- [ ] After 50+ messages, you can scroll back to the first one, and nothing has been removed.
- [ ] The Full screen button works, and Esc exits.
- [ ] Typing a message (collapsed row) works for both sides.
- [ ] Names and languages survive a page reload.
- [ ] Arabic messages render right-to-left.
- [ ] Light mode shows the black caption highlight; dark mode doesn't.
- [ ] With "On this device" selected on the school MacBook, `en↔es` translates without
      network calls to `/api/mt`.
- [ ] Switching back to Columns or Subtitle mode works, and normal captioning starts with
      Start Listening.

</details>
