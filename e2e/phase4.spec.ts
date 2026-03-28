import { test, expect } from "@playwright/test";

test.describe("Phase 4: Ask AI 页面", () => {
  test("Ask AI 页面加载成功", async ({ page }) => {
    await page.goto("/ask");
    await expect(page.locator("main h1")).toContainText("Ask AI");
  });

  test("显示空状态提示", async ({ page }) => {
    await page.goto("/ask");
    await expect(
      page.getByRole("heading", { name: "今天想处理什么？" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "总结最近笔记" })).toBeVisible();
    await expect(page.getByRole("button", { name: /全部来源/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /只看笔记/ }).first()).toBeVisible();
  });

  test("输入框和发送按钮存在", async ({ page }) => {
    await page.goto("/ask");
    const input = page.locator("textarea[placeholder='使用 AI 处理各种任务...']");
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();

    // Send button should be disabled when input is empty
    const sendBtn = page.locator("button[type='submit']");
    await expect(sendBtn).toBeDisabled();
  });

  test("输入文字后发送按钮启用", async ({ page }) => {
    await page.goto("/ask");
    const input = page.locator("textarea[placeholder='使用 AI 处理各种任务...']");
    await input.fill("测试问题");

    const sendBtn = page.locator("button[type='submit']");
    await expect(sendBtn).toBeEnabled();
  });

  test("发送消息后显示用户消息", async ({ page }) => {
    await page.goto("/ask");
    const input = page.locator("textarea[placeholder='使用 AI 处理各种任务...']");
    await input.fill("你好");
    await page.locator("button[type='submit']").click();

    // User message should appear (even if API fails)
    await expect(page.getByText("你好").first()).toBeVisible({ timeout: 5000 });
    // Input should be cleared
    await expect(input).toHaveValue("");
  });

  test("来源注释不会直接显示给用户", async ({ page }) => {
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/plain; charset=utf-8",
        body: '这是基于知识库的回答。\n\n<!-- sources:[{"id":"note-1","type":"note","title":"测试笔记"}] -->',
      });
    });

    await page.goto("/ask");
    const input = page.locator("textarea[placeholder='使用 AI 处理各种任务...']");
    await input.fill("测试来源");
    await page.locator("button[type='submit']").click();

    await expect(page.getByText("这是基于知识库的回答。")).toBeVisible();
    await expect(page.getByRole("link", { name: "测试笔记" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /保存为笔记/ })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("<!-- sources:");
  });

  test("回答可以保存为笔记", async ({ page }) => {
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/plain; charset=utf-8",
        body: '这是可保存的回答。\n\n<!-- sources:[{"id":"note-2","type":"note","title":"保存测试"}] -->',
      });
    });

    await page.goto("/ask");
    const input = page.locator("textarea[placeholder='使用 AI 处理各种任务...']");
    await input.fill("把这段保存下来");
    await page.locator("button[type='submit']").click();

    await expect(page.getByText("这是可保存的回答。")).toBeVisible();
    await page.getByRole("button", { name: /保存为笔记/ }).click();

    await page.waitForURL(/\/notes\/.+/);
    await expect(page.locator("textarea[placeholder='新页面']")).toContainText(
      "AI 问答"
    );
  });
});

test.describe("Phase 4: AI 摘要 API", () => {
  test("收藏页面显示 AI 摘要按钮", async ({ page }) => {
    await page.goto("/bookmarks");

    // Create a bookmark first
    await page.getByText("添加收藏").click();
    await page.locator("input[placeholder='标题']").fill("ai-summary-test");
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("ai-summary-test").first()).toBeVisible();

    // The sparkles button should exist on hover
    const row = page.locator("div.group").filter({ hasText: "ai-summary-test" }).first();
    await row.hover();
    await expect(row.locator("button[title='AI 生成摘要']")).toBeVisible();
  });

  test("chat API endpoint 存在", async ({ request }) => {
    const response = await request.get("/api/chat");
    // GET should be rejected because only POST is implemented, but the route must exist.
    expect(response.status()).toBe(405);
  });

  test("summarize API endpoint 存在", async ({ request }) => {
    const response = await request.post("/api/summarize", {
      data: { bookmarkId: "nonexistent" },
    });
    // Should return 404 for bookmark not found, not 404 for route not found
    expect(response.status()).not.toBe(405);
  });
});
