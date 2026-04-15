import test from "node:test";
import assert from "node:assert/strict";

import daemonChatEventsModule from "./daemon-chat-events.ts";

const {
  __resetChatEventTestState,
  __setChatEventPublishClientForUnitTest,
  __setChatEventSubscriberFactoryForUnitTest,
  getChatEventChannel,
  parseChatEvent,
  publishChatEvent,
  serializeChatEvent,
  subscribeToChatEvents,
} = daemonChatEventsModule;

test.afterEach(() => {
  __resetChatEventTestState();
});

test("getChatEventChannel uses the task-specific redis topic", () => {
  assert.equal(getChatEventChannel("task-123"), "chat:task-123");
});

test("serialize and parse round-trip daemon delta events", () => {
  const event = {
    kind: "delta",
    taskId: "task-123",
    seq: 4,
    type: "text_delta",
    delta: "hello",
  };

  const raw = serializeChatEvent(event);
  assert.deepEqual(parseChatEvent(raw), event);
});

test("parseChatEvent rejects malformed payloads safely", () => {
  assert.equal(parseChatEvent("not-json"), null);
  assert.equal(parseChatEvent(JSON.stringify({ kind: "delta" })), null);
  assert.equal(
    parseChatEvent(JSON.stringify({ kind: "done", taskId: "task-1", totalText: 42 })),
    null
  );
});

test("publishChatEvent writes the serialized payload to the task channel", async () => {
  const published = [];

  __setChatEventPublishClientForUnitTest({
    publish: async (channel, message) => {
      published.push({ channel, message });
      return 1;
    },
  });

  const event = {
    kind: "done",
    taskId: "task-123",
    totalText: "all done",
  };

  const ok = await publishChatEvent(event);

  assert.equal(ok, true);
  assert.deepEqual(published, [
    {
      channel: "chat:task-123",
      message: JSON.stringify(event),
    },
  ]);
});

test("subscribeToChatEvents forwards parsed events and closes the subscriber", async () => {
  let subscribedChannel = null;
  let unsubscribedChannel = null;
  let quitCalls = 0;
  let handler = null;

  __setChatEventSubscriberFactoryForUnitTest(async () => ({
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
  const subscription = await subscribeToChatEvents("task-123", (event) => {
    seen.push(event);
  });

  assert.ok(subscription, "subscription should be created when a subscriber is available");
  assert.equal(subscribedChannel, "chat:task-123");

  handler(
    JSON.stringify({
      kind: "error",
      taskId: "task-123",
      error: "boom",
    })
  );

  assert.deepEqual(seen, [
    {
      kind: "error",
      taskId: "task-123",
      error: "boom",
    },
  ]);

  await subscription.close();

  assert.equal(unsubscribedChannel, "chat:task-123");
  assert.equal(quitCalls, 1);
});
