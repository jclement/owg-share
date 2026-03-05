import { test, expect } from "@playwright/test";

test.describe("Public views", () => {
  test("health endpoint returns ok", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
  });

  test("non-existent share data returns 404", async ({ request }) => {
    const response = await request.get("/s/data/this-slug-does-not-exist-42");
    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  test("non-existent slug serves SPA (not 500)", async ({ page }) => {
    const response = await page.goto("/s/nonexistent-slug-test");
    // Should serve the SPA, not a 500 error
    expect(response?.status()).toBeLessThan(500);
  });

  test("API without auth returns 401", async ({ request }) => {
    const response = await request.get("/api/shares");
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});
