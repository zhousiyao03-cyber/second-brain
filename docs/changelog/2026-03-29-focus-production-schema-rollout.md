# 2026-03-29 Focus Production Schema Rollout

## Task / Goal

在不影响线上现有用户数据的前提下，把 Focus Tracker 所需的生产数据库 schema 补到 Turso，并准备自动部署。

## Key Changes

- `drizzle.config.ts`
  - 去掉已不兼容当前 drizzle-kit 版本的 `driver: "turso"` 配置，保留 `dbCredentials.url/authToken`
- 生产 Turso schema rollout
  - 确认 `focus_*` 表在线上尚不存在
  - 由于 `drizzle-kit push` 对当前 Turso 配置在拉 schema 阶段失败，改为使用 `@libsql/client` 对生产库执行最小化、仅 Focus 相关的 `CREATE TABLE IF NOT EXISTS` / `CREATE UNIQUE INDEX IF NOT EXISTS`
  - 只创建了：
    - `activity_sessions`
    - `focus_daily_summaries`
    - `focus_devices`
    - `focus_device_pairings`
    - `focus_pairing_rate_limits`
- 没有修改现有业务表，没有删除或重写线上数据

## Files Touched

- `drizzle.config.ts`
- `docs/changelog/2026-03-29-focus-production-schema-rollout.md`

## Verification Commands And Results

- `set -a && source .env.turso-prod.local && set +a && node - <<'EOF' ... select name from sqlite_master ... EOF`
  - Passed, confirmed production Turso was reachable and initially had no `focus_*` tables
- `set -a && source .env.turso-prod.local && set +a && pnpm db:push`
  - Failed at drizzle CLI schema pull stage; no schema changes were applied by this failed command
- `set -a && source .env.turso-prod.local && set +a && node - <<'EOF' ... CREATE TABLE IF NOT EXISTS ... EOF`
  - Passed, production Turso now contains the required Focus tables and indexes
- Final verification query on production Turso:
  - Returned `activity_sessions`, `focus_daily_summaries`, `focus_devices`, `focus_device_pairings`, `focus_pairing_rate_limits` and their indexes

## Remaining Risks / Follow-up

- 当前线上 schema 已补齐，但未来若继续新增表或列，最好统一成一条稳定的生产 migration 路径，而不是继续手工执行 SQL。
- 代码 deploy 仍需通过 Git push 触发 Vercel 自动部署。
