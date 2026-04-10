import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { generateStructuredData, getAIErrorMessage } from "@/server/ai/provider";
import { db } from "@/server/db";
import { learningNotes, learningTopics } from "@/server/db/schema";
import { auth } from "@/lib/auth";

type TiptapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

/** Parse inline markdown (bold, italic, code, links) into Tiptap inline nodes */
function parseInlineMarkdown(text: string): TiptapNode[] {
  const nodes: TiptapNode[] = [];
  // Match: **bold**, *italic*, `code`, [text](url)
  const inlineRegex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(.+?)\]\((.+?)\))/g;
  let lastIndex = 0;
  let match;

  while ((match = inlineRegex.exec(text)) !== null) {
    // Add preceding plain text
    if (match.index > lastIndex) {
      nodes.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }

    if (match[2]) {
      // **bold**
      nodes.push({ type: "text", text: match[2], marks: [{ type: "bold" }] });
    } else if (match[3]) {
      // *italic*
      nodes.push({ type: "text", text: match[3], marks: [{ type: "italic" }] });
    } else if (match[4]) {
      // `code`
      nodes.push({ type: "text", text: match[4], marks: [{ type: "code" }] });
    } else if (match[5] && match[6]) {
      // [text](url)
      nodes.push({
        type: "text",
        text: match[5],
        marks: [{ type: "link", attrs: { href: match[6] } }],
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    nodes.push({ type: "text", text: text.slice(lastIndex) });
  }

  return nodes.length > 0 ? nodes : [{ type: "text", text }];
}

/** Convert markdown string to Tiptap-compatible JSON document */
function markdownToTiptap(markdown: string): TiptapNode {
  const lines = markdown.split("\n");
  const content: TiptapNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Skip empty lines
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      content.push({
        type: "heading",
        attrs: { level: headingMatch[1]!.length },
        content: parseInlineMarkdown(headingMatch[2]!),
      });
      i++;
      continue;
    }

    // Code blocks
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim() || null;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++; // skip closing ```
      content.push({
        type: "codeBlock",
        attrs: { language: lang },
        content: [{ type: "text", text: codeLines.join("\n") }],
      });
      continue;
    }

    // Unordered list items (collect consecutive)
    if (/^[-*]\s+/.test(line)) {
      const items: TiptapNode[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!)) {
        const itemText = lines[i]!.replace(/^[-*]\s+/, "");
        items.push({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInlineMarkdown(itemText) }],
        });
        i++;
      }
      content.push({ type: "bulletList", content: items });
      continue;
    }

    // Ordered list items (collect consecutive)
    if (/^\d+\.\s+/.test(line)) {
      const items: TiptapNode[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i]!)) {
        const itemText = lines[i]!.replace(/^\d+\.\s+/, "");
        items.push({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInlineMarkdown(itemText) }],
        });
        i++;
      }
      content.push({ type: "orderedList", content: items });
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("> ")) {
        quoteLines.push(lines[i]!.slice(2));
        i++;
      }
      content.push({
        type: "blockquote",
        content: [
          { type: "paragraph", content: parseInlineMarkdown(quoteLines.join(" ")) },
        ],
      });
      continue;
    }

    // Markdown table
    if (line.includes("|") && i + 1 < lines.length && /^\|?\s*[-:]+[-|\s:]*$/.test(lines[i + 1]!.trim())) {
      // Collect header row
      const parseLine = (l: string): string[] =>
        l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const headers = parseLine(line);
      i += 2; // skip header and separator rows
      const bodyRows: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim() !== "") {
        bodyRows.push(parseLine(lines[i]!));
        i++;
      }
      const headerRow: TiptapNode = {
        type: "tableRow",
        content: headers.map((cell) => ({
          type: "tableHeader",
          content: [{ type: "paragraph", content: cell ? parseInlineMarkdown(cell) : [] }],
        })),
      };
      const dataRows: TiptapNode[] = bodyRows.map((row) => ({
        type: "tableRow",
        content: headers.map((_, idx) => ({
          type: "tableCell",
          content: [{ type: "paragraph", content: row[idx] ? parseInlineMarkdown(row[idx]!) : [] }],
        })),
      }));
      content.push({ type: "table", content: [headerRow, ...dataRows] });
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      content.push({ type: "horizontalRule" });
      i++;
      continue;
    }

    // Regular paragraph
    content.push({
      type: "paragraph",
      content: parseInlineMarkdown(line),
    });
    i++;
  }

  return { type: "doc", content };
}

const draftInputSchema = z.object({
  topicId: z.string(),
  keyword: z.string().trim().min(1),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsedInput = draftInputSchema.safeParse(body);
  if (!parsedInput.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }

  const { topicId, keyword } = parsedInput.data;

  const [topic] = await db
    .select()
    .from(learningTopics)
    .where(eq(learningTopics.id, topicId));

  if (!topic) {
    return Response.json({ error: "Topic not found" }, { status: 404 });
  }

  try {
    const output = await generateStructuredData({
      schema: z.object({
        title: z.string().min(1),
        summary: z.string().min(1),
        content: z.string().min(1),
      }),
      name: "learning_note_draft",
      description: "A detailed study note draft in Markdown.",
      prompt: `Create a detailed study note draft for topic "${topic.title}".

Focus keyword: ${keyword}
Topic description: ${topic.description ?? "None"}

Requirements:
- cover the important subtopics
- include practical examples
- write in clear Markdown
- keep the tone educational and concise`,
    });

    const id = crypto.randomUUID();
    const tiptapDoc = markdownToTiptap(output.content);
    await db.insert(learningNotes).values({
      id,
      topicId,
      userId: topic.userId,
      title: output.title,
      plainText: `${output.summary}\n\n${output.content}`,
      aiSummary: output.summary,
      content: JSON.stringify(tiptapDoc),
    });

    await db
      .update(learningTopics)
      .set({ updatedAt: new Date() })
      .where(
        and(eq(learningTopics.id, topicId), eq(learningTopics.userId, topic.userId))
      );

    return Response.json({ id });
  } catch (error) {
    return Response.json(
      { error: getAIErrorMessage(error, "Draft generation failed") },
      { status: 500 }
    );
  }
}
