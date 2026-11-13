# OverHeard — Classroom Live-Caption Translator

**OverHeard** is a projector-first, real-time classroom captioning and translation tool for teachers supporting multilingual learners. As the teacher speaks English, the browser's Web Speech API shows live captions immediately, while a server-side Gemini Flash endpoint translates each finalized phrase into up to three target languages at once, using the previous sentences as context. It includes a floating always-on-top caption window for use over slides, and one-click CSV transcript export.

Part of the family: **OverBoard · AllAboard · OverHeard**

## Confirmed Decisions

> [!IMPORTANT]
> - **Default posture:** Opens in **Dark Mode** (projector legibility) with **Spanish (`es`) and Portuguese (`pt`)** pre-selected when `?langs=` is absent.
> - **Silent testing:** A collapsible **Quick Text Input Bar** plus one-click sample sentences (Science, Math, History) lets teachers test layouts and translations without speaking.
> - **Version 1 scope:** Speech → translation → display → pop-out → export. **Cognate highlighting is deferred to v2** (see Section 6).

---

## 1. Overview & Core Concept

- **What it does:** Captures the teacher's spoken English continuously with the Web Speech API (`en-US`, `continuous = true`, `interimResults = true`). It shows interim words immediately in a dimmed style and sends each **finalized** phrase to `/api/translate`. Results appear in high-contrast projector columns, a bottom subtitle bar, or a floating Picture-in-Picture caption window.
- **Audience:** K–12 teachers projecting slides or leading instruction with multilingual learners speaking Spanish, Portuguese, Arabic, Simplified Chinese, Vietnamese, Haitian Creole, French, Ukrainian, Russian, Somali, Dari, or Pashto.
- **Key value:** Zero setup and no student accounts. Microphone capture restarts itself automatically, setups can be bookmarked with `?langs=` URLs, and captions can float over a fullscreen slideshow.

### Privacy statement (show this text in the app's About/Help panel)

> OverHeard has no logins, collects no student data, and stores nothing. Your speech is converted to text by Google's speech service built into Chrome, and the text is translated by Google Gemini. Avoid saying student names or other sensitive information while it is running.

*Do not describe the app as "privacy-first" or claim that audio stays on the device. By default, Chrome sends speech audio to Google's servers.*

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Arrival & bookmark hydration**
   - On load, check for `SpeechRecognition` / `webkitSpeechRecognition`. If it is missing, or the browser is not Chrome or Edge, show a clear warning banner.
   - Read `?langs=` from the URL (validate it; at most 3 supported codes). If it is absent, default to `es,pt`. Every selection change syncs back to the URL with `history.replaceState`.

2. **Live microphone & keep-alive loop**
   - The large **Start Listening** button (or the `Spacebar` when focus is not in a text field) starts recognition. A pulsing mic indicator confirms that it is listening.
   - On `onend`, or on `'no-speech'` / `'network'` / `'aborted'` errors, if the user has **not** pressed Stop, call `start()` again inside `try/catch` and ignore `InvalidStateError`.
   - On `'not-allowed'` / `'service-not-allowed'`, stop the loop and show a Microphone Permission banner with steps for allowing access.
   - The app requests microphone permission through `requestFramePermissions` in `metadata.json`.

3. **Display modes**
   - **Projector columns (default):** `1 + N` equal-width columns (English plus up to 3 languages). Each column shows the **current phrase** large (default `32px`, adjustable `20–56px` via `A-` / `A+`). When **Show Previous Line** is on, the preceding phrase appears above it at `0.68×` size, muted, above a hairline divider. Arabic, Dari, and Pashto render with `dir="rtl"` and extra line-height.
   - **Subtitle bar:** A fixed bar at the bottom of the window. English is on the top line and one chosen target language is below, with a switcher pill if more than one language is active.
   - **Pop-out captions (floating):** A **"Pop out captions"** button opens the subtitle bar in an always-on-top window using the **Document Picture-in-Picture API** (`documentPictureInPicture.requestWindow()`). The window floats over a fullscreen Google Slides presentation and stays in sync with the main tab. If the API is unsupported, hide the button and point users to normal subtitle mode or window tiling.

4. **Transcript export & reset**
   - **Download Transcript** exports a UTF-8 BOM CSV (`overheard-transcript-YYYY-MM-DD.csv`) with columns for timestamp, English, and each selected language.
   - **Clear** resets the live display and transcript history after a confirmation prompt.

### Visual Identity & Theme

- **Aesthetic:** A classroom projector studio. The goal is legibility at 25+ feet with minimal clutter and large, easy-to-hit teacher controls.
- **Dark mode (default):**
  - Canvas: `#090D16` · Column panels: `#111827` · Borders: `#1E293B`
  - Caption text: `#F8FAFC` · Previous/interim text: `#94A3B8`
  - Accents: Listening `#10B981` · Primary controls `#38BDF8`
- **Light mode:**
  - Canvas: `#F8FAFC` · Panels: `#FFFFFF` · Borders: `#E2E8F0`
  - Text: `#0F172A` · Secondary: `#64748B`
  - Accents: `#0284C7` · Listening `#059669`
- **Typography:**
  - UI and captions: `Plus Jakarta Sans` (600/700), `leading-snug`, balanced wrapping.
  - Script fallbacks: `Noto Sans Arabic` / `Tahoma` (Arabic, Dari, Pashto), `Noto Sans SC` (Chinese).
  - Timestamps and counters: `JetBrains Mono`, `tabular-nums`.

---

## 3. Key Product Decisions & Trade-Offs

### Decision 1: Concurrent translation with in-order rendering

- **Approach:** Each finalized phrase (from speech or the test bar) immediately receives a sequential `id`. It is added to the transcript with status `translating`, and its English caption renders at once. Its translation request is sent **immediately and concurrently**; it does not wait for earlier requests to finish. When a response arrives, it fills that phrase's slot by `id`, so the display stays in spoken order no matter which response returns first.
- **Context:** Each request includes the **previous 2 finalized English sentences**, marked do-not-translate. These are known the moment they are spoken, so concurrency does not reduce context quality.
- **Why not a one-at-a-time queue:** At about 1 second per call, a fast speaker would build up a backlog and translations would fall further and further behind the English.
- **Backlog guard:** If more than 4 requests are in flight, merge newly finalized phrases into one request instead of adding more.
- **Error handling:** On any network or Gemini error, that phrase's language cells show `translation unavailable`. Recognition continues and other phrases are not affected. Retry once after 1 second before giving up.

### Decision 2: One structured-JSON Gemini call per phrase

- **Approach:** An Express server uses `@google/genai` with the **current Gemini Flash model listed in AI Studio**. Verify the exact model ID in the model picker; do not invent one. Use the lowest available thinking level for minimum latency, `responseMimeType: "application/json"`, and a dynamic `responseSchema` keyed by the selected language codes, for example `{ "es": string, "pt": string }`.
- **System instruction:**
  > You are a classroom interpreter. Translate the teacher's English into each target language. Natural, student-friendly, keep subject vocabulary accurate. The context sentences are for reference only — do not translate them. Output only JSON.
- **Why server-side:** The API key never reaches the browser.

### Decision 3: Protect the endpoint

`/api/translate` will be on a public URL and uses the owner's Gemini quota and billing. Protect it as follows:

- Rate limit to **60 requests/minute per IP**.
- Reject any phrase over **500 characters** and any request with more than 3 target languages.
- Accept only language codes from the supported catalog.

---

## 4. Technical Architecture & Data Strategy

### Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         OVERHEARD (Browser Client)                       │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ Banners (browser / mic permission) + Top Control Bar               │  │
│  │ [Start/Stop (Space)] [Mic Pulse] [A-/A+] [Prev Line] [Subtitle]    │  │
│  │ [Pop Out] [Theme] [Languages] [Download] [Clear]                   │  │
│  └──────────────┬─────────────────────────────────────┬───────────────┘  │
│                 ▼                                     ▼                  │
│  ┌──────────────────────────────┐     ┌──────────────────────────────┐   │
│  │ Web Speech Engine            │     │ URL & Settings Manager       │   │
│  │ - en-US, continuous, interim │     │ - ?langs=es,pt (max 3 of 12) │   │
│  │ - Auto-restart keep-alive    │     │ - Font size, theme, mode     │   │
│  │ - Interim → live English     │     └──────────────┬───────────────┘   │
│  └──────────────┬───────────────┘                    │                   │
│                 │ Final phrase (+ id)                │                   │
│                 ▼                                    ▼                   │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ Transcript Store — slots keyed by phrase id                        │  │
│  │ - Concurrent dispatch, in-order render                             │  │
│  │ - Context = previous 2 English sentences                           │  │
│  │ - Backlog guard (>4 in flight → merge)                             │  │
│  └──────────────┬─────────────────────────────────────┬───────────────┘  │
│                 │ POST /api/translate                 │ State updates    │
└─────────────────┼─────────────────────────────────────┼──────────────────┘
                  ▼                                     ▼
┌───────────────────────────────────┐  ┌──────────────────────────────────┐
│ Express Server (/api/translate)   │  │ Display Layer                    │
│ - @google/genai, current Flash    │  │ - Projector columns (RTL aware)  │
│ - Classroom-interpreter prompt    │  │ - Subtitle bar                   │
│ - Dynamic responseSchema          │  │ - Document PiP floating window   │
│ - Rate limit + input validation   │  │ - CSV exporter, test input bar   │
└───────────────────────────────────┘  └──────────────────────────────────┘
```

### Data Model

**Supported languages (12):**
`es` Spanish · `pt` Portuguese · `ar` Arabic (RTL) · `zh` Simplified Chinese · `vi` Vietnamese · `ht` Haitian Creole · `fr` French · `uk` Ukrainian · `ru` Russian · `so` Somali · `prs` Dari (RTL) · `ps` Pashto (RTL)

**`CaptionSegment`:**

| Field | Type | Notes |
|---|---|---|
| `id` | number | Sequential; defines spoken order |
| `timestamp` | string | Local `HH:MM:SS` |
| `english` | string | Finalized phrase |
| `translations` | `Record<string, string>` | Per language code; `translation unavailable` on error |
| `status` | `'translating' \| 'done' \| 'error'` | |

### Interaction Details

- **Keyboard:** A global `keydown` handler toggles Start/Stop on `Spacebar` unless focus is in `<input>`, `<textarea>`, or `<select>`. A `userStoppedRef` tells `onend` whether to restart.
- **Language selector:** Checkboxes for all 12 languages. Once 3 are checked, the rest are disabled with a "Max 3 languages" note. Every change updates `?langs=`.
- **Pop-out sync:** The PiP window renders from the same state store as the main tab and is not a separate app. Closing it returns to the previous mode.

---

## 5. Testing Checklist

- [ ] Test in a **full Chrome tab**, not the AI Studio preview pane. The mic is often blocked in embedded previews.
- [ ] Speak continuously for 10+ minutes and confirm recognition restarts on its own after pauses.
- [ ] Talk quickly for 60 seconds and confirm translations keep pace and stay in order.
- [ ] Turn off Wi-Fi for a moment and confirm cells show `translation unavailable` and listening continues.
- [ ] Open a Google Slides presentation fullscreen and confirm the pop-out caption window stays on top.
- [ ] Load `?langs=ar,zh,vi` and confirm Arabic is right-to-left and Chinese characters render correctly.
- [ ] Check the CSV in Excel and Google Sheets with non-Latin scripts (requires the BOM).
- [ ] Read the projector view from the back of the room at default font size.

---

## 6. Version 2 Backlog (not in v1)

- **Cognate highlighting:** In the same Gemini call, return English–Spanish/Portuguese cognate pairs, underline them in color-matched pairs, and collect them in a Cognate Drawer. Flag false friends (e.g., *embarrassed* ≠ *embarazada*) separately. Deferred because it is the feature most likely to be wrong and v1 should prove the core loop first.
- **Student view:** A second URL that shows only one language, large, for a student's own device (requested by ESL staff).
- **Session glossary:** The teacher pre-loads unit vocabulary so key terms translate consistently.
