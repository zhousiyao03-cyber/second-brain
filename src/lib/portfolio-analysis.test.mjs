import test from "node:test";
import assert from "node:assert/strict";

import { buildPortfolioAnalysisFallback } from "./portfolio-analysis.ts";

test("buildPortfolioAnalysisFallback flags high concentration and returns holding suggestion", () => {
  const result = buildPortfolioAnalysisFallback({
    totalValue: 100000,
    totalPnl: 12000,
    totalPnlPercent: 12,
    totalDailyChange: -500,
    selectedSymbol: "AAPL",
    holdings: [
      {
        symbol: "AAPL",
        name: "Apple",
        assetType: "stock",
        currentValue: 52000,
        portfolioWeight: 52,
        pnl: 8000,
        pnlPercent: 18,
        dailyChange: -300,
      },
      {
        symbol: "BTC",
        name: "Bitcoin",
        assetType: "crypto",
        currentValue: 30000,
        portfolioWeight: 30,
        pnl: 6000,
        pnlPercent: 25,
        dailyChange: 200,
      },
      {
        symbol: "JD",
        name: "JD.com",
        assetType: "stock",
        currentValue: 18000,
        portfolioWeight: 18,
        pnl: -2000,
        pnlPercent: -10,
        dailyChange: -400,
      },
    ],
  });

  assert.match(result.portfolio.overall, /AAPL/);
  assert.equal(result.portfolio.diagnostics.length, 3);
  assert.equal(result.portfolio.findings.length, 3);
  assert.equal(result.portfolio.suggestions.length, 3);
  assert.ok(result.holding);
  assert.match(result.holding.suggestion, /AAPL/);
});
