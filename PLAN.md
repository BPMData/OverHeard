# OverHeard overhaul plan

Deliver the hands-free Conversation mode first. Use the English ↔ English conversation with Grandpa to prove turn-taking, then use English ↔ Spanish with a student to prove translation in both directions. Keep the projector and laptop caption workflows working throughout. [Full requirements](./TODO.md)

## How a conversation is configured

Side A starts and defaults to “Me” in English. Side B defaults to “Student” and the first language in `?langs=`, falling back to Spanish. For Grandpa, set B to “Grandpa” and English. Both participants take turns as sender and reader.

Let the operator choose whether sent bubbles appear on the speaker’s side or the reader’s side. Use the speaker’s side by default. In either layout, the name identifies who spoke and the large text uses the other person’s language. The live draft and listening indicator identify the current speaker. The ⇄ button corrects who spoke and triggers retranslation when needed. Changing the layout alone should never trigger translation. Save the layout preference alongside the settings in `overheard.conversation`.

## Implementation order

### 1. Make translation work in both directions

- Define a language type that includes English for conversation and translation. Today `LanguageCode` and the server’s target allowlist both exclude English. Allow English as a target on `/api/mt` so a student can reply in Spanish. Keep the existing classroom language picker and multi-language refinement route scoped to their current languages.
- Carry source and target through `fetchMT` in `src/App.tsx`, the route and Gemini single-translation prompt in `server.ts`, the provider chain in `server/mt.ts`, and Chrome’s translator in `src/onDevice.ts`. Default the source to English for existing callers. Include both languages in every translation cache key and retain provider preference where it is already part of the key.
- Short-circuit equal languages on the client before any translation work. Have the route reject invalid codes and identical pairs. Keep the existing provider picker, retry and fallback behavior. Conversation uses the single-translation path and skips the caption refinement pass.
- **Verify** with mocked GTX, Google Cloud, Gemini and on-device calls in both directions, including cache isolation. Add the two invalid-source smoke cases from the TODO. Keep smoke tests independent of live providers.

### 2. Build the message model and prove it with typed turns

- Put the reducer in `src/conversation/state.ts` and the speech locale table in `src/conversation/locales.ts`. Keep participant settings, current turn, draft and session history distinct. Snapshot sender, language pair, original and timestamp at send time so later settings edits cannot relabel history.
- Give typed and spoken messages the same send, translate and correct operations. Append immediately, then update that message when translation finishes. Guard against a late response overwriting a corrected message or restoring a cleared one. A translation failure leaves the original readable.
- Add the initial `ConversationMode.tsx` thread with participant settings and the collapsed typing row. Wire the third display mode in `App.tsx`. Stop main captioning on entry, disable the global Space shortcut there, and restore the prior display mode with the mic stopped on exit. Keep the thread in memory across mode switches for the page session. Persist settings with guarded storage reads and writes.
- **Verify** by typing as both people in both layouts. English ↔ English shows one line and makes zero translation calls. English ↔ Spanish shows the reader’s language first and the original below. Typing leaves the active speech turn alone. Test correction while a translation is pending.

### 3. Prove hands-free turns before polishing the screen

- Build `src/conversation/useConversationSpeech.ts` around a dedicated recognizer. Start on A with continuous and interim results. Show interim speech live, append final fragments once, and reset the silence timer on every result. After a nonempty draft and the selected pause (default 2.5 seconds), send once and listen to the other participant immediately while translation proceeds.
- With no speech, keep the same turn indefinitely. Reuse `src/speechRestart.ts` for unexpected ends and no-speech restarts. Distinguish deliberate handoffs from unexpected ends. Cancel pending timers and ignore stale callbacks after a switch, Stop or Exit.
- Implement named turn buttons and left/right Shift, respecting input focus. An explicit override can select a quiet participant’s side without creating a message. Stop on permission denial or unsupported recognition language, show the specified feedback, and keep typing available.
- For “On this device,” prepare both translation directions from the Start gesture. Prepare speech for the active locale at each turn, with the existing local/cloud indicator and fallback. Keep all specified languages selectable, including those requiring device verification.
- **Verify** with fake timers and a fake recognizer. Cover interim timer resets, multiple finals, a 30+ second silent wait through recognizer restarts, manual overrides, and stopping during a restart or language-pack download. Then try the Grandpa scenario with a real mic. One Start press must carry the conversation through A → B → A, even when B takes time to reply.

### 4. Finish the reading and operator controls

- Use the full window for the thread. Keep the settings bar compact and the active speaker’s name prominent. Apply global font size, caption colors, light-mode highlighting and per-text direction to originals and translations. Show translating and failure states. Explain turn-based speaker attribution beside the correction control.
- Keep all messages scrollable. Follow incoming messages only while the reader is at the bottom. When someone scrolls up, preserve their place and offer “↓ New message.”
- Add Full screen and Esc handling, confirmed Clear, and UTF-8 CSV export with BOM and the six specified columns. Hide classroom-only controls in Conversation and keep the translator preference accessible.
- **Verify** both layouts, Arabic text in both translation directions, light and dark themes, settings reload and blocked storage, 50+ messages, CSV escaping, and return to both Columns and Subtitle. Check that ordinary captioning and the projector pop-out still work.

### 5. Run release acceptance on the intended devices

- Run the existing CI sequence: `npm run lint`, `npm test`, `npm run build`, and `bash scripts/smoke.sh`.
- Submit a pull request for the maintainer to test. After merging, the maintainer rebuilds the app in AI Studio and checks the published URL in its own desktop Chrome tab using the manual checklist in the TODO. Run the Grandpa scenario with custom names and a long pause, then the student scenario with speech in both directions. On the school MacBook, use the Network panel to verify that prepared English ↔ Spanish on-device translation sends no requests to `/api/mt`.

## Follow-on work

- **Read aloud** comes after core acceptance. Pause recognition during synthesis and resume the intended turn afterward. Verify that playback cannot create a bubble or advance the turn.
- **Tablet face-to-face layout** stays deferred until there is a tablet trial. Use the trial to evaluate the rotated half-screen layout.
- **Laptop column redesign** starts with a small-group desk session. Observe reading distance, angle, and whether students need one or several languages visible before choosing a layout.
