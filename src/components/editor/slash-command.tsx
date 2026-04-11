"use client";

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useLayoutEffect,
} from "react";
import { Extension, type Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorCommandGroup, EditorCommandItem } from "./editor-commands";

/**
 * Tiptap extension that listens for '/' at the start of a line
 * and communicates with the React slash-command menu via a callback.
 */
export function createSlashCommandExtension(
  onActivate: (query: string, coords: { top: number; left: number }) => void,
  onDeactivate: () => void,
  onQueryChange: (query: string) => void
) {
  let isActive = false;
  let queryStart = 0;

  return Extension.create({
    name: "slashCommand",

    addKeyboardShortcuts() {
      return {
        Escape: () => {
          if (isActive) {
            isActive = false;
            onDeactivate();
            return true;
          }
          return false;
        },
      };
    },

    onUpdate({ editor }) {
      if (!isActive) return;

      const { state } = editor;
      const { from } = state.selection;
      const textBefore = state.doc.textBetween(queryStart, from, "\n", " ");

      if (!textBefore.startsWith("/")) {
        isActive = false;
        onDeactivate();
        return;
      }

      onQueryChange(textBefore.slice(1));
    },

    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey("slashCommand"),
          props: {
            handleKeyDown(view: EditorView, event: KeyboardEvent) {
              if (event.key === "/" && !isActive) {
                const { state } = view;
                const { $from } = state.selection;
                const textBefore = $from.parent.textContent.slice(
                  0,
                  $from.parentOffset
                );

                if (textBefore.trim() === "") {
                  const coords = view.coordsAtPos($from.pos);
                  isActive = true;
                  queryStart = $from.pos;

                  setTimeout(() => {
                    onActivate("", {
                      top: coords.bottom + 8,
                      left: coords.left,
                    });
                  }, 0);
                }
              }

              return false;
            },
          },
        }),
      ];
    },

    onSelectionUpdate({ editor }) {
      if (!isActive) return;

      const { from } = editor.state.selection;
      if (from < queryStart) {
        isActive = false;
        onDeactivate();
      }
    },
  });
}

interface SlashCommandMenuProps {
  editor: Editor;
  coords: { top: number; left: number } | null;
  query: string;
  items: EditorCommandItem[];
  groups?: EditorCommandGroup[];
  deleteTrigger?: boolean;
  onSelectItem?: (item: EditorCommandItem, editor: Editor) => void;
  testId?: string;
  onClose: () => void;
}

export function SlashCommandMenu({
  editor,
  coords,
  query,
  items,
  groups,
  deleteTrigger = true,
  onSelectItem,
  testId,
  onClose,
}: SlashCommandMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      items.filter((item) => {
        if (!normalizedQuery) return true;

        return [item.title, item.description, ...item.keywords].some((value) =>
          value.toLowerCase().includes(normalizedQuery)
        );
      }),
    [items, normalizedQuery]
  );

  // Build grouped sections for display
  const sections = useMemo(() => {
    const filteredIds = new Set(filtered.map((item) => item.id));

    if (groups) {
      return groups
        .map((group) => ({
          id: group.id,
          label: group.label,
          items: group.items.filter((item) => filteredIds.has(item.id)),
        }))
        .filter((section) => section.items.length > 0);
    }

    // For block action menus (no groups), single flat section
    return [{ id: "all", label: "", items: filtered }];
  }, [filtered, groups]);

  // Flat ordered list for keyboard navigation
  const flatItems = useMemo(
    () => sections.flatMap((s) => s.items),
    [sections]
  );

  useLayoutEffect(() => {
    if (!menuRef.current || !coords) return;

    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    menu.style.top = `${coords.top}px`;
    menu.style.left = `${Math.max(
      20,
      Math.min(coords.left, viewportWidth - rect.width - 20)
    )}px`;

    if (rect.bottom > viewportHeight - 20) {
      menu.style.top = `${coords.top - rect.height - 12}px`;
    }
  }, [coords, filtered.length]);

  const executeCommand = useCallback(
    (item: EditorCommandItem) => {
      if (onSelectItem) {
        onSelectItem(item, editor);
        onClose();
        return;
      }

      if (deleteTrigger) {
        const { from } = editor.state.selection;
        const deleteFrom = Math.max(0, from - query.length - 1);

        editor
          .chain()
          .focus()
          .deleteRange({ from: deleteFrom, to: from })
          .run();
      }

      item.run(editor);
      onClose();
    },
    [deleteTrigger, editor, onClose, onSelectItem, query]
  );

  useEffect(() => {
    if (!flatItems.length) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((previous) => (previous + 1) % flatItems.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex(
          (previous) => (previous - 1 + flatItems.length) % flatItems.length
        );
      } else if (event.key === "Enter") {
        event.preventDefault();

        const selectedItem = flatItems[selectedIndex];
        if (selectedItem) {
          executeCommand(selectedItem);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [executeCommand, flatItems, selectedIndex]);

  useEffect(() => {
    if (!coords) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;

      if (
        target instanceof HTMLElement &&
        (menuRef.current?.contains(target) ||
          target.closest("[data-editor-insert-controls='true']"))
      ) {
        return;
      }

      onClose();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [coords, onClose]);

  if (!coords || flatItems.length === 0) return null;

  // Track running index across sections for keyboard selection
  let runningIndex = 0;

  return (
    <div
      ref={menuRef}
      data-testid={testId}
      className="fixed z-50 w-[min(320px,calc(100vw-24px))] max-h-[380px] overflow-y-auto rounded-2xl border border-stone-200/80 bg-white p-1.5 shadow-[0_16px_48px_rgba(15,23,42,0.12)] dark:border-stone-800 dark:bg-stone-950"
      style={{ top: coords.top, left: coords.left }}
    >
      {sections.map((section) => {
        const sectionEl = (
          <div key={section.id}>
            {section.label && (
              <div className="mb-0.5 mt-2 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400 first:mt-1 dark:text-stone-500">
                {section.label}
              </div>
            )}
            <div className="space-y-px">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = item.isActive?.(editor) ?? false;
                const itemIndex = runningIndex++;

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors ${
                      itemIndex === selectedIndex
                        ? "bg-stone-100 dark:bg-stone-900"
                        : "hover:bg-stone-50 dark:hover:bg-stone-900/60"
                    }`}
                    onClick={() => executeCommand(item)}
                    onMouseEnter={() => setSelectedIndex(itemIndex)}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        isActive
                          ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-950"
                          : item.tone === "danger"
                            ? "bg-red-50 text-red-500 dark:bg-red-950/50 dark:text-red-400"
                            : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"
                      }`}
                    >
                      <Icon size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-[13px] font-medium leading-tight ${
                          item.tone === "danger"
                            ? "text-red-600 dark:text-red-400"
                            : "text-stone-900 dark:text-stone-100"
                        }`}
                      >
                        {item.title}
                      </div>
                      <div className="text-[11px] leading-tight text-stone-400 dark:text-stone-500">
                        {item.description}
                      </div>
                    </div>
                    {(item.shortcutHint || item.keyboardShortcut) && (
                      <div className="flex shrink-0 items-center gap-1">
                        {item.shortcutHint && (
                          <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] font-mono text-stone-400 dark:bg-stone-800 dark:text-stone-500">
                            {item.shortcutHint}
                          </span>
                        )}
                        {item.keyboardShortcut && (
                          <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] font-mono text-stone-400 dark:bg-stone-800 dark:text-stone-500">
                            {item.keyboardShortcut}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );

        return sectionEl;
      })}
    </div>
  );
}
