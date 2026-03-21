import { router } from "../trpc";
import { notesRouter } from "./notes";
import { bookmarksRouter } from "./bookmarks";
import { todosRouter } from "./todos";

export const appRouter = router({
  notes: notesRouter,
  bookmarks: bookmarksRouter,
  todos: todosRouter,
});

export type AppRouter = typeof appRouter;
