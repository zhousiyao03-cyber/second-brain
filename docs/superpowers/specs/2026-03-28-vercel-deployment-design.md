# Second Brain — Vercel 部署上线设计

日期：2026-03-28

## 目标

将 Second Brain 部署到 Vercel，支持多用户认证和数据隔离，具备 AI 速率限制，费用控制在免费/极低水平。

## 核心决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 部署平台 | Vercel (免费 Hobby 计划) | 用户要求，Next.js 原生支持 |
| 数据库 | Turso (libsql) | SQLite 方言兼容，迁移成本最低，免费额度 9 GB |
| 认证 | Auth.js v5 + GitHub/Google OAuth | Next.js 生态标准方案，支持多用户 |
| Session 策略 | JWT | 无需额外 session 存储，适合 serverless |
| 数据隔离 | 业务表加 userId 字段 | 直接简单 |
| AI 限流 | 数据库计数 (ai_usage 表) | 不引入额外依赖 |
| Token Usage | 环境变量开关，线上禁用 | 依赖本地文件，线上无法工作 |
| 域名 | 使用 Vercel 默认 xxx.vercel.app | 暂不需要自定义域名 |
| 落地页 | 无，直接跳登录页 | 简单直接 |

---

## 1. 数据库迁移：SQLite → Turso

### 依赖变更

- 移除：`better-sqlite3`、`@types/better-sqlite3`
- 添加：`@libsql/client`

### 文件改动

**`src/server/db/index.ts`** — 连接方式改为 Turso HTTP 驱动：

```typescript
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });
```

**`src/server/db/path.ts`** — 删除。不再需要文件路径解析。

**`drizzle.config.ts`** — driver 改为 turso：

```typescript
export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  driver: "turso",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
});
```

**`src/server/db/schema.ts`** — 不需要改动，`sqliteTable` 定义兼容 Turso。

### 环境变量

```bash
# 生产环境（Vercel）
TURSO_DATABASE_URL=libsql://your-db-name-your-org.turso.io
TURSO_AUTH_TOKEN=your-auth-token

# 本地开发（继续用本地 SQLite 文件）
TURSO_DATABASE_URL=file:data/second-brain.db
# TURSO_AUTH_TOKEN 不需要
```

### 本地开发兼容

`@libsql/client` 支持 `file:` 协议，本地开发设 `TURSO_DATABASE_URL=file:data/second-brain.db` 即可，无需连云端。

---

## 2. 认证系统：Auth.js v5

### 依赖

- `next-auth@5`
- `@auth/drizzle-adapter`

### 新增表

在 `src/server/db/schema.ts` 中新增 Auth.js 所需表（使用 `@auth/drizzle-adapter` 提供的标准 schema）：

```
users
  - id: TEXT PK
  - name: TEXT
  - email: TEXT
  - emailVerified: INTEGER (timestamp)
  - image: TEXT

accounts
  - id: TEXT PK
  - userId: TEXT FK → users.id
  - type: TEXT
  - provider: TEXT
  - providerAccountId: TEXT
  - refresh_token: TEXT
  - access_token: TEXT
  - expires_at: INTEGER
  - token_type: TEXT
  - scope: TEXT
  - id_token: TEXT
  - session_state: TEXT
```

JWT 模式下不需要 `sessions` 和 `verificationTokens` 表。

### 关键文件

**`src/lib/auth.ts`** — Auth.js 核心配置：

```typescript
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/server/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db),
  providers: [GitHub, Google],
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, user }) {
      if (user) token.userId = user.id;
      return token;
    },
    session({ session, token }) {
      session.user.id = token.userId as string;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
```

**`src/app/api/auth/[...nextauth]/route.ts`** — Auth.js API 路由：

```typescript
import { handlers } from "@/lib/auth";
export const { GET, POST } = handlers;
```

**`src/app/login/page.tsx`** — 登录页面：
- 展示 GitHub / Google 登录按钮
- 调用 `signIn("github")` / `signIn("google")`
- 已登录用户重定向到首页

**`src/middleware.ts`** — 路由保护：
- 匹配所有路由（排除 `/login`、`/api/auth/*`、静态资源）
- 无 session → 重定向 `/login`

### OAuth App 配置

部署前需要创建：

- **GitHub OAuth App**：Settings → Developer settings → OAuth Apps
  - Callback URL: `https://xxx.vercel.app/api/auth/callback/github`
- **Google OAuth App**：Google Cloud Console → Credentials → OAuth 2.0
  - Callback URL: `https://xxx.vercel.app/api/auth/callback/google`

### 环境变量

```bash
AUTH_SECRET=xxx            # openssl rand -base64 32
AUTH_GITHUB_ID=xxx
AUTH_GITHUB_SECRET=xxx
AUTH_GOOGLE_ID=xxx
AUTH_GOOGLE_SECRET=xxx
```

---

## 3. 数据隔离

### Schema 改动

给以下 6 张表新增 `userId` 字段：

| 表 | 字段 |
|----|------|
| notes | `userId TEXT NOT NULL` → `users.id` |
| bookmarks | `userId TEXT NOT NULL` → `users.id` |
| todos | `userId TEXT NOT NULL` → `users.id` |
| chat_messages | `userId TEXT NOT NULL` → `users.id` |
| workflows | `userId TEXT NOT NULL` → `users.id` |
| learning_paths | `userId TEXT NOT NULL` → `users.id` |

`learning_lessons` 不加 — 通过 `learning_paths.userId` 间接隔离。

### tRPC 改造

**`src/server/trpc.ts`** — 新增 `protectedProcedure`：

```typescript
import { auth } from "@/lib/auth";
import { TRPCError } from "@trpc/server";

const authMiddleware = t.middleware(async ({ next }) => {
  const session = await auth();
  if (!session?.user?.id) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { userId: session.user.id } });
});

export const protectedProcedure = t.procedure.use(authMiddleware);
```

**所有 router 文件** — `publicProcedure` → `protectedProcedure`，查询加 `where(eq(table.userId, ctx.userId))`，插入带 `userId: ctx.userId`。

涉及文件：`notes.ts`、`bookmarks.ts`、`todos.ts`、`chat.ts`、`workflows.ts`、`learn.ts`

### 现有数据迁移策略

1. Turso CLI 导入本地数据：`turso db import local-file data/second-brain.db`
2. 跑 migration 加 `userId` 字段（先允许 NULL）
3. 首次 OAuth 登录拿到你的 userId
4. 执行一次性 SQL 把现有数据归到你名下：
   ```sql
   UPDATE notes SET userId = 'your-user-id' WHERE userId IS NULL;
   UPDATE bookmarks SET userId = 'your-user-id' WHERE userId IS NULL;
   UPDATE todos SET userId = 'your-user-id' WHERE userId IS NULL;
   UPDATE chat_messages SET userId = 'your-user-id' WHERE userId IS NULL;
   UPDATE workflows SET userId = 'your-user-id' WHERE userId IS NULL;
   UPDATE learning_paths SET userId = 'your-user-id' WHERE userId IS NULL;
   ```
5. 再跑一次 migration 把 `userId` 改为 `NOT NULL`

---

## 4. AI 速率限制

### 新增表

```
ai_usage
  - id: TEXT PK
  - userId: TEXT NOT NULL FK → users.id
  - date: TEXT NOT NULL ('YYYY-MM-DD')
  - count: INTEGER NOT NULL DEFAULT 0
  - UNIQUE(userId, date)
```

### 限流 middleware

```typescript
const AI_DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 50;

const aiRateLimitMiddleware = t.middleware(async ({ ctx, next }) => {
  const today = new Date().toISOString().slice(0, 10);
  const usage = await db.select()
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, ctx.userId), eq(aiUsage.date, today)))
    .get();

  if (usage && usage.count >= AI_DAILY_LIMIT) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Daily AI limit reached (${AI_DAILY_LIMIT})`,
    });
  }

  const result = await next();

  // 成功后计数 +1（upsert）
  await db.insert(aiUsage)
    .values({ id: crypto.randomUUID(), userId: ctx.userId, date: today, count: 1 })
    .onConflictDoUpdate({
      target: [aiUsage.userId, aiUsage.date],
      set: { count: sql`count + 1` },
    });

  return result;
});
```

应用到 AI 相关 procedure：Ask AI 问答、收藏摘要生成、学习模块 AI 导师等。

### 环境变量

```bash
AI_DAILY_LIMIT=50  # 每用户每天 AI 调用上限，可调整
```

---

## 5. Token Usage 模块禁用

### 策略

- 环境变量 `ENABLE_TOKEN_USAGE` 控制开关（默认 `false`）
- 本地开发设 `ENABLE_TOKEN_USAGE=true` 保留功能

### 改动

- **侧边栏**：根据环境变量或 feature flag 隐藏 Token Usage 入口
- **`/usage` 页面**：未启用时重定向到首页
- **`token-usage-local.ts`**：使用动态 import `better-sqlite3`，避免 Vercel 构建时静态分析到原生模块报错。或者直接在 `ENABLE_TOKEN_USAGE=false` 时跳过相关代码路径
- **Dashboard 中的 token usage 卡片**：根据开关隐藏

---

## 6. AI Provider 线上配置

### 改动

无代码改动。现有 `src/server/ai/provider.ts` 已支持 `AI_PROVIDER=openai` 模式。

### 环境变量

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=your-api-key
# 可选：指定模型
OPENAI_MODEL=gpt-4o
```

---

## 7. Vercel 部署

### 前置步骤

1. 代码推到 GitHub 仓库
2. 创建 Turso 数据库 + 导入本地数据
3. 创建 GitHub / Google OAuth App
4. Vercel Dashboard 连接 GitHub 仓库

### Vercel 环境变量汇总

```bash
# 数据库
TURSO_DATABASE_URL=libsql://xxx.turso.io
TURSO_AUTH_TOKEN=xxx

# 认证
AUTH_SECRET=xxx
AUTH_GITHUB_ID=xxx
AUTH_GITHUB_SECRET=xxx
AUTH_GOOGLE_ID=xxx
AUTH_GOOGLE_SECRET=xxx

# AI
AI_PROVIDER=openai
OPENAI_API_KEY=xxx
AI_DAILY_LIMIT=50

# 功能开关
ENABLE_TOKEN_USAGE=false
```

### 部署后数据迁移

1. 访问站点，用 OAuth 登录
2. 从 Turso Dashboard 或 CLI 获取你的 userId
3. 执行数据归属 SQL（见第 3 节）
4. 跑 migration 将 userId 改为 NOT NULL

---

## 改动文件清单

### 新增文件
- `src/lib/auth.ts` — Auth.js 配置
- `src/app/api/auth/[...nextauth]/route.ts` — Auth.js API 路由
- `src/app/login/page.tsx` — 登录页面
- `src/middleware.ts` — 路由保护

### 修改文件
- `package.json` — 依赖替换
- `src/server/db/index.ts` — Turso 连接
- `src/server/db/schema.ts` — 新增 Auth 表 + 业务表加 userId + ai_usage 表
- `drizzle.config.ts` — Turso driver 配置
- `src/server/trpc.ts` — 新增 protectedProcedure + AI 限流 middleware
- `src/server/routers/notes.ts` — protectedProcedure + userId 过滤
- `src/server/routers/bookmarks.ts` — 同上
- `src/server/routers/todos.ts` — 同上
- `src/server/routers/chat.ts` — 同上
- `src/server/routers/workflows.ts` — 同上
- `src/server/routers/learn.ts` — 同上
- `src/server/routers/token-usage.ts` — 禁用开关
- `src/components/layout/sidebar.tsx` — 隐藏 Token Usage 入口
- `src/app/usage/page.tsx` — 未启用时重定向
- `src/app/page.tsx` — Dashboard 隐藏 token usage 卡片
- `.env.example` — 更新环境变量文档

### 删除文件
- `src/server/db/path.ts` — 不再需要

### 迁移文件（Drizzle 自动生成）
- `drizzle/xxxx_*.sql` — Auth 表 + userId 字段 + ai_usage 表
