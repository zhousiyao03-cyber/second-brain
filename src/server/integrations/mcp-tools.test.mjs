import test from "node:test";
import assert from "node:assert/strict";

test("mcp-tools module exports the tool registry and dispatcher", async () => {
  const mod = await import("./mcp-tools.ts");
  const exportsObject = "default" in mod ? mod.default : mod;

  assert.ok(Array.isArray(exportsObject.KNOSI_MCP_TOOLS));
  assert.equal(typeof exportsObject.callKnosiMcpTool, "function");
});
