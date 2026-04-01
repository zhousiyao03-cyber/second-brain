export type PortfolioAssetType = "stock" | "crypto";

export interface PortfolioAnalysisHoldingInput {
  symbol: string;
  name: string;
  assetType: PortfolioAssetType;
  currentValue: number;
  portfolioWeight: number;
  pnl: number | null;
  pnlPercent: number | null;
  dailyChange: number | null;
}

export interface PortfolioAnalysisInput {
  totalValue: number;
  totalPnl: number | null;
  totalPnlPercent: number | null;
  totalDailyChange: number | null;
  holdings: PortfolioAnalysisHoldingInput[];
  selectedSymbol: string | null;
}

export interface PortfolioAnalysisFallback {
  portfolio: {
    overall: string;
    diagnostics: string[];
    findings: string[];
    suggestions: string[];
  };
  holding: {
    diagnosis: string[];
    suggestion: string;
  } | null;
}

function formatPercent(value: number) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatCompactUSD(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value);
}

export function buildPortfolioAnalysisFallback(
  input: PortfolioAnalysisInput
): PortfolioAnalysisFallback {
  const holdings = [...input.holdings].sort((left, right) => right.currentValue - left.currentValue);
  const winners = holdings.filter((item) => item.pnl !== null && item.pnl > 0);
  const losers = holdings.filter((item) => item.pnl !== null && item.pnl < 0);
  const biggestHolding = holdings[0] ?? null;
  const topThreeWeight = holdings.slice(0, 3).reduce((sum, item) => sum + item.portfolioWeight, 0);
  const stockValue = holdings
    .filter((item) => item.assetType === "stock")
    .reduce((sum, item) => sum + item.currentValue, 0);
  const cryptoValue = holdings
    .filter((item) => item.assetType === "crypto")
    .reduce((sum, item) => sum + item.currentValue, 0);
  const bestHolding = [...winners].sort((a, b) => (b.pnl ?? 0) - (a.pnl ?? 0))[0] ?? null;
  const worstHolding = [...losers].sort((a, b) => (a.pnl ?? 0) - (b.pnl ?? 0))[0] ?? null;

  let overall = "组合较为均衡，当前没有特别突出的单一仓位风险。";
  if (biggestHolding && biggestHolding.portfolioWeight >= 45) {
    overall = `组合明显集中在 ${biggestHolding.symbol}，单一仓位波动会显著影响整体表现。`;
  } else if (topThreeWeight >= 70) {
    overall = "组合前几大持仓占比较高，整体更像高集中配置而不是分散配置。";
  } else if (losers.length > winners.length) {
    overall = "当前组合的亏损仓位偏多，压力更像来自结构分布而不是单一标的。";
  }

  const diagnostics = [
    biggestHolding
      ? `当前最大仓位是 ${biggestHolding.symbol}，约占组合 ${formatPercent(biggestHolding.portfolioWeight)}。`
      : "当前还没有足够的持仓数据来判断集中度。",
    `前 3 大持仓合计约占 ${formatPercent(topThreeWeight)}，${topThreeWeight >= 70 ? "集中度偏高" : "集中度仍可接受"}。`,
    `股票 / 加密市值占比约为 ${formatPercent(input.totalValue > 0 ? (stockValue / input.totalValue) * 100 : 0)} / ${formatPercent(input.totalValue > 0 ? (cryptoValue / input.totalValue) * 100 : 0)}。`,
  ];

  const findings = [
    bestHolding
      ? `${bestHolding.symbol} 是当前主要盈利来源，累计贡献 ${formatCompactUSD(bestHolding.pnl)}。`
      : "当前组合里暂无明显的盈利主力仓位。",
    worstHolding
      ? `${worstHolding.symbol} 是当前主要拖累项，累计浮亏 ${formatCompactUSD(Math.abs(worstHolding.pnl ?? 0))}。`
      : "当前组合里暂无明显的亏损拖累仓位。",
    `${losers.length} 个亏损仓 / ${winners.length} 个盈利仓，说明当前收益分布${losers.length > winners.length ? "偏弱" : "相对均衡"}。`,
  ];

  const suggestions = [
    biggestHolding && biggestHolding.portfolioWeight >= 45
      ? `如果你的目标是长期稳健持有，可考虑把 ${biggestHolding.symbol} 的权重逐步压到 35%-40% 以下。`
      : "当前最大仓位还在可控范围内，重点关注是否继续无意识地向头部仓位集中。",
    losers.length > winners.length
      ? "组合里亏损仓位数量偏多，建议先区分“长期逻辑未变”和“只是被动套牢”的持仓。"
      : "盈利仓位数量更多，建议关注盈利是否过度集中在少数标的上。",
    cryptoValue > input.totalValue * 0.35
      ? "加密仓位占比不低，组合波动会明显放大；若你更重视稳健，可以考虑控制 crypto 暴露。"
      : "如果你希望提高进攻性，可再明确是否要主动增加高波动资产，而不是让组合被动漂移。",
  ];

  const selected = input.selectedSymbol
    ? holdings.find((item) => item.symbol === input.selectedSymbol) ?? null
    : holdings[0] ?? null;

  const holding = selected
    ? {
      diagnosis: [
        `${selected.symbol} 当前约占组合 ${formatPercent(selected.portfolioWeight)}，${selected.portfolioWeight >= 35 ? "已经是高权重仓位。" : "暂时不是组合主导仓位。"}`,
        selected.pnl !== null
          ? `${selected.symbol} 累计${selected.pnl >= 0 ? "浮盈" : "浮亏"} ${formatCompactUSD(Math.abs(selected.pnl))}，幅度约 ${selected.pnlPercent !== null ? formatPercent(selected.pnlPercent) : "—"}。`
          : `${selected.symbol} 目前还没有足够的价格数据来计算累计盈亏。`,
        selected.dailyChange !== null
          ? `今天这只仓位单独贡献了 ${selected.dailyChange >= 0 ? "+" : "-"}${formatCompactUSD(Math.abs(selected.dailyChange))} 的组合变化。`
          : "今天这只仓位暂时缺少足够的日内变化数据。",
      ],
      suggestion:
        selected.portfolioWeight >= 40
          ? `如果 ${selected.symbol} 不是你明确想重仓长期持有的核心资产，建议关注集中度是否过高。`
          : selected.pnl !== null && selected.pnl < 0
            ? `如果你准备继续长期持有 ${selected.symbol}，建议重新确认亏损来自短期波动还是持仓逻辑已经变化。`
            : `当前对 ${selected.symbol} 更重要的是持续观察，而不是频繁动作。`,
    }
    : null;

  return {
    portfolio: {
      overall,
      diagnostics,
      findings,
      suggestions,
    },
    holding,
  };
}
