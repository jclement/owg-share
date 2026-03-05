# Cloudflare Workers SPA Spec

Prompt for building single-page applications deployed as Cloudflare Workers. The React/TypeScript frontend is served via Workers Static Assets. The Worker handles API routes, authentication, and data access using Cloudflare's platform services (D1, KV, R2). Everything deploys to Cloudflare's edge with a single `wrangler deploy`.

---

## Tooling & Versions

- Always use the **latest stable versions** of Node.js, Wrangler, and all dependencies.
- **Wrangler v4** is the current major version. Use TOML-based configuration (`wrangler.toml`).
- Use **[mise](https://mise.jdx.dev/)** for development tool management (Node.js).
- Maintain a `.mise.toml` at the project root with pinned tool versions and task definitions.
- Maintain a `.dev.vars.sample` file documenting all required secrets for local development.

### Key Dependencies

| Package | Purpose |
|---------|---------|
| `wrangler` | Cloudflare Workers CLI — dev server, deploy, resource provisioning |
| `@cloudflare/vite-plugin` | Vite plugin — runs Worker code in `workerd` during development |
| `@cloudflare/workers-types` | TypeScript types for Workers runtime APIs and bindings |
| `@tailwindcss/vite` | Tailwind CSS v4 Vite plugin — zero-config, CSS-first |
| `@simplewebauthn/server` | Server-side passkey registration and authentication |
| `@simplewebauthn/browser` | Client-side WebAuthn API wrapper |

### Mise Tasks

| Task | Description |
|------|-------------|
| `mise run dev` | Starts Vite dev server with `workerd` runtime (hot-reload for both frontend and Worker) |
| `mise run build` | Builds the frontend and Worker for production |
| `mise run deploy` | Builds and deploys to Cloudflare |
| `mise run preview` | Previews the production build locally |
| `mise run test` | Runs all tests (Vitest) |
| `mise run lint` | Runs ESLint + TypeScript checks |
| `mise run typecheck` | Runs `tsc --noEmit` and `wrangler types` |
| `mise run db:migrate` | Applies D1 migrations (local) |
| `mise run db:migrate:prod` | Applies D1 migrations (production, remote) |

---

## Project Structure

```
.
├── src/
│   ├── main.tsx                    # React entry point
│   ├── App.tsx                     # Root component (providers, router)
│   ├── app.css                     # Global styles (@import "tailwindcss")
│   ├── routes/                     # TanStack Router route definitions
│   │   ├── __root.tsx              # Root layout (shell, nav, user menu)
│   │   ├── index.tsx               # Home / dashboard
│   │   ├── login.tsx               # Passkey login page
│   │   ├── register.tsx            # Passkey registration page
│   │   └── settings/
│   │       └── index.tsx
│   ├── components/                 # Shared UI components
│   ├── api/                        # API client hooks
│   │   └── hooks.ts                # TanStack Query wrapper hooks
│   └── lib/                        # Utilities, auth context, helpers
├── worker/
│   ├── index.ts                    # Worker entry point (request router)
│   ├── router.ts                   # API route definitions
│   ├── middleware/                  # Auth, CORS, logging middleware
│   ├── handlers/                   # API handlers grouped by domain
│   │   ├── auth.ts                 # Passkey registration/authentication endpoints
│   │   └── ...                     # Domain-specific handlers
│   ├── services/                   # Business logic layer
│   │   └── auth.ts                 # WebAuthn verification logic
│   └── types.ts                    # Shared types, Env interface
├── migrations/                     # D1 SQL migration files
│   └── 0001_initial.sql
├── index.html                      # Vite entry HTML
├── vite.config.ts
├── wrangler.toml
├── tsconfig.json                   # Frontend TypeScript config
├── tsconfig.worker.json            # Worker TypeScript config
├── package.json
├── .mise.toml
├── .dev.vars.sample                # Sample secrets file
├── .dev.vars                       # Local secrets (gitignored)
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── deploy.yml
└── README.md
```

---

## Cloudflare Services — When to Use What

The agent should select services based on data characteristics. Use this decision matrix:

| Service | Use For | Examples |
|---------|---------|---------|
| **D1** (SQLite) | Relational data, queries with joins, structured records | Users, credentials, app data, audit logs |
| **KV** | Simple key-value lookups, short-lived data, config | Sessions, WebAuthn challenges (with TTL), feature flags |
| **R2** | Binary blobs, large files, user uploads | Avatars, documents, exports, backups |

### Provisioning

Wrangler v4 supports **automatic resource provisioning**. Declare bindings in `wrangler.toml` without IDs — Wrangler creates resources on first deploy and writes IDs back to the config:

```toml
# These get provisioned automatically on first deploy
[[d1_databases]]
binding = "DB"
database_name = "<appname>-db"

[[kv_namespaces]]
binding = "KV"

[[r2_buckets]]
binding = "STORAGE"
```

For explicit provisioning via CLI:

```bash
npx wrangler d1 create <appname>-db
npx wrangler kv namespace create KV
npx wrangler r2 bucket create <appname>-storage
```

After creation, add the returned IDs to `wrangler.toml`.

---

## Wrangler Configuration (`wrangler.toml`)

```toml
#:schema node_modules/wrangler/config-schema.json
name = "<appname>"
compatibility_date = "2026-03-04"
main = "./worker/index.ts"

[assets]
not_found_handling = "single-page-application"
binding = "ASSETS"
run_worker_first = ["/api/*"]

[vars]
ENVIRONMENT = "production"
APP_NAME = "<appname>"

# Relational data (users, credentials, app records)
[[d1_databases]]
binding = "DB"
database_name = "<appname>-db"

# Sessions, WebAuthn challenges, ephemeral data
[[kv_namespaces]]
binding = "KV"

# File storage (avatars, uploads) — include only if the app needs it
# [[r2_buckets]]
# binding = "STORAGE"

[observability]
enabled = true
```

### Key Configuration Notes

- **`not_found_handling = "single-page-application"`** — serves `/index.html` for all navigation requests that don't match a static file. This enables client-side routing.
- **`run_worker_first = ["/api/*"]`** — routes API requests to the Worker before checking static assets. Supports glob patterns and `!` exception patterns.
- **`binding = "ASSETS"`** — lets the Worker call `env.ASSETS.fetch(request)` to serve static files programmatically.
- **`directory`** is NOT needed when using `@cloudflare/vite-plugin` — the plugin automatically points to the Vite build output.
- **Secrets** (session keys, etc.) go in `.dev.vars` locally and are set via `npx wrangler secret put SECRET_NAME` for production. Never in `wrangler.toml`.

---

## Frontend Stack

| Component | Choice | Notes |
|-----------|--------|-------|
| **Build tool** | [Vite](https://vite.dev/) + `@cloudflare/vite-plugin` | Runs Worker in `workerd` during dev |
| **Language** | TypeScript | Strict mode enabled |
| **Framework** | [React](https://react.dev/) | Latest version |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com/) | Zero-config with `@tailwindcss/vite`, CSS-first theming |
| **Routing** | [TanStack Router](https://tanstack.com/router) | Type-safe file-based routing |
| **Data Fetching** | [TanStack Query](https://tanstack.com/query) | Caching, background refetch, optimistic updates |
| **Icons** | [Lucide React](https://lucide.dev/) | Tree-shakeable, consistent style |
| **Testing** | [Vitest](https://vitest.dev/) | Vite-native, fast |

### Tailwind CSS v4 Setup

Tailwind v4 requires **no config file** — just a CSS import and the Vite plugin.

**`src/app.css`:**
```css
@import "tailwindcss";

@theme {
  --color-primary: #3b82f6;
  --color-primary-dark: #2563eb;
  --font-sans: "Inter", system-ui, sans-serif;
}
```

That's it. No `tailwind.config.js`, no `postcss.config.js`, no template path arrays. Tailwind v4 auto-detects template files.

### Vite Configuration (`vite.config.ts`)

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

export default defineConfig({
  plugins: [
    TanStackRouterVite(),
    react(),
    tailwindcss(),
    cloudflare(),
  ],
});
```

The `@cloudflare/vite-plugin`:
- Reads `wrangler.toml` automatically
- Runs Worker code in the `workerd` runtime during development (matches production exactly)
- Provides HMR for both frontend and Worker code
- Builds both client and Worker output for deployment

### TanStack Query Hooks (`src/api/hooks.ts`)

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const api = {
  get: async (path: string) => {
    const res = await fetch(path);
    if (!res.ok) throw await res.json();
    return res.json();
  },
  post: async (path: string, body?: unknown) => {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw await res.json();
    return res.json();
  },
};

export function useCurrentUser() {
  return useQuery({
    queryKey: ["currentUser"],
    queryFn: () => api.get("/api/auth/me"),
    retry: false,
  });
}
```

---

## Worker Architecture

### Entry Point (`worker/index.ts`)

```typescript
import { handleApiRequest } from "./router";

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  ASSETS: Fetcher;
  // STORAGE: R2Bucket;  // uncomment if using R2
  SESSION_SECRET: string;
  RP_ID: string;        // WebAuthn Relying Party ID (e.g. "example.com")
  RP_ORIGIN: string;    // WebAuthn origin (e.g. "https://example.com")
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApiRequest(request, env, ctx);
    }

    // Fallback to static assets (shouldn't normally reach here due to run_worker_first config)
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
```

### API Router (`worker/router.ts`)

Use a lightweight router pattern. For simple apps, a manual switch on `pathname` + `method` is fine. For larger apps, consider [Hono](https://hono.dev/) — it's built for Workers and adds ~14kB:

**Simple (no dependencies):**
```typescript
export async function handleApiRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Auth routes
  if (path === "/api/auth/register/start" && method === "POST") return handleRegisterStart(request, env);
  if (path === "/api/auth/register/finish" && method === "POST") return handleRegisterFinish(request, env);
  if (path === "/api/auth/login/start" && method === "POST") return handleLoginStart(request, env);
  if (path === "/api/auth/login/finish" && method === "POST") return handleLoginFinish(request, env);
  if (path === "/api/auth/me" && method === "GET") return handleGetCurrentUser(request, env);
  if (path === "/api/auth/logout" && method === "POST") return handleLogout(request, env);

  return Response.json({ error: "Not found" }, { status: 404 });
}
```

**With Hono (recommended for larger apps):**
```typescript
import { Hono } from "hono";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.post("/api/auth/register/start", (c) => handleRegisterStart(c));
app.post("/api/auth/register/finish", (c) => handleRegisterFinish(c));
// ... more routes

export default app;
```

If using Hono, the Worker entry point simplifies to `export default app;` and remove the manual routing from `worker/index.ts`. Hono's middleware ecosystem (cors, logger, etc.) also replaces custom middleware.

### API Response Format

All API responses use a consistent envelope:

```json
// Success
{ "data": { ... } }

// Error
{ "error": { "message": "Something went wrong", "code": "VALIDATION_ERROR" } }

// List with pagination
{ "data": [...], "meta": { "total": 100, "page": 1, "per_page": 20 } }
```

Helper:
```typescript
function json(data: unknown, status = 200): Response {
  return Response.json({ data }, { status });
}

function error(message: string, status = 400, code?: string): Response {
  return Response.json({ error: { message, code } }, { status });
}
```

---

## Authentication — Passkeys (WebAuthn)

Passkeys are the preferred authentication method. They provide phishing-resistant, passwordless auth using platform authenticators (Touch ID, Face ID, Windows Hello, phone biometrics).

### Libraries

- **`@simplewebauthn/server`** (v13+) — works natively in Workers (uses Web Crypto, no Node.js polyfills needed)
- **`@simplewebauthn/browser`** — client-side helper for `navigator.credentials.create()` / `.get()`

### Storage Layout

| Data | Service | Key / Schema |
|------|---------|-------------|
| Users | D1 | `users` table (id, username, display_name, created_at) |
| Passkey credentials | D1 | `credentials` table (id, user_id, credential_id, public_key, counter, transports, created_at) |
| Registration/login challenges | KV | `challenge:{userId}` or `challenge:{sessionId}` with 5-minute TTL |
| Sessions | KV | `session:{token}` with configurable TTL (e.g. 30 days) |

### D1 Schema (`migrations/0001_initial.sql`)

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT UNIQUE NOT NULL,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,  -- JSON array of transports
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_credentials_user_id ON credentials(user_id);
CREATE INDEX idx_credentials_credential_id ON credentials(credential_id);
```

### Auth Flow

**Registration:**
```
Browser                              Worker
  │                                    │
  │ POST /api/auth/register/start ──→  │ generateRegistrationOptions()
  │ ← challenge + options              │ Store challenge in KV (5min TTL)
  │                                    │
  │ navigator.credentials.create()     │
  │ (user touches biometric sensor)    │
  │                                    │
  │ POST /api/auth/register/finish ──→ │ verifyRegistrationResponse()
  │ ← session cookie                   │ Store credential in D1
  │                                    │ Create session in KV
```

**Authentication:**
```
Browser                              Worker
  │                                    │
  │ POST /api/auth/login/start ──────→ │ generateAuthenticationOptions()
  │ ← challenge + options              │ Store challenge in KV (5min TTL)
  │                                    │
  │ navigator.credentials.get()        │
  │ (user touches biometric sensor)    │
  │                                    │
  │ POST /api/auth/login/finish ─────→ │ verifyAuthenticationResponse()
  │ ← session cookie                   │ Update counter in D1
  │                                    │ Create session in KV
```

### Server-Side Handler Example (`worker/handlers/auth.ts`)

```typescript
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { Env } from "../types";

export async function handleRegisterStart(request: Request, env: Env): Promise<Response> {
  const { username, displayName } = await request.json();

  // Check if username is taken
  const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
    .bind(username).first();
  if (existing) {
    return Response.json({ error: { message: "Username taken" } }, { status: 409 });
  }

  const userId = crypto.randomUUID();

  // Get existing credentials for this user (empty for new registration)
  const options = await generateRegistrationOptions({
    rpName: env.APP_NAME,
    rpID: env.RP_ID,
    userID: new TextEncoder().encode(userId),
    userName: username,
    userDisplayName: displayName || username,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  // Store challenge with 5-minute TTL
  await env.KV.put(
    `challenge:${userId}`,
    JSON.stringify({ challenge: options.challenge, username, displayName }),
    { expirationTtl: 300 },
  );

  return Response.json({ data: { ...options, userId } });
}
```

### Client-Side Example (`src/routes/register.tsx`)

```typescript
import { startRegistration } from "@simplewebauthn/browser";

async function register(username: string) {
  // 1. Get challenge from server
  const startRes = await fetch("/api/auth/register/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  const { data: options } = await startRes.json();

  // 2. Create credential (triggers biometric prompt)
  const credential = await startRegistration({ optionsJSON: options });

  // 3. Verify with server
  const finishRes = await fetch("/api/auth/register/finish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: options.userId, credential }),
  });

  if (finishRes.ok) {
    // Redirect to app — session cookie is set
    window.location.href = "/";
  }
}
```

### Sessions

- Sessions stored in **KV** with key `session:{token}` and a configurable TTL (default 30 days).
- Session token is a `crypto.randomUUID()` set as an `HttpOnly`, `Secure`, `SameSite=Lax` cookie.
- `GET /api/auth/me` validates the session cookie and returns the current user.
- `POST /api/auth/logout` deletes the KV entry and clears the cookie.

### Wrangler Secrets for WebAuthn

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put RP_ID          # e.g. "myapp.example.com"
npx wrangler secret put RP_ORIGIN      # e.g. "https://myapp.example.com"
```

For local development, set these in `.dev.vars`:
```
SESSION_SECRET=local-dev-secret-change-me
RP_ID=localhost
RP_ORIGIN=http://localhost:5173
```

---

## Development Workflow

### `mise run dev` — Hot-Reload Development

The Cloudflare Vite plugin runs the Worker in `workerd` (the actual Workers runtime) during development. Both frontend HMR and Worker code changes reload automatically.

```bash
mise run dev
# → Vite dev server starts at http://localhost:5173
# → Worker runs in workerd (same runtime as production)
# → Edit React components → instant HMR
# → Edit Worker code → automatic reload
```

This is a **single process** — no need to run frontend and backend separately. The Vite plugin handles both.

### D1 Migrations

```bash
# Create a new migration
npx wrangler d1 migrations create <appname>-db "add_users_table"

# Apply migrations locally
npx wrangler d1 migrations apply <appname>-db --local

# Apply migrations to production
npx wrangler d1 migrations apply <appname>-db --remote
```

Migrations live in `migrations/` and are plain SQL files. Wrangler applies them in order.

### Local Secrets (`.dev.vars`)

```
SESSION_SECRET=local-dev-secret-change-me
RP_ID=localhost
RP_ORIGIN=http://localhost:5173
```

This file is **gitignored**. Maintain `.dev.vars.sample` with placeholder values.

---

## CI/CD

### GitHub Actions: CI (`ci.yml`)

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: jdx/mise-action@v2

      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

### GitHub Actions: Deploy (`deploy.yml`)

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: jdx/mise-action@v2

      - name: Install dependencies
        run: npm ci

      - name: Run D1 migrations
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: d1 migrations apply <appname>-db --remote

      - name: Build and Deploy
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
```

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | API token with Workers Scripts (edit), D1 (edit), KV (edit), R2 (edit) permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

Create the API token at: Cloudflare Dashboard → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template.

---

## Security

### Headers

The Worker should set security headers on API responses:

```typescript
function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return new Response(response.body, { ...response, headers });
}
```

Static assets served by Workers Static Assets already get appropriate caching and content-type headers automatically.

### Rate Limiting

Use Cloudflare's built-in rate limiting (configured in the dashboard or via API) for auth endpoints. For application-level rate limiting, use KV with a sliding window:

```typescript
async function rateLimit(env: Env, key: string, limit: number, windowSecs: number): Promise<boolean> {
  const current = await env.KV.get(`ratelimit:${key}`);
  const count = current ? parseInt(current) : 0;
  if (count >= limit) return false;
  await env.KV.put(`ratelimit:${key}`, String(count + 1), { expirationTtl: windowSecs });
  return true;
}
```

### Input Validation

Validate all API inputs server-side. Use a lightweight schema library like [Valibot](https://valibot.dev/) (tree-shakeable, ~1kB) or [Zod](https://zod.dev/) for both frontend form validation and Worker request validation.

---

## Testing

### Vitest for Everything

Use **Vitest** for both frontend component tests and Worker handler tests.

**Frontend tests** — React Testing Library:
```typescript
// src/components/LoginButton.test.tsx
import { render, screen } from "@testing-library/react";
import { LoginButton } from "./LoginButton";

test("renders login button", () => {
  render(<LoginButton />);
  expect(screen.getByRole("button", { name: /sign in/i })).toBeDefined();
});
```

**Worker handler tests** — use `unstable_dev` from Wrangler or mock the Env:
```typescript
// worker/handlers/auth.test.ts
import { handleGetCurrentUser } from "./auth";

test("returns 401 without session", async () => {
  const request = new Request("http://localhost/api/auth/me");
  const env = { KV: mockKV(), DB: mockD1() } as Env;
  const response = await handleGetCurrentUser(request, env);
  expect(response.status).toBe(401);
});
```

Co-locate test files next to source: `Component.tsx` → `Component.test.tsx`, `auth.ts` → `auth.test.ts`.

---

## Configuration Files

### `.mise.toml`

```toml
[tools]
node = "22"

[env]
_.path = ["{{config_root}}/node_modules/.bin"]

[tasks.dev]
description = "Start dev server with hot reload"
run = "vite"
depends = ["install"]

[tasks.build]
description = "Build for production"
run = "vite build"
depends = ["install"]

[tasks.preview]
description = "Preview production build locally"
run = "vite preview"
depends = ["build"]

[tasks.deploy]
description = "Build and deploy to Cloudflare"
run = "vite build && wrangler deploy"
depends = ["install"]

[tasks.test]
description = "Run all tests"
run = "vitest run"
depends = ["install"]

[tasks."test:watch"]
description = "Run tests in watch mode"
run = "vitest"
depends = ["install"]

[tasks.lint]
description = "Run linter"
run = "eslint src/ worker/"
depends = ["install"]

[tasks.typecheck]
description = "Type-check frontend and worker"
run = "tsc --noEmit && wrangler types"
depends = ["install"]

[tasks."db:migrate"]
description = "Apply D1 migrations locally"
run = "wrangler d1 migrations apply <appname>-db --local"

[tasks."db:migrate:prod"]
description = "Apply D1 migrations to production"
run = "wrangler d1 migrations apply <appname>-db --remote"

[tasks."db:new"]
description = "Create a new D1 migration"
run = "wrangler d1 migrations create <appname>-db \"$1\""

[tasks.install]
description = "Install npm dependencies"
run = "npm install"
sources = ["package.json", "package-lock.json"]
outputs = ["node_modules/.package-lock.json"]
```

### `package.json`

```json
{
  "name": "<appname>",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "eslint src/ worker/",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@simplewebauthn/browser": "latest",
    "@tanstack/react-query": "^5",
    "@tanstack/react-router": "^1",
    "lucide-react": "latest",
    "react": "^19",
    "react-dom": "^19"
  },
  "devDependencies": {
    "@cloudflare/vite-plugin": "latest",
    "@cloudflare/workers-types": "latest",
    "@simplewebauthn/server": "latest",
    "@tailwindcss/vite": "latest",
    "@tanstack/router-plugin": "^1",
    "@testing-library/react": "latest",
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "@vitejs/plugin-react": "latest",
    "eslint": "latest",
    "tailwindcss": "latest",
    "typescript": "latest",
    "vite": "latest",
    "vitest": "latest",
    "wrangler": "latest"
  }
}
```

### `tsconfig.json` (Frontend)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.worker.json" }]
}
```

### `tsconfig.worker.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["@cloudflare/workers-types/2023-07-01"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true
  },
  "include": ["worker"]
}
```

### `.dev.vars.sample`

```
SESSION_SECRET=change-me-to-a-random-string
RP_ID=localhost
RP_ORIGIN=http://localhost:5173
```

### `.gitignore`

```
node_modules/
dist/
.wrangler/
.dev.vars
*.local
```
