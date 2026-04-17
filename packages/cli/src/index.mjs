#!/usr/bin/env node
import { runAuthLogin } from "./commands/auth-login.mjs";
import { runInstallSkill } from "./commands/install-skill.mjs";
import { runSaveAiNote } from "./commands/save-ai-note.mjs";
import { runUsageReport } from "./commands/usage-report.mjs";
import { runDaemon } from "./daemon.mjs";
import { clearConfig } from "./config.mjs";

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

  if (command === "login") {
    await runAuthLogin(args.slice(1));
    return;
  }

  if (command === "logout") {
    await clearConfig();
    console.log("✓ Removed saved Knosi CLI credentials.");
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

  if (command === "usage" && subcommand === "report") {
    await runUsageReport(rest);
    return;
  }

  throw new Error(`Unknown command: ${args.join(" ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
