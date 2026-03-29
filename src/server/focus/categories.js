export const FOCUS_CATEGORIES = [
  "coding",
  "research",
  "meeting",
  "communication",
  "design",
  "writing",
  "other",
];

export const FOCUS_WORK_CATEGORIES = [
  "coding",
  "research",
  "meeting",
  "communication",
  "design",
  "writing",
];

export function classifySessionFallback(session) {
  const haystack = `${session.appName} ${session.windowTitle ?? ""}`.toLowerCase();

  if (
    haystack.includes("code") ||
    haystack.includes("cursor") ||
    haystack.includes("terminal") ||
    haystack.includes("xcode")
  ) {
    return "coding";
  }
  if (
    haystack.includes("figma") ||
    haystack.includes("sketch") ||
    haystack.includes("framer")
  ) {
    return "design";
  }
  if (
    haystack.includes("zoom") ||
    haystack.includes("meet") ||
    haystack.includes("teams") ||
    haystack.includes("calendar")
  ) {
    return "meeting";
  }
  if (
    haystack.includes("slack") ||
    haystack.includes("discord") ||
    haystack.includes("mail") ||
    haystack.includes("gmail")
  ) {
    return "communication";
  }
  if (
    haystack.includes("notion") ||
    haystack.includes("docs") ||
    haystack.includes("draft") ||
    haystack.includes("word")
  ) {
    return "writing";
  }
  if (
    haystack.includes("chrome") ||
    haystack.includes("safari") ||
    haystack.includes("arc") ||
    haystack.includes("research") ||
    haystack.includes("github") ||
    haystack.includes("docs")
  ) {
    return "research";
  }

  return "other";
}

export function resolveFocusCategory(session) {
  return session.category ?? classifySessionFallback(session);
}
