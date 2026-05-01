import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db FIRST so the import in orchestrator picks up the mock.
vi.mock("@/server/db", () => {
  const insertChain = {
    values: vi.fn().mockResolvedValue(undefined),
  };
  const selectChain = {
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  };
  return {
    db: {
      insert: vi.fn(() => insertChain),
      select: vi.fn(() => selectChain),
    },
  };
});

vi.mock("../classifier", () => ({
  classifyShouldSpeak: vi.fn(),
}));

vi.mock("../persona-stream", () => ({
  streamPersonaResponse: vi.fn(),
}));

import { classifyShouldSpeak } from "../classifier";
import { streamPersonaResponse } from "../persona-stream";
import { runTurn } from "../orchestrator";
import type { Persona, SSEEvent } from "../types";

const personas: Persona[] = [1, 2, 3].map((i) => ({
  id: `p${i}`,
  userId: "u1",
  name: `P${i}`,
  avatarEmoji: "",
  systemPrompt: "x",
  styleHint: null,
  scopeKind: "all",
  scopeRefId: null,
  scopeTags: null,
  isPreset: true,
  createdAt: 0,
  updatedAt: 0,
}));

const channel = {
  id: "c1",
  userId: "u1",
  name: "n",
  topic: null,
  hardLimitPerTurn: 6,
  createdAt: 0,
  updatedAt: 0,
};

async function* asyncIter(chunks: string[]): AsyncIterable<string> {
  for (const c of chunks) yield c;
}

async function collect(gen: AsyncIterable<SSEEvent>): Promise<SSEEvent[]> {
  const out: SSEEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("runTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops with consecutive_no when all personas vote no", async () => {
    vi.mocked(classifyShouldSpeak).mockResolvedValue({
      shouldSpeak: false,
      priority: 0,
      reason: "n/a",
    });
    const events = await collect(
      runTurn({
        channel,
        personas,
        userMessage: { content: "hi", id: "m1" },
        userId: "u1",
        abortSignal: new AbortController().signal,
      })
    );
    const stopped = events.find((e) => e.type === "stopped");
    expect(stopped && "reason" in stopped && stopped.reason).toBe("consecutive_no");
  });

  it("stops with hard_limit after channel.hardLimitPerTurn agent messages", async () => {
    vi.mocked(classifyShouldSpeak).mockResolvedValue({
      shouldSpeak: true,
      priority: 0.5,
      reason: "ok",
    });
    vi.mocked(streamPersonaResponse).mockImplementation(() =>
      asyncIter(["hello"])
    );
    const events = await collect(
      runTurn({
        channel: { ...channel, hardLimitPerTurn: 2 },
        personas,
        userMessage: { content: "hi", id: "m1" },
        userId: "u1",
        abortSignal: new AbortController().signal,
      })
    );
    const stopped = events.find((e) => e.type === "stopped");
    expect(stopped && "reason" in stopped && stopped.reason).toBe("hard_limit");
    expect(events.filter((e) => e.type === "agent_end")).toHaveLength(2);
  });

  it("highest-priority persona speaks first", async () => {
    let pass = 0;
    vi.mocked(classifyShouldSpeak).mockImplementation(async ({ persona }) => {
      pass += 1;
      if (pass <= 3) {
        return {
          shouldSpeak: true,
          priority: persona.id === "p2" ? 0.9 : 0.5,
          reason: "",
        };
      }
      return { shouldSpeak: false, priority: 0, reason: "" };
    });
    vi.mocked(streamPersonaResponse).mockImplementation(() =>
      asyncIter(["from a persona"])
    );
    const events = await collect(
      runTurn({
        channel,
        personas,
        userMessage: { content: "hi", id: "m1" },
        userId: "u1",
        abortSignal: new AbortController().signal,
      })
    );
    const firstAgentStart = events.find((e) => e.type === "agent_start");
    expect(firstAgentStart && "personaId" in firstAgentStart && firstAgentStart.personaId).toBe("p2");
  });

  it("user_interrupt: aborting mid-stream marks message interrupted", async () => {
    vi.mocked(classifyShouldSpeak).mockResolvedValue({
      shouldSpeak: true,
      priority: 0.5,
      reason: "",
    });
    const ctrl = new AbortController();
    vi.mocked(streamPersonaResponse).mockImplementation(async function* () {
      yield "partial...";
      ctrl.abort();
      yield "should not appear";
    });
    const events = await collect(
      runTurn({
        channel,
        personas,
        userMessage: { content: "hi", id: "m1" },
        userId: "u1",
        abortSignal: ctrl.signal,
      })
    );
    const end = events.find((e) => e.type === "agent_end");
    expect(end && "status" in end && end.status).toBe("interrupted");
    const stopped = events.find((e) => e.type === "stopped");
    expect(stopped && "reason" in stopped && stopped.reason).toBe("user_interrupt");
  });

  it("classifier error: falls back to no, no crash", async () => {
    vi.mocked(classifyShouldSpeak).mockRejectedValue(new Error("boom"));
    const events = await collect(
      runTurn({
        channel,
        personas,
        userMessage: { content: "hi", id: "m1" },
        userId: "u1",
        abortSignal: new AbortController().signal,
      })
    );
    expect(events.find((e) => e.type === "stopped")).toBeTruthy();
  });
});
