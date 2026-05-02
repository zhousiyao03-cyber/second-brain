import { expect, test } from "@playwright/test";

/**
 * Drifter — basic flow.
 *
 * Visual layer (Phaser canvas) is not asserted; we focus on the React UI
 * surface that drives the actual conversation. Phaser is loaded async and
 * the test can run before/after it's mounted — the chat works either way
 * since the dialogue box and input are independent of the canvas.
 *
 * AI is stubbed via DRIFTER_E2E_MOCK=1 (set in playwright.config.ts).
 */

test.describe.configure({ mode: "serial" });

test.describe("Drifter", () => {
  test("entry from sidebar shows greeting and accepts a message", async ({
    page,
  }) => {
    await page.goto("/");

    // Sidebar nav link
    const drifterLink = page.locator("aside").getByRole("link", { name: "Drifter" });
    await expect(drifterLink).toBeVisible();
    await drifterLink.click();

    await page.waitForURL("**/drifter");

    // HUD shows up after session bootstrap
    const hud = page.getByTestId("drifter-hud");
    await expect(hud).toBeVisible({ timeout: 10000 });

    // Dialogue box renders
    const dialogue = page.getByTestId("drifter-dialogue");
    await expect(dialogue).toBeVisible();

    // First Pip greeting (from buildOpeningLine, persisted to history)
    await expect(dialogue).toContainText(/Pip|PIP/, { timeout: 10000 });

    // Send a user message
    const input = page.getByTestId("drifter-input");
    await input.fill("hi pip");
    await page.getByTestId("drifter-send").click();

    // Pip's mocked reply text appears (fakePipChunk -> "I hear you. The rain is outside.")
    await expect(dialogue).toContainText(/rain is outside/i, {
      timeout: 10000,
    });

    // Hooks rendered after Pip replied
    const hooks = page.getByTestId("drifter-hooks");
    await expect(hooks).toBeVisible();
    await expect(page.getByTestId("drifter-hook-0")).toBeVisible();
  });

  test("step outside leaves to dashboard", async ({ page }) => {
    await page.goto("/drifter");

    await expect(page.getByTestId("drifter-hud")).toBeVisible({
      timeout: 10000,
    });

    await page.getByTestId("drifter-leave").click();
    await page.waitForURL("**/dashboard");
  });

  test("hook button sends its text as a user message", async ({ page }) => {
    await page.goto("/drifter");

    await expect(page.getByTestId("drifter-dialogue")).toBeVisible({
      timeout: 10000,
    });

    // Need at least one user-pip exchange to surface hooks
    await page.getByTestId("drifter-input").fill("hello");
    await page.getByTestId("drifter-send").click();

    const hook0 = page.getByTestId("drifter-hook-0");
    await expect(hook0).toBeVisible({ timeout: 10000 });
    const hookText = (await hook0.textContent())?.trim() ?? "";
    await hook0.click();

    // The hook text should appear in the dialogue (typewriter or instant)
    if (hookText.length > 0) {
      await expect(page.getByTestId("drifter-dialogue")).toContainText(hookText);
    }
  });
});
