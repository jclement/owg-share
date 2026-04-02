export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  APP_NAME: string;
  RP_ID: string;
  RP_ORIGIN: string;
}

export type ShareType = "link" | "markdown" | "code" | "file" | "gallery";

export interface User {
  id: string;
  username: string;
  created_at: string;
  updated_at: string;
}

export interface Passkey {
  id: string;
  user_id: string;
  public_key: ArrayBuffer;
  counter: number;
  device_type: string | null;
  backed_up: number;
  transports: string | null;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface Share {
  id: string;
  user_id: string;
  slug: string;
  type: ShareType;
  title: string | null;
  comment: string | null;
  encrypted: number;
  expires_at: string | null;
  max_hits: number | null;
  hits: number;
  created_at: string;
  updated_at: string;
}

export interface LinkShare {
  id: string;
  share_id: string;
  url: string;
}

export interface MarkdownShare {
  id: string;
  share_id: string;
  content: string;
}

export interface CodeShare {
  id: string;
  share_id: string;
  content: string;
  language: string | null;
  filename: string | null;
}

export interface FileShare {
  id: string;
  share_id: string;
  filename: string;
  content_type: string;
  size: number;
  r2_key: string;
}

export interface GalleryShare {
  id: string;
  share_id: string;
}

export interface GalleryImage {
  id: string;
  gallery_id: string;
  filename: string;
  content_type: string;
  size: number;
  r2_key: string;
  sort_order: number;
  caption: string | null;
}

export interface ApiKey {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  created_at: string;
}

export interface Session {
  userId: string;
  createdAt: string;
  expiresAt: string;
}

// API response types
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: { code: string; message: string };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
