export type FocusTag =
  | "browser"
  | "coding"
  | "communication"
  | "design"
  | "docs"
  | "editor"
  | "entertainment"
  | "git"
  | "gaming"
  | "golang"
  | "learning"
  | "meeting"
  | "reference"
  | "social-media"
  | "terminal"
  | "writing"
  | "javascript"
  | "rust"
  | "deployment";

type TagRule = {
  pattern: RegExp;
  tags: FocusTag[];
};

const NON_WORK_TAGS: FocusTag[] = ["entertainment", "social-media", "gaming"];

const DOMAIN_TAG_RULES: TagRule[] = [
  { pattern: /github\.com/i, tags: ["git", "coding"] },
  { pattern: /gitlab\.com/i, tags: ["git", "coding"] },
  { pattern: /stackoverflow\.com/i, tags: ["coding", "reference"] },
  { pattern: /go\.dev|gobyexample\.com|pkg\.go\.dev/i, tags: ["golang", "learning"] },
  { pattern: /docs\.rs|crates\.io/i, tags: ["rust", "reference"] },
  { pattern: /npmjs\.com|nodejs\.org/i, tags: ["javascript", "reference"] },
  { pattern: /developer\.mozilla\.org/i, tags: ["reference"] },
  { pattern: /docs\.google\.com/i, tags: ["docs", "writing"] },
  { pattern: /notion\.so/i, tags: ["writing"] },
  { pattern: /meet\.google\.com/i, tags: ["meeting"] },
  { pattern: /zoom\.us/i, tags: ["meeting"] },
  { pattern: /mail\.google\.com|outlook\.live\.com/i, tags: ["communication"] },
  { pattern: /youtube\.com/i, tags: ["entertainment"] },
  { pattern: /twitter\.com|x\.com/i, tags: ["social-media"] },
  { pattern: /reddit\.com/i, tags: ["social-media"] },
  { pattern: /figma\.com/i, tags: ["design"] },
  { pattern: /vercel\.com/i, tags: ["coding", "deployment"] },
];

const APP_TAG_RULES: TagRule[] = [
  { pattern: /visual studio code|code|cursor/i, tags: ["editor", "coding"] },
  { pattern: /xcode/i, tags: ["editor", "coding"] },
  { pattern: /ghostty|iterm|terminal|warp/i, tags: ["terminal", "coding"] },
  { pattern: /figma|sketch|framer/i, tags: ["design"] },
  { pattern: /zoom/i, tags: ["meeting"] },
  { pattern: /slack|discord|mail|gmail/i, tags: ["communication"] },
  { pattern: /chrome|safari|arc|firefox/i, tags: ["browser"] },
];

function collectTags(value: string, rules: TagRule[]) {
  const tags = new Set<FocusTag>();

  for (const rule of rules) {
    if (rule.pattern.test(value)) {
      for (const tag of rule.tags) {
        tags.add(tag);
      }
    }
  }

  return [...tags];
}

function hostnameFromUrl(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function domainTags(url: string) {
  const hostname = hostnameFromUrl(url);
  if (!hostname) {
    return [];
  }

  return collectTags(hostname, DOMAIN_TAG_RULES);
}

export function appTags(appName: string) {
  return collectTags(appName, APP_TAG_RULES);
}

export function autoTag(input: {
  appName: string;
  windowTitle: string | null;
  browserUrl: string | null;
}) {
  const tags = new Set<FocusTag>();

  for (const tag of appTags(input.appName)) {
    tags.add(tag);
  }

  if (input.browserUrl) {
    tags.add("browser");
    for (const tag of domainTags(input.browserUrl)) {
      tags.add(tag);
    }
  }

  return [...tags];
}

export function countsTowardWorkHours(tags: readonly string[]) {
  if (tags.length === 0) {
    return true;
  }

  return !tags.some((tag) => NON_WORK_TAGS.includes(tag as FocusTag));
}
