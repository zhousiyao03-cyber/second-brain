import { test, expect } from "@playwright/test";

const uid = () => Math.random().toString(36).slice(2, 8);

// V1 收敛：Learn 模块已从导航隐藏，跳过相关测试（路由仍可用，功能未删除）
test.describe.skip("Phase 5: 学习模块", () => {
  test("学习页面加载成功", async ({ page }) => {
    await page.goto("/learn");
    await expect(page.locator("main h1")).toContainText("学习");
  });

  test("显示空状态和初始化按钮", async ({ page }) => {
    await page.goto("/learn");
    // Either shows paths or empty state with seed button
    const hasContent =
      (await page.getByText("初始化推荐路径").isVisible().catch(() => false)) ||
      (await page.locator("button").filter({ hasText: /.+/ }).count()) > 0;
    expect(hasContent).toBeTruthy();
  });

  test("初始化预置学习路径并查看详情", async ({ page }) => {
    await page.goto("/learn");

    // Seed if empty
    const seedBtn = page.getByRole("button", { name: "初始化推荐路径" });
    if (await seedBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(seedBtn).toBeEnabled();
      await seedBtn.click({ force: true });
      await expect(
        page.getByText("数据库设计与优化").first()
      ).toBeVisible({ timeout: 10000 });
    }

    // Should show learning path cards
    const pathCard = page.getByText("数据库设计与优化").first();
    await expect(pathCard).toBeVisible({ timeout: 5000 });

    // Click to see detail
    await pathCard.click();
    await expect(page.getByText("返回学习路径")).toBeVisible();
    await expect(page.getByText("AI 生成下一课")).toBeVisible();
  });

  test("generate-lesson API endpoint 存在", async ({ request }) => {
    const response = await request.post("/api/generate-lesson", {
      data: { pathId: "nonexistent" },
    });
    // Should return 404 for path not found
    expect(response.status()).toBe(404);
  });
});

test.describe("Phase 5: AI 探索", () => {
  test("探索页面加载成功", async ({ page }) => {
    await page.goto("/explore");
    await expect(page.locator("main h1")).toContainText("AI 探索");
  });

  test("显示空状态和探索按钮", async ({ page }) => {
    await page.goto("/explore");
    await expect(page.getByText("开始探索")).toBeVisible();
    await expect(page.getByText("AI 会分析你的笔记")).toBeVisible();
  });

  test("explore API endpoint 存在", async ({ request }) => {
    const response = await request.post("/api/explore");
    // Will fail with auth error but endpoint exists
    expect(response.status()).not.toBe(404);
  });
});

// V1 收敛：Workflows 模块已从导航隐藏，跳过相关测试（路由仍可用，功能未删除）
test.describe.skip("Phase 5: 工作流模块", () => {
  test("工作流页面加载成功", async ({ page }) => {
    await page.goto("/workflows");
    await expect(page.locator("main h1")).toContainText("工作流");
  });

  test("显示新建按钮", async ({ page }) => {
    await page.goto("/workflows");
    await expect(page.getByText("新建")).toBeVisible();
  });

  test("创建工作流", async ({ page }) => {
    const name = `wf-${uid()}`;
    await page.goto("/workflows");

    await page.getByText("新建").click();
    await page.locator("input[placeholder='工作流名称']").fill(name);
    await page.getByRole("button", { name: "创建" }).click();

    await expect(page.getByText(name).first()).toBeVisible({ timeout: 5000 });
  });

  test("工作流列表有内容", async ({ page }) => {
    await page.goto("/workflows");
    // After previous tests created workflows, there should be items
    await expect(
      page.locator("div.group").first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("查看工作流详情", async ({ page }) => {
    const name = `detail-${uid()}`;
    await page.goto("/workflows");

    await page.getByText("新建").click();
    await page.locator("input[placeholder='工作流名称']").fill(name);
    await page.getByRole("button", { name: "创建" }).click();
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 5000 });

    // Click to view detail
    await page.locator("div.group").filter({ hasText: name }).first().click();
    await expect(page.getByText("返回工作流列表")).toBeVisible();
  });

  test("删除工作流", async ({ page }) => {
    const name = `delwf-${uid()}`;
    await page.goto("/workflows");

    await page.getByText("新建").click();
    await page.locator("input[placeholder='工作流名称']").fill(name);
    await page.getByRole("button", { name: "创建" }).click();
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 5000 });

    const row = page.locator("div.group").filter({ hasText: name }).first();
    await row.hover();
    await row.locator("button[title='删除']").click();

    await expect(page.getByText(name)).not.toBeVisible({ timeout: 5000 });
  });
});
