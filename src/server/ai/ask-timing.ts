/**
 * Ad-hoc latency instrumentation for the Ask AI request path.
 *
 * Off by default; turn on by setting ASK_TIMING=1 in the runtime environment
 * (e.g. `ASK_TIMING=1 pnpm dev` locally, or add to the Hetzner deployment env
 * for a production capture). When off, every call is a no-op so there is no
 * runtime cost.
 *
 * Output format (one line per request):
 *   [ask-timing] <label> seg1=12ms seg2=345ms total=400ms extra=value
 */

const ENABLED = process.env.ASK_TIMING === "1";

type Extra = Record<string, string | number | boolean | null | undefined>;

export interface AskTimer {
  mark: (name: string) => void;
  end: (extra?: Extra) => void;
}

const NOOP_TIMER: AskTimer = {
  mark: () => undefined,
  end: () => undefined,
};

export function startAskTimer(label: string): AskTimer {
  if (!ENABLED) return NOOP_TIMER;

  const t0 = Date.now();
  let last = t0;
  const segments: Array<[string, number]> = [];

  return {
    mark(name: string) {
      const now = Date.now();
      segments.push([name, now - last]);
      last = now;
    },
    end(extra: Extra = {}) {
      const total = Date.now() - t0;
      const segStr = segments.map(([k, v]) => `${k}=${v}ms`).join(" ");
      const extraStr = Object.entries(extra)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      const parts = [`[ask-timing]`, label, segStr, extraStr, `total=${total}ms`]
        .filter(Boolean)
        .join(" ");
      console.info(parts);
    },
  };
}
