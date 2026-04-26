import { describe, expect, it } from "vitest";
import {
  resolveOrCreateNamedFolder,
  type AiInboxFolderRepository,
} from "./ai-inbox";

function makeStubRepo(overrides: Partial<AiInboxFolderRepository> = {}): AiInboxFolderRepository {
  return {
    findInboxFolder: async () => null,
    findFolderByName: async () => null,
    findNextRootSortOrder: async () => 0,
    createInboxFolder: async () => {},
    createFolder: async () => {},
    ...overrides,
  };
}

describe("resolveOrCreateNamedFolder", () => {
  it("creates a new top-level folder when none exists", async () => {
    let captured: { id: string; userId: string; name: string; sortOrder: number } | null = null;
    const repo = makeStubRepo({
      findFolderByName: async () => null,
      findNextRootSortOrder: async () => 7,
      createFolder: async (input) => {
        captured = {
          id: input.id,
          userId: input.userId,
          name: input.name,
          sortOrder: input.sortOrder,
        };
      },
    });

    const id = await resolveOrCreateNamedFolder("user-1", "八股文", {
      repo,
      randomUUID: () => "folder-bagu-1",
    });

    expect(id).toBe("folder-bagu-1");
    expect(captured).toEqual({
      id: "folder-bagu-1",
      userId: "user-1",
      name: "八股文",
      sortOrder: 7,
    });
  });

  it("reuses an existing folder by name", async () => {
    const repo = makeStubRepo({
      findFolderByName: async () => ({ id: "folder-existing" }),
      createFolder: async () => {
        throw new Error("should not create when folder exists");
      },
    });

    const id = await resolveOrCreateNamedFolder("user-1", "八股文", {
      repo,
      randomUUID: () => "should-not-be-used",
    });

    expect(id).toBe("folder-existing");
  });

  it("trims whitespace from the folder name before lookup and create", async () => {
    let lookedUp = "";
    let createdName = "";
    const repo = makeStubRepo({
      findFolderByName: async (_userId, name) => {
        lookedUp = name;
        return null;
      },
      createFolder: async (input) => {
        createdName = input.name;
      },
    });

    await resolveOrCreateNamedFolder("user-1", "  八股文  ", {
      repo,
      randomUUID: () => "id",
    });

    expect(lookedUp).toBe("八股文");
    expect(createdName).toBe("八股文");
  });

  it("rejects empty / whitespace-only name", async () => {
    const repo = makeStubRepo();
    await expect(
      resolveOrCreateNamedFolder("user-1", "   ", { repo, randomUUID: () => "x" })
    ).rejects.toThrow(/non-empty/);
  });
});
