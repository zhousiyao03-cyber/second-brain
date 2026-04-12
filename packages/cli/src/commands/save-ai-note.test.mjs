import test from "node:test";
import assert from "node:assert/strict";
import { readStdinJson } from "./save-ai-note.mjs";

test("save-ai-note exports stdin JSON reader", () => {
  assert.equal(typeof readStdinJson, "function");
});
