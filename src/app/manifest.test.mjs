import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";

test("web app manifest exposes installable icons", async () => {
  const { default: manifest } = await import("./manifest.ts");
  const result = manifest();

  assert.equal(result.display, "standalone");
  assert.ok(Array.isArray(result.icons), "manifest must define icons");
  assert.ok(result.icons.length >= 2, "manifest must expose installable icons");

  const iconSizes = new Set(result.icons.map((icon) => icon.sizes));
  const iconSources = new Set(result.icons.map((icon) => icon.src));
  assert.ok(iconSizes.has("192x192"), "manifest must include a 192x192 icon");
  assert.ok(iconSizes.has("512x512"), "manifest must include a 512x512 icon");
  assert.ok(iconSources.has("/pwa-192.png"), "manifest must reference the static 192x192 icon");
  assert.ok(iconSources.has("/pwa-512.png"), "manifest must reference the static 512x512 icon");
  assert.ok(iconSources.has("/apple-icon.png"), "manifest must reference the static apple icon");
});

test("legacy public manifest does not override the generated app manifest", async () => {
  const legacyManifestPath = path.resolve(import.meta.dirname, "../../public/manifest.webmanifest");

  await assert.rejects(
    access(legacyManifestPath),
    "public/manifest.webmanifest should not exist because it overrides src/app/manifest.ts",
  );
});

test("static manifest icons exist in public assets", async () => {
  const publicAssets = ["../../public/pwa-192.png", "../../public/pwa-512.png", "../../public/apple-icon.png"];

  await Promise.all(publicAssets.map((assetPath) => access(path.resolve(import.meta.dirname, assetPath))));
});
