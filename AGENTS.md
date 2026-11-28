# OverHeard — deployment rules

OverHeard runs entirely on **Google Cloud Run** (service `overheard`, region `us-east1`; it was
`over-heard` until 2026-11-28, see README's Deployment Notes).
Google AI Studio is no longer part of the workflow: nothing is built, synced, or deployed
from it. Pushes to `main` with changes outside Markdown run `.github/workflows/deploy.yml`, which repeats the checks
below on Node 22 and then deploys with `gcloud run deploy --source .`. Merging a pull
request is the deploy; there is no manual rebuild step.

Follow these rules before making changes. Keep work in OverHeard; AllAboard may be read as
a reference but must not be edited.

## Preserve the deployment contract

- Keep these `package.json` scripts unchanged:
  - `"dev": "tsx server.ts"`
  - `"build": "vite build"`
  - `"start": "node server.ts"`
  - `"lint": "tsc --noEmit && oxlint --react-plugin -A all -D react/rules-of-hooks -W react/exhaustive-deps src"`
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
  are missing; do not require new keys just to start the app. Production settings are all set
  by `deploy.yml`, so a deploy can create the service from scratch and nothing is hand-set in
  the console: secrets (`GOOGLE_TRANSLATE_API_KEY`, `REPORT_RELAY_URL`, `REPORT_RELAY_SECRET`)
  are attached from Secret Manager with `--set-secrets`; plain settings
  (`CLOUD_TRANSLATE_DAILY_CHARS`, `SHORT_LINK_BASE`) with `--update-env-vars`; the service runs
  as `overheard-run`, which can read only OverHeard's own secrets (docs/REPORTS.md). Add any new
  production setting there too.

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
**1** until shared state/pub-sub is implemented. JSON exports are the durable local copy. Browser-initiated Google Drive file saves are implemented.
Real-account Drive verification and durable server storage are tracked in `TODO.md`.

## Formatting

Run `npx prettier --write` on changed files before committing. CI runs
`npx prettier --check .`; markdown and `docs/` are excluded (see `.prettierignore`).
