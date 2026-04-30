"use client";

/**
 * Stub component reserved for Phase 2 (BYO per-user OpenAI key flow). The
 * MVP relies on the global `OPENAI_API_KEY` admin/self-host key, so this
 * component is intentionally not mounted anywhere yet — see spec §5.4.
 *
 * Keeping the file as a stub so the shape is locked in: when Phase 2
 * lands, implementing this means:
 *   1. wire it into ask surfaces under a "user-needs-byo-key" condition
 *   2. add a settings UI that writes the key to `users.openai_api_key`
 *      (encrypted at rest)
 *   3. swap the `provider/ai-sdk.ts:38` env read for a per-user lookup
 */

export interface ApiKeyPromptProps {
  /** Reserved — set to true once we detect a BYO-required state. */
  visible?: boolean;
}

export function ApiKeyPrompt(props: ApiKeyPromptProps): null {
  // Phase 2 will gate visibility on `props.visible`. For MVP we always
  // render null — touching the prop here keeps the parameter linted as
  // "used" without changing behavior.
  void props.visible;
  return null;
}
