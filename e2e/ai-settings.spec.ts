import { test, expect } from "@playwright/test";

test.describe("AI Settings", () => {
  test("renders Providers + AI Roles sections on /settings", async ({ page }) => {
    await page.goto("/settings");

    await expect(
      page.getByRole("heading", { name: "Providers", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "AI Roles", exact: true }),
    ).toBeVisible();

    // Empty state for the AUTH_BYPASS test user (no providers seeded).
    await expect(
      page.getByText("No providers yet.", { exact: false }),
    ).toBeVisible();
  });

  test("Add provider opens the dialog with kind selector", async ({ page }) => {
    await page.goto("/settings");

    await page.getByRole("button", { name: /add provider/i }).click();

    // Dialog header
    await expect(
      page.getByRole("heading", { name: "Add provider", exact: true }),
    ).toBeVisible();

    // Kind selector with all 4 options
    const kindSelect = page.locator("select").first();
    await expect(kindSelect).toBeVisible();
    const options = await kindSelect.locator("option").allTextContents();
    expect(options).toEqual(
      expect.arrayContaining([
        "OpenAI-compatible API",
        "Local Model (Ollama / LM Studio)",
        "Claude Code Daemon",
        "Transformers.js (in-process embedding)",
      ]),
    );

    // Cancel closes the dialog
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(
      page.getByRole("heading", { name: "Add provider", exact: true }),
    ).not.toBeVisible();
  });
});
