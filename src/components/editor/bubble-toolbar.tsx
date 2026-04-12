"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { cn } from "@/lib/utils";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Highlighter,
  Link as LinkIcon,
  Palette,
  Sparkles,
} from "lucide-react";

const TEXT_COLORS = [
  { label: "Default", value: "" },
  { label: "Red", value: "#dc2626" },
  { label: "Orange", value: "#ea580c" },
  { label: "Yellow", value: "#ca8a04" },
  { label: "Green", value: "#16a34a" },
  { label: "Blue", value: "#2563eb" },
  { label: "Purple", value: "#9333ea" },
  { label: "Pink", value: "#db2777" },
  { label: "Gray", value: "#6b7280" },
];

function BubbleButton({
  onClick,
  isActive,
  children,
  title,
}: {
  onClick: () => void;
  isActive?: boolean;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault(); // prevent losing selection
        onClick();
      }}
      title={title}
      className={cn(
        "p-1.5 rounded hover:bg-white/20 transition-colors",
        isActive && "bg-white/20 text-white"
      )}
    >
      {children}
    </button>
  );
}

interface BubbleToolbarProps {
  editor: Editor;
}

export function BubbleToolbar({ editor }: BubbleToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

  const updatePosition = useCallback(() => {
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      setVisible(false);
      return;
    }

    // Don't show in code blocks
    if (editor.isActive("codeBlock")) {
      setVisible(false);
      return;
    }

    const view = editor.view;
    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);

    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const toolbarWidth = toolbar.offsetWidth || 380;
    const centerX = (start.left + end.right) / 2;
    let left = centerX - toolbarWidth / 2;

    // Keep within viewport
    left = Math.max(8, Math.min(left, window.innerWidth - toolbarWidth - 8));

    setPosition({
      top: start.top - 50,
      left,
    });
    setVisible(true);
  }, [editor]);

  useEffect(() => {
    editor.on("selectionUpdate", updatePosition);
    editor.on("blur", () => {
      // Delay to allow button clicks
      setTimeout(() => {
        if (!toolbarRef.current?.contains(document.activeElement)) {
          setVisible(false);
        }
      }, 150);
    });

    return () => {
      editor.off("selectionUpdate", updatePosition);
    };
  }, [editor, updatePosition]);

  const iconSize = 15;

  const setLink = () => {
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }

    const url = window.prompt("Enter link URL:");
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  return (
    <div
      ref={toolbarRef}
      className={cn(
        "fixed z-50 flex items-center gap-0.5 rounded-xl border border-stone-800/80 bg-stone-950/95 px-1.5 py-1 shadow-xl backdrop-blur transition-opacity duration-150",
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      )}
      style={{ top: position.top, left: position.left }}
    >
      <BubbleButton
        onClick={() => {
          const { from, to, empty } = editor.state.selection;
          if (empty) return;
          const selectedText = editor.state.doc.textBetween(from, to, "\n");
          const coords = editor.view.coordsAtPos(to);
          window.dispatchEvent(
            new CustomEvent("open-inline-ask-ai", {
              detail: {
                pos: to,
                top: coords.bottom + 6,
                left: coords.left,
                selectedText,
                selectionFrom: from,
                selectionTo: to,
              },
            })
          );
        }}
        title="Ask AI"
      >
        <Sparkles size={iconSize} className="text-gray-300" />
      </BubbleButton>
      <div className="mx-0.5 h-4 w-px bg-stone-700/60" />
      <BubbleButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive("bold")}
        title="Bold"
      >
        <Bold size={iconSize} className="text-gray-300" />
      </BubbleButton>
      <BubbleButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive("italic")}
        title="Italic"
      >
        <Italic size={iconSize} className="text-gray-300" />
      </BubbleButton>
      <BubbleButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor.isActive("underline")}
        title="Underline"
      >
        <UnderlineIcon size={iconSize} className="text-gray-300" />
      </BubbleButton>
      <BubbleButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive("strike")}
        title="Strikethrough"
      >
        <Strikethrough size={iconSize} className="text-gray-300" />
      </BubbleButton>
      <BubbleButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        isActive={editor.isActive("code")}
        title="Inline code"
      >
        <Code size={iconSize} className="text-gray-300" />
      </BubbleButton>
      <BubbleButton
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        isActive={editor.isActive("highlight")}
        title="Highlight"
      >
        <Highlighter size={iconSize} className="text-gray-300" />
      </BubbleButton>
      <BubbleButton
        onClick={setLink}
        isActive={editor.isActive("link")}
        title={editor.isActive("link") ? "Remove link" : "Link"}
      >
        <LinkIcon size={iconSize} className="text-gray-300" />
      </BubbleButton>

      <div className="mx-0.5 h-4 w-px bg-stone-700" />

      <div className="relative">
        <BubbleButton
          onClick={() => setColorPickerOpen((open) => !open)}
          isActive={editor.isActive("textStyle")}
          title="Text color"
        >
          <Palette size={iconSize} className="text-gray-300" />
        </BubbleButton>
        {colorPickerOpen && (
          <div className="absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 rounded-xl border border-stone-700 bg-stone-900 p-2 shadow-xl">
            <div className="grid grid-cols-5 gap-1">
              {TEXT_COLORS.map((color) => (
                <button
                  key={color.label}
                  type="button"
                  title={color.label}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (color.value) {
                      editor.chain().focus().setColor(color.value).run();
                    } else {
                      editor.chain().focus().unsetColor().run();
                    }
                    setColorPickerOpen(false);
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-white/20"
                >
                  {color.value ? (
                    <span
                      className="h-4 w-4 rounded-full border border-stone-600"
                      style={{ backgroundColor: color.value }}
                    />
                  ) : (
                    <span className="text-xs text-gray-400">A</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
