import assert from "node:assert/strict";
import test from "node:test";
import { getOpsOwnerAccess } from "./authorization";

test("getOpsOwnerAccess returns allowed when session email matches env", () => {
  process.env.OPS_OWNER_EMAIL = "owner@example.com";

  const result = getOpsOwnerAccess({
    user: { id: "u_1", email: "owner@example.com" },
  });

  assert.deepEqual(result, {
    allowed: true,
    reason: null,
  });
});

test("getOpsOwnerAccess returns denied when session email does not match env", () => {
  process.env.OPS_OWNER_EMAIL = "owner@example.com";

  const result = getOpsOwnerAccess({
    user: { id: "u_2", email: "other@example.com" },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "not-owner");
});

test("getOpsOwnerAccess returns unavailable when OPS_OWNER_EMAIL is missing", () => {
  delete process.env.OPS_OWNER_EMAIL;

  const result = getOpsOwnerAccess({
    user: { id: "u_1", email: "owner@example.com" },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "missing-owner-config");
});
