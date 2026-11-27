# Plan: Typed Translation & Config HTTP Contract

> **For Code 6.1 Terra:** Read `AGENTS.md` and `ARCHITECTURE.md` first.
> Keep shared server-imported files strictly erasable TypeScript (no `enum`, `namespace`, or parameter properties), use `import type`, and use explicit `.ts` extensions on relative server imports. Never import React, CSS, or DOM code into `server/`.

## Goal

Share one TypeScript contract (`src/translation/protocol.ts`) for `/api/config` and `/api/mt` between `server/routes/mt.ts` and browser translation clients (`src/translation/useServerConfig.ts`, `src/translation/useTranslator.ts`, and any student translation caller), so request/response changes fail `tsc --noEmit` immediately instead of silently drifting.

**Do not change API routes, JSON field names, HTTP status codes, rate limits, or `scripts/smoke.sh` behavior.**

---

## Phase 1 — Define `src/translation/protocol.ts`

1. Inspect all callers of `/api/config` and `/api/mt`:
   - `server/routes/mt.ts`
   - `src/translation/useServerConfig.ts`
   - `src/translation/useTranslator.ts`
   - `src/rooms/translateStudent.ts` (check if it posts to `/api/mt`)
   - `src/app/settings.ts` (`MtProviderId`)
2. Create `src/translation/protocol.ts` containing strictly erasable types:
   - `export type ServerMtProvider = 'google-cloud' | 'gtx';` (or re-export from a server-safe types location without pulling client React/storage code into `server/`!)
   - **Important:** Do NOT import `src/app/settings.ts` from `server/` if `settings.ts` pulls in `constants.ts` or browser assumptions unless verified server-safe. Prefer defining `MtProviderId` / `ServerMtProvider` in `src/translation/protocol.ts` (or `server/mt.ts`) and re-exporting cleanly.
   - `export interface ServerConfigResponse { mtProvider: ServerMtProvider; providers: ServerMtProvider[]; shortLinkBase: string | null }`
   - `export interface MtRequestBody { text: string; lang: string; source?: string; provider?: ServerMtProvider; freeOnly?: boolean }`
   - `export interface MtSuccessResponse { translation: string; provider: ServerMtProvider | 'cache'; ms: number }`
   - `export interface MtErrorResponse { error: string; details?: string }`

### Phase 1 Checkpoint
- `npm run lint`
- `npm test -- --run`

---

## Phase 2 — Wire contract into `server/routes/mt.ts` and browser clients

1. In `server/routes/mt.ts`:
   - `import type { MtErrorResponse, MtRequestBody, MtSuccessResponse, ServerConfigResponse } from '../../src/translation/protocol.ts';`
   - Type `res.json(...)` responses on `/api/config` (`ServerConfigResponse`) and `/api/mt` (`MtSuccessResponse` / `MtErrorResponse`).
   - **Keep all runtime body validation (`typeof text !== 'string'`, etc.) intact!** Type `req.body` as `Partial<Record<keyof MtRequestBody, unknown>>` (or `unknown`) before runtime narrowing.
2. In `src/translation/useServerConfig.ts`:
   - Type parsed JSON as `ServerConfigResponse` (keeping the defensive `Array.isArray(cfg.providers)` guard).
3. In `src/translation/useTranslator.ts` (and `src/rooms/translateStudent.ts` if it calls `/api/mt`):
   - Type request body construction with `MtRequestBody` and JSON response parsing with `MtSuccessResponse` (or `Partial<MtSuccessResponse>`).
4. Update `ARCHITECTURE.md` §4 (`src/translation/protocol.ts`).

### Final Verification
```sh
npm test -- --run
npm run lint
npm run build
NODE_ENV=production node --check server.ts
bash scripts/smoke.sh
```
