import { router } from "../trpc";
import { notesRouter } from "./notes";
import { bookmarksRouter } from "./bookmarks";
import { todosRouter } from "./todos";
import { learningRouter } from "./learning";
import { workflowsRouter } from "./workflows";
import { dashboardRouter } from "./dashboard";
import { focusRouter } from "./focus";
import { tokenUsageRouter } from "./token-usage";

export const appRouter = router({
  notes: notesRouter,
  bookmarks: bookmarksRouter,
  todos: todosRouter,
  learning: learningRouter,
  workflows: workflowsRouter,
  dashboard: dashboardRouter,
  focus: focusRouter,
  tokenUsage: tokenUsageRouter,
});

export type AppRouter = typeof appRouter;
