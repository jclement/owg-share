# Security

This document describes the security model of OWG Share, covering authentication, encryption, URL guessability, and threat mitigations.

## Authentication

### Passkeys (WebAuthn)

OWG Share uses **passkey-only authentication** via the WebAuthn standard. There are no passwords anywhere in the system.

- **Registration**: The first visitor to a fresh deployment creates the owner account by registering a passkey. Subsequent registrations require an active session — no one can create an account without being authenticated first.
- **Login**: The browser calls `navigator.credentials.get()`, the user confirms via biometric/PIN/security key, and the server verifies the cryptographic assertion against the stored public key.
- **Replay protection**: Each passkey has a monotonically increasing counter. The server verifies the counter increments on every authentication, detecting cloned credentials.
- **Challenge expiry**: Registration and authentication challenges are stored in KV with a 5-minute TTL. Expired challenges are rejected.

### Sessions

- **Token**: A random UUID (`crypto.randomUUID()`), providing 122 bits of entropy.
- **Storage**: Server-side in Cloudflare KV with a 7-day TTL. The session token is an opaque lookup key — no data is embedded in the token itself.
- **Cookie flags**: `HttpOnly` (no JavaScript access), `Secure` (HTTPS only — Cloudflare Workers always serve over HTTPS), `SameSite=Lax` (CSRF protection for state-changing requests).
- **Logout**: Deletes the KV entry and sets the cookie `Max-Age=0`.

### API Keys

- **Generation**: 32 random bytes → hex-encoded with `owgs_` prefix (69 characters total, 256 bits of entropy).
- **Storage**: Only the SHA-256 hash is stored in D1. The raw key is shown exactly once at creation time and can never be retrieved.
- **Display**: Only the first 12 characters (`key_prefix`) are stored for identification in the UI.
- **Tracking**: Last-used timestamp and IP address are recorded on each use (non-blocking via `waitUntil`).
- **Expiry**: Optional expiration date. Expired keys are rejected at authentication time.

## End-to-End Encryption

### Algorithm

**AES-256-GCM** via the Web Crypto API. This is an authenticated encryption scheme — it provides both confidentiality and integrity. Tampered ciphertext is detected and rejected during decryption.

### Encryption Flow

1. Browser generates a random 256-bit key via `crypto.subtle.generateKey()`.
2. A 12-byte random IV is generated via `crypto.getRandomValues()` for each encryption operation.
3. Content is encrypted: `ciphertext = AES-GCM(key, iv, plaintext)`.
4. The IV is prepended to the ciphertext: `stored = iv (12 bytes) || ciphertext`.
5. For text content: the result is base64-encoded and sent to the API.
6. For files: the encrypted bytes are uploaded directly to R2.
7. The key is encoded as base64url and placed in the URL hash fragment: `/s/{slug}#key={base64url_key}`.

### Key Properties

- **The server never sees the plaintext.** It stores and serves encrypted blobs without the ability to decrypt them.
- **The key never leaves the browser as a network request.** URL hash fragments (`#...`) are not sent to servers per the HTTP specification (RFC 3986 Section 3.5).
- **Each encryption operation uses a unique random IV.** Re-encrypting the same content produces different ciphertext.
- **No key derivation or stretching.** Keys are raw 256-bit random values — not derived from passwords — so KDF attacks don't apply.

### Decryption Flow

1. The viewer's browser extracts the key from the URL hash fragment.
2. If no key is present, the user is prompted to paste the key or full URL.
3. The browser fetches the encrypted content from the server.
4. Decryption happens entirely client-side using the Web Crypto API.
5. The decrypted content is rendered in the browser and never sent back to the server.

### What Is Not Encrypted

- **Share metadata**: Title, comment, share type, slug, creation date, hit count, and expiry are stored in plaintext in D1. This is by design — the server needs this metadata to enforce expiry, count hits, and serve the correct viewer.
- **File metadata**: Filename, content type, and file size are stored in plaintext so the viewer knows how to render after decryption.
- **Link shares**: Links don't support encryption. The URL is the content, and the server needs it to issue 302 redirects.

### Threat Model for Encryption

| Threat | Mitigated? | Notes |
|---|---|---|
| Server compromise reads content | Yes | Server only has ciphertext |
| Network eavesdropping reads content | Yes | HTTPS + content is encrypted |
| Server logs capture decryption key | Yes | Key is in hash fragment, never sent to server |
| Brute-force the encryption key | Yes | 256-bit keyspace (~10^77 possibilities) |
| Recipient shares the URL | No | Anyone with the full URL (including hash) can decrypt |
| Browser extension reads decrypted content | No | Client-side encryption can't protect against compromised browsers |
| Server modifies ciphertext | Detected | AES-GCM authentication tag detects tampering |

## URL Guessability

### Slug Entropy

Slugs are generated from `crypto.getRandomValues()` mapped to a base62 alphabet (`0-9A-Za-z`).

| Slug Type | Length | Entropy | Brute-Force Attempts |
|---|---|---|---|
| **Short** | 8 chars | ~47.6 bits | ~2.18 x 10^14 |
| **Long** | 24 chars | ~142.8 bits | ~7.14 x 10^42 |
| **Encrypted** | 32 chars | ~190.4 bits | ~2.27 x 10^57 |

**Note on base62 modulo bias**: Bytes are mapped via `byte % 62`. Since 256 is not evenly divisible by 62, there is a slight bias toward the first 8 characters (0-7 appear with probability 5/256 vs 4/256 for others). This reduces effective entropy by ~0.09 bits per character — negligible for security purposes.

### Short slugs (8 chars, ~47.6 bits)

At 47.6 bits of entropy, a short slug has ~218 trillion possible values. Assuming an attacker can make 1,000 requests/second (after bypassing rate limiting), brute-forcing a specific slug would take ~6,900 years on average. Short slugs are appropriate for non-sensitive, non-encrypted content.

### Long slugs (24 chars, ~142.8 bits)

With ~142.8 bits of entropy, long slugs are computationally infeasible to guess. These are the default for content shares (markdown, code, file, gallery).

### Encrypted slugs (32 chars, ~190.4 bits)

Encrypted shares use 32-character slugs. Even if an attacker could guess the slug, they still cannot read the content without the 256-bit decryption key from the URL hash fragment. The long slug serves as defense-in-depth.

### Custom slugs

Users can set custom slugs (1-64 chars, alphanumeric + hyphens). These are inherently guessable. Reserved slugs (`api`, `auth`, `login`, `setup`, `settings`, etc.) are blocked to prevent routing conflicts.

### Enumeration Protection

- There is no endpoint that lists or searches public shares. The only way to access a share is to know its exact slug.
- The `/s/data/:slug` endpoint returns 404 for nonexistent slugs and 410 for expired ones — both return the same error structure, preventing oracle attacks on slug existence vs. expiry.

## Rate Limiting

IP-based rate limiting via Cloudflare KV:

| Scope | Limit |
|---|---|
| Auth endpoints (`/api/auth/*`) | 120 requests / 60 seconds / IP |
| Public share viewing (`/s/*`) | 120 requests / 60 seconds / IP |

Rate limit counters use KV TTL for automatic expiry. The `CF-Connecting-IP` header (set by Cloudflare) identifies clients.

## HTTP Security Headers

All `/api/*` responses include:

| Header | Value | Purpose |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type sniffing |
| `X-Frame-Options` | `DENY` | Prevents clickjacking via iframes |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits referrer leakage |

## Transport Security

Cloudflare Workers are served exclusively over HTTPS. There is no HTTP endpoint. TLS termination happens at Cloudflare's edge.

## Data Storage Security

| Data | Storage | Protection |
|---|---|---|
| User accounts | D1 | Single-user system; no self-registration |
| Passkey public keys | D1 | Public keys by design; useless without the private key on the user's device |
| Session tokens | KV | Random UUIDs with 7-day TTL; server-side only |
| API key hashes | D1 | SHA-256 hashed; raw keys never stored |
| Share content (encrypted) | D1 / R2 | AES-256-GCM ciphertext; server cannot decrypt |
| Share content (unencrypted) | D1 / R2 | Protected by slug secrecy and access controls |
| Uploaded files | R2 | Accessed only through authenticated API or public slug |

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it privately rather than opening a public issue.
