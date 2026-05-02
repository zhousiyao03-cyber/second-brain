import { router } from "../trpc";
import { notesRouter } from "./notes";
import { foldersRouter } from "./folders";
import { bookmarksRouter } from "./bookmarks";
import { todosRouter } from "./todos";
import { workflowsRouter } from "./workflows";
import { dashboardRouter } from "./dashboard";
import { focusRouter } from "./focus";
import { usageRouter } from "./usage";
import { portfolioRouter } from "./portfolio";
import { ossProjectsRouter } from "./oss-projects";
import { billingRouter } from "./billing";
import { learningNotebookRouter } from "./learning-notebook";
import { councilRouter } from "./council";
import { aiSettingsRouter } from "./ai-settings";
import { preferencesRouter } from "./preferences";

export const appRouter = router({
  notes: notesRouter,
  folders: foldersRouter,
  bookmarks: bookmarksRouter,
  todos: todosRouter,
  ossProjects: ossProjectsRouter,
  workflows: workflowsRouter,
  dashboard: dashboardRouter,
  focus: focusRouter,
  usage: usageRouter,
  portfolio: portfolioRouter,
  billing: billingRouter,
  learningNotebook: learningNotebookRouter,
  council: councilRouter,
  aiSettings: aiSettingsRouter,
  preferences: preferencesRouter,
});

export type AppRouter = typeof appRouter;
