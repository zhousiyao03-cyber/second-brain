import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/server/db";
import { usageRecords } from "@/server/db/schema";

const USAGE_SECRET = process.env.USAGE_REPORT_SECRET;

export async function POST(request: NextRequest) {
  // Simple token auth
  if (!USAGE_SECRET) {
    return NextResponse.json({ error: "USAGE_REPORT_SECRET not configured" }, { status: 500 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${USAGE_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    entries?: Array<{
      date: string;
      provider: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cache_write_tokens: number;
    }>;
  };

  if (!body.entries?.length) {
    return NextResponse.json({ error: "No entries provided" }, { status: 400 });
  }

  // Upsert each entry
  for (const entry of body.entries) {
    const existing = await db
      .select()
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.date, entry.date),
          eq(usageRecords.provider, entry.provider),
          eq(usageRecords.model, entry.model),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(usageRecords)
        .set({
          inputTokens: entry.input_tokens,
          outputTokens: entry.output_tokens,
          cacheReadTokens: entry.cache_read_tokens,
          cacheWriteTokens: entry.cache_write_tokens,
          updatedAt: new Date(),
        })
        .where(eq(usageRecords.id, existing[0]!.id));
    } else {
      await db.insert(usageRecords).values({
        date: entry.date,
        provider: entry.provider,
        model: entry.model,
        inputTokens: entry.input_tokens,
        outputTokens: entry.output_tokens,
        cacheReadTokens: entry.cache_read_tokens,
        cacheWriteTokens: entry.cache_write_tokens,
      });
    }
  }

  return NextResponse.json({ status: "ok", count: body.entries.length });
}
