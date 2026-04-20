import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithHostedAi } from "./hosted";

describe("runWithHostedAi", () => {
  const originalPool = process.env.KNOSI_CODEX_ACCOUNT_POOL;

  beforeEach(() => {
    process.env.KNOSI_CODEX_ACCOUNT_POOL = "alpha,beta,gamma";
  });

  afterEach(() => {
    if (originalPool === undefined) delete process.env.KNOSI_CODEX_ACCOUNT_POOL;
    else process.env.KNOSI_CODEX_ACCOUNT_POOL = originalPool;
  });

  it("returns NO_POOL when env is empty", async () => {
    delete process.env.KNOSI_CODEX_ACCOUNT_POOL;
    const result = await runWithHostedAi("u", async () => "ok");
    expect(result).toEqual({ ok: false, error: "NO_POOL" });
  });

  it("succeeds on the primary account without trying others", async () => {
    const fn = vi.fn().mockResolvedValue("done");
    const result = await runWithHostedAi("user-1", fn);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("done");
      expect(["alpha", "beta", "gamma"]).toContain(result.account);
    }
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("rotates past 429 and eventually succeeds", async () => {
    const fn = vi
      .fn<(p: string) => Promise<string>>()
      .mockImplementationOnce(async () => {
        const err = new Error("rate limited") as Error & { status?: number };
        err.status = 429;
        throw err;
      })
      .mockImplementationOnce(async () => "ok-after-retry");
    const result = await runWithHostedAi("user-x", fn);
    expect(result.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("rotates past 403", async () => {
    const fn = vi
      .fn<(p: string) => Promise<string>>()
      .mockImplementationOnce(async () => {
        const err = new Error("blocked") as Error & { status?: number };
        err.status = 403;
        throw err;
      })
      .mockImplementationOnce(async () => "ok");
    const result = await runWithHostedAi("user-y", fn);
    expect(result.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("returns ALL_ACCOUNTS_FAILED after every account 429s", async () => {
    const fn = vi.fn(async () => {
      const err = new Error("rate limited") as Error & { status?: number };
      err.status = 429;
      throw err;
    });
    const result = await runWithHostedAi("user-z", fn);
    expect(result).toEqual({ ok: false, error: "ALL_ACCOUNTS_FAILED" });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("propagates non-429/403 errors immediately", async () => {
    const fn = vi.fn(async () => {
      const err = new Error("server blew up") as Error & { status?: number };
      err.status = 500;
      throw err;
    });
    await expect(runWithHostedAi("user-q", fn)).rejects.toThrow("server blew up");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
