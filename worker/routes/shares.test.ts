import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

const TEST_USER_ID = "test-user-123";

// Mock the auth middleware to bypass authentication
vi.mock("../middleware/auth", () => ({
  requireAuth: createMiddleware(async (c, next) => {
    c.set("userId", TEST_USER_ID);
    await next();
  }),
}));

// Import shares after the mock is registered
import shares from "./shares";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockDB {
  prepare: ReturnType<typeof vi.fn>;
  batch: ReturnType<typeof vi.fn>;
  /** Map of SQL substring -> return value (or function of bind params). */
  responses: Map<string, any>;
}

function createMockDB(): MockDB {
  const responses = new Map<string, any>();

  const mockRun = vi.fn().mockResolvedValue({ meta: { changes: 1 } });

  const prepare = vi.fn().mockImplementation((sql: string) => ({
    bind: vi.fn().mockImplementation((...params: any[]) => ({
      first: vi.fn().mockImplementation(async () => {
        for (const [pattern, value] of responses) {
          if (sql.includes(pattern)) {
            return typeof value === "function" ? value(params, sql) : value;
          }
        }
        return null;
      }),
      all: vi.fn().mockImplementation(async () => {
        for (const [pattern, value] of responses) {
          if (sql.includes(pattern)) {
            const result = typeof value === "function" ? value(params, sql) : value;
            return { results: Array.isArray(result) ? result : [] };
          }
        }
        return { results: [] };
      }),
      run: mockRun,
    })),
  }));

  return { prepare, batch: vi.fn().mockResolvedValue([]), responses };
}

function createMockEnv(db: MockDB) {
  return {
    DB: db,
    R2: { delete: vi.fn().mockResolvedValue(undefined), get: vi.fn(), put: vi.fn() },
    KV: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    ASSETS: { fetch: vi.fn() },
    ENVIRONMENT: "test",
    APP_NAME: "owg-share-test",
    RP_ID: "localhost",
    RP_ORIGIN: "http://localhost",
  };
}

function createTestApp() {
  const db = createMockDB();
  const env = createMockEnv(db);

  const app = new Hono();
  app.route("/api/shares", shares);

  return { app, db, env };
}

async function req(
  app: Hono,
  path: string,
  env: ReturnType<typeof createMockEnv>,
  init?: RequestInit,
) {
  return app.request(path, init, env);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("shares routes", () => {
  let app: Hono;
  let db: MockDB;
  let env: ReturnType<typeof createMockEnv>;

  beforeEach(() => {
    vi.clearAllMocks();
    const ctx = createTestApp();
    app = ctx.app;
    db = ctx.db;
    env = ctx.env;
  });

  // -------------------------------------------------------------------------
  // List shares — GET /api/shares
  // -------------------------------------------------------------------------
  describe("GET /api/shares", () => {
    it("returns empty list", async () => {
      // SELECT * returns empty, COUNT returns 0
      db.responses.set("COUNT(*)", { count: 0 });
      // SELECT * … already defaults to { results: [] }

      const res = await req(app, "/api/shares", env);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
      expect(body.meta).toEqual({ total: 0, page: 1, per_page: 20 });
    });

    it("returns shares list with data", async () => {
      const mockShares = [
        { id: "s1", slug: "abc", type: "link", title: "Link 1", hits: 5 },
        { id: "s2", slug: "def", type: "markdown", title: "Note", hits: 0 },
      ];

      // The list route issues two concurrent queries: SELECT * ... and SELECT COUNT(*) ...
      // Both will match COUNT(*) or SELECT * depending on order in the map.
      // We use a function that inspects the SQL to distinguish.
      db.responses.set("FROM shares WHERE user_id", (params: any[], sql: string) => {
        if (sql.includes("COUNT(*)")) return { count: 2 };
        return mockShares;
      });

      const res = await req(app, "/api/shares", env);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual(mockShares);
      expect(body.meta.total).toBe(2);
    });

    it("applies type filter", async () => {
      db.responses.set("FROM shares WHERE user_id", (params: any[], sql: string) => {
        if (sql.includes("COUNT(*)")) return { count: 1 };
        return [{ id: "s1", type: "link", slug: "abc" }];
      });

      const res = await req(app, "/api/shares?type=link", env);
      expect(res.status).toBe(200);

      // Verify the SQL included the type filter
      const prepareCalls = db.prepare.mock.calls.map((c: any[]) => c[0]);
      expect(prepareCalls.some((sql: string) => sql.includes("AND type = ?"))).toBe(true);
    });

    it("applies search filter", async () => {
      db.responses.set("FROM shares WHERE user_id", (params: any[], sql: string) => {
        if (sql.includes("COUNT(*)")) return { count: 0 };
        return [];
      });

      const res = await req(app, "/api/shares?search=hello", env);
      expect(res.status).toBe(200);

      const prepareCalls = db.prepare.mock.calls.map((c: any[]) => c[0]);
      expect(prepareCalls.some((sql: string) => sql.includes("title LIKE"))).toBe(true);
    });

    it("applies pagination", async () => {
      db.responses.set("FROM shares WHERE user_id", (params: any[], sql: string) => {
        if (sql.includes("COUNT(*)")) return { count: 50 };
        return [];
      });

      const res = await req(app, "/api/shares?page=3&per_page=10", env);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.meta).toEqual({ total: 50, page: 3, per_page: 10 });
    });

    it("caps per_page at 100", async () => {
      db.responses.set("FROM shares WHERE user_id", (params: any[], sql: string) => {
        if (sql.includes("COUNT(*)")) return { count: 0 };
        return [];
      });

      const res = await req(app, "/api/shares?per_page=500", env);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.meta.per_page).toBe(100);
    });
  });

  // -------------------------------------------------------------------------
  // Get share by ID — GET /api/shares/:id
  // -------------------------------------------------------------------------
  describe("GET /api/shares/:id", () => {
    it("returns share with type-specific data for a link share", async () => {
      const mockShare = {
        id: "share-1",
        user_id: TEST_USER_ID,
        slug: "abc123",
        type: "link",
        title: "My Link",
        comment: null,
        encrypted: 0,
        hits: 3,
      };

      db.responses.set("FROM shares WHERE id", mockShare);
      db.responses.set("FROM link_shares WHERE share_id", { url: "https://example.com" });

      const res = await req(app, "/api/shares/share-1", env);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe("share-1");
      expect(body.data.link).toEqual({ url: "https://example.com" });
    });

    it("returns share with markdown type data", async () => {
      const mockShare = {
        id: "share-md",
        user_id: TEST_USER_ID,
        slug: "mdslug",
        type: "markdown",
        title: "Note",
        comment: null,
        encrypted: 0,
        hits: 0,
      };

      db.responses.set("FROM shares WHERE id", mockShare);
      db.responses.set("FROM markdown_shares WHERE share_id", { content: "# Hello" });

      const res = await req(app, "/api/shares/share-md", env);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.markdown).toEqual({ content: "# Hello" });
    });

    it("returns share with code type data", async () => {
      const mockShare = {
        id: "share-code",
        user_id: TEST_USER_ID,
        slug: "codeslug",
        type: "code",
        title: "Snippet",
        comment: null,
        encrypted: 0,
        hits: 0,
      };

      db.responses.set("FROM shares WHERE id", mockShare);
      db.responses.set("FROM code_shares WHERE share_id", {
        content: "console.log('hi')",
        language: "javascript",
        filename: "hello.js",
      });

      const res = await req(app, "/api/shares/share-code", env);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.code).toEqual({
        content: "console.log('hi')",
        language: "javascript",
        filename: "hello.js",
      });
    });

    it("returns share with file type data", async () => {
      const mockShare = {
        id: "share-file",
        user_id: TEST_USER_ID,
        slug: "fileslug",
        type: "file",
        title: null,
        comment: null,
        encrypted: 0,
        hits: 0,
      };

      db.responses.set("FROM shares WHERE id", mockShare);
      db.responses.set("FROM file_shares WHERE share_id", {
        filename: "photo.png",
        content_type: "image/png",
        size: 1024,
        r2_key: `${TEST_USER_ID}/photo.png`,
      });

      const res = await req(app, "/api/shares/share-file", env);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.file.filename).toBe("photo.png");
    });

    it("returns 404 when share not found", async () => {
      // No response set, so first() returns null
      const res = await req(app, "/api/shares/nonexistent", env);
      expect(res.status).toBe(404);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  // -------------------------------------------------------------------------
  // Delete share — DELETE /api/shares/:id
  // -------------------------------------------------------------------------
  describe("DELETE /api/shares/:id", () => {
    it("deletes a non-file share successfully", async () => {
      const mockShare = {
        id: "share-del",
        user_id: TEST_USER_ID,
        slug: "delme",
        type: "link",
        title: null,
        comment: null,
      };

      db.responses.set("FROM shares WHERE id", mockShare);

      const res = await req(app, "/api/shares/share-del", env, { method: "DELETE" });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.deleted).toBe(true);
    });

    it("returns 404 when share does not exist", async () => {
      const res = await req(app, "/api/shares/nope", env, { method: "DELETE" });
      expect(res.status).toBe(404);

      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("deletes R2 object for file shares", async () => {
      const mockShare = {
        id: "share-file-del",
        user_id: TEST_USER_ID,
        slug: "filedel",
        type: "file",
      };

      db.responses.set("FROM shares WHERE id", mockShare);
      db.responses.set("FROM file_shares WHERE share_id", {
        r2_key: `${TEST_USER_ID}/uploads/doc.pdf`,
      });

      const res = await req(app, "/api/shares/share-file-del", env, { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(env.R2.delete).toHaveBeenCalledWith(`${TEST_USER_ID}/uploads/doc.pdf`);
    });

    it("deletes R2 objects for gallery shares", async () => {
      const mockShare = {
        id: "share-gallery-del",
        user_id: TEST_USER_ID,
        slug: "gallerydel",
        type: "gallery",
      };

      db.responses.set("FROM shares WHERE id", mockShare);
      db.responses.set("FROM gallery_shares WHERE share_id", { id: "gallery-1" });
      db.responses.set("FROM gallery_images WHERE gallery_id", [
        { r2_key: `${TEST_USER_ID}/img1.jpg` },
        { r2_key: `${TEST_USER_ID}/img2.jpg` },
      ]);

      const res = await req(app, "/api/shares/share-gallery-del", env, { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(env.R2.delete).toHaveBeenCalledWith(`${TEST_USER_ID}/img1.jpg`);
      expect(env.R2.delete).toHaveBeenCalledWith(`${TEST_USER_ID}/img2.jpg`);
    });
  });

  // -------------------------------------------------------------------------
  // Stats — GET /api/shares/stats/summary
  // -------------------------------------------------------------------------
  describe("GET /api/shares/stats/summary", () => {
    it("returns stats summary", async () => {
      db.responses.set("FROM shares WHERE user_id", (params: any[], sql: string) => {
        if (sql.includes("COUNT(*)") && sql.includes("GROUP BY type")) {
          return [
            { type: "link", count: 5 },
            { type: "markdown", count: 3 },
          ];
        }
        if (sql.includes("COUNT(*)")) return { count: 8 };
        if (sql.includes("SUM(hits)")) return { total: 42 };
        return null;
      });

      const res = await req(app, "/api/shares/stats/summary", env);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.total).toBe(8);
      expect(body.data.totalHits).toBe(42);
      expect(body.data.byType).toEqual({ link: 5, markdown: 3 });
    });

    it("returns zeros when no shares exist", async () => {
      db.responses.set("FROM shares WHERE user_id", (params: any[], sql: string) => {
        if (sql.includes("GROUP BY type")) return [];
        if (sql.includes("COUNT(*)")) return { count: 0 };
        if (sql.includes("SUM(hits)")) return { total: 0 };
        return null;
      });

      const res = await req(app, "/api/shares/stats/summary", env);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.total).toBe(0);
      expect(body.data.totalHits).toBe(0);
      expect(body.data.byType).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // Create link share — POST /api/shares/links
  // -------------------------------------------------------------------------
  describe("POST /api/shares/links", () => {
    it("creates a link share with valid URL", async () => {
      // resolveSlug checks for existing slug — return null (no collision)
      db.responses.set("FROM shares WHERE slug", null);

      const res = await req(app, "/api/shares/links", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      });

      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.type).toBe("link");
      expect(body.data.url).toBe("https://example.com");
      expect(body.data.slug).toBeDefined();
      expect(body.data.id).toBeDefined();
      expect(db.batch).toHaveBeenCalledTimes(1);
    });

    it("returns 400 when URL is missing", async () => {
      const res = await req(app, "/api/shares/links", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toBe("URL is required");
    });

    it("returns 400 for invalid URL", async () => {
      const res = await req(app, "/api/shares/links", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "not-a-url" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toBe("Invalid URL");
    });

    it("creates a link share with title and comment", async () => {
      db.responses.set("FROM shares WHERE slug", null);

      const res = await req(app, "/api/shares/links", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://example.com",
          title: "Example Site",
          comment: "A great resource",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.type).toBe("link");
      expect(db.batch).toHaveBeenCalledTimes(1);
    });

    it("creates a link share with custom slug", async () => {
      db.responses.set("FROM shares WHERE slug", null);

      const res = await req(app, "/api/shares/links", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://example.com",
          slug_type: "custom",
          custom_slug: "my-link",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.slug).toBe("my-link");
    });

    it("returns 409 when custom slug is taken", async () => {
      db.responses.set("FROM shares WHERE slug", { id: "existing-share" });

      const res = await req(app, "/api/shares/links", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://example.com",
          slug_type: "custom",
          custom_slug: "taken-slug",
        }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("SLUG_TAKEN");
    });

    it("returns 400 when custom slug type but no slug provided", async () => {
      const res = await req(app, "/api/shares/links", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://example.com",
          slug_type: "custom",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for reserved custom slug", async () => {
      const res = await req(app, "/api/shares/links", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://example.com",
          slug_type: "custom",
          custom_slug: "api",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // -------------------------------------------------------------------------
  // Update link share — PUT /api/shares/links/:id
  // -------------------------------------------------------------------------
  describe("PUT /api/shares/links/:id", () => {
    it("updates link share fields", async () => {
      db.responses.set("FROM shares WHERE id", { id: "link-1" });

      const res = await req(app, "/api/shares/links/link-1", env, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Updated Title", url: "https://new.example.com" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.updated).toBe(true);
      expect(db.batch).toHaveBeenCalledTimes(1);
    });

    it("returns 404 when link share not found", async () => {
      const res = await req(app, "/api/shares/links/nope", env, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New" }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("returns 400 for invalid URL on update", async () => {
      db.responses.set("FROM shares WHERE id", { id: "link-1" });

      const res = await req(app, "/api/shares/links/link-1", env, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "not-a-url" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // -------------------------------------------------------------------------
  // Create markdown share — POST /api/shares/markdown
  // -------------------------------------------------------------------------
  describe("POST /api/shares/markdown", () => {
    it("creates a markdown share with valid content", async () => {
      db.responses.set("FROM shares WHERE slug", null);

      const res = await req(app, "/api/shares/markdown", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "# Hello World" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.type).toBe("markdown");
      expect(body.data.encrypted).toBe(false);
      expect(body.data.slug).toBeDefined();
      expect(db.batch).toHaveBeenCalledTimes(1);
    });

    it("returns 400 when content is missing", async () => {
      const res = await req(app, "/api/shares/markdown", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toBe("Content is required");
    });

    it("returns 400 when content is empty string", async () => {
      const res = await req(app, "/api/shares/markdown", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("creates encrypted markdown share", async () => {
      db.responses.set("FROM shares WHERE slug", null);

      const res = await req(app, "/api/shares/markdown", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "encrypted content", encrypted: true }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.encrypted).toBe(true);
    });

    it("creates markdown share with title and comment", async () => {
      db.responses.set("FROM shares WHERE slug", null);

      const res = await req(app, "/api/shares/markdown", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "Some content",
          title: "My Note",
          comment: "A private note",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.type).toBe("markdown");
    });
  });

  // -------------------------------------------------------------------------
  // Update markdown share — PUT /api/shares/markdown/:id
  // -------------------------------------------------------------------------
  describe("PUT /api/shares/markdown/:id", () => {
    it("updates markdown share content", async () => {
      db.responses.set("FROM shares WHERE id", { id: "md-1" });

      const res = await req(app, "/api/shares/markdown/md-1", env, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Updated content", title: "New Title" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.updated).toBe(true);
    });

    it("returns 404 when markdown share not found", async () => {
      const res = await req(app, "/api/shares/markdown/missing", env, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "test" }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  // -------------------------------------------------------------------------
  // Create code share — POST /api/shares/code
  // -------------------------------------------------------------------------
  describe("POST /api/shares/code", () => {
    it("creates a code share with valid content", async () => {
      db.responses.set("FROM shares WHERE slug", null);

      const res = await req(app, "/api/shares/code", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "console.log('hello')" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.type).toBe("code");
      expect(body.data.encrypted).toBe(false);
      expect(db.batch).toHaveBeenCalledTimes(1);
    });

    it("creates code share with language and filename", async () => {
      db.responses.set("FROM shares WHERE slug", null);

      const res = await req(app, "/api/shares/code", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "fn main() {}",
          language: "rust",
          filename: "main.rs",
          title: "Rust Example",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.type).toBe("code");
    });

    it("returns 400 when content is missing", async () => {
      const res = await req(app, "/api/shares/code", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toBe("Content is required");
    });

    it("returns 400 when content is empty string", async () => {
      const res = await req(app, "/api/shares/code", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("creates encrypted code share", async () => {
      db.responses.set("FROM shares WHERE slug", null);

      const res = await req(app, "/api/shares/code", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "secret code", encrypted: true }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.encrypted).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Update code share — PUT /api/shares/code/:id
  // -------------------------------------------------------------------------
  describe("PUT /api/shares/code/:id", () => {
    it("updates code share content and metadata", async () => {
      db.responses.set("FROM shares WHERE id", { id: "code-1" });

      const res = await req(app, "/api/shares/code/code-1", env, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "updated()",
          language: "python",
          filename: "app.py",
          title: "Updated Code",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.updated).toBe(true);
    });

    it("returns 404 when code share not found", async () => {
      const res = await req(app, "/api/shares/code/nope", env, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "test" }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  // -------------------------------------------------------------------------
  // Create file share — POST /api/shares/files
  // -------------------------------------------------------------------------
  describe("POST /api/shares/files", () => {
    it("creates a file share with valid data", async () => {
      db.responses.set("FROM shares WHERE slug", null);

      const res = await req(app, "/api/shares/files", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "document.pdf",
          content_type: "application/pdf",
          size: 102400,
          r2_key: `${TEST_USER_ID}/uploads/document.pdf`,
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.type).toBe("file");
      expect(body.data.encrypted).toBe(false);
      expect(db.batch).toHaveBeenCalledTimes(1);
    });

    it("returns 403 when r2_key does not start with userId", async () => {
      const res = await req(app, "/api/shares/files", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "document.pdf",
          content_type: "application/pdf",
          size: 102400,
          r2_key: "other-user/uploads/document.pdf",
        }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.message).toBe("Invalid file reference");
    });

    it("returns 400 when required fields are missing", async () => {
      const res = await req(app, "/api/shares/files", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: "test.txt" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toBe("Missing required fields");
    });

    it("returns 400 when filename is missing", async () => {
      const res = await req(app, "/api/shares/files", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_type: "text/plain",
          size: 100,
          r2_key: `${TEST_USER_ID}/file.txt`,
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("creates encrypted file share", async () => {
      db.responses.set("FROM shares WHERE slug", null);

      const res = await req(app, "/api/shares/files", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "secret.zip",
          content_type: "application/zip",
          size: 2048,
          r2_key: `${TEST_USER_ID}/secret.zip`,
          encrypted: true,
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.encrypted).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Update file share — PUT /api/shares/files/:id
  // -------------------------------------------------------------------------
  describe("PUT /api/shares/files/:id", () => {
    it("updates file share metadata", async () => {
      db.responses.set("FROM shares WHERE id", { id: "file-1" });

      const res = await req(app, "/api/shares/files/file-1", env, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Updated File Title", comment: "New comment" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.updated).toBe(true);
    });

    it("returns 404 when file share not found", async () => {
      const res = await req(app, "/api/shares/files/nope", env, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New" }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  // -------------------------------------------------------------------------
  // Create gallery share — POST /api/shares/galleries
  // -------------------------------------------------------------------------
  describe("POST /api/shares/galleries", () => {
    it("creates a gallery share without images", async () => {
      db.responses.set("FROM shares WHERE slug", null);

      const res = await req(app, "/api/shares/galleries", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "My Gallery" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.type).toBe("gallery");
      expect(body.data.galleryId).toBeDefined();
      expect(db.batch).toHaveBeenCalledTimes(1);
    });

    it("creates a gallery share with images", async () => {
      db.responses.set("FROM shares WHERE slug", null);

      const images = [
        {
          filename: "photo1.jpg",
          content_type: "image/jpeg",
          size: 5000,
          r2_key: `${TEST_USER_ID}/photo1.jpg`,
          caption: "First photo",
        },
        {
          filename: "photo2.jpg",
          content_type: "image/jpeg",
          size: 3000,
          r2_key: `${TEST_USER_ID}/photo2.jpg`,
        },
      ];

      const res = await req(app, "/api/shares/galleries", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Vacation", images }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.type).toBe("gallery");

      // batch should be called with 2 base statements + 2 image inserts = 4
      const batchArg = db.batch.mock.calls[0][0];
      expect(batchArg).toHaveLength(4);
    });

    it("returns 403 when image r2_key does not belong to user", async () => {
      const res = await req(app, "/api/shares/galleries", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Bad Gallery",
          images: [
            {
              filename: "stolen.jpg",
              content_type: "image/jpeg",
              size: 1000,
              r2_key: "other-user/stolen.jpg",
            },
          ],
        }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });
  });

  // -------------------------------------------------------------------------
  // Update gallery — PUT /api/shares/galleries/:id
  // -------------------------------------------------------------------------
  describe("PUT /api/shares/galleries/:id", () => {
    it("updates gallery metadata", async () => {
      db.responses.set("FROM shares WHERE id", { id: "gallery-1" });

      const res = await req(app, "/api/shares/galleries/gallery-1", env, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Updated Gallery", comment: "Nice!" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.updated).toBe(true);
    });

    it("returns 404 when gallery not found", async () => {
      const res = await req(app, "/api/shares/galleries/missing", env, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New" }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  // -------------------------------------------------------------------------
  // Add images to gallery — POST /api/shares/galleries/:id/images
  // -------------------------------------------------------------------------
  describe("POST /api/shares/galleries/:id/images", () => {
    it("adds images to an existing gallery", async () => {
      db.responses.set("FROM shares WHERE id", { id: "gallery-1" });
      db.responses.set("FROM gallery_shares WHERE share_id", { id: "gs-1" });
      db.responses.set("MAX(sort_order)", { max_order: 2 });

      const res = await req(app, "/api/shares/galleries/gallery-1/images", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: [
            {
              filename: "new.jpg",
              content_type: "image/jpeg",
              size: 4000,
              r2_key: `${TEST_USER_ID}/new.jpg`,
            },
          ],
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.imageIds).toHaveLength(1);
    });

    it("returns 404 when gallery not found", async () => {
      const res = await req(app, "/api/shares/galleries/missing/images", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: [
            {
              filename: "img.jpg",
              content_type: "image/jpeg",
              size: 1000,
              r2_key: `${TEST_USER_ID}/img.jpg`,
            },
          ],
        }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 403 when image r2_key does not belong to user", async () => {
      db.responses.set("FROM shares WHERE id", { id: "gallery-1" });

      const res = await req(app, "/api/shares/galleries/gallery-1/images", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: [
            {
              filename: "bad.jpg",
              content_type: "image/jpeg",
              size: 1000,
              r2_key: "attacker/bad.jpg",
            },
          ],
        }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });
  });

  // -------------------------------------------------------------------------
  // Update gallery image — PUT /api/shares/galleries/:id/images/:imgId
  // -------------------------------------------------------------------------
  describe("PUT /api/shares/galleries/:id/images/:imgId", () => {
    it("updates image caption", async () => {
      db.responses.set("FROM shares WHERE id", { id: "gallery-1" });

      const res = await req(app, "/api/shares/galleries/gallery-1/images/img-1", env, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: "Beautiful sunset" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.updated).toBe(true);
    });

    it("returns 404 when gallery not found", async () => {
      const res = await req(app, "/api/shares/galleries/nope/images/img-1", env, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: "test" }),
      });

      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // Delete gallery image — DELETE /api/shares/galleries/:id/images/:imgId
  // -------------------------------------------------------------------------
  describe("DELETE /api/shares/galleries/:id/images/:imgId", () => {
    it("deletes a gallery image and its R2 object", async () => {
      db.responses.set("FROM shares WHERE id", { id: "gallery-1" });
      db.responses.set("gallery_images gi JOIN gallery_shares gs", {
        r2_key: `${TEST_USER_ID}/gallery/img1.jpg`,
      });

      const res = await req(app, "/api/shares/galleries/gallery-1/images/img-1", env, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.deleted).toBe(true);
      expect(env.R2.delete).toHaveBeenCalledWith(`${TEST_USER_ID}/gallery/img1.jpg`);
    });

    it("returns 404 when gallery not found", async () => {
      const res = await req(app, "/api/shares/galleries/missing/images/img-1", env, {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });

    it("succeeds even when image not found in gallery (no-op)", async () => {
      db.responses.set("FROM shares WHERE id", { id: "gallery-1" });
      // No response for the image join query -> returns null

      const res = await req(app, "/api/shares/galleries/gallery-1/images/nonexistent", env, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.deleted).toBe(true);
      // R2 should not be called since image was not found
      expect(env.R2.delete).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Reorder gallery images — POST /api/shares/galleries/:id/reorder
  // -------------------------------------------------------------------------
  describe("POST /api/shares/galleries/:id/reorder", () => {
    it("reorders gallery images", async () => {
      db.responses.set("FROM shares WHERE id", { id: "gallery-1" });

      const res = await req(app, "/api/shares/galleries/gallery-1/reorder", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds: ["img-3", "img-1", "img-2"] }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.reordered).toBe(true);
      expect(db.batch).toHaveBeenCalledTimes(1);

      // batch receives 3 update statements
      const batchArg = db.batch.mock.calls[0][0];
      expect(batchArg).toHaveLength(3);
    });

    it("returns 404 when gallery not found", async () => {
      const res = await req(app, "/api/shares/galleries/missing/reorder", env, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds: ["img-1"] }),
      });

      expect(res.status).toBe(404);
    });
  });
});
