/**
 * Single source of truth for whether Ask AI chat should be routed to the
 * local Claude Code daemon instead of running in-process.
 *
 * Triggered when AI_PROVIDER=claude-code-daemon.
 */
export function shouldUseDaemonForChat(): boolean {
  return process.env.AI_PROVIDER?.trim().toLowerCase() === "claude-code-daemon";
}
