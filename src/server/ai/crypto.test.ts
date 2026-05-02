import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ENV_KEY = "KNOSI_SECRET_KEY";
let saved: string | undefined;

const validHex = "0".repeat(64);

beforeEach(() => {
  saved = process.env[ENV_KEY];
  process.env[ENV_KEY] = validHex;
});

afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved;
});

describe("crypto round trip", () => {
  it("encrypt then decrypt yields the original plaintext", async () => {
    const { encryptApiKey, decryptApiKey } = await import("./crypto");
    const plain = "sk-test-1234567890";
    const enc = encryptApiKey(plain);
    expect(decryptApiKey(enc)).toBe(plain);
  });

  it("each encryption uses a fresh IV (ciphertext differs)", async () => {
    const { encryptApiKey } = await import("./crypto");
    const a = encryptApiKey("sk-same");
    const b = encryptApiKey("sk-same");
    expect(a).not.toBe(b);
  });

  it("decrypt with wrong-shaped ciphertext throws ApiKeyDecryptionError", async () => {
    const { decryptApiKey, ApiKeyDecryptionError } = await import("./crypto");
    expect(() => decryptApiKey("not-base64-or-too-short")).toThrow(
      ApiKeyDecryptionError,
    );
  });

  it("rejects empty plaintext", async () => {
    const { encryptApiKey } = await import("./crypto");
    expect(() => encryptApiKey("")).toThrow();
  });
});

describe("crypto secret-key validation (separate process import)", () => {
  it.skip("throws on missing key (validated via boot smoke-test, not unit)", () => {});
});
