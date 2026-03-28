import { test, expect } from "@playwright/test";

const uid = () => Math.random().toString(36).slice(2, 8);

test.describe("V1 核心路径 A：笔记 → 搜索", () => {
  test("侧边栏搜索按钮可以打开搜索弹窗", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /搜索/ }).click();

    await expect(
      page.locator("input[placeholder='搜索笔记、收藏、待办...']")
    ).toBeVisible();
  });

  test("创建笔记并通过 Cmd+K 搜索到", async ({ page }) => {
    const noteTitle = `v1-note-${uid()}`;

    // Create a note
    await page.goto("/notes");
    await page.getByText("新建笔记").click();
    await page.waitForURL(/\/notes\/.+/);

    // Set title
    const titleInput = page.locator("textarea[placeholder='无标题']");
    await titleInput.fill(noteTitle);
    // Wait for auto-save
    await page.waitForTimeout(2000);
    await expect(page.getByText("已保存")).toBeVisible({ timeout: 5000 });

    // Go home and search
    await page.goto("/");
    await expect(page.getByRole("button", { name: /搜索/ })).toBeVisible();
    await page.keyboard.press("Meta+k");
    const searchInput = page.locator(
      "input[placeholder='搜索笔记、收藏、待办...']"
    );
    await expect(searchInput).toBeVisible();
    await searchInput.fill(noteTitle);

    // Should find the note
    await expect(page.getByText(noteTitle).last()).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe("V1 核心路径 B：收藏 → 搜索", () => {
  test("创建收藏并通过 Cmd+K 搜索到", async ({ page }) => {
    const bmTitle = `v1-bm-${uid()}`;

    // Create a bookmark
    await page.goto("/bookmarks");
    await page.getByText("添加收藏").click();
    await page.locator("input[placeholder='标题']").fill(bmTitle);
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText(bmTitle).first()).toBeVisible();

    // Search via Cmd+K
    await page.keyboard.press("Meta+k");
    const searchInput = page.locator(
      "input[placeholder='搜索笔记、收藏、待办...']"
    );
    await expect(searchInput).toBeVisible();
    await searchInput.fill(bmTitle);

    // Should find the bookmark
    await expect(page.getByText(bmTitle).last()).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe("V1 核心路径：Ask AI", () => {
  test("Ask AI 页面可以发送消息", async ({ page }) => {
    await page.goto("/ask");
    const input = page.locator("textarea[placeholder='使用 AI 处理各种任务...']");
    await input.fill("你好");
    await page.locator("button[type='submit']").click();

    // User message should appear
    await expect(page.getByText("你好").first()).toBeVisible({ timeout: 5000 });
    // Input cleared
    await expect(input).toHaveValue("");
  });

  test("chat API endpoint 存在", async ({ request }) => {
    const response = await request.get("/api/chat");
    expect(response.status()).toBe(405);
  });

  test("chat API 拒绝非法输入", async ({ request }) => {
    const response = await request.post("/api/chat", {
      data: { invalid: true },
    });
    expect(response.status()).toBe(400);
  });
});

test.describe("V1 核心路径：Bookmark 搜索/筛选", () => {
  test("收藏列表可以按来源筛选", async ({ page }) => {
    await page.goto("/bookmarks");
    const filter = page.locator("select[aria-label='按来源筛选']");
    await expect(filter).toBeVisible();
    await filter.selectOption("url");
    await filter.selectOption("text");
    await filter.selectOption("all");
  });

  test("收藏列表有搜索框", async ({ page }) => {
    await page.goto("/bookmarks");
    await expect(
      page.locator("input[placeholder='搜索收藏...']")
    ).toBeVisible();
  });
});

test.describe("V1 核心路径：Token Usage", () => {
  test("录入 token usage 后会同步出现在 Dashboard", async ({ page }) => {
    const sessionNote = `usage-${uid()}`;

    await page.goto("/usage");
    // Skip if token usage feature is disabled (page redirects to /)
    if (!page.url().includes("/usage")) {
      test.skip();
      return;
    }
    await expect(page.getByRole("heading", { name: "Token Usage" })).toBeVisible();

    await page.getByRole("button", { name: "添加记录" }).click();
    const usageForm = page.locator("form").first();
    await usageForm.getByLabel("Provider").selectOption("openai-api");
    await usageForm.getByLabel("Model").fill("gpt-5.4-mini");
    await usageForm.getByLabel("Total tokens").fill("12345");
    await usageForm.getByLabel("Notes").fill(sessionNote);
    await page.getByRole("button", { name: "保存记录" }).click();

    await expect(page.getByText("已记录 12,345 tokens")).toBeVisible({
      timeout: 5000,
    });
    await expect(usageForm).not.toBeVisible();
    await expect(page.getByText(sessionNote)).toBeVisible({ timeout: 5000 });

    await page.goto("/");
    await expect(page.getByText("本月 Token")).toBeVisible();
    await expect(page.getByText("Token Usage")).toBeVisible();
    await expect(page.locator("main")).toContainText("OpenAI API", {
      timeout: 5000,
    });
  });

  test("已打开的 usage 页面会自动刷新新记录", async ({ page, context }) => {
    const sessionModel = `auto-refresh-${uid()}`;
    const observerPage = page;
    const writerPage = await context.newPage();

    await observerPage.goto("/usage");
    // Skip if token usage feature is disabled (page redirects to /)
    if (!observerPage.url().includes("/usage")) {
      test.skip();
      return;
    }
    await expect(observerPage.getByRole("heading", { name: "Token Usage" })).toBeVisible();

    await writerPage.goto("/usage");
    await writerPage.getByRole("button", { name: "添加记录" }).click();

    const usageForm = writerPage.locator("form").first();
    await usageForm.getByLabel("Provider").selectOption("openai-api");
    await usageForm.getByLabel("Model").fill(sessionModel);
    await usageForm.getByLabel("Total tokens").fill("4321");
    await writerPage.getByRole("button", { name: "保存记录" }).click();

    await expect(writerPage.getByText("已记录 4,321 tokens")).toBeVisible({
      timeout: 5000,
    });
    await expect(observerPage.locator("main")).toContainText(sessionModel, {
      timeout: 8000,
    });

    await writerPage.close();
  });
});
