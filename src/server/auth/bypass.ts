/**
 * Single source of truth for "is AUTH_BYPASS active right now".
 *
 * Always false when NODE_ENV === "production". This is the safety net
 * against stale CI secrets / .env drift / accidental ConfigMap copies that
 * would otherwise turn a real deployment into a multi-tenant data exfil
 * endpoint. E2E test runs use NODE_ENV=test, dev uses NODE_ENV=development —
 * both still allow bypass.
 *
 * Lives in its own module (no @/lib/auth import) so unit tests can exercise
 * it without dragging next-auth into the test environment. request-session
 * re-exports the same function for backwards compat with the rest of the
 * codebase.
 */
export function isAuthBypassEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.AUTH_BYPASS === "true";
}
