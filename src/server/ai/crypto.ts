import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const KEY_LEN = 32;

function loadMasterKey(): Buffer {
  const raw = process.env.KNOSI_SECRET_KEY?.trim();
  if (!raw) {
    throw new Error(
      "KNOSI_SECRET_KEY is not set. Generate one with `openssl rand -hex 32` and add it to your environment.",
    );
  }
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }
  if (key.length !== KEY_LEN) {
    throw new Error(
      `KNOSI_SECRET_KEY must decode to ${KEY_LEN} bytes; got ${key.length}.`,
    );
  }
  return key;
}

// Lazy: validated on first encrypt/decrypt, not at module import.
// Eager validation broke `pnpm build` ("Collecting page data" imports
// every route module, including ones that touch crypto), and the prod
// runtime catches a missing key on the first request anyway.
let masterKey: Buffer | null = null;

function getMasterKey(): Buffer {
  if (masterKey) return masterKey;
  masterKey = loadMasterKey();
  return masterKey;
}

export class ApiKeyDecryptionError extends Error {
  constructor(cause?: unknown) {
    super("Failed to decrypt API key — secret key may have changed.", {
      cause,
    });
    this.name = "ApiKeyDecryptionError";
  }
}

export function encryptApiKey(plain: string): string {
  if (typeof plain !== "string" || plain.length === 0) {
    throw new Error("encryptApiKey: plaintext must be a non-empty string.");
  }
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getMasterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

export function decryptApiKey(enc: string): string {
  try {
    const buf = Buffer.from(enc, "base64");
    if (buf.length < IV_LEN + 16) {
      throw new Error("ciphertext too short");
    }
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(buf.length - 16);
    const ct = buf.subarray(IV_LEN, buf.length - 16);
    const decipher = createDecipheriv(ALGO, getMasterKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
      "utf8",
    );
  } catch (cause) {
    throw new ApiKeyDecryptionError(cause);
  }
}
