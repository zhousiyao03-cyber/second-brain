import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import {
  subscribeToDaemonTaskNotifications,
  type DaemonTaskType,
} from "@/server/ai/daemon-task-notifications";
import { db } from "@/server/db";
import { chatTasks } from "@/server/db/schema";
import { validateBearerAccessToken } from "@/server/integrations/oauth";

const encoder = new TextEncoder();
const KEEPALIVE_MS = 15_000;

function toSseFrame(event: string, payload: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

async function loadQueuedTaskTypes(userId: string): Promise<DaemonTaskType[]> {
  const [queuedChat] = await db
    .select({ id: chatTasks.id })
    .from(chatTasks)
    .where(
      and(
        eq(chatTasks.userId, userId),
        eq(chatTasks.status, "queued"),
        eq(chatTasks.taskType, "chat")
      )
    )
    .limit(1);

  const [queuedStructured] = await db
    .select({ id: chatTasks.id })
    .from(chatTasks)
    .where(
      and(
        eq(chatTasks.userId, userId),
        eq(chatTasks.status, "queued"),
        eq(chatTasks.taskType, "structured")
      )
    )
    .limit(1);

  return [
    ...(queuedChat ? (["chat"] as const) : []),
    ...(queuedStructured ? (["structured"] as const) : []),
  ];
}

export async function GET(request: NextRequest) {
  let userId: string;
  try {
    const auth = await validateBearerAccessToken({
      authorization: request.headers.get("authorization"),
    });
    userId = auth.userId;
  } catch {
    return Response.json(
      { error: "Invalid or missing access token. Run `knosi login` to authenticate." },
      { status: 401 }
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
      let subscription: Awaited<ReturnType<typeof subscribeToDaemonTaskNotifications>> | null =
        null;
      let closed = false;

      const close = async () => {
        if (closed) return;
        closed = true;
        if (keepaliveTimer) clearInterval(keepaliveTimer);
        if (subscription) {
          await subscription.close().catch(() => undefined);
        }
        controller.close();
      };

      request.signal.addEventListener(
        "abort",
        () => {
          void close();
        },
        { once: true }
      );

      controller.enqueue(
        toSseFrame("snapshot", {
          queuedTaskTypes: await loadQueuedTaskTypes(userId),
        })
      );

      subscription = await subscribeToDaemonTaskNotifications(userId, (event) => {
        controller.enqueue(
          toSseFrame("wake", {
            taskType: event.taskType,
          })
        );
      });

      keepaliveTimer = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, KEEPALIVE_MS);
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
