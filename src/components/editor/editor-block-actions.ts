import type { Editor as TiptapEditorInstance } from "@tiptap/react";
import {
  ArrowDown,
  ArrowUp,
  Columns2,
  Copy,
  Trash2,
} from "lucide-react";
import {
  deleteTopLevelBlock,
  duplicateTopLevelBlock,
  focusTopLevelBlock,
  getTopLevelBlockContext,
  moveTopLevelBlock,
} from "./editor-block-ops";
import {
  flattenEditorCommandGroups,
  type EditorCommandItem,
  type EditorCommandGroup,
} from "./editor-commands";

interface BlockActionMenuState {
  coords: { top: number; left: number };
  targetPos: number;
}

function collectImagesFromNode(node: { type: { name: string }; attrs: Record<string, unknown> }): { src: string; width?: number }[] {
  if (node.type.name === "image") {
    const src = node.attrs.src as string;
    return src ? [{ src }] : [];
  }
  if (node.type.name === "imageRowBlock") {
    try {
      const parsed = JSON.parse(node.attrs.images as string);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}

export function buildBlockActionItems(
  editor: TiptapEditorInstance,
  state: BlockActionMenuState,
  commandGroups: EditorCommandGroup[]
): EditorCommandItem[] {
  const block = getTopLevelBlockContext(editor, state.targetPos);
  if (!block) return [];

  const items: EditorCommandItem[] = [];

  if (block.index > 0) {
    items.push({
      id: "move-up",
      title: "Move up",
      description: "Move current block up one row",
      keywords: ["move", "up"],
      icon: ArrowUp,
      run: (ed) => {
        moveTopLevelBlock(ed, state.targetPos, "up");
      },
    });
  }

  if (block.index < editor.state.doc.childCount - 1) {
    items.push({
      id: "move-down",
      title: "Move down",
      description: "Move current block down one row",
      keywords: ["move", "down"],
      icon: ArrowDown,
      run: (ed) => {
        moveTopLevelBlock(ed, state.targetPos, "down");
      },
    });
  }

  // "Merge into row" action for image blocks when an adjacent block is also an image or imageRowBlock
  if (block.node.type.name === "image" || block.node.type.name === "imageRowBlock") {
    const doc = editor.state.doc;
    // Check next sibling
    if (block.index < doc.childCount - 1) {
      const nextPos = state.targetPos + block.node.nodeSize;
      const nextNode = doc.nodeAt(nextPos);
      if (nextNode && (nextNode.type.name === "image" || nextNode.type.name === "imageRowBlock")) {
        items.push({
          id: "merge-with-next",
          title: "Merge with image below",
          description: "Merge into image row",
          keywords: ["merge", "row"],
          icon: Columns2,
          run: (ed) => {
            const curBlock = getTopLevelBlockContext(ed, state.targetPos);
            if (!curBlock) return;
            const curNode = curBlock.node;
            const curEnd = state.targetPos + curNode.nodeSize;
            const nNode = ed.state.doc.nodeAt(curEnd);
            if (!nNode) return;

            const imgs = [
              ...collectImagesFromNode(curNode),
              ...collectImagesFromNode(nNode),
            ];

            const rowType = ed.state.schema.nodes.imageRowBlock;
            if (!rowType || imgs.length === 0) return;
            const newNode = rowType.create({ images: JSON.stringify(imgs) });
            const { tr } = ed.state;
            tr.replaceWith(state.targetPos, curEnd + nNode.nodeSize, newNode);
            ed.view.dispatch(tr);
          },
        });
      }
    }
    // Check previous sibling
    if (block.index > 0) {
      let prevNode = null as typeof block.node | null;
      let idx = 0;
      doc.forEach((node) => {
        if (idx === block.index - 1) {
          prevNode = node;
        }
        idx++;
      });
      if (prevNode && (prevNode.type.name === "image" || prevNode.type.name === "imageRowBlock")) {
        items.push({
          id: "merge-with-prev",
          title: "Merge with image above",
          description: "Merge into image row",
          keywords: ["merge", "row"],
          icon: Columns2,
          run: (ed) => {
            // Re-find prev block at run time
            const curBlock2 = getTopLevelBlockContext(ed, state.targetPos);
            if (!curBlock2 || curBlock2.index === 0) return;
            let pPos = 0;
            let pNode = null as typeof block.node | null;
            let i2 = 0;
            ed.state.doc.forEach((node, offset) => {
              if (i2 === curBlock2.index - 1) {
                pPos = offset;
                pNode = node;
              }
              i2++;
            });
            if (!pNode) return;

            const imgs = [
              ...collectImagesFromNode(pNode),
              ...collectImagesFromNode(curBlock2.node),
            ];

            const rowType = ed.state.schema.nodes.imageRowBlock;
            if (!rowType || imgs.length === 0) return;
            const newNode = rowType.create({ images: JSON.stringify(imgs) });
            const { tr } = ed.state;
            tr.replaceWith(pPos, state.targetPos + curBlock2.node.nodeSize, newNode);
            ed.view.dispatch(tr);
          },
        });
      }
    }
  }

  items.push(
    {
      id: "duplicate-block",
      title: "Duplicate block",
      description: "Duplicate current block content",
      keywords: ["duplicate", "copy"],
      icon: Copy,
      run: (ed) => {
        duplicateTopLevelBlock(ed, state.targetPos);
      },
    },
    {
      id: "delete-block",
      title: "Delete block",
      description: "Delete current block",
      keywords: ["delete", "remove"],
      icon: Trash2,
      run: (ed) => {
        deleteTopLevelBlock(ed, state.targetPos);
      },
      tone: "danger",
    }
  );

  const transformable = ![
    "image",
    "horizontalRule",
    "calloutBlock",
    "toggleBlock",
    "excalidrawBlock",
    "imageRowBlock",
    "mermaidBlock",
    "tocBlock",
  ].includes(block.node.type.name);

  if (transformable) {
    const transformItems = flattenEditorCommandGroups(
      commandGroups.filter((group) => group.id !== "media")
    )
      .filter(
        (item) => item.id !== "horizontal-rule" && item.transformable !== false
      )
      .map((item) => ({
        ...item,
        id: `transform-${item.id}`,
        title: `Convert to ${item.title}`,
        description: `Convert current block to ${item.title}`,
        run: (ed: TiptapEditorInstance) => {
          focusTopLevelBlock(ed, state.targetPos);
          item.run(ed);
        },
      }));

    items.push(...transformItems);
  }

  return items;
}
