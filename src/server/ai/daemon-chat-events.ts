import { getRedis, getRedisSubscriber } from "@/server/redis";
import { logger } from "@/server/logger";

export type ChatDeltaEvent = {
  kind: "delta";
  taskId: string;
  seq: number;
  type: "text_delta" | "text_final" | "error";
  delta: string | null;
};

export type ChatDoneEvent = {
  kind: "done";
  taskId: string;
  totalText: string;
};

export type ChatErrorEvent = {
  kind: "error";
  taskId: string;
  error: string;
};

export type DaemonChatEvent = ChatDeltaEvent | ChatDoneEvent | ChatErrorEvent;

type PublishClient = {
  publish: (channel: string, message: string) => Promise<unknown>;
};

type SubscribeClient = {
  subscribe: (channel: string, listener: (message: string) => void) => Promise<unknown>;
  unsubscribe: (channel: string) => Promise<unknown>;
  quit: () => Promise<unknown>;
};

const testState: {
  publishClient?: PublishClient | null;
  subscriberFactory?: (() => Promise<SubscribeClient | null>) | null;
} = {};

export function getChatEventChannel(taskId: string) {
  return `chat:${taskId}`;
}

export function serializeChatEvent(event: DaemonChatEvent) {
  return JSON.stringify(event);
}

export function parseChatEvent(raw: string): DaemonChatEvent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<DaemonChatEvent>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.taskId !== "string") {
      return null;
    }

    if (
      parsed.kind === "delta" &&
      typeof parsed.seq === "number" &&
      (parsed.type === "text_delta" ||
        parsed.type === "text_final" ||
        parsed.type === "error") &&
      (typeof parsed.delta === "string" || parsed.delta === null)
    ) {
      return {
        kind: "delta",
        taskId: parsed.taskId,
        seq: parsed.seq,
        type: parsed.type,
        delta: parsed.delta,
      };
    }

    if (parsed.kind === "done" && typeof parsed.totalText === "string") {
      return { kind: "done", taskId: parsed.taskId, totalText: parsed.totalText };
    }

    if (parsed.kind === "error" && typeof parsed.error === "string") {
      return { kind: "error", taskId: parsed.taskId, error: parsed.error };
    }

    return null;
  } catch {
    return null;
  }
}

async function getPublishClient(): Promise<PublishClient | null> {
  if (testState.publishClient !== undefined) {
    return testState.publishClient;
  }
  return getRedis();
}

async function createSubscriber(): Promise<SubscribeClient | null> {
  if (testState.subscriberFactory !== undefined) {
    return testState.subscriberFactory ? testState.subscriberFactory() : null;
  }
  return getRedisSubscriber();
}

export async function publishChatEvent(event: DaemonChatEvent) {
  const client = await getPublishClient();
  if (!client) {
    return false;
  }

  try {
    await client.publish(getChatEventChannel(event.taskId), serializeChatEvent(event));
    return true;
  } catch (err) {
    logger.error(
      { event: "ask_ai.chat_event_publish_failed", taskId: event.taskId, kind: event.kind, err },
      "failed to publish daemon chat event"
    );
    return false;
  }
}

export async function subscribeToChatEvents(
  taskId: string,
  listener: (event: DaemonChatEvent) => void
) {
  const client = await createSubscriber();
  if (!client) {
    return null;
  }

  const channel = getChatEventChannel(taskId);

  await client.subscribe(channel, (message) => {
    const event = parseChatEvent(message);
    if (!event) {
      logger.warn(
        { event: "ask_ai.chat_event_parse_failed", taskId, message },
        "failed to parse daemon chat event"
      );
      return;
    }
    listener(event);
  });

  return {
    async close() {
      try {
        await client.unsubscribe(channel);
      } finally {
        await client.quit().catch(() => undefined);
      }
    },
  };
}

export function __setChatEventPublishClientForUnitTest(client: PublishClient | null) {
  testState.publishClient = client;
}

export function __setChatEventSubscriberFactoryForUnitTest(
  factory: (() => Promise<SubscribeClient | null>) | null
) {
  testState.subscriberFactory = factory;
}

export function __resetChatEventTestState() {
  testState.publishClient = undefined;
  testState.subscriberFactory = undefined;
}
