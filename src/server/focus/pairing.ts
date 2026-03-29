import { createHash, randomBytes } from "node:crypto";

const FOCUS_PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const FOCUS_PAIRING_CODE_LENGTH = 10;
export const FOCUS_PAIRING_TTL_SECS = 5 * 60;

export function createFocusPairingCode() {
  const bytes = randomBytes(FOCUS_PAIRING_CODE_LENGTH);
  let code = "";

  for (const byte of bytes) {
    code += FOCUS_PAIRING_ALPHABET[byte % FOCUS_PAIRING_ALPHABET.length];
  }

  return code;
}

export function hashFocusPairingCode(code: string) {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export function getFocusPairingCodePreview(code: string) {
  return code.trim().toUpperCase().slice(-4);
}

export function getFocusPairingExpiresAt(from = new Date()) {
  return new Date(from.getTime() + FOCUS_PAIRING_TTL_SECS * 1000);
}

export function isFocusPairingExpired(
  expiresAt: Date,
  now = new Date()
) {
  return expiresAt.getTime() <= now.getTime();
}
