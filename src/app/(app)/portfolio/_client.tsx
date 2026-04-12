"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { buildPortfolioAnalysisFallback } from "@/lib/portfolio-analysis";
import {
  Plus,
  Pencil,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import type {
  AssetType,
  Holding,
  PriceData,
  NewsItem,
  AddHoldingDraft,
  EditHoldingDraft,
  HoldingSnapshot,
} from "./types";
import { formatUSD, formatPercent, calculateDailyChangeAmount } from "./utils";

// ── Empty State ────────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <TrendingUp className="mb-4 h-8 w-8 text-stone-300 dark:text-stone-700" />
      <p className="mb-2 text-sm text-stone-400 dark:text-stone-500">
        No holdings yet
      </p>
      <p className="mb-6 text-xs text-stone-400 dark:text-stone-500">
        Add your first holding to start tracking
      </p>
      <button
        onClick={onAdd}
        className="inline-flex items-center gap-1.5 rounded-md bg-stone-900 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
      >
        <Plus className="h-3.5 w-3.5" />
        Add Holding
      </button>
    </div>
  );
}

// ── Add Holding Modal ──────────────────────────────────────────────────────

function AddHoldingModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<AddHoldingDraft>({
    symbol: "",
    name: "",
    assetType: "stock",
    quantity: "",
    costPrice: "",
  });
  const [error, setError] = useState("");

  const addMutation = trpc.portfolio.addHolding.useMutation({
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err) => setError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const qty = parseFloat(draft.quantity);
    const cost = parseFloat(draft.costPrice);
    if (!draft.symbol || !draft.name) {
      setError("Symbol and name are required");
      return;
    }
    if (isNaN(qty) || qty <= 0) {
      setError("Quantity must be greater than 0");
      return;
    }
    if (isNaN(cost) || cost <= 0) {
      setError("Cost price must be greater than 0");
      return;
    }
    addMutation.mutate({
      symbol: draft.symbol,
      name: draft.name,
      assetType: draft.assetType,
      quantity: qty,
      costPrice: cost,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-md border border-stone-200 bg-white p-6 shadow-xl dark:border-stone-800 dark:bg-stone-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            Add Holding
          </h2>
          <button onClick={onClose} className="text-stone-400 transition-colors hover:text-stone-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="symbol" className="mb-1 block text-[11px] text-stone-500">Symbol *</label>
              <input
                id="symbol"
                className="w-full rounded-md border border-stone-200 bg-white/70 px-3 py-1.5 text-sm uppercase focus:border-stone-400 focus:outline-none dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                placeholder="AAPL / BTC"
                value={draft.symbol}
                onChange={(e) => setDraft((d) => ({ ...d, symbol: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="assetType" className="mb-1 block text-[11px] text-stone-500">Type *</label>
              <select
                id="assetType"
                className="w-full rounded-md border border-stone-200 bg-white/70 px-3 py-1.5 text-sm focus:border-stone-400 focus:outline-none dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                value={draft.assetType}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, assetType: e.target.value as AssetType }))
                }
              >
                <option value="stock">Stock</option>
                <option value="crypto">Crypto</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="name" className="mb-1 block text-[11px] text-stone-500">Name *</label>
            <input
              id="name"
              className="w-full rounded-md border border-stone-200 bg-white/70 px-3 py-1.5 text-sm focus:border-stone-400 focus:outline-none dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
              placeholder="Apple Inc. / Bitcoin"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="quantity" className="mb-1 block text-[11px] text-stone-500">Quantity *</label>
              <input
                id="quantity"
                type="number"
                min="0"
                step="any"
                className="w-full rounded-md border border-stone-200 bg-white/70 px-3 py-1.5 text-sm focus:border-stone-400 focus:outline-none dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                placeholder="10"
                value={draft.quantity}
                onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="costPrice" className="mb-1 block text-[11px] text-stone-500">Cost Price (USD) *</label>
              <input
                id="costPrice"
                type="number"
                min="0"
                step="any"
                className="w-full rounded-md border border-stone-200 bg-white/70 px-3 py-1.5 text-sm focus:border-stone-400 focus:outline-none dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                placeholder="150.00"
                value={draft.costPrice}
                onChange={(e) => setDraft((d) => ({ ...d, costPrice: e.target.value }))}
              />
            </div>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={addMutation.isPending}
            className="w-full rounded-md bg-stone-900 py-1.5 text-xs font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
          >
            {addMutation.isPending ? "Saving..." : "保存"}
          </button>
        </form>
      </div>
    </div>
  );
}

function EditHoldingModal({
  holding,
  onClose,
  onSaved,
}: {
  holding: Holding;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<EditHoldingDraft>({
    quantity: String(holding.quantity),
    costPrice: String(holding.costPrice),
  });
  const [error, setError] = useState("");

  const updateMutation = trpc.portfolio.updateHolding.useMutation({
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err) => setError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const quantity = parseFloat(draft.quantity);
    const costPrice = parseFloat(draft.costPrice);

    if (Number.isNaN(quantity) || quantity <= 0) {
      setError("Quantity must be greater than 0");
      return;
    }

    if (Number.isNaN(costPrice) || costPrice <= 0) {
      setError("Cost price must be greater than 0");
      return;
    }

    updateMutation.mutate({
      id: holding.id,
      quantity,
      costPrice,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-md border border-stone-200 bg-white p-6 shadow-xl dark:border-stone-800 dark:bg-stone-900">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              修改持仓
            </h2>
            <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
              {holding.symbol} · {holding.name}
            </p>
          </div>
          <button onClick={onClose} className="text-stone-400 transition-colors hover:text-stone-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="edit-quantity" className="mb-1 block text-[11px] text-stone-500">
                Quantity *
              </label>
              <input
                id="edit-quantity"
                type="number"
                min="0"
                step="any"
                className="w-full rounded-md border border-stone-200 bg-white/70 px-3 py-1.5 text-sm focus:border-stone-400 focus:outline-none dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                value={draft.quantity}
                onChange={(e) => setDraft((current) => ({ ...current, quantity: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="edit-cost-price" className="mb-1 block text-[11px] text-stone-500">
                Cost Price (USD) *
              </label>
              <input
                id="edit-cost-price"
                type="number"
                min="0"
                step="any"
                className="w-full rounded-md border border-stone-200 bg-white/70 px-3 py-1.5 text-sm focus:border-stone-400 focus:outline-none dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                value={draft.costPrice}
                onChange={(e) => setDraft((current) => ({ ...current, costPrice: e.target.value }))}
              />
            </div>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="w-full rounded-md bg-stone-900 py-1.5 text-xs font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
          >
            {updateMutation.isPending ? "Saving..." : "保存修改"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Holding Card ───────────────────────────────────────────────────────────

function HoldingCard({
  holding,
  priceData,
  totalPortfolioValue,
  isSelected,
  onClick,
  onEdit,
  onDelete,
}: {
  holding: Holding;
  priceData: PriceData | undefined;
  totalPortfolioValue: number;
  isSelected: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const currentPrice = priceData?.price ?? null;
  const changePercent = priceData?.changePercent ?? null;
  const currentValue = currentPrice !== null ? currentPrice * holding.quantity : null;
  const costValue = holding.costPrice * holding.quantity;
  const displayValue = currentValue ?? costValue;
  const pnl = currentValue !== null ? currentValue - costValue : null;
  const pnlPercent = pnl !== null ? (pnl / costValue) * 100 : null;
  const dailyChange = calculateDailyChangeAmount(currentPrice, changePercent, holding.quantity);
  const portfolioWeight = totalPortfolioValue > 0 ? (displayValue / totalPortfolioValue) * 100 : null;

  return (
    <div
      onClick={onClick}
      className={cn(
        "group cursor-pointer rounded-md border p-3 transition-colors",
        isSelected
          ? "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
          : "border-transparent hover:border-stone-200 hover:bg-white/60 dark:hover:border-stone-800 dark:hover:bg-stone-900/60"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-sm font-semibold text-stone-900 dark:text-stone-100">
              {holding.symbol}
            </span>
            <span className="truncate text-[11px] text-stone-400 dark:text-stone-500">{holding.name}</span>
          </div>
          <div className="mt-0.5 text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
            {holding.quantity} {holding.assetType === "crypto" ? "个" : "股"} @{" "}
            {formatUSD(holding.costPrice)}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-medium tabular-nums text-stone-900 dark:text-stone-100">
            {currentPrice !== null ? formatUSD(currentPrice) : "—"}
          </div>
          {changePercent !== null && (
            <div
              className={cn(
                "text-[11px] font-medium tabular-nums",
                changePercent >= 0 ? "text-emerald-600" : "text-red-500"
              )}
            >
              {formatPercent(changePercent)}
            </div>
          )}
        </div>
      </div>

      {pnl !== null && (
        <div
          className={cn(
            "mt-2 flex items-center gap-1 text-[11px] font-medium tabular-nums",
            pnl >= 0 ? "text-emerald-600" : "text-red-500"
          )}
        >
          {pnl >= 0 ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          {formatUSD(Math.abs(pnl))} ({pnlPercent !== null ? formatPercent(pnlPercent) : "—"})
        </div>
      )}

      {dailyChange !== null && (
        <div
          className={cn(
            "mt-1 text-[11px] font-medium tabular-nums",
            dailyChange >= 0 ? "text-emerald-600" : "text-red-500"
          )}
        >
          今日 {dailyChange >= 0 ? "+" : "-"}
          {formatUSD(Math.abs(dailyChange))}
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-stone-500 dark:text-stone-400">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
            持仓金额
          </div>
          <div className="mt-0.5 font-medium tabular-nums text-stone-700 dark:text-stone-200">
            {formatUSD(displayValue)}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
            占组合
          </div>
          <div className="mt-0.5 font-medium tabular-nums text-stone-700 dark:text-stone-200">
            {portfolioWeight !== null ? formatPercent(portfolioWeight) : "—"}
          </div>
        </div>
      </div>

      {confirmingDelete ? (
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-[11px] text-red-500 transition-colors hover:text-red-700"
          >
            确认删除
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirmingDelete(false);
            }}
            className="text-[11px] text-stone-400 transition-colors hover:text-stone-600"
          >
            取消
          </button>
        </div>
      ) : (
        <div className="mt-2 hidden items-center gap-3 group-hover:flex">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="flex items-center gap-1 text-[11px] text-stone-400 transition-colors hover:text-stone-700 dark:hover:text-stone-200"
          >
            <Pencil className="h-3 w-3" />
            修改
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirmingDelete(true);
            }}
            className="text-[11px] text-red-400 transition-colors hover:text-red-600"
          >
            删除
          </button>
        </div>
      )}
    </div>
  );
}

function AnalysisBlock({
  title,
  lines,
}: {
  title: string;
  lines: string[];
}) {
  return (
    <div className="rounded-md border border-stone-200/70 bg-stone-50/70 p-4 dark:border-stone-800/80 dark:bg-stone-900/60">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">{title}</h3>
      <div className="mt-3 space-y-2 text-sm text-stone-600 dark:text-stone-300">
        {lines.map((line, index) => (
          <div key={`${title}-${index}`} className="flex gap-2">
            <span className="mt-1 shrink-0 text-stone-300 dark:text-stone-600">•</span>
            <span>{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PortfolioAnalysisCard({
  analysis,
  totalValue,
  totalPnl,
  totalPnlPercent,
  totalDailyChange,
  holdingsCount,
  isAiGenerated,
}: {
  analysis: ReturnType<typeof buildPortfolioAnalysisFallback>["portfolio"];
  totalValue: number;
  totalPnl: number | null;
  totalPnlPercent: number | null;
  totalDailyChange: number | null;
  holdingsCount: number;
  isAiGenerated: boolean;
}) {
  return (
    <div className="rounded-md border border-stone-200 bg-white/70 p-5 dark:border-stone-800 dark:bg-stone-950/50">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">Portfolio 分析</div>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium",
                isAiGenerated
                  ? "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"
                  : "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
              )}
            >
              {isAiGenerated ? "AI 生成" : "规则兜底"}
            </span>
          </div>
          <h2 className="mt-1 text-base font-semibold text-stone-900 dark:text-stone-100">
            组合诊断与建议
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600 dark:text-stone-300">
            {analysis.overall}
          </p>
        </div>
        <div className="grid min-w-[220px] grid-cols-2 gap-3 text-sm">
          <div className="rounded-md border border-stone-200/70 bg-stone-50/80 p-3 dark:border-stone-800/80 dark:bg-stone-900/60">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">当前市值</div>
            <div className="mt-1 font-semibold tabular-nums text-stone-900 dark:text-stone-100">
              {formatUSD(totalValue)}
            </div>
          </div>
          <div className="rounded-md border border-stone-200/70 bg-stone-50/80 p-3 dark:border-stone-800/80 dark:bg-stone-900/60">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">累计盈亏</div>
            <div className={cn(
              "mt-1 font-semibold tabular-nums",
              totalPnl !== null && totalPnl >= 0 ? "text-emerald-600" : "text-red-500"
            )}>
              {totalPnl !== null ? `${totalPnl >= 0 ? "+" : "-"}${formatUSD(Math.abs(totalPnl))}` : "—"}
              {totalPnlPercent !== null && ` (${formatPercent(totalPnlPercent)})`}
            </div>
          </div>
          <div className="rounded-md border border-stone-200/70 bg-stone-50/80 p-3 dark:border-stone-800/80 dark:bg-stone-900/60">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">今日变化</div>
            <div className={cn(
              "mt-1 font-semibold tabular-nums",
              totalDailyChange !== null && totalDailyChange >= 0 ? "text-emerald-600" : "text-red-500"
            )}>
              {totalDailyChange !== null ? `${totalDailyChange >= 0 ? "+" : "-"}${formatUSD(Math.abs(totalDailyChange))}` : "—"}
            </div>
          </div>
          <div className="rounded-md border border-stone-200/70 bg-stone-50/80 p-3 dark:border-stone-800/80 dark:bg-stone-900/60">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">持仓数量</div>
            <div className="mt-1 font-semibold tabular-nums text-stone-900 dark:text-stone-100">
              {holdingsCount}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <AnalysisBlock title="结构诊断" lines={analysis.diagnostics} />
        <AnalysisBlock title="关键发现" lines={analysis.findings} />
      </div>

      <div className="mt-4">
        <AnalysisBlock title="建议" lines={analysis.suggestions} />
      </div>
    </div>
  );
}

function HoldingAnalysisCard({
  snapshot,
  analysis,
  news,
  onRefresh,
  isRefreshing,
  isAiGenerated,
}: {
  snapshot: HoldingSnapshot | null;
  analysis: ReturnType<typeof buildPortfolioAnalysisFallback>["holding"];
  news: NewsItem | null;
  onRefresh: (symbol: string) => void;
  isRefreshing: boolean;
  isAiGenerated: boolean;
}) {
  if (!snapshot || !analysis) {
    return (
      <div className="rounded-md border border-stone-200 bg-white/70 p-5 text-sm text-stone-400 dark:border-stone-800 dark:bg-stone-950/50 dark:text-stone-500">
        点击左侧标的查看单标分析。
      </div>
    );
  }

  const { holding } = snapshot;

  return (
    <div className="rounded-md border border-stone-200 bg-white/70 p-5 dark:border-stone-800 dark:bg-stone-950/50">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">单标分析</div>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium",
                isAiGenerated
                  ? "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"
                  : "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
              )}
            >
              {isAiGenerated ? "AI 生成" : "规则兜底"}
            </span>
          </div>
          <h3 className="mt-1 text-sm font-semibold text-stone-900 dark:text-stone-100">
            {holding.symbol} · {holding.name}
          </h3>
        </div>
        <button
          onClick={() => onRefresh(holding.symbol)}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2.5 py-1.5 text-xs text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-50 dark:border-stone-800 dark:text-stone-400 dark:hover:bg-stone-900"
        >
          <RefreshCw className={cn("h-3 w-3", isRefreshing && "animate-spin")} />
          刷新
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <AnalysisBlock title="持仓诊断" lines={analysis.diagnosis} />
        <div className="rounded-md border border-stone-200/70 bg-stone-50/70 p-4 dark:border-stone-800/80 dark:bg-stone-900/60">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">建议</h3>
          <p className="mt-3 text-sm leading-6 text-stone-600 dark:text-stone-300">
            {analysis.suggestion}
          </p>
          {news && (
            <div className="mt-4 border-t border-stone-200 pt-4 text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">新闻线索</div>
              {news.summary.split("\n").slice(0, 2).map((line, index) => {
                const stripped = line.replace(/^[-•*]\s*/, "").trim();
                if (!stripped) return null;
                return (
                  <div key={`${holding.symbol}-news-${index}`} className="mb-2 flex gap-2">
                    <span className="mt-1 shrink-0 text-stone-300 dark:text-stone-600">•</span>
                    <span>{stripped}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export function PortfolioClient() {
  const defaultVisibleHoldingsCount = 6;
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingHolding, setEditingHolding] = useState<Holding | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [refreshingSymbol, setRefreshingSymbol] = useState<string | null>(null);
  const [showAllHoldings, setShowAllHoldings] = useState(false);

  const utils = trpc.useUtils();

  const holdingsQuery = trpc.portfolio.getHoldings.useQuery();
  const newsQuery = trpc.portfolio.getNews.useQuery();

  const holdings = useMemo<Holding[]>(() => holdingsQuery.data ?? [], [holdingsQuery.data]);
  const newsItems: NewsItem[] = newsQuery.data ?? [];

  const symbols = useMemo(() => holdings.map((h) => h.symbol), [holdings]);
  const assetTypes = useMemo(
    () => holdings.map((h) => (h.assetType ?? "stock") as "stock" | "crypto"),
    [holdings]
  );

  const pricesQuery = trpc.portfolio.getPrices.useQuery(
    { symbols, assetTypes },
    {
      enabled: symbols.length > 0,
      staleTime: 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    }
  );
  const prices = useMemo<Record<string, PriceData>>(
    () => pricesQuery.data ?? {},
    [pricesQuery.data]
  );
  const sortedHoldings = useMemo(
    () =>
      [...holdings].sort((left, right) => {
        const leftPrice = prices[left.symbol]?.price ?? null;
        const rightPrice = prices[right.symbol]?.price ?? null;
        const leftValue = leftPrice !== null ? leftPrice * left.quantity : left.costPrice * left.quantity;
        const rightValue = rightPrice !== null ? rightPrice * right.quantity : right.costPrice * right.quantity;
        return rightValue - leftValue;
      }),
    [holdings, prices]
  );

  // 总资产 & 总盈亏
  let totalValue = 0;
  let totalCost = 0;
  let totalDailyChange = 0;
  let hasDailyChange = false;

  for (const h of holdings) {
    const p = prices[h.symbol];
    const cost = h.costPrice * h.quantity;
    totalCost += cost;
    if (p?.price != null) {
      totalValue += p.price * h.quantity;
    } else {
      totalValue += cost;
    }

    const dailyChange = calculateDailyChangeAmount(
      p?.price ?? null,
      p?.changePercent ?? null,
      h.quantity
    );
    if (dailyChange !== null) {
      totalDailyChange += dailyChange;
      hasDailyChange = true;
    }
  }

  const totalPnl = holdings.length > 0 ? totalValue - totalCost : null;
  const totalPnlPercent = totalPnl !== null && totalCost > 0 ? (totalPnl / totalCost) * 100 : null;
  const totalDailyChangeDisplay = hasDailyChange ? totalDailyChange : null;
  const totalPortfolioValueForDisplay = totalValue > 0
    ? totalValue
    : holdings.reduce((sum, holding) => sum + (holding.costPrice * holding.quantity), 0);
  const selectedHoldingSnapshot = useMemo(() => {
    const targetSymbol = selectedSymbol ?? sortedHoldings[0]?.symbol ?? null;
    if (!targetSymbol) {
      return null;
    }

    const holding = sortedHoldings.find((item) => item.symbol === targetSymbol);
    if (!holding) {
      return null;
    }

    const priceData = prices[holding.symbol];
    const currentPrice = priceData?.price ?? null;
    const changePercent = priceData?.changePercent ?? null;
    const currentValue = currentPrice !== null ? currentPrice * holding.quantity : null;
    const costValue = holding.costPrice * holding.quantity;
    const displayValue = currentValue ?? costValue;
    const pnl = currentValue !== null ? currentValue - costValue : null;
    const pnlPercent = pnl !== null ? (pnl / costValue) * 100 : null;
    const dailyChange = calculateDailyChangeAmount(currentPrice, changePercent, holding.quantity);

    return {
      holding,
      priceData,
      currentPrice,
      changePercent,
      currentValue,
      costValue,
      displayValue,
      pnl,
      pnlPercent,
      dailyChange,
      portfolioWeight: totalPortfolioValueForDisplay > 0
        ? (displayValue / totalPortfolioValueForDisplay) * 100
        : null,
    } satisfies HoldingSnapshot;
  }, [prices, selectedSymbol, sortedHoldings, totalPortfolioValueForDisplay]);
  const holdingSnapshots = useMemo<HoldingSnapshot[]>(
    () =>
      sortedHoldings.map((holding) => {
        const priceData = prices[holding.symbol];
        const currentPrice = priceData?.price ?? null;
        const changePercent = priceData?.changePercent ?? null;
        const currentValue = currentPrice !== null ? currentPrice * holding.quantity : null;
        const costValue = holding.costPrice * holding.quantity;
        const displayValue = currentValue ?? costValue;
        const pnl = currentValue !== null ? currentValue - costValue : null;
        const pnlPercent = pnl !== null ? (pnl / costValue) * 100 : null;
        const dailyChange = calculateDailyChangeAmount(currentPrice, changePercent, holding.quantity);

        return {
          holding,
          priceData,
          currentPrice,
          changePercent,
          currentValue,
          costValue,
          displayValue,
          pnl,
          pnlPercent,
          dailyChange,
          portfolioWeight: totalPortfolioValueForDisplay > 0
            ? (displayValue / totalPortfolioValueForDisplay) * 100
            : null,
        };
      }),
    [prices, sortedHoldings, totalPortfolioValueForDisplay]
  );
  const analysisInput = useMemo(() => ({
    totalValue,
    totalPnl,
    totalPnlPercent,
    totalDailyChange: totalDailyChangeDisplay,
    selectedSymbol: selectedHoldingSnapshot?.holding.symbol ?? null,
    holdings: holdingSnapshots.map((snapshot) => ({
      symbol: snapshot.holding.symbol,
      name: snapshot.holding.name,
      assetType: (snapshot.holding.assetType ?? "stock") as "stock" | "crypto",
      currentValue: snapshot.displayValue,
      portfolioWeight: snapshot.portfolioWeight ?? 0,
      pnl: snapshot.pnl,
      pnlPercent: snapshot.pnlPercent,
      dailyChange: snapshot.dailyChange,
    })),
  }), [
    holdingSnapshots,
    selectedHoldingSnapshot,
    totalDailyChangeDisplay,
    totalPnl,
    totalPnlPercent,
    totalValue,
  ]);
  const fallbackAnalysis = useMemo(
    () => buildPortfolioAnalysisFallback(analysisInput),
    [analysisInput]
  );
  const analysisQuery = trpc.portfolio.analyze.useQuery(analysisInput, {
    enabled: holdingSnapshots.length > 0,
    staleTime: 5 * 60_000,
  });
  const portfolioAnalysis = analysisQuery.data?.portfolio ?? fallbackAnalysis.portfolio;
  const selectedHoldingAnalysis = analysisQuery.data?.holding ?? fallbackAnalysis.holding;
  const isAiGenerated = analysisQuery.data?.aiGenerated ?? false;
  const visibleHoldings = useMemo(() => {
    if (showAllHoldings || sortedHoldings.length <= defaultVisibleHoldingsCount) {
      return sortedHoldings;
    }

    const baseHoldings = sortedHoldings.slice(0, defaultVisibleHoldingsCount);
    const targetSymbol = selectedSymbol ?? sortedHoldings[0]?.symbol ?? null;
    if (!targetSymbol || baseHoldings.some((holding) => holding.symbol === targetSymbol)) {
      return baseHoldings;
    }

    const selectedHolding = sortedHoldings.find((holding) => holding.symbol === targetSymbol);
    if (!selectedHolding) {
      return baseHoldings;
    }

    return [...baseHoldings.slice(0, defaultVisibleHoldingsCount - 1), selectedHolding];
  }, [selectedSymbol, showAllHoldings, sortedHoldings]);

  const deleteMutation = trpc.portfolio.deleteHolding.useMutation({
    onSuccess: () => utils.portfolio.getHoldings.invalidate(),
  });

  const refreshMutation = trpc.portfolio.refreshNews.useMutation({
    onSuccess: () => utils.portfolio.getNews.invalidate(),
    onSettled: () => setRefreshingSymbol(null),
  });

  const handleRefresh = (symbol: string) => {
    setRefreshingSymbol(symbol);
    refreshMutation.mutate({ symbol });
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate({ id });
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
          投资组合
        </h1>
      </div>

      {holdings.length === 0 && !holdingsQuery.isLoading ? (
        <EmptyState onAdd={() => setShowAddModal(true)} />
      ) : (
        <div className="flex flex-col gap-6 md:flex-row">
          {/* 左栏：持仓概览 */}
          <div className="md:w-72 md:shrink-0">
            {/* 汇总卡片 */}
            {totalPnl !== null && (
              <div className="mb-4 rounded-md border border-stone-200 bg-white/70 p-4 dark:border-stone-800 dark:bg-stone-950/50">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">总市值</div>
                <div className="mt-0.5 text-xl font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                  {formatUSD(totalPortfolioValueForDisplay)}
                </div>
                <div
                  className={cn(
                    "mt-1 flex items-center gap-1 text-sm font-medium tabular-nums",
                    totalPnl >= 0 ? "text-emerald-600" : "text-red-500"
                  )}
                >
                  {totalPnl >= 0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {formatUSD(Math.abs(totalPnl))}{" "}
                  {totalPnlPercent !== null && `(${formatPercent(totalPnlPercent)})`}
                </div>

                {totalDailyChangeDisplay !== null && (
                  <div
                    className={cn(
                      "mt-1 text-[11px] font-medium tabular-nums",
                      totalDailyChangeDisplay >= 0 ? "text-emerald-600" : "text-red-500"
                    )}
                  >
                    今日变化 {totalDailyChangeDisplay >= 0 ? "+" : "-"}
                    {formatUSD(Math.abs(totalDailyChangeDisplay))}
                  </div>
                )}
              </div>
            )}

            {/* 持仓列表 */}
            <div className="space-y-1">
              {holdingsQuery.isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-16 animate-pulse rounded-md bg-stone-100 dark:bg-stone-900"
                    />
                  ))}
                </div>
              ) : (
                visibleHoldings.map((h) => (
                  <HoldingCard
                    key={h.id}
                    holding={h}
                    priceData={prices[h.symbol]}
                    totalPortfolioValue={totalPortfolioValueForDisplay}
                    isSelected={selectedSymbol === h.symbol}
                    onClick={() => setSelectedSymbol(h.symbol)}
                    onEdit={() => setEditingHolding(h)}
                    onDelete={() => handleDelete(h.id)}
                  />
                ))
              )}
            </div>

            {sortedHoldings.length > defaultVisibleHoldingsCount && (
              <button
                onClick={() => setShowAllHoldings((current) => !current)}
                className="mt-3 w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-xs text-stone-500 transition-colors hover:bg-stone-50 hover:text-stone-700 dark:border-stone-800 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-200"
              >
                {showAllHoldings
                  ? "收起持仓列表"
                  : `显示更多持仓（+${sortedHoldings.length - visibleHoldings.length}）`}
              </button>
            )}

            <button
              onClick={() => setShowAddModal(true)}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-stone-200 py-2 text-xs text-stone-400 transition-colors hover:border-stone-300 hover:text-stone-600 dark:border-stone-800 dark:hover:border-stone-700 dark:hover:text-stone-300"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Holding
            </button>
          </div>

          {/* 右栏：组合分析 + 单标分析 */}
          <div className="min-h-64 flex-1 space-y-4 md:min-h-[500px]">
            <PortfolioAnalysisCard
              analysis={portfolioAnalysis}
              totalValue={totalValue}
              totalPnl={totalPnl}
              totalPnlPercent={totalPnlPercent}
              totalDailyChange={totalDailyChangeDisplay}
              holdingsCount={holdingSnapshots.length}
              isAiGenerated={isAiGenerated}
            />
            <HoldingAnalysisCard
              snapshot={selectedHoldingSnapshot}
              analysis={selectedHoldingAnalysis}
              news={
                selectedHoldingSnapshot
                  ? newsItems.find((item) => item.symbol === selectedHoldingSnapshot.holding.symbol) ?? null
                  : null
              }
              onRefresh={handleRefresh}
              isRefreshing={refreshingSymbol !== null}
              isAiGenerated={isAiGenerated}
            />
          </div>
        </div>
      )}

      {showAddModal && (
        <AddHoldingModal
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            utils.portfolio.getHoldings.invalidate();
            utils.portfolio.getNews.invalidate();
            pricesQuery.refetch();
          }}
        />
      )}

      {editingHolding && (
        <EditHoldingModal
          holding={editingHolding}
          onClose={() => setEditingHolding(null)}
          onSaved={() => {
            utils.portfolio.getHoldings.invalidate();
            pricesQuery.refetch();
          }}
        />
      )}
    </div>
  );
}
