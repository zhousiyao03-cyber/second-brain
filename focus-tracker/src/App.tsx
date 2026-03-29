import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./App.css";

type QueuedSession = {
  sourceSessionId: string;
  appName: string;
  windowTitle: string | null;
  startedAt: string;
  endedAt: string;
  durationSecs: number;
};

type TrackerStatus = {
  deviceId: string;
  trackingEnabled: boolean;
  queuedCount: number;
  baseUrl: string;
  apiKeyPresent: boolean;
  timeZone: string;
  sampleIntervalSecs: number;
  todayFocusedSecs: number;
  todayWorkSecs: number;
  todayGoalSecs: number;
  timelineSegments: TimelineSegment[];
  currentSession: QueuedSession | null;
  lastUploadAt: string | null;
  lastUploadMessage: string | null;
};

type TimelineSegment = {
  sourceSessionId: string;
  appName: string;
  windowTitle: string | null;
  startedAt: string;
  endedAt: string;
  startOffsetSecs: number;
  durationSecs: number;
  spanSecs: number;
  interruptionCount: number;
};

const DEFAULT_BASE_URL = "https://second-brain-self-alpha.vercel.app";
const DAY_SECS = 24 * 60 * 60;

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 0) {
    return `${remainingMinutes}m`;
  }

  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
}

function formatRemainingGoal(workSecs: number, goalSecs: number) {
  const remaining = Math.max(goalSecs - workSecs, 0);
  return remaining === 0 ? "8h goal reached" : `${formatDuration(remaining)} left to 8h`;
}

function formatProgressLabel(progress: number) {
  return progress >= 100 ? "8h reached today" : `${progress}% of 8h`;
}

function appColor(appName: string) {
  const palette = [
    "#14b8a6",
    "#38bdf8",
    "#f59e0b",
    "#f97316",
    "#84cc16",
    "#fb7185",
  ];
  const seed = [...appName].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palette[seed % palette.length];
}

function getRecoveryGuidance(message: string, hasToken: boolean) {
  const lowered = message.toLowerCase();

  if (
    lowered.includes("desktop token is no longer valid") ||
    lowered.includes("unauthorized")
  ) {
    return "Generate a new pairing code in /focus, then reconnect this collector.";
  }

  if (lowered.includes("rate-limited") || lowered.includes("too many requests")) {
    return "Wait a few minutes before retrying pairing or upload.";
  }

  if (!hasToken) {
    return "Generate a pairing code in /focus and connect this collector once.";
  }

  return message;
}

function getTauriErrorMessage(caughtError: unknown, fallback: string) {
  if (typeof caughtError === "string" && caughtError.trim()) {
    return caughtError;
  }

  if (
    caughtError &&
    typeof caughtError === "object" &&
    "message" in caughtError &&
    typeof caughtError.message === "string" &&
    caughtError.message.trim()
  ) {
    return caughtError.message;
  }

  return fallback;
}

function App() {
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [pairingCode, setPairingCode] = useState("");
  const [busy, setBusy] = useState<"save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const progress = status
    ? Math.min(100, Math.round((status.todayWorkSecs / status.todayGoalSecs) * 100))
    : 0;
  const uploadMessage = status?.lastUploadMessage ?? "Syncing automatically";
  const uploadNeedsAttention =
    !status?.apiKeyPresent ||
    !status?.baseUrl ||
    uploadMessage.toLowerCase().includes("upload failed") ||
    uploadMessage.toLowerCase().includes("unauthorized") ||
    uploadMessage.toLowerCase().includes("desktop token is no longer valid") ||
    uploadMessage.toLowerCase().includes("rate-limited");
  const recoveryGuidance = getRecoveryGuidance(uploadMessage, Boolean(status?.apiKeyPresent));
  const currentLabel = status?.currentSession?.appName ?? "On track";
  const remainingGoalLabel = formatRemainingGoal(
    status?.todayWorkSecs ?? 0,
    status?.todayGoalSecs ?? 8 * 60 * 60
  );

  async function refreshStatus() {
    const next = await invoke<TrackerStatus>("get_status");
    setStatus(next);
  }

  async function runAction(action: () => Promise<TrackerStatus>) {
    setBusy("save");
    setError(null);
    try {
      const next = await action();
      setStatus(next);
      setShowSetup(false);
      setPairingCode("");
    } catch (caughtError) {
      setError(getTauriErrorMessage(caughtError, "Unknown Tauri error"));
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void refreshStatus().catch((caughtError) => {
      setError(getTauriErrorMessage(caughtError, "Failed to load status"));
    });
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshStatus().catch((caughtError) => {
        setError(getTauriErrorMessage(caughtError, "Failed to refresh status"));
      });
    }, 5_000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void invoke("hide_panel");
      }
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, []);

  useEffect(() => {
    void invoke("set_panel_expanded", {
      expanded: showSetup || uploadNeedsAttention,
    }).catch(() => {
      return undefined;
    });
  }, [showSetup, uploadNeedsAttention]);

  return (
    <main className="shell minimal-shell">
      <section className="hero compact">
        <div className="hero-copy">
          <p className="eyebrow">Working Hours</p>
          <h1>{formatDuration(status?.todayWorkSecs ?? 0)}</h1>
          <p className="lede">{remainingGoalLabel}</p>
          <p className="hero-subtle">
            {formatDuration(status?.todayFocusedSecs ?? 0)} focused · {currentLabel}
          </p>
        </div>
        <div className="hero-card compact">
          <div className="metric-label">8h Goal</div>
          <div className="metric-value">{progress}%</div>
          <div className="metric-subtle">{formatProgressLabel(progress)}</div>
        </div>
      </section>

      <section className="panel summary-panel">
        <div className="panel-topline">
          <div className="panel-meta">Today</div>
          <div className="inline-actions">
            <button
              className="text-button"
              disabled={!status?.baseUrl}
              onClick={() =>
                void openUrl(`${(status?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "")}/focus`)
              }
            >
              Open /focus
            </button>
            <button
              className="text-button subtle"
              type="button"
              onClick={() => setShowSetup((current) => !current)}
            >
              {showSetup ? "Hide setup" : status?.apiKeyPresent ? "Reconnect" : "Fix setup"}
            </button>
          </div>
        </div>

        <div className="summary-copy">
          <span>{formatDuration(status?.todayFocusedSecs ?? 0)} focused</span>
          <span>{remainingGoalLabel}</span>
        </div>

        <div className="progress-rail">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>

        <div className="timeline">
          <div className="timeline-header">
            <span>00</span>
            <span>08</span>
            <span>16</span>
            <span>24</span>
          </div>
          <div className="timeline-rail">
            {status?.timelineSegments.map((segment) => (
              <div
                key={segment.sourceSessionId}
                className="timeline-segment"
                style={{
                  left: `${(segment.startOffsetSecs / DAY_SECS) * 100}%`,
                  width: `${Math.max((segment.spanSecs / DAY_SECS) * 100, 0.8)}%`,
                  background: appColor(segment.appName),
                }}
                title={
                  segment.interruptionCount > 0
                    ? `${segment.appName} (${formatDuration(
                        segment.durationSecs
                      )} focused, ${segment.interruptionCount} interruption${
                        segment.interruptionCount > 1 ? "s" : ""
                      })`
                    : `${segment.appName} (${formatDuration(segment.durationSecs)})`
                }
              />
            ))}
          </div>
        </div>

        {uploadNeedsAttention ? (
          <p className="supporting-status warning">{recoveryGuidance}</p>
        ) : null}
      </section>

      {showSetup || uploadNeedsAttention ? (
        <section className="panel">
          <div className="section-header tight">
            <div>
              <h2>{uploadNeedsAttention ? "Attention needed" : "Desktop setup"}</h2>
              <p>
                {uploadNeedsAttention
                  ? recoveryGuidance
                  : "Reconnect this desktop or pair it to another environment."}
              </p>
            </div>
            <button
              className="ghost"
              type="button"
              onClick={() => setShowSetup(false)}
              disabled={!showSetup}
            >
              Close
            </button>
          </div>

          {showSetup ? (
            <>
              <div className="form-grid compact-form">
                <label>
                  <span>Pairing code</span>
                  <input
                    value={pairingCode}
                    onChange={(event) => setPairingCode(event.currentTarget.value.toUpperCase())}
                    placeholder="Paste the code from /focus"
                  />
                </label>
              </div>
              <div className="actions compact-actions">
                <button
                  className="accent"
                  disabled={busy !== null || !status?.baseUrl || !pairingCode.trim()}
                  onClick={() =>
                    runAction(() =>
                      invoke("pair_device", {
                        baseUrl: status?.baseUrl ?? DEFAULT_BASE_URL,
                        pairingCode,
                        deviceName: "MacBook Focus Tracker",
                        timeZone: browserTimeZone,
                      })
                    )
                  }
                >
                  {busy === "save" ? "Connecting..." : "Connect desktop"}
                </button>
              </div>
              <p className="metric-subtle">
                Generate a pairing code in `/focus`, paste it here once, and this desktop will connect automatically.
              </p>
            </>
          ) : null}
        </section>
      ) : null}

      {error ? <div className="callout error">{error}</div> : null}
    </main>
  );
}

export default App;
