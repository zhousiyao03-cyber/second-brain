import crypto from "node:crypto";

export function createSourceSessionId(sample, startedAt) {
  const slug = `${sample.appName}:${sample.windowTitle ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${startedAt.toISOString()}-${slug || crypto.randomUUID()}`;
}

export class FocusSessionizer {
  constructor({ idleThresholdSecs = 300 } = {}) {
    this.idleThresholdSecs = idleThresholdSecs;
    this.currentSession = null;
  }

  observe(sample, observedAt, idleSecs = 0) {
    if (!sample || idleSecs >= this.idleThresholdSecs) {
      return this.flush(observedAt);
    }

    if (!this.currentSession) {
      this.currentSession = {
        sourceSessionId: createSourceSessionId(sample, observedAt),
        appName: sample.appName,
        windowTitle: sample.windowTitle ?? null,
        startedAt: new Date(observedAt),
        endedAt: new Date(observedAt),
      };
      return null;
    }

    const sameWindow =
      this.currentSession.appName === sample.appName &&
      this.currentSession.windowTitle === (sample.windowTitle ?? null);

    if (sameWindow) {
      this.currentSession.endedAt = new Date(observedAt);
      return null;
    }

    const closed = this.flush(observedAt);
    this.currentSession = {
      sourceSessionId: createSourceSessionId(sample, observedAt),
      appName: sample.appName,
      windowTitle: sample.windowTitle ?? null,
      startedAt: new Date(observedAt),
      endedAt: new Date(observedAt),
    };
    return closed;
  }

  flush(observedAt = new Date()) {
    if (!this.currentSession) {
      return null;
    }

    const endedAt =
      observedAt > this.currentSession.startedAt
        ? new Date(observedAt)
        : new Date(this.currentSession.startedAt);

    const durationSecs = Math.max(
      1,
      Math.floor((endedAt.getTime() - this.currentSession.startedAt.getTime()) / 1000)
    );

    const closed = {
      ...this.currentSession,
      endedAt,
      durationSecs,
    };

    this.currentSession = null;
    return closed;
  }
}
