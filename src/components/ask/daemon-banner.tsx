"use client";

// Phase 4.10 placeholder: original implementation queried the legacy
// billing.getAiProviderPreference procedure to decide whether to render.
// That procedure is gone (replaced by aiSettings.getRoleAssignments in
// Phase 6.1). Phase 7 will reinstate this banner reading the new
// chat-role assignment to detect the claude-code-daemon kind.
export function DaemonBanner() {
  return null;
}
