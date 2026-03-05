import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMiddleware } from "hono/factory";
import { Hono } from "hono";
import type { Env, Share } from "../types";

// Mock the rate limiter to always pass through
vi.mock("../middleware/ratelimit", () => ({
  rateLimit: () => createMiddleware(async (_c, next) => next()),
}));

// We let getShareTypeData use the real implementation; it just does DB queries
// that our mock DB will handle.
import publicRoutes from "./public";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PublicApp = { Bindings: Env };

function makeShare(overrides: Partial<Share> = {}): Share {
  return {
    id: "share-1",
    user_id: "user-1",
    slug: "test-slug",
    type: "link",
    title: "Test Share",
    comment: null,
    encrypted: 0,
    expires_at: null,
    max_hits: null,
    hits: 0,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

/**
 * Creates a mock D1 database that routes `.first()` and `.all()` calls based on
 * the SQL string passed to `prepare()`.
 */
function createMockDB(shareData?: Record<string, any>) {
  return {
    prepare: vi.fn().mockImplementation((sql: string) => ({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockImplementation(async () => {
          if (sql.includes("UPDATE shares SET hits")) return null; // run() path, but guard first()
          if (sql.includes("FROM shares WHERE slug")) return shareData?.share ?? null;
          if (sql.includes("FROM link_shares")) return shareData?.link ?? null;
          if (sql.includes("FROM markdown_shares")) return shareData?.markdown ?? null;
          if (sql.includes("FROM code_shares")) return shareData?.code ?? null;
          if (sql.includes("FROM file_shares")) return shareData?.file ?? null;
          if (sql.includes("FROM gallery_shares")) return shareData?.gallery ?? null;
          if (sql.includes("FROM gallery_images")) return shareData?.image ?? null;
          return null;
        }),
        all: vi.fn().mockResolvedValue({ results: shareData?.images ?? [] }),
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      }),
    })),
  };
}

function createMockR2(body?: Uint8Array) {
  const bytes = body ?? new Uint8Array([1, 2, 3, 4]);
  return {
    get: vi.fn().mockResolvedValue({
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    }),
    put: vi.fn(),
    delete: vi.fn(),
  };
}

function createMockR2Missing() {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn(),
    delete: vi.fn(),
  };
}

function createMockAssets() {
  return {
    fetch: vi.fn().mockResolvedValue(
      new Response("<html>SPA</html>", {
        headers: { "Content-Type": "text/html" },
      }),
    ),
  };
}

function createMockKV() {
  return { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
}

function buildEnv(overrides: Record<string, any> = {}) {
  return {
    DB: createMockDB(),
    R2: createMockR2(),
    KV: createMockKV(),
    ASSETS: createMockAssets(),
    ENVIRONMENT: "test",
    APP_NAME: "share-test",
    SESSION_SECRET: "secret",
    RP_ID: "localhost",
    RP_ORIGIN: "http://localhost",
    ...overrides,
  };
}

function buildExecutionCtx() {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
}

/**
 * Convenience wrapper around `app.request()` that injects env + executionCtx.
 */
async function request(
  app: Hono<PublicApp>,
  path: string,
  env: Record<string, any>,
  executionCtx: ReturnType<typeof buildExecutionCtx>,
  init?: RequestInit,
) {
  return app.request(path, init ?? {}, env as any, executionCtx as any);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Public routes", () => {
  let app: Hono<PublicApp>;

  beforeEach(() => {
    vi.restoreAllMocks();
    app = new Hono<PublicApp>();
    app.route("/", publicRoutes);
  });

  // =========================================================================
  // GET /data/:slug
  // =========================================================================
  describe("GET /data/:slug", () => {
    it("returns share data for a valid link share", async () => {
      const share = makeShare({ type: "link", hits: 5 });
      const link = { url: "https://example.com" };
      const db = createMockDB({ share, link });
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/data/test-slug", env, ctx);
      expect(res.status).toBe(200);

      const body = await res.json<any>();
      expect(body.success).toBe(true);
      expect(body.data.slug).toBe("test-slug");
      expect(body.data.type).toBe("link");
      expect(body.data.link).toEqual(link);
      // hits should be reported as +1 (optimistic)
      expect(body.data.hits).toBe(6);
    });

    it("returns share data for a valid markdown share", async () => {
      const share = makeShare({ type: "markdown", hits: 0 });
      const markdown = { content: "# Hello" };
      const db = createMockDB({ share, markdown });
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/data/test-slug", env, ctx);
      expect(res.status).toBe(200);

      const body = await res.json<any>();
      expect(body.success).toBe(true);
      expect(body.data.type).toBe("markdown");
      expect(body.data.markdown).toEqual(markdown);
      expect(body.data.hits).toBe(1);
    });

    it("returns 404 for non-existent slug", async () => {
      const db = createMockDB(); // no share data
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/data/nonexistent", env, ctx);
      expect(res.status).toBe(404);

      const body = await res.json<any>();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("returns 410 for expired share", async () => {
      const share = makeShare({ expires_at: "2020-01-01T00:00:00Z" });
      const db = createMockDB({ share });
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/data/test-slug", env, ctx);
      expect(res.status).toBe(410);

      const body = await res.json<any>();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("EXPIRED");
    });

    it("returns 410 when max_hits is reached", async () => {
      const share = makeShare({ max_hits: 10, hits: 10 });
      const db = createMockDB({ share });
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/data/test-slug", env, ctx);
      expect(res.status).toBe(410);

      const body = await res.json<any>();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("MAX_HITS");
    });

    it("increments hits via executionCtx.waitUntil", async () => {
      const share = makeShare({ type: "link", id: "share-42" });
      const link = { url: "https://example.com" };
      const db = createMockDB({ share, link });
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      await request(app, "/data/test-slug", env, ctx);

      expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
      // The argument should be a promise (from db.prepare(...).bind(...).run())
      expect(ctx.waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
    });

    it("returns gallery data with images", async () => {
      const share = makeShare({ type: "gallery" });
      const gallery = { id: "gallery-1" };
      const images = [
        { id: "img-1", filename: "a.png", content_type: "image/png", size: 100, r2_key: "key1", sort_order: 0, caption: null },
        { id: "img-2", filename: "b.jpg", content_type: "image/jpeg", size: 200, r2_key: "key2", sort_order: 1, caption: "Nice" },
      ];
      const db = createMockDB({ share, gallery, images });
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/data/test-slug", env, ctx);
      expect(res.status).toBe(200);

      const body = await res.json<any>();
      expect(body.data.type).toBe("gallery");
      expect(body.data.gallery).toEqual(gallery);
      expect(body.data.images).toHaveLength(2);
    });

    it("returns code data with language and filename", async () => {
      const share = makeShare({ type: "code" });
      const code = { content: "console.log('hi')", language: "javascript", filename: "test.js" };
      const db = createMockDB({ share, code });
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/data/test-slug", env, ctx);
      expect(res.status).toBe(200);

      const body = await res.json<any>();
      expect(body.data.type).toBe("code");
      expect(body.data.code).toEqual(code);
    });
  });

  // =========================================================================
  // GET /:slug
  // =========================================================================
  describe("GET /:slug", () => {
    it("redirects to URL for a valid link share", async () => {
      const share = makeShare({ type: "link" });
      const link = { url: "https://example.com/target" };
      const db = createMockDB({ share, link });
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug", env, ctx);
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("https://example.com/target");
    });

    it("increments hits on link redirect", async () => {
      const share = makeShare({ type: "link", id: "share-99" });
      const link = { url: "https://example.com/target" };
      const db = createMockDB({ share, link });
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      await request(app, "/test-slug", env, ctx);
      expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    });

    it("serves SPA for non-link share types", async () => {
      const share = makeShare({ type: "markdown" });
      const db = createMockDB({ share });
      const mockAssets = createMockAssets();
      const env = buildEnv({ DB: db, ASSETS: mockAssets });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug", env, ctx);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("<html>SPA</html>");
      expect(mockAssets.fetch).toHaveBeenCalledTimes(1);
    });

    it("serves SPA for non-existent share", async () => {
      const db = createMockDB();
      const mockAssets = createMockAssets();
      const env = buildEnv({ DB: db, ASSETS: mockAssets });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/nonexistent", env, ctx);
      expect(res.status).toBe(200);
      expect(mockAssets.fetch).toHaveBeenCalledTimes(1);
    });

    it("serves SPA for expired link share (no redirect)", async () => {
      const share = makeShare({ type: "link", expires_at: "2020-01-01T00:00:00Z" });
      const db = createMockDB({ share });
      const mockAssets = createMockAssets();
      const env = buildEnv({ DB: db, ASSETS: mockAssets });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug", env, ctx);
      // resolveShare returns null for expired → ASSETS.fetch
      expect(res.status).toBe(200);
      expect(mockAssets.fetch).toHaveBeenCalledTimes(1);
    });

    it("serves SPA for max_hits-exceeded link share (no redirect)", async () => {
      const share = makeShare({ type: "link", max_hits: 5, hits: 5 });
      const db = createMockDB({ share });
      const mockAssets = createMockAssets();
      const env = buildEnv({ DB: db, ASSETS: mockAssets });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug", env, ctx);
      expect(res.status).toBe(200);
      expect(mockAssets.fetch).toHaveBeenCalledTimes(1);
    });

    it("serves SPA when link share has no link data", async () => {
      // Edge case: share type is link but link_shares row is missing
      const share = makeShare({ type: "link" });
      const db = createMockDB({ share, link: null });
      const mockAssets = createMockAssets();
      const env = buildEnv({ DB: db, ASSETS: mockAssets });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug", env, ctx);
      // linkData is null → falls through to ASSETS.fetch
      expect(res.status).toBe(200);
      expect(mockAssets.fetch).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // GET /:slug/raw
  // =========================================================================
  describe("GET /:slug/raw", () => {
    it("returns text/plain content for markdown share", async () => {
      const share = makeShare({ type: "markdown" });
      const markdown = { content: "# Hello World" };
      const db = createMockDB({ share, markdown });
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug/raw", env, ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
      expect(await res.text()).toBe("# Hello World");
    });

    it("returns text/plain content for code share", async () => {
      const share = makeShare({ type: "code" });
      const code = { content: "fn main() {}" };
      const db = createMockDB({ share, code });
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug/raw", env, ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
      expect(await res.text()).toBe("fn main() {}");
    });

    it("returns empty string when markdown content is null", async () => {
      const share = makeShare({ type: "markdown" });
      const db = createMockDB({ share, markdown: null });
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug/raw", env, ctx);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("");
    });

    it("returns 400 for file share", async () => {
      const share = makeShare({ type: "file" });
      const db = createMockDB({ share });
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug/raw", env, ctx);
      expect(res.status).toBe(400);

      const body = await res.json<any>();
      expect(body.error.code).toBe("UNSUPPORTED");
    });

    it("returns 400 for link share", async () => {
      const share = makeShare({ type: "link" });
      const db = createMockDB({ share });
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug/raw", env, ctx);
      expect(res.status).toBe(400);

      const body = await res.json<any>();
      expect(body.error.code).toBe("UNSUPPORTED");
    });

    it("returns 404 for non-existent slug", async () => {
      const db = createMockDB();
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/nonexistent/raw", env, ctx);
      expect(res.status).toBe(404);

      const body = await res.json<any>();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("returns 410 for expired share", async () => {
      const share = makeShare({ type: "markdown", expires_at: "2020-01-01T00:00:00Z" });
      const db = createMockDB({ share });
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug/raw", env, ctx);
      expect(res.status).toBe(410);

      const body = await res.json<any>();
      expect(body.error.code).toBe("EXPIRED");
    });

    it("returns 410 for max_hits reached share", async () => {
      const share = makeShare({ type: "code", max_hits: 3, hits: 3 });
      const db = createMockDB({ share });
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug/raw", env, ctx);
      expect(res.status).toBe(410);

      const body = await res.json<any>();
      expect(body.error.code).toBe("MAX_HITS");
    });
  });

  // =========================================================================
  // GET /:slug/download
  // =========================================================================
  describe("GET /:slug/download", () => {
    it("returns binary response with Content-Disposition for file share", async () => {
      const share = makeShare({ type: "file" });
      const file = { filename: "  document.pdf  ", content_type: "  application/pdf  ", r2_key: "  user-1/abc.pdf  " };
      const mockR2 = createMockR2();
      const db = createMockDB({ share, file });
      const env = buildEnv({ DB: db, R2: mockR2 });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug/download", env, ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="document.pdf"');
      expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
      // R2 should be called with the trimmed key
      expect(mockR2.get).toHaveBeenCalledWith("user-1/abc.pdf");
    });

    it("uses application/octet-stream when content_type is empty", async () => {
      const share = makeShare({ type: "file" });
      const file = { filename: "data.bin", content_type: "   ", r2_key: "user-1/data.bin" };
      const db = createMockDB({ share, file });
      const env = buildEnv({ DB: db, R2: createMockR2() });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug/download", env, ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    });

    it("sanitizes special characters in filename for Content-Disposition", async () => {
      const share = makeShare({ type: "file" });
      const file = { filename: 'file"with\\quotes.txt', content_type: "text/plain", r2_key: "user-1/file.txt" };
      const db = createMockDB({ share, file });
      const env = buildEnv({ DB: db, R2: createMockR2() });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug/download", env, ctx);
      expect(res.status).toBe(200);
      // Quotes and backslashes replaced with underscores
      expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="file_with_quotes.txt"');
    });

    it("returns 400 for non-file share type", async () => {
      const share = makeShare({ type: "markdown" });
      const db = createMockDB({ share });
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug/download", env, ctx);
      expect(res.status).toBe(400);

      const body = await res.json<any>();
      expect(body.error.code).toBe("UNSUPPORTED");
    });

    it("returns 404 for non-existent slug", async () => {
      const db = createMockDB();
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug/download", env, ctx);
      expect(res.status).toBe(404);

      const body = await res.json<any>();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("returns 410 for expired file share", async () => {
      const share = makeShare({ type: "file", expires_at: "2020-01-01T00:00:00Z" });
      const db = createMockDB({ share });
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug/download", env, ctx);
      expect(res.status).toBe(410);

      const body = await res.json<any>();
      expect(body.error.code).toBe("EXPIRED");
    });

    it("returns 404 when file data row is missing", async () => {
      const share = makeShare({ type: "file" });
      const db = createMockDB({ share, file: null });
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug/download", env, ctx);
      expect(res.status).toBe(404);

      const body = await res.json<any>();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("returns 404 when R2 object is missing", async () => {
      const share = makeShare({ type: "file" });
      const file = { filename: "doc.pdf", content_type: "application/pdf", r2_key: "user-1/doc.pdf" };
      const db = createMockDB({ share, file });
      const mockR2 = createMockR2Missing();
      const env = buildEnv({ DB: db, R2: mockR2 });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug/download", env, ctx);
      expect(res.status).toBe(404);

      const body = await res.json<any>();
      expect(body.error.message).toBe("File not found in storage");
    });
  });

  // =========================================================================
  // GET /:slug/image/:imageId
  // =========================================================================
  describe("GET /:slug/image/:imageId", () => {
    it("returns binary image with correct Content-Type for gallery image", async () => {
      const share = makeShare({ type: "gallery" });
      const image = { filename: "photo.png", content_type: "image/png", r2_key: "user-1/photo.png" };
      const mockR2 = createMockR2();
      const db = createMockDB({ share, image });
      const env = buildEnv({ DB: db, R2: mockR2 });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug/image/img-1", env, ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
      expect(mockR2.get).toHaveBeenCalledWith("user-1/photo.png");
    });

    it("returns 400 for non-gallery share", async () => {
      const share = makeShare({ type: "file" });
      const db = createMockDB({ share });
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug/image/img-1", env, ctx);
      expect(res.status).toBe(400);

      const body = await res.json<any>();
      expect(body.error.code).toBe("UNSUPPORTED");
    });

    it("returns 404 for non-existent share", async () => {
      const db = createMockDB();
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/nonexistent/image/img-1", env, ctx);
      expect(res.status).toBe(404);

      const body = await res.json<any>();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("returns 404 for non-existent image within a valid gallery", async () => {
      const share = makeShare({ type: "gallery" });
      const db = createMockDB({ share, image: null });
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug/image/missing-img", env, ctx);
      expect(res.status).toBe(404);

      const body = await res.json<any>();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("returns 410 for expired gallery share", async () => {
      const share = makeShare({ type: "gallery", expires_at: "2020-01-01T00:00:00Z" });
      const db = createMockDB({ share });
      const env = buildEnv({ DB: db });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug/image/img-1", env, ctx);
      expect(res.status).toBe(410);

      const body = await res.json<any>();
      expect(body.error.code).toBe("EXPIRED");
    });

    it("returns 404 when R2 object is missing for gallery image", async () => {
      const share = makeShare({ type: "gallery" });
      const image = { filename: "photo.png", content_type: "image/png", r2_key: "user-1/photo.png" };
      const db = createMockDB({ share, image });
      const mockR2 = createMockR2Missing();
      const env = buildEnv({ DB: db, R2: mockR2 });
      const ctx = buildExecutionCtx();

      const res = await request(app, "/test-slug/image/img-1", env, ctx);
      expect(res.status).toBe(404);

      const body = await res.json<any>();
      expect(body.error.message).toBe("Image not found in storage");
    });
  });
});
