-- Users (single-user system, but schema supports multiple for future-proofing)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- WebAuthn Credentials (Passkeys)
CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  device_type TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

-- Shares (base table for all content types)
CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('link', 'markdown', 'code', 'file', 'gallery')),
  title TEXT,
  comment TEXT,
  encrypted INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  max_hits INTEGER,
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
  content TEXT NOT NULL
);

-- Code Shares
CREATE TABLE code_shares (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL UNIQUE REFERENCES shares(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  language TEXT,
  filename TEXT
);

-- File Shares
CREATE TABLE file_shares (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL UNIQUE REFERENCES shares(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  r2_key TEXT NOT NULL
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
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT,
  last_used_ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX idx_shares_user_id ON shares(user_id);
CREATE INDEX idx_shares_slug ON shares(slug);
CREATE INDEX idx_shares_type ON shares(user_id, type);
CREATE INDEX idx_shares_created ON shares(user_id, created_at DESC);
CREATE INDEX idx_gallery_images_gallery ON gallery_images(gallery_id, sort_order);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_passkeys_user ON passkeys(user_id);
