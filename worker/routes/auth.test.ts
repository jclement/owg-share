import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

// Mock rate limiter
vi.mock("../middleware/ratelimit", () => ({
  rateLimit: () => createMiddleware(async (_c, next) => next()),
}));

// Mock @simplewebauthn/server
const mockGenerateRegistrationOptions = vi.fn();
const mockVerifyRegistrationResponse = vi.fn();
const mockGenerateAuthenticationOptions = vi.fn();
const mockVerifyAuthenticationResponse = vi.fn();

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: (...args: unknown[]) => mockGenerateRegistrationOptions(...args),
  verifyRegistrationResponse: (...args: unknown[]) => mockVerifyRegistrationResponse(...args),
  generateAuthenticationOptions: (...args: unknown[]) => mockGenerateAuthenticationOptions(...args),
  verifyAuthenticationResponse: (...args: unknown[]) => mockVerifyAuthenticationResponse(...args),
}));

import auth from "./auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockKV = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

const mockFirst = vi.fn();
const mockAll = vi.fn();
const mockRun = vi.fn();
const mockBind = vi.fn();
const mockBatch = vi.fn();

const mockDB = {
  prepare: vi.fn().mockReturnValue({
    bind: mockBind.mockReturnValue({
      first: mockFirst,
      all: mockAll,
      run: mockRun,
    }),
    first: mockFirst,
  }),
  batch: mockBatch,
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
  app.route("/auth", auth);
  return app;
}

function makeRequest(path: string, options: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, options);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Auth routes", () => {
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
    mockBatch.mockResolvedValue([]);
  });

  // =========================================================================
  // GET /status
  // =========================================================================
  describe("GET /status", () => {
    it("returns needsSetup=true when no users exist", async () => {
      mockFirst.mockResolvedValue({ count: 0 });

      const app = createApp();
      const res = await app.fetch(makeRequest("/auth/status"), createEnv());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.needsSetup).toBe(true);
      expect(body.data.authenticated).toBe(false);
      expect(body.data.appName).toBe("OWG Share Test");
    });

    it("returns authenticated=false when no session cookie", async () => {
      mockFirst.mockResolvedValue({ count: 1 });

      const app = createApp();
      const res = await app.fetch(makeRequest("/auth/status"), createEnv());
      const body = await res.json();

      expect(body.data.authenticated).toBe(false);
      expect(body.data.needsSetup).toBe(false);
      expect(body.data.appName).toBe("OWG Share Test");
    });

    it("returns authenticated=true with valid session cookie", async () => {
      // First call: user count. Second call: user lookup.
      const userCountResponse = { count: 1 };
      const userResponse = { id: "user-1", username: "testuser", created_at: "2025-01-01" };

      mockFirst
        .mockResolvedValueOnce(userCountResponse)  // COUNT query
        .mockResolvedValueOnce(userResponse);       // user lookup

      // Mock KV session lookup
      mockKV.get.mockResolvedValue(JSON.stringify({
        userId: "user-1",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      }));

      const app = createApp();
      const req = makeRequest("/auth/status", {
        headers: { Cookie: "session=valid-token-123" },
      });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(body.data.authenticated).toBe(true);
      expect(body.data.user.username).toBe("testuser");
    });

    it("returns authenticated=false with expired session", async () => {
      mockFirst.mockResolvedValue({ count: 1 });

      // Expired session
      mockKV.get.mockResolvedValue(JSON.stringify({
        userId: "user-1",
        createdAt: "2024-01-01T00:00:00Z",
        expiresAt: "2024-01-02T00:00:00Z",
      }));

      const app = createApp();
      const req = makeRequest("/auth/status", {
        headers: { Cookie: "session=expired-token" },
      });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(body.data.authenticated).toBe(false);
    });
  });

  // =========================================================================
  // POST /register/options
  // =========================================================================
  describe("POST /register/options", () => {
    it("returns registration options for first user", async () => {
      mockFirst
        .mockResolvedValueOnce({ count: 0 })  // user count
        .mockResolvedValueOnce(null);          // username check

      mockGenerateRegistrationOptions.mockResolvedValue({
        challenge: "test-challenge-abc",
        rp: { name: "OWG Share Test", id: "localhost" },
      });

      const app = createApp();
      const req = makeRequest("/auth/register/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "newuser" }),
      });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.challenge).toBe("test-challenge-abc");
      expect(body.data.userId).toBeDefined();
      expect(mockKV.put).toHaveBeenCalledOnce();
    });

    it("returns error when username is empty", async () => {
      const app = createApp();
      const req = makeRequest("/auth/register/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "" }),
      });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 401 for non-first user without auth", async () => {
      mockFirst.mockResolvedValue({ count: 1 });

      const app = createApp();
      const req = makeRequest("/auth/register/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "seconduser" }),
      });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("returns 409 when username is taken", async () => {
      mockFirst
        .mockResolvedValueOnce({ count: 0 })    // user count
        .mockResolvedValueOnce({ id: "exist" }); // username exists

      const app = createApp();
      const req = makeRequest("/auth/register/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "taken" }),
      });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.error.code).toBe("USERNAME_TAKEN");
    });
  });

  // =========================================================================
  // POST /register/verify
  // =========================================================================
  describe("POST /register/verify", () => {
    it("creates user and session on successful verification", async () => {
      mockKV.get.mockResolvedValue(JSON.stringify({
        challenge: "stored-challenge",
        username: "newuser",
      }));

      mockVerifyRegistrationResponse.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: "cred-id-123",
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
            transports: ["internal"],
          },
          credentialDeviceType: "multiDevice",
          credentialBackedUp: true,
        },
      });

      const app = createApp();
      const req = makeRequest("/auth/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "new-user-id",
          credential: { id: "cred-id-123", response: {} },
        }),
      });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.verified).toBe(true);
      expect(res.headers.get("Set-Cookie")).toContain("session=");
      expect(res.headers.get("Set-Cookie")).toContain("HttpOnly");
      expect(mockBatch).toHaveBeenCalledOnce();
      expect(mockKV.delete).toHaveBeenCalled(); // challenge cleanup
    });

    it("returns error when challenge is expired", async () => {
      mockKV.get.mockResolvedValue(null);

      const app = createApp();
      const req = makeRequest("/auth/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "user-id", credential: {} }),
      });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error.code).toBe("CHALLENGE_EXPIRED");
    });

    it("returns error when verification fails", async () => {
      mockKV.get.mockResolvedValue(JSON.stringify({
        challenge: "stored-challenge",
        username: "user",
      }));

      mockVerifyRegistrationResponse.mockRejectedValue(new Error("Invalid attestation"));

      const app = createApp();
      const req = makeRequest("/auth/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "uid", credential: {} }),
      });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error.code).toBe("VERIFICATION_FAILED");
      expect(body.error.message).toContain("Invalid attestation");
    });
  });

  // =========================================================================
  // POST /login/options
  // =========================================================================
  describe("POST /login/options", () => {
    it("returns authentication options with challengeId", async () => {
      mockGenerateAuthenticationOptions.mockResolvedValue({
        challenge: "login-challenge-xyz",
        rpId: "localhost",
      });

      const app = createApp();
      const req = makeRequest("/auth/login/options", { method: "POST" });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.challenge).toBe("login-challenge-xyz");
      expect(body.data.challengeId).toBeDefined();
      expect(mockKV.put).toHaveBeenCalledOnce();
    });
  });

  // =========================================================================
  // POST /login/verify
  // =========================================================================
  describe("POST /login/verify", () => {
    it("authenticates and creates session on valid assertion", async () => {
      mockKV.get.mockResolvedValue(JSON.stringify({ challenge: "stored-challenge" }));

      mockFirst.mockResolvedValue({
        id: "cred-id",
        user_id: "user-1",
        public_key: new Uint8Array([1, 2, 3]).buffer,
        counter: 5,
        transports: '["internal"]',
      });

      mockVerifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 6 },
      });

      const app = createApp();
      const req = makeRequest("/auth/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: "challenge-uuid",
          credential: { id: "cred-id", response: {} },
        }),
      });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.verified).toBe(true);
      expect(res.headers.get("Set-Cookie")).toContain("session=");
      expect(mockRun).toHaveBeenCalled(); // counter update
      expect(mockKV.delete).toHaveBeenCalled(); // challenge cleanup
    });

    it("returns error when challenge is expired", async () => {
      mockKV.get.mockResolvedValue(null);

      const app = createApp();
      const req = makeRequest("/auth/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: "expired", credential: {} }),
      });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error.code).toBe("CHALLENGE_EXPIRED");
    });

    it("returns 401 when passkey not found", async () => {
      mockKV.get.mockResolvedValue(JSON.stringify({ challenge: "ch" }));
      mockFirst.mockResolvedValue(null);

      const app = createApp();
      const req = makeRequest("/auth/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: "ch-id",
          credential: { id: "unknown-cred", response: {} },
        }),
      });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error.code).toBe("PASSKEY_NOT_FOUND");
    });

    it("returns 401 when verification fails", async () => {
      mockKV.get.mockResolvedValue(JSON.stringify({ challenge: "ch" }));
      mockFirst.mockResolvedValue({
        id: "cred-id",
        user_id: "user-1",
        public_key: new Uint8Array([1]).buffer,
        counter: 0,
        transports: null,
      });

      mockVerifyAuthenticationResponse.mockRejectedValue(new Error("Bad signature"));

      const app = createApp();
      const req = makeRequest("/auth/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: "ch-id",
          credential: { id: "cred-id", response: {} },
        }),
      });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error.code).toBe("AUTH_FAILED");
    });
  });

  // =========================================================================
  // POST /logout
  // =========================================================================
  describe("POST /logout", () => {
    it("clears session and cookie", async () => {
      const app = createApp();
      const req = makeRequest("/auth/logout", {
        method: "POST",
        headers: { Cookie: "session=token-to-clear" },
      });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.loggedOut).toBe(true);
      expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
      expect(mockKV.delete).toHaveBeenCalledWith("session:token-to-clear");
    });

    it("succeeds even without session cookie", async () => {
      const app = createApp();
      const req = makeRequest("/auth/logout", { method: "POST" });
      const res = await app.fetch(req, createEnv());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.loggedOut).toBe(true);
    });
  });
});
