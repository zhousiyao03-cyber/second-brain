"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type KeyboardEvent,
} from "react";
import { Extension, type Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { cn } from "@/lib/utils";
import {
  Search,
  ChevronUp,
  ChevronDown,
  X,
  Replace,
  ReplaceAll,
  ArrowRightLeft,
} from "lucide-react";

/* ---------- Match types ---------- */

interface SearchMatch {
  from: number;
  to: number;
}

interface SearchPluginState {
  query: string;
  matches: SearchMatch[];
  currentIndex: number;
}

/* ---------- Extension storage type shared between extension & component ---------- */

interface SearchStorage {
  query: string;
  matches: SearchMatch[];
  currentIndex: number;
}

/* ---------- Utility: find all case-insensitive matches in document ---------- */

function findMatches(doc: ProseMirrorNode, query: string): SearchMatch[] {
  if (!query) return [];

  const results: SearchMatch[] = [];
  const lowerQuery = query.toLowerCase();

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;

    const text = node.text.toLowerCase();
    let index = text.indexOf(lowerQuery);

    while (index !== -1) {
      results.push({
        from: pos + index,
        to: pos + index + query.length,
      });
      index = text.indexOf(lowerQuery, index + 1);
    }
  });

  return results;
}

/* ---------- ProseMirror plugin ---------- */

const searchPluginKey = new PluginKey("searchReplace");

function buildDecorationSet(
  doc: ProseMirrorNode,
  pluginState: SearchPluginState
): DecorationSet {
  if (!pluginState.query || pluginState.matches.length === 0) {
    return DecorationSet.empty;
  }

  const decorations: Decoration[] = pluginState.matches.map((match, index) => {
    const isCurrent = index === pluginState.currentIndex;
    return Decoration.inline(match.from, match.to, {
      class: isCurrent ? "search-match search-match-current" : "search-match",
    });
  });

  return DecorationSet.create(doc, decorations);
}

/* ---------- Helpers to dispatch search commands via the plugin ---------- */

function dispatchSearchMeta(
  editor: Editor,
  meta: { type: string; query?: string }
) {
  const { tr } = editor.state;
  tr.setMeta(searchPluginKey, meta);
  editor.view.dispatch(tr);
}

/* ---------- Tiptap extension ---------- */

export interface SearchReplaceOptions {
  /** Callback invoked when the extension wants to open the search bar */
  onOpen?: () => void;
}

export const SearchReplace = Extension.create<SearchReplaceOptions>({
  name: "searchReplace",

  addOptions() {
    return {
      onOpen: undefined,
    };
  },

  addStorage(): SearchStorage {
    return {
      query: "",
      matches: [],
      currentIndex: 0,
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-f": () => {
        this.options.onOpen?.();
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const extensionStorage = this.storage as SearchStorage;

    return [
      new Plugin({
        key: searchPluginKey,
        state: {
          init(): SearchPluginState {
            return { query: "", matches: [], currentIndex: 0 };
          },
          apply(
            tr: Transaction,
            prev: SearchPluginState,
            _oldState,
            newState
          ): SearchPluginState {
            const meta = tr.getMeta(searchPluginKey) as
              | { type: string; query?: string }
              | undefined;

            if (!meta) {
              // If the document changed, recalculate matches with same query
              if (tr.docChanged && prev.query) {
                const matches = findMatches(newState.doc, prev.query);
                const currentIndex =
                  matches.length > 0
                    ? Math.min(prev.currentIndex, matches.length - 1)
                    : 0;

                const nextState = { query: prev.query, matches, currentIndex };
                extensionStorage.query = nextState.query;
                extensionStorage.matches = nextState.matches;
                extensionStorage.currentIndex = nextState.currentIndex;
                return nextState;
              }
              return prev;
            }

            let next: SearchPluginState;

            switch (meta.type) {
              case "setQuery": {
                const query = meta.query ?? "";
                const matches = findMatches(newState.doc, query);
                next = { query, matches, currentIndex: 0 };
                break;
              }
              case "nextMatch": {
                if (prev.matches.length === 0) return prev;
                next = {
                  ...prev,
                  currentIndex:
                    (prev.currentIndex + 1) % prev.matches.length,
                };
                break;
              }
              case "prevMatch": {
                if (prev.matches.length === 0) return prev;
                next = {
                  ...prev,
                  currentIndex:
                    (prev.currentIndex - 1 + prev.matches.length) %
                    prev.matches.length,
                };
                break;
              }
              case "clear": {
                next = { query: "", matches: [], currentIndex: 0 };
                break;
              }
              default:
                return prev;
            }

            // Sync to extension storage so React can read it
            extensionStorage.query = next.query;
            extensionStorage.matches = next.matches;
            extensionStorage.currentIndex = next.currentIndex;
            return next;
          },
        },
        props: {
          decorations(state) {
            const pluginState = searchPluginKey.getState(
              state
            ) as SearchPluginState;
            if (!pluginState) return DecorationSet.empty;
            return buildDecorationSet(state.doc, pluginState);
          },
        },
      }),
    ];
  },
});

/* ---------- Read search storage from the editor ---------- */

function getSearchStorage(editor: Editor): SearchStorage | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storage = (editor.extensionStorage as any)?.searchReplace;
  return storage as SearchStorage | undefined;
}

/* ---------- Search bar React component ---------- */

interface SearchBarProps {
  editor: Editor;
  isOpen: boolean;
  onClose: () => void;
}

export function SearchBar({ editor, isOpen, onClose }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [matchInfo, setMatchInfo] = useState({ total: 0, current: 0 });
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    }
  }, [isOpen]);

  // Sync match info from extension storage whenever editor state updates
  useEffect(() => {
    if (!isOpen || !editor) return;

    const updateMatchInfo = () => {
      const storage = getSearchStorage(editor);
      if (storage) {
        setMatchInfo({
          total: storage.matches.length,
          current: storage.matches.length > 0 ? storage.currentIndex + 1 : 0,
        });
      }
    };

    editor.on("transaction", updateMatchInfo);
    updateMatchInfo();

    return () => {
      editor.off("transaction", updateMatchInfo);
    };
  }, [editor, isOpen]);

  useEffect(() => {
    return () => {
      dispatchSearchMeta(editor, { type: "clear" });
    };
  }, [editor]);

  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value);
      dispatchSearchMeta(editor, { type: "setQuery", query: value });
    },
    [editor]
  );

  /** Scroll to the current match after navigating */
  const scrollToCurrentMatch = useCallback(() => {
    requestAnimationFrame(() => {
      const storage = getSearchStorage(editor);
      if (storage && storage.matches.length > 0) {
        const match = storage.matches[storage.currentIndex];
        if (match) {
          editor.chain().setTextSelection(match.from).run();
          const { node } = editor.view.domAtPos(match.from);
          (node as HTMLElement)?.scrollIntoView?.({
            behavior: "smooth",
            block: "center",
          });
        }
      }
    });
  }, [editor]);

  const handleNext = useCallback(() => {
    dispatchSearchMeta(editor, { type: "nextMatch" });
    scrollToCurrentMatch();
  }, [editor, scrollToCurrentMatch]);

  const handlePrev = useCallback(() => {
    dispatchSearchMeta(editor, { type: "prevMatch" });
    scrollToCurrentMatch();
  }, [editor, scrollToCurrentMatch]);

  const handleReplace = useCallback(() => {
    const storage = getSearchStorage(editor);
    if (!storage || storage.matches.length === 0) return;

    const match = storage.matches[storage.currentIndex];
    if (!match) return;

    editor
      .chain()
      .focus()
      .setTextSelection({ from: match.from, to: match.to })
      .insertContent(replaceText)
      .run();

    // Re-run search to update matches after replacement
    dispatchSearchMeta(editor, { type: "setQuery", query });
  }, [editor, replaceText, query]);

  const handleReplaceAll = useCallback(() => {
    const storage = getSearchStorage(editor);
    if (!storage || storage.matches.length === 0) return;

    // Replace from end to start to preserve positions
    const matches = [...storage.matches].reverse();

    const { tr } = editor.state;
    for (const match of matches) {
      if (replaceText) {
        tr.replaceWith(
          match.from,
          match.to,
          editor.state.schema.text(replaceText)
        );
      } else {
        tr.delete(match.from, match.to);
      }
    }
    editor.view.dispatch(tr);

    // Re-run search to update matches after replacement
    dispatchSearchMeta(editor, { type: "setQuery", query });
  }, [editor, replaceText, query]);

  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        editor.commands.focus();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey) {
          handlePrev();
        } else {
          handleNext();
        }
      }
    },
    [onClose, editor, handleNext, handlePrev]
  );

  const handleReplaceKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        editor.commands.focus();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        handleReplace();
      }
    },
    [onClose, editor, handleReplace]
  );

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "search-bar",
        "animate-in slide-in-from-top-2 fade-in duration-150"
      )}
      data-testid="editor-search-bar"
      onKeyDown={(e) => {
        // Prevent Cmd+F from bubbling when search is already open
        if ((e.metaKey || e.ctrlKey) && e.key === "f") {
          e.preventDefault();
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }
      }}
    >
      {/* Search row */}
      <div className="flex items-center gap-1.5">
        {/* Toggle replace button */}
        <button
          type="button"
          aria-label={showReplace ? "Hide replace" : "Show replace"}
          title={showReplace ? "Hide replace" : "Show replace"}
          onClick={() => setShowReplace(!showReplace)}
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded",
            "text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600",
            "dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-300",
            showReplace &&
              "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"
          )}
        >
          <ArrowRightLeft size={14} />
        </button>

        {/* Search input */}
        <div className="relative flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500"
          />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search..."
            data-testid="editor-search-input"
            className={cn(
              "h-7 w-full rounded border bg-white pl-7 pr-2 text-sm outline-none",
              "border-stone-200 text-stone-800 placeholder:text-stone-400",
              "focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30",
              "dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200",
              "dark:placeholder:text-stone-500 dark:focus:border-blue-500"
            )}
          />
        </div>

        {/* Match count */}
        <span
          className="shrink-0 min-w-[3rem] text-center text-xs tabular-nums text-stone-400 dark:text-stone-500"
          data-testid="editor-search-match-count"
        >
          {query
            ? matchInfo.total > 0
              ? `${matchInfo.current}/${matchInfo.total}`
              : "No matches"
            : ""}
        </span>

        {/* Navigation buttons */}
        <button
          type="button"
          aria-label="Previous match"
          title="Previous match (Shift+Enter)"
          onClick={handlePrev}
          disabled={matchInfo.total === 0}
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded",
            "text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600",
            "dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-300",
            "disabled:opacity-30 disabled:pointer-events-none"
          )}
        >
          <ChevronUp size={16} />
        </button>
        <button
          type="button"
          aria-label="Next match"
          title="Next match (Enter)"
          onClick={handleNext}
          disabled={matchInfo.total === 0}
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded",
            "text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600",
            "dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-300",
            "disabled:opacity-30 disabled:pointer-events-none"
          )}
        >
          <ChevronDown size={16} />
        </button>

        {/* Close button */}
        <button
          type="button"
          aria-label="Close search"
          title="Close search (Escape)"
          onClick={() => {
            onClose();
            editor.commands.focus();
          }}
          data-testid="editor-search-close"
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded",
            "text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600",
            "dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-300"
          )}
        >
          <X size={16} />
        </button>
      </div>

      {/* Replace row (conditionally shown) */}
      {showReplace && (
        <div className="flex items-center gap-1.5">
          {/* Spacer to align with search input */}
          <div className="w-6 shrink-0" />

          {/* Replace input */}
          <input
            type="text"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            onKeyDown={handleReplaceKeyDown}
            placeholder="Replace..."
            data-testid="editor-replace-input"
            className={cn(
              "h-7 flex-1 rounded border bg-white pl-2.5 pr-2 text-sm outline-none",
              "border-stone-200 text-stone-800 placeholder:text-stone-400",
              "focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30",
              "dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200",
              "dark:placeholder:text-stone-500 dark:focus:border-blue-500"
            )}
          />

          {/* Replace button */}
          <button
            type="button"
            aria-label="Replace"
            title="Replace current match (Enter)"
            onClick={handleReplace}
            disabled={matchInfo.total === 0}
            data-testid="editor-replace-button"
            className={cn(
              "flex h-6 shrink-0 items-center justify-center gap-1 rounded px-2",
              "text-xs text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700",
              "dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200",
              "disabled:opacity-30 disabled:pointer-events-none"
            )}
          >
            <Replace size={14} />
          </button>

          {/* Replace All button */}
          <button
            type="button"
            aria-label="Replace all"
            title="Replace all matches"
            onClick={handleReplaceAll}
            disabled={matchInfo.total === 0}
            data-testid="editor-replace-all-button"
            className={cn(
              "flex h-6 shrink-0 items-center justify-center gap-1 rounded px-2",
              "text-xs text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700",
              "dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200",
              "disabled:opacity-30 disabled:pointer-events-none"
            )}
          >
            <ReplaceAll size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
