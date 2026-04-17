# 2026-04-17 — Migrate production from docker-compose to k3s

## Goal

Move the live Knosi deployment on Hetzner from `docker compose up` to a k3s cluster on the same host, without any user-visible downtime.

## What changed

### Runtime topology

Before:

```
public :443  →  Caddy (docker) ──reverse_proxy──▶  knosi-knosi-1 (docker) ──▶  knosi-redis-1 (docker)
```

After:

```
public :443  →  Caddy (docker) ──reverse_proxy 172.17.0.1:30080──▶  Traefik (k3s Pod)
                                                                     └─▶ Ingress  ─▶  Service knosi  ─▶  Pod knosi
                                                                                                          └─▶ Service redis ─▶ Pod redis + PVC
```

- k3s `v1.34.6+k3s1` installed via `curl -sfL https://get.k3s.io | sh -` with `--disable=traefik --disable=servicelb` (to avoid fighting the bundled Traefik), then Traefik re-installed via Helm on NodePorts `30080`/`30443`.
- Knosi app + Redis run inside namespace `knosi`. Redis has a `500Mi` PVC (local-path provisioner), app has a `2Gi` PVC for `/app/data`.
- Caddy continues to hold `:80` / `:443`, terminate Let's Encrypt TLS for `www.knosi.xyz` / `knosi.xyz` / `k3s.knosi.xyz`, and reverse-proxy everything into Traefik at `172.17.0.1:30080` (docker bridge gateway → host port).

### Ingress rules

A single `Ingress/knosi` routes three hosts (`www.knosi.xyz`, `knosi.xyz`, `k3s.knosi.xyz`) into the app Service on port 3000. The `k3s.knosi.xyz` host was used as a parallel-verification staging URL during cutover.

### DNS

Added Cloudflare A record `k3s.knosi.xyz → 195.201.117.172` (DNS-only / grey-cloud) so Let's Encrypt HTTP-01 challenges work.

### Caddyfile

`ops/hetzner/Caddyfile` — rewrote the `www.knosi.xyz` block so the reverse proxy target is the Traefik NodePort instead of the compose service name. Preserved the `header_up Host {host}` so Traefik can match its Ingress rules.

### deploy.sh rewrite

`ops/hetzner/deploy.sh` — now builds the image via `docker compose build`, pipes it through `docker save | k3s ctr images import -`, refreshes the `knosi-env` Secret from `.env.production`, applies every manifest under `ops/k3s/`, and triggers `kubectl rollout restart deploy/knosi`. Health check runs end-to-end via Traefik, using the `Host: www.knosi.xyz` header to hit the real ingress path.

**Gotcha caught on first dry run:** `docker compose up -d caddy` will also start any *stopped* sibling containers declared in the same compose file (even without listing them), because compose re-reads the whole file and reconciles state. Fixed by passing `--no-deps` so only `caddy` is touched. Without this flag, the `stop`ped `knosi-knosi-1` and `knosi-redis-1` containers (kept for rollback) came back up every deploy and silently duplicated the cron workload alongside the k3s pods.

### New manifests

New directory `ops/k3s/` (version-controlled):

- `00-namespace.yaml` — creates `knosi` namespace
- `10-redis.yaml` — Redis Deployment/Service/PVC
- `20-knosi.yaml` — app Deployment/Service/PVC, with `imagePullPolicy: Never`, init-container waiting on Redis, startup/readiness/liveness probes on `/login`
- `30-ingress.yaml` — Traefik Ingress covering three hosts
- `README.md` — bootstrap + day-to-day runbook

### Compose containers

`knosi-knosi-1` and `knosi-redis-1` are `docker compose stop`ped (not removed) so rollback is a single `start` + Caddyfile revert. Caddy is the only docker container still running.

## Files touched

- `ops/hetzner/Caddyfile` (modified)
- `ops/hetzner/deploy.sh` (rewritten)
- `ops/k3s/00-namespace.yaml` (new)
- `ops/k3s/10-redis.yaml` (new)
- `ops/k3s/20-knosi.yaml` (new)
- `ops/k3s/30-ingress.yaml` (new)
- `ops/k3s/README.md` (new)
- `docs/changelog/2026-04-17-migrate-to-k3s.md` (this file)

## Verification

| Check | Command | Result |
|---|---|---|
| Cluster healthy | `kubectl -n knosi get pod` | `knosi` + `redis` Pods both `1/1 Running` |
| HTTPS end-to-end | `curl -sI https://www.knosi.xyz/login` | `HTTP/1.1 200 OK` |
| Apex redirect | `curl -sI https://knosi.xyz` | `HTTP/1.1 301 Moved Permanently` → `www.knosi.xyz` |
| Staging host | `curl -sI https://k3s.knosi.xyz/login` | `HTTP/1.1 200 OK` |
| TLS cert valid | `openssl s_client -servername www.knosi.xyz -connect www.knosi.xyz:443` | `CN=www.knosi.xyz`, valid until `Jul 14 2026` |
| k3s TLS cert valid | same for `k3s.knosi.xyz` | `CN=k3s.knosi.xyz`, valid until `Jul 16 2026`, issuer `Let's Encrypt E7` |
| Rolling update path | `kubectl -n knosi rollout restart deploy/knosi` | new pod `Running`, old `Terminating`, `www` stays 200 through cutover |
| Live traffic actually served by Pod | `kubectl -n knosi logs deploy/knosi --tail=30` | real-time `activity_sessions` SQL from Focus Tracker ingest |
| Compose knosi/redis stopped | `docker ps -a` | only `knosi-caddy-1` running; `knosi-knosi-1` + `knosi-redis-1` `Exited` |
| Host resource headroom | `free -h` + `df -h /` | `1.3Gi available` / `24G free`, better than pre-migration because two docker containers are no longer running |
| `deploy.sh` apply path idempotent | re-applied every `ops/k3s/*.yaml` manually | `unchanged` / `configured`, no drift |

## Known residuals / follow-ups

- **CI/CD still untested end-to-end against k3s.** The new `deploy.sh` was exercised piecewise (manifest apply + secret refresh + rollout restart), but the full `build → save → import → rollout` sequence has not been triggered through GitHub Actions yet. First real push to `main` will be the first full CI run of the k3s path.
- **No production schema rollout in this task.** Turso is untouched — `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` come from the same `.env.production`, so both the stopped compose pod and the running k3s pod talk to the same remote database. No drizzle changes.
- **Secret management is still "apply the env file on the host".** `knosi-env` is created with `kubectl create secret --from-env-file=.env.production`. Sufficient for single-node + single-operator. Future: sealed-secrets or external-secrets with a real backing KMS.
- **Caddy still runs in docker-compose, not k3s.** Fine for now — one edge process to manage, clear TLS boundary, fast rollback. A later phase can replace it with Traefik `--entryPoints.websecure.address=:443` + cert-manager, but that is its own session.
- **Stopped compose containers kept as rollback safety net.** Once a week of production stability on k3s has passed, they can be `docker compose rm`'d and `knosi-data` / `redis-data` docker volumes pruned. Do not rush this.
- **Rollback runbook** lives in `ops/k3s/README.md`; tested manually by revert-checking the Caddyfile edit on paper (not executed).
