# TODO

## How OverHeard is used (context for every item below)

1. **Projector / smartboard:** the teacher presents, and captions float over the slides in the
   pop-out (Document Picture-in-Picture) window.
2. **Laptop on the desk:** the teacher carries the laptop to a student or small group, sets it
   down in front of everyone, and shows live captions in the column view.

The planned **Conversation mode** adds a third use: a one-on-one, two-way conversation,
including English ↔ English for a deaf or hard-of-hearing person.

---

## 1. Conversation mode: turn-based, text-message-style live translation

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
speaking or typing.

### 1.2 Requirements

**Sides and names**
- There are exactly two sides, **A** (left, normally the teacher) and **B** (right).
- Each side has an editable **display name**. Defaults: `"Me"` and `"Student"`.
- Each side has a **language**: English (`en`) plus every language in `SUPPORTED_LANGUAGES`
  (`src/constants.ts`). Defaults: A = `en`, B = the first language in the current `?langs=`
  selection, or `es` if there is none.
- Both sides may use the same language. When they do, no translation happens: bubbles show
  the text only, with no "original" line.
- Names and languages must persist across reloads in `localStorage` under the key
  `overheard.conversation`. Store
  `{ a: { name, lang }, b: { name, lang }, autoSendMs, readAloud }`. Wrap every read and
  write in try/catch; the app must work if storage is blocked.

**Taking turns (speech)**
- The Web Speech API can't detect which language is being spoken, and one recognizer
  listens for one language at a time. So turns are explicit.
- Each side has a large **talk button** labeled with the side's name, for example
  "🎙 Maria — tap to talk". Keyboard: **Left Shift** toggles side A and **Right Shift**
  toggles side B. Ignore shortcuts while focus is in an `<input>`, `<textarea>` or `<select>`.
- Pressing a side's button:
  1. Stops any active turn. Call `abort()` on the recognizer; the other side's draft is
     sent as-is if it has text.
  2. Sets `recognition.lang` to that side's speech locale (see 1.4).
  3. Calls `recognition.start()` with `continuous = true` and `interimResults = true`.
  4. Marks that side as **speaking**: pulsing border on its button, plus a "typing" bubble
     on the *listener's* side that shows the interim text live.
- Final results are appended, space-separated, to the speaker's **draft**.
- The draft is **sent** when any of these happens:
  - The speaker taps their button again ("Done").
  - The other side taps theirs.
  - `autoSendMs` passes with no new results. Default 1500 ms; a setting offers Off,
    1 s, 1.5 s, 2.5 s and 4 s. Off means manual send only.
- After sending, the recognizer **stops**. Unlike the caption modes, conversation mode must
  **not** keep restarting the recognizer when a turn isn't active. It listens only during a
  turn.
- While a turn is active, keep the existing restart behavior if Chrome ends recognition
  mid-turn: restart, using the backoff in `src/speechRestart.ts`.
- Errors:
  - `not-allowed`: show the existing microphone-permission banner.
  - `language-not-supported`: end the turn and show "Speech recognition doesn't support
    {language} in this browser — type instead". Focus that side's text box.
  - `no-speech`: end the turn quietly and send nothing.

**Typing (needed for the deaf / hard-of-hearing use case)**
- Each side has a single-line text box with a **Send** button. Enter sends; Shift+Enter
  inserts a newline. A typed message is translated and shown exactly like a spoken one.

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
- The thread auto-scrolls to the newest message unless the user has scrolled up. In that
  case show a "↓ New message" pill that scrolls down when clicked.
- A **Clear conversation** button asks for confirmation, then empties the thread.
- **Export:** a download button saves the conversation as CSV (UTF-8 with BOM, same as the
  existing transcript export). Columns: timestamp, sender name, original language, original
  text, translated language, translated text.

**Optional, only once everything above works**
- **Read aloud:** a toggle that speaks each received message in the listener's language with
  `speechSynthesis`, picking a voice whose `lang` starts with the target language code.
  Mute the speaker's own recognizer while it talks, so it doesn't caption itself.
- **Face-to-face layout:** a toggle that splits the screen top and bottom, with the top half
  rotated 180°. Two people facing each other across a desk can then each read their own
  side of a laptop or tablet lying flat between them.

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
    `SpeechRecognition` instance, the turn state, drafts, the auto-send timer and error
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
    (A→B and B→A) when the user taps a talk button, since downloads need a user gesture.
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
  - Switching sides sends the other side's draft.
  - An empty draft sends nothing.
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
- [ ] Typing a message works for both sides.
- [ ] Auto-send after a pause works, and so does tapping the button again.
- [ ] Names and languages survive a page reload.
- [ ] Arabic messages render right-to-left.
- [ ] Light mode shows the black caption highlight; dark mode doesn't.
- [ ] With "On this device" selected on the school MacBook, `en↔es` translates without
      network calls to `/api/mt`.
- [ ] Switching back to Columns or Subtitle mode works, and normal captioning starts with
      Start Listening.

---

## 2. Rework the column view for the "laptop on the desk" use case

Not specified yet. Starting points: readable from across a desk at a slight angle, less
chrome around the captions, and possibly a one-language-at-a-time layout for a single
student. Decide after using it with a small group.
