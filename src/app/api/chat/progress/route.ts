import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { daemonChatMessages } from "@/server/db/schema";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    taskId: string;
    messages: Array<{
      seq: number;
      type: "text_delta" | "text_final" | "error";
      delta?: string;
    }>;
  };

  if (!body.taskId || !body.messages?.length) {
    return NextResponse.json(
      { error: "taskId and non-empty messages required" },
      { status: 400 }
    );
  }

  for (const msg of body.messages) {
    await db.insert(daemonChatMessages).values({
      taskId: body.taskId,
      seq: msg.seq,
      type: msg.type,
      delta: msg.delta ?? null,
    });
  }

  return NextResponse.json({ status: "ok", count: body.messages.length });
}
