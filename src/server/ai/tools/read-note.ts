/**
 * `readNote` tool — fetches the full body of a single note belonging to the
 * current user. Typical usage: the LLM ran `searchKnowledge`, saw a
 * promising snippet, and now wants the whole note to give a faithful answer.
 *
 * Spec §4.2. Security: `userId` is enforced in the WHERE clause so even if
 * the model invents or remembers a noteId from another user it cannot read
 * across the boundary.
 */

import { and, eq } from "drizzle-orm";
import { tool } from "ai";
import { z } from "zod/v4";
import { db } from "@/server/db";
import { notes } from "@/server/db/schema/notes";
import type { AskAiToolContext } from "./context";

export function makeReadNoteTool(ctx: AskAiToolContext) {
  return tool({
    description:
      "Read the full content of one of the user's notes by id. Use after " +
      "searchKnowledge surfaces a relevant note id and you need the whole " +
      "body (not just the snippet) to answer faithfully.",
    inputSchema: z.object({
      noteId: z.string().min(1),
    }),
    execute: async ({ noteId }) => {
      const [row] = await db
        .select({
          id: notes.id,
          title: notes.title,
          plainText: notes.plainText,
        })
        .from(notes)
        .where(and(eq(notes.id, noteId), eq(notes.userId, ctx.userId)))
        .limit(1);

      if (!row) {
        return {
          error:
            "Note not found or not accessible. The id may be wrong, or the note may have been deleted.",
        };
      }

      return {
        id: row.id,
        title: row.title ?? "Untitled",
        content: row.plainText ?? "",
      };
    },
  });
}
