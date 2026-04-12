#!/usr/bin/env node
import { runAuthLogin } from "./commands/auth-login.mjs";
import { runInstallSkill } from "./commands/install-skill.mjs";
import { runSaveAiNote } from "./commands/save-ai-note.mjs";
import { runDaemon } from "./daemon.mjs";

const args = process.argv.slice(2);
const [command, subcommand, ...rest] = args;

async function main() {
  if (!command || command.startsWith("--")) {
    await runDaemon(args);
    return;
  }

  if (command === "daemon") {
    await runDaemon([subcommand, ...rest].filter(Boolean));
    return;
  }

  if (command === "auth" && subcommand === "login") {
    await runAuthLogin(rest);
    return;
  }

  if (command === "save-ai-note") {
    await runSaveAiNote([subcommand, ...rest].filter(Boolean));
    return;
  }

  if (command === "install-skill") {
    await runInstallSkill();
    return;
  }

  throw new Error(`Unknown command: ${args.join(" ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
