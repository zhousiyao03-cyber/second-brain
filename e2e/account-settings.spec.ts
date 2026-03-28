import { expect, test } from "@playwright/test";

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function register(page: import("@playwright/test").Page, options: {
  name: string;
  email: string;
  password: string;
}) {
  await page.goto("/register");
  await page.getByLabel("昵称").fill(options.name);
  await page.getByLabel("邮箱").fill(options.email);
  await page.getByLabel("密码", { exact: true }).fill(options.password);
  await page.getByLabel("确认密码").fill(options.password);
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page).toHaveURL("/");
}

test.describe("Account settings", () => {
  test("支持修改昵称和邮箱，并用新邮箱重新登录", async ({ page }) => {
    const password = "password123";
    const originalEmail = uniqueEmail("settings-user");
    const nextEmail = uniqueEmail("settings-user-updated");

    await register(page, {
      name: "Settings User",
      email: originalEmail,
      password,
    });

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "账号设置" })).toBeVisible();

    await page.getByLabel("昵称").fill("Updated Settings User");
    await page.getByLabel("邮箱").fill(nextEmail);
    await page.getByRole("button", { name: "保存账号信息" }).click();

    await expect(page.getByText("账号信息已更新")).toBeVisible();
    await expect(page.getByLabel("昵称")).toHaveValue("Updated Settings User");
    await expect(page.getByLabel("邮箱")).toHaveValue(nextEmail);

    await page.getByRole("button", { name: "登出" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("邮箱").fill(nextEmail);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "使用邮箱登录" }).click();

    await expect(page).toHaveURL("/");
  });

  test("支持修改密码，并拒绝旧密码登录", async ({ page }) => {
    const originalPassword = "password123";
    const nextPassword = "password456";
    const email = uniqueEmail("settings-password");

    await register(page, {
      name: "Password User",
      email,
      password: originalPassword,
    });

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "账号设置" })).toBeVisible();

    await page.getByLabel("当前密码").fill(originalPassword);
    await page.getByLabel("新密码", { exact: true }).fill(nextPassword);
    await page.getByLabel("确认新密码").fill(nextPassword);
    await page.getByRole("button", { name: "更新密码" }).click();

    await expect(page.getByText("密码已更新")).toBeVisible();

    await page.getByRole("button", { name: "登出" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码", { exact: true }).fill(originalPassword);
    await page.getByRole("button", { name: "使用邮箱登录" }).click();
    await expect(page.getByText("邮箱或密码错误")).toBeVisible();

    await page.goto("/login");
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码", { exact: true }).fill(nextPassword);
    await page.getByRole("button", { name: "使用邮箱登录" }).click();

    await expect(page).toHaveURL("/");
  });
});
