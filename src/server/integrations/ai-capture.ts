import crypto from "node:crypto";

import { markdownToTiptap } from "../../lib/markdown-to-tiptap";
import { notes } from "../db/schema";
import {
  createAiInboxFolderRepository,
  resolveOrCreateAiInboxFolder as resolveOrCreateAiInboxFolderBase,
  type AiInboxFolderRepository,
} from "./ai-inbox";

export type AiCaptureMessage = {
  role: string;
  content: string;
};

export type AiCaptureInput = {
  userId: string;
  sourceApp: string;
  messages: AiCaptureMessage[];
  title?: string | null;
  sourceMeta?: Record<string, unknown>;
  capturedAt?: Date | string | number;
  capturedAtLabel?: string;
};

export type AiCaptureDependencies = {
  now?: () => Date;
  randomUUID?: () => string;
  markdownToTiptap?: typeof markdownToTiptap;
  enqueueNoteIndexJob?: (noteId: string, reason: string) => Promise<unknown>;
  resolveOrCreateAiInboxFolder?: (
    userId: string,
    options?: {
      repo?: AiInboxFolderRepository;
      randomUUID?: () => string;
    }
  ) => Promise<string>;
  inboxRepo?: AiInboxFolderRepository;
  createNote?: (input: {
    id: string;
    userId: string;
    title: string;
    content: string;
    plainText: string;
    folderId: string;
    type: "note";
  }) => Promise<void>;
};

type AiCaptureDbRunner = {
  insert: (...args: unknown[]) => {
    values: (value: unknown) => Promise<unknown>;
  };
};

function normalizeText(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

function firstNonEmptyLine(value: string) {
  const lines = normalizeText(value).split("\n");
  return lines.find((line) => line.trim().length > 0)?.trim() ?? "";
}

function formatRoleLabel(role: string) {
  const trimmed = role.trim().toLowerCase();
  if (trimmed === "assistant") return "Claude";
  if (trimmed === "user") return "User";
  if (!trimmed) return "Message";
  return `${trimmed[0]!.toUpperCase()}${trimmed.slice(1)}`;
}

function formatCaptureTimestamp(date: Date) {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function formatMetadataValue(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function normalizeCaptureMeta(
  sourceMeta: Record<string, unknown> | undefined
): [string, unknown][] {
  return Object.entries(sourceMeta ?? {})
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
}

export function deriveAiCaptureTitle(input: {
  title?: string | null;
  messages: AiCaptureMessage[];
  capturedAt?: Date | string | number;
}) {
  const explicit = input.title?.trim();
  if (explicit) return explicit.slice(0, 160);

  const firstUserMessage = input.messages.find(
    (message) => message.role === "user" && message.content.trim().length > 0
  );
  if (firstUserMessage) {
    const titleFromUserMessage = firstNonEmptyLine(firstUserMessage.content);
    if (titleFromUserMessage) return titleFromUserMessage.slice(0, 160);
  }

  const capturedAt = input.capturedAt
    ? new Date(input.capturedAt)
    : new Date();
  return `Claude Capture - ${formatCaptureTimestamp(capturedAt)}`;
}

export function buildAiCaptureMarkdown(input: {
  sourceApp: string;
  capturedAtLabel: string;
  messages: AiCaptureMessage[];
  sourceMeta?: Record<string, unknown>;
}) {
  const lines = ["# Raw Excerpt", ""];

  for (const message of input.messages) {
    lines.push(`## ${formatRoleLabel(message.role)}`);
    lines.push(normalizeText(message.content));
    lines.push("");
  }

  lines.push("# Metadata", "");
  lines.push(`- Source: ${input.sourceApp}`);
  lines.push(`- Captured at: ${input.capturedAtLabel}`);

  for (const [key, value] of normalizeCaptureMeta(input.sourceMeta)) {
    lines.push(`- ${key}: ${formatMetadataValue(value)}`);
  }

  return lines.join("\n").trimEnd();
}

export function buildAiCapturePlainText(messages: AiCaptureMessage[]) {
  return messages
    .map((message) => `${formatRoleLabel(message.role)}\n${normalizeText(message.content) || "(empty)"}`)
    .join("\n\n");
}

export function createAiCaptureNoteWriter(runner: AiCaptureDbRunner) {
  return async function createNote(input: {
    id: string;
    userId: string;
    title: string;
    content: string;
    plainText: string;
    folderId: string;
    type: "note";
  }) {
    await runner.insert(notes).values({
      id: input.id,
      userId: input.userId,
      title: input.title,
      content: input.content,
      plainText: input.plainText,
      type: input.type,
      folderId: input.folderId,
    });
  };
}

async function getDefaultAiCaptureNoteWriter() {
  const { db } = await import("../db/index");
  return createAiCaptureNoteWriter(
    db as unknown as Parameters<typeof createAiCaptureNoteWriter>[0]
  );
}

async function getDefaultEnqueueNoteIndexJob() {
  const { enqueueNoteIndexJob } = await import("../ai/indexer");
  return enqueueNoteIndexJob;
}

async function getDefaultAiInboxFolderRepository() {
  const { db } = await import("../db/index");
  return createAiInboxFolderRepository(
    db as unknown as Parameters<typeof createAiInboxFolderRepository>[0]
  );
}

export async function captureAiConversation(
  input: AiCaptureInput,
  dependencies: AiCaptureDependencies = {}
) {
  const now = dependencies.now ?? (() => new Date());
  const randomUUID = dependencies.randomUUID ?? crypto.randomUUID;
  const markdownToTiptapImpl =
    dependencies.markdownToTiptap ?? markdownToTiptap;
  const resolveFolderImpl =
    dependencies.resolveOrCreateAiInboxFolder ??
    resolveOrCreateAiInboxFolderBase;
  const repo =
    dependencies.inboxRepo ??
    (dependencies.resolveOrCreateAiInboxFolder
      ? undefined
      : await getDefaultAiInboxFolderRepository());
  const createNote =
    dependencies.createNote ?? (await getDefaultAiCaptureNoteWriter());
  const enqueueNoteIndexJobImpl =
    dependencies.enqueueNoteIndexJob ?? (await getDefaultEnqueueNoteIndexJob());

  const capturedAt = now();
  const title = deriveAiCaptureTitle({
    title: input.title,
    messages: input.messages,
    capturedAt,
  });
  const markdown = buildAiCaptureMarkdown({
    sourceApp: input.sourceApp,
    capturedAtLabel:
      input.capturedAtLabel ?? formatCaptureTimestamp(capturedAt) + " UTC",
    messages: input.messages,
    sourceMeta: input.sourceMeta,
  });
  const plainText = buildAiCapturePlainText(input.messages);
  const folderId = await resolveFolderImpl(input.userId, {
    repo,
    randomUUID,
  });
  const noteId = randomUUID();
  const content = JSON.stringify(markdownToTiptapImpl(markdown));

  await createNote({
    id: noteId,
    userId: input.userId,
    title,
    content,
    plainText,
    folderId,
    type: "note",
  });

  await enqueueNoteIndexJobImpl(noteId, "ai-capture");

  return { noteId, folderId, title };
}

export async function captureAiNote(
  input: AiCaptureInput,
  dependencies: AiCaptureDependencies = {}
) {
  return captureAiConversation(input, dependencies);
}
