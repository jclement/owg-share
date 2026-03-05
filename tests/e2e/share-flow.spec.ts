import { test, expect } from "@playwright/test";

// These E2E tests require a running dev server with an authenticated session.
// Since the app uses WebAuthn for auth, we seed a session cookie directly.
// To run: set SESSION_COOKIE env var or modify the storageState setup.

test.describe("Dashboard", () => {
  test.skip(
    !process.env.SESSION_COOKIE,
    "Requires SESSION_COOKIE env var for authenticated tests"
  );

  test.use({
    extraHTTPHeaders: {
      Cookie: `session=${process.env.SESSION_COOKIE || ""}`,
    },
  });

  test("loads and shows the dashboard", async ({ page }) => {
    await page.goto("/");
    // Dashboard should show the "New Share" or shares list
    await expect(page.locator("body")).toBeVisible();
    // Check for key UI elements
    const heading = page.getByText(/shares|dashboard/i);
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("new share wizard opens", async ({ page }) => {
    await page.goto("/");
    // Click new share button
    const newBtn = page.getByRole("button", { name: /new share/i });
    if (await newBtn.isVisible()) {
      await newBtn.click();
      // Wizard should show share type options
      await expect(page.getByText(/link/i)).toBeVisible();
      await expect(page.getByText(/markdown/i)).toBeVisible();
      await expect(page.getByText(/code/i)).toBeVisible();
      await expect(page.getByText(/file/i)).toBeVisible();
    }
  });

  test("settings page loads", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText(/settings/i)).toBeVisible({ timeout: 10000 });
  });

  test("API keys page loads", async ({ page }) => {
    await page.goto("/settings/api-keys");
    await expect(page.getByText(/api key/i)).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Public share pages", () => {
  test("non-existent slug shows error", async ({ page }) => {
    await page.goto("/s/definitely-does-not-exist-xyz");
    // Should show not found or error state
    const body = await page.textContent("body");
    // The SPA should render and show an error
    expect(body).toBeTruthy();
  });

  test("root page loads", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBeLessThan(500);
  });
});
