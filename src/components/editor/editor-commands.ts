import type { Editor } from "@tiptap/react";
import type { LucideIcon } from "lucide-react";
import {
  CheckSquare,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  ImageUp,
  Lightbulb,
  List,
  ListTree,
  ListOrdered,
  Minus,
  PenTool,
  Quote,
  Table,
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
  shortcutHint?: string;
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
      id: "basic",
      label: "基础块",
      items: [
        {
          id: "paragraph",
          title: "正文",
          description: "普通段落文本",
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
          title: "标题 1",
          description: "页面大标题",
          keywords: ["h1", "heading", "标题", "大标题"],
          icon: Heading1,
          shortcutHint: "#",
          run: (editor) => {
            editor.chain().focus().toggleHeading({ level: 1 }).run();
          },
          isActive: (editor) => editor.isActive("heading", { level: 1 }),
        },
        {
          id: "heading-2",
          title: "标题 2",
          description: "章节标题",
          keywords: ["h2", "heading", "标题", "章节"],
          icon: Heading2,
          shortcutHint: "##",
          run: (editor) => {
            editor.chain().focus().toggleHeading({ level: 2 }).run();
          },
          isActive: (editor) => editor.isActive("heading", { level: 2 }),
        },
        {
          id: "heading-3",
          title: "标题 3",
          description: "小节标题",
          keywords: ["h3", "heading", "标题", "小节"],
          icon: Heading3,
          shortcutHint: "###",
          run: (editor) => {
            editor.chain().focus().toggleHeading({ level: 3 }).run();
          },
          isActive: (editor) => editor.isActive("heading", { level: 3 }),
        },
      ],
    },
    {
      id: "lists",
      label: "列表",
      items: [
        {
          id: "bullet-list",
          title: "无序列表",
          description: "用圆点列出项目",
          keywords: ["list", "bullet", "列表", "无序"],
          icon: List,
          shortcutHint: "-",
          run: (editor) => {
            editor.chain().focus().toggleBulletList().run();
          },
          isActive: (editor) => editor.isActive("bulletList"),
        },
        {
          id: "ordered-list",
          title: "有序列表",
          description: "用数字列出项目",
          keywords: ["list", "ordered", "列表", "有序"],
          icon: ListOrdered,
          shortcutHint: "1.",
          run: (editor) => {
            editor.chain().focus().toggleOrderedList().run();
          },
          isActive: (editor) => editor.isActive("orderedList"),
        },
        {
          id: "task-list",
          title: "待办列表",
          description: "用复选框追踪任务",
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
      label: "块",
      items: [
        {
          id: "blockquote",
          title: "引用",
          description: "引用块",
          keywords: ["quote", "blockquote", "引用"],
          icon: Quote,
          shortcutHint: "\"",
          run: (editor) => {
            editor.chain().focus().toggleBlockquote().run();
          },
          isActive: (editor) => editor.isActive("blockquote"),
        },
        {
          id: "callout-block",
          title: "Callout",
          description: "带强调语气的提示块",
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
          title: "折叠列表",
          description: "可展开/折叠的内容块",
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
          title: "代码块",
          description: "带语法高亮的代码块",
          keywords: ["code", "代码", "代码块"],
          icon: Code2,
          shortcutHint: "</>",
          run: (editor) => {
            editor.chain().focus().toggleCodeBlock().run();
          },
          isActive: (editor) => editor.isActive("codeBlock"),
        },
        {
          id: "table",
          title: "表格",
          description: "插入表格",
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
          title: "画板",
          description: "插入画板（流程图/思维导图/架构图）",
          keywords: ["draw", "excalidraw", "diagram", "画板", "画图", "流程图", "思维导图", "架构图"],
          icon: PenTool,
          run: (editor) => {
            editor.chain().focus().insertContent({ type: "excalidrawBlock" }).run();
          },
          transformable: false,
        },
        {
          id: "horizontal-rule",
          title: "分割线",
          description: "插入水平分割线",
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
      label: "媒体",
      items: [
        {
          id: "image-upload",
          title: "上传图片",
          description: "从本地文件插入图片",
          keywords: ["image", "upload", "图片", "上传"],
          icon: ImagePlus,
          run: () => {
            callbacks.onRequestImageUpload();
          },
        },
        {
          id: "image-url",
          title: "图片链接",
          description: "通过 URL 嵌入图片",
          keywords: ["image", "url", "embed", "图片", "链接"],
          icon: ImageUp,
          run: () => {
            callbacks.onRequestImageUrl();
          },
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
