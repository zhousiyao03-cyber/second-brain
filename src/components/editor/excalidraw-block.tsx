"use client";

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  type NodeViewProps,
} from "@tiptap/react";
import { PenTool } from "lucide-react";
import type { ExcalidrawProps } from "@excalidraw/excalidraw";

/**
 * Dynamically import Excalidraw to avoid SSR issues.
 * Excalidraw relies on browser APIs and cannot render on the server.
 */
const ExcalidrawEditor = dynamic<ExcalidrawProps>(
  () =>
    import("@excalidraw/excalidraw").then((mod) => ({
      default: mod.Excalidraw,
    })),
  { ssr: false, loading: () => <div style={{ height: 480 }} /> }
);

/**
 * Convert Excalidraw elements and appState to an SVG data URL for preview.
 * Returns null if export fails or if there are no elements.
 */
async function exportToSvgDataUrl(
  elements: readonly Record<string, unknown>[],
  appState: Record<string, unknown>
): Promise<string | null> {
  if (!elements.length) return null;

  try {
    const { exportToSvg } = await import("@excalidraw/excalidraw");
    if (typeof exportToSvg !== "function") return null;

    const svg = await exportToSvg({
      elements,
      appState: {
        ...appState,
        exportBackground: true,
        viewBackgroundColor: "#ffffff",
      },
      files: null,
    });
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgString)))}`;
  } catch {
    return null;
  }
}

/** Parse the stored JSON data string into elements and appState. */
function parseStoredData(dataStr: string): {
  elements: Record<string, unknown>[];
  appState: Record<string, unknown>;
} {
  try {
    const parsed = JSON.parse(dataStr);
    if (Array.isArray(parsed)) {
      return { elements: parsed, appState: {} };
    }
    if (parsed && typeof parsed === "object") {
      return {
        elements: (parsed.elements as Record<string, unknown>[]) ?? [],
        appState: (parsed.appState as Record<string, unknown>) ?? {},
      };
    }
  } catch {
    // Invalid JSON
  }
  return { elements: [], appState: {} };
}

/**
 * The React component rendered inside the Tiptap node view.
 * Toggles between a placeholder/preview (inactive) and a full Excalidraw editor (active).
 */
function ExcalidrawNodeView({ node, updateAttributes, editor }: NodeViewProps) {
  const [editing, setEditing] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const isEditable = editor.isEditable;

  const storedData = node.attrs.data as string;
  const { elements: parsedElements, appState: parsedAppState } =
    parseStoredData(storedData);
  const hasContent = parsedElements.length > 0;

  // Generate preview SVG when not editing and there are elements
  useEffect(() => {
    if (!editing && hasContent) {
      void exportToSvgDataUrl(parsedElements, parsedAppState).then(
        setPreviewSrc
      );
    }
  }, [editing, storedData]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStartEditing = useCallback(() => {
    if (!isEditable) return;
    setEditing(true);
  }, [isEditable]);

  const handleStopEditing = useCallback(() => {
    setEditing(false);
  }, []);

  const handleChange = useCallback(
    (
      elements: readonly Record<string, unknown>[],
      appState: Record<string, unknown>
    ) => {
      // Filter out deleted elements before persisting
      const activeElements = elements.filter(
        (el) => !(el as { isDeleted?: boolean }).isDeleted
      );
      const dataToStore = JSON.stringify({
        elements: activeElements,
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor,
          zoom: appState.zoom,
          scrollX: appState.scrollX,
          scrollY: appState.scrollY,
        },
      });
      updateAttributes({ data: dataToStore });
    },
    [updateAttributes]
  );

  return (
    <NodeViewWrapper
      className="excalidraw-block-container"
      data-excalidraw-block="true"
      data-editor-block="true"
    >
      {editing ? (
        <div contentEditable={false} style={{ position: "relative" }}>
          {/* Close / Done button overlaid on the Excalidraw canvas */}
          <button
            type="button"
            onClick={handleStopEditing}
            className="absolute right-2 top-2 z-10 rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-stone-600 shadow-sm transition-colors hover:bg-white hover:text-stone-900 dark:bg-stone-800/90 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          >
            Done
          </button>
          <div style={{ height: 480, width: "100%" }}>
            <ExcalidrawEditor
              initialData={{
                elements: parsedElements,
                appState: parsedAppState,
              }}
              onChange={handleChange}
            />
          </div>
        </div>
      ) : (
        <div
          contentEditable={false}
          className="excalidraw-block-placeholder"
          onClick={handleStartEditing}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleStartEditing();
          }}
          style={hasContent && previewSrc ? { height: "auto" } : undefined}
        >
          {hasContent && previewSrc ? (
            <img
              src={previewSrc}
              alt="Excalidraw drawing preview"
              className="excalidraw-block-preview"
            />
          ) : (
            <>
              <PenTool size={20} />
              <span>Click to draw</span>
            </>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}

/**
 * Tiptap node extension for embedding Excalidraw drawings inline.
 * The drawing data (elements + appState) is stored as a JSON string
 * in the `data` attribute so it persists with the document.
 */
export const ExcalidrawBlock = Node.create({
  name: "excalidrawBlock",

  group: "block",

  atom: true,

  addAttributes() {
    return {
      data: {
        default: "[]",
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-excalidraw-block="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-excalidraw-block": "true",
        "data-editor-block": "true",
        class: "excalidraw-block-container",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ExcalidrawNodeView);
  },
});
