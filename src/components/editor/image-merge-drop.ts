import { Extension } from "@tiptap/react";
import { Plugin, PluginKey, NodeSelection } from "@tiptap/pm/state";

/**
 * Extract image src from a node. Returns null if not an image node.
 */
function getImageSrc(node: { type: { name: string }; attrs: Record<string, unknown> }): string | null {
  if (node.type.name === "image") {
    return (node.attrs.src as string) || null;
  }
  return null;
}

/**
 * Parse the images JSON array from an imageRowBlock node.
 */
function parseRowImages(node: { attrs: Record<string, unknown> }): { src: string; width?: number }[] {
  try {
    const parsed = JSON.parse(node.attrs.images as string);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Tiptap extension that enables merging images by drag-and-drop:
 * - Drag image onto another image → merge into imageRowBlock
 * - Drag image onto an imageRowBlock → add to the row
 */
export const ImageMergeDrop = Extension.create({
  name: "imageMergeDrop",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("imageMergeDrop"),
        props: {
          handleDrop: (view, event, slice, moved) => {
            // Only handle internal moves (not file drops)
            if (!moved || !slice) return false;

            // Check if we're dragging an image node
            const draggedContent = slice.content;
            if (draggedContent.childCount !== 1) return false;
            const draggedNode = draggedContent.firstChild!;

            const draggedSrc = getImageSrc(draggedNode);
            const isDraggedImageRow = draggedNode.type.name === "imageRowBlock";

            if (!draggedSrc && !isDraggedImageRow) return false;

            // Find the drop target position
            const coords = { left: event.clientX, top: event.clientY };
            const dropPos = view.posAtCoords(coords);
            if (!dropPos) return false;

            // Resolve the position to find the target node
            const $pos = view.state.doc.resolve(dropPos.pos);

            // Walk up to find the nearest block-level node at depth 1
            let targetPos = -1;
            let targetNode = null;
            for (let d = $pos.depth; d >= 1; d--) {
              const node = $pos.node(d);
              if (
                node.type.name === "image" ||
                node.type.name === "imageRowBlock"
              ) {
                targetPos = $pos.before(d);
                targetNode = node;
                break;
              }
            }

            // Also check if the resolved pos itself points to an image or imageRowBlock
            if (!targetNode) {
              // Check the node directly at/after the drop position
              const resolvedPos = dropPos.inside >= 0 ? dropPos.inside : dropPos.pos;
              const $resolved = view.state.doc.resolve(resolvedPos);

              for (let d = $resolved.depth; d >= 1; d--) {
                const node = $resolved.node(d);
                if (
                  node.type.name === "image" ||
                  node.type.name === "imageRowBlock"
                ) {
                  targetPos = $resolved.before(d);
                  targetNode = node;
                  break;
                }
              }
            }

            // Try to find image at the exact position
            if (!targetNode) {
              try {
                const nodeAt = view.state.doc.nodeAt(dropPos.pos);
                if (nodeAt && (nodeAt.type.name === "image" || nodeAt.type.name === "imageRowBlock")) {
                  targetPos = dropPos.pos;
                  targetNode = nodeAt;
                }
              } catch {
                // Position out of range
              }
            }

            if (!targetNode || targetPos < 0) return false;

            const targetSrc = getImageSrc(targetNode);
            const isTargetImageRow = targetNode.type.name === "imageRowBlock";

            // Don't merge with self
            if (!isTargetImageRow && !targetSrc) return false;

            // The drag source position is captured by ProseMirror as a NodeSelection
            // before the drop. Use it to locate the exact dragged node.
            const { state } = view;
            const dragSelection = state.selection;
            let dragFrom = -1;
            let dragTo = -1;

            if (dragSelection instanceof NodeSelection) {
              dragFrom = dragSelection.from;
              dragTo = dragSelection.to;
            }

            // NodeSelection is the reliable source — if we don't have it, bail
            // rather than guessing by content match (which fails for duplicate images)
            if (dragFrom < 0) return false;

            // Don't merge with itself
            if (dragFrom === targetPos) return false;

            // Build the merged images array
            let mergedImages: { src: string; width?: number }[];

            if (isTargetImageRow) {
              // Dropping onto an existing image row
              const existingImages = parseRowImages(targetNode);
              if (draggedSrc) {
                mergedImages = [...existingImages, { src: draggedSrc }];
              } else if (isDraggedImageRow) {
                mergedImages = [...existingImages, ...parseRowImages(draggedNode)];
              } else {
                return false;
              }
            } else if (targetSrc) {
              // Dropping image onto another image → create new row
              if (draggedSrc) {
                mergedImages = [{ src: targetSrc }, { src: draggedSrc }];
              } else if (isDraggedImageRow) {
                mergedImages = [{ src: targetSrc }, ...parseRowImages(draggedNode)];
              } else {
                return false;
              }
            } else {
              return false;
            }

            // Apply the transaction: replace target with imageRowBlock, then delete dragged node.
            // Use tr.mapping to safely track position shifts between steps.
            const { tr } = state;
            const schema = state.schema;
            const imageRowType = schema.nodes.imageRowBlock;
            if (!imageRowType) return false;

            const newNode = imageRowType.create({
              images: JSON.stringify(mergedImages),
            });

            // Step 1: Replace the target node with the merged imageRowBlock
            tr.replaceWith(targetPos, targetPos + targetNode.nodeSize, newNode);

            // Step 2: Delete the dragged node using mapped positions
            const mappedFrom = tr.mapping.map(dragFrom);
            const mappedTo = tr.mapping.map(dragTo);
            tr.delete(mappedFrom, mappedTo);

            view.dispatch(tr);
            event.preventDefault();
            return true;
          },
        },
      }),
    ];
  },
});
