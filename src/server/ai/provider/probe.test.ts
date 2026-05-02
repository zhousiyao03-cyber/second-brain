import { describe, it, expect, vi, afterEach } from "vitest";
import { probeProvider } from "./probe";

afterEach(() => vi.restoreAllMocks());

describe("probeProvider — openai-compatible", () => {
  it("returns ok + model list on 200 with {data:[{id}]}", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    const r = await probeProvider({
      kind: "openai-compatible",
      baseURL: "https://api.example.com/v1",
      apiKey: "sk-x",
    });
    expect(r).toEqual({ ok: true, models: ["gpt-4o", "gpt-4o-mini"] });
  });

  it("returns ok=false on 401 with parsed error message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "Invalid API key" } }),
        { status: 401 },
      ),
    );
    const r = await probeProvider({
      kind: "openai-compatible",
      baseURL: "https://api.example.com/v1",
      apiKey: "sk-bad",
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error();
    expect(r.error).toContain("Invalid API key");
  });

  it("network failure surfaces as ok=false", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("fetch failed"),
    );
    const r = await probeProvider({
      kind: "openai-compatible",
      baseURL: "https://nope.example.com/v1",
      apiKey: "sk-x",
    });
    expect(r.ok).toBe(false);
  });
});

describe("probeProvider — local (no key)", () => {
  it("works without apiKey", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "qwen2.5:14b" }] }), {
        status: 200,
      }),
    );
    const r = await probeProvider({
      kind: "local",
      baseURL: "http://127.0.0.1:11434/v1",
    });
    expect(r.ok).toBe(true);
  });
});

describe("probeProvider — daemon", () => {
  it("returns ok with hardcoded model list", async () => {
    const r = await probeProvider({ kind: "claude-code-daemon" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error();
    expect(r.models).toContain("opus");
  });
});
