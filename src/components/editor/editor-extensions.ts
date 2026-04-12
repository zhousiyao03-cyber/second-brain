import type { Extension } from "@tiptap/react";
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
import { CalloutBlock } from "./callout-block";
import { ToggleBlock } from "./toggle-block";
import { ExcalidrawBlock } from "./excalidraw-block";
import { ImageRowBlock } from "./image-row-block";
import { MermaidBlock } from "./mermaid-block";
import { TocBlock } from "./toc-block";
import { MarkdownTablePaste } from "./markdown-table-paste";
import { SearchReplace } from "./search-replace";
import { WikiLink } from "./wiki-link";

interface CreateExtensionsOptions {
  placeholder: string;
  slashCommandExtension: Extension;
  onSearchOpen: () => void;
}

export function createEditorExtensions({
  placeholder,
  slashCommandExtension,
  onSearchOpen,
}: CreateExtensionsOptions): Extension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      codeBlock: false,
      link: {
        openOnClick: false,
        HTMLAttributes: {
          class: "cursor-pointer underline underline-offset-4 decoration-stone-300 hover:decoration-blue-400",
        },
      },
    }),
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === "heading") {
          return `Heading ${node.attrs.level}`;
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
    Table.configure({ resizable: true, renderWrapper: true }),
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
    MarkdownTablePaste,
    SearchReplace.configure({
      onOpen: onSearchOpen,
    }),
    WikiLink,
    slashCommandExtension,
  ] as Extension[];
}
