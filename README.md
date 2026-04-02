# OWG Share

A private, self-hosted sharing platform built on Cloudflare Workers. Share links, markdown documents, code snippets, files, and image galleries — with optional end-to-end encryption.

## Features

- **5 share types** — Links (302 redirects), Markdown (GFM + Mermaid diagrams), Code (syntax-highlighted), Files (smart preview), Image Galleries (lightbox + drag reorder)
- **End-to-end encryption** — AES-256-GCM client-side encryption. The server never sees plaintext. Decryption keys live in the URL hash fragment and never leave the browser.
- **Passkey authentication** — No passwords. Sign in with biometrics, security keys, or platform authenticators via WebAuthn.
- **API keys** — Programmatic access via Bearer token auth. Keys are SHA-256 hashed before storage.
- **Auto-expiry** — Set expiration dates or max view counts. A daily cron job cleans up expired shares.
- **Dark/light theme** — System-aware with manual toggle.
- **Single-user** — Designed for personal use. One owner, unlimited shares.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers |
| Backend | [Hono](https://hono.dev) REST API |
| Frontend | React 19 + TypeScript SPA |
| Routing | TanStack Router (file-based) |
| State | TanStack React Query |
| Styling | Tailwind CSS 4 |
| Database | Cloudflare D1 (SQLite) |
| Sessions | Cloudflare KV |
| File Storage | Cloudflare R2 |
| Auth | WebAuthn / Passkeys ([SimpleWebAuthn](https://simplewebauthn.dev)) |
| Encryption | Web Crypto API (AES-256-GCM) |
| Code Editor | CodeMirror 6 |
| Markdown | marked + Shiki + Mermaid |
| Testing | Vitest + Playwright |
| Build | Vite 6 |

## Self-Hosting Guide

### Prerequisites

- [Node.js 22+](https://nodejs.org) (managed via [mise](https://mise.jdx.dev) if you prefer)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)

### 1. Clone and install

```bash
git clone <your-fork-url> owg-share
cd owg-share
npm install
```

### 2. Authenticate with Cloudflare

```bash
wrangler login
```

### 3. Create Cloudflare resources

Create a D1 database, KV namespace, and R2 bucket:

```bash
wrangler d1 create owg-share-db
wrangler kv namespace create KV
wrangler r2 bucket create owg-share-storage
```

Each command outputs an ID. Update `wrangler.toml` with your values:

```toml
[[d1_databases]]
binding = "DB"
database_name = "owg-share-db"
database_id = "<your-d1-database-id>"

[[kv_namespaces]]
binding = "KV"
id = "<your-kv-namespace-id>"

[[r2_buckets]]
binding = "R2"
bucket_name = "owg-share-storage"
```

### 4. Configure your domain

Update the `[vars]` section in `wrangler.toml`:

```toml
[vars]
APP_NAME = "My Share"                        # Displayed in header, login, and CLI
RP_ID = "share.yourdomain.com"               # Your domain (no protocol)
RP_ORIGIN = "https://share.yourdomain.com"   # Full origin URL
```

`APP_NAME` controls the site name shown throughout the UI (header, login page, setup page, CLI scripts). Set it to whatever you want.

Update or remove the `[[routes]]` section to match your domain:

```toml
[[routes]]
pattern = "share.yourdomain.com"
custom_domain = true
```

### 5. Apply database migrations

```bash
# Remote (production)
wrangler d1 migrations apply owg-share-db --remote
```

### 6. Deploy

```bash
npm run build
wrangler deploy
```

### 7. First-run setup

Visit your deployment URL. You'll see a setup page where you register your first passkey. This creates your user account — no further registration is possible without an active session.

### Local Development

```bash
# Apply migrations to local D1
wrangler d1 migrations apply owg-share-db --local

# Create .dev.vars from sample
cp .dev.vars.sample .dev.vars
# Edit .dev.vars — set RP_ID=localhost, RP_ORIGIN=http://localhost:5173

# Start dev server (frontend + worker with hot reload)
npm run dev
```

Or with mise:

```bash
mise run dev
```

## Development Commands

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server with Workers runtime |
| `npm run build` | Build for production |
| `npm run test` | Run unit tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:e2e` | Run end-to-end tests (Playwright) |
| `npm run typecheck` | Type-check TypeScript |
| `npm run lint` | Lint with ESLint |

## Project Structure

```
owg-share/
├── worker/                    # Cloudflare Worker (Hono API)
│   ├── index.ts               # Entry point, route mounting, cron cleanup
│   ├── types.ts               # Shared TypeScript interfaces
│   ├── routes/
│   │   ├── auth.ts            # Passkey registration & login
│   │   ├── shares.ts          # Share CRUD (all 5 types)
│   │   ├── public.ts          # Public viewing (no auth required)
│   │   ├── upload.ts          # File upload (presigned URLs, multipart)
│   │   ├── passkeys.ts        # Passkey management
│   │   └── apikeys.ts         # API key management
│   ├── middleware/
│   │   ├── auth.ts            # Session cookie & API key auth
│   │   └── ratelimit.ts       # KV-based rate limiting
│   └── lib/
│       ├── session.ts         # KV session management (7-day TTL)
│       ├── slug.ts            # Base62 slug generation
│       ├── crypto.ts          # API key hashing (SHA-256)
│       └── response.ts        # JSON response helpers
├── src/                       # React SPA
│   ├── routes/                # TanStack Router file-based routes
│   ├── components/            # UI components + share forms
│   ├── api/
│   │   ├── client.ts          # Fetch wrapper, multipart upload
│   │   └── hooks.ts           # React Query hooks
│   └── lib/
│       ├── crypto.ts          # AES-256-GCM encrypt/decrypt
│       └── format.ts          # Formatting utilities
├── migrations/                # D1 SQL migrations
├── tests/                     # E2E tests (Playwright)
└── wrangler.toml              # Cloudflare Workers config
```

## API

All API endpoints live under `/api`. Authenticated endpoints require either a session cookie (browser) or `Authorization: Bearer <api-key>` header.

### Public Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/s/:slug` | View share (redirects for links) |
| `GET` | `/s/data/:slug` | Get share data as JSON |
| `GET` | `/s/raw/:slug` | Raw content (text/plain) |
| `GET` | `/s/download/:slug` | File download |

### Share Management (authenticated)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/shares` | List shares (paginated, filterable) |
| `POST` | `/api/shares/links` | Create link share |
| `POST` | `/api/shares/markdown` | Create markdown share |
| `POST` | `/api/shares/code` | Create code share |
| `POST` | `/api/shares/files` | Create file share |
| `POST` | `/api/shares/galleries` | Create gallery share |
| `DELETE` | `/api/shares/:id` | Delete a share |

### Creating a share via API key

```bash
# Create an API key in Settings, then:
curl -X POST https://share.yourdomain.com/api/shares/links \
  -H "Authorization: Bearer owgs_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "title": "Example"}'
```

## URL Format

| Share Type | URL |
|---|---|
| Standard | `https://domain/s/{slug}` |
| Encrypted | `https://domain/s/{slug}#key={base64url_key}` |
| Link redirect | `https://domain/s/{slug}` (302 redirect) |

Slugs are base62-encoded random bytes: 8 chars (short), 24 chars (long), or 32 chars (encrypted). Custom slugs (1-64 chars, alphanumeric + hyphens) are also supported.

## License

Private. All rights reserved.
