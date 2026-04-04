"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  type NodeViewProps,
} from "@tiptap/react";
import { GitBranch, Pencil, X, Maximize2 } from "lucide-react";

let mermaidInitialized = false;

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
  const [fullscreen, setFullscreen] = useState(false);
  const [svgHtml, setSvgHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isEditable = editor.isEditable;

  const code = (node.attrs.code as string) || "";

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
    setFullscreen(false);
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

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [editing]);

  // Close fullscreen on Escape
  useEffect(() => {
    if (!fullscreen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [fullscreen]);

  return (
    <NodeViewWrapper
      className="mermaid-block-container"
      data-mermaid-block="true"
      data-editor-block="true"
    >
      {editing ? (
        /* ── Edit Mode ── */
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
        /* ── View Mode ── */
        <div contentEditable={false} className="mermaid-block-view">
          {error ? (
            <div className="mermaid-block-error">{error}</div>
          ) : svgHtml ? (
            <>
              <div
                className="mermaid-block-rendered"
                onClick={() => setFullscreen(true)}
                dangerouslySetInnerHTML={{ __html: svgHtml }}
              />
              {/* Toolbar: top-right corner on hover */}
              <div className="mermaid-block-toolbar">
                <button
                  type="button"
                  onClick={() => setFullscreen(true)}
                  title="放大查看"
                >
                  <Maximize2 size={14} />
                </button>
                {isEditable && (
                  <button
                    type="button"
                    onClick={handleStartEditing}
                    title="编辑代码"
                  >
                    <Pencil size={14} />
                  </button>
                )}
              </div>
            </>
          ) : (
            <div
              className="mermaid-block-empty"
              onClick={handleStartEditing}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") handleStartEditing();
              }}
            >
              <GitBranch size={20} />
              <span>点击编辑 Mermaid 图表</span>
            </div>
          )}
        </div>
      )}

      {/* ── Fullscreen Overlay ── */}
      {fullscreen && svgHtml && (
        <div
          className="mermaid-fullscreen-overlay"
          onClick={() => setFullscreen(false)}
        >
          <div
            className="mermaid-fullscreen-content"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="mermaid-fullscreen-close"
              onClick={() => setFullscreen(false)}
            >
              <X size={20} />
            </button>
            <div
              className="mermaid-fullscreen-svg"
              dangerouslySetInnerHTML={{ __html: svgHtml }}
            />
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}

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
