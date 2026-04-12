import type { Editor } from "@tiptap/react";
import type { LucideIcon } from "lucide-react";
import {
  CheckSquare,
  Code2,
  Columns2,
  GitBranch,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  ImagePlus,
  ImageUp,
  Lightbulb,
  List,
  ListTree,
  ListOrdered,
  Minus,
  PenTool,
  Quote,
  Sparkles,
  Table,
  TableOfContents,
  Type,
} from "lucide-react";
import {
  createCalloutBlockNode,
} from "./callout-block";
import {
  createToggleBlockNode,
} from "./toggle-block";
import { insertNodeAtSelection } from "./editor-block-ops";

export interface EditorCommandItem {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  icon: LucideIcon;
  /** Markdown input shortcut shown in menu (e.g. "#", "```") */
  shortcutHint?: string;
  /** Keyboard shortcut shown in menu (e.g. "⌘B", "⌘⇧8") */
  keyboardShortcut?: string;
  run: (editor: Editor) => void;
  isActive?: (editor: Editor) => boolean;
  tone?: "default" | "danger";
  transformable?: boolean;
}

export interface EditorCommandGroup {
  id: string;
  label: string;
  items: EditorCommandItem[];
}

interface EditorCommandCallbacks {
  onRequestImageUpload: () => void;
  onRequestImageUrl: () => void;
}

export function createEditorCommandGroups(
  callbacks: EditorCommandCallbacks
): EditorCommandGroup[] {
  return [
    {
      id: "ai",
      label: "AI",
      items: [
        {
          id: "ask-ai",
          title: "Ask AI",
          description: "Use AI to write or answer",
          keywords: ["ai", "ask", "gpt", "claude", "问 ai", "人工智能", "写作"],
          icon: Sparkles,
          shortcutHint: "/ai",
          run: (editor) => {
            const { from } = editor.state.selection;
            const coords = editor.view.coordsAtPos(from);
            window.dispatchEvent(
              new CustomEvent("open-inline-ask-ai", {
                detail: {
                  pos: from,
                  top: coords.bottom + 6,
                  left: coords.left,
                },
              })
            );
          },
          transformable: false,
        },
      ],
    },
    {
      id: "basic",
      label: "Basic",
      items: [
        {
          id: "paragraph",
          title: "Body text",
          description: "Plain paragraph text",
          keywords: ["text", "paragraph", "正文", "段落"],
          icon: Type,
          shortcutHint: "T",
          run: (editor) => {
            editor.chain().focus().setParagraph().run();
          },
          isActive: (editor) =>
            editor.isActive("paragraph") && !editor.isActive("heading"),
        },
        {
          id: "heading-1",
          title: "Heading 1",
          description: "Page title",
          keywords: ["h1", "heading", "标题", "大标题"],
          icon: Heading1,
          shortcutHint: "#",
          keyboardShortcut: "⌘⌥1",
          run: (editor) => {
            editor.chain().focus().toggleHeading({ level: 1 }).run();
          },
          isActive: (editor) => editor.isActive("heading", { level: 1 }),
        },
        {
          id: "heading-2",
          title: "Heading 2",
          description: "Section title",
          keywords: ["h2", "heading", "标题", "章节"],
          icon: Heading2,
          shortcutHint: "##",
          keyboardShortcut: "⌘⌥2",
          run: (editor) => {
            editor.chain().focus().toggleHeading({ level: 2 }).run();
          },
          isActive: (editor) => editor.isActive("heading", { level: 2 }),
        },
        {
          id: "heading-3",
          title: "Heading 3",
          description: "Subsection",
          keywords: ["h3", "heading", "标题", "小节"],
          icon: Heading3,
          shortcutHint: "###",
          keyboardShortcut: "⌘⌥3",
          run: (editor) => {
            editor.chain().focus().toggleHeading({ level: 3 }).run();
          },
          isActive: (editor) => editor.isActive("heading", { level: 3 }),
        },
        {
          id: "heading-4",
          title: "Heading 4",
          description: "Paragraph heading",
          keywords: ["h4", "heading", "标题"],
          icon: Heading4,
          shortcutHint: "####",
          keyboardShortcut: "⌘⌥4",
          run: (editor) => {
            editor.chain().focus().toggleHeading({ level: 4 }).run();
          },
          isActive: (editor) => editor.isActive("heading", { level: 4 }),
        },
        {
          id: "heading-5",
          title: "Heading 5",
          description: "Minor heading",
          keywords: ["h5", "heading", "标题"],
          icon: Heading5,
          shortcutHint: "#####",
          keyboardShortcut: "⌘⌥5",
          run: (editor) => {
            editor.chain().focus().toggleHeading({ level: 5 }).run();
          },
          isActive: (editor) => editor.isActive("heading", { level: 5 }),
        },
        {
          id: "heading-6",
          title: "Heading 6",
          description: "Smallest heading",
          keywords: ["h6", "heading", "标题"],
          icon: Heading6,
          shortcutHint: "######",
          keyboardShortcut: "⌘⌥6",
          run: (editor) => {
            editor.chain().focus().toggleHeading({ level: 6 }).run();
          },
          isActive: (editor) => editor.isActive("heading", { level: 6 }),
        },
      ],
    },
    {
      id: "lists",
      label: "Lists",
      items: [
        {
          id: "bullet-list",
          title: "Bullet list",
          description: "List items with bullets",
          keywords: ["list", "bullet", "列表", "无序"],
          icon: List,
          shortcutHint: "-",
          keyboardShortcut: "⌘⇧8",
          run: (editor) => {
            editor.chain().focus().toggleBulletList().run();
          },
          isActive: (editor) => editor.isActive("bulletList"),
        },
        {
          id: "ordered-list",
          title: "Ordered list",
          description: "List items with numbers",
          keywords: ["list", "ordered", "列表", "有序"],
          icon: ListOrdered,
          shortcutHint: "1.",
          keyboardShortcut: "⌘⇧7",
          run: (editor) => {
            editor.chain().focus().toggleOrderedList().run();
          },
          isActive: (editor) => editor.isActive("orderedList"),
        },
        {
          id: "task-list",
          title: "Task list",
          description: "Track tasks with checkboxes",
          keywords: ["todo", "task", "checkbox", "待办", "任务"],
          icon: CheckSquare,
          shortcutHint: "[]",
          run: (editor) => {
            editor.chain().focus().toggleTaskList().run();
          },
          isActive: (editor) => editor.isActive("taskList"),
        },
      ],
    },
    {
      id: "blocks",
      label: "Blocks",
      items: [
        {
          id: "blockquote",
          title: "Quote",
          description: "Blockquote",
          keywords: ["quote", "blockquote", "引用"],
          icon: Quote,
          shortcutHint: ">",
          keyboardShortcut: "⌘⇧B",
          run: (editor) => {
            editor.chain().focus().toggleBlockquote().run();
          },
          isActive: (editor) => editor.isActive("blockquote"),
        },
        {
          id: "callout-block",
          title: "Callout",
          description: "Highlighted callout block",
          keywords: ["callout", "tip", "提示", "强调"],
          icon: Lightbulb,
          run: (editor) => {
            const node = createCalloutBlockNode(editor);
            if (!node) return;
            insertNodeAtSelection(editor, node, 2);
          },
          transformable: false,
        },
        {
          id: "toggle-block",
          title: "Toggle list",
          description: "Expandable/collapsible content block",
          keywords: ["toggle", "collapse", "折叠", "展开"],
          icon: ListTree,
          run: (editor) => {
            const node = createToggleBlockNode(editor);
            if (!node) return;
            insertNodeAtSelection(editor, node, 2);
          },
          transformable: false,
        },
        {
          id: "code-block",
          title: "Code block",
          description: "Code block with syntax highlighting",
          keywords: ["code", "代码", "代码块"],
          icon: Code2,
          shortcutHint: "```",
          keyboardShortcut: "⌘⌥C",
          run: (editor) => {
            editor.chain().focus().toggleCodeBlock().run();
          },
          isActive: (editor) => editor.isActive("codeBlock"),
        },
        {
          id: "table",
          title: "Table",
          description: "Insert a table",
          keywords: ["table", "表格", "grid"],
          icon: Table,
          run: (editor) => {
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run();
          },
          transformable: false,
        },
        {
          id: "excalidraw",
          title: "Canvas",
          description: "Insert a canvas (flowcharts/mind maps/architecture diagrams)",
          keywords: ["draw", "excalidraw", "diagram", "画板", "画图", "流程图", "思维导图", "架构图"],
          icon: PenTool,
          run: (editor) => {
            editor.chain().focus().insertContent({ type: "excalidrawBlock" }).run();
          },
          transformable: false,
        },
        {
          id: "mermaid",
          title: "Mermaid diagram",
          description: "Insert a Mermaid diagram (flowcharts/sequence/Gantt)",
          keywords: ["mermaid", "diagram", "flowchart", "sequence", "gantt", "图表", "流程图", "序列图", "甘特图", "时序图"],
          icon: GitBranch,
          run: (editor) => {
            editor.chain().focus().insertContent({ type: "mermaidBlock" }).run();
          },
          transformable: false,
        },
        {
          id: "toc",
          title: "Table of contents",
          description: "Auto-generated table of contents",
          keywords: ["toc", "table of contents", "目录", "大纲", "outline"],
          icon: TableOfContents,
          run: (editor) => {
            editor.chain().focus().insertContent({ type: "tocBlock" }).run();
          },
          transformable: false,
        },
        {
          id: "horizontal-rule",
          title: "Divider",
          description: "Insert a horizontal divider",
          keywords: ["divider", "hr", "line", "分割线"],
          icon: Minus,
          shortcutHint: "---",
          run: (editor) => {
            editor.chain().focus().setHorizontalRule().run();
          },
        },
      ],
    },
    {
      id: "media",
      label: "Media",
      items: [
        {
          id: "image-upload",
          title: "Upload image",
          description: "Insert an image from a local file",
          keywords: ["image", "upload", "图片", "上传"],
          icon: ImagePlus,
          run: () => {
            callbacks.onRequestImageUpload();
          },
        },
        {
          id: "image-url",
          title: "Image URL",
          description: "Embed an image via URL",
          keywords: ["image", "url", "embed", "图片", "链接"],
          icon: ImageUp,
          run: () => {
            callbacks.onRequestImageUrl();
          },
        },
        {
          id: "image-row",
          title: "Image row",
          description: "Display multiple images side by side, resizable",
          keywords: ["image", "gallery", "row", "并排", "图片行", "多图", "横排", "gallery"],
          icon: Columns2,
          run: (editor) => {
            editor.chain().focus().insertContent({ type: "imageRowBlock" }).run();
          },
          transformable: false,
        },
      ],
    },
  ];
}

export function flattenEditorCommandGroups(
  groups: EditorCommandGroup[]
): EditorCommandItem[] {
  return groups.flatMap((group) => group.items);
}
