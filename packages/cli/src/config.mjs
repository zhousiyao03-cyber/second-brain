import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CONFIG_DIR = path.join(os.homedir(), ".knosi");
const CONFIG_PATH = path.join(CONFIG_DIR, "cli.json");
const DEFAULT_BASE_URL = "https://www.knosi.xyz";

export function getConfigPath() {
  return CONFIG_PATH;
}

export function getDefaultBaseUrl() {
  return DEFAULT_BASE_URL;
}

export async function loadConfig() {
  try {
    const content = await readFile(CONFIG_PATH, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function saveConfig(config) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export async function updateConfig(patch) {
  const current = (await loadConfig()) ?? {};
  const next = { ...current, ...patch };
  await saveConfig(next);
  return next;
}

export async function clearConfig() {
  try {
    await unlink(CONFIG_PATH);
  } catch {
    // ignore cleanup failures
  }
}
