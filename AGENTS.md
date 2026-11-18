# OverHeard — deployment rules

OverHeard runs entirely on **Google Cloud Run** (service `over-heard`, region `us-east1`).
Google AI Studio is no longer part of the workflow: nothing is built, synced, or deployed
from it. Every push to `main` runs `.github/workflows/deploy.yml`, which repeats the checks
below on Node 22 and then deploys with `gcloud run deploy --source .`. Merging a pull
request is the deploy; there is no manual rebuild step.

Follow these rules before making changes. Keep work in OverHeard; AllAboard may be read as
a reference but must not be edited.

## Preserve the deployment contract

- Keep these `package.json` scripts unchanged:
  - `"dev": "tsx server.ts"`
  - `"build": "vite build"`
  - `"start": "node server.ts"`
  - `"lint": "tsc --noEmit"`
- Keep the server listening on **`0.0.0.0:3000`**.
- Production runs **Node 22 with native TypeScript type stripping**, directly via
  `node server.ts`. Use strictly erasable TypeScript in `server.ts`, server modules, and
  every shared module they import: no `enum`, `namespace`, or constructor parameter properties.
- Mark type imports with `type`, and use explicit **`.ts` extensions** on all relative
  server imports. Never pull React, CSS, test modules, or devDependencies into the production
  server import graph. Tests run through Vitest; they are not production server modules.
- Do not modify `DISABLE_HMR` handling in `vite.config.ts`, and keep `metadata.json`
  capabilities and permissions intact. Both are left over from the original AI Studio
  template; they are harmless on Cloud Run, so only remove them if the owner asks.
- Preserve `Cache-Control: no-cache, no-store, must-revalidate` for `index.html`, `sw.js`,
  and the SPA fallback in `server.ts`.
- Keep all API keys server-only. Preserve graceful fallbacks when environment variables
  are missing; do not require new keys just to start the app. Production keys and settings
  are environment variables on the Cloud Run service itself (Console → Edit & deploy new
  revision → Variables & Secrets); `deploy.yml` does not set them, so deploys keep them.

## Required verification

Run these checks under **Node 22** before finishing:

```sh
npm test -- --run
npm run lint
npm run build
NODE_ENV=production node --check server.ts
```

Also verify that `node server.ts` actually starts without type-stripping/import errors.
`node --check` alone does not exercise the imported module graph. After building, run
`bash scripts/smoke.sh`; it starts the production server with Node, checks the existing
API and page, and exercises room creation, teacher authorization, and student streaming.

Do not change the owner's installed Node version to run these checks. A temporary Node 22
runtime is fine. Report any failures or checks that could not be run.

## Shared lecture rooms

Read `ROOMS.md` before changing room transport or deployment. Live rooms and translation
request coalescing currently live in one process, so keep Cloud Run's maximum instances at
**1** until shared state/pub-sub is implemented. JSON exports are the durable local copy;
server and Google Drive persistence remain future work in `TODO.md`.
