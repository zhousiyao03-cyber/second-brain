# Vercel 部署上线实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Second Brain 部署到 Vercel，支持多用户 OAuth 认证、数据隔离、AI 速率限制，Token Usage 线上禁用。

**Architecture:** 数据库从 better-sqlite3 迁移到 Turso (libsql)，保持 SQLite 方言不变。认证用 Auth.js v5 + GitHub/Google OAuth，JWT session。所有业务表加 userId 做多用户数据隔离。AI 聊天接口加数据库计数限流。Token Usage 模块用环境变量开关控制。

**Tech Stack:** Next.js 16, Auth.js v5, @libsql/client, Drizzle ORM (libsql driver), tRPC v11

**Spec:** `docs/superpowers/specs/2026-03-28-vercel-deployment-design.md`

---

## File Structure

### New Files
- `src/lib/auth.ts` — Auth.js 配置（providers, adapter, callbacks）
- `src/lib/auth-client.ts` — 客户端 auth helpers（useSession, signIn, signOut re-exports）
- `src/app/api/auth/[...nextauth]/route.ts` — Auth.js API route handler
- `src/app/login/page.tsx` — 登录页面
- `src/middleware.ts` — 路由保护，未登录重定向到 /login

### Modified Files
- `package.json` — 替换 better-sqlite3 → @libsql/client, 添加 next-auth + @auth/drizzle-adapter
- `drizzle.config.ts` — driver 改为 turso
- `src/server/db/index.ts` — 连接改为 libsql createClient
- `src/server/db/schema.ts` — 新增 users/accounts/aiUsage 表，6 张业务表加 userId
- `src/server/trpc.ts` — 新增 protectedProcedure（auth middleware）
- `src/server/routers/notes.ts` — publicProcedure → protectedProcedure + userId 过滤
- `src/server/routers/bookmarks.ts` — 同上
- `src/server/routers/todos.ts` — 同上
- `src/server/routers/workflows.ts` — 同上
- `src/server/routers/learning.ts` — 同上
- `src/server/routers/dashboard.ts` — 同上
- `src/server/routers/token-usage.ts` — 同上 + ENABLE_TOKEN_USAGE 开关
- `src/app/api/chat/route.ts` — 加 auth 校验 + AI 速率限制
- `src/components/layout/sidebar.tsx` — 隐藏 Token Usage 入口（条件渲染）+ 添加登出按钮
- `src/app/usage/page.tsx` — 未启用时重定向
- `src/app/page.tsx` — Dashboard 隐藏 token usage 相关卡片
- `src/server/token-usage-local.ts` — 动态 import better-sqlite3 避免构建失败
- `.env.example` — 更新环境变量文档

### Deleted Files
- `src/server/db/path.ts` — 不再需要文件路径解析

---

## Task 1: 数据库驱动迁移（better-sqlite3 → libsql）

**Files:**
- Modify: `package.json`
- Modify: `src/server/db/index.ts`
- Delete: `src/server/db/path.ts`
- Modify: `drizzle.config.ts`
- Modify: `.env.example`

- [ ] **Step 1: 替换依赖**

```bash
pnpm remove better-sqlite3 @types/better-sqlite3
pnpm add @libsql/client
```

注意：`better-sqlite3` 仍被 `src/server/token-usage-local.ts` 引用，但该文件会在 Task 7 中处理为动态 import，此处先移除包声明。

- [ ] **Step 2: 更新 .env.example**

在 `.env.example` 文件顶部数据库部分，替换为：

```bash
# ── 数据库 ──────────────────────────────────────────
# 生产环境（Turso）
TURSO_DATABASE_URL=libsql://your-db-name-your-org.turso.io
TURSO_AUTH_TOKEN=your-turso-auth-token

# 本地开发（本地 SQLite 文件，不需要 auth token）
# TURSO_DATABASE_URL=file:data/second-brain.db
```

- [ ] **Step 3: 更新本地 .env.local**

确保 `.env.local` 包含：

```bash
TURSO_DATABASE_URL=file:data/second-brain.db
```

- [ ] **Step 4: 重写 src/server/db/index.ts**

将文件完整替换为：

```typescript
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });
```

- [ ] **Step 5: 删除 src/server/db/path.ts**

```bash
rm src/server/db/path.ts
```

- [ ] **Step 6: 更新 drizzle.config.ts**

将文件完整替换为：

```typescript
import { defineConfig } from "drizzle-kit";

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

- [ ] **Step 7: 修复 path.ts 的引用**

搜索 `resolveSqliteDbPath` 或 `from "./path"` 或 `from "../db/path"` 的所有引用，删除这些 import。目前已知只在 `drizzle.config.ts`（已处理）和 `src/server/db/index.ts`（已处理）中引用。

运行确认：

```bash
grep -r "resolveSqliteDbPath\|db/path\|from.*[\"'].*path[\"']" src/server/db/ drizzle.config.ts
```

预期：无输出（所有引用已清除）。

- [ ] **Step 8: 验证构建**

```bash
pnpm build
```

预期：构建可能因 `token-usage-local.ts` 引用 `better-sqlite3` 而失败。这会在 Task 7 处理。如果失败，暂时在 `token-usage-local.ts` 顶部将 `import Database from "better-sqlite3"` 改为动态 import 或注释掉，确保构建通过后继续。

临时修复（如构建失败）：在 `src/server/token-usage-local.ts` 文件顶部，将：
```typescript
import Database from "better-sqlite3";
```
替换为：
```typescript
// @ts-expect-error - better-sqlite3 removed, will be dynamically imported in Task 7
const Database = null;
```

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "feat: migrate database driver from better-sqlite3 to libsql (Turso)"
```

---

## Task 2: Auth.js v5 设置 — Schema + 配置

**Files:**
- Modify: `package.json`
- Modify: `src/server/db/schema.ts`
- Create: `src/lib/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`

- [ ] **Step 1: 安装依赖**

```bash
pnpm add next-auth@5 @auth/drizzle-adapter
```

- [ ] **Step 2: 在 schema.ts 中添加 Auth.js 所需表**

在 `src/server/db/schema.ts` 文件末尾（`tokenUsageEntries` 定义之后）追加：

```typescript
// ── Auth.js tables ──────────────────────────────────

export const users = sqliteTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: integer("email_verified", { mode: "timestamp" }),
  image: text("image"),
});

export const accounts = sqliteTable("accounts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
});
```

在文件顶部现有 import 旁边不需要改动，`text`、`integer` 已经导入。

- [ ] **Step 3: 创建 src/lib/auth.ts**

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
      if (user) {
        token.userId = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.userId) {
        session.user.id = token.userId as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
```

- [ ] **Step 4: 创建 Auth.js API route**

创建目录和文件 `src/app/api/auth/[...nextauth]/route.ts`：

```typescript
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 5: 更新 .env.example**

在 `.env.example` 中追加认证相关环境变量：

```bash
# ── 认证（Auth.js） ─────────────────────────────────
AUTH_SECRET=your-auth-secret              # openssl rand -base64 32
AUTH_GITHUB_ID=your-github-oauth-app-id
AUTH_GITHUB_SECRET=your-github-oauth-app-secret
AUTH_GOOGLE_ID=your-google-oauth-client-id
AUTH_GOOGLE_SECRET=your-google-oauth-client-secret
```

- [ ] **Step 6: 在 .env.local 添加 AUTH_SECRET**

本地开发需要 AUTH_SECRET，在 `.env.local` 中添加：

```bash
AUTH_SECRET=local-dev-secret-change-in-production
```

GitHub/Google OAuth 的 ID/SECRET 暂时可以不配，后续部署时配置。

- [ ] **Step 7: 生成并应用数据库迁移**

```bash
pnpm db:generate
pnpm db:push
```

预期：生成 users 和 accounts 表的迁移文件，成功应用到本地 SQLite。

- [ ] **Step 8: 验证构建**

```bash
pnpm build
```

预期：构建通过。Auth.js 配置就绪但 OAuth provider 未配置时不影响构建。

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "feat: add Auth.js v5 with GitHub/Google OAuth and Drizzle adapter"
```

---

## Task 3: 登录页面 + 路由保护

**Files:**
- Create: `src/app/login/page.tsx`
- Create: `src/middleware.ts`
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: 创建登录页面**

创建 `src/app/login/page.tsx`：

```tsx
import { auth, signIn } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const session = await auth();
  if (session) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 dark:bg-stone-950">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-stone-200 bg-white p-8 shadow-lg dark:border-stone-800 dark:bg-stone-900">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-stone-200 text-lg font-semibold text-stone-700 dark:bg-stone-800 dark:text-stone-200">
            S
          </div>
          <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
            Second Brain
          </h1>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            登录以访问你的知识库
          </p>
        </div>

        <div className="space-y-3">
          <form
            action={async () => {
              "use server";
              await signIn("github", { redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-800 dark:border-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
            >
              使用 GitHub 登录
            </button>
          </form>

          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
            >
              使用 Google 登录
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 middleware.ts 路由保护**

创建 `src/middleware.ts`：

```typescript
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;

  // 公开路径：登录页、Auth.js API、静态资源
  const isPublicPath =
    pathname === "/login" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon");

  if (!isLoggedIn && !isPublicPath) {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 3: 在侧边栏添加登出按钮**

在 `src/components/layout/sidebar.tsx` 中：

1. 导入 `signOut`。由于 sidebar 是客户端组件，需要用 `next-auth/react` 的 `signOut`：

在文件顶部 import 区域添加：
```typescript
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
```

2. 在暗色模式切换按钮下方添加登出按钮。找到 `</aside>` 闭合标签前的 `</div>`，在暗色模式按钮后添加：

```tsx
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-stone-600 transition-colors hover:bg-white/80 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
        >
          <LogOut className="h-4 w-4" />
          登出
        </button>
```

- [ ] **Step 4: 为 sidebar 添加 SessionProvider**

Auth.js 的客户端 `signOut` 需要 `SessionProvider`。检查 `src/app/layout.tsx` 中的 Providers 组件，在其中包裹 `SessionProvider`。

查看 `src/app/layout.tsx` 和 providers 文件，在最外层 provider 中添加：

```typescript
import { SessionProvider } from "next-auth/react";
```

用 `<SessionProvider>` 包裹 children。

- [ ] **Step 5: 登录页面需要独立布局**

登录页面不应显示侧边栏。由于 `src/app/layout.tsx` 包含侧边栏，需要让 `/login` 绕过它。

在 `src/app/login/layout.tsx` 中创建一个简单布局：

```tsx
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

同时修改 `src/app/layout.tsx`，使侧边栏只在非登录页面显示。具体方式取决于现有布局结构。最简单的方式：在 root layout 中不渲染侧边栏，而是在一个 `(app)` route group 中渲染侧边栏。

**但更简单的做法是**：login 页面的 layout 不继承 sidebar。检查当前 `src/app/layout.tsx` 的结构后决定最佳方式。关键是登录页不能有侧边栏。

- [ ] **Step 6: 验证**

```bash
pnpm build
```

预期：构建通过。访问任何页面应重定向到 /login（因为未配置 OAuth，无法真正登录，但页面应能渲染）。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat: add login page with OAuth buttons and route protection middleware"
```

---

## Task 4: 数据隔离 — Schema 加 userId

**Files:**
- Modify: `src/server/db/schema.ts`

- [ ] **Step 1: 给 6 张业务表添加 userId 字段**

在 `src/server/db/schema.ts` 中，给以下表添加 `userId` 字段。每张表的 `id` 字段后添加：

```typescript
userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
```

需要修改的表：
- `notes` — 在 `id` 行后加 `userId`
- `bookmarks` — 在 `id` 行后加 `userId`
- `todos` — 在 `id` 行后加 `userId`
- `chatMessages` — 在 `id` 行后加 `userId`
- `workflows` — 在 `id` 行后加 `userId`
- `learningPaths` — 在 `id` 行后加 `userId`

注意：`users` 表定义必须在这些表之前（Task 2 中已加在文件末尾），需要将 `users` 表移到文件顶部（在 `notes` 之前），否则 `references(() => users.id)` 会引用未定义的表。

同时给 `tokenUsageEntries` 也加 `userId`：

```typescript
userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
```

- [ ] **Step 2: 新增 aiUsage 表**

在 `schema.ts` 末尾添加：

```typescript
export const aiUsage = sqliteTable("ai_usage", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  date: text("date").notNull(), // 'YYYY-MM-DD'
  count: integer("count").notNull().default(0),
});
```

注意：SQLite 不支持复合 unique 约束在 Drizzle 的 `sqliteTable` 中直接定义，改用应用层 upsert 逻辑（ON CONFLICT）处理。

- [ ] **Step 3: 生成并应用迁移**

```bash
pnpm db:generate
pnpm db:push
```

预期：生成迁移文件，添加 userId 列和 ai_usage 表。

注意：现有数据没有 userId，`NOT NULL` 约束会失败。**解决方案**：先临时将 userId 设为可选（去掉 `.notNull()`），push 后手动给现有数据赋值，再改回 `NOT NULL` 并重新 push。

或者更简单的方式：因为本地开发数据库中的数据不重要（生产数据会通过 Turso import 单独处理），可以直接删除本地数据库文件让 db:push 重建：

```bash
rm -f data/second-brain.db data/second-brain.db-wal data/second-brain.db-shm
pnpm db:push
```

- [ ] **Step 4: 验证构建**

```bash
pnpm build
```

预期：构建通过。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: add userId to all business tables and create ai_usage table"
```

---

## Task 5: tRPC protectedProcedure + 所有 router 改造

**Files:**
- Modify: `src/server/trpc.ts`
- Modify: `src/server/routers/notes.ts`
- Modify: `src/server/routers/bookmarks.ts`
- Modify: `src/server/routers/todos.ts`
- Modify: `src/server/routers/workflows.ts`
- Modify: `src/server/routers/learning.ts`
- Modify: `src/server/routers/dashboard.ts`
- Modify: `src/server/routers/token-usage.ts`

- [ ] **Step 1: 在 trpc.ts 添加 protectedProcedure**

将 `src/server/trpc.ts` 替换为：

```typescript
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { auth } from "@/lib/auth";

const t = initTRPC.create({
  transformer: superjson,
});

const authMiddleware = t.middleware(async ({ next }) => {
  const session = await auth();
  if (!session?.user?.id) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { userId: session.user.id } });
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(authMiddleware);
```

- [ ] **Step 2: 改造 notes router**

将 `src/server/routers/notes.ts` 中所有 `publicProcedure` 替换为 `protectedProcedure`，import 改为 `import { router, protectedProcedure } from "../trpc"`。

每个 procedure 的改动模式：

**list** — 加 userId 过滤：
```typescript
list: protectedProcedure.query(async ({ ctx }) => {
  return db.select().from(notes).where(eq(notes.userId, ctx.userId)).orderBy(desc(notes.updatedAt));
}),
```

**get** — 加 userId 过滤：
```typescript
get: protectedProcedure
  .input(z.object({ id: z.string() }))
  .query(async ({ input, ctx }) => {
    const result = await db.select().from(notes).where(and(eq(notes.id, input.id), eq(notes.userId, ctx.userId)));
    return result[0] ?? null;
  }),
```

需要额外导入 `and` from `drizzle-orm`。

**create** — 插入时带 userId：
```typescript
.mutation(async ({ input, ctx }) => {
  const id = crypto.randomUUID();
  await db.insert(notes).values({ id, userId: ctx.userId, ...input });
  // ... rest unchanged
}),
```

**update** — where 条件加 userId：
```typescript
.mutation(async ({ input, ctx }) => {
  const { id, ...data } = input;
  await db.update(notes).set({ ...data, updatedAt: new Date() }).where(and(eq(notes.id, id), eq(notes.userId, ctx.userId)));
  // ... rest unchanged
}),
```

**delete** — where 条件加 userId：
```typescript
.mutation(async ({ input, ctx }) => {
  await db.delete(notes).where(and(eq(notes.id, input.id), eq(notes.userId, ctx.userId)));
  // ... rest unchanged
}),
```

- [ ] **Step 3: 改造 bookmarks router**

同样的模式。`src/server/routers/bookmarks.ts`：

- `import { router, protectedProcedure } from "../trpc"`
- 添加 `import { and } from "drizzle-orm"` 到现有 drizzle-orm import
- 所有 `publicProcedure` → `protectedProcedure`
- `list`: `.where(eq(bookmarks.userId, ctx.userId))`
- `create`: `values({ id, userId: ctx.userId, ...input, ... })`
- `update`: `.where(and(eq(bookmarks.id, id), eq(bookmarks.userId, ctx.userId)))`
- `refetch`: 读取时加 `.where(and(eq(bookmarks.id, input.id), eq(bookmarks.userId, ctx.userId)))`
- `delete`: `.where(and(eq(bookmarks.id, input.id), eq(bookmarks.userId, ctx.userId)))`

- [ ] **Step 4: 改造 todos router**

`src/server/routers/todos.ts`：

- `import { router, protectedProcedure } from "../trpc"`
- 添加 `and` 到 drizzle-orm import
- `list`: `.where(eq(todos.userId, ctx.userId))`
- `create`: `values({ id, userId: ctx.userId, ...input })`
- `update`: `.where(and(eq(todos.id, id), eq(todos.userId, ctx.userId)))`
- `delete`: `.where(and(eq(todos.id, input.id), eq(todos.userId, ctx.userId)))`

- [ ] **Step 5: 改造 workflows router**

`src/server/routers/workflows.ts`：

- `import { router, protectedProcedure } from "../trpc"`
- 添加 `and` 到 drizzle-orm import
- `list`: `.where(eq(workflows.userId, ctx.userId))`
- `get`: `.where(and(eq(workflows.id, input.id), eq(workflows.userId, ctx.userId)))`
- `create`: `values({ id, userId: ctx.userId, ...input })`
- `update`: `.where(and(eq(workflows.id, id), eq(workflows.userId, ctx.userId)))`
- `delete`: 删除 runs 时也要确保 workflow 属于当前用户：先查 workflow 归属再删除
- `listRuns`: 先验证 workflow 归属，再查 runs
- `seedPresets`: 插入时带 `userId: ctx.userId`

- [ ] **Step 6: 改造 learning router**

`src/server/routers/learning.ts`：

- `import { router, protectedProcedure } from "../trpc"`
- 添加 `and` 到 drizzle-orm import
- `listPaths`: `.where(eq(learningPaths.userId, ctx.userId))`
- `getPath`: `.where(and(eq(learningPaths.id, input.id), eq(learningPaths.userId, ctx.userId)))`
- `createPath`: `values({ id, userId: ctx.userId, ...input })`
- `seedPresets`: 查 existing 时按 userId 过滤，插入时带 userId
- `getLesson`: 需要 join 或先查 path 归属 — 最简单的方式是查 lesson 后验证其 path 属于当前用户
- `completeLesson`: 同上
- `saveLessonNotes`: 同上

- [ ] **Step 7: 改造 dashboard router**

`src/server/routers/dashboard.ts`：

- `import { router, protectedProcedure } from "../trpc"`
- `stats` 中所有查询加 `.where(eq(table.userId, ctx.userId))`：
  - noteCount、todoCount、doneCount、recentNotes、pendingTodos、todayTodos
- `search` 中所有查询加 userId 过滤：
  - noteResults、bookmarkResults、todoResults 的 where 条件中用 `and(eq(table.userId, ctx.userId), or(...))`

- [ ] **Step 8: 改造 token-usage router**

`src/server/routers/token-usage.ts`：

- `import { router, protectedProcedure } from "../trpc"`
- `list` 和 `overview`: 查询 `tokenUsageEntries` 时加 `.where(eq(tokenUsageEntries.userId, ctx.userId))`
- `create`: 插入时带 `userId: ctx.userId`
- `delete`: `.where(and(eq(tokenUsageEntries.id, input.id), eq(tokenUsageEntries.userId, ctx.userId)))`

- [ ] **Step 9: 验证构建**

```bash
pnpm build
```

预期：构建通过。所有 router 已改为 protectedProcedure。

- [ ] **Step 10: 提交**

```bash
git add -A
git commit -m "feat: add protectedProcedure and userId isolation to all tRPC routers"
```

---

## Task 6: AI 速率限制

**Files:**
- Modify: `src/server/trpc.ts`（或新建 `src/server/ai-rate-limit.ts`）
- Modify: `src/app/api/chat/route.ts`

- [ ] **Step 1: 创建 AI 速率限制辅助函数**

Chat API 是 Next.js Route Handler（不是 tRPC），所以限流逻辑需要作为独立函数，同时可以被 tRPC middleware 和 Route Handler 调用。

创建 `src/server/ai-rate-limit.ts`：

```typescript
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { aiUsage } from "./db/schema";

const AI_DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 50;

export async function checkAiRateLimit(userId: string): Promise<{ allowed: boolean; remaining: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const [usage] = await db
    .select()
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), eq(aiUsage.date, today)));

  const currentCount = usage?.count ?? 0;
  return {
    allowed: currentCount < AI_DAILY_LIMIT,
    remaining: Math.max(0, AI_DAILY_LIMIT - currentCount),
  };
}

export async function recordAiUsage(userId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await db
    .insert(aiUsage)
    .values({ id: crypto.randomUUID(), userId, date: today, count: 1 })
    .onConflictDoUpdate({
      target: [aiUsage.userId, aiUsage.date],
      set: { count: sql`${aiUsage.count} + 1` },
    });
}
```

注意：`onConflictDoUpdate` 需要 `(userId, date)` 的唯一约束。回到 `schema.ts` 中用 Drizzle 的 `uniqueIndex` 或在 `aiUsage` 表上添加唯一约束。

更新 `schema.ts` 中的 `aiUsage` 表定义，使用 `unique()` 或者用 SQL 级别的约束：

```typescript
import { sqliteTable, text, integer, real, blob, uniqueIndex } from "drizzle-orm/sqlite-core";

// 在 aiUsage 表定义中添加：
export const aiUsage = sqliteTable("ai_usage", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  count: integer("count").notNull().default(0),
}, (table) => [
  uniqueIndex("ai_usage_user_date_idx").on(table.userId, table.date),
]);
```

- [ ] **Step 2: 在 chat route 中加 auth + 限流**

修改 `src/app/api/chat/route.ts` 的 `POST` 函数：

在文件顶部添加 import：
```typescript
import { auth } from "@/lib/auth";
import { checkAiRateLimit, recordAiUsage } from "@/server/ai-rate-limit";
```

在 `POST` 函数开头添加 auth 和限流检查：

```typescript
export async function POST(req: Request) {
  // Auth check
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit check
  const { allowed, remaining } = await checkAiRateLimit(session.user.id);
  if (!allowed) {
    return Response.json(
      { error: "Daily AI usage limit reached" },
      { status: 429 }
    );
  }

  const body = await req.json();
  // ... existing code ...

  try {
    // ... existing code ...

    // Record usage after successful response creation
    const response = await streamChatResponse({ ... });
    void recordAiUsage(session.user.id);
    return response;
  } catch (error) {
    // ... existing error handling ...
  }
}
```

- [ ] **Step 3: 更新 .env.example**

在 `.env.example` 中追加：

```bash
# ── AI 速率限制 ──────────────────────────────────────
AI_DAILY_LIMIT=50                         # 每用户每天 AI 调用上限
```

- [ ] **Step 4: 生成迁移并验证**

```bash
pnpm db:generate
pnpm db:push
pnpm build
```

预期：迁移成功，构建通过。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: add AI rate limiting with per-user daily count"
```

---

## Task 7: Token Usage 模块线上禁用

**Files:**
- Modify: `src/server/token-usage-local.ts`
- Modify: `src/server/routers/token-usage.ts`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/app/usage/page.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: 处理 better-sqlite3 动态导入**

`src/server/token-usage-local.ts` 顶部有 `import Database from "better-sqlite3"`。由于 better-sqlite3 已被移除，需要改为动态导入并在模块不可用时优雅降级。

将文件顶部的：
```typescript
import Database from "better-sqlite3";
```

替换为一个懒加载函数：
```typescript
async function loadBetterSqlite3(): Promise<typeof import("better-sqlite3") | null> {
  try {
    return await import("better-sqlite3");
  } catch {
    return null;
  }
}
```

然后在使用 `Database` 的地方改为调用这个函数。但由于 `ENABLE_TOKEN_USAGE=false` 时整个模块不会被调用，更简单的做法是：

在 `readWorkspaceLocalTokenUsage` 函数（即模块的主入口）顶部加一个早退出：

```typescript
export function readWorkspaceLocalTokenUsage() {
  if (process.env.ENABLE_TOKEN_USAGE !== "true") {
    return { entries: [], localSources: [] };
  }
  // ... existing code
}
```

然后将 `import Database from "better-sqlite3"` 改为在实际使用处动态 import：

```typescript
// 替换所有 new Database(...) 调用为：
const { default: Database } = await import("better-sqlite3");
const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
```

如果函数是同步的，需要改为 async。

**最简单的方案**：既然线上 `ENABLE_TOKEN_USAGE=false`，而本地开发可以重新安装 `better-sqlite3` 作为 optional dependency，把它改成条件 require：

```typescript
function tryRequireBetterSqlite3() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("better-sqlite3");
  } catch {
    return null;
  }
}
```

这样 Vercel 构建时不会因为找不到 better-sqlite3 而失败（require 是运行时的，且被 try-catch 包裹）。

- [ ] **Step 2: 在 sidebar 中隐藏 Token Usage 入口**

在 `src/components/layout/sidebar.tsx` 中，navItems 数组中过滤掉 Token Usage。

由于环境变量在客户端组件中不可直接访问，需要通过 `NEXT_PUBLIC_` 前缀暴露：

在 `.env.example` 和 `.env.local` 中：
```bash
NEXT_PUBLIC_ENABLE_TOKEN_USAGE=true   # 本地开发
```

在 sidebar 中：
```typescript
const navItems = [
  { href: "/", label: "首页", icon: LayoutDashboard },
  { href: "/notes", label: "笔记", icon: FileText },
  { href: "/bookmarks", label: "收藏", icon: Bookmark },
  ...(process.env.NEXT_PUBLIC_ENABLE_TOKEN_USAGE === "true"
    ? [{ href: "/usage", label: "Token 用量", icon: Activity }]
    : []),
  { href: "/todos", label: "Todo", icon: CheckSquare },
  { href: "/explore", label: "AI 探索", icon: Compass },
  { href: "/ask", label: "Ask AI", icon: MessageCircle },
];
```

- [ ] **Step 3: /usage 页面未启用时重定向**

在 `src/app/usage/page.tsx` 顶部添加服务端检查：

```typescript
import { redirect } from "next/navigation";

// 在组件函数开头：
if (process.env.ENABLE_TOKEN_USAGE !== "true" && process.env.NEXT_PUBLIC_ENABLE_TOKEN_USAGE !== "true") {
  redirect("/");
}
```

注意：`/usage` 页面可能是客户端组件（`"use client"`），如果是的话需要用其他方式处理。如果是客户端组件，可以在父级 layout 或用 middleware 处理。或者将重定向逻辑放在一个服务端 wrapper 组件中。

- [ ] **Step 4: Dashboard 隐藏 token usage 卡片**

在 `src/app/page.tsx` 中，用条件渲染包裹 token usage 相关的卡片和组件。Dashboard 页面可能是服务端组件，可以直接读 `process.env.ENABLE_TOKEN_USAGE`。

找到 Dashboard 中 token usage 相关的 JSX 块，用条件包裹：

```typescript
const enableTokenUsage = process.env.ENABLE_TOKEN_USAGE === "true";
```

在 JSX 中：
```tsx
{enableTokenUsage && (
  // ... token usage 相关卡片
)}
```

- [ ] **Step 5: 更新 .env.local 和 .env.example**

`.env.local` 添加：
```bash
ENABLE_TOKEN_USAGE=true
NEXT_PUBLIC_ENABLE_TOKEN_USAGE=true
```

`.env.example` 添加：
```bash
# ── 功能开关 ──────────────────────────────────────────
ENABLE_TOKEN_USAGE=false                  # 线上设为 false
NEXT_PUBLIC_ENABLE_TOKEN_USAGE=false      # 客户端同步
```

- [ ] **Step 6: 验证构建**

```bash
pnpm build
```

预期：构建通过。即使 better-sqlite3 不存在，构建也不报错。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat: add feature flag to disable Token Usage module for production"
```

---

## Task 8: E2E 测试适配

**Files:**
- Modify: `e2e/phase2.spec.ts`
- Modify: `e2e/v1-core-paths.spec.ts`
- Modify: `playwright.config.ts`（如需要）

- [ ] **Step 1: 分析 E2E 测试影响**

现在所有页面都需要登录。E2E 测试需要绕过或模拟认证。

两种方式：
1. **环境变量关闭认证** — 在测试环境中设置 `AUTH_BYPASS=true`，middleware 中检查此变量时跳过认证
2. **Mock session** — 在测试 setup 中注入 session cookie

推荐方式 1（简单直接）：

在 `src/middleware.ts` 中添加：
```typescript
// 测试环境绕过认证
if (process.env.AUTH_BYPASS === "true") {
  return NextResponse.next();
}
```

在 tRPC 的 `authMiddleware` 中也添加类似逻辑：
```typescript
if (process.env.AUTH_BYPASS === "true") {
  return next({ ctx: { userId: process.env.AUTH_BYPASS_USER_ID || "test-user" } });
}
```

在 `playwright.config.ts` 或 `.env.test` 中设：
```bash
AUTH_BYPASS=true
AUTH_BYPASS_USER_ID=test-user
```

chat route 的 auth 检查也需要同样处理。

- [ ] **Step 2: 在 tRPC routers 中确保测试数据有正确的 userId**

E2E 测试创建的数据现在需要有 userId。由于 `AUTH_BYPASS_USER_ID=test-user`，所有测试数据会自动带上这个 userId。

- [ ] **Step 3: 运行 E2E 测试**

```bash
pnpm test:e2e
```

根据失败情况修复。主要关注：
- 页面是否能正常加载（不被重定向到 /login）
- CRUD 操作是否正常（userId 过滤是否正确）

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "feat: add auth bypass for E2E testing environment"
```

---

## Task 9: 最终验证 + 清理

**Files:**
- Modify: `.env.example`（最终确认）
- Possibly: 其他清理

- [ ] **Step 1: 完整验证流程**

```bash
pnpm build
pnpm lint
pnpm test:e2e
```

所有三步必须通过。

- [ ] **Step 2: 清理**

- 检查是否有未使用的 import（`resolveSqliteDbPath` 等）
- 确认 `path.ts` 已删除且无引用
- 确认 `.gitignore` 排除 `data/*.db*`
- 确认 `.env.local` 不在 git 中

```bash
git status
grep -r "path.ts\|resolveSqliteDbPath\|better-sqlite3" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v token-usage-local
```

- [ ] **Step 3: 更新 README.md**

更新快速开始中的环境变量说明，反映新的 `TURSO_DATABASE_URL`、`AUTH_*` 等变量。

- [ ] **Step 4: 更新 docs/changelog/**

创建 `docs/changelog/vercel-deployment-prep.md` 记录本次改动。

- [ ] **Step 5: 最终提交**

```bash
git add -A
git commit -m "chore: final cleanup and documentation for Vercel deployment"
```

---

## 部署步骤（手动，非代码任务）

以下步骤在代码完成后手动执行：

1. **创建 Turso 数据库**
   ```bash
   turso db create second-brain
   turso db import second-brain data/second-brain.db
   turso db tokens create second-brain
   ```

2. **创建 GitHub OAuth App**
   - GitHub Settings → Developer settings → OAuth Apps → New
   - Homepage URL: `https://xxx.vercel.app`
   - Callback URL: `https://xxx.vercel.app/api/auth/callback/github`

3. **创建 Google OAuth App**
   - Google Cloud Console → Credentials → Create OAuth 2.0 Client ID
   - Authorized redirect URI: `https://xxx.vercel.app/api/auth/callback/google`

4. **Vercel 部署**
   - 连接 GitHub 仓库
   - 配置所有环境变量
   - 部署

5. **数据迁移**
   - 首次登录拿到 userId
   - 在 Turso shell 中执行 `UPDATE ... SET userId = 'xxx' WHERE userId IS NULL`
   - 重新 push schema 将 userId 改为 NOT NULL（如需要）
