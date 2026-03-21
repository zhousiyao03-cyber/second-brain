import { router } from "../trpc";
import { notesRouter } from "./notes";
import { bookmarksRouter } from "./bookmarks";
import { todosRouter } from "./todos";
import { learningRouter } from "./learning";
import { workflowsRouter } from "./workflows";

export const appRouter = router({
  notes: notesRouter,
  bookmarks: bookmarksRouter,
  todos: todosRouter,
  learning: learningRouter,
  workflows: workflowsRouter,
});

export type AppRouter = typeof appRouter;
