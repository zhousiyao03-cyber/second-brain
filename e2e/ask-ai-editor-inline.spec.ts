import { test, expect, type Page } from "@playwright/test";

// E2E covers the two Ask AI M1 entry points inside the editor:
// 1) Slash command `/ai` → popover → insert answer
// 2) Bubble toolbar "Ask AI" button on selection → popover → replace answer
//
// Uses `page.route` to mock `/api/chat` so the tests don't depend on a real
// AI provider. The response is a plain text stream (same content-type the
// real stream transport uses).

async function createNote(page: Page) {
  await page.goto("/notes");
  await page.getByRole("button", { name: "New note" }).click();
  await expect(page).toHaveURL(/\/notes\/.+/);
  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  return { editor };
}

async function mockChatStream(page: Page, body: string) {
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      body,
    });
  });
}

test.describe("Ask AI inline in editor", () => {
  test("slash /ai opens popover and inserts answer", async ({ page }) => {
    await mockChatStream(page, "AI_INSERT_PAYLOAD_XYZ");

    const { editor } = await createNote(page);
    await editor.click();

    // Open slash menu and pick the Ask AI item
    await editor.press("/");
    const menu = page.getByTestId("editor-slash-menu");
    await expect(menu).toBeVisible({ timeout: 3000 });
    await menu.getByRole("button", { name: "Ask AI" }).click();

    // Popover mounted
    const popover = page.locator("[data-inline-ask-ai]");
    await expect(popover).toBeVisible();
    await expect(popover).toContainText("Ask AI");

    // Ask something; mock will return the static string
    await popover.locator("textarea").fill("say something");
    await popover.locator("textarea").press("Enter");

    // Mocked stream text shows up in the popover preview
    await expect(popover).toContainText("AI_INSERT_PAYLOAD_XYZ", {
      timeout: 10_000,
    });

    // Insert button now visible; click it
    const insertBtn = popover.getByRole("button", { name: "插入" });
    await expect(insertBtn).toBeVisible();
    await insertBtn.click();

    // Popover closes, editor contains inserted text
    await expect(popover).toBeHidden();
    await expect(editor).toContainText("AI_INSERT_PAYLOAD_XYZ");
  });

  test("bubble toolbar Ask AI replaces selection", async ({ page }) => {
    await mockChatStream(page, "REPLACED_BY_AI");

    const { editor } = await createNote(page);
    await editor.click();
    await editor.pressSequentially("ORIGINAL_MARKER", { delay: 20 });

    // Select all typed text
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");

    // Bubble toolbar with the Ask AI button should appear
    const askBtn = page.locator("button[title='Ask AI']");
    await expect(askBtn).toBeVisible({ timeout: 3000 });
    await askBtn.click();

    // Popover opens in rewrite mode
    const popover = page.locator("[data-inline-ask-ai]");
    await expect(popover).toBeVisible();
    await expect(popover).toContainText("改写选中文本");

    await popover.locator("textarea").fill("translate");
    await popover.locator("textarea").press("Enter");

    await expect(popover).toContainText("REPLACED_BY_AI", { timeout: 10_000 });

    const replaceBtn = popover.getByRole("button", { name: "替换" });
    await expect(replaceBtn).toBeVisible();
    await replaceBtn.click();

    await expect(popover).toBeHidden();

    // The original marker is gone, the AI-replaced text is in its place
    await expect(editor).not.toContainText("ORIGINAL_MARKER");
    await expect(editor).toContainText("REPLACED_BY_AI");
  });

  test("append to end inserts answer at the document tail, not the caret", async ({
    page,
  }) => {
    await mockChatStream(page, "APPENDED_PAYLOAD");

    const { editor } = await createNote(page);
    await editor.click();
    await editor.pressSequentially("TOP_LINE", { delay: 20 });
    // Move caret back to start so "insert at caret" would land above TOP_LINE
    await page.keyboard.press("Home");
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press("ArrowLeft");
    }

    await editor.press("/");
    const menu = page.getByTestId("editor-slash-menu");
    await expect(menu).toBeVisible({ timeout: 3000 });
    await menu.getByRole("button", { name: "Ask AI" }).click();

    const popover = page.locator("[data-inline-ask-ai]");
    await expect(popover).toBeVisible();

    await popover.locator("textarea").fill("whatever");
    await popover.locator("textarea").press("Enter");
    await expect(popover).toContainText("APPENDED_PAYLOAD", {
      timeout: 10_000,
    });

    const appendBtn = popover.locator("[data-inline-ask-ai-append]");
    await expect(appendBtn).toBeVisible();
    await appendBtn.click();

    await expect(popover).toBeHidden();
    // The appended text should be *after* TOP_LINE, not before.
    const text = await editor.innerText();
    expect(text).toContain("TOP_LINE");
    expect(text).toContain("APPENDED_PAYLOAD");
    expect(text.indexOf("TOP_LINE")).toBeLessThan(
      text.indexOf("APPENDED_PAYLOAD")
    );
  });

  test("Escape closes popover without modifying the editor", async ({
    page,
  }) => {
    await mockChatStream(page, "SHOULD_NOT_INSERT");

    const { editor } = await createNote(page);
    await editor.click();
    await editor.pressSequentially("untouched", { delay: 20 });
    // Move to a fresh line before typing "/" — slash menu needs the trigger
    // at the start of a word boundary.
    await page.keyboard.press("Enter");

    // Open popover via slash menu
    await editor.press("/");
    const menu = page.getByTestId("editor-slash-menu");
    await expect(menu).toBeVisible({ timeout: 3000 });
    await menu.getByRole("button", { name: "Ask AI" }).click();

    const popover = page.locator("[data-inline-ask-ai]");
    await expect(popover).toBeVisible();

    // Press Escape inside the popover — it should close without inserting
    await popover.locator("textarea").press("Escape");
    await expect(popover).toBeHidden();

    await expect(editor).toContainText("untouched");
    await expect(editor).not.toContainText("SHOULD_NOT_INSERT");
  });
});
