import test from "node:test";
import assert from "node:assert/strict";

import aiCaptureModule from "./ai-capture.ts";
import aiInboxModule from "./ai-inbox.ts";

const {
  buildAiCaptureMarkdown,
  buildAiCapturePlainText,
  captureAiNote,
  deriveAiCaptureTitle,
} = aiCaptureModule;
const {
  createAiInboxFolderRepository,
  resolveOrCreateAiInboxFolder,
} = aiInboxModule;

test("deriveAiCaptureTitle prefers explicit title and otherwise uses first user turn", () => {
  assert.equal(
    deriveAiCaptureTitle({
      title: "Keep this",
      messages: [{ role: "user", content: "ignored because explicit title exists" }],
      capturedAt: new Date("2026-04-12T07:20:00.000Z"),
    }),
    "Keep this"
  );

  assert.equal(
    deriveAiCaptureTitle({
      messages: [{ role: "user", content: "How should I model OAuth grants for connector clients?" }],
      capturedAt: new Date("2026-04-12T07:20:00.000Z"),
    }),
    "How should I model OAuth grants for connector clients?"
  );
});

test("buildAiCaptureMarkdown preserves raw excerpt and metadata only", () => {
  const markdown = buildAiCaptureMarkdown({
    messages: [
      { role: "user", content: "Question body" },
      { role: "assistant", content: "Answer body" },
    ],
    sourceApp: "claude-code",
    capturedAtLabel: "2026-04-12 15:20 SGT",
    sourceMeta: { projectPath: "/Users/bytedance/second-brain" },
  });

  assert.match(markdown, /# Raw Excerpt/);
  assert.match(markdown, /## User\nQuestion body/);
  assert.match(markdown, /## Claude\nAnswer body/);
  assert.match(markdown, /- Source: claude-code/);
  assert.doesNotMatch(markdown, /Summary/);
});

test("buildAiCapturePlainText joins the raw transcript without extra summary text", () => {
  const plainText = buildAiCapturePlainText([
    { role: "user", content: "Question body" },
    { role: "assistant", content: "Answer body" },
  ]);

  assert.equal(plainText, "User\nQuestion body\n\nClaude\nAnswer body");
});

test("resolveOrCreateAiInboxFolder creates AI Inbox only once", async () => {
  const createdRows = [];
  const runner = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit: async () => [],
              };
            },
          };
        },
      };
    },
    insert() {
      return {
        values(value) {
          createdRows.push(value);
          return Promise.resolve();
        },
      };
    },
  };

  const repo = createAiInboxFolderRepository(runner);
  repo.findNextRootSortOrder = async () => 5;

  const firstId = await resolveOrCreateAiInboxFolder("user-1", {
    repo,
    randomUUID: () => "folder-ai-inbox",
  });

  assert.equal(firstId, "folder-ai-inbox");
  assert.equal(createdRows.length, 1);
  assert.equal(createdRows[0].name, "AI Inbox");
  assert.equal(createdRows[0].sortOrder, 5);
});

test("captureAiNote creates one indexed note in AI Inbox", async () => {
  let receivedFolderUserId = "";
  let insertedNote = null;
  let enqueueCall = null;

  const result = await captureAiNote(
    {
      userId: "user-1",
      messages: [
        { role: "user", content: "Question body" },
        { role: "assistant", content: "Answer body" },
      ],
      sourceApp: "claude-web",
      capturedAtLabel: "2026-04-12 15:20 SGT",
      capturedAt: new Date("2026-04-12T07:20:00.000Z"),
    },
    {
      now: () => new Date("2026-04-12T07:20:00.000Z"),
      randomUUID: () => "note-ai-capture",
      resolveOrCreateAiInboxFolder: async (userId) => {
        receivedFolderUserId = userId;
        return "folder-ai-inbox";
      },
      createNote: async (row) => {
        insertedNote = row;
      },
      enqueueNoteIndexJob: async (noteId, reason) => {
        enqueueCall = { noteId, reason };
      },
    }
  );

  assert.equal(receivedFolderUserId, "user-1");
  assert.equal(result.folderId, "folder-ai-inbox");
  assert.equal(insertedNote.userId, "user-1");
  assert.equal(insertedNote.folderId, "folder-ai-inbox");
  assert.equal(insertedNote.title, "Question body");
  assert.equal(insertedNote.plainText, "User\nQuestion body\n\nClaude\nAnswer body");
  assert.equal(typeof insertedNote.content, "string");
  assert.equal(enqueueCall.noteId, "note-ai-capture");
  assert.equal(enqueueCall.reason, "ai-capture");
});
