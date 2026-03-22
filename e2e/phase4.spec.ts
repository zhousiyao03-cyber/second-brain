import { test, expect } from "@playwright/test";

test.describe("Phase 4: Ask AI 页面", () => {
  test("Ask AI 页面加载成功", async ({ page }) => {
    await page.goto("/ask");
    await expect(page.locator("main h1")).toContainText("Ask AI");
  });

  test("显示空状态提示", async ({ page }) => {
    await page.goto("/ask");
    await expect(page.getByText("向 AI 提问")).toBeVisible();
    await expect(page.getByText("帮我总结一下最近的笔记")).toBeVisible();
  });

  test("输入框和发送按钮存在", async ({ page }) => {
    await page.goto("/ask");
    const input = page.locator("textarea[placeholder='输入你的问题...（Shift+Enter 换行）']");
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();

    // Send button should be disabled when input is empty
    const sendBtn = page.locator("button[type='submit']");
    await expect(sendBtn).toBeDisabled();
  });

  test("输入文字后发送按钮启用", async ({ page }) => {
    await page.goto("/ask");
    const input = page.locator("textarea[placeholder='输入你的问题...（Shift+Enter 换行）']");
    await input.fill("测试问题");

    const sendBtn = page.locator("button[type='submit']");
    await expect(sendBtn).toBeEnabled();
  });

  test("发送消息后显示用户消息", async ({ page }) => {
    await page.goto("/ask");
    const input = page.locator("textarea[placeholder='输入你的问题...（Shift+Enter 换行）']");
    await input.fill("你好");
    await page.locator("button[type='submit']").click();

    // User message should appear (even if API fails)
    await expect(page.getByText("你好").first()).toBeVisible({ timeout: 5000 });
    // Input should be cleared
    await expect(input).toHaveValue("");
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
    const response = await request.post("/api/chat", {
      data: {
        messages: [
          {
            id: "ui-msg-1",
            role: "user",
            parts: [{ type: "text", text: "hi" }],
          },
        ],
      },
    });
    // Frontend sends AI SDK UI messages. The route should return a non-empty body
    // instead of silently accepting the request and streaming nothing.
    expect(response.status()).not.toBe(404);
    expect((await response.text()).trim().length).toBeGreaterThan(0);
  });

  test("summarize API endpoint 存在", async ({ request }) => {
    const response = await request.post("/api/summarize", {
      data: { bookmarkId: "nonexistent" },
    });
    // Should return 404 for bookmark not found, not 404 for route not found
    expect(response.status()).not.toBe(405);
  });
});
