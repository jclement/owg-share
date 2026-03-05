# OWG Share — Replacement Specification

> A private, self-hosted sharing platform built on Cloudflare Workers.
> Share links, markdown documents, code snippets, files, images/videos, and image galleries — with optional end-to-end encryption.

---

## 1. Architecture Overview

### Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Cloudflare Workers |
| **Framework** | React 19 + TypeScript SPA (Vite) |
| **Styling** | Tailwind CSS 4 |
| **Database** | Cloudflare D1 (SQLite-compatible) |
| **Key-Value** | Cloudflare KV (sessions, rate-limiting, caching) |
| **Object Storage** | Cloudflare R2 (files, images, videos) |
| **Auth** | WebAuthn / Passkeys (no external OIDC) |
| **Encryption** | Client-side AES-256-GCM via Web Crypto API |
| **Routing** | Hono (Workers-native framework) |
| **API** | REST JSON API consumed by the SPA |

### Deployment Topology

```
Browser (SPA)
  ├── Static assets served from Workers / R2
  ├── API calls → Cloudflare Worker (Hono)
  │     ├── D1 (metadata, users, shares)
  │     ├── KV (sessions, CSRF tokens)
  │     └── R2 (blobs: files, images, videos)
  └── Direct R2 upload via presigned URLs (large files)
```

### Project Structure

```
owg-share/
├── worker/                        # Cloudflare Worker (Hono API)
│   ├── src/
│   │   ├── index.ts               # Worker entry, Hono app
│   │   ├── routes/
│   │   │   ├── auth.ts            # Passkey registration/login
│   │   │   ├── shares.ts         # CRUD for all share types
│   │   │   ├── public.ts         # Public share viewing / redirects
│   │   │   ├── upload.ts         # Presigned URL generation, upload finalization
│   │   │   └── apikeys.ts        # API key management
│   │   ├── middleware/
│   │   │   ├── auth.ts            # Session validation, passkey challenge verification
│   │   │   ├── apikey.ts          # API key auth for programmatic access
│   │   │   └── ratelimit.ts       # KV-based rate limiting
│   │   ├── db/
│   │   │   ├── schema.sql         # D1 schema (migrations)
│   │   │   └── queries.ts         # Typed query helpers
│   │   ├── lib/
│   │   │   ├── slug.ts            # Slug generation (short/long/encrypted/custom)
│   │   │   ├── passkey.ts         # WebAuthn server-side logic (SimpleWebAuthn)
│   │   │   └── r2.ts             # R2 helpers (presigned URLs, delete)
│   │   └── types.ts               # Shared TypeScript types
│   ├── wrangler.toml              # Cloudflare Workers config
│   └── package.json
├── web/                           # React SPA
│   ├── src/
│   │   ├── main.tsx               # Entry point
│   │   ├── App.tsx                # Router, layout, auth context
│   │   ├── api/                   # API client (fetch wrapper, typed endpoints)
│   │   ├── components/
│   │   │   ├── layout/            # Shell, Navbar, Sidebar, Footer
│   │   │   ├── shares/            # ShareForm, ShareList, ShareCard
│   │   │   ├── upload/            # FileUploader (progress, drag-drop)
│   │   │   ├── editor/            # MarkdownEditor, CodeEditor
│   │   │   ├── viewer/            # MarkdownViewer, CodeViewer, FileViewer, GalleryViewer
│   │   │   ├── auth/              # PasskeyLogin, PasskeyRegister, PasskeyManage
│   │   │   ├── crypto/            # EncryptToggle, DecryptPrompt
│   │   │   └── ui/                # Button, Input, Modal, Toast, Spinner, etc.
│   │   ├── hooks/                 # useAuth, useShares, useUpload, useCrypto
│   │   ├── lib/
│   │   │   ├── crypto.ts          # AES-256-GCM encrypt/decrypt (Web Crypto API)
│   │   │   └── passkey.ts         # WebAuthn browser-side (SimpleWebAuthn browser)
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx      # Home / share list with stats
│   │   │   ├── Login.tsx          # Passkey authentication
│   │   │   ├── Setup.tsx          # First-run passkey registration
│   │   │   ├── shares/
│   │   │   │   ├── Links.tsx
│   │   │   │   ├── Markdown.tsx
│   │   │   │   ├── Code.tsx
│   │   │   │   ├── Files.tsx
│   │   │   │   └── Galleries.tsx
│   │   │   ├── Settings.tsx       # Passkey management, API keys
│   │   │   └── PublicView.tsx     # Public share viewer (handles all types + decryption)
│   │   ├── styles/
│   │   │   └── app.css            # Tailwind directives + custom utilities
│   │   └── types.ts               # Frontend type definitions
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── package.json
├── shared/                        # Shared types between worker and web
│   └── types.ts
└── package.json                   # Monorepo root (workspaces)
```

---

## 2. Database Schema (D1)

```sql
-- Users (single-user system, but schema supports multiple for future-proofing)
CREATE TABLE users (
  id TEXT PRIMARY KEY,              -- UUID
  username TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- WebAuthn Credentials (Passkeys)
CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,              -- credential ID (base64url)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL,         -- COSE public key
  counter INTEGER NOT NULL DEFAULT 0,
  device_type TEXT,                  -- "singleDevice" | "multiDevice"
  backed_up INTEGER NOT NULL DEFAULT 0,
  transports TEXT,                   -- JSON array of transports
  name TEXT,                         -- user-assigned friendly name
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

-- Shares (base table for all content types)
CREATE TABLE shares (
  id TEXT PRIMARY KEY,              -- UUID
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('link', 'markdown', 'code', 'file', 'gallery')),
  title TEXT,
  comment TEXT,                     -- internal notes (never shown publicly)
  encrypted INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,                  -- ISO 8601 datetime, nullable
  max_hits INTEGER,                -- nullable, 0 = unlimited
  hits INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Link Shares
CREATE TABLE link_shares (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL UNIQUE REFERENCES shares(id) ON DELETE CASCADE,
  url TEXT NOT NULL
);

-- Markdown Shares
CREATE TABLE markdown_shares (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL UNIQUE REFERENCES shares(id) ON DELETE CASCADE,
  content TEXT NOT NULL              -- raw markdown or encrypted base64
);

-- Code Shares
CREATE TABLE code_shares (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL UNIQUE REFERENCES shares(id) ON DELETE CASCADE,
  content TEXT NOT NULL,             -- raw code or encrypted base64
  language TEXT,                     -- highlight.js language identifier
  filename TEXT                      -- original filename (for language detection)
);

-- File Shares
CREATE TABLE file_shares (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL UNIQUE REFERENCES shares(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  r2_key TEXT NOT NULL               -- R2 object key
);

-- Gallery Shares
CREATE TABLE gallery_shares (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL UNIQUE REFERENCES shares(id) ON DELETE CASCADE
);

-- Gallery Images
CREATE TABLE gallery_images (
  id TEXT PRIMARY KEY,
  gallery_id TEXT NOT NULL REFERENCES gallery_shares(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  caption TEXT
);

-- API Keys
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,            -- SHA-256 hash
  key_prefix TEXT NOT NULL,          -- first 8 chars for display
  expires_at TEXT,
  last_used_at TEXT,
  last_used_ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- WebAuthn Challenges (ephemeral, could also use KV)
CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('registration', 'authentication')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- Indexes
CREATE INDEX idx_shares_user_id ON shares(user_id);
CREATE INDEX idx_shares_slug ON shares(slug);
CREATE INDEX idx_shares_type ON shares(user_id, type);
CREATE INDEX idx_shares_created ON shares(user_id, created_at DESC);
CREATE INDEX idx_gallery_images_gallery ON gallery_images(gallery_id, sort_order);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_passkeys_user ON passkeys(user_id);
```

---

## 3. Authentication — Passkeys (WebAuthn)

### First-Run Setup

1. On first request, the Worker checks D1 for any users. If none exist, the SPA renders the **Setup** page.
2. User enters a username and initiates passkey registration.
3. Worker generates a registration challenge (via `@simplewebauthn/server`), stores it in D1 `auth_challenges`.
4. Browser calls `navigator.credentials.create()` (via `@simplewebauthn/browser`).
5. Worker verifies the attestation response, creates the `users` row and `passkeys` row.
6. Session cookie issued (signed JWT or opaque token stored in KV).

### Subsequent Logins

1. SPA hits `GET /api/auth/status`. If no valid session, show login page.
2. User clicks "Sign in with Passkey".
3. Worker generates an authentication challenge, stores in D1.
4. Browser calls `navigator.credentials.get()`.
5. Worker verifies the assertion response (signature, counter increment).
6. Session issued. Stored in KV with a configurable TTL (default: 7 days).

### Session Management

- Sessions stored in **KV**: key = `session:{token}`, value = `{ userId, createdAt, expiresAt }`.
- Session token sent as `HttpOnly`, `Secure`, `SameSite=Lax` cookie.
- On each authenticated request, middleware reads the cookie, looks up KV, and injects `userId` into the request context.

### Passkey Management (Settings Page)

- List all registered passkeys with friendly names, creation date, last-used date.
- Rename passkeys.
- Delete passkeys (prevent deleting the last one).
- Register additional passkeys (requires active session).

### Libraries

- **Worker**: `@simplewebauthn/server` — handles challenge generation, attestation/assertion verification.
- **Browser**: `@simplewebauthn/browser` — handles `navigator.credentials` calls.

---

## 4. Share Types & Content Handling

### 4.1 Links

| Field | Type | Notes |
|-------|------|-------|
| url | string | Required. Validated URL. |
| title | string | Optional display name. |
| slug_type | enum | `short` / `custom` |

- **Public behavior**: HTTP 302 redirect to `url`.
- Links do **not** support `long` or `encrypted` slugs (no content to protect; the URL is the content).

### 4.2 Markdown Documents

| Field | Type | Notes |
|-------|------|-------|
| content | string | Markdown text (or encrypted base64) |
| title | string | Optional |
| encrypted | boolean | If true, content is client-encrypted |

- **Public view**: Rendered markdown with GitHub Flavored Markdown (tables, strikethrough, task lists). Mermaid diagram support (code blocks with `mermaid` language tag rendered as SVG).
- **Raw view**: Serve plain text source.
- **Renderer**: Use `marked` or `markdown-it` in the browser (since it's a SPA). Sanitize HTML output with DOMPurify.

### 4.3 Code Snippets

| Field | Type | Notes |
|-------|------|-------|
| content | string | Source code (or encrypted base64) |
| language | string | Language identifier for highlighting |
| filename | string | Optional original filename |

- **Public view**: Syntax-highlighted via Shiki (better than highlight.js — supports VS Code themes, more languages, runs in Workers too).
- **Raw view**: Plain text.
- **Language detection**: Infer from filename extension → fallback to user selection → fallback to auto-detect.

### 4.4 Files

| Field | Type | Notes |
|-------|------|-------|
| filename | string | Original filename |
| content_type | string | MIME type |
| size | integer | Bytes |
| r2_key | string | R2 object key |
| encrypted | boolean | If true, file bytes are encrypted client-side before upload |

- **Public view**: Smart preview based on MIME type:
  - **Images** (`image/*`): Rendered inline with `<img>`.
  - **Videos** (`video/*`): HTML5 `<video>` player with controls.
  - **Audio** (`audio/*`): HTML5 `<audio>` player.
  - **PDF** (`application/pdf`): Embedded `<iframe>` or `<object>`.
  - **Text/code** (`text/*`): Rendered inline with syntax highlighting.
  - **Everything else**: Download button with file size and type info.
- **Download**: Stream from R2 with correct `Content-Type` and `Content-Disposition`.

### 4.5 Image Galleries

| Field | Type | Notes |
|-------|------|-------|
| images[] | array | Ordered list of gallery images |
| title | string | Gallery title |

Each image has: `filename`, `content_type`, `size`, `r2_key`, `sort_order`, `caption`.

- **Public view**: Responsive image grid. Click to open a lightbox (full-resolution, previous/next navigation, caption overlay). Keyboard navigation (arrow keys, escape).
- **Admin view**: Drag-and-drop reorder. Per-image caption editing. Add/remove images. Thumbnail previews during upload.

---

## 5. Slug System

### Slug Types

| Type | Length | Character Set | Use Case |
|------|--------|--------------|----------|
| **short** | 8 chars | `[a-zA-Z0-9]` (base62) | Links, casual shares |
| **long** | 24 chars | `[a-zA-Z0-9]` (base62) | Unguessable shares (files, markdown, code, galleries) |
| **encrypted** | 32 chars | `[a-zA-Z0-9]` (base62) | Encrypted content (extra entropy) |
| **custom** | 1-64 chars | `[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]` | User-chosen vanity slugs |

### Generation

- Use `crypto.getRandomValues()` mapped to base62 alphabet.
- Retry on collision (check D1 uniqueness constraint).

### Reserved Slugs

Block: `api`, `auth`, `login`, `setup`, `settings`, `dashboard`, `static`, `assets`, `health`, `s`, `admin`, `new`, `edit`, `delete`.

### Public URL Format

- Standard: `https://{domain}/s/{slug}`
- Encrypted: `https://{domain}/s/{slug}#key={base64url_key}`
- Link redirect: `https://{domain}/s/{slug}` → 302 to target URL

---

## 6. End-to-End Encryption

### Supported Content Types

All types **except links** support encryption.

### Encryption Flow (Create)

```
1. User toggles "Encrypt" on the create/edit form
2. Browser generates random 256-bit AES key via crypto.getRandomValues()
3. For text content (markdown, code):
   a. Encode content as UTF-8
   b. Generate 12-byte random IV
   c. Encrypt with AES-256-GCM: ciphertext = AES-GCM(key, iv, plaintext)
   d. Concatenate: iv (12 bytes) || ciphertext
   e. Base64-encode the result
   f. Send to API as the "content" field with encrypted=true
4. For files/images:
   a. Read file as ArrayBuffer
   b. Generate 12-byte random IV per file
   c. Encrypt each file with AES-256-GCM
   d. Upload encrypted bytes to R2 (via presigned URL)
   e. Store metadata with encrypted=true
5. After successful creation:
   a. Display share URL with key in hash fragment: /s/{slug}#key={base64url_key}
   b. Show copy button for the full URL
   c. Warn user: "Save this URL — the key cannot be recovered"
```

### Decryption Flow (View)

```
1. SPA loads public view for an encrypted share
2. Check URL hash for #key={base64url_key}
3. If key present: auto-decrypt and render
4. If key absent: show a prompt asking for the key
   a. User can paste the key or the full URL
   b. Extract key from input
5. Decrypt content:
   a. Base64-decode the stored content
   b. Split: first 12 bytes = IV, remainder = ciphertext
   c. Import key via Web Crypto API
   d. AES-256-GCM decrypt
6. Render decrypted content (markdown → rendered HTML, code → highlighted, file → blob URL)
7. Key NEVER leaves the browser. Server NEVER sees plaintext.
```

### Encrypted File Handling

For encrypted files and gallery images:
- The browser encrypts the file bytes before upload.
- The encrypted blob is stored in R2.
- On download/view, the browser fetches the encrypted blob and decrypts locally.
- The `content_type` and `filename` stored in D1 are the **original** values (pre-encryption) so the viewer knows how to render after decryption.

---

## 7. File Upload System

### Upload Flow (Large Files — Direct to R2)

```
1. User selects file(s) in the SPA
2. SPA requests presigned upload URL(s) from Worker:
   POST /api/upload/presign
   { filename, contentType, size, encrypted }
3. Worker generates:
   a. R2 key: {userId}/{uuid}/{filename}
   b. Presigned PUT URL (R2 presigned URL with expiry)
   c. Returns { uploadUrl, r2Key, uploadId }
4. SPA uploads directly to R2 via the presigned URL:
   a. PUT to presigned URL with file body
   b. Track progress via XMLHttpRequest (onprogress event)
   c. Display progress bar per file
5. On completion, SPA calls:
   POST /api/upload/finalize
   { uploadId, r2Key, shareData... }
6. Worker creates the Share + FileShare/GalleryImage records in D1
```

### Upload UX Requirements

- **Drag-and-drop zone**: Large, visible drop target with hover state.
- **File picker**: Click to browse, or drag files.
- **Progress bars**: Per-file progress (percentage + bytes transferred). Use `XMLHttpRequest` for progress events (fetch API doesn't support upload progress).
- **Cancel**: Ability to cancel in-progress uploads.
- **Retry**: Auto-retry failed uploads (up to 3 attempts with exponential backoff).
- **Size display**: Show file size in human-readable format during upload.
- **Thumbnail preview**: For images, show a thumbnail preview before/during upload.
- **Multi-file**: Support selecting and uploading multiple files simultaneously for galleries.
- **Encrypted upload**: If encryption enabled, show "Encrypting..." state before upload begins.

### Upload Limits

| Limit | Value |
|-------|-------|
| Single file max | 100 MB (R2 single PUT limit; use multipart for larger) |
| Gallery total max | 500 MB |
| Gallery max images | 50 |

For files > 100MB, use R2 multipart upload (createMultipartUpload → uploadPart → completeMultipartUpload).

---

## 8. API Design

### Base URL: `/api`

All API responses follow:
```typescript
// Success
{ success: true, data: T }

// Error
{ success: false, error: { code: string, message: string } }
```

### Authentication Endpoints

```
POST   /api/auth/register/options     # Get passkey registration options
POST   /api/auth/register/verify      # Verify registration & create user+session
POST   /api/auth/login/options        # Get passkey authentication options
POST   /api/auth/login/verify         # Verify authentication & create session
POST   /api/auth/logout               # Destroy session
GET    /api/auth/status               # Check session validity, return user info
```

### Share Endpoints (Session Auth)

```
# Shares (generic)
GET    /api/shares                    # List all shares (paginated, filterable by type)
GET    /api/shares/:id                # Get share by ID
DELETE /api/shares/:id                # Delete share

# Links
POST   /api/shares/links              # Create link share
PUT    /api/shares/links/:id          # Update link share

# Markdown
POST   /api/shares/markdown           # Create markdown share
PUT    /api/shares/markdown/:id       # Update markdown share

# Code
POST   /api/shares/code               # Create code share
PUT    /api/shares/code/:id           # Update code share

# Files
POST   /api/shares/files              # Create file share (after R2 upload)
PUT    /api/shares/files/:id          # Update file metadata

# Galleries
POST   /api/shares/galleries          # Create gallery share
PUT    /api/shares/galleries/:id      # Update gallery metadata
POST   /api/shares/galleries/:id/images      # Add images
PUT    /api/shares/galleries/:id/images/:imgId   # Update image (caption)
DELETE /api/shares/galleries/:id/images/:imgId   # Remove image
POST   /api/shares/galleries/:id/reorder         # Reorder images
```

### Upload Endpoints (Session Auth)

```
POST   /api/upload/presign            # Get presigned R2 upload URL
POST   /api/upload/presign-multipart  # Init multipart upload
POST   /api/upload/complete-multipart # Complete multipart upload
```

### Public Endpoints (No Auth)

```
GET    /s/:slug                       # Resolve share (returns type + data for SPA rendering)
GET    /s/:slug/raw                   # Raw content (text/plain)
GET    /s/:slug/download              # File download (streams from R2)
GET    /s/:slug/image/:imageId        # Gallery image (streams from R2)
```

For the public `/s/:slug` endpoint:
- If `type === 'link'`: return `{ redirect: url }` and the SPA (or a server-side handler) issues a 302.
- Otherwise: return the share metadata + content for the SPA to render.
- If `encrypted === true`: return the encrypted payload. Decryption happens in the browser.
- Check expiry and max_hits. Increment `hits` counter.

### Public API v1 (API Key Auth)

```
POST   /api/v1/links                  # Create link
POST   /api/v1/markdown               # Create markdown
POST   /api/v1/code                   # Create code
POST   /api/v1/files                  # Create file (multipart form)
```

API key sent as `Authorization: Bearer {key}`. Worker hashes the key with SHA-256 and looks up in D1.

### Passkey Management (Session Auth)

```
GET    /api/passkeys                  # List user's passkeys
PUT    /api/passkeys/:id              # Rename passkey
DELETE /api/passkeys/:id              # Delete passkey (prevent deleting last)
POST   /api/passkeys/register/options # Options for adding new passkey
POST   /api/passkeys/register/verify  # Verify and save new passkey
```

### API Key Management (Session Auth)

```
GET    /api/apikeys                   # List API keys
POST   /api/apikeys                   # Create API key (returns raw key once)
DELETE /api/apikeys/:id               # Delete API key
```

---

## 9. Frontend Pages & UI

### Design System

- **Tailwind CSS 4** with a dark-mode-first design.
- **Color palette**: Neutral grays with a single accent color (blue or teal). Minimal, technical aesthetic.
- **Typography**: Monospace for code/slugs/keys. Sans-serif (Inter or system font stack) for everything else.
- **Spacing**: Generous whitespace. No visual clutter.
- **Components**: Clean card-based layouts. Subtle borders. No heavy shadows.
- **Responsive**: Mobile-first. Collapsible sidebar on mobile. Full-width on small screens.

### Page Breakdown

#### Setup Page (`/setup`)
- Only shown when no users exist in the system.
- Username input + "Register Passkey" button.
- Clean centered card layout.
- After registration, redirect to dashboard.

#### Login Page (`/login`)
- "Sign in with Passkey" button.
- Minimal. Centered card.
- Error feedback if passkey auth fails.

#### Dashboard (`/`)
- **Stats bar**: Total shares, total hits, breakdown by type (small stat cards).
- **Recent shares table**: Paginated, sortable. Columns: Type icon, Title/Slug, Created, Hits, Actions.
- **Quick actions**: Floating action button or toolbar for "New Link / Markdown / Code / File / Gallery".
- **Search/filter**: Filter by type, search by title/slug.

#### Share List Pages (`/links`, `/markdown`, `/code`, `/files`, `/galleries`)
- Filtered view of shares by type.
- Same table layout as dashboard but type-specific.
- "New" button prominent.

#### Create/Edit Forms
- **Common fields**: Title (optional), Slug type selector (radio: Short / Long / Custom), Custom slug input (shown conditionally), Expiry selector (dropdown: Never / 1h / 24h / 7d / 30d / Custom datetime), Max hits (optional number input), Comment (optional textarea, internal only), Encrypt toggle (checkbox with explanation text).
- **Link-specific**: URL input with validation.
- **Markdown-specific**: Textarea with live preview side-by-side. Tab between "Write" and "Preview". Use CodeMirror or a simple textarea with markdown toolbar (bold, italic, link, code, heading buttons).
- **Code-specific**: Textarea (or CodeMirror with syntax highlighting). Language dropdown. Filename input. Language auto-detected from filename.
- **File-specific**: Drag-and-drop upload zone. File picker button. Progress bar. Preview (if image/video). Metadata shown after upload.
- **Gallery-specific**: Multi-file drag-and-drop. Thumbnail grid with drag-to-reorder. Per-image caption input. Add/remove images.

#### Public View Page (`/s/:slug`)
- The SPA handles all public views.
- **Link**: Immediate redirect (or show "Redirecting to {url}..." with a countdown if the SPA catches it).
- **Markdown**: Beautifully rendered markdown. Clean reading experience. Mermaid diagrams. Table of contents for long documents.
- **Code**: Full syntax highlighting with line numbers. Copy button. Language badge. Filename displayed if set.
- **File**: Smart preview based on content type. Download button. File size and type info.
- **Gallery**: Responsive masonry/grid layout. Lightbox on click. Arrow key navigation. Captions.
- **Encrypted**: If key is missing, show a clean prompt: "This content is encrypted. Enter the decryption key:" with an input field and decrypt button. If key is in URL hash, auto-decrypt seamlessly.

#### Settings Page (`/settings`)
- **Passkeys section**: List registered passkeys. Rename. Delete (with confirmation, prevent deleting last). "Add new passkey" button.
- **API Keys section**: List keys (showing prefix, name, created, last used). Create new key (show raw key in a modal once — copy button — then never again). Delete with confirmation.

---

## 10. Public View — Link Redirects

For link shares, the redirect **must** happen at the Worker level (not the SPA) for performance and compatibility with non-browser clients (curl, bots, etc.):

```
Worker receives GET /s/{slug}
  → Query D1 for share with slug
  → If type === 'link':
      → Increment hits
      → Check expiry / max_hits
      → Return 302 with Location header
  → If type !== 'link':
      → Return the SPA HTML shell (index.html)
      → SPA hydrates and fetches share data via API
```

This means the Worker needs a small HTML handler that:
1. For link slugs: returns a 302 redirect immediately.
2. For all other slugs: serves the SPA `index.html` so React can handle rendering.
3. For API routes (`/api/*`): handle normally.
4. For static assets: serve from R2 or Workers Sites.

---

## 11. Rate Limiting

Use Cloudflare KV for simple rate limiting on public endpoints:

| Endpoint | Limit |
|----------|-------|
| `POST /api/auth/*` | 10 requests / minute / IP |
| `GET /s/:slug` | 60 requests / minute / IP |
| `POST /api/v1/*` | 30 requests / minute / API key |

Implementation: KV key = `ratelimit:{ip}:{endpoint}`, value = counter, TTL = window duration.

---

## 12. Expiry & Cleanup

### On View (Lazy Check)

When a public share is accessed:
1. Check `expires_at` — if past, return 410 Gone.
2. Check `max_hits` — if `hits >= max_hits`, return 410 Gone.
3. Otherwise, increment `hits` and serve.

### Periodic Cleanup (Cron Trigger)

Cloudflare Workers supports Cron Triggers. Schedule a daily cleanup:
1. Query D1 for shares where `expires_at < now()`.
2. Delete associated R2 objects.
3. Delete D1 records.

```toml
# wrangler.toml
[triggers]
crons = ["0 3 * * *"]  # Daily at 3 AM UTC
```

---

## 13. Content Rendering

### Markdown Rendering (Browser-side)

- Use `marked` for Markdown → HTML conversion.
- Use `DOMPurify` to sanitize output (prevent XSS).
- Support GFM extensions: tables, strikethrough, task lists, autolinks.
- Mermaid diagrams: Detect ```` ```mermaid ```` code blocks, render with Mermaid.js.
- Syntax highlighting for code blocks within markdown: use Shiki or highlight.js.

### Code Highlighting (Browser-side)

- Use Shiki for VS Code-quality syntax highlighting.
- Ship a subset of languages (top 30) to keep bundle size reasonable.
- Theme: One Dark Pro or similar dark theme matching the app aesthetic.
- Line numbers. Copy-to-clipboard button.

---

## 14. Responsive Design Requirements

| Breakpoint | Layout |
|-----------|--------|
| **Mobile** (< 640px) | Single column. Hamburger menu. Full-width cards. Stacked form fields. |
| **Tablet** (640–1024px) | Two-column where appropriate. Sidebar collapses to top nav. |
| **Desktop** (> 1024px) | Sidebar navigation. Multi-column dashboard. Side-by-side markdown editor/preview. |

### Key Responsive Behaviors

- **Navigation**: Sidebar on desktop → hamburger drawer on mobile.
- **Tables**: Horizontal scroll on mobile, or card-based layout for share lists.
- **Forms**: Stack vertically on mobile. Full-width inputs.
- **Gallery grid**: 1 column mobile → 2 tablet → 3-4 desktop.
- **Code viewer**: Horizontal scroll with line numbers.
- **Lightbox**: Full-screen on mobile.

---

## 15. Implementation Notes

### Cloudflare Worker Bindings (wrangler.toml)

```toml
name = "owg-share"
main = "worker/src/index.ts"
compatibility_date = "2025-01-01"

[site]
bucket = "./web/dist"   # Vite build output

[[d1_databases]]
binding = "DB"
database_name = "owg-share"
database_id = "<from dashboard>"

[[kv_namespaces]]
binding = "KV"
id = "<from dashboard>"

[[r2_buckets]]
binding = "R2"
bucket_name = "owg-share"

[triggers]
crons = ["0 3 * * *"]
```

### Hono Worker Entry Point Pattern

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

// Mount route groups
app.route('/api/auth', authRoutes);
app.route('/api/shares', shareRoutes);
app.route('/api/upload', uploadRoutes);
app.route('/api/apikeys', apikeyRoutes);
app.route('/api/passkeys', passkeyRoutes);
app.route('/api/v1', publicApiRoutes);

// Public share handler (redirect links, serve SPA for others)
app.get('/s/:slug', publicHandler);

// SPA fallback (serve index.html for all non-API routes)
app.get('*', serveStatic);

export default app;
```

### Key Dependencies

| Package | Purpose |
|---------|---------|
| `hono` | HTTP framework for Workers |
| `@simplewebauthn/server` | WebAuthn server-side |
| `@simplewebauthn/browser` | WebAuthn browser-side |
| `react` + `react-dom` | SPA framework |
| `react-router` | Client-side routing |
| `@tanstack/react-query` | API data fetching + caching |
| `marked` | Markdown → HTML |
| `dompurify` | HTML sanitization |
| `shiki` | Syntax highlighting |
| `mermaid` | Diagram rendering |
| `tailwindcss` | Styling |
| `vite` | Build tool |
| `@dnd-kit/core` | Drag-and-drop (gallery reorder) |

### Environment Variables / Secrets

| Variable | Purpose |
|----------|---------|
| `WEBAUTHN_RP_NAME` | Relying Party name (e.g., "OWG Share") |
| `WEBAUTHN_RP_ID` | Relying Party ID (e.g., "share.example.com") |
| `WEBAUTHN_ORIGIN` | Expected origin (e.g., "https://share.example.com") |
| `SESSION_SECRET` | HMAC key for signing session tokens |

Set via `wrangler secret put` or in the Cloudflare dashboard.

---

## 16. Build & Deploy

```bash
# Development
cd web && npm run dev          # Vite dev server (HMR)
cd worker && wrangler dev      # Worker dev server (local D1, KV, R2)

# Build
cd web && npm run build        # Produces dist/
cd worker && wrangler deploy   # Deploys worker + static assets

# Database
wrangler d1 execute owg-share --file=worker/src/db/schema.sql  # Apply schema
```

---

## 17. Non-Functional Requirements

| Requirement | Target |
|------------|--------|
| **First Contentful Paint** | < 1s (static assets from edge) |
| **Time to Interactive** | < 2s |
| **Lighthouse Performance** | > 90 |
| **Bundle size (SPA)** | < 200KB gzipped (code-split heavy deps like Shiki, Mermaid) |
| **API latency (p95)** | < 100ms for DB operations |
| **Uptime** | Cloudflare Workers SLA (99.99%) |
| **Data durability** | R2 (11 9s durability), D1 (replicated) |
