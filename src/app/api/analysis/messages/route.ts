import { NextRequest, NextResponse } from "next/server";
import { and, gt, eq, asc } from "drizzle-orm";
import { db } from "@/server/db";
import { analysisMessages } from "@/server/db/schema";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("taskId");
  const afterSeq = parseInt(searchParams.get("afterSeq") ?? "0", 10);

  if (!taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  const messages = await db
    .select({
      seq: analysisMessages.seq,
      type: analysisMessages.type,
      tool: analysisMessages.tool,
      summary: analysisMessages.summary,
    })
    .from(analysisMessages)
    .where(
      and(
        eq(analysisMessages.taskId, taskId),
        gt(analysisMessages.seq, afterSeq)
      )
    )
    .orderBy(asc(analysisMessages.seq))
    .limit(200);

  return NextResponse.json({ messages });
}
