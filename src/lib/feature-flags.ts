/**
 * Centralized feature flags.
 * Server-side flags read from process.env.
 * Client-side flags read from NEXT_PUBLIC_ prefixed env vars.
 *
 * Default visibility: Notes, Ask AI, Learning are ON (no flag needed).
 * Portfolio, OSS Projects, Focus Tracker, Token Usage are OFF by default.
 */

function envBool(key: string, defaultValue: boolean): boolean {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  return val === "true" || val === "1";
}

/** Server-side flags */
export const featureFlags = {
  tokenUsage: envBool("ENABLE_TOKEN_USAGE", false),
  portfolio: envBool("ENABLE_PORTFOLIO", false),
  ossProjects: envBool("ENABLE_OSS_PROJECTS", false),
  focusTracker: envBool("ENABLE_FOCUS_TRACKER", false),
} as const;

/**
 * Client-side flags (read NEXT_PUBLIC_ vars).
 * Call this in client components or pass from server as props.
 */
export const clientFeatureFlags = {
  tokenUsage: envBool("NEXT_PUBLIC_ENABLE_TOKEN_USAGE", false),
  portfolio: envBool("NEXT_PUBLIC_ENABLE_PORTFOLIO", false),
  ossProjects: envBool("NEXT_PUBLIC_ENABLE_OSS_PROJECTS", false),
  focusTracker: envBool("NEXT_PUBLIC_ENABLE_FOCUS_TRACKER", false),
} as const;

export type FeatureFlags = typeof featureFlags;
