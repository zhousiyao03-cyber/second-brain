export type Plan = "free" | "pro";
export type Limit = number | "unlimited";

export type EntitlementSource =
  | "self-hosted"
  | "hosted-free"
  | "hosted-trial"
  | "hosted-active"
  | "hosted-grace";

export type Entitlements = {
  plan: Plan;
  source: EntitlementSource;
  limits: {
    askAiPerDay: Limit;
    notes: Limit;
    storageMB: Limit;
    shareLinks: Limit;
  };
  features: {
    portfolio: boolean;
    focusTracker: boolean;
    ossProjects: boolean;
    claudeCapture: boolean;
    knosiProvidedAi: boolean;
  };
  trialEndsAt?: number;
  currentPeriodEnd?: number;
  cancelledAt?: number;
};

const PRO_FEATURES = {
  portfolio: true,
  focusTracker: true,
  ossProjects: true,
  claudeCapture: true,
  knosiProvidedAi: true,
};

const FREE_FEATURES = {
  portfolio: false,
  focusTracker: false,
  ossProjects: false,
  claudeCapture: false,
  knosiProvidedAi: false,
};

export const PRO_UNLIMITED: Entitlements = {
  plan: "pro",
  source: "self-hosted",
  limits: {
    askAiPerDay: "unlimited",
    notes: "unlimited",
    storageMB: "unlimited",
    shareLinks: "unlimited",
  },
  features: PRO_FEATURES,
};

const PRO_HOSTED_LIMITS = {
  askAiPerDay: 80,
  notes: "unlimited" as const,
  storageMB: 10240,
  shareLinks: "unlimited" as const,
};

const FREE_HOSTED_LIMITS = {
  askAiPerDay: 20,
  notes: 50,
  storageMB: 100,
  shareLinks: 3,
};

type SubRow = {
  status: "on_trial" | "active" | "past_due" | "cancelled" | "expired" | "paused";
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  cancelledAt: Date | null;
};

type UserRow = { createdAt: Date | null };

const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

export function deriveEntitlements(
  sub: SubRow | null,
  user: UserRow,
  now: number,
): Entitlements {
  const createdAt = user.createdAt?.getTime() ?? 0;

  // No subscription — check signup trial window.
  if (!sub) {
    if (createdAt > 0 && now < createdAt + SEVEN_DAYS_MS) {
      return {
        plan: "pro",
        source: "hosted-trial",
        limits: PRO_HOSTED_LIMITS,
        features: PRO_FEATURES,
        trialEndsAt: createdAt + SEVEN_DAYS_MS,
      };
    }
    return freeHosted();
  }

  const periodEnd = sub.currentPeriodEnd?.getTime() ?? 0;
  const withinGrace = periodEnd > now;

  switch (sub.status) {
    case "on_trial":
      return {
        plan: "pro",
        source: "hosted-trial",
        limits: PRO_HOSTED_LIMITS,
        features: PRO_FEATURES,
        trialEndsAt: sub.trialEndsAt?.getTime(),
        currentPeriodEnd: periodEnd,
      };
    case "active":
      return {
        plan: "pro",
        source: "hosted-active",
        limits: PRO_HOSTED_LIMITS,
        features: PRO_FEATURES,
        currentPeriodEnd: periodEnd,
      };
    case "cancelled":
      return withinGrace
        ? {
            plan: "pro",
            source: "hosted-grace",
            limits: PRO_HOSTED_LIMITS,
            features: PRO_FEATURES,
            currentPeriodEnd: periodEnd,
            cancelledAt: sub.cancelledAt?.getTime(),
          }
        : freeHosted();
    case "past_due": {
      const stillInGrace = periodEnd + SEVEN_DAYS_MS > now;
      return stillInGrace
        ? {
            plan: "pro",
            source: "hosted-grace",
            limits: PRO_HOSTED_LIMITS,
            features: PRO_FEATURES,
            currentPeriodEnd: periodEnd,
          }
        : freeHosted();
    }
    case "paused":
    case "expired":
    default:
      return freeHosted();
  }
}

function freeHosted(): Entitlements {
  return {
    plan: "free",
    source: "hosted-free",
    limits: FREE_HOSTED_LIMITS,
    features: FREE_FEATURES,
  };
}
