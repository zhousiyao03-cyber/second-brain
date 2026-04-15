import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { daemonChatMessages } from "@/server/db/schema";
import { validateBearerAccessToken } from "@/server/integrations/oauth";
import { publishChatEvent } from "@/server/ai/daemon-chat-events";

export async function POST(request: NextRequest) {
  try {
    await validateBearerAccessToken({
      authorization: request.headers.get("authorization"),
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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

  await db.insert(daemonChatMessages).values(
    body.messages.map((msg) => ({
      taskId: body.taskId,
      seq: msg.seq,
      type: msg.type,
      delta: msg.delta ?? null,
    }))
  );

  await Promise.all(
    body.messages.map((msg) =>
      publishChatEvent({
        kind: "delta",
        taskId: body.taskId,
        seq: msg.seq,
        type: msg.type,
        delta: msg.delta ?? null,
      })
    )
  );

  return NextResponse.json({ status: "ok", count: body.messages.length });
}
