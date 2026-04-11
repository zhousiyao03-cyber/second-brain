"use client";

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ChangeEvent,
  type MouseEvent,
} from "react";
import {
  EditorContent,
  useEditor,
  type Editor as TiptapEditorInstance,
} from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { DOMParser as PMDOMParser, type Node as PMNode } from "@tiptap/pm/model";
import { GripVertical, Plus } from "lucide-react";
import {
  createSlashCommandExtension,
  SlashCommandMenu,
} from "./slash-command";
import { BubbleToolbar } from "./bubble-toolbar";
import {
  InlineAskAiPopover,
  type InlineAskAiAnchor,
} from "./inline-ask-ai-popover";
import { TableToolbar } from "./table-toolbar";
import { createCalloutBlockNode } from "./callout-block";
import {
  createEditorCommandGroups,
  flattenEditorCommandGroups,
  type EditorCommandItem,
} from "./editor-commands";
import {
  getTopLevelBlockContext,
  insertHorizontalRuleRelativeToBlock,
  insertNodeRelativeToBlock,
  insertParagraphRelativeToBlock,
  type BlockInsertDirection,
} from "./editor-block-ops";
import { createToggleBlockNode } from "./toggle-block";
import { SearchBar } from "./search-replace";
import { createEditorExtensions } from "./editor-extensions";
import { buildBlockActionItems } from "./editor-block-actions";
import { createWikiLinkTriggerExtension } from "./wiki-link-trigger";
import { WikiLinkSuggest } from "./wiki-link-suggest";
import {
  parseEditorContent,
  extractPlainTextFromContent,
  validateImageFile,
  uploadImageFile,
  insertImagesIntoView,
} from "./editor-utils";

/** Tracks the position of a block being dragged via the grip handle. */
let gripDragSource: { pos: number; typeName: string; attrs: Record<string, unknown>; nodeSize: number } | null = null;

const BLOCK_CONTROL_GUTTER_WIDTH = 96;
const BLOCK_CONTROL_GUTTER_RIGHT_PADDING = 12;
const BLOCK_CONTROL_BUTTON_SIZE = 24;
const BLOCK_CONTROL_LEFT_OFFSET = 60;
const BLOCK_SELECTOR =
  "p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, hr, img, table, [data-callout-block='true'], [data-toggle-block='true'], [data-excalidraw-block='true'], [data-image-row='true'], [data-mermaid-block='true'], [data-toc-block='true']";

interface TiptapEditorProps {
  content?: string;
  onChange?: (content: string, plainText: string) => void;
  onError?: (message: string) => void;
  onEditorReady?: (editor: TiptapEditorInstance) => void;
  onFocusTitle?: () => void;
  editable?: boolean;
  placeholder?: string;
}

interface HoveredBlock {
  pos: number;
  buttonTop: number;
  menuTop: number;
  menuLeft: number;
  top: number;
  bottom: number;
  contentLeft: number;
}

interface InsertMenuState {
  coords: { top: number; left: number };
  targetPos: number;
  direction: BlockInsertDirection;
}

interface BlockActionMenuState {
  coords: { top: number; left: number };
  targetPos: number;
}

export function TiptapEditor({
  content,
  onChange,
  onError,
  onEditorReady,
  onFocusTitle,
  editable = true,
  placeholder = "输入 / 以插入命令...",
}: TiptapEditorProps) {
  const [slashCoords, setSlashCoords] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [slashQuery, setSlashQuery] = useState("");
  const [hoveredBlock, setHoveredBlock] = useState<HoveredBlock | null>(null);
  const [insertMenuState, setInsertMenuState] = useState<InsertMenuState | null>(
    null
  );
  const [blockActionMenuState, setBlockActionMenuState] =
    useState<BlockActionMenuState | null>(null);
  const [, setIsDragging] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [linkTooltip, setLinkTooltip] = useState<{ href: string; top: number; left: number } | null>(null);
  const [wikiLinkCoords, setWikiLinkCoords] = useState<{ top: number; left: number } | null>(null);
  const [wikiLinkQuery, setWikiLinkQuery] = useState("");
  const [inlineAskAnchor, setInlineAskAnchor] =
    useState<InlineAskAiAnchor | null>(null);
  // Bump every time a new anchor is set, so the popover remounts and
  // resets its internal state cleanly (no setState-in-effect).
  const inlineAskOpenIdRef = useRef(0);
  const [inlineAskOpenId, setInlineAskOpenId] = useState(0);
  const linkTooltipTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<TiptapEditorInstance | null>(null);
  const editorSurfaceRef = useRef<HTMLDivElement>(null);
  const onFocusTitleRef = useRef(onFocusTitle);
  onFocusTitleRef.current = onFocusTitle;
  const hoveredBlockRef = useRef<HoveredBlock | null>(null);
  const pendingImageInsertPositionRef = useRef<number | null>(null);

  const handleSlashActivate = useCallback(
    (query: string, coords: { top: number; left: number }) => {
      setInsertMenuState(null);
      setBlockActionMenuState(null);
      setSlashQuery(query);
      setSlashCoords(coords);
    },
    []
  );

  const handleSlashDeactivate = useCallback(() => {
    setSlashCoords(null);
    setSlashQuery("");
  }, []);

  const handleSlashQueryChange = useCallback((query: string) => {
    setSlashQuery(query);
  }, []);

  const slashCommandExtension = useMemo(
    () =>
      createSlashCommandExtension(
        handleSlashActivate,
        handleSlashDeactivate,
        handleSlashQueryChange
      ),
    [handleSlashActivate, handleSlashDeactivate, handleSlashQueryChange]
  );

  // Wiki-link [[ trigger
  const handleWikiLinkActivate = useCallback(
    (query: string, coords: { top: number; left: number }) => {
      setWikiLinkQuery(query);
      setWikiLinkCoords(coords);
    },
    []
  );
  const handleWikiLinkDeactivate = useCallback(() => {
    setWikiLinkCoords(null);
    setWikiLinkQuery("");
  }, []);
  const handleWikiLinkQueryChange = useCallback((query: string) => {
    setWikiLinkQuery(query);
  }, []);

  const wikiLinkTriggerExtension = useMemo(
    () =>
      createWikiLinkTriggerExtension(
        handleWikiLinkActivate,
        handleWikiLinkDeactivate,
        handleWikiLinkQueryChange
      ),
    [handleWikiLinkActivate, handleWikiLinkDeactivate, handleWikiLinkQueryChange]
  );

  const handleWikiLinkSelect = useCallback(
    (noteId: string, noteTitle: string) => {
      const currentEditor = editorRef.current;
      if (!currentEditor) return;

      const { state } = currentEditor;
      const { from } = state.selection;
      // Delete the `[[query` text that was typed (go back to find `[[`)
      const docText = state.doc.textBetween(Math.max(0, from - 100), from);
      const bracketPos = docText.lastIndexOf("[[");
      if (bracketPos >= 0) {
        const deleteFrom = from - (docText.length - bracketPos);
        currentEditor
          .chain()
          .focus()
          .deleteRange({ from: deleteFrom, to: from })
          .insertContent({
            type: "text",
            text: noteTitle,
            marks: [
              {
                type: "wikiLink",
                attrs: { noteId, noteTitle },
              },
            ],
          })
          .run();
      }
      handleWikiLinkDeactivate();
    },
    [handleWikiLinkDeactivate]
  );

  const handleWikiLinkCreateNew = useCallback(
    (title: string) => {
      // For now, just insert the text as a wiki-link mark with empty noteId
      // The link will show as "unresolved" and can be created later
      const currentEditor = editorRef.current;
      if (!currentEditor) return;

      const { state } = currentEditor;
      const { from } = state.selection;
      const docText = state.doc.textBetween(Math.max(0, from - 100), from);
      const bracketPos = docText.lastIndexOf("[[");
      if (bracketPos >= 0) {
        const deleteFrom = from - (docText.length - bracketPos);
        currentEditor
          .chain()
          .focus()
          .deleteRange({ from: deleteFrom, to: from })
          .insertContent({
            type: "text",
            text: title,
            marks: [
              {
                type: "wikiLink",
                attrs: { noteId: "", noteTitle: title },
              },
            ],
          })
          .run();
      }
      handleWikiLinkDeactivate();
    },
    [handleWikiLinkDeactivate]
  );

  const reportError = useCallback(
    (message: string) => {
      onError?.(message);
    },
    [onError]
  );

  const insertImageFromUrl = useCallback(() => {
    const currentEditor = editorRef.current;
    const url = window.prompt("输入图片地址：")?.trim();
    const insertPosition = pendingImageInsertPositionRef.current ?? undefined;
    pendingImageInsertPositionRef.current = null;

    if (!url || !currentEditor) return;

    if (!/^https?:\/\//.test(url) && !url.startsWith("data:image/")) {
      reportError("请输入有效的图片地址。");
      return;
    }

    if (insertPosition !== undefined) {
      insertImagesIntoView(currentEditor.view, [url], insertPosition);
      return;
    }

    currentEditor.chain().focus().setImage({ src: url, alt: "插入图片" }).run();
  }, [reportError]);

  const handleFileSelection = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleOpenInsertMenu = useCallback(
    (direction: BlockInsertDirection) => {
      if (!hoveredBlock) return;

      setSlashCoords(null);
      setSlashQuery("");
      setBlockActionMenuState(null);
      setInsertMenuState({
        coords: {
          top: hoveredBlock.menuTop,
          left: hoveredBlock.menuLeft,
        },
        targetPos: hoveredBlock.pos,
        direction,
      });
    },
    [hoveredBlock]
  );

  const handleOpenBlockActionMenu = useCallback(() => {
    if (!hoveredBlock) return;

    setSlashCoords(null);
    setSlashQuery("");
    setInsertMenuState(null);
    setBlockActionMenuState({
      coords: {
        top: hoveredBlock.menuTop,
        left: hoveredBlock.menuLeft,
      },
      targetPos: hoveredBlock.pos,
    });
  }, [hoveredBlock]);

  /** Start a ProseMirror-native drag for the hovered block. */
  const handleGripDragStart = useCallback(
    (event: React.DragEvent<HTMLButtonElement>) => {
      const currentEditor = editorRef.current;
      if (!currentEditor || !hoveredBlock) return;

      const blockContext = getTopLevelBlockContext(
        currentEditor,
        hoveredBlock.pos
      );
      if (!blockContext) return;

      const { tr } = currentEditor.state;
      const nodeSelection = NodeSelection.create(tr.doc, blockContext.pos);
      currentEditor.view.dispatch(tr.setSelection(nodeSelection));

      currentEditor.view.dragging = {
        slice: nodeSelection.content(),
        move: true,
      };

      const dragImage = document.createElement("img");
      dragImage.src =
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
      document.body.appendChild(dragImage);
      event.dataTransfer.setDragImage(dragImage, 0, 0);
      requestAnimationFrame(() => dragImage.remove());

      event.dataTransfer.effectAllowed = "move";

      // Track drag source for image merge detection in handleDrop
      gripDragSource = {
        pos: blockContext.pos,
        typeName: blockContext.node.type.name,
        attrs: blockContext.node.attrs,
        nodeSize: blockContext.node.nodeSize,
      };

      setIsDragging(true);
      setInsertMenuState(null);
      setBlockActionMenuState(null);
      setSlashCoords(null);
    },
    [hoveredBlock]
  );

  const handleGripDragEnd = useCallback(() => {
    gripDragSource = null;
    setIsDragging(false);
  }, []);

  const updateHoveredBlock = useCallback(
    (target: EventTarget | null) => {
      const currentEditor = editorRef.current;
      const surface = editorSurfaceRef.current;

      if (!(target instanceof HTMLElement) || !currentEditor || !surface) {
        return;
      }

      if (target.closest("[data-editor-insert-controls='true']")) {
        return;
      }

      const block = target.closest(BLOCK_SELECTOR);

      if (!(block instanceof HTMLElement) || !currentEditor.view.dom.contains(block)) {
        setHoveredBlock(null);
        hoveredBlockRef.current = null;
        return;
      }

      try {
        const pos = currentEditor.view.posAtDOM(block, 0);
        const blockRect = block.getBoundingClientRect();
        const surfaceRect = surface.getBoundingClientRect();
        const nextState = {
          pos,
          buttonTop:
            blockRect.top -
            surfaceRect.top +
            blockRect.height / 2 -
            BLOCK_CONTROL_BUTTON_SIZE / 2,
          menuTop: blockRect.top + blockRect.height / 2 - 12,
          menuLeft: blockRect.left + 12,
          top: blockRect.top - surfaceRect.top,
          bottom: blockRect.bottom - surfaceRect.top,
          contentLeft: blockRect.left - surfaceRect.left,
        };

        setHoveredBlock((previous) => {
          if (
            previous?.pos === nextState.pos &&
            previous.buttonTop === nextState.buttonTop &&
            previous.top === nextState.top &&
            previous.bottom === nextState.bottom
          ) {
            hoveredBlockRef.current = previous;
            return previous;
          }

          hoveredBlockRef.current = nextState;
          return nextState;
        });
      } catch {
        setHoveredBlock(null);
        hoveredBlockRef.current = null;
      }
    },
    []
  );

  const handleSurfaceMouseMove = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const surface = editorSurfaceRef.current;
      const previous = hoveredBlockRef.current;
      const targetElement =
        event.target instanceof HTMLElement ? event.target : null;

      if (surface && previous && targetElement) {
        const surfaceRect = surface.getBoundingClientRect();
        const relativeX = event.clientX - surfaceRect.left;
        const relativeY = event.clientY - surfaceRect.top;
        const withinSameBand =
          relativeY >= previous.top - 6 && relativeY <= previous.bottom + 6;
        const withinGutter =
          relativeX >= -BLOCK_CONTROL_GUTTER_WIDTH &&
          relativeX <= previous.contentLeft + BLOCK_CONTROL_GUTTER_RIGHT_PADDING;
        const withinTrackedBlock = Boolean(targetElement.closest(BLOCK_SELECTOR));

        if (
          !withinTrackedBlock &&
          !targetElement.closest("[data-editor-insert-controls='true']") &&
          withinSameBand &&
          withinGutter
        ) {
          return;
        }
      }

      updateHoveredBlock(event.target);

      if (
        surface &&
        previous &&
        targetElement &&
        !targetElement.closest(BLOCK_SELECTOR) &&
        !targetElement.closest("[data-editor-insert-controls='true']")
      ) {
        const surfaceRect = surface.getBoundingClientRect();
        const relativeY = event.clientY - surfaceRect.top;
        const relativeX = event.clientX - surfaceRect.left;
        const withinSameBand =
          relativeY >= previous.top - 6 && relativeY <= previous.bottom + 6;
        const withinGutter =
          relativeX >= -BLOCK_CONTROL_GUTTER_WIDTH &&
          relativeX <= previous.contentLeft + BLOCK_CONTROL_GUTTER_RIGHT_PADDING;

        if (!withinSameBand || !withinGutter) {
          hoveredBlockRef.current = null;
          setHoveredBlock(null);
        }
      }
    },
    [updateHoveredBlock]
  );

  const handleSurfaceMouseLeave = useCallback(() => {
    setHoveredBlock(null);
    hoveredBlockRef.current = null;
  }, []);

  const extensions = useMemo(
    () => [
      ...createEditorExtensions({
        placeholder,
        slashCommandExtension,
        onSearchOpen: () => setSearchOpen(true),
      }),
      wikiLinkTriggerExtension,
    ],
    [placeholder, slashCommandExtension, wikiLinkTriggerExtension]
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: parseEditorContent(content),
    editable,
    onUpdate: ({ editor: currentEditor }) => {
      const json = JSON.stringify(currentEditor.getJSON());
      const text = extractPlainTextFromContent(currentEditor.getJSON());
      onChange?.(json, text);
    },
    editorProps: {
      attributes: {
        class:
          "notion-editor focus:outline-none min-h-[60vh] px-1 py-2 data-[placeholder]:text-stone-400",
      },
      handleClick(view, _pos, event) {
        // Cmd/Ctrl+Click to open links in a new tab
        if (!(event.metaKey || event.ctrlKey)) return false;
        const target = event.target as HTMLElement;
        const anchor = target.closest("a");
        if (!anchor) return false;
        const href = anchor.getAttribute("href");
        if (href) {
          window.open(href, "_blank", "noopener,noreferrer");
          return true;
        }
        return false;
      },
      handleKeyDown(view, event) {
        if (event.key !== "Backspace") return false;
        const { from, empty } = view.state.selection;
        // pos 0 = doc open tag, pos 1 = first child (paragraph) start
        if (empty && from <= 1 && onFocusTitleRef.current) {
          onFocusTitleRef.current();
          return true;
        }
        return false;
      },
      // Paste priority: heading+list flattening > image files > markdown structures (MarkdownTablePaste plugin).
      // Text-only paste (markdown tables, mermaid) falls through to the plugin.
      handlePaste(view, event) {
        // If the cursor is inside a heading and the clipboard is a list,
        // flatten the list items into a single space-joined inline string
        // so the heading absorbs them instead of being replaced by the list.
        if (view.state.selection.$from.parent.type.name === "heading") {
          const html = event.clipboardData?.getData("text/html");
          if (html) {
            const container = document.createElement("div");
            container.innerHTML = html;
            const slice = PMDOMParser.fromSchema(view.state.schema).parseSlice(container);
            const topNodes: PMNode[] = [];
            slice.content.forEach((n) => topNodes.push(n));
            const allLists =
              topNodes.length > 0 &&
              topNodes.every(
                (n) => n.type.name === "bulletList" || n.type.name === "orderedList"
              );
            if (allLists) {
              const parts: string[] = [];
              topNodes.forEach((list) => {
                list.forEach((li) => {
                  const text = li.textContent.trim();
                  if (text) parts.push(text);
                });
              });
              if (parts.length) {
                const joined = parts.join(" ");
                view.dispatch(view.state.tr.insertText(joined));
                return true;
              }
            }
          }
        }

        const files = Array.from(event.clipboardData?.files ?? []).filter(
          (file) => file.type.startsWith("image/")
        );

        if (!files.length) return false;

        void (async () => {
          const sources: string[] = [];

          for (const file of files) {
            const error = validateImageFile(file);
            if (error) {
              reportError(error);
              return;
            }

            sources.push(await uploadImageFile(file));
          }

          insertImagesIntoView(view, sources);
        })().catch((err: unknown) => {
          reportError(err instanceof Error ? err.message : "插入图片失败，请重试。");
        });

        return true;
      },
      handleDrop(view, event) {
        // Image merge: dragging an image/imageRow via grip handle onto another image/imageRow
        if (gripDragSource && (gripDragSource.typeName === "image" || gripDragSource.typeName === "imageRowBlock")) {
          const dropCoords = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (dropCoords) {
            const doc = view.state.doc;
            let targetPos = -1;
            let targetNodeSize = 0;
            let targetTypeName = "";
            let targetAttrs: Record<string, unknown> = {};
            doc.forEach((node, offset) => {
              if (targetPos >= 0) return;
              if (node.type.name === "image" || node.type.name === "imageRowBlock") {
                const nodeEnd = offset + node.nodeSize;
                if (dropCoords.pos >= offset && dropCoords.pos <= nodeEnd) {
                  targetPos = offset;
                  targetNodeSize = node.nodeSize;
                  targetTypeName = node.type.name;
                  targetAttrs = node.attrs;
                }
              }
            });

            if (targetPos >= 0 && targetTypeName && targetPos !== gripDragSource.pos) {
              const collectImgs = (name: string, attrs: Record<string, unknown>): { src: string }[] => {
                if (name === "image") {
                  const src = attrs.src as string;
                  return src ? [{ src }] : [];
                }
                if (name === "imageRowBlock") {
                  try {
                    const parsed = JSON.parse(attrs.images as string);
                    return Array.isArray(parsed) ? parsed : [];
                  } catch { return []; }
                }
                return [];
              };

              const targetImages = collectImgs(targetTypeName, targetAttrs);
              const draggedImages = collectImgs(gripDragSource.typeName, gripDragSource.attrs);

              if (targetImages.length && draggedImages.length) {
                const merged = [...targetImages, ...draggedImages];
                const rowType = view.state.schema.nodes.imageRowBlock;
                if (rowType) {
                  const newNode = rowType.create({ images: JSON.stringify(merged) });
                  const { tr } = view.state;
                  const srcPos = gripDragSource.pos;
                  const srcSize = gripDragSource.nodeSize;

                  // Replace target first, then delete source using mapping
                  tr.replaceWith(targetPos, targetPos + targetNodeSize, newNode);
                  const mappedSrcPos = tr.mapping.map(srcPos);
                  tr.delete(mappedSrcPos, mappedSrcPos + srcSize);

                  view.dispatch(tr);
                  gripDragSource = null;
                  event.preventDefault();
                  return true;
                }
              }
            }
          }
        }

        const files = Array.from(event.dataTransfer?.files ?? []).filter(
          (file) => file.type.startsWith("image/")
        );

        if (!files.length) return false;

        const coordinates = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });

        void (async () => {
          const sources: string[] = [];

          for (const file of files) {
            const error = validateImageFile(file);
            if (error) {
              reportError(error);
              return;
            }

            sources.push(await uploadImageFile(file));
          }

          insertImagesIntoView(view, sources, coordinates?.pos);
        })().catch((err: unknown) => {
          reportError(err instanceof Error ? err.message : "插入图片失败，请重试。");
        });

        event.preventDefault();
        return true;
      },
    },
  });
  editorRef.current = editor;

  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  // Listen for custom events dispatched by /ai slash command and the bubble
  // toolbar Ask AI button. They carry the anchor position + optional selection
  // text so the popover can render at the caret / selection.
  useEffect(() => {
    if (!editor) return;
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<InlineAskAiAnchor>).detail;
      if (detail) {
        inlineAskOpenIdRef.current += 1;
        setInlineAskOpenId(inlineAskOpenIdRef.current);
        setInlineAskAnchor(detail);
      }
    };
    window.addEventListener("open-inline-ask-ai", onOpen as EventListener);
    return () => {
      window.removeEventListener("open-inline-ask-ai", onOpen as EventListener);
    };
  }, [editor]);

  const commandGroups = useMemo(
    () =>
      createEditorCommandGroups({
        onRequestImageUpload: handleFileSelection,
        onRequestImageUrl: insertImageFromUrl,
      }),
    [handleFileSelection, insertImageFromUrl]
  );

  const slashItems = useMemo(
    () => flattenEditorCommandGroups(commandGroups),
    [commandGroups]
  );

  const handleInsertMenuSelection = useCallback(
    (item: EditorCommandItem) => {
      const currentEditor = editorRef.current;

      if (!currentEditor || !insertMenuState) return;

      if (item.id === "image-upload" || item.id === "image-url") {
        const block = getTopLevelBlockContext(
          currentEditor,
          insertMenuState.targetPos
        );

        if (!block) return;

        pendingImageInsertPositionRef.current =
          insertMenuState.direction === "above"
            ? block.pos
            : block.pos + block.node.nodeSize;
        item.run(currentEditor);
        return;
      }

      if (item.id === "horizontal-rule") {
        insertHorizontalRuleRelativeToBlock(
          currentEditor,
          insertMenuState.targetPos,
          insertMenuState.direction
        );
        return;
      }

      if (item.id === "callout-block") {
        const node = createCalloutBlockNode(currentEditor);
        if (!node) return;

        insertNodeRelativeToBlock(
          currentEditor,
          insertMenuState.targetPos,
          insertMenuState.direction,
          node,
          2
        );
        return;
      }

      if (item.id === "toggle-block") {
        const node = createToggleBlockNode(currentEditor);
        if (!node) return;

        insertNodeRelativeToBlock(
          currentEditor,
          insertMenuState.targetPos,
          insertMenuState.direction,
          node,
          2
        );
        return;
      }

      if (item.id === "excalidraw") {
        const excalidrawNodeType =
          currentEditor.state.schema.nodes.excalidrawBlock;
        if (!excalidrawNodeType) return;

        const node = excalidrawNodeType.create();
        insertNodeRelativeToBlock(
          currentEditor,
          insertMenuState.targetPos,
          insertMenuState.direction,
          node
        );
        return;
      }

      if (item.id === "toc") {
        const tocNodeType = currentEditor.state.schema.nodes.tocBlock;
        if (!tocNodeType) return;

        const node = tocNodeType.create();
        insertNodeRelativeToBlock(
          currentEditor,
          insertMenuState.targetPos,
          insertMenuState.direction,
          node
        );
        return;
      }

      const insertedPosition = insertParagraphRelativeToBlock(
        currentEditor,
        insertMenuState.targetPos,
        insertMenuState.direction
      );

      if (insertedPosition === null) return;

      item.run(currentEditor);
    },
    [insertMenuState]
  );

  const blockActionItems = useMemo(() => {
    const currentEditor = editorRef.current;
    if (!currentEditor || !blockActionMenuState) return [];
    return buildBlockActionItems(currentEditor, blockActionMenuState, commandGroups);
  }, [blockActionMenuState, commandGroups]);

  const handleImageInputChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      const currentEditor = editorRef.current;
      const insertPosition = pendingImageInsertPositionRef.current ?? undefined;
      pendingImageInsertPositionRef.current = null;

      if (!files.length || !currentEditor) {
        event.target.value = "";
        return;
      }

      try {
        const sources: string[] = [];

        for (const file of files) {
          const error = validateImageFile(file);
          if (error) {
            reportError(error);
            return;
          }

          sources.push(await uploadImageFile(file));
        }

        insertImagesIntoView(currentEditor.view, sources, insertPosition);
      } catch (err: unknown) {
        reportError(err instanceof Error ? err.message : "插入图片失败，请重试。");
      } finally {
        event.target.value = "";
      }
    },
    [reportError]
  );

  if (!editor) return null;

  return (
    <div className="relative">
      {editable && (
        searchOpen ? (
          <SearchBar
            key="search-open"
            editor={editor}
            isOpen={searchOpen}
            onClose={() => setSearchOpen(false)}
          />
        ) : null
      )}
      {editable && <BubbleToolbar editor={editor} />}
      {editable && <TableToolbar editor={editor} />}
      {editable && editor && (
        <InlineAskAiPopover
          key={
            inlineAskAnchor
              ? `inline-ask-${inlineAskOpenId}`
              : "inline-ask-closed"
          }
          editor={editor}
          anchor={inlineAskAnchor}
          noteText={editor.getText()}
          onClose={() => setInlineAskAnchor(null)}
        />
      )}

      <div
        ref={editorSurfaceRef}
        className="relative"
        onMouseMove={editable ? handleSurfaceMouseMove : undefined}
        onMouseLeave={editable ? handleSurfaceMouseLeave : undefined}
        onMouseOver={(e) => {
          const target = e.target as HTMLElement;
          const anchor = target.closest("a");
          if (anchor) {
            const href = anchor.getAttribute("href");
            if (href) {
              if (linkTooltipTimerRef.current) clearTimeout(linkTooltipTimerRef.current);
              const rect = anchor.getBoundingClientRect();
              const containerRect = editorSurfaceRef.current?.getBoundingClientRect();
              if (containerRect) {
                setLinkTooltip({
                  href,
                  top: rect.bottom - containerRect.top + 4,
                  left: rect.left - containerRect.left,
                });
              }
            }
          }
        }}
        onMouseOut={(e) => {
          const target = e.target as HTMLElement;
          const related = e.relatedTarget as HTMLElement | null;
          if (target.closest("a") && !related?.closest?.("[data-link-tooltip]")) {
            linkTooltipTimerRef.current = setTimeout(() => setLinkTooltip(null), 200);
          }
        }}
      >
        {editable && (
          <div
            aria-hidden="true"
            data-editor-hover-gutter="true"
            className="absolute inset-y-0 z-0"
            style={{
              left: -BLOCK_CONTROL_GUTTER_WIDTH,
              width: BLOCK_CONTROL_GUTTER_WIDTH,
            }}
          />
        )}

        {editable && hoveredBlock && (
          <div
            data-editor-insert-controls="true"
            className="absolute z-20"
            style={{
              top: hoveredBlock.buttonTop,
              left: -BLOCK_CONTROL_LEFT_OFFSET,
            }}
          >
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="插入块"
                title="在下方插入块（按住 Option 在上方插入）"
                data-testid="editor-insert-trigger"
                onClick={(event) => {
                  handleOpenInsertMenu(event.altKey ? "above" : "below");
                }}
                className="flex h-6 w-6 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100/80 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-900/80 dark:hover:text-stone-200"
              >
                <Plus size={18} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                draggable="true"
                aria-label="块菜单"
                title="拖拽移动块 / 点击打开菜单"
                data-testid="editor-block-menu-trigger"
                onClick={() => {
                  handleOpenBlockActionMenu();
                }}
                onDragStart={handleGripDragStart}
                onDragEnd={handleGripDragEnd}
                className="flex h-6 w-6 cursor-grab items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100/80 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-900/80 dark:hover:text-stone-200"
              >
                <GripVertical size={16} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        )}

        <div className="relative z-10 bg-transparent">
          <EditorContent editor={editor} />
        </div>
      </div>

      {linkTooltip && (
        <div
          data-link-tooltip
          className="absolute z-50 flex max-w-sm items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm shadow-lg dark:border-stone-700 dark:bg-stone-800"
          style={{ top: linkTooltip.top, left: linkTooltip.left }}
          onMouseEnter={() => {
            if (linkTooltipTimerRef.current) clearTimeout(linkTooltipTimerRef.current);
          }}
          onMouseLeave={() => setLinkTooltip(null)}
        >
          <span className="truncate text-stone-500 dark:text-stone-400">{linkTooltip.href}</span>
          <button
            type="button"
            onClick={() => {
              window.open(linkTooltip.href, "_blank", "noopener,noreferrer");
              setLinkTooltip(null);
            }}
            className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
          >
            打开
          </button>
        </div>
      )}

      {slashCoords && (
        <SlashCommandMenu
          key={`slash-${slashQuery}`}
          editor={editor}
          coords={slashCoords}
          query={slashQuery}
          items={slashItems}
          groups={commandGroups}
          testId="editor-slash-menu"
          onClose={handleSlashDeactivate}
        />
      )}

      {wikiLinkCoords && (
        <WikiLinkSuggest
          query={wikiLinkQuery}
          position={wikiLinkCoords}
          onSelect={handleWikiLinkSelect}
          onCreateNew={handleWikiLinkCreateNew}
          onClose={handleWikiLinkDeactivate}
        />
      )}

      {insertMenuState && (
        <SlashCommandMenu
          key={`insert-${insertMenuState.coords.top}-${insertMenuState.coords.left}-${insertMenuState.direction}`}
          editor={editor}
          coords={insertMenuState.coords}
          query=""
          items={slashItems}
          groups={commandGroups}
          testId="editor-insert-menu"
          onSelectItem={handleInsertMenuSelection}
          onClose={() => setInsertMenuState(null)}
        />
      )}

      {blockActionMenuState && blockActionItems.length > 0 && (
        <SlashCommandMenu
          key={`actions-${blockActionMenuState.coords.top}-${blockActionMenuState.coords.left}`}
          editor={editor}
          coords={blockActionMenuState.coords}
          query=""
          items={blockActionItems}
          deleteTrigger={false}
          testId="editor-block-action-menu"
          onClose={() => setBlockActionMenuState(null)}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        className="hidden"
        data-testid="editor-image-input"
        onChange={handleImageInputChange}
      />
    </div>
  );
}
