import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { portfolioHoldings, portfolioNews } from "../db/schema";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { generateStructuredData } from "../ai/provider";
import { fetchRecentPortfolioNewsArticles } from "../portfolio-news";

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

const newsSummarySchema = z.object({
  summary: z.string(),
  sentiment: z.enum(["bullish", "bearish", "neutral"]),
});

export async function generatePortfolioNews(userId: string, symbol: string) {
  const today = new Date().toISOString().split("T")[0];
  const normalizedSymbol = symbol.trim().toUpperCase();
  const holding = await db
    .select({
      name: portfolioHoldings.name,
      assetType: portfolioHoldings.assetType,
    })
    .from(portfolioHoldings)
    .where(
      and(
        eq(portfolioHoldings.userId, userId),
        eq(portfolioHoldings.symbol, normalizedSymbol)
      )
    )
    .limit(1);

  const subjectName = holding[0]?.name?.trim() || normalizedSymbol;
  const subjectType = holding[0]?.assetType ?? null;
  const articles = await fetchRecentPortfolioNewsArticles({
    symbol: normalizedSymbol,
    name: holding[0]?.name ?? normalizedSymbol,
    assetType: subjectType,
  });

  const fallbackSummary = articles.length > 0
    ? articles
      .slice(0, 5)
      .map((article) => (
        `- ${article.title}（${article.source}，${new Date(article.publishedAt).toLocaleString("zh-CN", {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })}）`
      ))
      .join("\n")
    : `- 最近 72 小时内未从公开新闻 RSS 源检索到与“${subjectName}（${normalizedSymbol}）”明确匹配的新闻。\n- 当前新闻面板已改为基于真实外部文章生成；如果这里仍为空，通常意味着该标的覆盖度较低，或 ticker 本身存在歧义。\n- 可尝试补充更准确的持仓名称，或稍后再次刷新。`;

  const result = articles.length === 0
    ? {
      summary: fallbackSummary,
      sentiment: "neutral" as const,
    }
    : await generateStructuredData({
      name: "portfolio_news_summary",
      description: `Summarize recent grounded news for ${subjectName} (${normalizedSymbol}) using only the provided article list.`,
      prompt: [
        `Today is ${today}.`,
        `Target asset: ${subjectName} (${normalizedSymbol}).`,
        `Asset type: ${subjectType ?? "unknown"}.`,
        "Use only the article list below as evidence. Do not claim you searched the web.",
        "If the evidence is thin or ambiguous, say that explicitly.",
        'Return JSON with "summary" (3-5 Chinese bullet points) and "sentiment" ("bullish", "bearish", or "neutral").',
        "",
        "Articles:",
        articles
          .slice(0, 6)
          .map((article, index) => (
            `${index + 1}. ${article.title}\nSource: ${article.source}\nPublished: ${article.publishedAt}\nSnippet: ${article.snippet || "N/A"}\nLink: ${article.link}`
          ))
          .join("\n\n"),
      ].join("\n"),
      schema: newsSummarySchema,
    }).catch(() => ({
      summary: fallbackSummary,
      sentiment: "neutral" as const,
    }));

  // upsert：有则覆盖，无则插入
  const existing = await db
    .select()
    .from(portfolioNews)
    .where(and(eq(portfolioNews.userId, userId), eq(portfolioNews.symbol, normalizedSymbol)))
    .limit(1);

  if (existing[0]) {
    await db
      .update(portfolioNews)
      .set({
        summary: result.summary,
        sentiment: result.sentiment,
        generatedAt: new Date(),
      })
      .where(and(eq(portfolioNews.userId, userId), eq(portfolioNews.symbol, normalizedSymbol)));
  } else {
    await db.insert(portfolioNews).values({
      id: crypto.randomUUID(),
      userId,
      symbol: normalizedSymbol,
      summary: result.summary,
      sentiment: result.sentiment,
    });
  }

  return result;
}

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
      }).refine(
        ({ quantity, costPrice }) => quantity !== undefined || costPrice !== undefined,
        { message: "At least one field must be updated" }
      )
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

  // ── 新闻 ──────────────────────────────────────────────────────
  getNews: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select()
      .from(portfolioNews)
      .where(eq(portfolioNews.userId, ctx.userId))
      .orderBy(desc(portfolioNews.generatedAt));
  }),

  refreshNews: protectedProcedure
    .input(z.object({ symbol: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const result = await generatePortfolioNews(ctx.userId, input.symbol);
      return { success: true, skipped: false, ...result };
    }),

  // ── 价格（Task 3）──────────────────────────────────────────────
  getPrices: protectedProcedure
    .input(
      z.object({
        symbols: z.array(z.string()),
        assetTypes: z.array(z.enum(["stock", "crypto"])),
      }).refine(
        ({ symbols, assetTypes }) => symbols.length === assetTypes.length,
        { message: "symbols and assetTypes must have the same length" }
      )
    )
    .query(async ({ input }) => {
      const { symbols, assetTypes } = input;
      const result: Record<string, { price: number | null; changePercent: number | null }> = {};

      // 分组
      const stockSymbols = symbols.filter((_, i) => assetTypes[i] === "stock");
      const cryptoSymbols = symbols.filter((_, i) => assetTypes[i] === "crypto");

      // 美股：Yahoo Finance（并行请求）
      await Promise.all(
        stockSymbols.map(async (sym) => {
          try {
            const res = await fetch(
              `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`,
              { next: { revalidate: 0 } }
            );
            if (!res.ok) throw new Error(`Yahoo Finance error: ${res.status}`);
            const json = await res.json() as {
              chart?: {
                result?: Array<{
                  meta?: {
                    preMarketPrice?: number;
                    preMarketChangePercent?: number;
                    postMarketPrice?: number;
                    postMarketChangePercent?: number;
                    regularMarketPrice?: number;
                    regularMarketChangePercent?: number;
                  };
                }>;
              };
            };
            const meta = json.chart?.result?.[0]?.meta;
            const price =
              meta?.preMarketPrice ??
              meta?.postMarketPrice ??
              meta?.regularMarketPrice ??
              null;
            const changePercent =
              meta?.preMarketChangePercent ??
              meta?.postMarketChangePercent ??
              meta?.regularMarketChangePercent ??
              null;
            result[sym] = {
              price,
              changePercent,
            };
          } catch {
            result[sym] = { price: null, changePercent: null };
          }
        })
      );

      // 加密货币：CoinGecko（symbol → coingecko id 映射，常见标的）

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
});
