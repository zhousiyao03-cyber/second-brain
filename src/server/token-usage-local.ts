import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import path from "path";
import {
  calculateTotalTokens,
  type TokenUsageListEntry,
  type TokenUsageLocalSourceStatus,
} from "@/lib/token-usage";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tryRequireBetterSqlite3(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("better-sqlite3");
  } catch {
    return null;
  }
}

type CodexThreadRow = {
  id: string;
  title: string;
  model: string | null;
  cwd: string;
  tokensUsed: number;
  updatedAt: number;
};

const homeDirectory = homedir();
const claudeProjectsRoot = path.join(homeDirectory, ".claude", "projects");
const LOCAL_USAGE_CACHE_TTL_MS = 10_000;

let cachedLocalTokenUsage:
  | {
      expiresAt: number;
      value: {
        entries: TokenUsageListEntry[];
        localSources: TokenUsageLocalSourceStatus[];
      };
    }
  | null = null;

function normalizeTokenValue(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function sortEntriesByUsageDate(entries: TokenUsageListEntry[]) {
  return entries.toSorted((left, right) => {
    return new Date(right.usageAt ?? 0).getTime() - new Date(left.usageAt ?? 0).getTime();
  });
}

function formatCodexEntryNotes(title: string, cwd: string) {
  const normalizedTitle = title.trim();

  if (!normalizedTitle) {
    return cwd;
  }

  if (!cwd.trim()) {
    return normalizedTitle;
  }

  return `${normalizedTitle} · ${cwd}`;
}

function listClaudeSessionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return listClaudeSessionFiles(absolutePath);
    }

    if (!entry.isFile() || !entry.name.endsWith(".jsonl") || entry.name === "sessions-index.json") {
      return [];
    }

    return [absolutePath];
  });
}

function resolveCodexStateDatabasePath() {
  const codexDirectory = path.join(homeDirectory, ".codex");
  if (!existsSync(codexDirectory)) {
    return null;
  }

  const candidates = readdirSync(codexDirectory)
    .filter((name) => /^state(?:_\d+)?\.sqlite$/.test(name))
    .map((name) => {
      const absolutePath = path.join(codexDirectory, name);
      return {
        path: absolutePath,
        mtimeMs: statSync(absolutePath).mtimeMs,
      };
    })
    .toSorted((left, right) => right.mtimeMs - left.mtimeMs);

  return candidates[0]?.path ?? null;
}

function readCodexWorkspaceEntries() {
  const dbPath = resolveCodexStateDatabasePath();
  if (!dbPath) {
    return {
      entries: [] as TokenUsageListEntry[],
      source: {
        provider: "codex",
        label: "Codex",
        source: "local-codex",
        status: "missing",
        location: path.join(homeDirectory, ".codex"),
        entryCount: 0,
        detail: "没有找到 Codex 本地状态库。",
      } satisfies TokenUsageLocalSourceStatus,
    };
  }

  const Database = tryRequireBetterSqlite3();
  if (!Database) {
    return {
      entries: [] as TokenUsageListEntry[],
      source: {
        provider: "codex",
        label: "Codex",
        source: "local-codex",
        status: "error",
        location: dbPath,
        entryCount: 0,
        detail: "better-sqlite3 不可用（部署环境）。",
      } satisfies TokenUsageLocalSourceStatus,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sqlite: any = null;

  try {
    sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = sqlite
      .prepare(
        `
          select
            id,
            title,
            model,
            cwd,
            tokens_used as tokensUsed,
            updated_at as updatedAt
          from threads
          where tokens_used > 0
          order by updated_at desc
        `
      )
      .all() as CodexThreadRow[];

    const entries = rows.map((row) => ({
      id: `local:codex:${row.id}`,
      provider: "codex" as const,
      model: row.model ?? null,
      totalTokens: normalizeTokenValue(row.tokensUsed),
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      notes: formatCodexEntryNotes(row.title, row.cwd),
      source: "local-codex" as const,
      usageAt: new Date(normalizeTokenValue(row.updatedAt) * 1000),
      canDelete: false,
    }));

    return {
      entries,
      source: {
        provider: "codex",
        label: "Codex",
        source: "local-codex",
        status: "connected",
        location: dbPath,
        entryCount: entries.length,
        detail:
          entries.length > 0
            ? `已读取本机的 ${entries.length} 条 Codex session。`
            : "本机还没有读到 Codex session。",
      } satisfies TokenUsageLocalSourceStatus,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "读取 Codex 本地状态库失败。";

    return {
      entries: [] as TokenUsageListEntry[],
      source: {
        provider: "codex",
        label: "Codex",
        source: "local-codex",
        status: "error",
        location: dbPath,
        entryCount: 0,
        detail,
      } satisfies TokenUsageLocalSourceStatus,
    };
  } finally {
    sqlite?.close();
  }
}

function readClaudeSessionEntry(
  filePath: string,
  projectRoot: string
): TokenUsageListEntry | null {
  const rawContent = readFileSync(filePath, "utf8");
  const lines = rawContent.split(/\r?\n/);
  const fileName = path.basename(filePath, ".jsonl");
  const relativeFilePath = path.relative(projectRoot, filePath).split(path.sep).join("/");
  const fallbackTimestamp = statSync(filePath).mtimeMs;

  let latestTimestamp = fallbackTimestamp;
  let cwd: string | null = null;
  let model: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const item = JSON.parse(line) as {
        cwd?: unknown;
        timestamp?: unknown;
        message?: {
          model?: unknown;
          usage?: {
            input_tokens?: unknown;
            output_tokens?: unknown;
            cache_creation_input_tokens?: unknown;
            cache_read_input_tokens?: unknown;
          };
        };
      };

      if (typeof item.cwd === "string" && item.cwd.length > 0) {
        cwd = item.cwd;
      }

      if (typeof item.timestamp === "string") {
        const timestamp = Date.parse(item.timestamp);
        if (Number.isFinite(timestamp)) {
          latestTimestamp = Math.max(latestTimestamp, timestamp);
        }
      }

      if (typeof item.message?.model === "string" && item.message.model.length > 0) {
        model = item.message.model;
      }

      const usage = item.message?.usage;
      if (!usage) continue;

      inputTokens += normalizeTokenValue(usage.input_tokens);
      outputTokens += normalizeTokenValue(usage.output_tokens);
      cachedTokens +=
        normalizeTokenValue(usage.cache_creation_input_tokens) +
        normalizeTokenValue(usage.cache_read_input_tokens);
    } catch {
      continue;
    }
  }

  const totalTokens = calculateTotalTokens({
    inputTokens,
    outputTokens,
    cachedTokens,
  });

  if (totalTokens <= 0) {
    return null;
  }

  return {
    id: `local:claude-code:${relativeFilePath}`,
    provider: "claude-code",
    model,
    totalTokens,
    inputTokens,
    outputTokens,
    cachedTokens,
    notes: relativeFilePath.includes("/subagents/")
      ? cwd
        ? `Subagent session · ${cwd}`
        : `Subagent session · ${relativeFilePath}`
      : cwd
        ? `Workspace: ${cwd}`
        : `Claude Code session · ${relativeFilePath || fileName.slice(0, 8)}`,
    source: "local-claude-code",
    usageAt: new Date(latestTimestamp),
    canDelete: false,
  };
}

function readClaudeWorkspaceEntries() {
  const claudeProjectDirectory = claudeProjectsRoot;

  if (!existsSync(claudeProjectDirectory)) {
    return {
      entries: [] as TokenUsageListEntry[],
      source: {
        provider: "claude-code",
        label: "Claude Code",
        source: "local-claude-code",
        status: "missing",
        location: claudeProjectDirectory,
        entryCount: 0,
        detail: "没有找到 Claude Code 本地 session 目录。",
      } satisfies TokenUsageLocalSourceStatus,
    };
  }

  try {
    const entries = listClaudeSessionFiles(claudeProjectDirectory)
      .map((filePath) => readClaudeSessionEntry(filePath, claudeProjectDirectory))
      .filter((entry): entry is TokenUsageListEntry => entry != null);

    return {
      entries,
      source: {
        provider: "claude-code",
        label: "Claude Code",
        source: "local-claude-code",
        status: "connected",
        location: claudeProjectDirectory,
        entryCount: entries.length,
        detail:
          entries.length > 0
            ? `已聚合本机的 ${entries.length} 个 Claude Code session（含 subagents）。`
            : "本机还没有读到 Claude Code session。",
      } satisfies TokenUsageLocalSourceStatus,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "读取 Claude Code 本地 session 失败。";

    return {
      entries: [] as TokenUsageListEntry[],
      source: {
        provider: "claude-code",
        label: "Claude Code",
        source: "local-claude-code",
        status: "error",
        location: claudeProjectDirectory,
        entryCount: 0,
        detail,
      } satisfies TokenUsageLocalSourceStatus,
    };
  }
}

export function readWorkspaceLocalTokenUsage() {
  if (cachedLocalTokenUsage != null && cachedLocalTokenUsage.expiresAt > Date.now()) {
    return cachedLocalTokenUsage.value;
  }

  const codex = readCodexWorkspaceEntries();
  const claude = readClaudeWorkspaceEntries();

  const value = {
    entries: sortEntriesByUsageDate([...codex.entries, ...claude.entries]),
    localSources: [codex.source, claude.source],
  };

  cachedLocalTokenUsage = {
    expiresAt: Date.now() + LOCAL_USAGE_CACHE_TTL_MS,
    value,
  };

  return value;
}
