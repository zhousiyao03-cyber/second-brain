#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/knosi}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:3000/login}"
EXPECTED_STATUS="${EXPECTED_STATUS:-200}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-30}"
SLEEP_SECONDS="${SLEEP_SECONDS:-2}"
NEXT_DEPLOYMENT_ID="${NEXT_DEPLOYMENT_ID:-$(date -u +%Y%m%d%H%M%S)}"
GIT_SHA="${GIT_SHA:-$(git rev-parse HEAD 2>/dev/null || true)}"
DEPLOYED_AT="${DEPLOYED_AT:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}"

IMAGE_NAME="knosi-knosi:latest"
K3S_NAMESPACE="knosi"
K3S_DEPLOYMENT="knosi"
KUBECONFIG_FILE="${KUBECONFIG_FILE:-/etc/rancher/k3s/k3s.yaml}"
K3S_HEALTHCHECK_URL="${K3S_HEALTHCHECK_URL:-http://127.0.0.1:30080/login}"
K3S_HEALTHCHECK_HOST="${K3S_HEALTHCHECK_HOST:-www.knosi.xyz}"

cd "$APP_DIR"

if [ ! -f ".env.production" ]; then
  echo "missing $APP_DIR/.env.production" >&2
  exit 1
fi

export NEXT_DEPLOYMENT_ID GIT_SHA DEPLOYED_AT KUBECONFIG="$KUBECONFIG_FILE"
echo "deploying with NEXT_DEPLOYMENT_ID=$NEXT_DEPLOYMENT_ID GIT_SHA=${GIT_SHA:-unknown}"

# 1. Build new image via docker (keeps existing Dockerfile + compose build cache flow)
docker compose -f "$COMPOSE_FILE" config >/dev/null
docker compose -f "$COMPOSE_FILE" build --pull --build-arg NEXT_DEPLOYMENT_ID="$NEXT_DEPLOYMENT_ID" knosi

# 2. Import the image into k3s containerd
echo "importing image into k3s containerd"
docker save "$IMAGE_NAME" | k3s ctr images import -

# 3. Ensure the namespace + base manifests exist (idempotent, safe on re-runs)
kubectl apply -f ops/k3s/00-namespace.yaml

# 4. Refresh the secret from .env.production so env changes propagate to pods
kubectl -n "$K3S_NAMESPACE" create secret generic knosi-env \
  --from-env-file=.env.production \
  --dry-run=client -o yaml | kubectl apply -f -

# 5. Apply the rest of the manifests (Deployments / Services / Ingress / PVCs)
kubectl apply -f ops/k3s/10-redis.yaml
kubectl apply -f ops/k3s/20-knosi.yaml
kubectl apply -f ops/k3s/30-ingress.yaml

# 6. Trigger a rolling restart so the new image + refreshed secret are picked up
kubectl -n "$K3S_NAMESPACE" rollout restart deploy/"$K3S_DEPLOYMENT"
kubectl -n "$K3S_NAMESPACE" rollout status deploy/"$K3S_DEPLOYMENT" --timeout=300s

# 7. Keep Caddy up to date (Caddyfile + cert management still run in docker).
#    --no-deps prevents compose from also starting the stopped knosi + redis
#    containers that are intentionally left as a rollback safety net.
docker compose -f "$COMPOSE_FILE" up -d --no-deps caddy

# 8. End-to-end health check through Caddy → Traefik → k3s pod
attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  status_code="$(curl -sS -o /dev/null -w '%{http_code}' -H "Host: $K3S_HEALTHCHECK_HOST" "$K3S_HEALTHCHECK_URL" || true)"
  if [ "$status_code" = "$EXPECTED_STATUS" ]; then
    kubectl -n "$K3S_NAMESPACE" get pod,svc,ingress
    exit 0
  fi

  echo "health check attempt $attempt/$MAX_ATTEMPTS returned $status_code" >&2
  sleep "$SLEEP_SECONDS"
  attempt=$((attempt + 1))
done

kubectl -n "$K3S_NAMESPACE" logs deploy/"$K3S_DEPLOYMENT" --tail=100 >&2 || true
docker compose -f "$COMPOSE_FILE" logs --tail=50 caddy >&2 || true
echo "deployment failed: $K3S_HEALTHCHECK_URL did not return $EXPECTED_STATUS" >&2
exit 1
