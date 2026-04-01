import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { portfolioHoldings } from "@/server/db/schema";
import { generatePortfolioNews } from "@/server/routers/portfolio";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const holdings = await db.select().from(portfolioHoldings);

  const results: Array<{ symbol: string; status: string }> = [];

  for (const holding of holdings) {
    try {
      await generatePortfolioNews(holding.userId, holding.symbol);
      results.push({ symbol: holding.symbol, status: "ok" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cron/portfolio-news] Failed for ${holding.symbol}: ${message}`);
      results.push({ symbol: holding.symbol, status: "error" });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
