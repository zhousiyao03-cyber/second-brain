export const FOCUS_CATEGORIES = [
  "coding",
  "research",
  "meeting",
  "communication",
  "design",
  "writing",
  "other",
] as const;

export const FOCUS_WORK_CATEGORIES = [
  "coding",
  "research",
  "meeting",
  "communication",
  "design",
  "writing",
] as const;

export function classifySessionFallback(session: {
  appName: string;
  windowTitle: string | null;
}) {
  const haystack = `${session.appName} ${session.windowTitle ?? ""}`.toLowerCase();

  if (
    haystack.includes("code") ||
    haystack.includes("cursor") ||
    haystack.includes("terminal") ||
    haystack.includes("xcode")
  ) {
    return "coding" as const;
  }
  if (
    haystack.includes("figma") ||
    haystack.includes("sketch") ||
    haystack.includes("framer")
  ) {
    return "design" as const;
  }
  if (
    haystack.includes("zoom") ||
    haystack.includes("meet") ||
    haystack.includes("teams") ||
    haystack.includes("calendar")
  ) {
    return "meeting" as const;
  }
  if (
    haystack.includes("slack") ||
    haystack.includes("discord") ||
    haystack.includes("mail") ||
    haystack.includes("gmail")
  ) {
    return "communication" as const;
  }
  if (
    haystack.includes("notion") ||
    haystack.includes("docs") ||
    haystack.includes("draft") ||
    haystack.includes("word")
  ) {
    return "writing" as const;
  }
  if (
    haystack.includes("chrome") ||
    haystack.includes("safari") ||
    haystack.includes("arc") ||
    haystack.includes("research") ||
    haystack.includes("github") ||
    haystack.includes("docs")
  ) {
    return "research" as const;
  }

  return "other" as const;
}

export function resolveFocusCategory(session: {
  appName: string;
  windowTitle: string | null;
  category?: string | null;
}) {
  return session.category ?? classifySessionFallback(session);
}
