export const NON_WORK_TAGS = ["entertainment", "social-media", "gaming"];
export const NON_WORK_REASON_LABELS = {
  "social-media": "Social / Messaging",
  entertainment: "Entertainment",
  gaming: "Gaming",
};

const DOMAIN_TAG_RULES = [
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
  { pattern: /web\.whatsapp\.com|whatsapp\.com/i, tags: ["social-media"] },
  { pattern: /weixin\.qq\.com|wx\.qq\.com/i, tags: ["social-media"] },
  { pattern: /twitter\.com|x\.com/i, tags: ["social-media"] },
  { pattern: /reddit\.com/i, tags: ["social-media"] },
  { pattern: /figma\.com/i, tags: ["design"] },
  { pattern: /vercel\.com/i, tags: ["coding", "deployment"] },
];

const APP_TAG_RULES = [
  { pattern: /visual studio code|code|cursor/i, tags: ["editor", "coding"] },
  { pattern: /xcode/i, tags: ["editor", "coding"] },
  { pattern: /ghostty|iterm|terminal|warp/i, tags: ["terminal", "coding"] },
  { pattern: /figma|sketch|framer/i, tags: ["design"] },
  { pattern: /zoom/i, tags: ["meeting"] },
  { pattern: /slack|discord|mail|gmail/i, tags: ["communication"] },
  { pattern: /wechat|weixin|whatsapp/i, tags: ["social-media"] },
  { pattern: /chrome|safari|arc|firefox/i, tags: ["browser"] },
];

function collectTags(value, rules) {
  const tags = new Set();

  for (const rule of rules) {
    if (rule.pattern.test(value)) {
      for (const tag of rule.tags) {
        tags.add(tag);
      }
    }
  }

  return [...tags];
}

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function surfaceTypeTags(surfaceType) {
  switch (surfaceType) {
    case "repo":
    case "pr":
    case "issue":
      return ["git", "coding"];
    case "docs":
      return ["docs", "reference"];
    case "design":
      return ["design"];
    case "mail":
      return ["communication"];
    case "calendar":
      return ["meeting"];
    case "video":
      return ["entertainment"];
    case "search":
      return ["reference"];
    case "chat":
      return ["communication"];
    default:
      return [];
  }
}

export function domainTags(url) {
  const hostname = hostnameFromUrl(url);
  if (!hostname) {
    return [];
  }

  return collectTags(hostname, DOMAIN_TAG_RULES);
}

export function appTags(appName) {
  return collectTags(appName, APP_TAG_RULES);
}

export function autoTag(input) {
  const tags = new Set();

  for (const tag of appTags(input.appName)) {
    tags.add(tag);
  }

  if (input.browserUrl) {
    tags.add("browser");
    for (const tag of domainTags(input.browserUrl)) {
      tags.add(tag);
    }
  }

  for (const tag of surfaceTypeTags(input.browserSurfaceType)) {
    tags.add(tag);
  }

  return [...tags];
}

export function countsTowardWorkHours(tags) {
  if (tags.length === 0) {
    return true;
  }

  return !tags.some((tag) => NON_WORK_TAGS.includes(tag));
}

export function getNonWorkReason(tags) {
  if (tags.includes("social-media")) {
    return "social-media";
  }

  if (tags.includes("entertainment")) {
    return "entertainment";
  }

  if (tags.includes("gaming")) {
    return "gaming";
  }

  return null;
}
