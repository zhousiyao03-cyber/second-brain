import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { portfolioHoldings, portfolioNews } from "../db/schema";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { generateStructuredData } from "../ai/provider";

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
