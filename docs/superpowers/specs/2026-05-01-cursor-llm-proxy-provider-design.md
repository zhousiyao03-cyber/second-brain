# Cursor LLM Proxy as Knosi Provider — Design

**Status**: Draft (approved verbally on 2026-05-01)
**Author**: 周思尧
**Scope**: 把 Cursor 订阅当 LLM backend 复用 — 在 knosi.xyz 反代一个 OpenAI-兼容 endpoint，并把它接成 knosi 一个新的 AI Provider 选项。

---

## 0. 动机与边界

- **目标**：用户已有 Cursor Pro 订阅，希望把它当成 OpenAI-兼容 API，给 knosi（以及未来本机其它 AI 应用）调用。
- **风险已知并接受**：
  - 违反 Cursor ToS，账号可能被封 → 用户明确表态"封了也没事"。
  - Cursor Pro fast quota（150/月，2026-05 README 数据）可能短期耗尽 → 自用频率可控。
  - cursor-to-openai 反代依赖私有协议，Cursor 客户端协议变更会临时坏 → 接受手动追上游。
- **不在范围**：多账号轮询；自动监控/告警通道；把 cursor 当 hosted-pool 给 free 用户用；改造 Ask AI 的 Cloud/Local toggle。

## 1. 系统全貌

```
┌──────────────────────────┐
│ knosi pod (k3s)          │  AI Provider 设置选 "Cursor (Proxy)"
│  - new mode: "cursor"    │  → ai-sdk createOpenAI 走自定义 baseURL
└────────────┬─────────────┘
             │ HTTPS + Bearer CURSOR_PROXY_KEY
             ▼
┌──────────────────────────┐
│ Caddy (host) :443        │
│  knosi.xyz/cursor/*      │  匹配 path → 校验 Bearer → strip /cursor
│  其它 path 仍转 traefik   │
└────────────┬─────────────┘
             │ HTTP loopback
             ▼
┌──────────────────────────┐
│ Docker: cursor-to-openai │  127.0.0.1:3010
│  CURSOR_COOKIE=user_…::… │  (JiuZ-Chn/Cursor-To-OpenAI)
└────────────┬─────────────┘
             ▼
       api2.cursor.sh
```

**关键约束**：
- **复用 knosi.xyz 域名 + 子路径** `/cursor/*`，不申请新子域名、不动 DNS。
- **Bearer-key 鉴权**：Caddy 在 reverse_proxy 之前校验 `Authorization: Bearer $CURSOR_PROXY_KEY`，否则 401。
- **容器仅绑 127.0.0.1**：唯一公网入口是 Caddy。
- **生命周期独立**：cursor proxy 跑在 host docker，跟 knosi k3s 解耦，redeploy 互不影响。

## 2. 服务器端组件（Hetzner / knosi）

### 2.1 目录布局

```
/opt/cursor-proxy/
├── docker-compose.yml
└── .env                # CURSOR_COOKIE，chmod 600，root:root
```

### 2.2 `docker-compose.yml`

```yaml
services:
  cursor-to-openai:
    image: ghcr.io/jiuz-chn/cursor-to-openai:latest
    container_name: cursor-to-openai
    restart: unless-stopped
    ports:
      - "127.0.0.1:3010:3010"
    env_file: .env
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3010/v1/models"]
      interval: 60s
      timeout: 5s
      retries: 3
```

### 2.3 Caddyfile 改动

修改 `/etc/caddy/Caddyfile` 现有 `knosi.xyz, www.knosi.xyz { ... }` 块，**在 `reverse_proxy 127.0.0.1:30080` 之前**插入：

```caddy
    # Cursor LLM proxy — Bearer-protected, strips /cursor before forwarding
    @cursor path /cursor/*
    handle @cursor {
        @cursor_authed header Authorization "Bearer {env.CURSOR_PROXY_KEY}"
        handle @cursor_authed {
            uri strip_prefix /cursor
            reverse_proxy 127.0.0.1:3010
        }
        respond 401
    }
```

`handle` 是互斥的，命中后不会 fall through 到现有 traefik 转发，knosi 主流量零影响。

### 2.4 Bearer Key 注入

`/etc/systemd/system/caddy.service.d/cursor-key.conf`，`chmod 600`：

```ini
[Service]
Environment="CURSOR_PROXY_KEY=<openssl rand -base64 32>"
```

`systemctl daemon-reload && systemctl reload caddy` 生效。

### 2.5 启动 / 验证流程

```bash
# 1. 容器
sudo mkdir -p /opt/cursor-proxy
# 写 docker-compose.yml + .env (chmod 600, 填 CURSOR_COOKIE)
sudo docker compose -f /opt/cursor-proxy/docker-compose.yml up -d
curl -s http://127.0.0.1:3010/v1/models | head        # 容器自检

# 2. Caddy
sudo nano /etc/caddy/Caddyfile                         # 加 § 2.3 那段
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy

# 3. 公网测
curl -sI https://knosi.xyz/cursor/v1/models             # 401 (无 key)
curl -s -H "Authorization: Bearer $KEY" \
  https://knosi.xyz/cursor/v1/models | jq '.data[].id'  # 200 + 真实 model 列表
```

最后的 model 列表 → **§ 5 Phase B PRESET_MODELS 校准的输入**。

### 2.6 续期方案 — Auto-3（半自动一条命令）

本地脚本 `~/bin/refresh-cursor-cookie.sh`，`chmod 700`。逻辑：
1. 从 macOS Keychain 读 `WorkosCursorSessionToken`（缺/过期则 prompt 粘贴一次保存）
2. ssh 到 knosi，调容器内置 `/cursor/loginDeepControl` 用它换出 client cookie
3. `sudoedit /opt/cursor-proxy/.env` 替换 CURSOR_COOKIE
4. `docker compose restart cursor-to-openai`
5. 跑 `curl /v1/models` 验证

详细脚本见实施仓库 `cursor-proxy/scripts/refresh-cursor-cookie.sh`。

knosi 服务器需配 NOPASSWD sudo（仅授权这两条窄命令）：

```
ubuntu ALL=(root) NOPASSWD: /usr/bin/sed -i s|^CURSOR_COOKIE=.*|CURSOR_COOKIE=*| /opt/cursor-proxy/.env
ubuntu ALL=(root) NOPASSWD: /usr/bin/docker compose -f /opt/cursor-proxy/docker-compose.yml restart cursor-to-openai
```

写 `/etc/sudoers.d/cursor-proxy-refresh`，`chmod 440`，`visudo -c` 校验。

## 3. Knosi 代码改动

### 3.1 `src/server/ai/provider/types.ts`

```ts
export type AIProviderMode =
  | "local" | "openai" | "codex" | "claude-code-daemon" | "cursor";

export function maxStepsByMode(mode: AIProviderMode): number {
  if (mode === "openai" || mode === "cursor") return 6;
  if (mode === "local") return 3;
  return 1;
}
```

### 3.2 `src/server/ai/provider/ai-sdk.ts`

`AiSdkMode = Exclude<..., "codex" | "claude-code-daemon">` 自动包含 `"cursor"`，类型不动。

`createAiSdkProvider` 加分支：

```ts
if (mode === "cursor") {
  const baseUrl = process.env.CURSOR_PROXY_URL?.trim();
  const apiKey = process.env.CURSOR_PROXY_KEY?.trim();
  if (!baseUrl || !apiKey) {
    throw new Error(
      "Missing CURSOR_PROXY_URL or CURSOR_PROXY_KEY. " +
        "Set both in .env.local (or k8s secret) to use the Cursor provider."
    );
  }
  return createOpenAI({ name: "cursor-proxy", baseURL: baseUrl, apiKey });
}
```

`resolveAiSdkModelIdSync` 加分支（顶部加常量）：

```ts
const DEFAULT_CURSOR_CHAT_MODEL = "claude-4.6-sonnet-medium";
const DEFAULT_CURSOR_TASK_MODEL = "claude-4.6-sonnet-medium";

// inside resolveAiSdkModelIdSync:
if (mode === "cursor") {
  const fallback = kind === "chat" ? DEFAULT_CURSOR_CHAT_MODEL : DEFAULT_CURSOR_TASK_MODEL;
  return resolveValue(
    kind === "chat" ? process.env.CURSOR_CHAT_MODEL : process.env.CURSOR_TASK_MODEL,
    process.env.CURSOR_MODEL,
  ) ?? fallback;
}
```

> Phase B 校准：实测 `/v1/models` 后，如果 `claude-4.6-sonnet-medium` 不在返回里，把这两个常量改成实际可用的 chat 模型 id。

### 3.3 `src/server/ai/provider/mode.ts`

`AiProviderPreference` 加 `"cursor"`。`getProviderModeSync` 加：
```ts
if (explicitMode === "cursor") return "cursor";
```
`getProviderMode`（async）已经透传 `pref as AIProviderMode`，不动。

自动检测顺序保持不动 — cursor 必须显式 opt-in（避免无意中选到违反 ToS 的 backend）。

### 3.4 DB

`users.aiProviderPreference` 是 `text` 字段，加新枚举值无需 migration。

### 3.5 `src/server/routers/billing.ts`

`setAiProviderPreference` 的 zod enum 加 `"cursor"`。

新增 query（供 daemon-banner 用）：
```ts
getAiProviderPreference: protectedProcedure.query(async ({ ctx }) => {
  const [row] = await db
    .select({ preference: users.aiProviderPreference })
    .from(users)
    .where(eq(users.id, ctx.session.user.id))
    .limit(1);
  return { preference: row?.preference ?? null };
}),
```

### 3.6 `src/app/(app)/settings/ai-provider-section.tsx`

`ProviderOption.value` 加 `"cursor"`，`OPTIONS` 数组追加：
```ts
{
  value: "cursor",
  label: "Cursor (Proxy)",
  desc: "Reuse your Cursor subscription via knosi.xyz/cursor proxy",
},
```

### 3.7 `src/app/(app)/settings/model-picker.tsx`

`ProviderValue` 加 `"cursor"`，`PRESET_MODELS` 新增 key（保守 5 项 — Phase B 校准）：
```ts
cursor: [
  "claude-4.6-sonnet-medium",
  "claude-4.6-opus-high",
  "claude-opus-4-7-thinking-xhigh",
  "gpt-5.5-medium",
  "gpt-5.5-high",
],
```

### 3.8 `src/components/ask/daemon-banner.tsx` — 修 provider-aware bug

附带修复：banner 当前无脑显示 daemon offline，没看 user pref。改为只在 `pref === "claude-code-daemon"` 时才显示。

```ts
const { data: pref } = trpc.billing.getAiProviderPreference.useQuery();
// 早返回新增条件
if (pref?.preference !== "claude-code-daemon") return null;
if (!statusData || statusData.online) return null;
```

理由：不修这一条，新加 cursor 时切换到 Cursor provider 仍会被这条 banner 干扰。属于"在你工作的代码里改你顺手能改的东西"原则下合理的范围扩展。

### 3.9 部署侧 env 注入

knosi pod 需要：
```
CURSOR_PROXY_URL=https://knosi.xyz/cursor/v1
CURSOR_PROXY_KEY=<跟 Caddy systemd drop-in 同一个值>
```

具体位置实施时探查 `ops/hetzner/deploy.sh` + 当前 deployment yaml/env 注入方式（k8s secret + envFrom 还是 deployment env）。**不阻塞 spec，是实施任务**。

### 3.10 测试

- `src/server/ai/provider/ai-sdk.test.ts`：仿 openai 模式加 cursor 的 createAiSdkProvider / resolveModelId 用例
- `src/server/ai/provider/mode.test.ts`：加 `pref === "cursor"` → mode 解析为 `"cursor"` 的用例
- `e2e/per-user-provider.spec.ts`：加用例 — 在 Settings 选 Cursor 保存，验证 DB / UI 反映正确（不真的发请求到反代）

### 3.11 文档

- `docs/changelog/` 追加条目（按 phase 模板：日期 / 任务 / 关键变更 / 文件清单 / 验证命令 / 残留风险）
- 不更 `README.md`，因为 Cursor proxy 是个人灰色用法，不该在公开 README 推

## 4. 凭证与安全

| 凭证 | 存放位置 | 谁能读 |
|---|---|---|
| `CURSOR_COOKIE` (client JWT) | `/opt/cursor-proxy/.env`，`chmod 600` | root |
| `CURSOR_PROXY_KEY` (Bearer) | Caddy systemd drop-in `chmod 600` + knosi k8s env | root + knosi pod runtime |
| `WorkosCursorSessionToken` | macOS Keychain (`cursor-proxy-knosi` service) | 用户 login session |

绝不入：git 仓库、聊天 transcript、CI 日志。

## 5. 阶段化交付

**Phase A — Ship 框架**
- 全部 § 2、§ 3 的代码/部署改动落实
- PRESET_MODELS 用保守的 5 项（标注 tentative）
- 通过 build/lint/e2e 三步验证
- 在 knosi 仓库准备好 diff，**等用户最终 push 触发部署**
- 在 cursor-proxy 仓库（独立的）准备好 docker-compose / Caddyfile patch / 续期脚本，**等用户在服务器上手动 apply**

**Phase B — Model 列表校准**
- 部署完后跑 `curl /v1/models` 拿真实列表
- 对照截图里高频模型，更新 PRESET_MODELS（5–10 项）
- 单独 PR / commit

## 6. 残留风险与未做的事

1. **协议变更**：Cursor 客户端升级可能导致反代失效 — 接受手动 `docker pull` 追上游
2. **fast quota 耗尽**：150/月的限额，重负载下会 429 — 接受，自用低频
3. **Token 失效期间服务挂**：Auto-3 续期一条命令解决，挂的窗口取决于用户响应速度
4. **没有用量监控**：没接 Langfuse 之外的额外 dashboard — knosi 现有 telemetry 已能看到 mode/model 分布，足够
5. **没有 fallback**：cursor 挂了之后 ask AI 也跟着挂 — 用户可手动切回别的 provider，不做自动 failover
