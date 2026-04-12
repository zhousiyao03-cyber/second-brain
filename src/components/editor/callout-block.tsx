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
import {
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
  Pin,
  type LucideIcon,
} from "lucide-react";

const CALLOUT_TONES = [
  {
    id: "tip",
    icon: Lightbulb,
    label: "Tip",
  },
  {
    id: "pinned",
    icon: Pin,
    label: "Important",
  },
  {
    id: "warning",
    icon: AlertTriangle,
    label: "Warning",
  },
  {
    id: "success",
    icon: CheckCircle2,
    label: "Done",
  },
] as const;

type CalloutTone = (typeof CALLOUT_TONES)[number]["id"];

function getToneMeta(tone: string | null | undefined) {
  return CALLOUT_TONES.find((item) => item.id === tone) ?? CALLOUT_TONES[0];
}

function CalloutBlockView({ node, updateAttributes }: NodeViewProps) {
  const currentTone = getToneMeta(node.attrs.tone);
  const currentIndex = CALLOUT_TONES.findIndex(
    (item) => item.id === currentTone.id
  );
  const nextTone =
    CALLOUT_TONES[(currentIndex + 1) % CALLOUT_TONES.length] ?? CALLOUT_TONES[0];
  const ToneIcon: LucideIcon = currentTone.icon;

  return (
    <NodeViewWrapper
      className="notion-callout"
      data-callout-block="true"
      data-editor-block="true"
      data-tone={currentTone.id}
    >
      <button
        type="button"
        contentEditable={false}
        className="notion-callout-trigger"
        title={`Switch to ${nextTone.label}`}
        onClick={() => updateAttributes({ tone: nextTone.id })}
      >
        <ToneIcon size={16} />
      </button>
      <div className="notion-callout-body">
        <NodeViewContent className="notion-callout-content" />
      </div>
    </NodeViewWrapper>
  );
}

export const CalloutBlock = Node.create({
  name: "calloutBlock",

  group: "block",

  content: "block+",

  defining: true,

  isolating: true,

  addAttributes() {
    return {
      tone: {
        default: "tip" satisfies CalloutTone,
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-callout-block": "true",
        "data-editor-block": "true",
        class: "notion-callout",
        "data-tone": HTMLAttributes.tone,
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutBlockView);
  },
});

export function createCalloutBlockNode(editor: Editor, tone: CalloutTone = "tip") {
  const calloutNodeType = editor.state.schema.nodes.calloutBlock;
  const paragraphNodeType = editor.state.schema.nodes.paragraph;

  if (!calloutNodeType || !paragraphNodeType) return null;

  return calloutNodeType.create(
    { tone },
    [paragraphNodeType.create()]
  );
}
