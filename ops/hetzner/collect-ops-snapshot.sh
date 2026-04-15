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

SERVICES_JSON="$(docker compose -f "$APP_DIR/docker-compose.prod.yml" ps --format json | node -e '
const fs = require("node:fs");
const input = fs.readFileSync(0, "utf8").trim();
const rows = input ? input.split(/\n+/).map((line) => JSON.parse(line)) : [];
const mapped = rows.map((row) => ({
  name: row.Service,
  status: row.State === "running" ? "healthy" : "degraded",
  detail: row.Status ?? null,
}));
process.stdout.write(JSON.stringify(mapped));
')"

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
