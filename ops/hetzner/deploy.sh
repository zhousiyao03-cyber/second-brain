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

cd "$APP_DIR"

if [ ! -f ".env.production" ]; then
  echo "missing $APP_DIR/.env.production" >&2
  exit 1
fi

export NEXT_DEPLOYMENT_ID GIT_SHA DEPLOYED_AT
echo "deploying with NEXT_DEPLOYMENT_ID=$NEXT_DEPLOYMENT_ID GIT_SHA=${GIT_SHA:-unknown}"

docker compose -f "$COMPOSE_FILE" config >/dev/null
docker compose -f "$COMPOSE_FILE" build --pull --build-arg NEXT_DEPLOYMENT_ID="$NEXT_DEPLOYMENT_ID" knosi
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans redis knosi caddy

attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  status_code="$(curl -sS -o /dev/null -w '%{http_code}' "$HEALTHCHECK_URL" || true)"
  if [ "$status_code" = "$EXPECTED_STATUS" ]; then
    docker compose -f "$COMPOSE_FILE" ps
    exit 0
  fi

  echo "health check attempt $attempt/$MAX_ATTEMPTS returned $status_code" >&2
  sleep "$SLEEP_SECONDS"
  attempt=$((attempt + 1))
done

docker compose -f "$COMPOSE_FILE" logs --tail=100 knosi caddy >&2
echo "deployment failed: $HEALTHCHECK_URL did not return $EXPECTED_STATUS" >&2
exit 1
