import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Fragment, Slice } from "@tiptap/pm/model";

/** Mermaid diagram type keywords that appear at the start of a definition. */
const MERMAID_KEYWORDS = [
  "graph ",
  "graph\n",
  "flowchart ",
  "flowchart\n",
  "sequenceDiagram",
  "classDiagram",
  "stateDiagram",
  "erDiagram",
  "gantt",
  "pie ",
  "pie\n",
  "gitGraph",
  "journey",
  "mindmap",
  "timeline",
  "quadrantChart",
  "xychart",
  "block-beta",
  "sankey-beta",
];

/**
 * Detect if text looks like a standalone Mermaid diagram definition.
 */
function isMermaidCode(text: string): boolean {
  const trimmed = text.trim();
  return MERMAID_KEYWORDS.some((kw) => trimmed.startsWith(kw));
}

/**
 * Check if a group of lines starting at `start` form a markdown table.
 * Returns the end index (exclusive) if it is a table, or -1 if not.
 */
function detectTableEnd(lines: string[], start: number): number {
  if (start + 1 >= lines.length) return -1;
  const row0 = lines[start];
  const row1 = lines[start + 1];
  if (!row0.includes("|") || !row1.includes("|")) return -1;
  if (!/^\|?\s*[-:]+[-|\s:]*$/.test(row1.trim())) return -1;

  let end = start + 2;
  while (end < lines.length && lines[end].includes("|") && lines[end].trim() !== "") {
    end++;
  }
  return end;
}

/**
 * Parse a markdown table (header + separator + body lines) into columns & rows.
 */
function parseMarkdownTable(tableLines: string[]): {
  headers: string[];
  rows: string[][];
} {
  const parseLine = (line: string): string[] =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

  const headers = parseLine(tableLines[0]);
  const rows = tableLines.slice(2).map(parseLine);
  return { headers, rows };
}

/**
 * Convert parsed markdown table into Tiptap JSON for a table node.
 */
function markdownTableToJson(tableLines: string[]) {
  const { headers, rows } = parseMarkdownTable(tableLines);

  const headerRow = {
    type: "tableRow",
    content: headers.map((cell) => ({
      type: "tableHeader",
      content: [{ type: "paragraph", content: cell ? [{ type: "text", text: cell }] : [] }],
    })),
  };

  const bodyRows = rows.map((row) => ({
    type: "tableRow",
    content: headers.map((_, i) => ({
      type: "tableCell",
      content: [
        {
          type: "paragraph",
          content: row[i] ? [{ type: "text", text: row[i] }] : [],
        },
      ],
    })),
  }));

  return { type: "table", content: [headerRow, ...bodyRows] };
}

type BlockJson =
  | { type: "mermaidBlock"; attrs: { code: string } }
  | { type: "table"; content: unknown[] }
  | { type: "paragraph"; content?: { type: string; text: string }[] }
  | { type: "heading"; attrs: { level: number }; content?: { type: string; text: string }[] }
  | { type: "codeBlock"; attrs: { language: string | null }; content?: { type: string; text: string }[] }
  | { type: "horizontalRule" };

/**
 * Parse mixed markdown text into an array of block-level JSON nodes.
 * Recognises: ```mermaid fenced blocks, markdown tables, headings,
 * other fenced code blocks, horizontal rules, and plain paragraphs.
 */
function parseMarkdownBlocks(text: string): BlockJson[] {
  const lines = text.split("\n");
  const blocks: BlockJson[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code block: ```lang ... ```
    if (line.trimStart().startsWith("```")) {
      const lang = line.trimStart().slice(3).trim() || null;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```

      const code = codeLines.join("\n");

      if (lang === "mermaid" || (lang === null && isMermaidCode(code))) {
        blocks.push({ type: "mermaidBlock", attrs: { code: code.trim() } });
      } else {
        blocks.push({
          type: "codeBlock",
          attrs: { language: lang },
          content: code ? [{ type: "text", text: code }] : [],
        });
      }
      continue;
    }

    // Markdown table
    const tableEnd = detectTableEnd(lines, i);
    if (tableEnd > 0) {
      blocks.push(markdownTableToJson(lines.slice(i, tableEnd)) as BlockJson);
      i = tableEnd;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        attrs: { level: headingMatch[1].length },
        content: headingMatch[2] ? [{ type: "text", text: headingMatch[2] }] : [],
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      blocks.push({ type: "horizontalRule" });
      i++;
      continue;
    }

    // Plain paragraph
    blocks.push({
      type: "paragraph",
      content: line.trim() ? [{ type: "text", text: line.trim() }] : [],
    });
    i++;
  }

  return blocks;
}

/**
 * Check if the text contains any markdown structures we can enhance
 * (mermaid fenced blocks or markdown tables).
 */
function hasMarkdownStructures(text: string): boolean {
  return (
    /```mermaid/i.test(text) ||
    /\|.+\|\s*\n\|?\s*[-:]+[-|\s:]*\|/.test(text)
  );
}

/**
 * Tiptap extension that intercepts paste events containing markdown content
 * with mermaid code blocks or tables and converts them into rich Tiptap nodes.
 */
export const MarkdownTablePaste = Extension.create({
  name: "markdownTablePaste",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("markdownTablePaste"),
        props: {
          handlePaste: (view, event) => {
            const text = event.clipboardData?.getData("text/plain");
            if (!text) return false;

            // Quick check: standalone Mermaid code (no fences)
            if (isMermaidCode(text)) {
              const { state, dispatch } = view;
              const node = state.schema.nodeFromJSON({
                type: "mermaidBlock",
                attrs: { code: text.trim() },
              });
              dispatch(state.tr.replaceSelectionWith(node));
              return true;
            }

            // Check for mixed content with mermaid blocks or tables
            if (!hasMarkdownStructures(text)) return false;

            // If clipboard also has HTML with tables (e.g. from spreadsheet),
            // skip — let the browser handle it
            const html = event.clipboardData?.getData("text/html");
            if (html && html.includes("<table")) return false;

            const blockJsons = parseMarkdownBlocks(text);
            // Only intercept if we actually found mermaid or table blocks
            const hasSpecialBlocks = blockJsons.some(
              (b) => b.type === "mermaidBlock" || b.type === "table"
            );
            if (!hasSpecialBlocks) return false;

            const { state, dispatch } = view;
            const nodes = blockJsons.map((json) => state.schema.nodeFromJSON(json));
            const fragment = Fragment.from(nodes);
            const slice = new Slice(fragment, 0, 0);
            dispatch(state.tr.replaceSelection(slice));
            return true;
          },
        },
      }),
    ];
  },
});
