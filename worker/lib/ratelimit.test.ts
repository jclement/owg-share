import { describe, it, expect, vi } from "vitest";

// Test the rate limiting logic directly (not as Hono middleware)
describe("Rate limiting logic", () => {
  function createMockKV() {
    const store = new Map<string, { value: string; expiration?: number }>();

    return {
      get: vi.fn(async (key: string) => {
        const entry = store.get(key);
        if (!entry) return null;
        if (entry.expiration && entry.expiration < Date.now()) {
          store.delete(key);
          return null;
        }
        return entry.value;
      }),
      put: vi.fn(async (key: string, value: string, opts?: { expirationTtl?: number }) => {
        store.set(key, {
          value,
          expiration: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : undefined,
        });
      }),
      delete: vi.fn(async (key: string) => {
        store.delete(key);
      }),
    };
  }

  async function checkRateLimit(
    kv: ReturnType<typeof createMockKV>,
    key: string,
    limit: number,
    windowSecs: number
  ): Promise<boolean> {
    const current = await kv.get(key);
    const count = current ? parseInt(current) : 0;
    if (count >= limit) return false;
    await kv.put(key, String(count + 1), { expirationTtl: windowSecs });
    return true;
  }

  it("allows requests within the limit", async () => {
    const kv = createMockKV();
    const key = "ratelimit:127.0.0.1:/api/test";

    for (let i = 0; i < 10; i++) {
      const allowed = await checkRateLimit(kv, key, 10, 60);
      expect(allowed).toBe(true);
    }
  });

  it("blocks requests exceeding the limit", async () => {
    const kv = createMockKV();
    const key = "ratelimit:127.0.0.1:/api/test";

    // Use up all 5 requests
    for (let i = 0; i < 5; i++) {
      await checkRateLimit(kv, key, 5, 60);
    }

    // Next request should be blocked
    const allowed = await checkRateLimit(kv, key, 5, 60);
    expect(allowed).toBe(false);
  });

  it("tracks different keys independently", async () => {
    const kv = createMockKV();

    for (let i = 0; i < 5; i++) {
      await checkRateLimit(kv, "ratelimit:ip1:/api/test", 5, 60);
    }

    // Different IP should still be allowed
    const allowed = await checkRateLimit(kv, "ratelimit:ip2:/api/test", 5, 60);
    expect(allowed).toBe(true);
  });

  it("stores expiration TTL", async () => {
    const kv = createMockKV();
    await checkRateLimit(kv, "ratelimit:test", 10, 60);

    expect(kv.put).toHaveBeenCalledWith("ratelimit:test", "1", { expirationTtl: 60 });
  });
});
