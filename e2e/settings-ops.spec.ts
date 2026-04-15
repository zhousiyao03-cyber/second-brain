import { expect, test } from "@playwright/test";

test("owner can open the ops dashboard", async ({ page }) => {
  await page.goto("/settings/ops");

  await expect(page.getByRole("heading", { name: "Ops" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Deployment" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Services" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Queue" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "System" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Health" })).toBeVisible();
});
