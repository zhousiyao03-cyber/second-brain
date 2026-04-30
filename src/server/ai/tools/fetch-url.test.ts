import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/ai/fetch-content", () => ({
  fetchContent: vi.fn(),
}));

import { fetchContent } from "@/server/ai/fetch-content";
import {
  __resetUrlBudgetsForTest,
  getOrCreateUrlBudget,
  URL_BUDGET_LIMIT,
} from "./fetch-url-budget";
import { makeFetchUrlTool } from "./fetch-url";

const mockedFetchContent = vi.mocked(fetchContent);

type ExecutableTool = {
  execute?: (input: unknown, options: unknown) => Promise<unknown>;
};

const stubOptions = { toolCallId: "tc", messages: [] };

beforeEach(() => {
  __resetUrlBudgetsForTest();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("makeFetchUrlTool", () => {
  it("delegates to fetchContent and returns extracted content", async () => {
    mockedFetchContent.mockResolvedValueOnce({
      title: "Hello",
      content: "world",
      success: true,
    });
    const ctx = {
      userId: "u",
      conversationId: "conv",
      urlBudget: getOrCreateUrlBudget("conv"),
    };
    const t = makeFetchUrlTool(ctx) as ExecutableTool;
    const out = await t.execute!(
      { url: "https://example.com/hello" },
      stubOptions,
    );
    expect(out).toEqual({
      url: "https://example.com/hello",
      title: "Hello",
      content: "world",
    });
    expect(ctx.urlBudget.count).toBe(1);
    expect(ctx.urlBudget.urlsHit.has("https://example.com/hello")).toBe(true);
  });

  it("rejects a URL that's already been fetched in the conversation", async () => {
    const ctx = {
      userId: "u",
      conversationId: "conv-dup",
      urlBudget: getOrCreateUrlBudget("conv-dup"),
    };
    ctx.urlBudget.urlsHit.add("https://example.com/x");
    ctx.urlBudget.count = 1;

    const t = makeFetchUrlTool(ctx) as ExecutableTool;
    const out = await t.execute!(
      { url: "https://example.com/x" },
      stubOptions,
    );
    expect(out).toMatchObject({ error: expect.stringContaining("already") });
    expect(mockedFetchContent).not.toHaveBeenCalled();
  });

  it("rejects when the budget is exhausted", async () => {
    const ctx = {
      userId: "u",
      conversationId: "conv-full",
      urlBudget: getOrCreateUrlBudget("conv-full"),
    };
    ctx.urlBudget.count = URL_BUDGET_LIMIT;

    const t = makeFetchUrlTool(ctx) as ExecutableTool;
    const out = await t.execute!(
      { url: "https://example.com/new" },
      stubOptions,
    );
    expect(out).toMatchObject({
      error: expect.stringContaining("exhausted"),
    });
    expect(mockedFetchContent).not.toHaveBeenCalled();
  });

  it("counts the budget even when the fetch fails", async () => {
    mockedFetchContent.mockResolvedValueOnce({
      title: null,
      content: null,
      success: false,
    });
    const ctx = {
      userId: "u",
      conversationId: "conv-fail",
      urlBudget: getOrCreateUrlBudget("conv-fail"),
    };
    const t = makeFetchUrlTool(ctx) as ExecutableTool;
    const out = await t.execute!(
      { url: "https://example.com/bad" },
      stubOptions,
    );
    expect(out).toMatchObject({ error: expect.stringContaining("Failed") });
    expect(ctx.urlBudget.count).toBe(1);
  });
});
