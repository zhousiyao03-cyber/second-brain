import { NextRequest } from "next/server";
import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "@/server/db";
import { daemonChatMessages, chatTasks } from "@/server/db/schema";
import { auth } from "@/lib/auth";
import {
  subscribeToChatEvents,
  type DaemonChatEvent,
} from "@/server/ai/daemon-chat-events";

const POLL_INTERVAL_MS = 200;
const STREAM_TIMEOUT_MS = 150 * 1000; // 2.5 min server-side guard
const QUEUED_TIMEOUT_MS = 8 * 1000; // 8s — if still queued, daemon is likely offline

const testLoaders: {
  loadChatDeltaRows?: ((taskId: string, afterSeq: number) => Promise<Array<{
    seq: number;
    type: "text_delta" | "text_final" | "error";
    delta: string | null;
  }>>) | null;
  loadTaskState?: ((taskId: string) => Promise<{
    status: "queued" | "running" | "completed" | "failed" | "cancelled";
    totalText: string | null;
    error: string | null;
  } | null>) | null;
} = {};

export function toSseFrame(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function loadChatDeltaRows(taskId: string, afterSeq: number) {
  if (testLoaders.loadChatDeltaRows) {
    return testLoaders.loadChatDeltaRows(taskId, afterSeq);
  }

  return db
    .select({
      seq: daemonChatMessages.seq,
      type: daemonChatMessages.type,
      delta: daemonChatMessages.delta,
    })
    .from(daemonChatMessages)
    .where(and(eq(daemonChatMessages.taskId, taskId), gt(daemonChatMessages.seq, afterSeq)))
    .orderBy(asc(daemonChatMessages.seq))
    .limit(500);
}

export async function emitChatCatchupRows(
  taskId: string,
  afterSeq: number,
  send: (event: string, data: unknown) => void
) {
  const rows = await loadChatDeltaRows(taskId, afterSeq);
  let seq = afterSeq;

  for (const row of rows) {
    send("delta", row);
    seq = Math.max(seq, row.seq);
  }

  return seq;
}

async function loadTaskState(taskId: string) {
  if (testLoaders.loadTaskState) {
    return testLoaders.loadTaskState(taskId);
  }

  const [current] = await db
    .select({
      status: chatTasks.status,
      totalText: chatTasks.totalText,
      error: chatTasks.error,
    })
    .from(chatTasks)
    .where(eq(chatTasks.id, taskId));

  return current ?? null;
}

export function __setChatTokensTestLoadersForUnitTest(loaders: typeof testLoaders) {
  testLoaders.loadChatDeltaRows = loaders.loadChatDeltaRows ?? null;
  testLoaders.loadTaskState = loaders.loadTaskState ?? null;
}

export function __resetChatTokensTestLoaders() {
  testLoaders.loadChatDeltaRows = undefined;
  testLoaders.loadTaskState = undefined;
}

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
        controller.enqueue(encoder.encode(toSseFrame(event, data)));
      };

      let seq = afterSeq;
      const deadline = Date.now() + STREAM_TIMEOUT_MS;
      const queuedDeadline = Date.now() + QUEUED_TIMEOUT_MS;
      let wasPickedUp = false;
      seq = await emitChatCatchupRows(taskId, seq, send);

      let current = await loadTaskState(taskId);
      if (!current) {
        controller.close();
        return;
      }

      if (current.status === "completed") {
        send("done", { totalText: current.totalText ?? "" });
        controller.close();
        return;
      }

      if (current.status === "failed") {
        send("error", { error: current.error ?? "Task failed" });
        controller.close();
        return;
      }

      wasPickedUp = current.status !== "queued";

      const pendingEvents: DaemonChatEvent[] = [];
      let wake: (() => void) | null = null;

      const liveSubscription = await subscribeToChatEvents(taskId, (event) => {
        pendingEvents.push(event);
        wake?.();
      });

      if (!liveSubscription) {
        while (!cancelled && Date.now() < deadline) {
          seq = await emitChatCatchupRows(taskId, seq, send);
          current = await loadTaskState(taskId);

          if (!current) break;
          if (current.status === "completed") {
            send("done", { totalText: current.totalText ?? "" });
            break;
          }
          if (current.status === "failed") {
            send("error", { error: current.error ?? "Task failed" });
            break;
          }
          if (current.status !== "queued") {
            wasPickedUp = true;
          }
          if (!wasPickedUp && current.status === "queued" && Date.now() > queuedDeadline) {
            send("error", {
              error:
                "The AI daemon did not pick up this task. Make sure the daemon is running on your local machine: run `knosi login` then `knosi`.",
            });
            break;
          }

          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }

        if (!cancelled && Date.now() >= deadline) {
          send("error", {
            error: "Request timed out. The AI daemon may be overloaded or offline.",
          });
        }

        controller.close();
        return;
      }

      try {
        seq = await emitChatCatchupRows(taskId, seq, send);

        while (!cancelled && Date.now() < deadline) {
          while (pendingEvents.length > 0) {
            const event = pendingEvents.shift()!;

            if (event.kind === "delta") {
              if (event.seq > seq) {
                send("delta", {
                  seq: event.seq,
                  type: event.type,
                  delta: event.delta,
                });
                seq = event.seq;
              }
              continue;
            }

            if (event.kind === "done") {
              send("done", { totalText: event.totalText });
              controller.close();
              return;
            }

            send("error", { error: event.error });
            controller.close();
            return;
          }

          current = await loadTaskState(taskId);
          if (!current) {
            controller.close();
            return;
          }
          if (current.status !== "queued") {
            wasPickedUp = true;
          }
          if (!wasPickedUp && current.status === "queued" && Date.now() > queuedDeadline) {
            send("error", {
              error:
                "The AI daemon did not pick up this task. Make sure the daemon is running on your local machine: run `knosi login` then `knosi`.",
            });
            controller.close();
            return;
          }

          await Promise.race([
            new Promise<void>((resolve) => {
              wake = resolve;
            }),
            new Promise((resolve) => setTimeout(resolve, 1000)),
          ]);
          wake = null;
        }

        seq = await emitChatCatchupRows(taskId, seq, send);
        current = await loadTaskState(taskId);
        if (current?.status === "completed") {
          send("done", { totalText: current.totalText ?? "" });
        } else if (current?.status === "failed") {
          send("error", { error: current.error ?? "Task failed" });
        } else if (!cancelled) {
          send("error", {
            error: "Request timed out. The AI daemon may be overloaded or offline.",
          });
        }
      } finally {
        await liveSubscription.close();
        controller.close();
      }
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
