import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

const TEST_USER_ID = "test-user-123";

vi.mock("../middleware/auth", () => ({
  requireAuth: createMiddleware(async (c, next) => {
    c.set("userId", TEST_USER_ID);
    await next();
  }),
}));

// Mock @simplewebauthn/server
const mockGenerateRegistrationOptions = vi.fn();
const mockVerifyRegistrationResponse = vi.fn();

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: (...args: unknown[]) => mockGenerateRegistrationOptions(...args),
  verifyRegistrationResponse: (...args: unknown[]) => mockVerifyRegistrationResponse(...args),
}));

import passkeys from "./passkeys";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockFirst = vi.fn();
const mockAll = vi.fn();
const mockRun = vi.fn();
const mockBind = vi.fn();

const mockKV = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

const mockDB = {
  prepare: vi.fn().mockReturnValue({
    bind: mockBind.mockReturnValue({
      first: mockFirst,
      all: mockAll,
      run: mockRun,
    }),
  }),
};

function createEnv() {
  return {
    DB: mockDB,
    KV: mockKV,
    R2: {},
    ASSETS: {},
    ENVIRONMENT: "test",
    APP_NAME: "OWG Share Test",
    RP_ID: "localhost",
    RP_ORIGIN: "http://localhost:5173",
  };
}

function createApp() {
  const app = new Hono();
  app.route("/passkeys", passkeys);
  return app;
}

function makeRequest(path: string, options: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, options);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Passkey routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFirst.mockResolvedValue(null);
    mockAll.mockResolvedValue({ results: [] });
    mockRun.mockResolvedValue({ meta: { changes: 1 } });
    mockBind.mockReturnValue({
      first: mockFirst,
      all: mockAll,
      run: mockRun,
    });
  });

  // =========================================================================
  // GET /
  // =========================================================================
  describe("GET /", () => {
    it("returns list of passkeys", async () => {
      const fakePasskeys = [
        {
          id: "cred-1",
          name: "MacBook",
          device_type: "multiDevice",
          backed_up: 1,
          transports: '["internal"]',
          created_at: "2025-01-01T00:00:00Z",
          last_used_at: "2025-03-01T00:00:00Z",
        },
        {
          id: "cred-2",
          name: "YubiKey",
          device_type: "singleDevice",
          backed_up: 0,
          transports: '["usb"]',
          created_at: "2025-02-01T00:00:00Z",
          last_used_at: null,
        },
      ];
      mockAll.mockResolvedValue({ results: fakePasskeys });

      const app = createApp();
      const res = await app.fetch(makeRequest("/passkeys"), createEnv());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);
      expect(body.data[0].name).toBe("MacBook");
      expect(body.data[1].name).toBe("YubiKey");
    });

    it("returns empty list when no passkeys", async () => {
      mockAll.mockResolvedValue({ results: [] });

      const app = createApp();
      const res = await app.fetch(makeRequest("/passkeys"), createEnv());
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });
  });

  // =========================================================================
  // PUT /:id
  // =========================================================================
  describe("PUT /:id (rename)", () => {
    it("renames a passkey", async () => {
      mockRun.mockResolvedValue({ meta: { changes: 1 } });

      const app = createApp();
      const req = makeRequest("/passkeys/cred-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Work Laptop" }),
      });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.updated).toBe(true);
      expect(mockBind).toHaveBeenCalledWith("Work Laptop", "cred-1", TEST_USER_ID);
    });

    it("returns error for empty name", async () => {
      const app = createApp();
      const req = makeRequest("/passkeys/cred-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "" }),
      });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 404 for non-existent passkey", async () => {
      mockRun.mockResolvedValue({ meta: { changes: 0 } });

      const app = createApp();
      const req = makeRequest("/passkeys/nonexistent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Name" }),
      });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  // =========================================================================
  // DELETE /:id
  // =========================================================================
  describe("DELETE /:id", () => {
    it("deletes a passkey when more than one exists", async () => {
      mockFirst.mockResolvedValue({ count: 2 });
      mockRun.mockResolvedValue({ meta: { changes: 1 } });

      const app = createApp();
      const req = makeRequest("/passkeys/cred-to-delete", { method: "DELETE" });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.deleted).toBe(true);
    });

    it("prevents deleting the last passkey", async () => {
      mockFirst.mockResolvedValue({ count: 1 });

      const app = createApp();
      const req = makeRequest("/passkeys/last-cred", { method: "DELETE" });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error.code).toBe("LAST_PASSKEY");
    });

    it("returns 404 for non-existent passkey", async () => {
      mockFirst.mockResolvedValue({ count: 2 });
      mockRun.mockResolvedValue({ meta: { changes: 0 } });

      const app = createApp();
      const req = makeRequest("/passkeys/ghost", { method: "DELETE" });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  // =========================================================================
  // POST /register/options
  // =========================================================================
  describe("POST /register/options", () => {
    it("returns registration options for adding a new passkey", async () => {
      mockFirst.mockResolvedValue({ username: "testuser" });
      mockAll.mockResolvedValue({ results: [{ id: "existing-cred", transports: '["internal"]' }] });

      mockGenerateRegistrationOptions.mockResolvedValue({
        challenge: "new-challenge",
        rp: { name: "OWG Share Test" },
      });

      const app = createApp();
      const req = makeRequest("/passkeys/register/options", { method: "POST" });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.challenge).toBe("new-challenge");
      expect(mockKV.put).toHaveBeenCalledOnce();

      // Verify excludeCredentials was passed
      const regCall = mockGenerateRegistrationOptions.mock.calls[0][0];
      expect(regCall.excludeCredentials).toHaveLength(1);
      expect(regCall.excludeCredentials[0].id).toBe("existing-cred");
    });

    it("returns 404 when user not found", async () => {
      mockFirst.mockResolvedValue(null);

      const app = createApp();
      const req = makeRequest("/passkeys/register/options", { method: "POST" });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  // =========================================================================
  // POST /register/verify
  // =========================================================================
  describe("POST /register/verify", () => {
    it("registers a new passkey on successful verification", async () => {
      mockKV.get.mockResolvedValue(JSON.stringify({ challenge: "stored-challenge" }));

      mockVerifyRegistrationResponse.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: "new-cred-id",
            publicKey: new Uint8Array([4, 5, 6]),
            counter: 0,
            transports: ["usb"],
          },
          credentialDeviceType: "singleDevice",
          credentialBackedUp: false,
        },
      });

      const app = createApp();
      const req = makeRequest("/passkeys/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credential: { id: "new-cred-id", response: {} },
          name: "YubiKey 5C",
        }),
      });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.verified).toBe(true);
      expect(body.data.id).toBe("new-cred-id");
      expect(mockRun).toHaveBeenCalled(); // DB insert
      expect(mockKV.delete).toHaveBeenCalled(); // challenge cleanup
    });

    it("uses default name when none provided", async () => {
      mockKV.get.mockResolvedValue(JSON.stringify({ challenge: "ch" }));

      mockVerifyRegistrationResponse.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: "cred-no-name",
            publicKey: new Uint8Array([1]),
            counter: 0,
            transports: [],
          },
          credentialDeviceType: "multiDevice",
          credentialBackedUp: true,
        },
      });

      const app = createApp();
      const req = makeRequest("/passkeys/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: { id: "cred-no-name", response: {} } }),
      });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(body.data.verified).toBe(true);
      // Verify "New passkey" was used as default name
      const bindCalls = mockBind.mock.calls;
      const insertCall = bindCalls[bindCalls.length - 1];
      expect(insertCall).toContain("New passkey");
    });

    it("returns error when challenge expired", async () => {
      mockKV.get.mockResolvedValue(null);

      const app = createApp();
      const req = makeRequest("/passkeys/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: {} }),
      });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error.code).toBe("CHALLENGE_EXPIRED");
    });

    it("returns error when verification fails", async () => {
      mockKV.get.mockResolvedValue(JSON.stringify({ challenge: "ch" }));
      mockVerifyRegistrationResponse.mockRejectedValue(new Error("Invalid credential"));

      const app = createApp();
      const req = makeRequest("/passkeys/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: {} }),
      });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error.code).toBe("VERIFICATION_FAILED");
    });
  });
});
