import { test, expect, type Page } from "@playwright/test";

// E2E covers the Ask AI M2 @mention flow: inside the inline Ask AI popover,
// typing "@" pops up a menu backed by `dashboard.search`, selecting a result
// adds a pinned chip, and the chip's id/type is sent through on the
// `/api/chat` request body as `pinnedSources`.
//
// We mock `/api/chat` so the tests don't depend on a real AI provider, and
// we capture the request body to assert the pinnedSources payload shape.

const uid = () => Math.random().toString(36).slice(2, 8);

async function createNoteWithTitle(page: Page, title: string) {
  await page.goto("/notes");
  await page.getByRole("button", { name: "New note" }).click();
  await expect(page).toHaveURL(/\/notes\/.+/);
  const titleInput = page.locator("textarea[placeholder='New page']");
  await titleInput.fill(title);
  // Blur out of title so the debounced title save kicks in (1500ms).
  await titleInput.press("Enter");
  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  // Wait for the save indicator to settle to "Saved" so dashboard.search can
  // find the note by title.
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
  return { editor };
}

async function mockChatStreamCapturingBody(page: Page, body: string) {
  const captured: Array<Record<string, unknown>> = [];
  await page.route("**/api/chat", async (route) => {
    try {
      const parsed = JSON.parse(route.request().postData() || "{}");
      captured.push(parsed);
    } catch {
      // ignore
    }
    await route.fulfill({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      body,
    });
  });
  return captured;
}

test.describe("Ask AI inline @mention pinned sources", () => {
  test("typing @ opens mention menu and selecting a note pins it", async ({
    page,
  }) => {
    const targetTitle = `PINNED_NOTE_${uid()}`;
    // Seed a discoverable note (title is what dashboard.search will match on).
    await createNoteWithTitle(page, targetTitle);

    // Create a second note to host the inline Ask AI popover.
    const hostTitle = `HOST_NOTE_${uid()}`;
    const { editor } = await createNoteWithTitle(page, hostTitle);

    const captured = await mockChatStreamCapturingBody(page, "AI_ANSWER_OK");

    // Open inline Ask AI via /ai slash command
    await editor.click();
    await editor.press("/");
    const menu = page.getByTestId("editor-slash-menu");
    await expect(menu).toBeVisible({ timeout: 3000 });
    await menu.getByRole("button", { name: "Ask AI" }).click();

    const popover = page.locator("[data-inline-ask-ai]");
    await expect(popover).toBeVisible();

    // Type "@PINNED" — mention menu should appear and return our note
    await popover.locator("textarea").fill(`@${targetTitle.slice(0, 8)}`);
    const mentionMenu = page.locator("[data-inline-ask-ai-mention-menu]");
    await expect(mentionMenu).toBeVisible({ timeout: 5000 });

    // Click the matching result
    await mentionMenu.getByRole("option", { name: new RegExp(targetTitle) }).click();

    // Chip bar should now show our note
    const chipBar = page.locator("[data-inline-ask-ai-pinned-bar]");
    await expect(chipBar).toBeVisible();
    await expect(chipBar).toContainText(targetTitle);

    // Now add a question and submit
    await popover.locator("textarea").fill("summarize the pinned note");
    await popover.locator("textarea").press("Enter");

    // Answer mock text should land in the popover preview
    await expect(popover).toContainText("AI_ANSWER_OK", { timeout: 10_000 });

    // Assert the chat request body contained our pinnedSources
    expect(captured.length).toBeGreaterThan(0);
    const latest = captured[captured.length - 1];
    const pins = latest.pinnedSources as
      | Array<{ id: string; type: string }>
      | undefined;
    expect(Array.isArray(pins)).toBe(true);
    expect(pins?.length).toBe(1);
    expect(pins?.[0].type).toBe("note");
    expect(typeof pins?.[0].id).toBe("string");
    expect(pins?.[0].id.length).toBeGreaterThan(0);
  });

  test("× button removes a pinned source", async ({ page }) => {
    const targetTitle = `REMOVABLE_NOTE_${uid()}`;
    await createNoteWithTitle(page, targetTitle);
    const { editor } = await createNoteWithTitle(page, `HOST_${uid()}`);

    await mockChatStreamCapturingBody(page, "noop");

    await editor.click();
    await editor.press("/");
    await page
      .getByTestId("editor-slash-menu")
      .getByRole("button", { name: "Ask AI" })
      .click();

    const popover = page.locator("[data-inline-ask-ai]");
    await popover.locator("textarea").fill(`@${targetTitle.slice(0, 10)}`);

    const mentionMenu = page.locator("[data-inline-ask-ai-mention-menu]");
    await expect(mentionMenu).toBeVisible({ timeout: 5000 });
    await mentionMenu
      .getByRole("option", { name: new RegExp(targetTitle) })
      .click();

    const chipBar = page.locator("[data-inline-ask-ai-pinned-bar]");
    await expect(chipBar).toContainText(targetTitle);

    await chipBar
      .getByRole("button", { name: new RegExp(`移除 ${targetTitle}`) })
      .click();
    await expect(chipBar).toBeHidden();
  });

  test("Escape closes mention menu without closing the popover", async ({
    page,
  }) => {
    await createNoteWithTitle(page, `ESC_NOTE_${uid()}`);
    const { editor } = await createNoteWithTitle(page, `HOST_${uid()}`);

    await mockChatStreamCapturingBody(page, "noop");

    await editor.click();
    await editor.press("/");
    await page
      .getByTestId("editor-slash-menu")
      .getByRole("button", { name: "Ask AI" })
      .click();

    const popover = page.locator("[data-inline-ask-ai]");
    await popover.locator("textarea").fill("@ESC_NOTE");
    const mentionMenu = page.locator("[data-inline-ask-ai-mention-menu]");
    await expect(mentionMenu).toBeVisible({ timeout: 5000 });

    await popover.locator("textarea").press("Escape");
    await expect(mentionMenu).toBeHidden();
    // Popover itself should still be open
    await expect(popover).toBeVisible();
  });
});
