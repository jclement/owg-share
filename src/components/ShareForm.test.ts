import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeExpiresAt } from "./ShareForm";

describe("computeExpiresAt", () => {
  const DAY = 24 * 60 * 60 * 1000;
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Fix Date.now to a known value for deterministic tests
    nowSpy = vi.spyOn(Date, "now").mockReturnValue(new Date("2025-06-15T12:00:00Z").getTime());
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it("returns undefined for empty string", () => {
    expect(computeExpiresAt("")).toBeUndefined();
  });

  it("returns null for 'never'", () => {
    expect(computeExpiresAt("never")).toBeNull();
  });

  it("returns undefined for unknown value", () => {
    expect(computeExpiresAt("foo")).toBeUndefined();
    expect(computeExpiresAt("100d")).toBeUndefined();
    expect(computeExpiresAt("abc")).toBeUndefined();
  });

  it("computes 1 day from now", () => {
    const result = computeExpiresAt("1d");
    expect(result).toBeDefined();
    const date = new Date(result!);
    const expected = new Date(Date.now() + DAY);
    expect(date.toISOString()).toBe(expected.toISOString());
  });

  it("computes 5 days from now", () => {
    const result = computeExpiresAt("5d");
    const date = new Date(result!);
    const expected = new Date(Date.now() + 5 * DAY);
    expect(date.toISOString()).toBe(expected.toISOString());
  });

  it("computes 10 days from now", () => {
    const result = computeExpiresAt("10d");
    const date = new Date(result!);
    const expected = new Date(Date.now() + 10 * DAY);
    expect(date.toISOString()).toBe(expected.toISOString());
  });

  it("computes 30 days from now", () => {
    const result = computeExpiresAt("30d");
    const date = new Date(result!);
    const expected = new Date(Date.now() + 30 * DAY);
    expect(date.toISOString()).toBe(expected.toISOString());
  });

  it("computes 60 days from now", () => {
    const result = computeExpiresAt("60d");
    const date = new Date(result!);
    const expected = new Date(Date.now() + 60 * DAY);
    expect(date.toISOString()).toBe(expected.toISOString());
  });

  it("computes 90 days from now", () => {
    const result = computeExpiresAt("90d");
    const date = new Date(result!);
    const expected = new Date(Date.now() + 90 * DAY);
    expect(date.toISOString()).toBe(expected.toISOString());
  });

  it("returns valid ISO string", () => {
    const result = computeExpiresAt("30d");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });

  it("returns a date in the future", () => {
    for (const val of ["1d", "5d", "10d", "30d", "60d", "90d"]) {
      const result = computeExpiresAt(val);
      expect(new Date(result!).getTime()).toBeGreaterThan(Date.now());
    }
  });
});
