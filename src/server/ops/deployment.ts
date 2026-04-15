import type { OpsDeploymentSnapshot } from "./types";

function inferGitShaFromDeploymentId(deploymentId: string | null) {
  if (!deploymentId) {
    return null;
  }

  return /^[0-9a-f]{40}$/i.test(deploymentId) ? deploymentId : null;
}

export function getDeploymentSnapshot(): OpsDeploymentSnapshot {
  const deploymentId = process.env.NEXT_DEPLOYMENT_ID ?? null;
  const gitSha =
    process.env.GIT_SHA ??
    process.env.GITHUB_SHA ??
    inferGitShaFromDeploymentId(deploymentId);
  const deployedAt = process.env.DEPLOYED_AT ?? null;
  const source =
    process.env.GITHUB_ACTIONS === "true" ? "github-actions" : deployedAt ? "manual" : "unknown";

  return {
    gitSha,
    deploymentId,
    source,
    deployedAt,
    environment: "production",
  };
}
