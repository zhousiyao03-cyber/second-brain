import test from "node:test";
import assert from "node:assert/strict";
import {
  createFocusPairingCode,
  getFocusPairingExpiresAt,
  hashFocusPairingCode,
  isFocusPairingExpired,
  FOCUS_PAIRING_TTL_SECS,
} from "./pairing.ts";

test("createFocusPairingCode returns an uppercase pairing code", () => {
  const code = createFocusPairingCode();

  assert.match(code, /^[A-Z2-9]{10}$/);
});

test("hashFocusPairingCode is deterministic", () => {
  const code = "ABCD234XYZ";

  assert.equal(hashFocusPairingCode(code), hashFocusPairingCode(code));
});

test("isFocusPairingExpired flips to true after ttl", () => {
  const createdAt = new Date("2026-03-29T10:00:00.000Z");
  const expiresAt = getFocusPairingExpiresAt(createdAt);

  assert.equal(
    isFocusPairingExpired(
      expiresAt,
      new Date(createdAt.getTime() + (FOCUS_PAIRING_TTL_SECS - 1) * 1000)
    ),
    false
  );
  assert.equal(
    isFocusPairingExpired(
      expiresAt,
      new Date(createdAt.getTime() + (FOCUS_PAIRING_TTL_SECS + 1) * 1000)
    ),
    true
  );
});
