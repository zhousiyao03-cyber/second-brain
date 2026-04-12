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
            setError(err instanceof Error ? err.message : "Mermaid render failed");
          }
        });
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, editing]);

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

  // Fullscreen zoom & pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanningState, setIsPanningState] = useState(false);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panOffset = useRef({ x: 0, y: 0 });

  const handleStartEditing = useCallback(() => {
    if (!isEditable) return;
    setEditing(true);
    setFullscreen(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsPanningState(false);
  }, [isEditable]);

  const openFullscreen = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsPanningState(false);
    isPanning.current = false;
    setFullscreen(true);
  }, []);

  const closeFullscreen = useCallback(() => {
    setFullscreen(false);
    setIsPanningState(false);
    isPanning.current = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((prev) => {
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      return Math.min(5, Math.max(0.2, prev + delta));
    });
  }, []);

  const handlePanStart = useCallback((e: React.MouseEvent) => {
    // Only pan on middle-click or when holding space, or just drag
    isPanning.current = true;
    setIsPanningState(true);
    panStart.current = { x: e.clientX, y: e.clientY };
    panOffset.current = { ...pan };
  }, [pan]);

  const handlePanMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    setPan({
      x: panOffset.current.x + (e.clientX - panStart.current.x),
      y: panOffset.current.y + (e.clientY - panStart.current.y),
    });
  }, []);

  const handlePanEnd = useCallback(() => {
    isPanning.current = false;
    setIsPanningState(false);
  }, []);

  // Close fullscreen on Escape
  useEffect(() => {
    if (!fullscreen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeFullscreen();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [closeFullscreen, fullscreen]);

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
              Done
            </button>
          </div>
          <textarea
            ref={textareaRef}
            value={code}
            onChange={handleCodeChange}
            className="mermaid-block-textarea"
            placeholder={`graph TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Execute]\n    B -->|No| D[End]`}
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
          {!code.trim() ? (
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
              <span>Click to edit Mermaid diagram</span>
            </div>
          ) : error ? (
            <div className="mermaid-block-error">{error}</div>
          ) : svgHtml ? (
            <>
              <div
                className="mermaid-block-rendered"
                onClick={openFullscreen}
                dangerouslySetInnerHTML={{ __html: svgHtml }}
              />
              {/* Toolbar: top-right corner on hover */}
              <div className="mermaid-block-toolbar">
                <button
                  type="button"
                  onClick={openFullscreen}
                  title="Zoom in"
                >
                  <Maximize2 size={14} />
                </button>
                {isEditable && (
                  <button
                    type="button"
                    onClick={handleStartEditing}
                    title="Edit code"
                  >
                    <Pencil size={14} />
                  </button>
                )}
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ── Fullscreen Overlay ── */}
      {fullscreen && svgHtml && (
        <div
          className="mermaid-fullscreen-overlay"
          onClick={closeFullscreen}
        >
          <div
            className="mermaid-fullscreen-content"
            onClick={(e) => e.stopPropagation()}
            onWheel={handleWheel}
            onMouseDown={handlePanStart}
            onMouseMove={handlePanMove}
            onMouseUp={handlePanEnd}
            onMouseLeave={handlePanEnd}
            style={{ cursor: isPanningState ? "grabbing" : "grab" }}
          >
            <button
              type="button"
              className="mermaid-fullscreen-close"
              onClick={closeFullscreen}
            >
              <X size={20} />
            </button>
            <div className="mermaid-fullscreen-zoom-badge">
              {Math.round(zoom * 100)}%
            </div>
            <div
              className="mermaid-fullscreen-svg"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "center center",
              }}
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
