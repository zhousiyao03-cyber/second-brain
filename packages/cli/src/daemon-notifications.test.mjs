import test from "node:test";
import assert from "node:assert/strict";

import {
  consumeDaemonNotificationStream,
  parseDaemonNotificationSseChunk,
} from "./daemon-notifications.mjs";

test("parseDaemonNotificationSseChunk parses snapshot and wake frames", () => {
  const encoder = new TextEncoder();
  const first = encoder.encode(
    'event: snapshot\ndata: {"queuedTaskTypes":["chat"]}\n\n' +
      'event: wake\ndata: {"taskType":"chat"}\n\n'
  );

  const parsed = parseDaemonNotificationSseChunk("", first);

  assert.equal(parsed.buffer, "");
  assert.deepEqual(parsed.events, [
    {
      event: "snapshot",
      data: { queuedTaskTypes: ["chat"] },
    },
    {
      event: "wake",
      data: { taskType: "chat" },
    },
  ]);
});

test("parseDaemonNotificationSseChunk keeps incomplete frames buffered", () => {
  const encoder = new TextEncoder();

  const first = parseDaemonNotificationSseChunk(
    "",
    encoder.encode('event: wake\ndata: {"taskType":"chat"')
  );
  assert.equal(first.events.length, 0);

  const second = parseDaemonNotificationSseChunk(first.buffer, encoder.encode("}\n\n"));
  assert.deepEqual(second.events, [
    {
      event: "wake",
      data: { taskType: "chat" },
    },
  ]);
});

test("consumeDaemonNotificationStream emits parsed events in order", async () => {
  const encoder = new TextEncoder();
  const chunks = [
    encoder.encode('event: snapshot\ndata: {"queuedTaskTypes":["structured"]}\n\n'),
    encoder.encode('event: wake\ndata: {"taskType":"chat"}\n\n'),
  ];

  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

  const seen = [];
  await consumeDaemonNotificationStream(
    new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
    }),
    (event) => {
      seen.push(event);
    }
  );

  assert.deepEqual(seen, [
    {
      event: "snapshot",
      data: { queuedTaskTypes: ["structured"] },
    },
    {
      event: "wake",
      data: { taskType: "chat" },
    },
  ]);
});
