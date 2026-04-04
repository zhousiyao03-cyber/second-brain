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
  type JSONContent,
  type Editor as TiptapEditorInstance,
} from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import { NodeSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Typography from "@tiptap/extension-typography";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Color from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import { CodeBlockWithLang } from "./code-block-with-lang";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import {
  createSlashCommandExtension,
  SlashCommandMenu,
} from "./slash-command";
import { BubbleToolbar } from "./bubble-toolbar";
import { TableToolbar } from "./table-toolbar";
import { CalloutBlock, createCalloutBlockNode } from "./callout-block";
import {
  createEditorCommandGroups,
  flattenEditorCommandGroups,
  type EditorCommandItem,
} from "./editor-commands";
import {
  deleteTopLevelBlock,
  duplicateTopLevelBlock,
  focusTopLevelBlock,
  getTopLevelBlockContext,
  insertHorizontalRuleRelativeToBlock,
  insertNodeRelativeToBlock,
  insertParagraphRelativeToBlock,
  moveTopLevelBlock,
  type BlockInsertDirection,
} from "./editor-block-ops";
import { ToggleBlock, createToggleBlockNode } from "./toggle-block";
import { ExcalidrawBlock } from "./excalidraw-block";
import { ImageRowBlock } from "./image-row-block";
import { MermaidBlock } from "./mermaid-block";
import { TocBlock } from "./toc-block";
import { SearchReplace, SearchBar } from "./search-replace";
import { ImageMergeDrop } from "./image-merge-drop";
import { MarkdownTablePaste } from "./markdown-table-paste";

const MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
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

function parseEditorContent(content?: string): JSONContent | undefined {
  if (!content) return undefined;

  try {
    return JSON.parse(content) as JSONContent;
  } catch {
    return undefined;
  }
}

function extractPlainTextFromContent(content?: JSONContent) {
  if (!content) return "";

  const lines: string[] = [];

  const collectInlineText = (node: JSONContent): string => {
    if (node.type === "text") {
      return node.text ?? "";
    }

    if (node.type === "hardBreak") {
      return "\n";
    }

    return (node.content ?? []).map(collectInlineText).join("");
  };

  const visitBlock = (node: JSONContent) => {
    if (node.type === "toggleBlock") {
      const summary = String(node.attrs?.summary ?? "").trim();
      if (summary) lines.push(summary);
      for (const child of node.content ?? []) {
        visitBlock(child);
      }
      return;
    }

    if (
      node.type === "doc" ||
      node.type === "bulletList" ||
      node.type === "orderedList" ||
      node.type === "taskList" ||
      node.type === "listItem" ||
      node.type === "calloutBlock"
    ) {
      for (const child of node.content ?? []) {
        visitBlock(child);
      }
      return;
    }

    if (node.type === "mermaidBlock") {
      const code = String(node.attrs?.code ?? "").trim();
      if (code) lines.push(code);
      return;
    }

    if (node.type === "horizontalRule") {
      lines.push("---");
      return;
    }

    const text = collectInlineText(node).trim();
    if (text) {
      lines.push(text);
    }
  };

  visitBlock(content);

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function validateImageFile(file: File) {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    return "当前只支持 PNG、JPG、WEBP 和 GIF 图片。";
  }

  if (file.size > MAX_IMAGE_FILE_SIZE) {
    return "单张图片不能超过 5MB。";
  }

  return null;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("图片读取失败"));
    };

    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function insertImagesIntoView(
  view: EditorView,
  sources: string[],
  position?: number
) {
  const imageNodeType = view.state.schema.nodes.image;
  const paragraphNodeType = view.state.schema.nodes.paragraph;

  if (!imageNodeType) return;

  let transaction = view.state.tr;
  let insertPosition = position ?? transaction.selection.from;

  for (const source of sources) {
    const imageNode = imageNodeType.create({
      src: source,
      alt: "插入图片",
    });

    transaction = transaction.insert(insertPosition, imageNode);
    insertPosition += imageNode.nodeSize;

    if (paragraphNodeType) {
      const paragraphNode = paragraphNodeType.create();
      transaction = transaction.insert(insertPosition, paragraphNode);
      insertPosition += paragraphNode.nodeSize;
    }
  }

  view.dispatch(transaction.scrollIntoView());
  view.focus();
}

export function TiptapEditor({
  content,
  onChange,
  onError,
  onEditorReady,
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
  const [isDragging, setIsDragging] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<TiptapEditorInstance | null>(null);
  const editorSurfaceRef = useRef<HTMLDivElement>(null);
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

      setIsDragging(true);
      setInsertMenuState(null);
      setBlockActionMenuState(null);
      setSlashCoords(null);
    },
    [hoveredBlock]
  );

  const handleGripDragEnd = useCallback(() => {
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

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        codeBlock: false,
        link: {
          openOnClick: false,
          HTMLAttributes: {
            class: "cursor-pointer underline underline-offset-4 decoration-stone-300",
          },
        },
      }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === "heading") {
            return `标题 ${node.attrs.level}`;
          }

          return placeholder;
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: false }),
      Image.configure({
        allowBase64: true,
        HTMLAttributes: {
          class: "notion-editor-image",
        },
        resize: {
          enabled: true,
          minWidth: 180,
          minHeight: 120,
          alwaysPreserveAspectRatio: true,
        },
      }),
      CodeBlockWithLang,
      Typography,
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TextStyle,
      Color,
      CalloutBlock,
      ToggleBlock,
      ExcalidrawBlock,
      ImageRowBlock,
      MermaidBlock,
      TocBlock,
      ImageMergeDrop,
      MarkdownTablePaste,
      SearchReplace.configure({
        onOpen: () => setSearchOpen(true),
      }),
      slashCommandExtension,
    ],
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
      handlePaste(view, event) {
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

            sources.push(await readFileAsDataUrl(file));
          }

          insertImagesIntoView(view, sources);
        })().catch(() => {
          reportError("插入图片失败，请重试。");
        });

        return true;
      },
      handleDrop(view, event) {
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

            sources.push(await readFileAsDataUrl(file));
          }

          insertImagesIntoView(view, sources, coordinates?.pos);
        })().catch(() => {
          reportError("插入图片失败，请重试。");
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
    const state = blockActionMenuState;

    if (!currentEditor || !state) return [] as EditorCommandItem[];

    const block = getTopLevelBlockContext(currentEditor, state.targetPos);
    if (!block) return [] as EditorCommandItem[];

    const items: EditorCommandItem[] = [];

    if (block.index > 0) {
      items.push({
        id: "move-up",
        title: "上移",
        description: "将当前块向上移动一行",
        keywords: ["move", "up", "上移"],
        icon: ArrowUp,
        run: (editor) => {
          moveTopLevelBlock(editor, state.targetPos, "up");
        },
      });
    }

    if (block.index < currentEditor.state.doc.childCount - 1) {
      items.push({
        id: "move-down",
        title: "下移",
        description: "将当前块向下移动一行",
        keywords: ["move", "down", "下移"],
        icon: ArrowDown,
        run: (editor) => {
          moveTopLevelBlock(editor, state.targetPos, "down");
        },
      });
    }

    items.push(
      {
        id: "duplicate-block",
        title: "复制块",
        description: "复制当前块内容",
        keywords: ["duplicate", "copy", "复制"],
        icon: Copy,
        run: (editor) => {
          duplicateTopLevelBlock(editor, state.targetPos);
        },
      },
      {
        id: "delete-block",
        title: "删除块",
        description: "删除当前块",
        keywords: ["delete", "remove", "删除"],
        icon: Trash2,
        run: (editor) => {
          deleteTopLevelBlock(editor, state.targetPos);
        },
        tone: "danger",
      }
    );

    const transformable = ![
      "image",
      "horizontalRule",
      "calloutBlock",
      "toggleBlock",
      "excalidrawBlock",
      "imageRowBlock",
      "mermaidBlock",
      "tocBlock",
    ].includes(block.node.type.name);

    if (transformable) {
      const transformItems = flattenEditorCommandGroups(
        commandGroups.filter((group) => group.id !== "media")
      )
        .filter(
          (item) => item.id !== "horizontal-rule" && item.transformable !== false
        )
        .map((item) => ({
          ...item,
          id: `transform-${item.id}`,
          title: `转为${item.title}`,
          description: `将当前块转换为${item.title}`,
          run: (editor: TiptapEditorInstance) => {
            focusTopLevelBlock(editor, state.targetPos);
            item.run(editor);
          },
        }));

      items.push(...transformItems);
    }

    return items;
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

          sources.push(await readFileAsDataUrl(file));
        }

        insertImagesIntoView(currentEditor.view, sources, insertPosition);
      } catch {
        reportError("插入图片失败，请重试。");
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
        <SearchBar
          editor={editor}
          isOpen={searchOpen}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {editable && <BubbleToolbar editor={editor} />}
      {editable && <TableToolbar editor={editor} />}

      <div
        ref={editorSurfaceRef}
        className="relative"
        onMouseMove={editable ? handleSurfaceMouseMove : undefined}
        onMouseLeave={editable ? handleSurfaceMouseLeave : undefined}
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
