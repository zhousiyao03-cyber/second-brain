import { test, expect } from "@playwright/test";

test.describe("Auth: register", () => {
  test("未登录访问受保护页会跳到登录页，注册成功后自动进入首页", async ({ page }) => {
    await page.goto("/notes");
    await expect(page).toHaveURL(/\/login$/);

    await page.getByRole("link", { name: /注册/i }).click();
    await expect(page).toHaveURL(/\/register$/);

    await page.getByLabel("昵称").fill("Mobile User");
    await page.getByLabel("邮箱").fill("mobile-user@example.com");
    await page.getByLabel("密码", { exact: true }).fill("password123");
    await page.getByLabel("确认密码").fill("password123");
    await page.getByRole("button", { name: "创建账号" }).click();

    await expect(page).toHaveURL("/");
    await expect(page.locator("main h1")).toContainText("首页");
  });
});

test.describe("Auth: login", () => {
  test("错误密码会显示表单错误", async ({ page }) => {
    await page.goto("/register");

    await page.getByLabel("昵称").fill("Existing User");
    await page.getByLabel("邮箱").fill("existing@example.com");
    await page.getByLabel("密码", { exact: true }).fill("password123");
    await page.getByLabel("确认密码").fill("password123");
    await page.getByRole("button", { name: "创建账号" }).click();

    await expect(page).toHaveURL("/");

    await page.getByRole("button", { name: "登出" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("邮箱").fill("existing@example.com");
    await page.getByLabel("密码", { exact: true }).fill("wrong-password");
    await page.getByRole("button", { name: "使用邮箱登录" }).click();

    await expect(page).toHaveURL(/\/login\?error=credentials$/);
    await expect(page.getByText("邮箱或密码错误")).toBeVisible();
    await expect(page).toHaveURL(/\/login(?:\?error=credentials)?$/);
  });
});

test.describe("Mobile Nav", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("移动端可以打开菜单并跳转到笔记页", async ({ page }) => {
    await page.goto("/register");

    await page.getByLabel("昵称").fill("Nav User");
    await page.getByLabel("邮箱").fill("nav-user@example.com");
    await page.getByLabel("密码", { exact: true }).fill("password123");
    await page.getByLabel("确认密码").fill("password123");
    await page.getByRole("button", { name: "创建账号" }).click();

    await expect(page).toHaveURL("/");

    await page.getByRole("button", { name: "打开菜单" }).click();
    await page
      .locator("div.fixed.inset-0 nav")
      .getByRole("link", { name: "笔记", exact: true })
      .click();

    await expect(page).toHaveURL("/notes");
    await expect(page.locator("main h1")).toContainText("笔记");
  });
});
