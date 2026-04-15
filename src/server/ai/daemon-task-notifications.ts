import { getRedis, getRedisSubscriber } from "@/server/redis";

export type DaemonTaskType = "chat" | "structured";

export interface DaemonTaskWakeEvent {
  kind: "wake";
  userId: string;
  taskType: DaemonTaskType;
}

export type DaemonTaskNotification = DaemonTaskWakeEvent;

export interface DaemonTaskSubscription {
  close(): Promise<void>;
}

let publishClientOverride: { publish(channel: string, message: string): Promise<number> } | null =
  null;
let subscriberFactoryOverride:
  | ((
      userId: string
    ) => Promise<{
      subscribe(channel: string, listener: (message: string) => void): Promise<void>;
      unsubscribe(channel: string): Promise<void>;
      quit(): Promise<void>;
    } | null>)
  | null = null;

export function getDaemonTaskChannel(userId: string): string {
  return `daemon:tasks:${userId}`;
}

export function serializeDaemonTaskNotification(event: DaemonTaskNotification): string {
  return JSON.stringify(event);
}

export function parseDaemonTaskNotification(raw: string): DaemonTaskNotification | null {
  try {
    const data = JSON.parse(raw);
    if (
      data &&
      data.kind === "wake" &&
      typeof data.userId === "string" &&
      (data.taskType === "chat" || data.taskType === "structured")
    ) {
      return data as DaemonTaskNotification;
    }
  } catch {
    return null;
  }

  return null;
}

export async function publishDaemonTaskNotification(
  event: DaemonTaskNotification
): Promise<boolean> {
  const client = publishClientOverride ?? (await getRedis());
  if (!client) {
    return false;
  }

  await client.publish(
    getDaemonTaskChannel(event.userId),
    serializeDaemonTaskNotification(event)
  );
  return true;
}

export async function subscribeToDaemonTaskNotifications(
  userId: string,
  onEvent: (event: DaemonTaskNotification) => void
): Promise<DaemonTaskSubscription | null> {
  const subscriber =
    (subscriberFactoryOverride ? await subscriberFactoryOverride(userId) : null) ??
    (await getRedisSubscriber());

  if (!subscriber) {
    return null;
  }

  const channel = getDaemonTaskChannel(userId);
  await subscriber.subscribe(channel, (message: string) => {
    const event = parseDaemonTaskNotification(message);
    if (event) {
      onEvent(event);
    }
  });

  return {
    async close() {
      await subscriber.unsubscribe(channel);
      await subscriber.quit();
    },
  };
}

export function __setDaemonTaskPublishClientForUnitTest(
  client: { publish(channel: string, message: string): Promise<number> } | null
) {
  publishClientOverride = client;
}

export function __setDaemonTaskSubscriberFactoryForUnitTest(
  factory:
    | ((
        userId: string
      ) => Promise<{
        subscribe(channel: string, listener: (message: string) => void): Promise<void>;
        unsubscribe(channel: string): Promise<void>;
        quit(): Promise<void>;
      } | null>)
    | null
) {
  subscriberFactoryOverride = factory;
}

export function __resetDaemonTaskNotificationTestState() {
  publishClientOverride = null;
  subscriberFactoryOverride = null;
}

const daemonTaskNotificationsModule = {
  __resetDaemonTaskNotificationTestState,
  __setDaemonTaskPublishClientForUnitTest,
  __setDaemonTaskSubscriberFactoryForUnitTest,
  getDaemonTaskChannel,
  parseDaemonTaskNotification,
  publishDaemonTaskNotification,
  serializeDaemonTaskNotification,
  subscribeToDaemonTaskNotifications,
};

export default daemonTaskNotificationsModule;
