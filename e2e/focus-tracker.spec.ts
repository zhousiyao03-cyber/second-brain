import { expect, test } from "@playwright/test";

function localIsoAt(hour: number, minute: number) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

test.describe("Focus Tracker flow", () => {
  test("dashboard focus card and /focus page render uploaded sessions without duplicates", async ({
    page,
    request,
  }) => {
    const deviceId = `focus-device-${Date.now()}`;
    const payload = {
      deviceId,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      sessions: [
        {
          sourceSessionId: `${deviceId}-vscode`,
          appName: "Visual Studio Code",
          windowTitle: "focus.ts - second-brain",
          startedAt: localIsoAt(9, 0),
          endedAt: localIsoAt(10, 0),
        },
        {
          sourceSessionId: `${deviceId}-chrome`,
          appName: "Google Chrome",
          windowTitle: "Focus metrics",
          startedAt: localIsoAt(10, 5),
          endedAt: localIsoAt(10, 30),
        },
      ],
    };

    const firstUpload = await request.post("/api/focus/ingest", { data: payload });
    expect(firstUpload.ok()).toBeTruthy();
    const secondUpload = await request.post("/api/focus/ingest", { data: payload });
    expect(secondUpload.ok()).toBeTruthy();

    await page.goto("/");
    await expect(page.getByTestId("dashboard-focus-card")).toBeVisible();
    await expect(page.getByTestId("dashboard-focus-card")).toContainText("Visual Studio Code");
    await page.getByTestId("dashboard-focus-card").click();

    await expect(page).toHaveURL("/focus");
    await expect(page.getByRole("heading", { name: "Focus", exact: true })).toBeVisible();
    await expect(page.getByTestId("focus-total-secs")).toContainText("1h 25m");
    await expect(page.getByTestId("focus-session-count")).toContainText("2");
    await expect(page.getByTestId("focus-session-list")).toContainText("Visual Studio Code");
    await expect(page.getByTestId("focus-session-list")).toContainText("Google Chrome");
    await expect(page.getByRole("heading", { name: "Filtered out" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Raw activity" })).toHaveCount(0);

    await expect(page.getByTestId("focus-summary-card")).toBeVisible();
    await page.getByRole("button", { name: "Regenerate summary" }).click();
    await expect(page.getByTestId("focus-summary-card")).not.toContainText(
      "No daily summary yet."
    );
    await expect(page.getByTestId("focus-summary-card")).not.toHaveText(/^\s*$/);

    await page.getByRole("button", { name: "Generate pairing code" }).click();
    await expect(page.getByText(/^[A-Z2-9]{10}$/)).toBeVisible();
  });

  test("focus page merges the same workflow across two short interruptions", async ({
    page,
    request,
  }) => {
    const deviceId = `focus-merge-${Date.now()}`;
    const payload = {
      deviceId,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      sessions: [
        {
          sourceSessionId: `${deviceId}-code-a`,
          appName: "Code",
          windowTitle: "index.tsx — web_monorepo-master",
          startedAt: localIsoAt(15, 19),
          endedAt: localIsoAt(15, 28),
        },
        {
          sourceSessionId: `${deviceId}-chrome-a`,
          appName: "Google Chrome",
          windowTitle: "Google Chrome",
          startedAt: localIsoAt(15, 28),
          endedAt: localIsoAt(15, 32),
        },
        {
          sourceSessionId: `${deviceId}-devtools-a`,
          appName: "HybridDevtool",
          windowTitle: "DevTool (electron) (v0.0.72)",
          startedAt: localIsoAt(15, 33),
          endedAt: localIsoAt(15, 38),
        },
        {
          sourceSessionId: `${deviceId}-code-b`,
          appName: "Code",
          windowTitle: "index.tsx — web_monorepo-master",
          startedAt: localIsoAt(15, 38),
          endedAt: localIsoAt(15, 44),
        },
      ],
    };

    const upload = await request.post("/api/focus/ingest", { data: payload });
    expect(upload.ok()).toBeTruthy();

    await page.goto("/focus");
    await expect(page.getByRole("heading", { name: "Focus", exact: true })).toBeVisible();
    await expect(page.getByTestId("focus-session-count")).toContainText("1");
    await expect(page.getByTestId("focus-session-list")).toContainText("Code");
    await expect(page.getByTestId("focus-session-list")).toContainText("2 short interruptions");
    await expect(page.getByTestId("focus-session-list")).toContainText("3:19 PM-3:44 PM");
  });
});
