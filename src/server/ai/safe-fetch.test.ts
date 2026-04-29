import { describe, expect, it } from "vitest";
import {
  isBlockedIp,
  assertUrlIsSafeToFetch,
  SsrfBlockedError,
} from "./safe-fetch";

describe("isBlockedIp — IPv4", () => {
  it.each([
    ["169.254.169.254", "AWS / Hetzner cloud metadata"],
    ["169.254.1.1", "link-local"],
    ["127.0.0.1", "loopback"],
    ["127.1.2.3", "loopback /8"],
    ["10.0.0.5", "RFC1918 10/8"],
    ["172.16.0.1", "RFC1918 172.16/12"],
    ["172.31.255.255", "RFC1918 172.16/12 boundary"],
    ["192.168.1.1", "RFC1918 192.168/16"],
    ["100.64.0.1", "CGNAT 100.64/10"],
    ["100.127.255.255", "CGNAT 100.64/10 boundary"],
    ["0.0.0.0", "wildcard"],
    ["198.18.5.5", "benchmarking 198.18/15"],
  ])("blocks %s (%s)", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    ["8.8.8.8", "Google DNS"],
    ["1.1.1.1", "Cloudflare DNS"],
    ["172.15.0.1", "just below RFC1918 172.16/12"],
    ["172.32.0.1", "just above RFC1918 172.16/12"],
    ["100.63.255.255", "just below CGNAT"],
    ["100.128.0.1", "just above CGNAT"],
    ["198.20.1.1", "just above benchmarking"],
  ])("allows %s (%s)", (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
});

describe("isBlockedIp — IPv6", () => {
  it.each([
    ["::1", "loopback"],
    ["::", "wildcard"],
    ["fe80::1", "link-local"],
    ["fec0::1", "deprecated site-local"],
    ["fc00::1", "unique-local /7 low half"],
    ["fd00::1", "unique-local /7 high half"],
    ["::ffff:127.0.0.1", "IPv4-mapped loopback"],
    ["::ffff:169.254.169.254", "IPv4-mapped metadata"],
    ["::ffff:10.0.0.1", "IPv4-mapped RFC1918"],
  ])("blocks %s (%s)", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    ["2001:4860:4860::8888", "Google DNS v6"],
    ["2606:4700:4700::1111", "Cloudflare DNS v6"],
    ["::ffff:8.8.8.8", "IPv4-mapped public"],
  ])("allows %s (%s)", (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
});

describe("assertUrlIsSafeToFetch — protocol filter", () => {
  it("rejects file://", async () => {
    await expect(
      assertUrlIsSafeToFetch(new URL("file:///etc/passwd"))
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("rejects gopher://", async () => {
    await expect(
      assertUrlIsSafeToFetch(new URL("gopher://example.com/0/etc/passwd"))
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("rejects ftp://", async () => {
    await expect(
      assertUrlIsSafeToFetch(new URL("ftp://example.com/file"))
    ).rejects.toThrow(SsrfBlockedError);
  });
});

describe("assertUrlIsSafeToFetch — IP literal hosts", () => {
  it("rejects http://169.254.169.254 (cloud metadata)", async () => {
    await expect(
      assertUrlIsSafeToFetch(new URL("http://169.254.169.254/latest/meta-data/"))
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("rejects http://127.0.0.1:11434 (local Ollama)", async () => {
    await expect(
      assertUrlIsSafeToFetch(new URL("http://127.0.0.1:11434/api/tags"))
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("rejects http://[::1] (IPv6 loopback)", async () => {
    await expect(
      assertUrlIsSafeToFetch(new URL("http://[::1]/admin"))
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("rejects http://10.0.0.5", async () => {
    await expect(
      assertUrlIsSafeToFetch(new URL("http://10.0.0.5/"))
    ).rejects.toThrow(SsrfBlockedError);
  });
});
