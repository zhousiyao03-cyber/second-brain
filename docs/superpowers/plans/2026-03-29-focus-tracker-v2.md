# Focus Tracker V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade focus tracker from single-signal sampler to multi-signal aggregator with AX API browser URL capture, CGWindowList multi-screen awareness, tag-based classification, and unified server-side data authority.

**Architecture:** Desktop collector gathers enriched samples (app + URL + visible windows) via AppleScript + Accessibility API + CGWindowList, sends raw un-merged sessions to server. Server handles all merging, tagging, and metrics. Desktop displays server data with local overlay for unsynced sessions.

**Tech Stack:** Rust/Tauri (desktop), macOS Accessibility API, Core Graphics, Next.js/TypeScript (server), Drizzle ORM/SQLite

**Spec:** `docs/superpowers/specs/2026-03-29-focus-tracker-v2-design.md`

---

## File Structure

### Desktop (focus-tracker/src-tauri/src/)

| File | Responsibility |
|------|---------------|
| `accessibility.rs` (NEW) | AX API: permission check, browser URL extraction |
| `window_list.rs` (NEW) | CGWindowList: visible windows per screen |
| `tracker.rs` (MODIFY) | Orchestrate all signals into EnrichedSample |
| `sessionizer.rs` (MODIFY) | WindowSample → EnrichedSample, lower thresholds |
| `outbox.rs` (MODIFY) | Remove pre-merge, pure append |
| `uploader.rs` (MODIFY) | Extended payload with new fields |
| `state.rs` (MODIFY) | Simplified metrics, server-first display |
| `lib.rs` (MODIFY) | Integrate new signals into collect loop |

### Server (src/)

| File | Responsibility |
|------|---------------|
| `server/focus/tags.ts` (NEW) | Tag system: autoTag, domainTags, appTags, countsTowardWorkHours |
| `server/db/schema.ts` (MODIFY) | New columns, category → tags migration |
| `server/focus/aggregates.ts` (MODIFY) | Use tags for work hours, pass tags through display sessions |
| `server/focus/categories.ts` (DELETE) | Replaced by tags.ts |
| `app/api/focus/ingest/route.ts` (MODIFY) | Accept new fields, call autoTag |
| `app/api/focus/status/route.ts` (MODIFY) | Return tags, browserUrl, contextApps |

---

## Task 1: Server — Tag System

Create `tags.ts` to replace the fixed category system with multi-label tags.

**Files:**
- Create: `src/server/focus/tags.ts`
- Test: `src/server/focus/__tests__/tags.test.ts`

- [ ] **Step 1: Write tests for domainTags**

```typescript
// src/server/focus/__tests__/tags.test.ts
import { describe, it, expect } from "vitest";
import { domainTags, appTags, autoTag, countsTowardWorkHours } from "../tags.js";

describe("domainTags", () => {
  it("tags github as git + coding", () => {
    expect(domainTags("https://github.com/user/repo/pull/42")).toEqual(
      expect.arrayContaining(["git", "coding"])
    );
  });

  it("tags gobyexample as golang + learning", () => {
    expect(domainTags("https://gobyexample.com/goroutines")).toEqual(
      expect.arrayContaining(["golang", "learning"])
    );
  });

  it("tags youtube as entertainment by default", () => {
    expect(domainTags("https://youtube.com/watch?v=abc")).toContain("entertainment");
  });

  it("tags stackoverflow as coding + reference", () => {
    expect(domainTags("https://stackoverflow.com/questions/123")).toEqual(
      expect.arrayContaining(["coding", "reference"])
    );
  });

  it("tags google docs as docs + writing", () => {
    expect(domainTags("https://docs.google.com/document/d/abc")).toEqual(
      expect.arrayContaining(["docs", "writing"])
    );
  });

  it("tags google meet as meeting", () => {
    expect(domainTags("https://meet.google.com/abc-def")).toContain("meeting");
  });

  it("tags gmail as communication", () => {
    expect(domainTags("https://mail.google.com/mail/u/0")).toContain("communication");
  });

  it("returns empty array for unknown domains", () => {
    expect(domainTags("https://random-site.example.com")).toEqual([]);
  });
});

describe("appTags", () => {
  it("tags VS Code as editor + coding", () => {
    expect(appTags("Visual Studio Code")).toEqual(
      expect.arrayContaining(["editor", "coding"])
    );
  });

  it("tags Ghostty as terminal + coding", () => {
    expect(appTags("Ghostty")).toEqual(
      expect.arrayContaining(["terminal", "coding"])
    );
  });

  it("tags Figma as design", () => {
    expect(appTags("Figma")).toContain("design");
  });

  it("tags Zoom as meeting", () => {
    expect(appTags("Zoom")).toContain("meeting");
  });

  it("tags Slack as communication", () => {
    expect(appTags("Slack")).toContain("communication");
  });

  it("returns empty for unknown apps", () => {
    expect(appTags("SomeRandomApp")).toEqual([]);
  });
});

describe("autoTag", () => {
  it("combines browser URL tags with app tags", () => {
    const tags = autoTag({
      appName: "Google Chrome",
      windowTitle: "GitHub",
      browserUrl: "https://github.com/user/repo",
    });
    expect(tags).toContain("browser");
    expect(tags).toContain("git");
    expect(tags).toContain("coding");
  });

  it("falls back to app tags when no URL", () => {
    const tags = autoTag({
      appName: "Visual Studio Code",
      windowTitle: "index.ts",
      browserUrl: null,
    });
    expect(tags).toContain("editor");
    expect(tags).toContain("coding");
    expect(tags).not.toContain("browser");
  });

  it("deduplicates tags", () => {
    const tags = autoTag({
      appName: "Google Chrome",
      windowTitle: "GitHub",
      browserUrl: "https://github.com/user/repo",
    });
    const uniqueTags = [...new Set(tags)];
    expect(tags).toEqual(uniqueTags);
  });
});

describe("countsTowardWorkHours", () => {
  it("returns true for coding tags", () => {
    expect(countsTowardWorkHours(["editor", "coding"])).toBe(true);
  });

  it("returns false for entertainment", () => {
    expect(countsTowardWorkHours(["browser", "entertainment"])).toBe(false);
  });

  it("returns false for social-media", () => {
    expect(countsTowardWorkHours(["browser", "social-media"])).toBe(false);
  });

  it("returns true for empty tags", () => {
    expect(countsTowardWorkHours([])).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bytedance/second-brain && pnpm vitest run src/server/focus/__tests__/tags.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement tags.ts**

```typescript
// src/server/focus/tags.ts

const NON_WORK_TAGS = ["entertainment", "social-media", "gaming"];

const DOMAIN_TAG_RULES: Array<{ pattern: RegExp; tags: string[] }> = [
  { pattern: /github\.com/, tags: ["git", "coding"] },
  { pattern: /gitlab\.com/, tags: ["git", "coding"] },
  { pattern: /stackoverflow\.com/, tags: ["coding", "reference"] },
  { pattern: /go\.dev|gobyexample\.com|pkg\.go\.dev/, tags: ["golang", "learning"] },
  { pattern: /docs\.rs|crates\.io/, tags: ["rust", "reference"] },
  { pattern: /npmjs\.com|nodejs\.org/, tags: ["javascript", "reference"] },
  { pattern: /developer\.mozilla\.org/, tags: ["reference"] },
  { pattern: /docs\.google\.com/, tags: ["docs", "writing"] },
  { pattern: /notion\.so/, tags: ["writing"] },
  { pattern: /meet\.google\.com/, tags: ["meeting"] },
  { pattern: /zoom\.us/, tags: ["meeting"] },
  { pattern: /mail\.google\.com|outlook\.live\.com/, tags: ["communication"] },
  { pattern: /youtube\.com/, tags: ["entertainment"] },
  { pattern: /twitter\.com|x\.com/, tags: ["social-media"] },
  { pattern: /reddit\.com/, tags: ["social-media"] },
  { pattern: /figma\.com/, tags: ["design"] },
  { pattern: /vercel\.com/, tags: ["coding", "deployment"] },
];

const APP_TAG_RULES: Array<{ pattern: RegExp; tags: string[] }> = [
  { pattern: /visual studio code|code|cursor/i, tags: ["editor", "coding"] },
  { pattern: /xcode/i, tags: ["editor", "coding"] },
  { pattern: /ghostty|iterm|terminal|warp/i, tags: ["terminal", "coding"] },
  { pattern: /figma|sketch|framer/i, tags: ["design"] },
  { pattern: /zoom/i, tags: ["meeting"] },
  { pattern: /google meet/i, tags: ["meeting"] },
  { pattern: /teams/i, tags: ["meeting"] },
  { pattern: /slack/i, tags: ["communication"] },
  { pattern: /discord/i, tags: ["communication"] },
  { pattern: /mail|outlook/i, tags: ["communication"] },
  { pattern: /wechat|feishu|lark/i, tags: ["communication"] },
  { pattern: /notion/i, tags: ["writing"] },
  { pattern: /postman|insomnia/i, tags: ["coding", "api-testing"] },
];

export function domainTags(url: string): string[] {
  const tags: string[] = [];
  for (const rule of DOMAIN_TAG_RULES) {
    if (rule.pattern.test(url)) {
      tags.push(...rule.tags);
    }
  }
  return [...new Set(tags)];
}

export function appTags(appName: string): string[] {
  const tags: string[] = [];
  for (const rule of APP_TAG_RULES) {
    if (rule.pattern.test(appName)) {
      tags.push(...rule.tags);
    }
  }
  return [...new Set(tags)];
}

export function autoTag(session: {
  appName: string;
  windowTitle: string | null;
  browserUrl?: string | null;
}): string[] {
  const tags: string[] = [];

  if (session.browserUrl) {
    tags.push("browser");
    tags.push(...domainTags(session.browserUrl));
  }

  tags.push(...appTags(session.appName));

  return [...new Set(tags)];
}

export function countsTowardWorkHours(tags: string[]): boolean {
  return !tags.some((tag) => NON_WORK_TAGS.includes(tag));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/second-brain && pnpm vitest run src/server/focus/__tests__/tags.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/focus/tags.ts src/server/focus/__tests__/tags.test.ts
git commit -m "feat(focus): add tag system replacing fixed categories"
```

---

## Task 2: Server — Schema Migration

Add new columns to `activitySessions`, migrate `category` → `tags`, update `focusDailySummaries`.

**Files:**
- Modify: `src/server/db/schema.ts:212-268`

- [ ] **Step 1: Update activitySessions schema**

In `src/server/db/schema.ts`, replace the `category` column and add new columns in the `activitySessions` table:

```typescript
// Replace this line:
    category: text("category"),
// With:
    tags: text("tags"), // JSON array of strings, nullable
    browserUrl: text("browser_url"),
    browserPageTitle: text("browser_page_title"),
    visibleApps: text("visible_apps"), // JSON array of strings, nullable
```

- [ ] **Step 2: Update focusDailySummaries schema**

In `src/server/db/schema.ts`, replace in the `focusDailySummaries` table:

```typescript
// Replace this line:
    categoryBreakdown: text("category_breakdown"),
// With:
    tagBreakdown: text("tag_breakdown"),
```

- [ ] **Step 3: Generate and apply migration**

Run:
```bash
cd /Users/bytedance/second-brain
pnpm db:generate
pnpm db:push
```

Expected: Migration generates successfully, schema applied to local DB.

- [ ] **Step 4: Fix all TypeScript references to old columns**

Search for all references to `category` and `categoryBreakdown` in focus-related files and update them. Key locations:
- `src/server/focus/aggregates.ts` — `FocusSessionRecord.category`, `categoryBreakdown`
- `src/app/api/focus/ingest/route.ts` — if any reference
- `src/app/api/focus/status/route.ts` — if any reference

- [ ] **Step 5: Verify build**

Run: `cd /Users/bytedance/second-brain && pnpm build`
Expected: No TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add src/server/db/schema.ts drizzle/
git commit -m "feat(focus): migrate schema from category to tags with new signal columns"
```

---

## Task 3: Server — Update Aggregates to Use Tags

Modify `aggregates.ts` to use the tag system instead of fixed categories.

**Files:**
- Modify: `src/server/focus/aggregates.ts`
- Modify: `src/server/focus/categories.ts` (delete after)

- [ ] **Step 1: Update FocusSessionRecord type**

In `src/server/focus/aggregates.ts`, replace the `category` field:

```typescript
// Replace:
  category: string | null;
// With:
  tags: string | null; // JSON array
  browserUrl: string | null;
  browserPageTitle: string | null;
  visibleApps: string | null; // JSON array
```

- [ ] **Step 2: Update imports — replace categories with tags**

```typescript
// Replace:
import {
  FOCUS_WORK_CATEGORIES,
  resolveFocusCategory,
} from "./categories.js";
// With:
import { autoTag, countsTowardWorkHours } from "./tags.js";
```

- [ ] **Step 3: Update buildDailyStats**

Replace the `categoryBreakdown` computation and `workHoursSecs` calculation in `buildDailyStats`:

```typescript
// Replace categoryBreakdown logic (lines 152-161) with:
  const tagBreakdown: Record<string, number> = {};
  let totalSecs = 0;
  let appSwitches = 0;
  let longestStreakSecs = 0;
  let currentStreakSecs = 0;

  for (const [index, slice] of slices.entries()) {
    totalSecs += slice.durationSecs;
    const tags = parseTags(slice.tags);
    for (const tag of tags) {
      tagBreakdown[tag] = (tagBreakdown[tag] ?? 0) + slice.durationSecs;
    }
    // ... rest of streak/appSwitch logic stays the same
```

Replace `workHoursSecs` calculation (lines 183-188):

```typescript
// Replace:
  const workHoursSecs = displaySessions.reduce((sum, session) => {
    const category = resolveFocusCategory(session);
    return FOCUS_WORK_CATEGORIES.includes(category as (typeof FOCUS_WORK_CATEGORIES)[number])
      ? sum + session.focusedSecs
      : sum;
  }, 0);
// With:
  const workHoursSecs = displaySessions.reduce((sum, session) => {
    const tags = parseTags(session.tags);
    return countsTowardWorkHours(tags) ? sum + session.focusedSecs : sum;
  }, 0);
```

Replace `categoryBreakdown` in the return value with `tagBreakdown`.

- [ ] **Step 4: Update sharesDisplayGroup to use tags**

```typescript
// Replace:
function sharesDisplayGroup(
  left: Pick<FocusSessionSlice, "appName" | "category">,
  right: Pick<FocusSessionSlice, "appName" | "category">
) {
  if (left.category && right.category && left.category === right.category) {
    return true;
  }
  return left.appName === right.appName;
}
// With:
function sharesDisplayGroup(
  left: Pick<FocusSessionSlice, "appName" | "tags">,
  right: Pick<FocusSessionSlice, "appName" | "tags">
) {
  const leftTags = parseTags(left.tags);
  const rightTags = parseTags(right.tags);
  if (leftTags.length > 0 && rightTags.length > 0) {
    const shared = leftTags.some((tag) => rightTags.includes(tag));
    if (shared) return true;
  }
  return left.appName === right.appName;
}
```

- [ ] **Step 5: Add parseTags helper**

```typescript
function parseTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 6: Update buildWeeklyStats return**

Replace `categoryBreakdown` with `tagBreakdown` in the `buildWeeklyStats` return object.

- [ ] **Step 7: Delete categories.ts**

```bash
rm src/server/focus/categories.ts
```

- [ ] **Step 8: Verify build**

Run: `cd /Users/bytedance/second-brain && pnpm build`
Expected: No TypeScript errors

- [ ] **Step 9: Commit**

```bash
git add src/server/focus/aggregates.ts src/server/focus/tags.ts
git rm src/server/focus/categories.ts
git commit -m "feat(focus): switch aggregates from categories to tag system"
```

---

## Task 4: Server — Update Ingest Endpoint

Accept new fields from desktop client and auto-tag on ingest.

**Files:**
- Modify: `src/app/api/focus/ingest/route.ts`

- [ ] **Step 1: Extend session schema**

```typescript
// Replace sessionSchema (lines 8-14):
const sessionSchema = z.object({
  sourceSessionId: z.string().trim().min(1),
  appName: z.string().trim().min(1),
  windowTitle: z.string().trim().nullable().optional(),
  browserUrl: z.string().trim().nullable().optional(),
  browserPageTitle: z.string().trim().nullable().optional(),
  visibleApps: z.array(z.string()).nullable().optional(),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date(),
});
```

- [ ] **Step 2: Add autoTag import**

```typescript
import { autoTag } from "@/server/focus/tags";
```

- [ ] **Step 3: Update insert/update to include new fields and tags**

In the existing session processing loop, after `durationSecs` calculation, add:

```typescript
    const tags = autoTag({
      appName: session.appName,
      windowTitle: session.windowTitle ?? null,
      browserUrl: session.browserUrl ?? null,
    });
    const tagsJson = JSON.stringify(tags);
    const visibleAppsJson = session.visibleApps
      ? JSON.stringify(session.visibleApps)
      : null;
```

Update the `db.update` set clause to include:

```typescript
        .set({
          appName: session.appName,
          windowTitle: session.windowTitle ?? null,
          browserUrl: session.browserUrl ?? null,
          browserPageTitle: session.browserPageTitle ?? null,
          visibleApps: visibleAppsJson,
          tags: tagsJson,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          durationSecs,
          ingestionStatus: "pending",
          ingestedAt: now,
          updatedAt: now,
        })
```

Update the `db.insert` values to include:

```typescript
      await db.insert(activitySessions).values({
        userId,
        sourceDeviceId: parsed.data.deviceId,
        sourceSessionId: session.sourceSessionId,
        appName: session.appName,
        windowTitle: session.windowTitle ?? null,
        browserUrl: session.browserUrl ?? null,
        browserPageTitle: session.browserPageTitle ?? null,
        visibleApps: visibleAppsJson,
        tags: tagsJson,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationSecs,
        ingestionStatus: "pending",
        ingestedAt: now,
      });
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/bytedance/second-brain && pnpm build`
Expected: No TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add src/app/api/focus/ingest/route.ts
git commit -m "feat(focus): accept rich signals and auto-tag on ingest"
```

---

## Task 5: Server — Update Status Endpoint

Return tags, browserUrl, and contextApps in display sessions.

**Files:**
- Modify: `src/app/api/focus/status/route.ts`

- [ ] **Step 1: Update displaySessions mapping**

Replace the `displaySessions` mapping (lines 114-124):

```typescript
    displaySessions: daily.displaySessions.map((session) => ({
      sourceSessionId: session.sourceSessionId,
      appName: session.appName,
      windowTitle: session.windowTitle,
      browserUrl: session.browserUrl,
      tags: parseTags(session.tags),
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt.toISOString(),
      durationSecs: session.durationSecs,
      focusedSecs: session.focusedSecs,
      spanSecs: session.spanSecs,
      interruptionCount: session.interruptionCount,
      contextApps: parseTags(session.visibleApps),
    })),
```

- [ ] **Step 2: Add parseTags helper at top of file**

```typescript
function parseTags(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 3: Update sessions mapping to include new fields**

```typescript
    sessions: daily.sessions.map((session) => ({
      sourceSessionId: session.sourceSessionId,
      appName: session.appName,
      windowTitle: session.windowTitle,
      browserUrl: session.browserUrl,
      tags: parseTags(session.tags),
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt.toISOString(),
      durationSecs: session.durationSecs,
    })),
```

- [ ] **Step 4: Replace categoryBreakdown in response if present**

Check if `daily.tagBreakdown` is returned (from Task 3 changes) and ensure the status response uses `tagBreakdown` instead of `categoryBreakdown`.

- [ ] **Step 5: Verify build**

Run: `cd /Users/bytedance/second-brain && pnpm build`
Expected: No TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add src/app/api/focus/status/route.ts
git commit -m "feat(focus): return tags and rich signals in status endpoint"
```

---

## Task 6: Desktop — Accessibility API Module

Create the macOS Accessibility API wrapper for browser URL extraction.

**Files:**
- Create: `focus-tracker/src-tauri/src/accessibility.rs`
- Modify: `focus-tracker/src-tauri/Cargo.toml`

- [ ] **Step 1: Add core-foundation and core-graphics dependencies**

In `focus-tracker/src-tauri/Cargo.toml`, add:

```toml
core-foundation = "0.10"
core-graphics = "0.24"
```

- [ ] **Step 2: Implement accessibility.rs**

```rust
// focus-tracker/src-tauri/src/accessibility.rs

use core_foundation::{
    base::{CFType, TCFType},
    string::{CFString, CFStringRef},
};
use std::ffi::c_void;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXUIElementCreateApplication(pid: i32) -> *mut c_void;
    fn AXUIElementCopyAttributeValue(
        element: *mut c_void,
        attribute: CFStringRef,
        value: *mut *mut c_void,
    ) -> i32;
}

const AX_ERROR_SUCCESS: i32 = 0;

pub fn is_accessibility_trusted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

pub fn get_browser_url(app_name: &str, pid: i32) -> Option<String> {
    if !is_browser(app_name) {
        return None;
    }
    if !is_accessibility_trusted() {
        return None;
    }

    unsafe { extract_browser_url(pid) }
}

fn is_browser(app_name: &str) -> bool {
    let lower = app_name.to_lowercase();
    matches!(
        lower.as_str(),
        "google chrome"
            | "safari"
            | "arc"
            | "firefox"
            | "brave browser"
            | "microsoft edge"
            | "chromium"
    )
}

unsafe fn extract_browser_url(pid: i32) -> Option<String> {
    let app = AXUIElementCreateApplication(pid);
    if app.is_null() {
        return None;
    }

    // Get focused window
    let window = get_ax_attribute(app, "AXFocusedWindow")?;

    // Try Chromium path: AXWindow → AXToolbar → AXTextField → AXValue
    if let Some(url) = extract_url_chromium(window) {
        release_ax(app);
        return Some(url);
    }

    // Try Safari path: AXWindow → AXGroup → AXTextField → AXValue
    if let Some(url) = extract_url_safari(window) {
        release_ax(app);
        return Some(url);
    }

    release_ax(app);
    None
}

unsafe fn extract_url_chromium(window: *mut c_void) -> Option<String> {
    // Navigate: window → children → find toolbar → children → find text field → value
    let children = get_ax_children(window)?;
    for child in &children {
        let role = get_ax_string_attribute(*child, "AXRole")?;
        if role == "AXToolbar" {
            let toolbar_children = get_ax_children(*child)?;
            for toolbar_child in &toolbar_children {
                let child_role = get_ax_string_attribute(*toolbar_child, "AXRole")?;
                if child_role == "AXTextField" {
                    return get_ax_string_attribute(*toolbar_child, "AXValue");
                }
            }
        }
    }
    None
}

unsafe fn extract_url_safari(window: *mut c_void) -> Option<String> {
    // Navigate: window → children → find group → children → find text field → value
    let children = get_ax_children(window)?;
    for child in &children {
        let role = get_ax_string_attribute(*child, "AXRole")?;
        if role == "AXGroup" {
            let group_children = get_ax_children(*child)?;
            for group_child in &group_children {
                let child_role = get_ax_string_attribute(*group_child, "AXRole")?;
                if child_role == "AXTextField" {
                    return get_ax_string_attribute(*group_child, "AXValue");
                }
            }
        }
    }
    None
}

unsafe fn get_ax_attribute(element: *mut c_void, name: &str) -> Option<*mut c_void> {
    let attr_name = CFString::new(name);
    let mut value: *mut c_void = std::ptr::null_mut();
    let result = AXUIElementCopyAttributeValue(
        element,
        attr_name.as_concrete_TypeRef(),
        &mut value,
    );
    if result == AX_ERROR_SUCCESS && !value.is_null() {
        Some(value)
    } else {
        None
    }
}

unsafe fn get_ax_string_attribute(element: *mut c_void, name: &str) -> Option<String> {
    let value = get_ax_attribute(element, name)?;
    let cf_string = CFString::wrap_under_create_rule(value as CFStringRef);
    Some(cf_string.to_string())
}

unsafe fn get_ax_children(element: *mut c_void) -> Option<Vec<*mut c_void>> {
    let value = get_ax_attribute(element, "AXChildren")?;
    let array = core_foundation::array::CFArray::<CFType>::wrap_under_create_rule(
        value as core_foundation::array::CFArrayRef,
    );
    let mut children = Vec::new();
    for i in 0..array.len() {
        let item = array.get(i);
        children.push(item.map(|v| v.as_CFTypeRef() as *mut c_void)).flatten()?;
    }
    Some(children)
}

unsafe fn release_ax(element: *mut c_void) {
    if !element.is_null() {
        core_foundation::base::CFRelease(element);
    }
}
```

> Note: The exact AX tree traversal will likely need debugging against real browser windows. The structure above is the documented Chromium/Safari pattern but may need adjustment for specific browser versions. The implementing agent should test against the actual running browser and adjust the tree navigation as needed.

- [ ] **Step 3: Add module declaration in lib.rs**

Add at the top of `focus-tracker/src-tauri/src/lib.rs`:

```rust
mod accessibility;
```

- [ ] **Step 4: Verify desktop build**

Run: `cd /Users/bytedance/second-brain/focus-tracker && cargo build`
Expected: Compiles without errors

- [ ] **Step 5: Commit**

```bash
git add focus-tracker/src-tauri/src/accessibility.rs focus-tracker/src-tauri/Cargo.toml
git commit -m "feat(focus): add accessibility API module for browser URL extraction"
```

---

## Task 7: Desktop — CGWindowList Module

Create the visible windows module using Core Graphics.

**Files:**
- Create: `focus-tracker/src-tauri/src/window_list.rs`

- [ ] **Step 1: Implement window_list.rs**

```rust
// focus-tracker/src-tauri/src/window_list.rs

use core_graphics::display::{
    kCGNullWindowID, kCGWindowListOptionOnScreenOnly, CGDisplay, CGWindowListCopyWindowInfo,
};
use core_foundation::{
    array::CFArray,
    base::TCFType,
    dictionary::CFDictionary,
    number::CFNumber,
    string::CFString,
};

#[derive(Debug, Clone)]
pub struct VisibleWindow {
    pub app_name: String,
    pub window_title: Option<String>,
    pub screen_index: u32,
    pub is_frontmost: bool,
}

pub fn get_visible_windows(frontmost_app: &str) -> Vec<VisibleWindow> {
    let mut windows = Vec::new();

    let screen_frames = get_screen_frames();
    let window_list = unsafe {
        CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID)
    };

    if window_list.is_null() {
        return windows;
    }

    let array = unsafe {
        CFArray::<CFDictionary<CFString, CFType>>::wrap_under_create_rule(window_list)
    };

    let owner_key = CFString::new("kCGWindowOwnerName");
    let name_key = CFString::new("kCGWindowName");
    let bounds_key = CFString::new("kCGWindowBounds");
    let layer_key = CFString::new("kCGWindowLayer");

    for i in 0..array.len() {
        let Some(dict) = array.get(i) else { continue };

        // Skip non-normal windows (layer != 0)
        if let Some(layer) = dict.find(&layer_key).and_then(|v| {
            let num = unsafe { CFNumber::wrap_under_get_rule(*v as _) };
            num.to_i32()
        }) {
            if layer != 0 {
                continue;
            }
        }

        let app_name = match dict.find(&owner_key) {
            Some(v) => unsafe { CFString::wrap_under_get_rule(*v as _).to_string() },
            None => continue,
        };

        let window_title = dict.find(&name_key).map(|v| {
            unsafe { CFString::wrap_under_get_rule(*v as _).to_string() }
        }).filter(|s| !s.is_empty());

        // Determine screen index from window bounds center point
        let screen_index = dict
            .find(&bounds_key)
            .and_then(|v| window_center_screen_index(v, &screen_frames))
            .unwrap_or(0);

        windows.push(VisibleWindow {
            is_frontmost: app_name == frontmost_app,
            app_name,
            window_title,
            screen_index,
        });
    }

    windows
}

fn get_screen_frames() -> Vec<core_graphics::geometry::CGRect> {
    let count = CGDisplay::active_display_count().unwrap_or(1);
    let mut display_ids = vec![0u32; count as usize];
    let mut actual_count = 0u32;
    unsafe {
        core_graphics::display::CGGetActiveDisplayList(
            count,
            display_ids.as_mut_ptr(),
            &mut actual_count,
        );
    }
    display_ids.truncate(actual_count as usize);
    display_ids
        .iter()
        .map(|id| CGDisplay::new(*id).bounds())
        .collect()
}

fn window_center_screen_index(
    _bounds_value: &core_foundation::base::CFType,
    screen_frames: &[core_graphics::geometry::CGRect],
) -> Option<u32> {
    // Parse CGRect from CFDictionary bounds value
    // Find which screen contains the center point
    // Return screen index
    // Fallback: return 0 (primary screen)
    Some(0) // Placeholder — the implementing agent should use CGRectMakeWithDictionaryRepresentation
}
```

> Note: The `window_center_screen_index` function needs `CGRectMakeWithDictionaryRepresentation` to parse the bounds dictionary. The implementing agent should complete this based on the Core Graphics API. If it proves complex, defaulting all windows to screen 0 is an acceptable first pass.

- [ ] **Step 2: Add module declaration in lib.rs**

Add at the top of `focus-tracker/src-tauri/src/lib.rs`:

```rust
mod window_list;
```

- [ ] **Step 3: Verify desktop build**

Run: `cd /Users/bytedance/second-brain/focus-tracker && cargo build`
Expected: Compiles without errors

- [ ] **Step 4: Commit**

```bash
git add focus-tracker/src-tauri/src/window_list.rs
git commit -m "feat(focus): add CGWindowList module for multi-screen window tracking"
```

---

## Task 8: Desktop — Update Sessionizer with EnrichedSample and Lower Thresholds

Replace `WindowSample` with `EnrichedSample` and lower all thresholds.

**Files:**
- Modify: `focus-tracker/src-tauri/src/sessionizer.rs`

- [ ] **Step 1: Update the data model**

Replace `WindowSample` (lines 9-13):

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EnrichedSample {
    pub app_name: String,
    pub window_title: Option<String>,
    pub browser_url: Option<String>,
    pub browser_page_title: Option<String>,
    pub visible_apps: Vec<String>,
}
```

Extend `QueuedSession` (lines 17-25):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedSession {
    pub source_session_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
    pub browser_url: Option<String>,
    pub browser_page_title: Option<String>,
    pub visible_apps: Vec<String>,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub duration_secs: i64,
}
```

Extend `ActiveSession` to carry the new fields:

```rust
#[derive(Debug, Clone)]
struct ActiveSession {
    source_session_id: String,
    app_name: String,
    window_title: Option<String>,
    browser_url: Option<String>,
    browser_page_title: Option<String>,
    visible_apps: Vec<String>,
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
}
```

Update `PendingSwitch` to use `EnrichedSample`:

```rust
#[derive(Debug, Clone)]
struct PendingSwitch {
    sample: EnrichedSample,
    started_at: DateTime<Utc>,
}
```

- [ ] **Step 2: Lower thresholds**

```rust
const SWITCH_CONFIRMATION_SECS: i64 = 3;   // was 10
const MIN_SESSION_SECS: i64 = 5;            // was 30
const LOW_PRIORITY_IGNORE_SECS: i64 = 30;   // was 120
```

Note: `idle_threshold_secs` is passed to `FocusSessionizer::new()` from `lib.rs`. Update the constant `SAMPLE_IDLE_THRESHOLD_SECS` in `lib.rs` from `1_800` to `180`.

- [ ] **Step 3: Update observe method signature**

Change `observe` to accept `EnrichedSample` instead of `WindowSample`:

```rust
pub fn observe(
    &mut self,
    sample: Option<EnrichedSample>,
    observed_at: DateTime<Utc>,
    idle_secs: i64,
) -> Option<QueuedSession> {
```

The same-window comparison should still use `app_name` + `window_title` (not URL, since URL changes within same tab don't mean a window switch):

```rust
let same_window =
    current.app_name == sample.app_name && current.window_title == sample.window_title;
```

- [ ] **Step 4: Update ActiveSession creation to carry new fields**

In `observe_without_active` and `observe_with_active`, when creating `ActiveSession`, include:

```rust
ActiveSession {
    source_session_id: create_source_session_id(&sample, pending.started_at),
    app_name: sample.app_name,
    window_title: sample.window_title,
    browser_url: sample.browser_url,
    browser_page_title: sample.browser_page_title,
    visible_apps: sample.visible_apps,
    started_at: pending.started_at,
    ended_at: observed_at,
}
```

- [ ] **Step 5: Update flush and current_session_at to include new fields in QueuedSession**

In `flush()`:

```rust
self.finalize_closed(QueuedSession {
    source_session_id: current.source_session_id,
    app_name: current.app_name,
    window_title: current.window_title,
    browser_url: current.browser_url,
    browser_page_title: current.browser_page_title,
    visible_apps: current.visible_apps,
    started_at: current.started_at,
    ended_at,
    duration_secs,
})
```

Same pattern for `current_session_at()` and the `closed` session in `observe_with_active()`.

- [ ] **Step 6: Update tests**

Update all test helper calls to use `EnrichedSample` instead of `WindowSample`:

```rust
Some(EnrichedSample {
    app_name: "Visual Studio Code".into(),
    window_title: Some("auth.ts - second-brain".into()),
    browser_url: None,
    browser_page_title: None,
    visible_apps: vec![],
})
```

- [ ] **Step 7: Verify desktop build and tests**

Run:
```bash
cd /Users/bytedance/second-brain/focus-tracker
cargo test
cargo build
```
Expected: All tests pass, build succeeds

- [ ] **Step 8: Commit**

```bash
git add focus-tracker/src-tauri/src/sessionizer.rs
git commit -m "feat(focus): upgrade to EnrichedSample and lower tracking thresholds"
```

---

## Task 9: Desktop — Remove Pre-Merging from Outbox

Simplify outbox to pure append with deduplication.

**Files:**
- Modify: `focus-tracker/src-tauri/src/outbox.rs`

- [ ] **Step 1: Remove merge logic**

Delete these functions entirely:
- `should_merge_sessions()` (lines 65-80)
- `is_mergeable_task_group()` (lines 82-84)
- `push_or_merge_session()` — replace with simple append

Replace `push_or_merge_session` calls in `record_session` with:

```rust
pub fn record_session(&mut self, session: QueuedSession) {
    append_dedupe(&mut self.recent_sessions, session.clone());
    if self.recent_sessions.len() > MAX_RECENT_SESSIONS {
        let excess = self.recent_sessions.len() - MAX_RECENT_SESSIONS;
        self.recent_sessions.drain(0..excess);
    }
    append_dedupe(&mut self.queued_sessions, session);
}
```

```rust
fn append_dedupe(target: &mut Vec<QueuedSession>, session: QueuedSession) {
    if target
        .iter()
        .any(|existing| existing.source_session_id == session.source_session_id)
    {
        return;
    }
    target.push(session);
}
```

- [ ] **Step 2: Keep task_group and counts_toward_work_hours for offline fallback only**

Keep `task_group()` and `counts_toward_work_hours()` — they are still used by `state.rs` for offline metrics. No changes needed to these functions.

- [ ] **Step 3: Update test helper and tests**

First, update the `session()` test helper to include new QueuedSession fields:

```rust
fn session(
    id: &str,
    app_name: &str,
    window_title: Option<&str>,
    started_at: &str,
    ended_at: &str,
) -> QueuedSession {
    let started = chrono::DateTime::parse_from_rfc3339(started_at)
        .expect("valid start")
        .with_timezone(&Utc);
    let ended = chrono::DateTime::parse_from_rfc3339(ended_at)
        .expect("valid end")
        .with_timezone(&Utc);
    QueuedSession {
        source_session_id: id.into(),
        app_name: app_name.into(),
        window_title: window_title.map(str::to_string),
        browser_url: None,
        browser_page_title: None,
        visible_apps: vec![],
        started_at: started,
        ended_at: ended,
        duration_secs: (ended - started).num_seconds(),
    }
}
```

Then update the merge tests to reflect new behavior:
- `merges_adjacent_same_app_sessions` → should now produce 2 sessions (no merge)
- `merges_adjacent_coding_workflow_sessions` → should now produce 2 sessions (no merge)
- `keeps_distinct_sessions_when_gap_is_large` → should still produce 2 sessions (unchanged)

```rust
#[test]
fn appends_same_app_sessions_without_merging() {
    let mut outbox = OutboxState::default();
    outbox.record_session(session(
        "session-a", "Visual Studio Code", Some("index.ts"),
        "2026-03-29T09:00:00Z", "2026-03-29T09:20:00Z",
    ));
    outbox.record_session(session(
        "session-b", "Visual Studio Code", Some("index.ts"),
        "2026-03-29T09:21:00Z", "2026-03-29T09:40:00Z",
    ));
    assert_eq!(outbox.queued_sessions.len(), 2);
}

#[test]
fn appends_different_app_sessions_without_merging() {
    let mut outbox = OutboxState::default();
    outbox.record_session(session(
        "session-a", "Visual Studio Code", Some("index.ts"),
        "2026-03-29T09:00:00Z", "2026-03-29T09:20:00Z",
    ));
    outbox.record_session(session(
        "session-b", "Google Chrome", Some("Next.js docs"),
        "2026-03-29T09:20:30Z", "2026-03-29T09:35:00Z",
    ));
    assert_eq!(outbox.queued_sessions.len(), 2);
}

#[test]
fn deduplicates_by_source_session_id() {
    let mut outbox = OutboxState::default();
    outbox.record_session(session(
        "session-a", "Visual Studio Code", Some("index.ts"),
        "2026-03-29T09:00:00Z", "2026-03-29T09:20:00Z",
    ));
    outbox.record_session(session(
        "session-a", "Visual Studio Code", Some("index.ts"),
        "2026-03-29T09:00:00Z", "2026-03-29T09:20:00Z",
    ));
    assert_eq!(outbox.queued_sessions.len(), 1);
}
```

- [ ] **Step 4: Verify desktop build and tests**

Run:
```bash
cd /Users/bytedance/second-brain/focus-tracker
cargo test
cargo build
```
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add focus-tracker/src-tauri/src/outbox.rs
git commit -m "feat(focus): remove client-side pre-merging, pure append outbox"
```

---

## Task 10: Desktop — Update Uploader Payload

Extend upload payload with new fields.

**Files:**
- Modify: `focus-tracker/src-tauri/src/uploader.rs`

- [ ] **Step 1: Update IngestPayload session serialization**

The `QueuedSession` struct already has the new fields from Task 8, and it derives `Serialize` with `camelCase`. Since the server now accepts these nullable fields, the upload will automatically include them.

Verify the `QueuedSession` serialization produces the expected JSON by checking the existing test:

Update the test in `uploader.rs` (lines 59-101):

```rust
#[test]
fn serializes_sessions_using_camel_case_api_fields() {
    let sessions = vec![QueuedSession {
        source_session_id: "session-1".into(),
        app_name: "Google Chrome".into(),
        window_title: Some("Go by Example".into()),
        browser_url: Some("https://gobyexample.com/goroutines".into()),
        browser_page_title: Some("Go by Example: Goroutines".into()),
        visible_apps: vec!["Visual Studio Code".into(), "Ghostty".into()],
        started_at: Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 0).unwrap(),
        ended_at: Utc.with_ymd_and_hms(2026, 3, 29, 10, 0, 0).unwrap(),
        duration_secs: 3600,
    }];

    let payload = serde_json::to_value(IngestPayload {
        device_id: "device-1",
        time_zone: "Asia/Singapore",
        sessions: &sessions,
    })
    .expect("payload should serialize");

    assert_eq!(
        payload,
        json!({
            "deviceId": "device-1",
            "timeZone": "Asia/Singapore",
            "sessions": [{
                "sourceSessionId": "session-1",
                "appName": "Google Chrome",
                "windowTitle": "Go by Example",
                "browserUrl": "https://gobyexample.com/goroutines",
                "browserPageTitle": "Go by Example: Goroutines",
                "visibleApps": ["Visual Studio Code", "Ghostty"],
                "startedAt": "2026-03-29T09:00:00Z",
                "endedAt": "2026-03-29T10:00:00Z",
                "durationSecs": 3600
            }]
        })
    );
}
```

- [ ] **Step 2: Verify desktop build and tests**

Run:
```bash
cd /Users/bytedance/second-brain/focus-tracker
cargo test
cargo build
```
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add focus-tracker/src-tauri/src/uploader.rs
git commit -m "feat(focus): verify enriched session upload payload"
```

---

## Task 11: Desktop — Simplify State Metrics (Server-First)

Simplify `state.rs` to use server data as primary source.

**Files:**
- Modify: `focus-tracker/src-tauri/src/state.rs`

- [ ] **Step 1: Update RemoteDisplaySession to include tags**

In `status_sync.rs`, add new fields to `RemoteDisplaySession`:

```rust
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDisplaySession {
    pub source_session_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
    pub browser_url: Option<String>,
    pub tags: Option<Vec<String>>,
    pub started_at: String,
    pub ended_at: String,
    pub duration_secs: i64,
    pub focused_secs: i64,
    pub span_secs: i64,
    pub interruption_count: i64,
    pub context_apps: Option<Vec<String>>,
}
```

- [ ] **Step 2: Simplify merged_sessions_for_display**

Replace the current dual-source merge logic (lines 244-268) with:

```rust
fn merged_sessions_for_display(
    state: &RuntimeState,
    current_session: Option<QueuedSession>,
    now: DateTime<Utc>,
) -> Vec<QueuedSession> {
    let mut sessions = state.outbox.recent_sessions.clone();
    if let Some(current) = current_session {
        if !sessions.iter().any(|s| s.source_session_id == current.source_session_id) {
            sessions.push(current);
        }
    }
    sessions
}
```

This removes the dual-source merge. When a server snapshot exists, the `timeline_for_today` and `metrics_for_today` functions already prefer server data (lines 173-194 and 208-226). This function is now only used as offline fallback.

- [ ] **Step 3: Simplify local_overlay_sessions**

The existing `local_overlay_sessions` (lines 283-313) only looks at `queued_sessions` and `current_session`. This is correct — it adds sessions not yet in the server snapshot. Keep this function as-is but verify it handles the new `QueuedSession` fields (it does, since it clones the whole struct).

- [ ] **Step 4: Update state tests**

Update all `QueuedSession` and `WindowSample` references in state.rs tests to use the new struct fields:

For all `QueuedSession` instantiations in tests, add:
```rust
browser_url: None,
browser_page_title: None,
visible_apps: vec![],
```

For all `WindowSample` references (now `EnrichedSample`):
```rust
EnrichedSample {
    app_name: "Google Chrome".into(),
    window_title: Some("Focus dashboard".into()),
    browser_url: None,
    browser_page_title: None,
    visible_apps: vec![],
}
```

- [ ] **Step 5: Verify desktop build and tests**

Run:
```bash
cd /Users/bytedance/second-brain/focus-tracker
cargo test
cargo build
```
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add focus-tracker/src-tauri/src/state.rs focus-tracker/src-tauri/src/status_sync.rs
git commit -m "feat(focus): simplify state to server-first metrics display"
```

---

## Task 12: Desktop — Integrate Signals into Collect Loop

Wire the new signal sources into the main sampling loop.

**Files:**
- Modify: `focus-tracker/src-tauri/src/lib.rs`
- Modify: `focus-tracker/src-tauri/src/tracker.rs`

- [ ] **Step 1: Update tracker.rs — add frontmost PID retrieval**

Add a function to get the PID of the frontmost app (needed for AX API):

```rust
pub fn get_frontmost_pid() -> Option<i32> {
    run_applescript(
        r#"tell application "System Events" to get unix id of (first application process whose frontmost is true)"#,
    )
    .ok()
    .and_then(|value| value.parse::<i32>().ok())
}
```

- [ ] **Step 2: Update tracker.rs — add get_enriched_sample**

```rust
use crate::accessibility;
use crate::window_list;
use crate::sessionizer::EnrichedSample;

pub fn get_enriched_sample() -> Option<EnrichedSample> {
    let app_name = run_applescript(
        r#"tell application "System Events" to get name of first application process whose frontmost is true"#,
    )
    .ok()?;

    if app_name.is_empty() {
        return None;
    }

    let window_title = run_applescript(
        r#"tell application "System Events" to get name of front window of (first application process whose frontmost is true)"#,
    )
    .ok()
    .filter(|value| !value.is_empty());

    let pid = get_frontmost_pid();
    let browser_url = pid.and_then(|p| accessibility::get_browser_url(&app_name, p));

    // Use browser URL's page title if available, otherwise None
    let browser_page_title = if browser_url.is_some() {
        window_title.clone().map(|t| {
            // Strip " - Google Chrome" / " - Safari" suffix from window title
            t.rsplit_once(" - ")
                .map(|(page, _app)| page.to_string())
                .unwrap_or(t)
        })
    } else {
        None
    };

    let visible_windows = window_list::get_visible_windows(&app_name);
    let visible_apps: Vec<String> = visible_windows
        .iter()
        .filter(|w| !w.is_frontmost && w.app_name != app_name)
        .map(|w| w.app_name.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    Some(EnrichedSample {
        app_name,
        window_title,
        browser_url,
        browser_page_title,
        visible_apps,
    })
}
```

- [ ] **Step 3: Update lib.rs collect loop**

In `lib.rs`, find the `collect_once_inner` function (or equivalent sampling call). Replace `get_active_window_sample()` with `get_enriched_sample()`:

```rust
// Replace:
let sample = get_active_window_sample();
// With:
let sample = tracker::get_enriched_sample();
```

Also update `SAMPLE_IDLE_THRESHOLD_SECS` from `1_800` to `180`.

- [ ] **Step 4: Update lib.rs imports**

Replace any imports of `WindowSample` with `EnrichedSample`. Remove the import of `get_active_window_sample` if it's no longer called directly (it may still be called by `get_enriched_sample` internally).

- [ ] **Step 5: Verify desktop build**

Run:
```bash
cd /Users/bytedance/second-brain/focus-tracker
cargo build
```
Expected: Compiles without errors

- [ ] **Step 6: Manual test — run the app**

Run: `cd /Users/bytedance/second-brain/focus-tracker && cargo tauri dev`
- Open Chrome, navigate to github.com
- Check console/logs for browser_url being captured
- Open a secondary screen app, verify visible_apps populated
- Verify tray icon still updates correctly

- [ ] **Step 7: Commit**

```bash
git add focus-tracker/src-tauri/src/tracker.rs focus-tracker/src-tauri/src/lib.rs
git commit -m "feat(focus): integrate AX API and CGWindowList into collect loop"
```

---

## Task 13: End-to-End Verification

Verify the complete pipeline works from desktop collection to server display.

**Files:** None (verification only)

- [ ] **Step 1: Server build check**

Run:
```bash
cd /Users/bytedance/second-brain
pnpm build
```
Expected: No errors

- [ ] **Step 2: Server lint check**

Run:
```bash
cd /Users/bytedance/second-brain
pnpm lint
```
Expected: No errors

- [ ] **Step 3: Desktop build and test**

Run:
```bash
cd /Users/bytedance/second-brain/focus-tracker
cargo test
cargo build
```
Expected: All tests pass, build succeeds

- [ ] **Step 4: Manual end-to-end test**

1. Start the web server: `cd /Users/bytedance/second-brain && pnpm dev`
2. Start the desktop app: `cd /Users/bytedance/second-brain/focus-tracker && cargo tauri dev`
3. Use the computer normally for 5 minutes — switch between:
   - VS Code (coding)
   - Chrome with github.com (should capture URL)
   - Ghostty (terminal)
   - A secondary screen app
4. Check the web dashboard — verify:
   - Sessions appear with browser URLs
   - Tags are assigned (not categories)
   - Work hours use exclusion-based calculation
   - No double-merging artifacts
   - Desktop tray numbers match web dashboard

- [ ] **Step 5: Commit all remaining changes**

```bash
git add -A
git commit -m "feat(focus): complete focus tracker v2 signal hub upgrade"
```
