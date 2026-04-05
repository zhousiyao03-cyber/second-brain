import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { analysisMessages } from "@/server/db/schema";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    taskId: string;
    messages: Array<{
      seq: number;
      type: "tool_use" | "tool_result" | "text" | "error";
      tool?: string;
      summary?: string;
    }>;
  };

  if (!body.taskId || !body.messages?.length) {
    return NextResponse.json({ error: "taskId and messages required" }, { status: 400 });
  }

  for (const msg of body.messages) {
    await db.insert(analysisMessages).values({
      taskId: body.taskId,
      seq: msg.seq,
      type: msg.type,
      tool: msg.tool ?? null,
      summary: msg.summary ?? null,
    });
  }

  return NextResponse.json({ status: "ok", count: body.messages.length });
}
