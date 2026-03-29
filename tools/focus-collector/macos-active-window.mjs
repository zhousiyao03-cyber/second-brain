import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runAppleScript(script) {
  const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", script], {
    timeout: 5000,
  });
  return stdout.trim();
}

export async function getIdleSeconds() {
  const output = await runAppleScript('tell application "System Events" to get idle time');
  return Number.parseInt(output, 10) || 0;
}

export async function getActiveWindowSample() {
  const appName = await runAppleScript(
    'tell application "System Events" to get name of first application process whose frontmost is true'
  ).catch(() => "");

  if (!appName) {
    return null;
  }

  const windowTitle = await runAppleScript(
    'tell application "System Events" to get name of front window of (first application process whose frontmost is true)'
  ).catch(() => "");

  return {
    appName,
    windowTitle: windowTitle || null,
  };
}
