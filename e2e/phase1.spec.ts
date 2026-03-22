import { test, expect } from "@playwright/test";

test.describe("Phase 1: 项目骨架 + 基础布局", () => {
  test("首页加载成功，显示首页标题", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main h1")).toContainText("首页");
  });

  test("侧边栏包含所有导航项", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.locator("aside");

    await expect(sidebar.getByText("Second Brain")).toBeVisible();
    await expect(sidebar.getByText("首页")).toBeVisible();
    await expect(sidebar.getByText("笔记")).toBeVisible();
    await expect(sidebar.getByText("收藏")).toBeVisible();
    await expect(sidebar.getByText("Todo")).toBeVisible();
    await expect(sidebar.getByText("AI 探索")).toBeVisible();
    await expect(sidebar.getByText("Ask AI")).toBeVisible();
  });

  test.describe("侧边栏导航跳转", () => {
    const routes = [
      { label: "笔记", path: "/notes", heading: "笔记" },
      { label: "收藏", path: "/bookmarks", heading: "收藏" },
      { label: "Todo", path: "/todos", heading: "Todo" },
      { label: "AI 探索", path: "/explore", heading: "AI 探索" },
      { label: "Ask AI", path: "/ask", heading: "Ask AI" },
    ];

    for (const route of routes) {
      test(`点击 "${route.label}" 跳转到 ${route.path}`, async ({ page }) => {
        await page.goto("/");
        await page.locator("aside").getByText(route.label, { exact: true }).click();
        await expect(page).toHaveURL(route.path);
        await expect(page.locator("main h1")).toContainText(route.heading);
      });
    }
  });

  test("tRPC API 端点可访问", async ({ request }) => {
    // tRPC batch endpoint should respond (even if no procedure is called)
    const response = await request.get("/api/trpc");
    // tRPC returns 404 for unknown procedures, but the endpoint itself works
    expect(response.status()).toBeLessThan(500);
  });

  test("当前页面侧边栏高亮正确", async ({ page }) => {
    await page.goto("/notes");
    const notesLink = page.locator("aside a[href='/notes']");
    await expect(notesLink).toHaveClass(/bg-gray-200/);

    // Dashboard link should NOT be highlighted
    const dashboardLink = page.locator("aside a[href='/']");
    await expect(dashboardLink).not.toHaveClass(/bg-gray-200/);
  });
});
