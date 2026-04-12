import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SKILL_TEMPLATE_PATH = new URL("../../templates/save-to-knosi/SKILL.md", import.meta.url);

export async function runInstallSkill() {
  const targetDir = path.join(os.homedir(), ".claude", "skills", "save-to-knosi");
  const targetPath = path.join(targetDir, "SKILL.md");
  const template = await readFile(SKILL_TEMPLATE_PATH, "utf8");

  await mkdir(targetDir, { recursive: true });
  await writeFile(targetPath, template, "utf8");

  console.log(`✓ Installed Claude Code skill at ${targetPath}`);
}
