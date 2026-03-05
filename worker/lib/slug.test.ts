import { describe, it, expect } from "vitest";
import { generateSlug, validateCustomSlug, isReservedSlug } from "./slug";

describe("generateSlug", () => {
  it("generates short slugs of 8 characters", () => {
    const slug = generateSlug("short");
    expect(slug).toHaveLength(8);
    expect(slug).toMatch(/^[0-9A-Za-z]+$/);
  });

  it("generates long slugs of 24 characters", () => {
    const slug = generateSlug("long");
    expect(slug).toHaveLength(24);
    expect(slug).toMatch(/^[0-9A-Za-z]+$/);
  });

  it("generates encrypted slugs of 32 characters", () => {
    const slug = generateSlug("encrypted");
    expect(slug).toHaveLength(32);
    expect(slug).toMatch(/^[0-9A-Za-z]+$/);
  });

  it("throws for custom type", () => {
    expect(() => generateSlug("custom")).toThrow();
  });

  it("generates unique slugs", () => {
    const slugs = new Set<string>();
    for (let i = 0; i < 100; i++) {
      slugs.add(generateSlug("short"));
    }
    // With 62^8 possible values, collisions in 100 iterations are astronomically unlikely
    expect(slugs.size).toBe(100);
  });

  it("only contains base62 characters", () => {
    for (let i = 0; i < 50; i++) {
      const slug = generateSlug("long");
      for (const char of slug) {
        expect("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz").toContain(char);
      }
    }
  });
});

describe("validateCustomSlug", () => {
  it("accepts valid alphanumeric slugs", () => {
    expect(validateCustomSlug("hello")).toBeNull();
    expect(validateCustomSlug("my-slug")).toBeNull();
    expect(validateCustomSlug("test123")).toBeNull();
    expect(validateCustomSlug("a")).toBeNull();
    expect(validateCustomSlug("ab")).toBeNull();
  });

  it("rejects empty slugs", () => {
    expect(validateCustomSlug("")).not.toBeNull();
  });

  it("rejects slugs over 64 characters", () => {
    expect(validateCustomSlug("a".repeat(65))).not.toBeNull();
  });

  it("accepts slugs of exactly 64 characters", () => {
    expect(validateCustomSlug("a".repeat(64))).toBeNull();
  });

  it("rejects slugs starting with hyphen", () => {
    expect(validateCustomSlug("-hello")).not.toBeNull();
  });

  it("rejects slugs ending with hyphen", () => {
    expect(validateCustomSlug("hello-")).not.toBeNull();
  });

  it("rejects slugs with invalid characters", () => {
    expect(validateCustomSlug("hello world")).not.toBeNull();
    expect(validateCustomSlug("hello_world")).not.toBeNull();
    expect(validateCustomSlug("hello.world")).not.toBeNull();
  });

  it("rejects reserved slugs", () => {
    expect(validateCustomSlug("api")).not.toBeNull();
    expect(validateCustomSlug("auth")).not.toBeNull();
    expect(validateCustomSlug("login")).not.toBeNull();
    expect(validateCustomSlug("setup")).not.toBeNull();
    expect(validateCustomSlug("settings")).not.toBeNull();
    expect(validateCustomSlug("dashboard")).not.toBeNull();
    expect(validateCustomSlug("admin")).not.toBeNull();
  });

  it("rejects reserved slugs case-insensitively", () => {
    expect(validateCustomSlug("API")).not.toBeNull();
    expect(validateCustomSlug("Admin")).not.toBeNull();
  });
});

describe("isReservedSlug", () => {
  it("identifies reserved slugs", () => {
    expect(isReservedSlug("api")).toBe(true);
    expect(isReservedSlug("auth")).toBe(true);
    expect(isReservedSlug("admin")).toBe(true);
    expect(isReservedSlug("s")).toBe(true);
  });

  it("identifies non-reserved slugs", () => {
    expect(isReservedSlug("hello")).toBe(false);
    expect(isReservedSlug("my-share")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isReservedSlug("API")).toBe(true);
    expect(isReservedSlug("Admin")).toBe(true);
  });
});
