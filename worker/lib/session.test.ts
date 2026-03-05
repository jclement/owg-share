import { describe, it, expect, vi, beforeEach } from "vitest";
import { getSessionToken, sessionCookie, clearSessionCookie } from "./session";

describe("getSessionToken", () => {
  it("extracts session token from cookie header", () => {
    const request = new Request("https://example.com", {
      headers: { Cookie: "session=abc123; other=xyz" },
    });
    expect(getSessionToken(request)).toBe("abc123");
  });

  it("returns null when no cookie header", () => {
    const request = new Request("https://example.com");
    expect(getSessionToken(request)).toBeNull();
  });

  it("returns null when session cookie not present", () => {
    const request = new Request("https://example.com", {
      headers: { Cookie: "other=xyz" },
    });
    expect(getSessionToken(request)).toBeNull();
  });

  it("handles cookie as first item", () => {
    const request = new Request("https://example.com", {
      headers: { Cookie: "session=token123" },
    });
    expect(getSessionToken(request)).toBe("token123");
  });

  it("handles cookie with spaces", () => {
    const request = new Request("https://example.com", {
      headers: { Cookie: "session=token123 ; other=abc" },
    });
    expect(getSessionToken(request)).toBe("token123");
  });
});

describe("sessionCookie", () => {
  it("creates a valid session cookie string", () => {
    const cookie = sessionCookie("my-token", 3600);
    expect(cookie).toContain("session=my-token");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Max-Age=3600");
  });

  it("uses default TTL when not specified", () => {
    const cookie = sessionCookie("my-token");
    expect(cookie).toContain("Max-Age=604800"); // 7 days
  });
});

describe("clearSessionCookie", () => {
  it("creates a cookie with Max-Age=0", () => {
    const cookie = clearSessionCookie();
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("session=");
  });
});
