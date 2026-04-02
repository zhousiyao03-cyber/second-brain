import { expect, test } from "@playwright/test";

const uid = () => Math.random().toString(36).slice(2, 8);

test.describe("Learning notebook", () => {
  test("can create a topic and a note", async ({ page }) => {
    const topicName = `Go ${uid()}`;
    const noteTitle = `Concurrency ${uid()}`;
    const noteBody = `goroutine-${uid()}`;

    await page.goto("/learn");
    await expect(page.getByRole("heading", { name: "Learning notebook" })).toBeVisible();

    await page.getByRole("button", { name: "New topic" }).click();
    await page.getByLabel("Topic title").fill(topicName);
    await page.getByLabel("Description").fill("Study backend fundamentals");
    await page.getByLabel("Icon").fill("📘");
    await page.getByRole("button", { name: "Create topic" }).click();

    await expect(page).toHaveURL(/\/learn\/.+/);
    await expect(page.getByRole("heading", { name: topicName })).toBeVisible();

    await page.getByRole("button", { name: "New note" }).click();
    await page.getByRole("menuitem", { name: "Blank note" }).click();

    await expect(page).toHaveURL(/\/learn\/.+\/notes\/.+/);
    await page.getByPlaceholder("New page").fill(noteTitle);
    await page.locator(".ProseMirror").click();
    await page.locator(".ProseMirror").pressSequentially(noteBody, { delay: 20 });
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 5000 });

    await page.getByTestId("note-editor-back").click();
    await expect(page.getByText(noteTitle)).toBeVisible();
    await expect(page.getByText("1 note")).toBeVisible();
  });
});
