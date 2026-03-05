# OWG Share - Project Memory

## Project Overview
Private, self-hosted sharing platform on Cloudflare Workers. Shares links, markdown, code, files, and galleries with optional E2E encryption.

## Stack
- **Runtime**: Cloudflare Workers (Hono framework)
- **Frontend**: React 19 + TanStack Router + TanStack Query + Tailwind CSS 4
- **Build**: Vite + `@cloudflare/vite-plugin` (single project, not monorepo)
- **Storage**: D1 (SQLite), KV (sessions/rate-limiting), R2 (files)
- **Auth**: WebAuthn/Passkeys via `@simplewebauthn/server` + `@simplewebauthn/browser`
- **Encryption**: AES-256-GCM via Web Crypto API (client-side only)

## Key Architecture Decisions
- Single project structure (not monorepo) per cloudflare.md guide
- `run_worker_first = ["/api/*", "/s/*"]` routes API and public share URLs to Worker
- `not_found_handling = "single-page-application"` for client-side routing
- Hono for API routing on worker side
- Public /s/:slug endpoint: links get 302 redirect at Worker level, everything else served by SPA
- Cron trigger (`0 3 * * *`) cleans up expired shares
- Tests: Vitest, 69 tests all passing (slug, response, crypto, session, rate-limiting)
- DB: `owg-share-db`, R2 bucket: `owg-share-storage`
