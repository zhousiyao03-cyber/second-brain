import test from "node:test";
import assert from "node:assert/strict";

import {
  appTags,
  autoTag,
  countsTowardWorkHours,
  domainTags,
} from "./tags.ts";

test("domainTags tags github as git + coding", () => {
  const tags = domainTags("https://github.com/user/repo/pull/42");
  assert.ok(tags.includes("git"));
  assert.ok(tags.includes("coding"));
});

test("domainTags tags gobyexample as golang + learning", () => {
  const tags = domainTags("https://gobyexample.com/goroutines");
  assert.ok(tags.includes("golang"));
  assert.ok(tags.includes("learning"));
});

test("domainTags tags youtube as entertainment by default", () => {
  assert.ok(domainTags("https://youtube.com/watch?v=abc").includes("entertainment"));
});

test("domainTags tags stackoverflow as coding + reference", () => {
  const tags = domainTags("https://stackoverflow.com/questions/123");
  assert.ok(tags.includes("coding"));
  assert.ok(tags.includes("reference"));
});

test("domainTags tags google docs as docs + writing", () => {
  const tags = domainTags("https://docs.google.com/document/d/abc");
  assert.ok(tags.includes("docs"));
  assert.ok(tags.includes("writing"));
});

test("domainTags tags google meet as meeting", () => {
  assert.ok(domainTags("https://meet.google.com/abc-def").includes("meeting"));
});

test("domainTags tags gmail as communication", () => {
  assert.ok(domainTags("https://mail.google.com/mail/u/0").includes("communication"));
});

test("domainTags returns empty array for unknown domains", () => {
  assert.deepEqual(domainTags("https://random-site.example.com"), []);
});

test("appTags tags VS Code as editor + coding", () => {
  const tags = appTags("Visual Studio Code");
  assert.ok(tags.includes("editor"));
  assert.ok(tags.includes("coding"));
});

test("appTags tags Ghostty as terminal + coding", () => {
  const tags = appTags("Ghostty");
  assert.ok(tags.includes("terminal"));
  assert.ok(tags.includes("coding"));
});

test("appTags tags Figma as design", () => {
  assert.ok(appTags("Figma").includes("design"));
});

test("appTags tags Zoom as meeting", () => {
  assert.ok(appTags("Zoom").includes("meeting"));
});

test("appTags tags Slack as communication", () => {
  assert.ok(appTags("Slack").includes("communication"));
});

test("appTags returns empty for unknown apps", () => {
  assert.deepEqual(appTags("SomeRandomApp"), []);
});

test("autoTag combines browser URL tags with app tags", () => {
  const tags = autoTag({
    appName: "Google Chrome",
    windowTitle: "GitHub",
    browserUrl: "https://github.com/user/repo",
  });

  assert.ok(tags.includes("browser"));
  assert.ok(tags.includes("git"));
  assert.ok(tags.includes("coding"));
});

test("autoTag falls back to app tags when no URL", () => {
  const tags = autoTag({
    appName: "Visual Studio Code",
    windowTitle: "index.ts",
    browserUrl: null,
  });

  assert.ok(tags.includes("editor"));
  assert.ok(tags.includes("coding"));
  assert.ok(!tags.includes("browser"));
});

test("autoTag deduplicates tags", () => {
  const tags = autoTag({
    appName: "Google Chrome",
    windowTitle: "GitHub",
    browserUrl: "https://github.com/user/repo",
  });

  assert.deepEqual(tags, [...new Set(tags)]);
});

test("countsTowardWorkHours returns true for coding tags", () => {
  assert.equal(countsTowardWorkHours(["editor", "coding"]), true);
});

test("countsTowardWorkHours returns false for entertainment", () => {
  assert.equal(countsTowardWorkHours(["browser", "entertainment"]), false);
});

test("countsTowardWorkHours returns false for social-media", () => {
  assert.equal(countsTowardWorkHours(["browser", "social-media"]), false);
});

test("countsTowardWorkHours returns true for empty tags", () => {
  assert.equal(countsTowardWorkHours([]), true);
});
