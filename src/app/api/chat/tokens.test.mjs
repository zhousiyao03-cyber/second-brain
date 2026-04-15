import test from "node:test";
import assert from "node:assert/strict";

import tokensRouteModule from "./tokens/route.ts";

const {
  __resetChatTokensTestLoaders,
  __setChatTokensTestLoadersForUnitTest,
  emitChatCatchupRows,
  toSseFrame,
} = tokensRouteModule;

test.afterEach(() => {
  __resetChatTokensTestLoaders();
});

test("toSseFrame formats SSE events correctly", () => {
  assert.equal(
    toSseFrame("delta", { seq: 1, delta: "hi" }),
    'event: delta\ndata: {"seq":1,"delta":"hi"}\n\n'
  );
});

test("emitChatCatchupRows streams ordered chat deltas and returns the last seq", async () => {
  const sent = [];

  __setChatTokensTestLoadersForUnitTest({
    loadChatDeltaRows: async () => [
      { seq: 2, type: "text_delta", delta: "he" },
      { seq: 3, type: "text_delta", delta: "llo" },
    ],
  });

  const lastSeq = await emitChatCatchupRows("task-1", 1, (event, data) => {
    sent.push({ event, data });
  });

  assert.equal(lastSeq, 3);
  assert.deepEqual(sent, [
    { event: "delta", data: { seq: 2, type: "text_delta", delta: "he" } },
    { event: "delta", data: { seq: 3, type: "text_delta", delta: "llo" } },
  ]);
});
