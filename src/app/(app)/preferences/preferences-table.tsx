"use client";

import { useState } from "react";

import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type DraftRow = {
  scope: string;
  key: string;
  value: string;
  description: string;
};

const EMPTY_DRAFT: DraftRow = {
  scope: "global",
  key: "",
  value: "",
  description: "",
};

export function PreferencesTable() {
  const utils = trpc.useUtils();
  const list = trpc.preferences.list.useQuery();
  const setMutation = trpc.preferences.set.useMutation({
    onSuccess: () => utils.preferences.list.invalidate(),
  });
  const deleteMutation = trpc.preferences.delete.useMutation({
    onSuccess: () => utils.preferences.list.invalidate(),
  });

  const [draft, setDraft] = useState<DraftRow | null>(null);
  const [editing, setEditing] = useState<{
    scope: string;
    key: string;
    field: "value" | "description";
    text: string;
  } | null>(null);

  if (list.isLoading) return <p className="text-sm">Loading…</p>;
  if (list.error)
    return <p className="text-sm text-red-600">Error: {list.error.message}</p>;

  const rows = list.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm"
          onClick={() => setDraft({ ...EMPTY_DRAFT })}
        >
          Add preference
        </button>
      </div>

      <div className="overflow-x-auto border rounded-md">
        <table className="w-full text-sm" data-testid="preferences-table">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="p-2 w-32">Scope</th>
              <th className="p-2 w-44">Key</th>
              <th className="p-2">Value</th>
              <th className="p-2 w-56">Description</th>
              <th className="p-2 w-32">Updated</th>
              <th className="p-2 w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && draft === null && (
              <tr>
                <td
                  colSpan={6}
                  className="p-4 text-center text-muted-foreground"
                >
                  No preferences yet. Click &quot;Add preference&quot; to start.
                </td>
              </tr>
            )}

            {rows.map((row) => {
              const isEditing =
                editing &&
                editing.scope === row.scope &&
                editing.key === row.key;
              return (
                <tr
                  key={`${row.scope}::${row.key}`}
                  className="border-t"
                  data-testid={`preferences-row-${row.scope}-${row.key}`}
                >
                  <td className="p-2 font-mono">{row.scope}</td>
                  <td className="p-2 font-mono">{row.key}</td>
                  <td
                    className={cn("p-2 cursor-pointer align-top")}
                    onClick={() =>
                      setEditing({
                        scope: row.scope,
                        key: row.key,
                        field: "value",
                        text: row.value,
                      })
                    }
                  >
                    {isEditing && editing.field === "value" ? (
                      <CellTextarea
                        value={editing.text}
                        onChange={(text) =>
                          setEditing({ ...editing, text })
                        }
                        onCommit={async () => {
                          await setMutation.mutateAsync({
                            scope: row.scope,
                            key: row.key,
                            value: editing.text,
                            description: row.description,
                          });
                          setEditing(null);
                        }}
                        onCancel={() => setEditing(null)}
                        testId="edit-value"
                      />
                    ) : (
                      <pre className="whitespace-pre-wrap break-words font-sans">
                        {row.value}
                      </pre>
                    )}
                  </td>
                  <td
                    className="p-2 cursor-pointer text-muted-foreground align-top"
                    onClick={() =>
                      setEditing({
                        scope: row.scope,
                        key: row.key,
                        field: "description",
                        text: row.description ?? "",
                      })
                    }
                  >
                    {isEditing && editing.field === "description" ? (
                      <CellTextarea
                        value={editing.text}
                        onChange={(text) =>
                          setEditing({ ...editing, text })
                        }
                        onCommit={async () => {
                          await setMutation.mutateAsync({
                            scope: row.scope,
                            key: row.key,
                            value: row.value,
                            description: editing.text,
                          });
                          setEditing(null);
                        }}
                        onCancel={() => setEditing(null)}
                        testId="edit-description"
                      />
                    ) : (
                      <pre className="whitespace-pre-wrap break-words font-sans">
                        {row.description ?? "—"}
                      </pre>
                    )}
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {new Date(row.updatedAt).toLocaleString()}
                  </td>
                  <td className="p-2">
                    <button
                      type="button"
                      className="text-red-600 text-xs"
                      onClick={async () => {
                        if (!confirm(`Delete ${row.scope}/${row.key}?`))
                          return;
                        await deleteMutation.mutateAsync({
                          scope: row.scope,
                          key: row.key,
                        });
                      }}
                      data-testid="delete-button"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}

            {draft && (
              <tr className="border-t bg-yellow-50/30" data-testid="draft-row">
                <td className="p-2">
                  <select
                    value={draft.scope.startsWith("project:")
                      ? "project"
                      : "global"}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        scope:
                          e.target.value === "global" ? "global" : "project:",
                      })
                    }
                    className="w-full text-xs border rounded px-1 py-0.5"
                  >
                    <option value="global">global</option>
                    <option value="project">project:&lt;slug&gt;</option>
                  </select>
                  {draft.scope.startsWith("project:") && (
                    <input
                      type="text"
                      placeholder="slug"
                      value={draft.scope.slice("project:".length)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          scope: `project:${e.target.value}`,
                        })
                      }
                      className="mt-1 w-full text-xs border rounded px-1 py-0.5 font-mono"
                      data-testid="draft-scope-slug"
                    />
                  )}
                </td>
                <td className="p-2">
                  <input
                    type="text"
                    placeholder="snake_case_key"
                    value={draft.key}
                    onChange={(e) =>
                      setDraft({ ...draft, key: e.target.value })
                    }
                    className="w-full text-xs border rounded px-1 py-0.5 font-mono"
                    data-testid="draft-key"
                  />
                </td>
                <td className="p-2">
                  <textarea
                    value={draft.value}
                    onChange={(e) =>
                      setDraft({ ...draft, value: e.target.value })
                    }
                    className="w-full text-xs border rounded px-1 py-0.5"
                    rows={2}
                    data-testid="draft-value"
                  />
                </td>
                <td className="p-2">
                  <textarea
                    value={draft.description}
                    onChange={(e) =>
                      setDraft({ ...draft, description: e.target.value })
                    }
                    className="w-full text-xs border rounded px-1 py-0.5"
                    rows={2}
                    data-testid="draft-description"
                  />
                </td>
                <td className="p-2 text-xs text-muted-foreground">—</td>
                <td className="p-2 space-x-2">
                  <button
                    type="button"
                    className="text-xs"
                    onClick={async () => {
                      try {
                        await setMutation.mutateAsync({
                          scope: draft.scope,
                          key: draft.key,
                          value: draft.value,
                          description:
                            draft.description.trim() === ""
                              ? null
                              : draft.description,
                        });
                        setDraft(null);
                      } catch (err) {
                        alert(
                          err instanceof Error ? err.message : "Save failed"
                        );
                      }
                    }}
                    data-testid="draft-save"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground"
                    onClick={() => setDraft(null)}
                  >
                    Cancel
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CellTextarea({
  value,
  onChange,
  onCommit,
  onCancel,
  testId,
}: {
  value: string;
  onChange: (text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  testId?: string;
}) {
  return (
    <textarea
      autoFocus
      value={value}
      rows={Math.max(1, Math.min(8, value.split("\n").length))}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onCommit();
        }
      }}
      className="w-full text-sm border rounded px-1 py-0.5"
      data-testid={testId}
    />
  );
}
