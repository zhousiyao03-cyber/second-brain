import test from "node:test";
import assert from "node:assert/strict";

import daemonTaskNotificationsModule from "./daemon-task-notifications.ts";

const {
  __resetDaemonTaskNotificationTestState,
  __setDaemonTaskPublishClientForUnitTest,
  __setDaemonTaskSubscriberFactoryForUnitTest,
  getDaemonTaskChannel,
  parseDaemonTaskNotification,
  publishDaemonTaskNotification,
  serializeDaemonTaskNotification,
  subscribeToDaemonTaskNotifications,
} = daemonTaskNotificationsModule;

test.afterEach(() => {
  __resetDaemonTaskNotificationTestState();
});

test("getDaemonTaskChannel uses the user-scoped redis topic", () => {
  assert.equal(getDaemonTaskChannel("user-123"), "daemon:tasks:user-123");
});

test("serialize and parse round-trip daemon wake events", () => {
  const event = {
    kind: "wake",
    userId: "user-123",
    taskType: "chat",
  };

  const raw = serializeDaemonTaskNotification(event);
  assert.deepEqual(parseDaemonTaskNotification(raw), event);
});

test("parseDaemonTaskNotification rejects malformed payloads safely", () => {
  assert.equal(parseDaemonTaskNotification("not-json"), null);
  assert.equal(parseDaemonTaskNotification(JSON.stringify({ kind: "wake" })), null);
  assert.equal(
    parseDaemonTaskNotification(
      JSON.stringify({ kind: "wake", userId: "user-1", taskType: "analysis" })
    ),
    null
  );
});

test("publishDaemonTaskNotification writes the serialized payload to the user channel", async () => {
  const published = [];

  __setDaemonTaskPublishClientForUnitTest({
    publish: async (channel, message) => {
      published.push({ channel, message });
      return 1;
    },
  });

  const ok = await publishDaemonTaskNotification({
    kind: "wake",
    userId: "user-123",
    taskType: "structured",
  });

  assert.equal(ok, true);
  assert.deepEqual(published, [
    {
      channel: "daemon:tasks:user-123",
      message: JSON.stringify({
        kind: "wake",
        userId: "user-123",
        taskType: "structured",
      }),
    },
  ]);
});

test("subscribeToDaemonTaskNotifications forwards parsed events and closes the subscriber", async () => {
  let subscribedChannel = null;
  let unsubscribedChannel = null;
  let quitCalls = 0;
  let handler = null;

  __setDaemonTaskSubscriberFactoryForUnitTest(async () => ({
    subscribe: async (channel, listener) => {
      subscribedChannel = channel;
      handler = listener;
    },
    unsubscribe: async (channel) => {
      unsubscribedChannel = channel;
    },
    quit: async () => {
      quitCalls += 1;
    },
  }));

  const seen = [];
  const subscription = await subscribeToDaemonTaskNotifications("user-123", (event) => {
    seen.push(event);
  });

  assert.ok(subscription);
  assert.equal(subscribedChannel, "daemon:tasks:user-123");

  handler(
    JSON.stringify({
      kind: "wake",
      userId: "user-123",
      taskType: "chat",
    })
  );

  assert.deepEqual(seen, [
    {
      kind: "wake",
      userId: "user-123",
      taskType: "chat",
    },
  ]);

  await subscription.close();
  assert.equal(unsubscribedChannel, "daemon:tasks:user-123");
  assert.equal(quitCalls, 1);
});
