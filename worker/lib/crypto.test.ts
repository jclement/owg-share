import { describe, it, expect } from "vitest";
import { hashApiKey, generateApiKey } from "./crypto";

describe("generateApiKey", () => {
  it("generates keys with owgs_ prefix", () => {
    const key = generateApiKey();
    expect(key).toMatch(/^owgs_[0-9a-f]{64}$/);
  });

  it("generates unique keys", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 50; i++) {
      keys.add(generateApiKey());
    }
    expect(keys.size).toBe(50);
  });

  it("generates 64 hex chars after prefix", () => {
    const key = generateApiKey();
    const hex = key.slice(5);
    expect(hex).toHaveLength(64);
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });
});

describe("hashApiKey", () => {
  it("produces consistent hashes for the same input", async () => {
    const hash1 = await hashApiKey("test-key");
    const hash2 = await hashApiKey("test-key");
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different inputs", async () => {
    const hash1 = await hashApiKey("key-1");
    const hash2 = await hashApiKey("key-2");
    expect(hash1).not.toBe(hash2);
  });

  it("produces 64-char hex strings (SHA-256)", async () => {
    const hash = await hashApiKey("test");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});
