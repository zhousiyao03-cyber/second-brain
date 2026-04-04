"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";
import {
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  type NodeViewProps,
} from "@tiptap/react";
import { ImagePlus, GripVertical } from "lucide-react";

const MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

interface GalleryImage {
  src: string;
  width?: number;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function ImageRowNodeView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const isEditable = editor.isEditable;
  const images: GalleryImage[] = (() => {
    try {
      const parsed = JSON.parse(node.attrs.images as string);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragSourceIndex, setDragSourceIndex] = useState<number | null>(null);
  const [resizePreview, setResizePreview] = useState<{ index: number; width: number } | null>(null);

  const updateImages = useCallback(
    (newImages: GalleryImage[]) => {
      updateAttributes({ images: JSON.stringify(newImages) });
    },
    [updateAttributes]
  );

  const addImages = useCallback(
    async (files: File[]) => {
      const newSrcs: string[] = [];
      for (const file of files) {
        if (!ACCEPTED_IMAGE_TYPES.has(file.type)) continue;
        if (file.size > MAX_IMAGE_FILE_SIZE) continue;
        newSrcs.push(await readFileAsDataUrl(file));
      }
      if (newSrcs.length) {
        updateImages([...images, ...newSrcs.map((src) => ({ src }))]);
      }
    },
    [images, updateImages]
  );

  const handleAddClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      void addImages(files);
      e.target.value = "";
    },
    [addImages]
  );

  /** Extract an image from the row into a standalone image block below. */
  const extractImage = useCallback(
    (index: number) => {
      const pos = getPos();
      if (pos === undefined) return;

      const img = images[index];
      if (!img) return;

      const remaining = images.filter((_, i) => i !== index);
      const { tr } = editor.state;
      const endOfRow = pos + node.nodeSize;

      const imageType = editor.state.schema.nodes.image;
      if (!imageType) return;
      const imageNode = imageType.create({ src: img.src });
      tr.insert(endOfRow, imageNode);

      if (remaining.length <= 1) {
        // 0 or 1 image left — replace row with standalone image(s)
        if (remaining.length === 1) {
          const lastImg = remaining[0];
          const singleNode = imageType.create({ src: lastImg.src });
          tr.replaceWith(pos, pos + node.nodeSize, singleNode);
        } else {
          tr.delete(pos, pos + node.nodeSize);
        }
      } else {
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          images: JSON.stringify(remaining),
        });
      }

      editor.view.dispatch(tr);
    },
    [images, editor, node, getPos]
  );

  const handleDrop = useCallback(
    (e: DragEvent, targetIndex: number) => {
      e.preventDefault();
      setDragOverIndex(null);

      // Handle reorder from within the gallery
      if (dragSourceIndex !== null && dragSourceIndex !== targetIndex) {
        const next = [...images];
        const [moved] = next.splice(dragSourceIndex, 1);
        next.splice(targetIndex, 0, moved);
        updateImages(next);
        setDragSourceIndex(null);
        return;
      }

      // Handle external file drop
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
        f.type.startsWith("image/")
      );
      if (files.length) {
        void addImages(files);
      }
    },
    [dragSourceIndex, images, updateImages, addImages]
  );

  /**
   * When a drag ends, check if the drop landed outside the row container.
   * If so, extract the image into a standalone block.
   */
  const handleDragEnd = useCallback(
    (e: React.DragEvent, index: number) => {
      setDragSourceIndex(null);

      // Check if the drop target is outside this row container
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const { clientX, clientY } = e;

      const isOutside =
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom;

      if (isOutside) {
        extractImage(index);
      }
    },
    [extractImage]
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, index: number, currentWidth: number) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = currentWidth;

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const newWidth = Math.max(80, startWidth + delta);
        setResizePreview({ index, width: newWidth });
      };

      const onUp = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const finalWidth = Math.max(80, startWidth + delta);
        const next = [...images];
        next[index] = { ...next[index], width: finalWidth };
        updateImages(next);
        setResizePreview(null);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [images, updateImages]
  );

  return (
    <NodeViewWrapper
      className="image-row-container"
      data-image-row="true"
      data-editor-block="true"
    >
      <div ref={containerRef} contentEditable={false} className="image-row-gallery">
        {images.map((img, i) => (
          <div
            key={i}
            className={`image-row-item ${dragOverIndex === i ? "image-row-item-dragover" : ""}`}
            style={(resizePreview?.index === i ? resizePreview.width : img.width) ? { width: resizePreview?.index === i ? resizePreview.width : img.width, flexShrink: 0 } : undefined}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverIndex(i);
            }}
            onDragLeave={() => setDragOverIndex(null)}
            onDrop={(e) => handleDrop(e, i)}
          >
            <img src={img.src} alt="" className="image-row-img" draggable={false} />
            {isEditable && (
              <>
                <div
                  className="image-row-drag-handle"
                  draggable
                  onDragStart={() => setDragSourceIndex(i)}
                  onDragEnd={(e) => handleDragEnd(e, i)}
                >
                  <GripVertical size={14} />
                </div>
                <div
                  className="image-row-resize-handle"
                  onMouseDown={(e) =>
                    handleResizeStart(
                      e,
                      i,
                      img.width || (e.currentTarget.parentElement?.offsetWidth ?? 200)
                    )
                  }
                />
              </>
            )}
          </div>
        ))}

        {isEditable && (
          <button
            type="button"
            className="image-row-add-btn"
            onClick={handleAddClick}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
                f.type.startsWith("image/")
              );
              void addImages(files);
            }}
          >
            <ImagePlus size={20} />
            <span>{images.length === 0 ? "添加图片" : "添加"}</span>
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
    </NodeViewWrapper>
  );
}

export const ImageRowBlock = Node.create({
  name: "imageRowBlock",

  group: "block",

  atom: true,

  addAttributes() {
    return {
      images: {
        default: "[]",
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-image-row="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-image-row": "true",
        "data-editor-block": "true",
        class: "image-row-container",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageRowNodeView);
  },
});
