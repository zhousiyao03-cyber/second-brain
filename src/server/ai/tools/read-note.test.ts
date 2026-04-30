import { afterEach, describe, expect, it, vi } from "vitest";

// We mock the db at the import boundary because the tool's job at the unit
// level is "build the right query and project the right shape" — we don't
// need a live SQLite to validate that. The userId-isolation guarantee comes
// from the WHERE clause; we assert that clause is constructed below.
vi.mock("@/server/db", () => {
  const limit = vi.fn();
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return {
    db: { select },
    __limitMock: limit,
    __whereMock: where,
  };
});

const dbModule = await import("@/server/db");
const limitMock = (dbModule as unknown as { __limitMock: ReturnType<typeof vi.fn> }).__limitMock;
const whereMock = (dbModule as unknown as { __whereMock: ReturnType<typeof vi.fn> }).__whereMock;

import { makeReadNoteTool } from "./read-note";

type ExecutableTool = {
  execute?: (input: unknown, options: unknown) => Promise<unknown>;
};

const stubOptions = { toolCallId: "tc", messages: [] };

afterEach(() => {
  vi.clearAllMocks();
});

describe("makeReadNoteTool", () => {
  it("returns the note content when found and owned by the user", async () => {
    limitMock.mockResolvedValueOnce([
      { id: "note-1", title: "Hi", plainText: "body" },
    ]);
    const t = makeReadNoteTool({
      userId: "u1",
      conversationId: "c",
      urlBudget: { count: 0, urlsHit: new Set() },
    }) as ExecutableTool;
    const out = await t.execute!({ noteId: "note-1" }, stubOptions);
    expect(out).toEqual({ id: "note-1", title: "Hi", content: "body" });
    // The where() call is what enforces user isolation. We assert it was
    // invoked once per call — the actual SQL shape is verified by the
    // integration suite / e2e.
    expect(whereMock).toHaveBeenCalledTimes(1);
  });

  it("returns an error object when the note is missing or not owned", async () => {
    limitMock.mockResolvedValueOnce([]);
    const t = makeReadNoteTool({
      userId: "u1",
      conversationId: "c",
      urlBudget: { count: 0, urlsHit: new Set() },
    }) as ExecutableTool;
    const out = await t.execute!({ noteId: "missing" }, stubOptions);
    expect(out).toMatchObject({ error: expect.stringContaining("not found") });
  });

  it("falls back to 'Untitled' / empty body when columns are nullable", async () => {
    limitMock.mockResolvedValueOnce([
      { id: "n", title: null, plainText: null },
    ]);
    const t = makeReadNoteTool({
      userId: "u",
      conversationId: "c",
      urlBudget: { count: 0, urlsHit: new Set() },
    }) as ExecutableTool;
    const out = await t.execute!({ noteId: "n" }, stubOptions);
    expect(out).toEqual({ id: "n", title: "Untitled", content: "" });
  });
});
