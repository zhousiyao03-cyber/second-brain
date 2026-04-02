import { test, expect } from "@playwright/test";

type HoldingInput = {
  symbol: string;
  name: string;
  assetType?: "stock" | "crypto";
  quantity: number;
  costPrice: number;
};

async function trpcMutation<TInput, TOutput>(
  request: import("@playwright/test").APIRequestContext,
  procedure: string,
  input: TInput
) {
  const response = await request.post(`/api/trpc/${procedure}?batch=1`, {
    data: {
      0: {
        json: input,
      },
    },
  });
  const responseText = await response.text();
  expect(response.ok(), `${procedure} failed with ${response.status()}: ${responseText}`).toBeTruthy();
  const payload = JSON.parse(responseText) as Array<{ result?: { data?: { json?: TOutput } } }>;
  return payload[0]?.result?.data?.json as TOutput;
}

function trackRuntimeErrors(page: import("@playwright/test").Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  return { pageErrors, consoleErrors };
}

async function expectNoRuntimeErrors(
  page: import("@playwright/test").Page,
  tracker: ReturnType<typeof trackRuntimeErrors>
) {
  await page.waitForLoadState("networkidle");
  expect(tracker.pageErrors, `Unexpected page errors: ${tracker.pageErrors.join("\n")}`).toEqual([]);
  expect(
    tracker.consoleErrors.filter((message) => !message.includes("favicon")),
    `Unexpected console errors: ${tracker.consoleErrors.join("\n")}`
  ).toEqual([]);
}

async function seedHolding(
  request: import("@playwright/test").APIRequestContext,
  holding: HoldingInput
) {
  await trpcMutation(request, "portfolio.addHolding", {
    symbol: holding.symbol,
    name: holding.name,
    assetType: holding.assetType ?? "stock",
    quantity: holding.quantity,
    costPrice: holding.costPrice,
  });
}

test("Portfolio page keeps analysis and totals stable across key user flows", async ({ page, request }) => {
  const runtime = trackRuntimeErrors(page);

  await seedHolding(request, {
    symbol: "NOQUOTE1",
    name: "No Quote One",
    quantity: 10,
    costPrice: 100,
  });
  await seedHolding(request, {
    symbol: "NOQUOTE2",
    name: "No Quote Two",
    quantity: 5,
    costPrice: 50,
  });
  for (let index = 3; index <= 8; index += 1) {
    await seedHolding(request, {
      symbol: `LONG${index}`,
      name: `Long Holding ${index}`,
      quantity: index,
      costPrice: 10 + index,
    });
  }

  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { name: "投资组合" })).toBeVisible();

  const summaryCard = page.getByText("总市值").locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
  await expect(summaryCard).toContainText("$1,779.00");
  await expect(summaryCard).toContainText("$0.00");

  await expect(page.getByRole("heading", { name: "组合诊断与建议" })).toBeVisible();
  await expect(page.getByText(/AI 生成|规则兜底/).first()).toBeVisible();
  await expect(page.getByText("NOQUOTE1 · No Quote One")).toBeVisible();
  await expect(page.getByText("持仓诊断")).toBeVisible();

  await expect(page.getByText("LONG5")).toBeVisible();
  await expect(page.getByText("LONG4")).not.toBeVisible();
  await expect(page.getByRole("button", { name: /显示更多持仓/ })).toBeVisible();

  await page.getByRole("button", { name: /显示更多持仓/ }).click();
  await expect(page.getByText("LONG8")).toBeVisible();
  await expect(page.getByText("LONG4")).toBeVisible();
  await expect(page.getByText("LONG3")).toBeVisible();
  await page.getByRole("button", { name: "收起持仓列表" }).click();
  await expect(page.getByText("LONG4")).not.toBeVisible();

  const targetCard = page
    .getByText("NOQUOTE1")
    .locator("xpath=ancestor::div[contains(@class,'group')][1]");
  await targetCard.hover();
  await expect(targetCard.getByRole("button", { name: "修改" })).toBeVisible();
  await targetCard.getByRole("button", { name: "修改" }).click();

  const editDialog = page.locator("form").filter({ has: page.getByRole("button", { name: "保存修改" }) });
  await editDialog.getByLabel("数量 *").fill("20");
  await editDialog.getByLabel("成本价 (USD) *").fill("80");
  await page.getByRole("button", { name: "保存修改" }).click();

  await expect(summaryCard).toContainText("$2,379.00");
  await expect(summaryCard).toContainText("$0.00");

  await expectNoRuntimeErrors(page, runtime);
});
