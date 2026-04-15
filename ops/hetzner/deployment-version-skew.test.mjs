import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("Next production config enables deploymentId-based version skew protection", () => {
  const nextConfig = readRepoFile("next.config.ts");

  assert.match(
    nextConfig,
    /deploymentId:\s*process\.env\.NEXT_DEPLOYMENT_ID/,
    "next.config.ts must set deploymentId from NEXT_DEPLOYMENT_ID",
  );
});

test("Hetzner production compose passes NEXT_DEPLOYMENT_ID into build and runtime", () => {
  const composeFile = readRepoFile("docker-compose.prod.yml");

  assert.match(
    composeFile,
    /build:\s*\n(?:.*\n)*?\s+args:\s*\n(?:.*\n)*?\s+NEXT_DEPLOYMENT_ID:\s*\$\{NEXT_DEPLOYMENT_ID:-local\}/m,
    "docker-compose.prod.yml must forward NEXT_DEPLOYMENT_ID into the build",
  );
  assert.match(
    composeFile,
    /environment:\s*\n(?:.*\n)*?\s+NEXT_DEPLOYMENT_ID:\s*\$\{NEXT_DEPLOYMENT_ID:-local\}/m,
    "docker-compose.prod.yml must expose NEXT_DEPLOYMENT_ID at runtime",
  );
});

test("Hetzner deploy script exports a deployment id for every rollout", () => {
  const deployScript = readRepoFile("ops/hetzner/deploy.sh");

  assert.match(
    deployScript,
    /NEXT_DEPLOYMENT_ID="\$\{NEXT_DEPLOYMENT_ID:-\$\(date -u \+%Y%m%d%H%M%S\)\}"/,
    "ops/hetzner/deploy.sh must generate a fallback deployment id",
  );
  assert.match(
    deployScript,
    /export NEXT_DEPLOYMENT_ID/,
    "ops/hetzner/deploy.sh must export NEXT_DEPLOYMENT_ID before docker compose build",
  );
  assert.match(
    deployScript,
    /docker compose -f "\$COMPOSE_FILE" build --pull --build-arg NEXT_DEPLOYMENT_ID="\$NEXT_DEPLOYMENT_ID" knosi/,
    "ops/hetzner/deploy.sh must pass NEXT_DEPLOYMENT_ID explicitly as a docker build arg",
  );
});

test("GitHub auto deploy forwards the commit SHA as NEXT_DEPLOYMENT_ID", () => {
  const workflow = readRepoFile(".github/workflows/deploy-hetzner.yml");

  assert.match(
    workflow,
    /NEXT_DEPLOYMENT_ID='\$\{\{\s*github\.sha\s*\}\}'/,
    "GitHub workflow must pass github.sha into the remote deploy script",
  );
});
