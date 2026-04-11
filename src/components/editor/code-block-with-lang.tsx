"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  NodeViewWrapper,
  NodeViewContent,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import "highlight.js/styles/github.css";

/** Practical list of ~20 common programming languages. */
const LANGUAGES = [
  { value: "", label: "Plain text" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "csharp", label: "C#" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "sql", label: "SQL" },
  { value: "bash", label: "Bash" },
  { value: "markdown", label: "Markdown" },
  { value: "xml", label: "XML" },
  { value: "ruby", label: "Ruby" },
  { value: "php", label: "PHP" },
  { value: "swift", label: "Swift" },
  { value: "kotlin", label: "Kotlin" },
] as const;

/**
 * Custom NodeView that renders a language selector dropdown at the
 * top-right corner of each code block.
 */
function CodeBlockNodeView({
  node,
  updateAttributes,
}: NodeViewProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const currentLang = (node.attrs.language as string) || "";

  // Close dropdown when clicking outside the wrapper
  const handleClickOutside = useCallback(
    (event: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    },
    []
  );

  useEffect(() => {
    if (showDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [showDropdown, handleClickOutside]);

  /** Resolve display label for the currently selected language. */
  const displayLabel =
    LANGUAGES.find((l) => l.value === currentLang)?.label ??
    (currentLang || "Plain text");

  return (
    <NodeViewWrapper className="code-block-wrapper" ref={wrapperRef}>
      <div className="code-block-header" contentEditable={false}>
        <button
          type="button"
          onClick={() => setShowDropdown((prev) => !prev)}
        >
          {displayLabel}
        </button>
        {showDropdown && (
          <div className="code-block-lang-dropdown">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.value}
                type="button"
                onClick={() => {
                  updateAttributes({ language: lang.value });
                  setShowDropdown(false);
                }}
                className={currentLang === lang.value ? "active" : ""}
              >
                {lang.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <pre>
        {/* @ts-expect-error -- Tiptap types restrict `as` to "div" but "code" works at runtime */}
        <NodeViewContent as="code" />
      </pre>
    </NodeViewWrapper>
  );
}

const lowlight = createLowlight(common);

/**
 * CodeBlockLowlight extension with a custom NodeView that includes
 * a language selector dropdown. Already configured with lowlight and
 * the `common` language bundle -- use directly in the extensions array.
 */
export const CodeBlockWithLang = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockNodeView);
  },
}).configure({ lowlight });
