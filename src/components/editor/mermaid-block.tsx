"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  type NodeViewProps,
} from "@tiptap/react";
import { GitBranch } from "lucide-react";

let mermaidInitialized = false;

/**
 * Render a Mermaid diagram string into an SVG string.
 * Uses dynamic import so mermaid is only loaded client-side.
 */
async function renderMermaid(code: string): Promise<string> {
  const { default: mermaid } = await import("mermaid");
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: "default",
      securityLevel: "strict",
    });
    mermaidInitialized = true;
  }
  const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { svg } = await mermaid.render(id, code);
  return svg;
}

function MermaidNodeView({ node, updateAttributes, editor }: NodeViewProps) {
  const [editing, setEditing] = useState(false);
  const [svgHtml, setSvgHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isEditable = editor.isEditable;

  const code = (node.attrs.code as string) || "";

  // Render the mermaid diagram whenever code changes (debounced during editing)
  useEffect(() => {
    if (!code.trim()) {
      setSvgHtml(null);
      setError(null);
      return;
    }

    let cancelled = false;
    const delay = editing ? 500 : 0;

    const timer = setTimeout(() => {
      renderMermaid(code)
        .then((svg) => {
          if (!cancelled) {
            setSvgHtml(svg);
            setError(null);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setSvgHtml(null);
            setError(err instanceof Error ? err.message : "Mermaid 渲染失败");
          }
        });
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, editing]);

  const handleStartEditing = useCallback(() => {
    if (!isEditable) return;
    setEditing(true);
  }, [isEditable]);

  const handleStopEditing = useCallback(() => {
    setEditing(false);
  }, []);

  const handleCodeChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateAttributes({ code: e.target.value });
    },
    [updateAttributes]
  );

  // Auto-focus textarea when entering edit mode
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [editing]);

  return (
    <NodeViewWrapper
      className="mermaid-block-container"
      data-mermaid-block="true"
      data-editor-block="true"
    >
      {editing ? (
        <div contentEditable={false} className="mermaid-block-editor">
          <div className="mermaid-block-editor-header">
            <span className="mermaid-block-editor-label">
              <GitBranch size={14} />
              Mermaid
            </span>
            <button
              type="button"
              onClick={handleStopEditing}
              className="mermaid-block-done-btn"
            >
              完成
            </button>
          </div>
          <textarea
            ref={textareaRef}
            value={code}
            onChange={handleCodeChange}
            className="mermaid-block-textarea"
            placeholder={`graph TD\n    A[开始] --> B{判断}\n    B -->|是| C[执行]\n    B -->|否| D[结束]`}
            rows={8}
            spellCheck={false}
          />
          {/* Live preview below the editor */}
          {code.trim() && (
            <div className="mermaid-block-live-preview">
              {error ? (
                <div className="mermaid-block-error">{error}</div>
              ) : svgHtml ? (
                <div dangerouslySetInnerHTML={{ __html: svgHtml }} />
              ) : null}
            </div>
          )}
        </div>
      ) : (
        <div
          contentEditable={false}
          className="mermaid-block-placeholder"
          onClick={handleStartEditing}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleStartEditing();
          }}
        >
          {error ? (
            <div className="mermaid-block-error">{error}</div>
          ) : svgHtml ? (
            <div
              className="mermaid-block-rendered"
              dangerouslySetInnerHTML={{ __html: svgHtml }}
            />
          ) : (
            <>
              <GitBranch size={20} />
              <span>点击编辑 Mermaid 图表</span>
            </>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}

/**
 * Tiptap node extension for embedding Mermaid diagrams.
 * The mermaid source code is stored in the `code` attribute.
 */
export const MermaidBlock = Node.create({
  name: "mermaidBlock",

  group: "block",

  atom: true,

  addAttributes() {
    return {
      code: {
        default: "",
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-mermaid-block="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-mermaid-block": "true",
        "data-editor-block": "true",
        class: "mermaid-block-container",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidNodeView);
  },
});
