import { expect, test } from "@playwright/test";

const uid = () => Math.random().toString(36).slice(2, 8);

test.describe("OSS projects", () => {
  test("can create a project, add a tagged note, and filter by tag", async ({
    page,
  }) => {
    const projectName = `next-${uid()}`;
    const noteTitle = `rendering-${uid()}`;
    const noteBody = `rsc-${uid()}`;
    const tag = `routing-${uid()}`;

    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "Open source projects" })).toBeVisible();

    await page.getByRole("button", { name: "Add project" }).click();
    await page.getByLabel("Project name").fill(projectName);
    await page.getByLabel("Repository URL").fill("https://github.com/vercel/next.js");
    await page.getByLabel("Language").fill("TypeScript");
    await page.getByRole("button", { name: "Create project" }).click();

    await expect(page).toHaveURL(/\/projects\/.+/);
    await expect(page.getByRole("heading", { name: projectName })).toBeVisible();

    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page).toHaveURL(/\/projects\/.+\/notes\/.+/);
    await page.getByPlaceholder("New page").fill(noteTitle);
    await page.locator(".ProseMirror").click();
    await page.locator(".ProseMirror").pressSequentially(noteBody, { delay: 20 });
    await page.getByTestId("note-tag-input").fill(tag);
    await page.getByTestId("note-tag-input").press("Enter");
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 5000 });

    await page.getByTestId("note-editor-back").click();
    await expect(page.getByText(noteTitle)).toBeVisible();

    await page.getByRole("button", { name: tag }).click();
    await expect(page.getByText(noteTitle)).toBeVisible();
  });

  test.describe("Discover tab", () => {
    test("can switch to Discover tab and see trending repos", async ({
      page,
    }) => {
      await page.goto("/projects");
      await expect(
        page.getByRole("heading", { name: "Open source projects" })
      ).toBeVisible();

      // Switch to Discover tab
      await page.getByRole("button", { name: "Discover" }).click();

      // Should see trending section
      await expect(page.getByRole("heading", { name: "Trending on GitHub" })).toBeVisible();

      // Should see time range toggles
      await expect(page.getByRole("button", { name: "Today" })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "This Week" })
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "This Month" })
      ).toBeVisible();

      // Should see URL input
      await expect(
        page.getByPlaceholder(/github\.com/)
      ).toBeVisible();
    });

    test("can switch between My Projects and Discover tabs", async ({
      page,
    }) => {
      await page.goto("/projects");

      // Switch to Discover
      await page.getByRole("button", { name: "Discover" }).click();
      await expect(page.getByRole("heading", { name: "Trending on GitHub" })).toBeVisible();

      // Switch back to My Projects
      await page.getByRole("button", { name: "My Projects" }).click();
      await expect(
        page.getByRole("button", { name: "Add project" })
      ).toBeVisible();
    });
  });
});
