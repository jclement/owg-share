import { describe, it, expect, vi } from "vitest";
import { createSession, getSession, deleteSession } from "./session";
import type { Env } from "../types";

function createMockEnv(): Env {
  const store = new Map<string, string>();

  return {
    KV: {
      get: vi.fn(async (key: string) => store.get(key) || null),
      put: vi.fn(async (key: string, value: string, _opts?: unknown) => {
        store.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        store.delete(key);
      }),
    },
    DB: {} as D1Database,
    R2: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    ENVIRONMENT: "test",
    APP_NAME: "Test",
    RP_ID: "localhost",
    RP_ORIGIN: "http://localhost:5173",
  } as unknown as Env;
}

describe("Session management", () => {
  it("creates a session and retrieves it", async () => {
    const env = createMockEnv();
    const userId = "user-123";

    const token = await createSession(env, userId);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    const session = await getSession(env, token);
    expect(session).not.toBeNull();
    expect(session!.userId).toBe(userId);
    expect(session!.createdAt).toBeDefined();
    expect(session!.expiresAt).toBeDefined();
  });

  it("returns null for non-existent sessions", async () => {
    const env = createMockEnv();
    const session = await getSession(env, "non-existent-token");
    expect(session).toBeNull();
  });

  it("deletes a session", async () => {
    const env = createMockEnv();
    const token = await createSession(env, "user-123");

    await deleteSession(env, token);

    const session = await getSession(env, token);
    expect(session).toBeNull();
  });

  it("stores session with expiration", async () => {
    const env = createMockEnv();
    const token = await createSession(env, "user-123");

    const session = await getSession(env, token);
    const expiresAt = new Date(session!.expiresAt);
    const now = new Date();

    // Should expire in roughly 7 days
    const diffMs = expiresAt.getTime() - now.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(6.9);
    expect(diffDays).toBeLessThan(7.1);
  });

  it("returns null for expired sessions", async () => {
    const env = createMockEnv();
    const token = await createSession(env, "user-123");

    // Tamper with the stored session to make it expired
    const sessionData = await env.KV.get(`session:${token}`);
    const session = JSON.parse(sessionData!);
    session.expiresAt = new Date(Date.now() - 1000).toISOString();
    await env.KV.put(`session:${token}`, JSON.stringify(session));

    const result = await getSession(env, token);
    expect(result).toBeNull();
  });

  it("creates unique tokens for different sessions", async () => {
    const env = createMockEnv();
    const token1 = await createSession(env, "user-1");
    const token2 = await createSession(env, "user-2");
    expect(token1).not.toBe(token2);
  });
});
