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

const DEFAULT_BASE_URL = "http://127.0.0.1:3200";
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

function App() {
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [pairingCode, setPairingCode] = useState("");
  const [busy, setBusy] = useState<"save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [copiedDeviceId, setCopiedDeviceId] = useState(false);
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
  const uploadLabel = !status?.apiKeyPresent
    ? "Setup required"
    : status?.lastUploadAt
      ? new Date(status.lastUploadAt).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })
      : "Syncing";
  const recoveryGuidance = getRecoveryGuidance(uploadMessage, Boolean(status?.apiKeyPresent));

  async function refreshStatus() {
    const next = await invoke<TrackerStatus>("get_status");
    setStatus(next);
    setBaseUrl(next.baseUrl);
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
      setError(
        caughtError instanceof Error ? caughtError.message : "Unknown Tauri error"
      );
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void refreshStatus().catch((caughtError) => {
      setError(
        caughtError instanceof Error ? caughtError.message : "Failed to load status"
      );
    });
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshStatus().catch((caughtError) => {
        setError(
          caughtError instanceof Error ? caughtError.message : "Failed to refresh status"
        );
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

  return (
    <main className="shell minimal-shell">
      <section className="hero compact">
        <div>
          <p className="eyebrow">Working Hours</p>
          <h1>{formatDuration(status?.todayWorkSecs ?? 0)}</h1>
          <p className="lede">
            Focused {formatDuration(status?.todayFocusedSecs ?? 0)}.{" "}
            {status?.trackingEnabled ? "Tracking is live." : "Tracking is paused."}{" "}
            {status?.currentSession?.appName ?? "Waiting for the next sample."}
          </p>
        </div>
        <div className="hero-card compact">
          <div className="metric-label">Today</div>
          <div className="metric-value">{progress}%</div>
          <div className="metric-subtle">
            {formatDuration(status?.todayGoalSecs ?? 0)} goal
          </div>
        </div>
      </section>

      <section className="panel summary-panel">
        <div className="section-header tight">
          <div>
            <h2>Today</h2>
            <p>
              Focused {formatDuration(status?.todayFocusedSecs ?? 0)}. Auto sampling
              every {status?.sampleIntervalSecs ?? 5}s
            </p>
          </div>
          <button
            className="ghost"
            disabled={!baseUrl}
            onClick={() => void openUrl(`${baseUrl.replace(/\/$/, "")}/focus`)}
          >
            Open /focus
          </button>
        </div>

        <div className="progress-rail">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>

        <div className="status-grid compact-grid">
          <div className="status-card">
            <div className="metric-label">Current</div>
            <div className="status-title">
              {status?.currentSession?.appName ?? "Idle"}
            </div>
            <div className="metric-subtle">
              {status?.currentSession?.windowTitle ?? "No active window"}
            </div>
          </div>
          <div className="status-card">
            <div className="metric-label">Upload</div>
            <div className="status-title">{uploadLabel}</div>
            <div className="metric-subtle">
              {uploadNeedsAttention ? recoveryGuidance : uploadMessage}
            </div>
          </div>
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
      </section>

      {uploadNeedsAttention ? (
        <section className="panel">
          <div className="section-header tight">
            <div>
              <h2>Attention needed</h2>
              <p>{recoveryGuidance}</p>
            </div>
            <button
              className="ghost"
              type="button"
              onClick={() => setShowSetup((current) => !current)}
            >
              {showSetup ? "Hide setup" : status?.apiKeyPresent ? "Reconnect" : "Fix setup"}
            </button>
          </div>

          {showSetup ? (
            <>
              <div className="form-grid compact-form">
                <label>
                  <span>Device ID</span>
                  <div className="readonly-input-row">
                    <input value={status?.deviceId ?? ""} readOnly />
                    <button
                      className="ghost small"
                      type="button"
                      disabled={!status?.deviceId}
                      onClick={async () => {
                        if (!status?.deviceId) {
                          return;
                        }

                        await navigator.clipboard.writeText(status.deviceId);
                        setCopiedDeviceId(true);
                        window.setTimeout(() => setCopiedDeviceId(false), 1500);
                      }}
                    >
                      {copiedDeviceId ? "Copied" : "Copy"}
                    </button>
                  </div>
                </label>
                <label>
                  <span>Base URL</span>
                  <input
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.currentTarget.value)}
                    placeholder="http://127.0.0.1:3200"
                  />
                </label>
                <label>
                  <span>Pairing code</span>
                  <input
                    value={pairingCode}
                    onChange={(event) => setPairingCode(event.currentTarget.value.toUpperCase())}
                    placeholder="Paste the code from /focus"
                  />
                </label>
                <label>
                  <span>Time zone</span>
                  <input value={browserTimeZone} readOnly disabled />
                </label>
              </div>
              <div className="actions compact-actions">
                <button
                  className="accent"
                  disabled={busy !== null || !baseUrl || !pairingCode.trim()}
                  onClick={() =>
                    runAction(() =>
                      invoke("pair_device", {
                        baseUrl,
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
                Generate a pairing code in `/focus`, paste it here once, and the collector will store its own device token automatically.
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
