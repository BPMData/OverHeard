# Shared lecture rooms

## Teacher and student flow

1. Open **Conversation mode → Lecture** and choose the teacher's translation languages.
2. Enter a **Room PIN** (4–20 characters) and click **Create room** for an automatic code, or enter a custom code first. Copy the student link into Schoology. Students can also enter the code beside **Join room** on the home screen. If the teacher closes the tab or disconnects, enter the same room code and PIN and click **Rejoin room** to reclaim teacher control (restoring the live room transcript if the new tab starts empty).
3. Start the lecture, or use **Type a line** to test silently. Students receive English and existing teacher translations as they arrive.
4. Students choose **My language** and theme (defaulting to dark mode with a Sun/Moon toggle). Student room preferences and pop-out selections (lines shown and stacked vs. side-by-side layout) are saved locally on the device. Additional languages translate from English on their device when available, then use GTX → Cloud Translation → Gemini. Paid fallbacks require the same server keys as ordinary captions. Pending identical server requests share one provider chain, and completed results use the existing cache.
5. **Pop out lecture** displays a compact floating caption window on browsers supporting Document Picture-in-Picture, with hover controls to toggle visible lines and arrange multiple lines stacked or side-by-side. Students have no microphone, transcript editing, or teacher session controls. The main lecture tab must remain open.
6. **Export JSON** saves the full finalized transcript, translations, timestamps, and selected languages to a device file. **Import JSON** validates and replaces the teacher's transcript (with confirmation if it already contains entries); a connected room receives the replacement. Imported lectures start paused.

Room creation shares the teacher's current lecture history, including an imported lecture. Clear the lecture first to start with an empty transcript. Any student with the room code/link can read the shared transcript; there are no student accounts or names.

## Lifetime and deployment

- This first version has **temporary live rooms**, not durable server or Drive saves. Rooms are held in server memory and disappear on restart/redeployment. Export JSON before closing a lesson to keep a portable copy.
- **Run a single application instance.** Room state and translation request coalescing are process-local. Before deploying to Cloud Run or another autoscaling host, set the maximum instance count to one. Multiple instances require shared room state and pub/sub; session affinity alone is insufficient. No production deployment settings are changed by this implementation.
- The teacher sends incremental updates at most every 300 ms plus a heartbeat every 10 seconds. A teacher is marked offline after 35 seconds without an update; students keep the finalized history. Browsers reconnect automatically and receive a fresh snapshot.
- The HTTP proxy must allow Server-Sent Events at `/api/rooms/:code/events`, flush rather than buffer responses, and support long-lived connections. The server sends `X-Accel-Buffering: no` and 10-second keepalives. Host request timeouts are handled through reconnection.
- Teacher access uses a server-generated random credential kept in that tab's session storage, plus a salted PIN hash verified on **Rejoin room**. Credentials and PIN hashes are never placed in student URLs, stream payloads, or JSON exports. Rejoining with the PIN rotates the teacher bearer token (invalidating stale tabs) while keeping connected student streams uninterrupted.
- **End room** stops publishing and leaves the final transcript readable for one hour (teachers can restart it anytime during that hour by entering the room code and PIN and clicking **Rejoin room**). Other rooms expire after eight hours without a teacher update. Limits: 100 rooms per process, 200 simultaneous readers per room, 2,000 finalized entries and 8 MB per room/file. Existing translation budgets and rate limits still apply.

## Implementation and checks

- `server/rooms.ts`: room lifecycle, teacher authorization, validation, incremental updates, event streams, expiration.
- `src/rooms/protocol.ts`: validated portable format and patch application, shared between server and browser.
- `src/rooms/`: teacher publishing, read-only student view, bounded student translation queue, JSON controls, and lecture PiP adapter.
- `server/mt.ts`: pending-request coalescing keyed by provider preference, source language, target language, and text.
- Run `npm run lint`, `npm test`, `npm run build`, and `bash scripts/smoke.sh`. Room integration tests open ephemeral loopback ports. Tests use fake translation providers; the browser check exercised real GTX translations and native Chrome PiP with a typed sample sentence.

Future work: server/Drive persistence and multi-instance distribution. Neither is required for local JSON backup and restore.
