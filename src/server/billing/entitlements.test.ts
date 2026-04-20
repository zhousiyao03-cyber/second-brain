import { describe, expect, it } from "vitest";
import { deriveEntitlements } from "./entitlements";

const DAY = 24 * 3600 * 1000;
const NOW = new Date("2026-04-20T12:00:00Z").getTime();

function user(createdDaysAgo: number) {
  return { createdAt: new Date(NOW - createdDaysAgo * DAY) };
}

function sub(overrides: Partial<Parameters<typeof deriveEntitlements>[0] & object>) {
  return {
    status: "active" as const,
    currentPeriodEnd: new Date(NOW + 10 * DAY),
    trialEndsAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

describe("deriveEntitlements", () => {
  it("no sub + trial window → hosted-trial Pro", () => {
    const ent = deriveEntitlements(null, user(3), NOW);
    expect(ent.plan).toBe("pro");
    expect(ent.source).toBe("hosted-trial");
  });

  it("no sub + past trial → hosted-free", () => {
    const ent = deriveEntitlements(null, user(8), NOW);
    expect(ent.plan).toBe("free");
    expect(ent.source).toBe("hosted-free");
  });

  it("status=on_trial → hosted-trial", () => {
    const ent = deriveEntitlements(sub({ status: "on_trial" }), user(3), NOW);
    expect(ent.source).toBe("hosted-trial");
  });

  it("status=active → hosted-active", () => {
    const ent = deriveEntitlements(sub({ status: "active" }), user(30), NOW);
    expect(ent.source).toBe("hosted-active");
    expect(ent.limits.askAiPerDay).toBe(80);
  });

  it("cancelled but periodEnd in future → hosted-grace Pro", () => {
    const ent = deriveEntitlements(
      sub({ status: "cancelled", currentPeriodEnd: new Date(NOW + 5 * DAY) }),
      user(30),
      NOW,
    );
    expect(ent.plan).toBe("pro");
    expect(ent.source).toBe("hosted-grace");
  });

  it("cancelled and periodEnd passed → hosted-free", () => {
    const ent = deriveEntitlements(
      sub({ status: "cancelled", currentPeriodEnd: new Date(NOW - 1 * DAY) }),
      user(30),
      NOW,
    );
    expect(ent.plan).toBe("free");
  });

  it("past_due within 7-day grace → hosted-grace Pro", () => {
    const ent = deriveEntitlements(
      sub({ status: "past_due", currentPeriodEnd: new Date(NOW - 5 * DAY) }),
      user(30),
      NOW,
    );
    expect(ent.source).toBe("hosted-grace");
  });

  it("past_due beyond 7-day grace → hosted-free", () => {
    const ent = deriveEntitlements(
      sub({ status: "past_due", currentPeriodEnd: new Date(NOW - 10 * DAY) }),
      user(30),
      NOW,
    );
    expect(ent.plan).toBe("free");
  });

  it("paused → hosted-free", () => {
    const ent = deriveEntitlements(sub({ status: "paused" }), user(30), NOW);
    expect(ent.plan).toBe("free");
  });

  it("expired → hosted-free", () => {
    const ent = deriveEntitlements(sub({ status: "expired" }), user(30), NOW);
    expect(ent.plan).toBe("free");
  });

  it("free entitlements carry correct limits", () => {
    const ent = deriveEntitlements(null, user(8), NOW);
    expect(ent.limits).toEqual({
      askAiPerDay: 20,
      notes: 50,
      storageMB: 100,
      shareLinks: 3,
    });
    expect(ent.features.portfolio).toBe(false);
  });
});
