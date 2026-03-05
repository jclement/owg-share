import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

vi.mock("../middleware/auth", () => ({
  requireAuth: createMiddleware(async (c, next) => {
    c.set("userId", "test-user-123");
    await next();
  }),
}));

import apikeys from "./apikeys";

// --- Mocks ---

const mockRun = vi.fn();
const mockAll = vi.fn();
const mockFirst = vi.fn();
const mockBind = vi.fn();

const mockDB = {
  prepare: vi.fn().mockReturnValue({
    bind: mockBind.mockReturnValue({
      all: mockAll,
      first: mockFirst,
      run: mockRun,
    }),
  }),
};

const mockKV = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

const mockR2 = {
  put: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};

function createApp() {
  const app = new Hono();
  app.route("/apikeys", apikeys);
  return app;
}

function makeRequest(path: string, options: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, options);
}

// --- Tests ---

describe("API Key routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAll.mockResolvedValue({ results: [] });
    mockFirst.mockResolvedValue(null);
    mockRun.mockResolvedValue({ meta: { changes: 0 } });
    mockBind.mockReturnValue({
      all: mockAll,
      first: mockFirst,
      run: mockRun,
    });
  });

  // =========================================================================
  // GET /
  // =========================================================================
  describe("GET /", () => {
    it("returns list of API keys", async () => {
      const fakeKeys = [
        {
          id: "key-1",
          name: "My Key",
          key_prefix: "owgs_abcdef12",
          expires_at: null,
          last_used_at: null,
          last_used_ip: null,
          created_at: "2025-01-01T00:00:00Z",
        },
        {
          id: "key-2",
          name: "Another Key",
          key_prefix: "owgs_99887766",
          expires_at: "2026-06-01T00:00:00Z",
          last_used_at: "2025-03-01T12:00:00Z",
          last_used_ip: "1.2.3.4",
          created_at: "2025-02-15T00:00:00Z",
        },
      ];
      mockAll.mockResolvedValue({ results: fakeKeys });

      const app = createApp();
      const req = makeRequest("/apikeys");

      const res = await app.fetch(req, { KV: mockKV, R2: mockR2, DB: mockDB });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);
      expect(body.data[0].id).toBe("key-1");
      expect(body.data[1].name).toBe("Another Key");

      // Should query with the authenticated user's id
      expect(mockDB.prepare).toHaveBeenCalledOnce();
      expect(mockBind).toHaveBeenCalledWith("test-user-123");
    });

    it("returns empty list when user has no API keys", async () => {
      mockAll.mockResolvedValue({ results: [] });

      const app = createApp();
      const req = makeRequest("/apikeys");

      const res = await app.fetch(req, { KV: mockKV, R2: mockR2, DB: mockDB });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });
  });

  // =========================================================================
  // POST /
  // =========================================================================
  describe("POST /", () => {
    it("creates API key and returns 201 with owgs_ prefix", async () => {
      mockRun.mockResolvedValue({ meta: { changes: 1 } });

      const app = createApp();
      const req = makeRequest("/apikeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "CI Deploy Key" }),
      });

      const res = await app.fetch(req, { KV: mockKV, R2: mockR2, DB: mockDB });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("CI Deploy Key");
      expect(body.data.key).toMatch(/^owgs_/);
      expect(body.data.key_prefix).toBe(body.data.key.slice(0, 12));
      expect(body.data.id).toBeDefined();

      // DB insert should have been called
      expect(mockDB.prepare).toHaveBeenCalledOnce();
      expect(mockBind).toHaveBeenCalledOnce();
      // Verify the bind args: id, userId, name, keyHash, keyPrefix, expiresAt
      const bindArgs = mockBind.mock.calls[0];
      expect(bindArgs[1]).toBe("test-user-123"); // userId
      expect(bindArgs[2]).toBe("CI Deploy Key"); // name
      expect(bindArgs[5]).toBeNull(); // expires_at (not provided)
    });

    it("returns 400 when name is empty", async () => {
      const app = createApp();
      const req = makeRequest("/apikeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "" }),
      });

      const res = await app.fetch(req, { KV: mockKV, R2: mockR2, DB: mockDB });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // =========================================================================
  // DELETE /:id
  // =========================================================================
  describe("DELETE /:id", () => {
    it("deletes existing API key successfully", async () => {
      mockRun.mockResolvedValue({ meta: { changes: 1 } });

      const app = createApp();
      const req = makeRequest("/apikeys/key-to-delete", {
        method: "DELETE",
      });

      const res = await app.fetch(req, { KV: mockKV, R2: mockR2, DB: mockDB });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);

      // Should bind both key id and userId
      expect(mockBind).toHaveBeenCalledWith("key-to-delete", "test-user-123");
    });

    it("returns 404 for non-existent API key", async () => {
      mockRun.mockResolvedValue({ meta: { changes: 0 } });

      const app = createApp();
      const req = makeRequest("/apikeys/nonexistent-key", {
        method: "DELETE",
      });

      const res = await app.fetch(req, { KV: mockKV, R2: mockR2, DB: mockDB });
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });
});
