import { test, expect } from "@playwright/test";

test.describe("Phase 6: 首页仪表盘", () => {
  test("仪表盘加载成功", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main h1")).toContainText("首页");
  });

  test("显示统计卡片", async ({ page }) => {
    await page.goto("/");
    // Check stat cards exist in main area
    await expect(page.locator("main").getByText("笔记").first()).toBeVisible();
    await expect(page.locator("main").getByText("收藏").first()).toBeVisible();
    await expect(page.locator("main").getByText("待办").first()).toBeVisible();
    await expect(page.locator("main").getByText("学习路径").first()).toBeVisible();
  });

  test("显示最近笔记/收藏/待办区块", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("最近笔记")).toBeVisible();
    await expect(page.getByText("最近收藏")).toBeVisible();
    await expect(page.getByText("待办事项")).toBeVisible();
  });

  test("统计卡片链接跳转", async ({ page }) => {
    await page.goto("/");
    // Click notes card link
    await page.locator("a[href='/notes']").first().click();
    await expect(page).toHaveURL("/notes");
  });
});

test.describe("Phase 6: 全局搜索", () => {
  test("Cmd+K 打开搜索面板", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Meta+k");
    await expect(
      page.locator("input[placeholder='搜索笔记、收藏、待办...']")
    ).toBeVisible();
  });

  test("ESC 关闭搜索面板", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Meta+k");
    await expect(
      page.locator("input[placeholder='搜索笔记、收藏、待办...']")
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.locator("input[placeholder='搜索笔记、收藏、待办...']")
    ).not.toBeVisible();
  });

  test("搜索空状态提示", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Meta+k");
    await expect(page.getByText("输入关键词搜索")).toBeVisible();
  });

  test("搜索无结果提示", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Meta+k");
    const input = page.locator("input[placeholder='搜索笔记、收藏、待办...']");
    await input.fill("zzzznonexistent999");
    await expect(page.getByText("没有找到结果")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Phase 6: 深色模式", () => {
  test("侧边栏有深色模式切换按钮", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("深色模式")).toBeVisible();
  });

  test("点击切换深色模式", async ({ page }) => {
    await page.goto("/");
    await page.getByText("深色模式").click();

    // html should have 'dark' class
    const htmlClass = await page.locator("html").getAttribute("class");
    expect(htmlClass).toContain("dark");

    // Button text should change
    await expect(page.getByText("浅色模式")).toBeVisible();
  });

  test("再次点击切回浅色模式", async ({ page }) => {
    await page.goto("/");
    // Switch to dark
    await page.getByText("深色模式").click();
    await expect(page.getByText("浅色模式")).toBeVisible();

    // Switch back to light
    await page.getByText("浅色模式").click();
    await expect(page.getByText("深色模式")).toBeVisible();

    const htmlClass = await page.locator("html").getAttribute("class");
    expect(htmlClass).not.toContain("dark");
  });
});

test.describe("Phase 6: 搜索 tRPC endpoint", () => {
  test("search endpoint 存在", async ({ request }) => {
    // tRPC batch format
    const input = encodeURIComponent(JSON.stringify({ "0": { query: "test" } }));
    const response = await request.get(
      `/api/trpc/dashboard.search?batch=1&input=${input}`
    );
    // Endpoint exists and responds (not 404)
    expect(response.status()).not.toBe(404);
  });
});
