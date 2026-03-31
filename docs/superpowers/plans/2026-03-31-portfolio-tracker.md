# Portfolio Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `/portfolio` 页面，支持美股和加密货币持仓管理、实时价格拉取、盈亏计算，以及每日 AI 新闻聚合（GPT + Vercel Cron）。

**Architecture:** 持仓和新闻数据存 SQLite（Drizzle ORM），价格数据通过 tRPC 服务端实时从 Yahoo Finance / CoinGecko 拉取不持久化，新闻每天通过 Vercel Cron 调用 `generateStructuredData` 生成并缓存，页面左栏显示持仓概览，右栏显示选中标的新闻。

**Tech Stack:** Next.js 15 App Router, tRPC v11, Drizzle ORM, SQLite, Vercel Cron, Vercel AI SDK (GPT via existing provider), Tailwind CSS v4, lucide-react

---

## File Map

| 文件 | 动作 | 职责 |
|------|------|------|
| `src/server/db/schema.ts` | 修改 | 新增 `portfolioHoldings` 和 `portfolioNews` 两张表 |
| `src/server/routers/portfolio.ts` | 新建 | tRPC router：持仓 CRUD + 价格拉取 + 新闻读写 |
| `src/server/routers/_app.ts` | 修改 | 注册 portfolioRouter |
| `src/app/api/cron/portfolio-news/route.ts` | 新建 | Vercel Cron handler，每日调用 GPT 聚合新闻 |
| `vercel.json` | 新建 | 配置 Vercel Cron schedule |
| `src/app/(app)/portfolio/page.tsx` | 新建 | 页面 server component 入口 |
| `src/app/(app)/portfolio/_client.tsx` | 新建 | 页面客户端逻辑（持仓列表 + 新闻面板） |
| `src/components/layout/navigation.ts` | 修改 | 新增 Portfolio 导航入口 |

---

## Task 1: 数据库 Schema — 新增两张表

**Files:**
- Modify: `src/server/db/schema.ts`

- [ ] **Step 1: 在 schema.ts 末尾追加两张表**

在 `src/server/db/schema.ts` 文件末尾追加：

```typescript
export const portfolioHoldings = sqliteTable("portfolio_holdings", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  assetType: text("asset_type", { enum: ["stock", "crypto"] }).notNull(),
  quantity: real("quantity").notNull(),
  costPrice: real("cost_price").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const portfolioNews = sqliteTable("portfolio_news", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  summary: text("summary").notNull(),
  sentiment: text("sentiment", { enum: ["bullish", "bearish", "neutral"] }).notNull(),
  generatedAt: integer("generated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});
```

- [ ] **Step 2: 生成并应用迁移**

```bash
pnpm db:generate
pnpm db:push
```

预期输出：`db:generate` 在 `drizzle/` 下生成新迁移文件；`db:push` 输出 `Your schema changes have been applied`（或类似成功信息）。

- [ ] **Step 3: Commit**

```bash
git add src/server/db/schema.ts drizzle/
git commit -m "feat: add portfolio_holdings and portfolio_news tables"
```

---

## Task 2: tRPC Router — 持仓 CRUD

**Files:**
- Create: `src/server/routers/portfolio.ts`
- Modify: `src/server/routers/_app.ts`

- [ ] **Step 1: 创建 portfolio router 文件（先实现持仓 CRUD）**

新建 `src/server/routers/portfolio.ts`：

```typescript
import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { portfolioHoldings, portfolioNews } from "../db/schema";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod/v4";

export const portfolioRouter = router({
  // ── 持仓 CRUD ──────────────────────────────────────────────
  getHoldings: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select()
      .from(portfolioHoldings)
      .where(eq(portfolioHoldings.userId, ctx.userId))
      .orderBy(desc(portfolioHoldings.createdAt));
  }),

  addHolding: protectedProcedure
    .input(
      z.object({
        symbol: z.string().min(1).max(20).transform((s) => s.toUpperCase()),
        name: z.string().min(1).max(100),
        assetType: z.enum(["stock", "crypto"]),
        quantity: z.number().positive(),
        costPrice: z.number().positive(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const id = crypto.randomUUID();
      await db.insert(portfolioHoldings).values({
        id,
        userId: ctx.userId,
        ...input,
      });
      return { id };
    }),

  updateHolding: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        quantity: z.number().positive().optional(),
        costPrice: z.number().positive().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await db
        .update(portfolioHoldings)
        .set({ ...data, updatedAt: new Date() })
        .where(
          and(
            eq(portfolioHoldings.id, id),
            eq(portfolioHoldings.userId, ctx.userId)
          )
        );
      return { id };
    }),

  deleteHolding: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db
        .delete(portfolioHoldings)
        .where(
          and(
            eq(portfolioHoldings.id, input.id),
            eq(portfolioHoldings.userId, ctx.userId)
          )
        );
      return { success: true };
    }),

  // ── 新闻（占位，Task 4 补充实现）──────────────────────────────
  getNews: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select()
      .from(portfolioNews)
      .where(eq(portfolioNews.userId, ctx.userId))
      .orderBy(desc(portfolioNews.generatedAt));
  }),

  refreshNews: protectedProcedure
    .input(z.object({ symbol: z.string() }))
    .mutation(async () => {
      // placeholder — real implementation in Task 4
      return { success: true };
    }),

  // ── 价格（占位，Task 3 补充实现）──────────────────────────────
  getPrices: protectedProcedure
    .input(z.object({ symbols: z.array(z.string()), assetTypes: z.array(z.enum(["stock", "crypto"])) }))
    .query(async () => {
      // placeholder — real implementation in Task 3
      return {} as Record<string, { price: number | null; changePercent: number | null }>;
    }),
});
```

- [ ] **Step 2: 在 _app.ts 注册 portfolioRouter**

修改 `src/server/routers/_app.ts`：

```typescript
import { router } from "../trpc";
import { notesRouter } from "./notes";
import { bookmarksRouter } from "./bookmarks";
import { todosRouter } from "./todos";
import { learningRouter } from "./learning";
import { workflowsRouter } from "./workflows";
import { dashboardRouter } from "./dashboard";
import { focusRouter } from "./focus";
import { tokenUsageRouter } from "./token-usage";
import { portfolioRouter } from "./portfolio";

export const appRouter = router({
  notes: notesRouter,
  bookmarks: bookmarksRouter,
  todos: todosRouter,
  learning: learningRouter,
  workflows: workflowsRouter,
  dashboard: dashboardRouter,
  focus: focusRouter,
  tokenUsage: tokenUsageRouter,
  portfolio: portfolioRouter,
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 3: TypeScript 编译检查**

```bash
pnpm build
```

预期：构建成功，无类型错误。

- [ ] **Step 4: Commit**

```bash
git add src/server/routers/portfolio.ts src/server/routers/_app.ts
git commit -m "feat: add portfolio tRPC router with holding CRUD"
```

---

## Task 3: 价格拉取 — Yahoo Finance + CoinGecko

**Files:**
- Modify: `src/server/routers/portfolio.ts`

- [ ] **Step 1: 实现 `getPrices` procedure**

将 `portfolio.ts` 中的 `getPrices` 占位实现替换为完整实现：

```typescript
getPrices: protectedProcedure
  .input(
    z.object({
      symbols: z.array(z.string()),
      assetTypes: z.array(z.enum(["stock", "crypto"])),
    })
  )
  .query(async ({ input }) => {
    const { symbols, assetTypes } = input;
    const result: Record<string, { price: number | null; changePercent: number | null }> = {};

    // 分组
    const stockSymbols = symbols.filter((_, i) => assetTypes[i] === "stock");
    const cryptoSymbols = symbols.filter((_, i) => assetTypes[i] === "crypto");

    // 美股：Yahoo Finance
    for (const sym of stockSymbols) {
      try {
        const res = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`,
          { next: { revalidate: 0 } }
        );
        if (!res.ok) throw new Error(`Yahoo Finance error: ${res.status}`);
        const json = await res.json() as {
          chart?: {
            result?: Array<{
              meta?: { regularMarketPrice?: number; regularMarketChangePercent?: number };
            }>;
          };
        };
        const meta = json.chart?.result?.[0]?.meta;
        result[sym] = {
          price: meta?.regularMarketPrice ?? null,
          changePercent: meta?.regularMarketChangePercent ?? null,
        };
      } catch {
        result[sym] = { price: null, changePercent: null };
      }
    }

    // 加密货币：CoinGecko（symbol → coingecko id 映射，常见标的）
    const CRYPTO_ID_MAP: Record<string, string> = {
      BTC: "bitcoin",
      ETH: "ethereum",
      SOL: "solana",
      BNB: "binancecoin",
      XRP: "ripple",
      ADA: "cardano",
      DOGE: "dogecoin",
      AVAX: "avalanche-2",
      DOT: "polkadot",
      MATIC: "matic-network",
      LINK: "chainlink",
      UNI: "uniswap",
      ATOM: "cosmos",
      LTC: "litecoin",
      BCH: "bitcoin-cash",
    };

    if (cryptoSymbols.length > 0) {
      const ids = cryptoSymbols
        .map((s) => CRYPTO_ID_MAP[s])
        .filter(Boolean)
        .join(",");

      if (ids) {
        try {
          const res = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
            { next: { revalidate: 0 } }
          );
          if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
          const json = await res.json() as Record<string, { usd?: number; usd_24h_change?: number }>;

          for (const sym of cryptoSymbols) {
            const id = CRYPTO_ID_MAP[sym];
            if (id && json[id]) {
              result[sym] = {
                price: json[id].usd ?? null,
                changePercent: json[id].usd_24h_change ?? null,
              };
            } else {
              result[sym] = { price: null, changePercent: null };
            }
          }
        } catch {
          for (const sym of cryptoSymbols) {
            result[sym] = { price: null, changePercent: null };
          }
        }
      } else {
        // 未知加密货币 symbol
        for (const sym of cryptoSymbols) {
          result[sym] = { price: null, changePercent: null };
        }
      }
    }

    return result;
  }),
```

- [ ] **Step 2: TypeScript 编译检查**

```bash
pnpm build
```

预期：构建成功，无类型错误。

- [ ] **Step 3: Commit**

```bash
git add src/server/routers/portfolio.ts
git commit -m "feat: implement real-time price fetching via Yahoo Finance and CoinGecko"
```

---

## Task 4: 新闻聚合 — GPT + Vercel Cron

**Files:**
- Modify: `src/server/routers/portfolio.ts`
- Create: `src/app/api/cron/portfolio-news/route.ts`
- Create: `vercel.json`

- [ ] **Step 1: 实现 `refreshNews` procedure（含防抖）**

将 `portfolio.ts` 中的 `refreshNews` 占位实现替换：

```typescript
refreshNews: protectedProcedure
  .input(z.object({ symbol: z.string() }))
  .mutation(async ({ input, ctx }) => {
    const { symbol } = input;

    // 防抖：同一标的 1 小时内不重复调用
    const existing = await db
      .select()
      .from(portfolioNews)
      .where(
        and(
          eq(portfolioNews.userId, ctx.userId),
          eq(portfolioNews.symbol, symbol)
        )
      )
      .limit(1);

    if (existing[0]) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      if (existing[0].generatedAt && existing[0].generatedAt > oneHourAgo) {
        return { success: true, skipped: true };
      }
    }

    const result = await generatePortfolioNews(ctx.userId, symbol);
    return { success: true, skipped: false, ...result };
  }),
```

同时在文件顶部导入 `generateStructuredData`，并在 router 外部定义 `generatePortfolioNews` 辅助函数（在 `portfolioRouter` 定义之前）：

在 `portfolio.ts` 顶部导入：
```typescript
import { generateStructuredData } from "../ai/provider";
import { z } from "zod/v4";
```

在 `export const portfolioRouter = router({` 之前添加：

```typescript
const newsSummarySchema = z.object({
  summary: z.string(),
  sentiment: z.enum(["bullish", "bearish", "neutral"]),
});

export async function generatePortfolioNews(userId: string, symbol: string) {
  const today = new Date().toISOString().split("T")[0];

  const result = await generateStructuredData({
    name: "portfolio_news_summary",
    description: `Search for recent news about ${symbol} (stock or crypto) and summarize in Traditional Chinese or Simplified Chinese.`,
    prompt: `Today is ${today}. Search for the latest news and developments about "${symbol}" from the past 24-48 hours. Summarize the key news in 3-5 bullet points in Chinese. Each bullet should be concise (1-2 sentences). End with an overall market sentiment assessment. Return JSON with "summary" (Markdown bullet list in Chinese) and "sentiment" ("bullish", "bearish", or "neutral").`,
    schema: newsSummarySchema,
  });

  // upsert：有则覆盖，无则插入
  const existing = await db
    .select()
    .from(portfolioNews)
    .where(and(eq(portfolioNews.userId, userId), eq(portfolioNews.symbol, symbol)))
    .limit(1);

  if (existing[0]) {
    await db
      .update(portfolioNews)
      .set({
        summary: result.summary,
        sentiment: result.sentiment,
        generatedAt: new Date(),
      })
      .where(and(eq(portfolioNews.userId, userId), eq(portfolioNews.symbol, symbol)));
  } else {
    await db.insert(portfolioNews).values({
      id: crypto.randomUUID(),
      userId,
      symbol,
      summary: result.summary,
      sentiment: result.sentiment,
    });
  }

  return result;
}
```

- [ ] **Step 2: 创建 Vercel Cron handler**

新建 `src/app/api/cron/portfolio-news/route.ts`：

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { portfolioHoldings } from "@/server/db/schema";
import { generatePortfolioNews } from "@/server/routers/portfolio";

export const maxDuration = 300; // 5 minutes for Vercel Pro, adjust if needed

export async function GET(request: NextRequest) {
  // 验证 CRON_SECRET
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 取所有用户的所有持仓（去重 symbol + userId）
  const holdings = await db.select().from(portfolioHoldings);

  const results: Array<{ userId: string; symbol: string; status: string }> = [];

  for (const holding of holdings) {
    try {
      await generatePortfolioNews(holding.userId, holding.symbol);
      results.push({ userId: holding.userId, symbol: holding.symbol, status: "ok" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cron/portfolio-news] Failed for ${holding.symbol}: ${message}`);
      results.push({ userId: holding.userId, symbol: holding.symbol, status: "error" });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
```

- [ ] **Step 3: 创建 vercel.json**

新建 `vercel.json`（项目根目录）：

```json
{
  "crons": [
    {
      "path": "/api/cron/portfolio-news",
      "schedule": "0 0 * * *"
    }
  ]
}
```

- [ ] **Step 4: TypeScript 编译检查**

```bash
pnpm build
```

预期：构建成功，无类型错误。

- [ ] **Step 5: Commit**

```bash
git add src/server/routers/portfolio.ts src/app/api/cron/portfolio-news/route.ts vercel.json
git commit -m "feat: add GPT news aggregation with Vercel Cron and manual refresh"
```

---

## Task 5: 导航 — 新增 Portfolio 入口

**Files:**
- Modify: `src/components/layout/navigation.ts`

- [ ] **Step 1: 在 navigation.ts 新增 Portfolio 条目**

修改 `src/components/layout/navigation.ts`：

```typescript
import {
  Activity,
  FileText,
  LayoutDashboard,
  MessageCircle,
  Timer,
  TrendingUp,
} from "lucide-react";

export const navigationItems = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/notes", label: "Notes", icon: FileText },
  { href: "/focus", label: "Focus", icon: Timer },
  { href: "/portfolio", label: "Portfolio", icon: TrendingUp },
  ...(process.env.NEXT_PUBLIC_ENABLE_TOKEN_USAGE === "true"
    ? [{ href: "/usage", label: "Token Usage", icon: Activity }]
    : []),
  { href: "/ask", label: "Ask AI", icon: MessageCircle },
] as const;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/navigation.ts
git commit -m "feat: add Portfolio to sidebar navigation"
```

---

## Task 6: 页面 UI — 持仓列表 + 新闻面板

**Files:**
- Create: `src/app/(app)/portfolio/page.tsx`
- Create: `src/app/(app)/portfolio/_client.tsx`

- [ ] **Step 1: 创建 page.tsx（server component 入口）**

新建 `src/app/(app)/portfolio/page.tsx`：

```typescript
import { Metadata } from "next";
import { PortfolioClient } from "./_client";

export const metadata: Metadata = {
  title: "Portfolio",
};

export default function PortfolioPage() {
  return <PortfolioClient />;
}
```

- [ ] **Step 2: 创建 _client.tsx（完整客户端页面）**

新建 `src/app/(app)/portfolio/_client.tsx`：

```typescript
"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  Plus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type AssetType = "stock" | "crypto";
type Sentiment = "bullish" | "bearish" | "neutral";

interface Holding {
  id: string;
  symbol: string;
  name: string;
  assetType: AssetType | null;
  quantity: number;
  costPrice: number;
  createdAt: Date | null;
  updatedAt: Date | null;
}

interface PriceData {
  price: number | null;
  changePercent: number | null;
}

interface NewsItem {
  id: string;
  symbol: string;
  summary: string;
  sentiment: Sentiment | null;
  generatedAt: Date | null;
}

interface AddHoldingDraft {
  symbol: string;
  name: string;
  assetType: AssetType;
  quantity: string;
  costPrice: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatUSD(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function sentimentLabel(sentiment: Sentiment | null) {
  if (sentiment === "bullish") return "看涨";
  if (sentiment === "bearish") return "看跌";
  return "中性";
}

// ── Empty State ────────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <TrendingUp className="mb-4 h-12 w-12 text-stone-300 dark:text-stone-600" />
      <p className="mb-2 text-lg font-medium text-stone-700 dark:text-stone-300">
        还没有持仓
      </p>
      <p className="mb-6 text-sm text-stone-400 dark:text-stone-500">
        添加你的第一个持仓标的开始追踪
      </p>
      <button
        onClick={onAdd}
        className="flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
      >
        <Plus className="h-4 w-4" />
        添加持仓
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
      setError("标的代码和名称不能为空");
      return;
    }
    if (isNaN(qty) || qty <= 0) {
      setError("数量必须大于 0");
      return;
    }
    if (isNaN(cost) || cost <= 0) {
      setError("成本价必须大于 0");
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
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-stone-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
            添加持仓
          </h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-stone-500">标的代码 *</label>
              <input
                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm uppercase dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                placeholder="AAPL / BTC"
                value={draft.symbol}
                onChange={(e) => setDraft((d) => ({ ...d, symbol: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">类型 *</label>
              <select
                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                value={draft.assetType}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, assetType: e.target.value as AssetType }))
                }
              >
                <option value="stock">美股</option>
                <option value="crypto">加密货币</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-stone-500">名称 *</label>
            <input
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
              placeholder="Apple Inc. / Bitcoin"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-stone-500">数量 *</label>
              <input
                type="number"
                min="0"
                step="any"
                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                placeholder="10"
                value={draft.quantity}
                onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-stone-500">成本价 (USD) *</label>
              <input
                type="number"
                min="0"
                step="any"
                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
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
            className="w-full rounded-xl bg-stone-900 py-2 text-sm text-white hover:bg-stone-700 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
          >
            {addMutation.isPending ? "保存中..." : "保存"}
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
  isSelected,
  onClick,
  onDelete,
}: {
  holding: Holding;
  priceData: PriceData | undefined;
  isSelected: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  const currentPrice = priceData?.price ?? null;
  const changePercent = priceData?.changePercent ?? null;
  const currentValue = currentPrice !== null ? currentPrice * holding.quantity : null;
  const costValue = holding.costPrice * holding.quantity;
  const pnl = currentValue !== null ? currentValue - costValue : null;
  const pnlPercent = pnl !== null ? (pnl / costValue) * 100 : null;

  return (
    <div
      onClick={onClick}
      className={cn(
        "group cursor-pointer rounded-xl border p-3 transition-all",
        isSelected
          ? "border-stone-300 bg-white shadow-sm dark:border-stone-700 dark:bg-stone-800"
          : "border-transparent hover:border-stone-200 hover:bg-white/60 dark:hover:border-stone-800 dark:hover:bg-stone-900/60"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-sm font-semibold text-stone-900 dark:text-stone-100">
              {holding.symbol}
            </span>
            <span className="truncate text-xs text-stone-400">{holding.name}</span>
          </div>
          <div className="mt-0.5 text-xs text-stone-500">
            {holding.quantity} {holding.assetType === "crypto" ? "个" : "股"} @{" "}
            {formatUSD(holding.costPrice)}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-medium text-stone-900 dark:text-stone-100">
            {currentPrice !== null ? formatUSD(currentPrice) : "—"}
          </div>
          {changePercent !== null && (
            <div
              className={cn(
                "text-xs font-medium",
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
            "mt-2 flex items-center gap-1 text-xs font-medium",
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

      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="mt-2 hidden text-xs text-red-400 hover:text-red-600 group-hover:block"
      >
        删除
      </button>
    </div>
  );
}

// ── News Panel ─────────────────────────────────────────────────────────────

function NewsPanel({
  symbol,
  newsItems,
  onRefresh,
  isRefreshing,
}: {
  symbol: string | null;
  newsItems: NewsItem[];
  onRefresh: (symbol: string) => void;
  isRefreshing: boolean;
}) {
  const news = symbol ? newsItems.find((n) => n.symbol === symbol) : null;

  if (!symbol) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-stone-400">
        点击左侧标的查看新闻
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-mono text-sm font-semibold text-stone-900 dark:text-stone-100">
            {symbol}
          </h3>
          {news && (
            <div className="mt-0.5 flex items-center gap-2 text-xs text-stone-400">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  news.sentiment === "bullish"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                    : news.sentiment === "bearish"
                      ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400"
                )}
              >
                {sentimentLabel(news.sentiment)}
              </span>
              {news.generatedAt && (
                <span>
                  更新于{" "}
                  {new Date(news.generatedAt).toLocaleString("zh-CN", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => onRefresh(symbol)}
          disabled={isRefreshing}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-100 disabled:opacity-50 dark:text-stone-400 dark:hover:bg-stone-800"
        >
          <RefreshCw className={cn("h-3 w-3", isRefreshing && "animate-spin")} />
          刷新
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {news ? (
          <div className="prose prose-sm prose-stone dark:prose-invert max-w-none text-sm">
            {news.summary.split("\n").map((line, i) => {
              const stripped = line.replace(/^[-•*]\s*/, "");
              if (!stripped.trim()) return null;
              return (
                <div key={i} className="mb-2 flex gap-2">
                  <span className="mt-1 shrink-0 text-stone-300">•</span>
                  <span className="text-stone-700 dark:text-stone-300">{stripped}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-stone-400">
            新闻将在今日 08:00 自动生成，或点击刷新立即获取。
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export function PortfolioClient() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [refreshingSymbol, setRefreshingSymbol] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const holdingsQuery = trpc.portfolio.getHoldings.useQuery();
  const newsQuery = trpc.portfolio.getNews.useQuery();

  const holdings: Holding[] = holdingsQuery.data ?? [];
  const newsItems: NewsItem[] = newsQuery.data ?? [];

  const symbols = holdings.map((h) => h.symbol);
  const assetTypes = holdings.map((h) => h.assetType ?? "stock");

  const pricesQuery = trpc.portfolio.getPrices.useQuery(
    { symbols, assetTypes },
    { enabled: symbols.length > 0 }
  );
  const prices = pricesQuery.data ?? {};

  // 总资产 & 总盈亏
  let totalValue = 0;
  let totalCost = 0;
  let hasAllPrices = symbols.length > 0;

  for (const h of holdings) {
    const p = prices[h.symbol];
    const cost = h.costPrice * h.quantity;
    totalCost += cost;
    if (p?.price != null) {
      totalValue += p.price * h.quantity;
    } else {
      hasAllPrices = false;
    }
  }

  const totalPnl = hasAllPrices ? totalValue - totalCost : null;
  const totalPnlPercent = totalPnl !== null && totalCost > 0 ? (totalPnl / totalCost) * 100 : null;

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
    if (confirm("确认删除这条持仓记录？")) {
      deleteMutation.mutate({ id });
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
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
            {hasAllPrices && totalPnl !== null && (
              <div className="mb-4 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
                <div className="text-xs text-stone-400">总市值</div>
                <div className="mt-0.5 text-xl font-semibold text-stone-900 dark:text-stone-100">
                  {formatUSD(totalValue)}
                </div>
                <div
                  className={cn(
                    "mt-1 flex items-center gap-1 text-sm font-medium",
                    totalPnl >= 0 ? "text-emerald-600" : "text-red-500"
                  )}
                >
                  {totalPnl >= 0 ? (
                    <TrendingUp className="h-3.5 w-3.5" />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5" />
                  )}
                  {formatUSD(Math.abs(totalPnl))}{" "}
                  {totalPnlPercent !== null && `(${formatPercent(totalPnlPercent)})`}
                </div>
              </div>
            )}

            {/* 持仓列表 */}
            <div className="space-y-1">
              {holdingsQuery.isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-16 animate-pulse rounded-xl bg-stone-100 dark:bg-stone-800"
                    />
                  ))}
                </div>
              ) : (
                holdings.map((h) => (
                  <HoldingCard
                    key={h.id}
                    holding={h}
                    priceData={prices[h.symbol]}
                    isSelected={selectedSymbol === h.symbol}
                    onClick={() => setSelectedSymbol(h.symbol)}
                    onDelete={() => handleDelete(h.id)}
                  />
                ))
              )}
            </div>

            <button
              onClick={() => setShowAddModal(true)}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-stone-200 py-2.5 text-sm text-stone-400 transition-colors hover:border-stone-300 hover:text-stone-600 dark:border-stone-800 dark:hover:border-stone-700 dark:hover:text-stone-300"
            >
              <Plus className="h-4 w-4" />
              添加持仓
            </button>
          </div>

          {/* 右栏：新闻面板 */}
          <div className="min-h-64 flex-1 rounded-xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900 md:min-h-[500px]">
            <NewsPanel
              symbol={selectedSymbol ?? (holdings[0]?.symbol ?? null)}
              newsItems={newsItems}
              onRefresh={handleRefresh}
              isRefreshing={refreshingSymbol !== null}
            />
          </div>
        </div>
      )}

      {showAddModal && (
        <AddHoldingModal
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            utils.portfolio.getHoldings.invalidate();
            pricesQuery.refetch();
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: TypeScript 编译检查**

```bash
pnpm build
```

预期：构建成功，无类型错误。

- [ ] **Step 4: ESLint 检查**

```bash
pnpm lint
```

预期：无错误。

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/portfolio/page.tsx src/app/(app)/portfolio/_client.tsx
git commit -m "feat: add Portfolio page with holdings list and news panel"
```

---

## Task 7: 端到端验证

**Files:** 无新增

- [ ] **Step 1: 启动开发服务器并手动测试**

```bash
pnpm dev
```

打开 `http://localhost:3000/portfolio`，按以下步骤验证：

1. 侧边栏能看到 "Portfolio" 入口
2. 点进去看到空状态提示
3. 点 "添加持仓"，填写：Symbol `AAPL`，名称 `Apple Inc.`，类型 `美股`，数量 `10`，成本价 `150`
4. 保存后左栏出现 AAPL 卡片，显示当前价和涨跌幅（可能需要几秒）
5. 再添加 `BTC`，类型 `加密货币`，数量 `0.1`，成本价 `60000`
6. 点击 AAPL 卡片 → 右栏切换到 AAPL
7. 点"刷新"按钮 → 等待 GPT 生成新闻摘要（10-30 秒）
8. 新闻显示后检查：有情绪标签、有更新时间、有中文摘要
9. 再次点刷新 → 若在 1 小时内，应跳过重新生成（响应快）
10. hover 持仓卡片 → 出现"删除"按钮，点击后弹出确认框

- [ ] **Step 2: 运行完整构建验证**

```bash
pnpm build && pnpm lint
```

预期：全部通过。

- [ ] **Step 3: Commit 最终验证**

```bash
git add -p  # 确认无意外文件
git commit -m "feat: complete portfolio tracker - holdings, prices, news aggregation"
```

---

## 环境变量说明

在 Vercel Dashboard 中需要设置：

| 变量名 | 说明 | 示例值 |
|--------|------|--------|
| `CRON_SECRET` | Vercel Cron 鉴权密钥 | 随机字符串，如 `openssl rand -hex 32` 的输出 |

本地开发时 Cron 不会自动触发，可通过手动刷新按钮测试 GPT 新闻聚合功能。
