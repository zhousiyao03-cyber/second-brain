import { expect, test } from "@playwright/test";
import {
  backdateUserCreation,
  clearSeededNotes,
  clearSubscription,
  resetUserCreation,
  seedManyNotes,
  seedSubscription,
} from "./helpers/billing";

/**
 * These tests run inside the dedicated "billing" Playwright project, which:
 *
 * 1. Uses its own webServer on port 3101 with KNOSI_HOSTED_MODE=true so the
 *    real billing gates execute (otherwise `getEntitlements` short-circuits
 *    to PRO_UNLIMITED and nothing is testable).
 * 2. Uses a separate sqlite DB at `data/second-brain.billing.e2e.db` so
 *    mutations here cannot pollute the primary E2E database.
 * 3. Uses `billing-test-user` as the auth-bypass user, keeping it distinct
 *    from the `test-user` shared by the other specs.
 *
 * All tests share a single user, so they run serially (fullyParallel: false
 * is configured on the project) and each afterEach resets state to avoid
 * leakage between cases.
 */

const TEST_USER_ID = "billing-test-user";

test.describe.configure({ mode: "serial" });

test.describe("billing", () => {
  test.afterEach(async () => {
    await clearSubscription(TEST_USER_ID);
    await clearSeededNotes(TEST_USER_ID);
    await resetUserCreation(TEST_USER_ID);
  });

  test("new user inside the 7-day trial sees the trial banner and can access Portfolio", async ({
    page,
  }) => {
    await backdateUserCreation(TEST_USER_ID, 3);

    await page.goto("/");
    await expect(
      page.getByRole("link", { name: /Trial:\s*\d+\s*days? left/i }),
    ).toBeVisible();

    await page.goto("/portfolio");
    // When the user is Pro, the upsell splash must NOT render; the Portfolio
    // client content does.
    await expect(
      page.getByText(/Portfolio Tracker is a Pro feature/i),
    ).toHaveCount(0);
  });

  test("after the trial expires, Portfolio shows the Pro gate and Upgrade links to /pricing", async ({
    page,
  }) => {
    await backdateUserCreation(TEST_USER_ID, 40);

    await page.goto("/portfolio");
    await expect(
      page.getByText(/Portfolio Tracker is a Pro feature\./i),
    ).toBeVisible();

    await page
      .getByRole("link", { name: /Upgrade to Pro/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/pricing(?:$|\?|#|\/)/);
  });

  test("Free user past the notes quota sees the upsell modal", async ({
    page,
  }) => {
    await backdateUserCreation(TEST_USER_ID, 40);
    // Seed exactly the Free-tier limit; the 51st create must be blocked.
    await clearSeededNotes(TEST_USER_ID);
    await seedManyNotes(TEST_USER_ID, 50);

    await page.goto("/notes");
    await page.getByRole("button", { name: /New note/i }).click();
    await expect(
      page.getByText(/hit the Free limit for notes/i),
    ).toBeVisible();
  });

  test("Pro user sees Knosi AI enabled in /settings", async ({ page }) => {
    await seedSubscription(TEST_USER_ID, "active", 10);

    await page.goto("/settings");
    // Scope to the AI provider section to avoid accidental matches.
    const aiSection = page
      .getByRole("heading", { name: /AI Provider/i })
      .locator("xpath=ancestor::section[1]");
    await expect(aiSection).toBeVisible();

    const knosiOption = aiSection.getByRole("radio", { name: /Knosi AI/i });
    await expect(knosiOption).toBeVisible();
    await expect(knosiOption).toBeEnabled();
  });

  test("Free user sees Knosi AI disabled in /settings", async ({ page }) => {
    await backdateUserCreation(TEST_USER_ID, 40);

    await page.goto("/settings");
    const aiSection = page
      .getByRole("heading", { name: /AI Provider/i })
      .locator("xpath=ancestor::section[1]");
    await expect(aiSection).toBeVisible();

    const knosiOption = aiSection.getByRole("radio", { name: /Knosi AI/i });
    await expect(knosiOption).toBeVisible();
    await expect(knosiOption).toBeDisabled();
  });
});
