import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "@/server/db";
import { daemonChatMessages, chatTasks } from "@/server/db/schema";
import { auth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (process.env.AUTH_BYPASS !== "true") {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");
    const afterSeq = parseInt(searchParams.get("afterSeq") ?? "0", 10);

    if (!taskId) {
      return NextResponse.json({ error: "taskId required" }, { status: 400 });
    }

    const [task] = await db
      .select({
        userId: chatTasks.userId,
        status: chatTasks.status,
        totalText: chatTasks.totalText,
        error: chatTasks.error,
      })
      .from(chatTasks)
      .where(eq(chatTasks.id, taskId));

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (task.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const messages = await db
      .select({
        seq: daemonChatMessages.seq,
        type: daemonChatMessages.type,
        delta: daemonChatMessages.delta,
      })
      .from(daemonChatMessages)
      .where(
        and(eq(daemonChatMessages.taskId, taskId), gt(daemonChatMessages.seq, afterSeq))
      )
      .orderBy(asc(daemonChatMessages.seq))
      .limit(500);

    return NextResponse.json({
      messages,
      status: task.status,
      totalText: task.status === "completed" ? (task.totalText ?? "") : undefined,
      error: task.status === "failed" ? (task.error ?? "") : undefined,
    });
  }

  // AUTH_BYPASS path — skip ownership check
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("taskId");
  const afterSeq = parseInt(searchParams.get("afterSeq") ?? "0", 10);

  if (!taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  const [task] = await db
    .select({
      status: chatTasks.status,
      totalText: chatTasks.totalText,
      error: chatTasks.error,
    })
    .from(chatTasks)
    .where(eq(chatTasks.id, taskId));

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const messages = await db
    .select({
      seq: daemonChatMessages.seq,
      type: daemonChatMessages.type,
      delta: daemonChatMessages.delta,
    })
    .from(daemonChatMessages)
    .where(and(eq(daemonChatMessages.taskId, taskId), gt(daemonChatMessages.seq, afterSeq)))
    .orderBy(asc(daemonChatMessages.seq))
    .limit(500);

  return NextResponse.json({
    messages,
    status: task.status,
    totalText: task.status === "completed" ? (task.totalText ?? "") : undefined,
    error: task.status === "failed" ? (task.error ?? "") : undefined,
  });
}
