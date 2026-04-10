import { NextRequest } from "next/server";
import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "@/server/db";
import { daemonChatMessages, chatTasks } from "@/server/db/schema";
import { auth } from "@/lib/auth";

const POLL_INTERVAL_MS = 200;
const STREAM_TIMEOUT_MS = 150 * 1000; // 2.5 min server-side guard

export async function GET(request: NextRequest) {
  // --- Auth ---
  let userId: string | null = null;
  if (process.env.AUTH_BYPASS !== "true") {
    const session = await auth();
    if (!session?.user?.id) {
      return new Response("Unauthorized", { status: 401 });
    }
    userId = session.user.id;
  }

  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("taskId");
  const afterSeq = parseInt(searchParams.get("afterSeq") ?? "0", 10);

  if (!taskId) {
    return new Response("taskId required", { status: 400 });
  }

  // Verify task exists (and ownership if auth is on)
  const [task] = await db
    .select({ userId: chatTasks.userId, status: chatTasks.status })
    .from(chatTasks)
    .where(eq(chatTasks.id, taskId));

  if (!task) {
    return new Response("Task not found", { status: 404 });
  }
  if (userId && task.userId !== userId) {
    return new Response("Forbidden", { status: 403 });
  }

  // --- SSE stream ---
  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      let seq = afterSeq;
      const deadline = Date.now() + STREAM_TIMEOUT_MS;

      while (!cancelled && Date.now() < deadline) {
        // Fetch new deltas
        const rows = await db
          .select({
            seq: daemonChatMessages.seq,
            type: daemonChatMessages.type,
            delta: daemonChatMessages.delta,
          })
          .from(daemonChatMessages)
          .where(
            and(eq(daemonChatMessages.taskId, taskId), gt(daemonChatMessages.seq, seq))
          )
          .orderBy(asc(daemonChatMessages.seq))
          .limit(500);

        for (const row of rows) {
          send("delta", row);
          seq = Math.max(seq, row.seq);
        }

        // Check task status
        const [current] = await db
          .select({
            status: chatTasks.status,
            totalText: chatTasks.totalText,
            error: chatTasks.error,
          })
          .from(chatTasks)
          .where(eq(chatTasks.id, taskId));

        if (!current) break;

        if (current.status === "completed") {
          send("done", { totalText: current.totalText ?? "" });
          break;
        }
        if (current.status === "failed") {
          send("error", { error: current.error ?? "Task failed" });
          break;
        }

        // Wait before next poll
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }

      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
