# OverHeard

Real-time classroom speech transcription, multi-language translation, neural read-aloud, two-way conferences, and shared student lecture rooms — built for teachers and schools with zero required logins or accounts.

---

## Key Features

- **Listening Mode (`Columns` & `Subtitle`)**: Live English speech-to-text captions alongside 1–3 target languages from 12 supported languages (Spanish, Portuguese, Arabic, Simplified Chinese, Vietnamese, Haitian Creole, French, Ukrainian, Russian, Somali, Dari, and Pashto), with RTL support, bookmarkable `?langs=...` URLs, `A-` / `A+` font controls, `Prev Line`, silent `Test Input` (including subject samples and 5x burst testing), and **JSON export**.
- **Always-On-Top Floating Captions (`Pop out captions`)**: Opens a Chrome Document Picture-in-Picture strip that floats over everything on your screen (Google Slides, PowerPoint, PDFs, browser tabs, and other desktop windows, aside from exclusive fullscreen apps like some games), with selectable lines and stacked or side-by-side layout.
- **Conversation & Lecture Mode**:
  - **Lecture Mode + Live Student Rooms**: Records continuous timestamped English + multi-language transcripts. Create a PIN-protected room (`4–20` characters) to share a live `?room=CODE` stream with up to 200 students on their own devices (`Create room`, `Rejoin room`, `End room`). Students customize their language, dark/light theme, voice settings, read-aloud playback, and export readable lecture JSON (`Lecture for [room] on [date].json`).
  - **Two-Way Conversation**: Side-by-side translation for 1-on-1 conferences with auto turn-taking or **Manual (`Space`)** turn switching (`Left Shift` / `Right Shift` select Speaker A or B), speaker/reader bubble placement, typed input, and JSON export/import.
- **Neural Text-to-Speech (Piper TTS + Browser Fallback)**:
  - Runs Piper ONNX voice models locally in a browser Web Worker (`@mintplex-labs/piper-tts-web`, `@diffusionstudio/piper-wasm`, `onnxruntime-web`) and caches models in OPFS so previously downloaded voices play offline, falling back cleanly to `window.speechSynthesis` when needed.
  - Persistent per-language default voices for **English**, **Spanish**, and **Portuguese** via **Voice settings** (available on the home bar, Conversation/Lecture toolbar, and Student rooms) with one-click voice previews, click-to-read from any line/bubble, and live **Read aloud**.
- **On-Device & Multi-Provider Translation**:
  - Defaults to Chrome's built-in on-device Translator when supported. `On this device` never uses the server (a failure shows a warning in the header); `Auto` falls back to `/api/mt` (`gtx` -> optional `google-cloud`) with request coalescing, a daily Cloud Translation character cap, and per-session + IP rate limits.
- **Portable JSON & Optional Google Drive Saves**:
  - Local **Export JSON** / **Import JSON** uses the portable `overheard-lecture` v1 format without teacher room credentials or PINs and works without signing in.
  - Browser-only Google Drive integration (`https://www.googleapis.com/auth/drive.file` scope only, scripts loaded lazily on click) automatically creates/reuses an **`OverHeard Saves`** folder by default, remembers per-account folder and last-save state (`Update existing file` vs `Save as new copy`), and lets teachers reopen lessons via **Open from Drive** from either the home screen or Lecture mode.
- **Built-In Guide & FAQ**: Accessible via **Guide & FAQ** on the home bar and on the far right of Conversation/Lecture mode (and click the **OverHeard** brand header from Subtitle, Conversation/Lecture, or Student views to return to Columns view).

---

## Requirements & Quick Start

OverHeard runs on **Node.js 22** (production runs TypeScript directly via Node 22 native type stripping without a separate server build step).

```bash
# Install dependencies (--legacy-peer-deps avoids peer range conflicts between vite and esbuild)
npm install --legacy-peer-deps

# Start development server (Express + Vite middleware on http://localhost:3000)
npm run dev
```

Open `http://localhost:3000` in **Google Chrome** or **Microsoft Edge** (Web Speech API speech recognition requires Chrome/Edge over `https://` or `localhost`).

### Production & Verification Commands

```bash
npm test -- --run                # Run all Vitest unit, server, and UI suites
npm run lint                      # Typecheck with tsc --noEmit
npm run build                     # Build client assets into dist/ (includes /ort/ and /piper/ WASM assets)
NODE_ENV=production node --check server.ts
npm start                         # Run production server directly on 0.0.0.0:3000
bash scripts/smoke.sh             # Start production Node server and verify API + room SSE flow
```

---

## Configuration

Copy `.env.example` to `.env` for local configuration. OverHeard starts with zero required secrets using the free `gtx` translator fallback, local JSON export/import, and browser/Piper voices.

| Variable | Purpose | Default |
| --- | --- | --- |
| `GOOGLE_TRANSLATE_API_KEY` | Optional Google Cloud Translation API key | Unset |
| `MT_PROVIDER` | Primary server translator (`gtx` or `google-cloud`) | `gtx` |
| `CLOUD_TRANSLATE_DAILY_CHARS` | Daily character cap for Cloud Translation (`0` = unlimited) | `1000000` |
| `TRUST_PROXY_HOPS` | Proxy hops trusted for client IP rate-limit checks | `1` |
| `RATE_LIMIT_MT_PER_SESSION` | Per-minute `/api/mt` requests per browser tab | `900` |
| `RATE_LIMIT_IP_MULTIPLIER` | Per-IP multiplier over per-session limits | `10` |
| `VITE_GOOGLE_CLIENT_ID` | Optional build-time override for Google OAuth Web Client ID | Shared default in `src/lib/googleConfig.ts` |
| `VITE_GOOGLE_API_KEY` | Optional build-time override for Google Picker API key | Shared default in `src/lib/googleConfig.ts` |
| `VITE_GOOGLE_APP_ID` | Optional build-time override for Google Cloud Project number | Shared default in `src/lib/googleConfig.ts` |

---

## Architecture & Key Files

```text
server.ts                     # Express server (0.0.0.0:3000), /api/config, /api/mt, /ort & /piper dev routes
server/
  rooms.ts                    # In-memory teacher/student room store, salted PIN auth, SSE streaming
  mt.ts                       # Translation provider chain + pending request coalescing
  budget.ts / rateLimit.ts    # Daily caps and sliding-window session/IP rate limiters
src/
  App.tsx                     # Listening Mode (Columns/Subtitle), header controls, Guide/Voice modals, PiP portal
  onDevice.ts                 # Chrome on-device Translator integration
  components/
    AboutModal.tsx            # How to Use OverHeard — Guide, FAQ & Privacy modal
    ConversationMode.tsx      # Lecture & Two-Way Conversation modes
    VoiceSettingsModal.tsx    # Per-language Piper & browser voice defaults with previews
    DriveSaveModal.tsx        # Save to Google Drive modal (folder picker, OverHeard Saves, update vs copy)
    DriveLectureActions.tsx   # Save to Drive / Open from Drive buttons
  rooms/
    StudentRoom.tsx           # Student view (?room=CODE), language/voice/theme controls, JSON export
    TeacherRoomControls.tsx   # Teacher Create/Rejoin/End room controls
    protocol.ts               # Validated portable overheard-lecture JSON v1 format
  tts/
    piperClient.ts            # Main-thread audio scheduler, OPFS check, and Web Speech fallback
    piperWorker.ts            # Module Web Worker running Piper ONNX inference
  lib/
    googleConfig.ts           # Public browser Google OAuth & Picker config
    googleDrive.ts            # Browser-only GIS OAuth + Picker + Drive v3 client
```

---

## Deployment Notes

- **Google Cloud Run only**: Production is the Cloud Run service `over-heard` (`us-east1`). Every push to `main` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which typechecks, tests, builds, smoke-tests, and then deploys. No AI Studio rebuild or sync is involved. API keys and the optional settings above are environment variables on the Cloud Run service and survive deploys.
- **Student short links**: `bpmdata.github.io/<room>` is a GitHub Pages redirect to the Cloud Run service (see [ROOMS.md](ROOMS.md)).
- **Single instance required for live rooms**: Live classroom rooms and translation request coalescing currently reside in server process memory — keep Cloud Run **maximum instances set to `1`** (see [ROOMS.md](ROOMS.md)).
- **Node 22 native TypeScript stripping**: Server and shared files imported by `server.ts` must stay strictly erasable TypeScript with explicit `.ts` extensions on relative server imports (see [AGENTS.md](AGENTS.md)).
- **Roadmap**: See [TODO.md](TODO.md) for planned features and future enhancements.
