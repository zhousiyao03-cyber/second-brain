import { describe, expect, it } from "vitest";
import { captureAiNote } from "./ai-capture";

describe("captureAiNote folder routing", () => {
  it("routes to AI Inbox when no folder param is given (regression)", async () => {
    let inboxCalls = 0;
    let namedCalls = 0;
    let insertedFolderId = "";

    await captureAiNote(
      {
        userId: "user-1",
        sourceApp: "claude-web",
        messages: [
          { role: "user", content: "Q?" },
          { role: "assistant", content: "A." },
        ],
        capturedAtLabel: "2026-04-26 09:00 UTC",
        capturedAt: new Date("2026-04-26T09:00:00.000Z"),
      },
      {
        now: () => new Date("2026-04-26T09:00:00.000Z"),
        randomUUID: () => "note-1",
        resolveOrCreateAiInboxFolder: async () => {
          inboxCalls++;
          return "folder-ai-inbox";
        },
        resolveOrCreateNamedFolder: async () => {
          namedCalls++;
          return "should-not-happen";
        },
        createNote: async (row) => {
          insertedFolderId = row.folderId;
        },
        enqueueNoteIndexJob: async () => undefined,
        invalidateNotesListForUser: () => {},
        invalidateDashboardForUser: () => {},
      }
    );

    expect(inboxCalls).toBe(1);
    expect(namedCalls).toBe(0);
    expect(insertedFolderId).toBe("folder-ai-inbox");
  });

  it("routes to a named folder when folder param is given", async () => {
    let inboxCalls = 0;
    let resolvedName = "";
    let insertedFolderId = "";

    await captureAiNote(
      {
        userId: "user-1",
        sourceApp: "bagu-skill",
        folder: "八股文",
        messages: [{ role: "assistant", content: "Card body" }],
        capturedAtLabel: "2026-04-26 09:00 UTC",
        capturedAt: new Date("2026-04-26T09:00:00.000Z"),
      },
      {
        now: () => new Date("2026-04-26T09:00:00.000Z"),
        randomUUID: () => "note-bagu-1",
        resolveOrCreateAiInboxFolder: async () => {
          inboxCalls++;
          return "should-not-happen";
        },
        resolveOrCreateNamedFolder: async (_userId, name) => {
          resolvedName = name;
          return "folder-bagu";
        },
        createNote: async (row) => {
          insertedFolderId = row.folderId;
        },
        enqueueNoteIndexJob: async () => undefined,
        invalidateNotesListForUser: () => {},
        invalidateDashboardForUser: () => {},
      }
    );

    expect(inboxCalls).toBe(0);
    expect(resolvedName).toBe("八股文");
    expect(insertedFolderId).toBe("folder-bagu");
  });

  it("treats whitespace-only folder as absent and falls back to AI Inbox", async () => {
    let inboxCalls = 0;
    let namedCalls = 0;
    let insertedFolderId = "";

    await captureAiNote(
      {
        userId: "user-1",
        sourceApp: "claude-web",
        folder: "   ",
        messages: [{ role: "user", content: "Q?" }],
        capturedAt: new Date("2026-04-26T09:00:00.000Z"),
      },
      {
        now: () => new Date("2026-04-26T09:00:00.000Z"),
        randomUUID: () => "note-2",
        resolveOrCreateAiInboxFolder: async () => {
          inboxCalls++;
          return "folder-ai-inbox";
        },
        resolveOrCreateNamedFolder: async () => {
          namedCalls++;
          return "no";
        },
        createNote: async (row) => {
          insertedFolderId = row.folderId;
        },
        enqueueNoteIndexJob: async () => undefined,
        invalidateNotesListForUser: () => {},
        invalidateDashboardForUser: () => {},
      }
    );

    expect(inboxCalls).toBe(1);
    expect(namedCalls).toBe(0);
    expect(insertedFolderId).toBe("folder-ai-inbox");
  });
});
