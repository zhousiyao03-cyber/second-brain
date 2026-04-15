#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/knosi}"
RUNTIME_DIR="${RUNTIME_DIR:-$APP_DIR/runtime}"
TMP_FILE="$RUNTIME_DIR/ops-snapshot.json.tmp"
OUT_FILE="$RUNTIME_DIR/ops-snapshot.json"

mkdir -p "$RUNTIME_DIR"

MEM_TOTAL_KB="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
MEM_AVAILABLE_KB="$(awk '/MemAvailable/ {print $2}' /proc/meminfo)"
MEM_USED_BYTES="$(( (MEM_TOTAL_KB - MEM_AVAILABLE_KB) * 1024 ))"
MEM_TOTAL_BYTES="$(( MEM_TOTAL_KB * 1024 ))"

read -r LOAD1 LOAD5 LOAD15 _ < /proc/loadavg
UPTIME_SECONDS="$(cut -d' ' -f1 /proc/uptime | cut -d'.' -f1)"

DISK_JSON="$(df -B1 --output=used,size,target /srv/knosi | tail -n1 | awk '{printf "{\"usedBytes\":%s,\"totalBytes\":%s,\"mount\":\"%s\"}", $1, $2, $3}')"

SERVICES_JSON="$(
  docker compose -f "$APP_DIR/docker-compose.prod.yml" ps --format json | python3 -c '
import json, sys

text = sys.stdin.read().strip()
rows = [json.loads(line) for line in text.splitlines() if line.strip()]
mapped = [
    {
        "name": row.get("Service"),
        "status": "healthy" if row.get("State") == "running" else "degraded",
        "detail": row.get("Status"),
    }
    for row in rows
]
json.dump(mapped, sys.stdout)
'
)"

cat >"$TMP_FILE" <<EOF
{
  "generatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "host": {
    "uptimeSeconds": ${UPTIME_SECONDS},
    "loadAverage": [${LOAD1}, ${LOAD5}, ${LOAD15}],
    "memory": {
      "usedBytes": ${MEM_USED_BYTES},
      "totalBytes": ${MEM_TOTAL_BYTES}
    },
    "disk": ${DISK_JSON}
  },
  "services": ${SERVICES_JSON}
}
EOF

mv "$TMP_FILE" "$OUT_FILE"
