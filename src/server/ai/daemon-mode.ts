/**
 * @deprecated Phase 4.10: daemon dispatch is now decided per-user inside
 * `/api/chat` based on the resolved chat-role provider, not a global env
 * flag. This helper is kept temporarily for /api/config and the ask
 * landing page so the front-end transport stays "stream" by default.
 * Phase 7 removes the last call sites and this file along with them.
 */
export function shouldUseDaemonForChat(): boolean {
  return false;
}
