export type OpsServiceStatus = "healthy" | "degraded" | "unknown";
export type OpsOverallStatus = "healthy" | "degraded" | "down";

export type OpsDeploymentSnapshot = {
  gitSha: string | null;
  deploymentId: string | null;
  source: "github-actions" | "manual" | "unknown";
  deployedAt: string | null;
  environment: "production";
};

export type OpsJobHeartbeatSnapshot = {
  jobName: string;
  status: "healthy" | "degraded" | "unknown";
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  message: string | null;
};
