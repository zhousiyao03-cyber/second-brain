import test from "node:test";
import assert from "node:assert/strict";
import {
  createFocusDeviceToken,
  getFocusDeviceTokenPreview,
  hashFocusDeviceToken,
  resolveIngestUserId,
} from "./device-auth.ts";

test("createFocusDeviceToken returns a prefixed opaque token", () => {
  const token = createFocusDeviceToken();

  assert.match(token, /^fct_[0-9a-f]{48}$/);
  assert.equal(getFocusDeviceTokenPreview(token), token.slice(-6));
});

test("resolveIngestUserId accepts configured global ingest key", async () => {
  const userId = await resolveIngestUserId({
    authorization: "Bearer global-key",
    deviceId: "device-1",
    configuredApiKey: "global-key",
    configuredUserId: "user-global",
    getSessionUserId: async () => null,
    findDeviceUserId: async () => null,
  });

  assert.equal(userId, "user-global");
});

test("resolveIngestUserId resolves device-scoped token with matching device id", async () => {
  const token = createFocusDeviceToken();
  let receivedTokenHash = "";

  const userId = await resolveIngestUserId({
    authorization: `Bearer ${token}`,
    deviceId: "device-abc",
    getSessionUserId: async () => null,
    findDeviceUserId: async ({ deviceId, tokenHash }) => {
      assert.equal(deviceId, "device-abc");
      receivedTokenHash = tokenHash;
      return "device-user";
    },
  });

  assert.equal(userId, "device-user");
  assert.equal(receivedTokenHash, hashFocusDeviceToken(token));
});

test("resolveIngestUserId falls back to session auth when there is no bearer token", async () => {
  const userId = await resolveIngestUserId({
    authorization: null,
    deviceId: "device-1",
    getSessionUserId: async () => "session-user",
    findDeviceUserId: async () => null,
  });

  assert.equal(userId, "session-user");
});
