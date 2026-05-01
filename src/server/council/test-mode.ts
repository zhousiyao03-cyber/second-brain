/**
 * Council deterministic test fixture.
 *
 * Activated when `COUNCIL_TEST_MODE=true`. Replaces real LLM calls in
 * classifier and persona-stream so e2e tests run without real network.
 *
 * Behavior:
 * - First reclassify pass after a user message: persona "AI 工程师" votes
 *   yes (priority 0.9), others vote no.
 * - After AI 工程师 has spoken, all subsequent reclassify passes vote no
 *   → triggers `consecutive_no` stop.
 * - persona stream yields a fixed string in 3 chunks.
 *
 * Note on test isolation: e2e tests run sequentially against the same
 * dev server, so call counters need to be resettable. We do that here by
 * tracking the count on the module level and exposing `resetFakeClassifyCount`.
 * If your e2e harness can't reset between tests, the deterministic shape
 * naturally repeats every (N persona × 1 yes-pass + 1 no-pass) sequence —
 * just use long-enough fixture strings.
 */
export const TEST_MODE = process.env.COUNCIL_TEST_MODE === "true";

let classifyCallCount = 0;

export function fakeClassify(personaName: string): {
  shouldSpeak: boolean;
  priority: number;
  reason: string;
} {
  classifyCallCount += 1;
  // First pass over 3 personas: AI 工程师 yes, others no.
  if (classifyCallCount <= 3) {
    if (personaName === "AI 工程师") {
      return { shouldSpeak: true, priority: 0.9, reason: "test-yes" };
    }
    return { shouldSpeak: false, priority: 0, reason: "test-no" };
  }
  // After AI 工程师 spoke, second reclassify pass — everyone says no.
  return { shouldSpeak: false, priority: 0, reason: "test-quiet" };
}

export function resetFakeClassifyCount() {
  classifyCallCount = 0;
}

export async function* fakeStream(): AsyncIterable<string> {
  yield "Test-mode response part 1. ";
  yield "Part 2. ";
  yield "Part 3.";
}
