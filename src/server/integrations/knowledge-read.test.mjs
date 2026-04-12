import test from "node:test";
import assert from "node:assert/strict";

test("knowledge-read module exports the expected services", async () => {
  const mod = await import("./knowledge-read.ts");
  const exportsObject = "default" in mod ? mod.default : mod;

  assert.equal(typeof exportsObject.searchKnowledge, "function");
  assert.equal(typeof exportsObject.listRecentKnowledge, "function");
  assert.equal(typeof exportsObject.getKnowledgeItem, "function");
});
