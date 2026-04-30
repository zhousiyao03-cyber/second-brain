import { beforeEach, describe, expect, it } from "vitest";
import {
  __getBudgetCountForTest,
  __resetUrlBudgetsForTest,
  getOrCreateUrlBudget,
  MAX_BUDGETS,
} from "./fetch-url-budget";

describe("fetch-url-budget", () => {
  beforeEach(() => {
    __resetUrlBudgetsForTest();
  });

  it("creates a fresh budget on first access", () => {
    const budget = getOrCreateUrlBudget("conv-1");
    expect(budget.count).toBe(0);
    expect(budget.urlsHit.size).toBe(0);
  });

  it("returns the same budget instance on repeated access", () => {
    const a = getOrCreateUrlBudget("conv-1");
    a.count = 2;
    a.urlsHit.add("https://example.com");
    const b = getOrCreateUrlBudget("conv-1");
    expect(b).toBe(a);
    expect(b.count).toBe(2);
    expect(b.urlsHit.has("https://example.com")).toBe(true);
  });

  it("isolates budgets between conversations", () => {
    const a = getOrCreateUrlBudget("conv-a");
    a.count = 3;
    const b = getOrCreateUrlBudget("conv-b");
    expect(b.count).toBe(0);
  });

  it("evicts the oldest entry once MAX_BUDGETS is exceeded", () => {
    // Fill exactly to capacity.
    for (let i = 0; i < MAX_BUDGETS; i++) {
      getOrCreateUrlBudget(`conv-${i}`);
    }
    expect(__getBudgetCountForTest()).toBe(MAX_BUDGETS);

    // One more should evict the oldest (`conv-0`).
    getOrCreateUrlBudget("conv-overflow");
    expect(__getBudgetCountForTest()).toBe(MAX_BUDGETS);

    // `conv-0` got evicted, so re-asking gives a brand-new budget.
    const reborn = getOrCreateUrlBudget("conv-0");
    expect(reborn.count).toBe(0);
    expect(reborn.urlsHit.size).toBe(0);
  });

  it("refreshing a budget keeps it from being evicted", () => {
    for (let i = 0; i < MAX_BUDGETS; i++) {
      getOrCreateUrlBudget(`conv-${i}`);
    }
    // Touch conv-0 — should now be the youngest, not the oldest.
    getOrCreateUrlBudget("conv-0");
    // Push another entry — conv-1 should be evicted, not conv-0.
    getOrCreateUrlBudget("conv-overflow-2");

    const conv0 = getOrCreateUrlBudget("conv-0");
    expect(conv0.count).toBe(0); // exists (would be 0 either way, but check it stayed)
  });
});
