# OWG Share

Private file/link/content sharing platform on Cloudflare Workers.

## Architecture

**Single deployment** — one Cloudflare Worker serves both the Hono REST API and the React SPA static assets. The `run_worker_first` config in `wrangler.toml` routes `/api/*` and `/s/*` to the worker; everything else serves the SPA from `dist/client/`.

**Data flow**: Browser (React SPA) -> Cloudflare Worker (Hono) -> D1 (metadata), KV (sessions/rate-limits), R2 (files).

**Auth**: WebAuthn passkeys only. No passwords. Sessions stored in KV with 7-day TTL. API keys use SHA-256 hashed Bearer tokens.

**Encryption**: Client-side AES-256-GCM via Web Crypto API. Keys live in URL hash fragments (`#key=...`) and never reach the server.

## Key Files

- `worker/index.ts` — Worker entry point, route mounting, cron cleanup job
- `worker/routes/` — All API route handlers (auth, shares, public, upload, passkeys, apikeys)
- `worker/middleware/auth.ts` — Session cookie + API key Bearer token authentication
- `worker/lib/slug.ts` — Base62 slug generation (short=8, long=24, encrypted=32 chars)
- `src/lib/crypto.ts` — Client-side AES-256-GCM encrypt/decrypt
- `src/api/hooks.ts` — All React Query hooks for API calls
- `src/components/NewShareWizard.tsx` — Multi-step share creation modal (largest component)
- `migrations/0001_initial.sql` — D1 database schema (11 tables)

## Commands

```bash
npm run dev          # Vite dev server with workerd runtime
npm run build        # Production build
npm run test         # Vitest unit tests
npm run test:watch   # Tests in watch mode
npm run test:e2e     # Playwright E2E tests
npm run typecheck    # TypeScript check
npm run lint         # ESLint
```

Database migrations:
```bash
wrangler d1 migrations apply owg-share-db --local   # Local dev
wrangler d1 migrations apply owg-share-db --remote  # Production
```

## Code Patterns

- **Route handlers** use Hono's router pattern. Each route file exports a `Hono` sub-app mounted in `worker/index.ts`.
- **Auth middleware** (`requireAuth`) sets `c.get("userId")` for downstream handlers.
- **API responses** always use `json()` and `error()` helpers from `worker/lib/response.ts`. Format: `{ success: true, data: T }` or `{ success: false, error: { code, message } }`.
- **Tests** are co-located (e.g., `slug.ts` / `slug.test.ts`). Worker tests mock D1/KV/R2 with `vi.fn()`.
- **Frontend state** uses TanStack React Query. All API hooks are in `src/api/hooks.ts`. Mutations invalidate queries via query keys.
- **File uploads** go through presigned URLs for single files or multipart upload for files >90MB.

## TypeScript

Two tsconfig files: `tsconfig.json` (frontend, DOM types) and `tsconfig.worker.json` (worker, Cloudflare types). Path aliases: `@/*` -> `src/*`, `@worker/*` -> `worker/*`.

## Environment

The `Env` type in `worker/types.ts` defines all Cloudflare bindings and vars. Key `[vars]` in `wrangler.toml`:
- `APP_NAME` — Site name displayed in the UI header, login/setup pages, and generated CLI scripts. Returned by `/api/auth/status` as `appName`.
- `RP_ID` / `RP_ORIGIN` — WebAuthn relying party config (domain and origin).

For local dev, create `.dev.vars` from `.dev.vars.sample` with `RP_ID=localhost` and `RP_ORIGIN=http://localhost:5173`.

## Testing

Unit tests mock Cloudflare bindings with `vi.fn()`. Auth middleware is mocked in route tests to bypass authentication. The `@simplewebauthn/server` library is mocked in auth/passkey tests since WebAuthn requires browser APIs.

Run `npm run test` before committing. All tests should pass.

## Deploy

```bash
npm run build && wrangler deploy
```

Or with mise + fnox (for 1Password secret injection):
```bash
mise run deploy
```
