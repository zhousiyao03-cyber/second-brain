# Knosi on k3s

Manifests for the k3s deployment of Knosi. Applied automatically by `ops/hetzner/deploy.sh` on each push to `main`.

## Layout

| File | Purpose |
|---|---|
| `00-namespace.yaml` | Creates the `knosi` namespace. |
| `10-redis.yaml` | Redis `Deployment` + `Service` + `PVC` (persistence for AOF). |
| `20-knosi.yaml` | App `Deployment` + `Service` + `PVC` (SQLite cache at `/app/data`). Uses image `knosi-knosi:latest` from k3s' local containerd. |
| `30-ingress.yaml` | Traefik `Ingress` for `www.knosi.xyz`, `knosi.xyz`, `k3s.knosi.xyz`. |

## First-time bootstrap

On a fresh server after k3s is installed and Traefik is running on `:30080`:

```bash
# 1. Build + import the image into k3s
docker compose -f docker-compose.prod.yml build knosi
docker save knosi-knosi:latest | k3s ctr images import -

# 2. Create the env Secret from .env.production
kubectl create namespace knosi
kubectl -n knosi create secret generic knosi-env \
  --from-env-file=.env.production

# 3. Apply manifests
kubectl apply -f ops/k3s/

# 4. Wait for rollout
kubectl -n knosi rollout status deploy/knosi --timeout=300s
```

## Day-to-day

`ops/hetzner/deploy.sh` handles each push — builds the image, imports into containerd, refreshes `knosi-env` from `.env.production`, and triggers `kubectl rollout restart deploy/knosi`.

Caddy still runs as docker-compose (see `docker-compose.prod.yml`) and reverse-proxies `172.17.0.1:30080` into Traefik, terminating TLS at the edge.

## Operations

```bash
# Status
kubectl -n knosi get pod,svc,ingress

# Logs (follow)
kubectl -n knosi logs -f deploy/knosi

# Force a rollout without code changes
kubectl -n knosi rollout restart deploy/knosi

# Shell into the running pod
kubectl -n knosi exec -it deploy/knosi -- sh

# Roll back to the previous revision
kubectl -n knosi rollout undo deploy/knosi
```

## Rollback to docker-compose

`knosi-knosi-1` and `knosi-redis-1` are stopped, not deleted. If the k3s stack fails:

```bash
# 1. Revert Caddyfile's www.knosi.xyz block to `reverse_proxy knosi:3000`
# 2. Start the compose containers again:
docker compose -f docker-compose.prod.yml -p knosi start knosi redis
docker compose -f docker-compose.prod.yml -p knosi restart caddy
```
