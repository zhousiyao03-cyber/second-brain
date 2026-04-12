"use client";

import type { Editor } from "@tiptap/react";
import {
  Node,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  type NodeViewProps,
} from "@tiptap/react";
import { ChevronRight, ListTree } from "lucide-react";
import { cn } from "@/lib/utils";

function ToggleBlockView({ node, updateAttributes }: NodeViewProps) {
  const summary = node.attrs.summary ?? "Toggle list";
  const isOpen = node.attrs.open !== false;

  return (
    <NodeViewWrapper
      className="notion-toggle"
      data-toggle-block="true"
      data-editor-block="true"
      data-open={String(isOpen)}
    >
      <div className="notion-toggle-header" contentEditable={false}>
        <button
          type="button"
          className={cn("notion-toggle-chevron", isOpen && "is-open")}
          title={isOpen ? "Collapse" : "Expand"}
          onClick={() => updateAttributes({ open: !isOpen })}
        >
          <ChevronRight size={16} />
        </button>
        <ListTree size={16} className="text-stone-400 dark:text-stone-500" />
        <input
          value={summary}
          onChange={(event) => {
            updateAttributes({ summary: event.target.value });
          }}
          className="notion-toggle-summary"
          placeholder="Toggle list"
        />
      </div>
      <div className={cn("notion-toggle-body", !isOpen && "hidden")}>
        <NodeViewContent className="notion-toggle-content" />
      </div>
    </NodeViewWrapper>
  );
}

export const ToggleBlock = Node.create({
  name: "toggleBlock",

  group: "block",

  content: "block+",

  defining: true,

  isolating: true,

  addAttributes() {
    return {
      summary: {
        default: "Toggle list",
      },
      open: {
        default: true,
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-toggle-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-toggle-block": "true",
        "data-editor-block": "true",
        class: "notion-toggle",
        "data-open": String(HTMLAttributes.open !== false),
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleBlockView);
  },
});

export function createToggleBlockNode(editor: Editor) {
  const toggleNodeType = editor.state.schema.nodes.toggleBlock;
  const paragraphNodeType = editor.state.schema.nodes.paragraph;

  if (!toggleNodeType || !paragraphNodeType) return null;

  return toggleNodeType.create(
    {
      summary: "Toggle list",
      open: true,
    },
    [paragraphNodeType.create()]
  );
}
