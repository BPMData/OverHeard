# OverHeard — notes for Claude

**Read `AGENTS.md` first.** It holds the deployment contract and the required checks, and it
overrides anything else here.

- **Hosting:** the app runs entirely on Google Cloud Run (service `over-heard`, region
  `us-east1`, max instances 1). No AI Studio deploys or rebuilds are needed: merging to
  `main` triggers `.github/workflows/deploy.yml`, which tests, builds, and deploys.
- **Student short links:** `bpmdata.github.io/<room>` is a GitHub Pages redirect to the Cloud
  Run service (see `ROOMS.md` and `deploy/github-pages-404.html`).
- **Background reading:** `ARCHITECTURE.md` (how the code fits together), `ROOMS.md` (live
  lecture rooms), `TODO.md` (open work).

- **Formatting:** run `npx prettier --write` on changed files before committing; CI runs
  `npx prettier --check .`. Markdown and `docs/` are excluded (see `.prettierignore`).
