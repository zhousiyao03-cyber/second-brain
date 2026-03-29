# Focus Tracker 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现自动专注时长追踪工具——Tauri menubar 桌面端采集窗口活动，Web 端展示分析和 AI 总结。

**Architecture:** Tauri menubar 程序每 5 秒采集活跃窗口（app name + window title），合并成会话后写入共享 SQLite。Second Brain Web 端读取数据，通过 AI 生成分类和描述，在 Dashboard 卡片和 /focus 页面展示每日/每周分析。

**Tech Stack:** Tauri v2 (Rust + React), Next.js 16, tRPC v11, Drizzle ORM, LibSQL, Vercel AI SDK, zod v4

---

## Part 1: Web 端 Focus 模块

### 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| Create | `src/server/db/schema.ts` (追加) | activity_sessions + focus_daily_summaries 表 |
| Create | `src/server/routers/focus.ts` | Focus tRPC router |
| Modify | `src/server/routers/_app.ts` | 注册 focus router |
| Create | `src/server/ai/focus.ts` | AI 分类和总结逻辑 |
| Modify | `src/components/layout/navigation.ts` | 添加 Focus 导航项 |
| Create | `src/app/(app)/focus/page.tsx` | /focus 页面 |
| Create | `src/components/focus/stats-cards.tsx` | 指标卡片组件 |
| Create | `src/components/focus/timeline-bar.tsx` | 时间线色条组件 |
| Create | `src/components/focus/category-breakdown.tsx` | 分类占比组件 |
| Create | `src/components/focus/activity-log.tsx` | Activity Log 表格组件 |
| Create | `src/components/focus/ai-summary.tsx` | AI Summary 区块组件 |
| Create | `src/components/focus/history-section.tsx` | 历史趋势区组件 |
| Create | `src/components/focus/date-picker.tsx` | 日期切换器组件 |
| Create | `src/components/focus/dashboard-card.tsx` | Dashboard 专注卡片 |
| Modify | `src/app/(app)/page.tsx` | 集成 Dashboard 专注卡片 |
| Create | `src/lib/focus-utils.ts` | 时间格式化等工具函数 |
| Create | `e2e/focus.spec.ts` | E2E 测试 |

---

### Task 1: 数据库 Schema

**Files:**
- Modify: `src/server/db/schema.ts`

- [ ] **Step 1: 在 schema.ts 末尾添加 activity_sessions 和 focus_daily_summaries 表**

```typescript
// ── Focus tracking tables ──────────────────────────────

export const activitySessions = sqliteTable("activity_sessions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  appName: text("app_name").notNull(),
  windowTitle: text("window_title"),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp" }).notNull(),
  durationSecs: integer("duration_secs").notNull(),
  category: text("category"),
  aiSummary: text("ai_summary"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const focusDailySummaries = sqliteTable(
  "focus_daily_summaries",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    totalFocusSecs: integer("total_focus_secs").notNull().default(0),
    categoryBreakdown: text("category_breakdown"),
    aiAnalysis: text("ai_analysis"),
    generatedAt: integer("generated_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("focus_daily_user_date_idx").on(table.userId, table.date),
  ]
);
```

- [ ] **Step 2: 生成并应用迁移**

```bash
pnpm db:generate
pnpm db:push
```

Expected: 迁移成功，新增 activity_sessions 和 focus_daily_summaries 两张表。

- [ ] **Step 3: Commit**

```bash
git add src/server/db/schema.ts drizzle/
git commit -m "feat(focus): add activity_sessions and focus_daily_summaries tables"
```

---

### Task 2: 工具函数

**Files:**
- Create: `src/lib/focus-utils.ts`

- [ ] **Step 1: 创建 focus-utils.ts**

```typescript
/**
 * 将秒数格式化为 "Xh Ym" 形式
 */
export function formatDuration(totalSecs: number): string {
  const hours = Math.floor(totalSecs / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * 计算目标完成百分比（每日 8 小时）
 */
export function calcGoalPercent(totalSecs: number, goalHours = 8): number {
  return Math.min(100, Math.round((totalSecs / (goalHours * 3600)) * 100));
}

/**
 * 分类对应的颜色
 */
export const CATEGORY_COLORS: Record<string, string> = {
  coding: "#3b82f6",
  research: "#f59e0b",
  meeting: "#a78bfa",
  communication: "#ec4899",
  design: "#14b8a6",
  writing: "#f97316",
  other: "#6b7280",
};

export function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.other;
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * 格式化日期为用户可读格式
 */
export function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);

  if (target.getTime() === today.getTime()) {
    return `Today, ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }

  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/focus-utils.ts
git commit -m "feat(focus): add focus utility functions"
```

---

### Task 3: AI 分类和总结

**Files:**
- Create: `src/server/ai/focus.ts`

- [ ] **Step 1: 创建 focus.ts**

```typescript
import { generateStructuredData } from "./provider";
import { z } from "zod/v4";

const sessionClassificationSchema = z.object({
  sessions: z.array(
    z.object({
      id: z.string(),
      category: z.string(),
      summary: z.string(),
    })
  ),
});

/**
 * 批量为未分类的活动会话生成分类和描述
 */
export async function classifyActivitySessions(
  sessions: Array<{ id: string; appName: string; windowTitle: string | null; durationSecs: number }>
) {
  if (sessions.length === 0) return [];

  const sessionList = sessions
    .map(
      (s) =>
        `- id: ${s.id} | app: ${s.appName} | title: ${s.windowTitle ?? "(no title)"} | duration: ${Math.round(s.durationSecs / 60)}min`
    )
    .join("\n");

  const result = await generateStructuredData({
    name: "session_classification",
    description: "Classify activity sessions into categories and generate one-line descriptions",
    prompt: `Classify each activity session below into one category and write a concise one-line description of what the user was doing.

Categories: coding, research, meeting, communication, design, writing, other

Sessions:
${sessionList}

For each session, return its id, category, and a natural language summary (e.g. "Implemented JWT refresh token logic in auth module").`,
    schema: sessionClassificationSchema,
  });

  return result.sessions;
}

/**
 * 生成每日专注总结
 */
export async function generateDailySummary(
  sessions: Array<{
    appName: string;
    windowTitle: string | null;
    startedAt: Date;
    endedAt: Date;
    durationSecs: number;
    category: string | null;
    aiSummary: string | null;
  }>,
  totalSecs: number,
  categoryBreakdown: Record<string, number>
) {
  const timeline = sessions
    .map((s) => {
      const start = s.startedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
      const end = s.endedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
      const desc = s.aiSummary ?? `${s.appName} - ${s.windowTitle ?? ""}`;
      const cat = s.category ?? "other";
      return `${start}-${end} [${cat}] ${desc} (${Math.round(s.durationSecs / 60)}min)`;
    })
    .join("\n");

  const breakdown = Object.entries(categoryBreakdown)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, secs]) => `${cat}: ${Math.round(secs / 60)}min`)
    .join(", ");

  const totalHours = (totalSecs / 3600).toFixed(1);

  const result = await generateStructuredData({
    name: "daily_focus_summary",
    description: "Generate a natural language daily focus summary",
    prompt: `You are a productivity assistant. Generate a concise daily work summary in 2-3 sentences based on the following activity data.

Total focus time: ${totalHours} hours
Category breakdown: ${breakdown}

Activity timeline:
${timeline}

Summarize what the user accomplished, note their most productive period, and mention any patterns (e.g. frequent context switching, long deep work sessions). Keep it factual and actionable.`,
    schema: z.object({ summary: z.string() }),
  });

  return result.summary;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/ai/focus.ts
git commit -m "feat(focus): add AI classification and summary generation"
```

---

### Task 4: tRPC Focus Router

**Files:**
- Create: `src/server/routers/focus.ts`
- Modify: `src/server/routers/_app.ts`

- [ ] **Step 1: 创建 focus router**

```typescript
import { z } from "zod/v4";
import { router, protectedProcedure } from "../trpc";
import { db } from "../db";
import { activitySessions, focusDailySummaries } from "../db/schema";
import { and, desc, eq, gte, lt, sql, isNull } from "drizzle-orm";
import { classifyActivitySessions, generateDailySummary } from "../ai/focus";
import { toDateString } from "@/lib/focus-utils";

export const focusRouter = router({
  /**
   * 获取指定日期的活动会话列表
   */
  dailySessions: protectedProcedure
    .input(z.object({ date: z.string() }))
    .query(async ({ ctx, input }) => {
      const dayStart = new Date(input.date + "T00:00:00");
      const dayEnd = new Date(input.date + "T23:59:59.999");

      return db
        .select()
        .from(activitySessions)
        .where(
          and(
            eq(activitySessions.userId, ctx.userId),
            gte(activitySessions.startedAt, dayStart),
            lt(activitySessions.startedAt, dayEnd)
          )
        )
        .orderBy(activitySessions.startedAt);
    }),

  /**
   * 获取指定日期的统计数据
   */
  dailyStats: protectedProcedure
    .input(z.object({ date: z.string() }))
    .query(async ({ ctx, input }) => {
      const dayStart = new Date(input.date + "T00:00:00");
      const dayEnd = new Date(input.date + "T23:59:59.999");

      const sessions = await db
        .select()
        .from(activitySessions)
        .where(
          and(
            eq(activitySessions.userId, ctx.userId),
            gte(activitySessions.startedAt, dayStart),
            lt(activitySessions.startedAt, dayEnd)
          )
        )
        .orderBy(activitySessions.startedAt);

      const totalSecs = sessions.reduce((sum, s) => sum + s.durationSecs, 0);

      // 分类时长分布
      const categoryBreakdown: Record<string, number> = {};
      for (const s of sessions) {
        const cat = s.category ?? "other";
        categoryBreakdown[cat] = (categoryBreakdown[cat] ?? 0) + s.durationSecs;
      }

      // 最长连续专注时段
      let longestStreak = 0;
      let currentStreak = 0;
      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        const prev = sessions[i - 1];
        const gap = prev
          ? (s.startedAt.getTime() - prev.endedAt.getTime()) / 1000
          : 0;

        if (i === 0 || gap <= 120) {
          currentStreak += s.durationSecs;
        } else {
          currentStreak = s.durationSecs;
        }
        longestStreak = Math.max(longestStreak, currentStreak);
      }

      // 应用切换次数
      let appSwitches = 0;
      for (let i = 1; i < sessions.length; i++) {
        if (sessions[i].appName !== sessions[i - 1].appName) {
          appSwitches++;
        }
      }

      return {
        totalSecs,
        categoryBreakdown,
        longestStreakSecs: longestStreak,
        appSwitches,
        sessionCount: sessions.length,
      };
    }),

  /**
   * 获取一周的每日统计（用于柱状图）
   */
  weeklyStats: protectedProcedure
    .input(z.object({ weekStart: z.string() }))
    .query(async ({ ctx, input }) => {
      const start = new Date(input.weekStart + "T00:00:00");
      const end = new Date(start);
      end.setDate(end.getDate() + 7);

      const sessions = await db
        .select()
        .from(activitySessions)
        .where(
          and(
            eq(activitySessions.userId, ctx.userId),
            gte(activitySessions.startedAt, start),
            lt(activitySessions.startedAt, end)
          )
        )
        .orderBy(activitySessions.startedAt);

      // 按天分组
      const dailyMap: Record<string, { totalSecs: number; categoryBreakdown: Record<string, number> }> = {};
      for (let d = 0; d < 7; d++) {
        const date = new Date(start);
        date.setDate(date.getDate() + d);
        dailyMap[toDateString(date)] = { totalSecs: 0, categoryBreakdown: {} };
      }

      for (const s of sessions) {
        const dateKey = toDateString(s.startedAt);
        if (!dailyMap[dateKey]) continue;
        dailyMap[dateKey].totalSecs += s.durationSecs;
        const cat = s.category ?? "other";
        dailyMap[dateKey].categoryBreakdown[cat] =
          (dailyMap[dateKey].categoryBreakdown[cat] ?? 0) + s.durationSecs;
      }

      return Object.entries(dailyMap).map(([date, data]) => ({
        date,
        ...data,
      }));
    }),

  /**
   * AI 分类未处理的会话
   */
  classifySessions: protectedProcedure
    .input(z.object({ date: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const dayStart = new Date(input.date + "T00:00:00");
      const dayEnd = new Date(input.date + "T23:59:59.999");

      const unclassified = await db
        .select()
        .from(activitySessions)
        .where(
          and(
            eq(activitySessions.userId, ctx.userId),
            gte(activitySessions.startedAt, dayStart),
            lt(activitySessions.startedAt, dayEnd),
            isNull(activitySessions.category)
          )
        );

      if (unclassified.length === 0) return { classified: 0 };

      const results = await classifyActivitySessions(
        unclassified.map((s) => ({
          id: s.id,
          appName: s.appName,
          windowTitle: s.windowTitle,
          durationSecs: s.durationSecs,
        }))
      );

      for (const r of results) {
        await db
          .update(activitySessions)
          .set({ category: r.category, aiSummary: r.summary })
          .where(eq(activitySessions.id, r.id));
      }

      return { classified: results.length };
    }),

  /**
   * 生成/刷新每日 AI 总结
   */
  generateSummary: protectedProcedure
    .input(z.object({ date: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const dayStart = new Date(input.date + "T00:00:00");
      const dayEnd = new Date(input.date + "T23:59:59.999");

      const sessions = await db
        .select()
        .from(activitySessions)
        .where(
          and(
            eq(activitySessions.userId, ctx.userId),
            gte(activitySessions.startedAt, dayStart),
            lt(activitySessions.startedAt, dayEnd)
          )
        )
        .orderBy(activitySessions.startedAt);

      if (sessions.length === 0) return { summary: null };

      const totalSecs = sessions.reduce((sum, s) => sum + s.durationSecs, 0);
      const categoryBreakdown: Record<string, number> = {};
      for (const s of sessions) {
        const cat = s.category ?? "other";
        categoryBreakdown[cat] = (categoryBreakdown[cat] ?? 0) + s.durationSecs;
      }

      const summary = await generateDailySummary(sessions, totalSecs, categoryBreakdown);

      // upsert
      const existing = await db
        .select()
        .from(focusDailySummaries)
        .where(
          and(
            eq(focusDailySummaries.userId, ctx.userId),
            eq(focusDailySummaries.date, input.date)
          )
        );

      if (existing.length > 0) {
        await db
          .update(focusDailySummaries)
          .set({
            totalFocusSecs: totalSecs,
            categoryBreakdown: JSON.stringify(categoryBreakdown),
            aiAnalysis: summary,
            generatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(focusDailySummaries.id, existing[0].id));
      } else {
        await db.insert(focusDailySummaries).values({
          userId: ctx.userId,
          date: input.date,
          totalFocusSecs: totalSecs,
          categoryBreakdown: JSON.stringify(categoryBreakdown),
          aiAnalysis: summary,
          generatedAt: new Date(),
        });
      }

      return { summary };
    }),

  /**
   * 获取已保存的每日总结
   */
  getDailySummary: protectedProcedure
    .input(z.object({ date: z.string() }))
    .query(async ({ ctx, input }) => {
      const [result] = await db
        .select()
        .from(focusDailySummaries)
        .where(
          and(
            eq(focusDailySummaries.userId, ctx.userId),
            eq(focusDailySummaries.date, input.date)
          )
        );

      return result ?? null;
    }),
});
```

- [ ] **Step 2: 在 _app.ts 中注册 focus router**

在 `src/server/routers/_app.ts` 中添加：

```typescript
import { focusRouter } from "./focus";

// 在 appRouter 中添加:
focus: focusRouter,
```

- [ ] **Step 3: Commit**

```bash
git add src/server/routers/focus.ts src/server/routers/_app.ts
git commit -m "feat(focus): add tRPC focus router with daily/weekly stats and AI endpoints"
```

---

### Task 5: 日期切换器组件

**Files:**
- Create: `src/components/focus/date-picker.tsx`

- [ ] **Step 1: 创建日期切换器**

```tsx
"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatDateLabel, toDateString } from "@/lib/focus-utils";

export function FocusDatePicker({
  date,
  onChange,
}: {
  date: string;
  onChange: (date: string) => void;
}) {
  const today = toDateString(new Date());
  const isToday = date === today;

  function shift(days: number) {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + days);
    onChange(toDateString(d));
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => shift(-1)}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-600 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="rounded-lg border border-stone-200 bg-white px-4 py-1.5 text-sm font-medium text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100">
        {formatDateLabel(date)}
      </div>
      <button
        type="button"
        onClick={() => shift(1)}
        disabled={isToday}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-600 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-30 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/focus/date-picker.tsx
git commit -m "feat(focus): add date picker component"
```

---

### Task 6: 指标卡片组件

**Files:**
- Create: `src/components/focus/stats-cards.tsx`

- [ ] **Step 1: 创建指标卡片**

```tsx
import { formatDuration, calcGoalPercent } from "@/lib/focus-utils";

type StatsCardsProps = {
  totalSecs: number;
  longestStreakSecs: number;
  appSwitches: number;
  goalHours?: number;
};

export function StatsCards({
  totalSecs,
  longestStreakSecs,
  appSwitches,
  goalHours = 8,
}: StatsCardsProps) {
  const items = [
    { label: "Total Focus", value: formatDuration(totalSecs) },
    { label: "Daily Goal", value: `${calcGoalPercent(totalSecs, goalHours)}%` },
    { label: "Longest Streak", value: formatDuration(longestStreakSecs) },
    { label: "App Switches", value: String(appSwitches) },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-2xl border border-stone-200 bg-white p-4 text-center dark:border-stone-800 dark:bg-stone-900"
        >
          <div className="text-2xl font-bold text-stone-900 dark:text-stone-50">
            {item.value}
          </div>
          <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            {item.label}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/focus/stats-cards.tsx
git commit -m "feat(focus): add stats cards component"
```

---

### Task 7: 时间线色条组件

**Files:**
- Create: `src/components/focus/timeline-bar.tsx`

- [ ] **Step 1: 创建时间线色条**

```tsx
import { getCategoryColor } from "@/lib/focus-utils";

type Session = {
  startedAt: Date;
  endedAt: Date;
  durationSecs: number;
  category: string | null;
};

export function TimelineBar({ sessions }: { sessions: Session[] }) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
        <div className="text-sm font-semibold text-stone-900 dark:text-stone-100">
          Timeline
        </div>
        <div className="mt-3 text-sm text-stone-400">No activity data</div>
      </div>
    );
  }

  const totalSecs = sessions.reduce((sum, s) => sum + s.durationSecs, 0);
  // 用 8 小时作为时间线总宽度的参考
  const timelineTotal = Math.max(totalSecs, 8 * 3600);

  // 收集 unique 分类
  const categories = [...new Set(sessions.map((s) => s.category ?? "other"))];

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-3 text-sm font-semibold text-stone-900 dark:text-stone-100">
        Timeline
      </div>
      <div className="flex h-6 gap-px overflow-hidden rounded-md">
        {sessions.map((s, i) => (
          <div
            key={i}
            style={{
              flex: s.durationSecs / timelineTotal,
              backgroundColor: getCategoryColor(s.category ?? "other"),
            }}
            title={`${s.category ?? "other"}: ${Math.round(s.durationSecs / 60)}min`}
          />
        ))}
        {/* 剩余空间 */}
        <div
          style={{ flex: Math.max(0, timelineTotal - totalSecs) / timelineTotal }}
          className="bg-stone-100 dark:bg-stone-800"
        />
      </div>
      <div className="mt-1 flex justify-between">
        <span className="text-[10px] text-stone-400">9:00</span>
        <span className="text-[10px] text-stone-400">12:00</span>
        <span className="text-[10px] text-stone-400">15:00</span>
        <span className="text-[10px] text-stone-400">18:00</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        {categories.map((cat) => (
          <div key={cat} className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
            <div
              className="h-2 w-2 rounded-sm"
              style={{ backgroundColor: getCategoryColor(cat) }}
            />
            {cat}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/focus/timeline-bar.tsx
git commit -m "feat(focus): add timeline bar component"
```

---

### Task 8: 分类占比组件

**Files:**
- Create: `src/components/focus/category-breakdown.tsx`

- [ ] **Step 1: 创建分类占比**

```tsx
import { formatDuration, getCategoryColor } from "@/lib/focus-utils";

export function CategoryBreakdown({
  breakdown,
}: {
  breakdown: Record<string, number>;
}) {
  const sorted = Object.entries(breakdown).sort(([, a], [, b]) => b - a);
  const maxSecs = sorted[0]?.[1] ?? 1;

  if (sorted.length === 0) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
        <div className="text-sm font-semibold text-stone-900 dark:text-stone-100">
          Categories
        </div>
        <div className="mt-3 text-sm text-stone-400">No data</div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-4 text-sm font-semibold text-stone-900 dark:text-stone-100">
        Categories
      </div>
      <div className="space-y-3">
        {sorted.map(([category, secs]) => (
          <div key={category}>
            <div className="mb-1 flex justify-between text-sm">
              <span className="text-stone-900 dark:text-stone-100">{category}</span>
              <span className="text-stone-500 dark:text-stone-400">{formatDuration(secs)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(secs / maxSecs) * 100}%`,
                  backgroundColor: getCategoryColor(category),
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/focus/category-breakdown.tsx
git commit -m "feat(focus): add category breakdown component"
```

---

### Task 9: Activity Log 表格组件

**Files:**
- Create: `src/components/focus/activity-log.tsx`

- [ ] **Step 1: 创建 Activity Log**

```tsx
import { formatDuration, getCategoryColor } from "@/lib/focus-utils";

type Session = {
  id: string;
  appName: string;
  windowTitle: string | null;
  startedAt: Date;
  durationSecs: number;
  category: string | null;
  aiSummary: string | null;
};

export function ActivityLog({ sessions }: { sessions: Session[] }) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
        <div className="text-sm font-semibold text-stone-900 dark:text-stone-100">
          Activity Log
        </div>
        <div className="mt-3 text-center text-sm text-stone-400">No activity recorded</div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-4 text-sm font-semibold text-stone-900 dark:text-stone-100">
        Activity Log
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 dark:border-stone-800">
              {["Time", "Duration", "App", "Category", "Description"].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-stone-400"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const time = s.startedAt.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              });
              const cat = s.category ?? "other";

              return (
                <tr
                  key={s.id}
                  className="border-b border-stone-50 dark:border-stone-800/50"
                >
                  <td className="px-3 py-2.5 text-stone-500 dark:text-stone-400">
                    {time}
                  </td>
                  <td className="px-3 py-2.5 font-medium text-stone-900 dark:text-stone-100">
                    {formatDuration(s.durationSecs)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: getCategoryColor(cat) }}
                      />
                      <span className="text-stone-900 dark:text-stone-100">
                        {s.appName}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className="rounded-md px-2 py-0.5 text-xs font-medium"
                      style={{
                        backgroundColor: getCategoryColor(cat) + "18",
                        color: getCategoryColor(cat),
                      }}
                    >
                      {cat}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-stone-600 dark:text-stone-300">
                    {s.aiSummary ?? s.windowTitle ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/focus/activity-log.tsx
git commit -m "feat(focus): add activity log table component"
```

---

### Task 10: AI Summary 区块组件

**Files:**
- Create: `src/components/focus/ai-summary.tsx`

- [ ] **Step 1: 创建 AI Summary 区块**

```tsx
"use client";

import { trpc } from "@/lib/trpc";

export function AISummary({ date }: { date: string }) {
  const { data: summary, isLoading } = trpc.focus.getDailySummary.useQuery({ date });
  const utils = trpc.useUtils();

  const classify = trpc.focus.classifySessions.useMutation({
    onSuccess: () => {
      void utils.focus.dailySessions.invalidate({ date });
      void utils.focus.dailyStats.invalidate({ date });
    },
  });

  const generate = trpc.focus.generateSummary.useMutation({
    onSuccess: () => {
      void utils.focus.getDailySummary.invalidate({ date });
    },
  });

  const isGenerating = classify.isPending || generate.isPending;

  async function handleRefresh() {
    await classify.mutateAsync({ date });
    await generate.mutateAsync({ date });
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold text-stone-900 dark:text-stone-100">
          AI Summary
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isGenerating}
          className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-100 disabled:opacity-50 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/60"
        >
          {isGenerating ? "Generating..." : "Refresh"}
        </button>
      </div>
      <div className="rounded-xl bg-stone-50 p-4 text-sm leading-relaxed text-stone-600 dark:bg-stone-800/50 dark:text-stone-300">
        {isLoading ? (
          <span className="text-stone-400">Loading...</span>
        ) : summary?.aiAnalysis ? (
          summary.aiAnalysis
        ) : (
          <span className="text-stone-400">
            No summary yet. Click &quot;Refresh&quot; to generate one from today&apos;s activity data.
          </span>
        )}
      </div>
      {summary?.generatedAt && (
        <div className="mt-2 text-xs text-stone-400">
          Last updated: {new Date(summary.generatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/focus/ai-summary.tsx
git commit -m "feat(focus): add AI summary component"
```

---

### Task 11: 历史趋势区组件

**Files:**
- Create: `src/components/focus/history-section.tsx`

- [ ] **Step 1: 创建历史趋势区**

```tsx
"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatDuration, calcGoalPercent, getCategoryColor, toDateString } from "@/lib/focus-utils";

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return toDateString(d);
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function HistorySection() {
  const [view, setView] = useState<"week" | "month">("week");
  const weekStart = getWeekStart(new Date());
  const today = toDateString(new Date());

  const { data: weeklyData } = trpc.focus.weeklyStats.useQuery({ weekStart });

  if (!weeklyData) return null;

  const totalWeekSecs = weeklyData.reduce((sum, d) => sum + d.totalSecs, 0);
  const daysWithData = weeklyData.filter((d) => d.totalSecs > 0).length;
  const avgDailySecs = daysWithData > 0 ? Math.round(totalWeekSecs / daysWithData) : 0;
  const avgGoalPercent = daysWithData > 0 ? Math.round(weeklyData.reduce((sum, d) => sum + calcGoalPercent(d.totalSecs), 0) / daysWithData) : 0;

  const maxBarSecs = Math.max(...weeklyData.map((d) => d.totalSecs), 8 * 3600);

  // 收集所有出现过的分类
  const allCategories = new Set<string>();
  for (const day of weeklyData) {
    for (const cat of Object.keys(day.categoryBreakdown)) {
      allCategories.add(cat);
    }
  }

  return (
    <div className="border-t border-stone-200 pt-6 dark:border-stone-800">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50">
          History
        </h2>
        <div className="flex rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800">
          {(["week", "month"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-md px-3.5 py-1 text-sm font-medium transition-colors ${
                view === v
                  ? "bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100"
                  : "text-stone-500 dark:text-stone-400"
              }`}
            >
              {v === "week" ? "Week" : "Month"}
            </button>
          ))}
        </div>
      </div>

      {/* 周统计卡片 */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-stone-200 bg-white p-3.5 text-center dark:border-stone-800 dark:bg-stone-900">
          <div className="text-xl font-bold text-stone-900 dark:text-stone-50">
            {formatDuration(totalWeekSecs)}
          </div>
          <div className="mt-0.5 text-xs text-stone-500">This Week</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-3.5 text-center dark:border-stone-800 dark:bg-stone-900">
          <div className="text-xl font-bold text-stone-900 dark:text-stone-50">
            {formatDuration(avgDailySecs)}
          </div>
          <div className="mt-0.5 text-xs text-stone-500">Daily Average</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-3.5 text-center dark:border-stone-800 dark:bg-stone-900">
          <div className="text-xl font-bold text-emerald-600">{avgGoalPercent}%</div>
          <div className="mt-0.5 text-xs text-stone-500">Avg Goal %</div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-3.5 text-center dark:border-stone-800 dark:bg-stone-900">
          <div className="text-xl font-bold text-stone-900 dark:text-stone-50">
            {daysWithData}
          </div>
          <div className="mt-0.5 text-xs text-stone-500">Active Days</div>
        </div>
      </div>

      {/* 柱状图 */}
      <div className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
        <div className="mb-4 text-sm font-semibold text-stone-900 dark:text-stone-100">
          Daily Focus Hours
        </div>
        <div className="flex items-end gap-3" style={{ height: 160 }}>
          {weeklyData.map((day, i) => {
            const isToday = day.date === today;
            const categories = Object.entries(day.categoryBreakdown).sort(([, a], [, b]) => b - a);
            const barHeight = day.totalSecs > 0 ? (day.totalSecs / maxBarSecs) * 140 : 6;

            return (
              <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className={`flex w-full flex-col-reverse overflow-hidden rounded-t-md ${
                    isToday ? "outline outline-2 outline-offset-2 outline-emerald-500" : ""
                  }`}
                  style={{ height: barHeight }}
                >
                  {day.totalSecs > 0 ? (
                    categories.map(([cat, secs]) => (
                      <div
                        key={cat}
                        style={{
                          flex: secs,
                          backgroundColor: getCategoryColor(cat),
                        }}
                      />
                    ))
                  ) : (
                    <div className="h-full bg-stone-100 dark:bg-stone-800" />
                  )}
                </div>
                <span
                  className={`text-[11px] ${
                    isToday
                      ? "font-semibold text-emerald-600"
                      : "text-stone-500 dark:text-stone-400"
                  }`}
                >
                  {isToday ? "Today" : DAY_LABELS[i]}
                </span>
                <span className="text-[11px] font-medium text-stone-900 dark:text-stone-100">
                  {day.totalSecs > 0 ? formatDuration(day.totalSecs) : "—"}
                </span>
              </div>
            );
          })}
        </div>
        {allCategories.size > 0 && (
          <div className="mt-3 flex flex-wrap gap-3 border-t border-stone-100 pt-3 dark:border-stone-800">
            {[...allCategories].map((cat) => (
              <div key={cat} className="flex items-center gap-1.5 text-xs text-stone-500">
                <div
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: getCategoryColor(cat) }}
                />
                {cat}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/focus/history-section.tsx
git commit -m "feat(focus): add history section with weekly bar chart"
```

---

### Task 12: /focus 页面

**Files:**
- Create: `src/app/(app)/focus/page.tsx`

- [ ] **Step 1: 创建 /focus 页面**

```tsx
"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toDateString } from "@/lib/focus-utils";
import { FocusDatePicker } from "@/components/focus/date-picker";
import { StatsCards } from "@/components/focus/stats-cards";
import { TimelineBar } from "@/components/focus/timeline-bar";
import { CategoryBreakdown } from "@/components/focus/category-breakdown";
import { ActivityLog } from "@/components/focus/activity-log";
import { AISummary } from "@/components/focus/ai-summary";
import { HistorySection } from "@/components/focus/history-section";

export default function FocusPage() {
  const [date, setDate] = useState(toDateString(new Date()));

  const { data: stats } = trpc.focus.dailyStats.useQuery({ date });
  const { data: sessions } = trpc.focus.dailySessions.useQuery({ date });

  return (
    <div className="space-y-5">
      {/* 页头 */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-50">
          Focus
        </h1>
        <FocusDatePicker date={date} onChange={setDate} />
      </div>

      {/* 指标卡片 */}
      {stats && (
        <StatsCards
          totalSecs={stats.totalSecs}
          longestStreakSecs={stats.longestStreakSecs}
          appSwitches={stats.appSwitches}
        />
      )}

      {/* 时间线 + 分类 */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TimelineBar sessions={sessions ?? []} />
        </div>
        <div>
          <CategoryBreakdown breakdown={stats?.categoryBreakdown ?? {}} />
        </div>
      </div>

      {/* Activity Log */}
      <ActivityLog sessions={sessions ?? []} />

      {/* AI Summary */}
      <AISummary date={date} />

      {/* 历史趋势 */}
      <HistorySection />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(app\)/focus/page.tsx
git commit -m "feat(focus): add /focus page assembling all components"
```

---

### Task 13: Dashboard 专注卡片

**Files:**
- Create: `src/components/focus/dashboard-card.tsx`
- Modify: `src/app/(app)/page.tsx`

- [ ] **Step 1: 创建 Dashboard 专注卡片**

```tsx
"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { formatDuration, calcGoalPercent, getCategoryColor, toDateString } from "@/lib/focus-utils";

export function FocusDashboardCard() {
  const today = toDateString(new Date());
  const { data: stats } = trpc.focus.dailyStats.useQuery({ date: today });
  const { data: sessions } = trpc.focus.dailySessions.useQuery({ date: today });

  if (!stats || stats.totalSecs === 0) return null;

  const percent = calcGoalPercent(stats.totalSecs);
  const totalSecs = sessions?.reduce((sum, s) => sum + s.durationSecs, 0) ?? 0;
  const timelineTotal = Math.max(totalSecs, 8 * 3600);

  const topApps = Object.entries(stats.categoryBreakdown)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);

  return (
    <Link
      href="/focus"
      className="rounded-[24px] border border-stone-200 bg-stone-50/90 p-5 transition-all hover:border-stone-300 hover:bg-white dark:border-stone-800 dark:bg-stone-900/60 dark:hover:border-stone-700 dark:hover:bg-stone-900"
    >
      <div className="text-[11px] uppercase tracking-[0.18em] text-stone-400 dark:text-stone-500">
        Today&apos;s Focus
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-semibold text-stone-950 dark:text-stone-50">
          {formatDuration(stats.totalSecs)}
        </span>
        <span className="text-sm text-stone-500">/ 8h</span>
      </div>

      {/* 进度条 */}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-1 text-xs text-stone-400">{percent}% of daily goal</div>

      {/* 迷你时间线 */}
      {sessions && sessions.length > 0 && (
        <div className="mt-3">
          <div className="flex h-3 gap-px overflow-hidden rounded">
            {sessions.map((s, i) => (
              <div
                key={i}
                style={{
                  flex: s.durationSecs / timelineTotal,
                  backgroundColor: getCategoryColor(s.category ?? "other"),
                }}
              />
            ))}
            <div
              style={{ flex: Math.max(0, timelineTotal - totalSecs) / timelineTotal }}
              className="bg-stone-100 dark:bg-stone-800"
            />
          </div>
        </div>
      )}

      {/* Top 分类 */}
      {topApps.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {topApps.map(([cat, secs]) => (
            <span key={cat} className="flex items-center gap-1 text-[11px] text-stone-500">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: getCategoryColor(cat) }}
              />
              {cat} {formatDuration(secs)}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
```

- [ ] **Step 2: 在 Dashboard 页面中集成专注卡片**

在 `src/app/(app)/page.tsx` 中：

1. 在文件顶部导入：
```typescript
import { FocusDashboardCard } from "@/components/focus/dashboard-card";
```

2. 在 Dashboard grid 中合适位置（"Today" 卡片后面）插入：
```tsx
<FocusDashboardCard />
```

- [ ] **Step 3: Commit**

```bash
git add src/components/focus/dashboard-card.tsx src/app/\(app\)/page.tsx
git commit -m "feat(focus): add focus card to dashboard"
```

---

### Task 14: 添加侧边栏导航

**Files:**
- Modify: `src/components/layout/navigation.ts`

- [ ] **Step 1: 在 navigation.ts 中添加 Focus 导航项**

在 `lucide-react` import 中添加 `Timer`，然后在 `navigationItems` 数组中 `Ask AI` 前面插入：

```typescript
{ href: "/focus", label: "Focus", icon: Timer },
```

完整的 navigation.ts:

```typescript
import {
  Activity,
  FileText,
  LayoutDashboard,
  MessageCircle,
  Timer,
} from "lucide-react";

export const navigationItems = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/notes", label: "Notes", icon: FileText },
  { href: "/focus", label: "Focus", icon: Timer },
  ...(process.env.NEXT_PUBLIC_ENABLE_TOKEN_USAGE === "true"
    ? [{ href: "/usage", label: "Token Usage", icon: Activity }]
    : []),
  { href: "/ask", label: "Ask AI", icon: MessageCircle },
] as const;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/navigation.ts
git commit -m "feat(focus): add Focus to sidebar navigation"
```

---

### Task 15: 构建验证

- [ ] **Step 1: TypeScript 编译检查**

```bash
pnpm build
```

Expected: 编译成功，无类型错误。

- [ ] **Step 2: ESLint 检查**

```bash
pnpm lint
```

Expected: 无 lint 错误。

- [ ] **Step 3: 修复发现的问题（如有）**

根据编译和 lint 结果修复问题，然后重新运行验证直到全部通过。

- [ ] **Step 4: Commit 修复（如有）**

```bash
git add -A
git commit -m "fix(focus): resolve build and lint issues"
```

---

### Task 16: E2E 测试

**Files:**
- Create: `e2e/focus.spec.ts`

- [ ] **Step 1: 创建 E2E 测试**

```typescript
import { test, expect } from "@playwright/test";

function uid() {
  return Math.random().toString(36).slice(2, 8);
}

test.describe("Focus page", () => {
  test("should navigate to /focus and display page title", async ({ page }) => {
    await page.goto("/focus");
    await expect(page.locator("main h1")).toHaveText("Focus");
  });

  test("should show date picker with today's date", async ({ page }) => {
    await page.goto("/focus");
    await expect(page.getByText("Today,")).toBeVisible();
  });

  test("should navigate dates with arrow buttons", async ({ page }) => {
    await page.goto("/focus");

    // 点击左箭头，日期应该变化
    await page.locator("main h1").waitFor();
    const leftButton = page.locator("button").filter({ has: page.locator("svg") }).first();
    await leftButton.click();

    // 不再显示 "Today"
    await expect(page.getByText("Today,")).not.toBeVisible();
  });

  test("should show empty state when no data", async ({ page }) => {
    await page.goto("/focus");
    await expect(page.getByText("No activity data").or(page.getByText("No activity recorded"))).toBeVisible();
  });

  test("should be accessible from sidebar", async ({ page }) => {
    await page.goto("/");
    // 点击侧边栏的 Focus 链接
    await page.getByRole("link", { name: "Focus" }).click();
    await expect(page).toHaveURL("/focus");
    await expect(page.locator("main h1")).toHaveText("Focus");
  });
});
```

- [ ] **Step 2: 运行 E2E 测试**

```bash
pnpm test:e2e -- e2e/focus.spec.ts
```

Expected: 所有测试通过。

- [ ] **Step 3: Commit**

```bash
git add e2e/focus.spec.ts
git commit -m "test(focus): add E2E tests for focus page"
```

---

## Part 2: Tauri Menubar 桌面端

### 文件结构

```
focus-tracker/               # 独立目录，位于 second-brain 同级或子目录
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── src/
│   │   ├── main.rs          # Tauri 入口
│   │   ├── tracker.rs       # 窗口监控核心逻辑
│   │   ├── db.rs            # SQLite 读写
│   │   └── tray.rs          # 系统托盘 / menubar 配置
│   └── icons/
├── src/                     # React 前端（menubar dropdown UI）
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/
│   │   ├── StatusPanel.tsx   # 下拉面板主组件
│   │   ├── TimelineBar.tsx   # 时间线色条（复用逻辑）
│   │   └── CurrentActivity.tsx
│   └── lib/
│       └── focus-utils.ts   # 从 Web 端复制核心工具函数
├── package.json
├── index.html
└── vite.config.ts
```

---

### Task 17: 初始化 Tauri 项目

- [ ] **Step 1: 创建 Tauri 项目**

```bash
cd /Users/bytedance
pnpm create tauri-app focus-tracker --template react-ts
cd focus-tracker
```

- [ ] **Step 2: 添加必要的 Rust 依赖**

在 `src-tauri/Cargo.toml` 的 `[dependencies]` 中添加：

```toml
rusqlite = { version = "0.31", features = ["bundled"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
chrono = { version = "0.4", features = ["serde"] }
```

- [ ] **Step 3: 安装前端依赖**

```bash
pnpm add lucide-react
```

- [ ] **Step 4: Commit**

```bash
git init
git add -A
git commit -m "feat: scaffold Tauri menubar app"
```

---

### Task 18: Rust 窗口监控模块

**Files:**
- Create: `src-tauri/src/tracker.rs`

- [ ] **Step 1: 创建 tracker.rs**

```rust
use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct WindowInfo {
    pub app_name: String,
    pub window_title: String,
}

/// 获取当前活跃窗口的应用名和窗口标题（macOS）
pub fn get_active_window() -> Option<WindowInfo> {
    // 获取最前台应用名
    let app_output = Command::new("osascript")
        .arg("-e")
        .arg("tell application \"System Events\" to get name of first application process whose frontmost is true")
        .output()
        .ok()?;

    let app_name = String::from_utf8_lossy(&app_output.stdout).trim().to_string();
    if app_name.is_empty() {
        return None;
    }

    // 获取窗口标题
    let title_script = format!(
        "tell application \"System Events\" to get name of front window of (first application process whose frontmost is true)"
    );
    let title_output = Command::new("osascript")
        .arg("-e")
        .arg(&title_script)
        .output()
        .ok();

    let window_title = title_output
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    Some(WindowInfo {
        app_name,
        window_title,
    })
}
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/src/tracker.rs
git commit -m "feat: add macOS active window tracker"
```

---

### Task 19: Rust SQLite 数据库模块

**Files:**
- Create: `src-tauri/src/db.rs`

- [ ] **Step 1: 创建 db.rs**

```rust
use chrono::{NaiveDateTime, Utc};
use rusqlite::{params, Connection, Result};
use serde::Serialize;
use std::path::Path;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct ActivitySession {
    pub id: String,
    pub app_name: String,
    pub window_title: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub duration_secs: i64,
}

pub struct FocusDb {
    conn: Connection,
    user_id: String,
}

impl FocusDb {
    /// 连接到 Second Brain 共享的 SQLite 数据库
    pub fn connect(db_path: &str, user_id: &str) -> Result<Self> {
        let conn = Connection::open(db_path)?;
        // 启用 WAL 模式以支持并发读写
        conn.pragma_update(None, "journal_mode", "WAL")?;
        Ok(FocusDb {
            conn,
            user_id: user_id.to_string(),
        })
    }

    /// 插入一条活动会话记录
    pub fn insert_session(
        &self,
        app_name: &str,
        window_title: &str,
        started_at: i64,
        ended_at: i64,
    ) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        let duration_secs = ended_at - started_at;
        let now = Utc::now().timestamp();

        self.conn.execute(
            "INSERT INTO activity_sessions (id, user_id, app_name, window_title, started_at, ended_at, duration_secs, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, self.user_id, app_name, window_title, started_at, ended_at, duration_secs, now],
        )?;

        Ok(id)
    }

    /// 获取今天的总专注秒数
    pub fn get_today_total_secs(&self) -> Result<i64> {
        let today_start = chrono::Local::now()
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp();

        let total: i64 = self.conn.query_row(
            "SELECT COALESCE(SUM(duration_secs), 0) FROM activity_sessions
             WHERE user_id = ?1 AND started_at >= ?2",
            params![self.user_id, today_start],
            |row| row.get(0),
        )?;

        Ok(total)
    }

    /// 获取今天的会话列表（用于 dropdown 展示）
    pub fn get_today_sessions(&self) -> Result<Vec<ActivitySession>> {
        let today_start = chrono::Local::now()
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp();

        let mut stmt = self.conn.prepare(
            "SELECT id, app_name, window_title, started_at, ended_at, duration_secs
             FROM activity_sessions
             WHERE user_id = ?1 AND started_at >= ?2
             ORDER BY started_at"
        )?;

        let sessions = stmt.query_map(params![self.user_id, today_start], |row| {
            Ok(ActivitySession {
                id: row.get(0)?,
                app_name: row.get(1)?,
                window_title: row.get(2)?,
                started_at: row.get(3)?,
                ended_at: row.get(4)?,
                duration_secs: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

        Ok(sessions)
    }
}
```

注意：需要在 `Cargo.toml` 再加上 `uuid = { version = "1", features = ["v4"] }` 依赖。

- [ ] **Step 2: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/Cargo.toml
git commit -m "feat: add SQLite database module for shared DB access"
```

---

### Task 20: Rust 主程序 — 托盘 + 定时采集

**Files:**
- Modify: `src-tauri/src/main.rs`
- Create: `src-tauri/src/tray.rs`

- [ ] **Step 1: 创建 tray.rs（系统托盘配置）**

```rust
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Manager,
};

pub fn setup_tray(app: &AppHandle) -> tauri::Result<TrayIcon> {
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Pause Tracking", true, None::<&str>)?;
    let dashboard = MenuItem::with_id(app, "dashboard", "Open Dashboard", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&toggle, &dashboard, &quit])?;

    let tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Focus Tracker")
        .title("⏱ 0m | 0%")
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "dashboard" => {
                let _ = open::that("http://localhost:3000/focus");
            }
            "toggle" => {
                // 切换暂停/恢复状态（通过 app state 管理）
            }
            _ => {}
        })
        .build(app)?;

    Ok(tray)
}
```

- [ ] **Step 2: 修改 main.rs — 集成托盘和定时采集**

```rust
mod db;
mod tracker;
mod tray;

use db::FocusDb;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Manager;

struct AppState {
    db: FocusDb,
    is_tracking: bool,
    current_app: Option<String>,
    current_title: Option<String>,
    session_start: Option<i64>,
}

#[tauri::command]
fn get_status(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> Result<serde_json::Value, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let total_secs = state.db.get_today_total_secs().unwrap_or(0);
    let goal_hours = 8;
    let percent = std::cmp::min(100, (total_secs * 100) / (goal_hours * 3600));

    let hours = total_secs / 3600;
    let minutes = (total_secs % 3600) / 60;
    let time_str = if hours > 0 {
        format!("{}h {}m", hours, minutes)
    } else {
        format!("{}m", minutes)
    };

    Ok(serde_json::json!({
        "totalSecs": total_secs,
        "timeStr": time_str,
        "percent": percent,
        "isTracking": state.is_tracking,
        "currentApp": state.current_app,
        "currentTitle": state.current_title,
    }))
}

#[tauri::command]
fn get_today_sessions(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> Result<Vec<db::ActivitySession>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    state.db.get_today_sessions().map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_tracking(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> Result<bool, String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    state.is_tracking = !state.is_tracking;
    Ok(state.is_tracking)
}

fn main() {
    // 数据库路径：指向 Second Brain 的 SQLite 文件
    let db_path = std::env::var("FOCUS_DB_PATH")
        .unwrap_or_else(|_| {
            let home = dirs::home_dir().expect("Cannot find home dir");
            home.join("second-brain/data/local.db").to_string_lossy().to_string()
        });

    let user_id = std::env::var("FOCUS_USER_ID")
        .unwrap_or_else(|_| "default".to_string());

    let focus_db = FocusDb::connect(&db_path, &user_id)
        .expect("Failed to connect to database");

    let state = Arc::new(Mutex::new(AppState {
        db: focus_db,
        is_tracking: true,
        current_app: None,
        current_title: None,
        session_start: None,
    }));

    let tracker_state = state.clone();

    tauri::Builder::default()
        .manage(state)
        .setup(|app| {
            let handle = app.handle().clone();
            tray::setup_tray(&handle)?;

            // 启动定时采集线程
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(Duration::from_secs(5));

                    let mut state = match tracker_state.lock() {
                        Ok(s) => s,
                        Err(_) => continue,
                    };

                    if !state.is_tracking {
                        continue;
                    }

                    let window = tracker::get_active_window();
                    let now = chrono::Utc::now().timestamp();

                    match window {
                        Some(info) => {
                            let same_session = state.current_app.as_deref() == Some(&info.app_name)
                                && state.current_title.as_deref() == Some(&info.window_title);

                            if !same_session {
                                // 保存前一个会话
                                if let (Some(app), Some(title), Some(start)) = (
                                    state.current_app.take(),
                                    state.current_title.take(),
                                    state.session_start.take(),
                                ) {
                                    let duration = now - start;
                                    if duration >= 10 {
                                        let _ = state.db.insert_session(&app, &title, start, now);
                                    }
                                }

                                // 开始新会话
                                state.current_app = Some(info.app_name);
                                state.current_title = Some(info.window_title);
                                state.session_start = Some(now);
                            }
                        }
                        None => {
                            // 无法获取窗口信息，保存当前会话
                            if let (Some(app), Some(title), Some(start)) = (
                                state.current_app.take(),
                                state.current_title.take(),
                                state.session_start.take(),
                            ) {
                                let duration = now - start;
                                if duration >= 10 {
                                    let _ = state.db.insert_session(&app, &title, start, now);
                                }
                            }
                        }
                    }

                    // 更新托盘标题
                    let total = state.db.get_today_total_secs().unwrap_or(0);
                    let h = total / 3600;
                    let m = (total % 3600) / 60;
                    let pct = std::cmp::min(100, (total * 100) / (8 * 3600));
                    let title = if h > 0 {
                        format!("⏱ {}h {}m | {}%", h, m, pct)
                    } else {
                        format!("⏱ {}m | {}%", m, pct)
                    };

                    if let Some(tray) = handle.tray_by_id("main") {
                        let _ = tray.set_title(Some(&title));
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_status, get_today_sessions, toggle_tracking])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: 在 Cargo.toml 中添加遗漏的依赖**

```toml
dirs = "5"
open = "5"
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/
git commit -m "feat: add tray menu and background window tracking loop"
```

---

### Task 21: React Dropdown 面板 UI

**Files:**
- Create: `src/components/StatusPanel.tsx`
- Create: `src/components/TimelineBar.tsx`
- Create: `src/components/CurrentActivity.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: 创建 TimelineBar.tsx**

```tsx
type Session = {
  app_name: string;
  duration_secs: number;
  category?: string;
};

const COLORS: Record<string, string> = {
  coding: "#3b82f6",
  research: "#f59e0b",
  meeting: "#a78bfa",
  communication: "#ec4899",
  other: "#6b7280",
};

function guessCategory(appName: string): string {
  const lower = appName.toLowerCase();
  if (lower.includes("code") || lower.includes("intellij") || lower.includes("xcode"))
    return "coding";
  if (lower.includes("chrome") || lower.includes("safari") || lower.includes("firefox"))
    return "research";
  if (lower.includes("zoom") || lower.includes("teams") || lower.includes("feishu") || lower.includes("lark"))
    return "meeting";
  if (lower.includes("slack") || lower.includes("discord") || lower.includes("telegram"))
    return "communication";
  return "other";
}

export function TimelineBar({ sessions }: { sessions: Session[] }) {
  const totalSecs = sessions.reduce((s, x) => s + x.duration_secs, 0);
  const timelineTotal = Math.max(totalSecs, 8 * 3600);

  const categories = [...new Set(sessions.map((s) => s.category ?? guessCategory(s.app_name)))];

  return (
    <div>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "#6b7280", marginBottom: 8 }}>
        Timeline
      </div>
      <div style={{ display: "flex", height: 20, borderRadius: 6, overflow: "hidden", gap: 1 }}>
        {sessions.map((s, i) => {
          const cat = s.category ?? guessCategory(s.app_name);
          return (
            <div
              key={i}
              style={{
                flex: s.duration_secs / timelineTotal,
                backgroundColor: COLORS[cat] ?? COLORS.other,
              }}
            />
          );
        })}
        <div
          style={{
            flex: Math.max(0, timelineTotal - totalSecs) / timelineTotal,
            backgroundColor: "#1f2937",
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        {["9:00", "12:00", "15:00", "18:00"].map((t) => (
          <span key={t} style={{ fontSize: 10, color: "#4b5563" }}>{t}</span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
        {categories.map((cat) => (
          <div key={cat} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: COLORS[cat] ?? COLORS.other }} />
            <span style={{ color: "#9ca3af" }}>{cat}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 CurrentActivity.tsx**

```tsx
type Props = {
  appName: string | null;
  windowTitle: string | null;
  elapsed: string;
};

export function CurrentActivity({ appName, windowTitle, elapsed }: Props) {
  if (!appName) return null;

  return (
    <div style={{
      backgroundColor: "#2c2c2e",
      borderRadius: 10,
      padding: 12,
    }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "#6b7280", marginBottom: 6 }}>
        Now
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          width: 28, height: 28,
          backgroundColor: "#3b82f6",
          borderRadius: 6,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14,
        }}>
          💻
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#f5f5f4" }}>{appName}</div>
          <div style={{ fontSize: 11, color: "#6b7280" }}>{windowTitle ?? ""}</div>
        </div>
        <div style={{ fontSize: 13, color: "#34d399", fontWeight: 500 }}>{elapsed}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 创建 StatusPanel.tsx**

```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TimelineBar } from "./TimelineBar";
import { CurrentActivity } from "./CurrentActivity";

type Status = {
  totalSecs: number;
  timeStr: string;
  percent: number;
  isTracking: boolean;
  currentApp: string | null;
  currentTitle: string | null;
};

type Session = {
  id: string;
  app_name: string;
  window_title: string;
  started_at: number;
  ended_at: number;
  duration_secs: number;
};

export function StatusPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const s = await invoke<Status>("get_status");
        setStatus(s);
        const sess = await invoke<Session[]>("get_today_sessions");
        setSessions(sess);
      } catch (e) {
        console.error("Failed to get status:", e);
      }
    }, 2000);

    // 首次立即获取
    invoke<Status>("get_status").then(setStatus).catch(console.error);
    invoke<Session[]>("get_today_sessions").then(setSessions).catch(console.error);

    return () => clearInterval(poll);
  }, []);

  if (!status) return <div style={{ padding: 20, color: "#6b7280" }}>Loading...</div>;

  const remaining = Math.max(0, 8 * 3600 - status.totalSecs);
  const remainH = Math.floor(remaining / 3600);
  const remainM = Math.floor((remaining % 3600) / 60);
  const remainStr = remainH > 0 ? `${remainH}h ${remainM}m` : `${remainM}m`;

  // 计算当前活动已持续时间
  const currentElapsed = status.currentApp && sessions.length > 0
    ? (() => {
        const last = sessions[sessions.length - 1];
        const secs = Math.floor(Date.now() / 1000) - last.started_at;
        const m = Math.floor(secs / 60);
        return `${m}m`;
      })()
    : "0m";

  async function handleToggle() {
    try {
      await invoke("toggle_tracking");
      const s = await invoke<Status>("get_status");
      setStatus(s);
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div style={{
      padding: 20,
      fontFamily: "-apple-system, sans-serif",
      backgroundColor: "#1c1c1e",
      color: "#f5f5f4",
      minWidth: 280,
    }}>
      {/* 大数字 */}
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "#9ca3af" }}>
          Today&apos;s Focus
        </div>
        <div style={{ fontSize: 36, fontWeight: 700, marginTop: 4 }}>
          {status.timeStr}
        </div>
        <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>
          of 8h goal
        </div>
      </div>

      {/* 进度条 */}
      <div style={{ backgroundColor: "#374151", borderRadius: 8, height: 8, marginBottom: 16, overflow: "hidden" }}>
        <div style={{
          background: "linear-gradient(90deg, #34d399, #10b981)",
          width: `${status.percent}%`,
          height: "100%",
          borderRadius: 8,
        }} />
      </div>

      {/* 统计 */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{status.percent}%</div>
          <div style={{ fontSize: 11, color: "#6b7280" }}>Progress</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{remainStr}</div>
          <div style={{ fontSize: 11, color: "#6b7280" }}>Remaining</div>
        </div>
      </div>

      {/* 时间线 */}
      {sessions.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <TimelineBar sessions={sessions} />
        </div>
      )}

      {/* 当前活动 */}
      <CurrentActivity
        appName={status.currentApp}
        windowTitle={status.currentTitle}
        elapsed={currentElapsed}
      />

      {/* 操作栏 */}
      <div style={{
        marginTop: 16,
        paddingTop: 12,
        borderTop: "1px solid #374151",
        display: "flex",
        justifyContent: "space-between",
      }}>
        <button
          onClick={handleToggle}
          style={{
            fontSize: 12,
            color: status.isTracking ? "#f59e0b" : "#34d399",
            background: "none",
            border: "none",
            cursor: "pointer",
          }}
        >
          {status.isTracking ? "⏸ Pause" : "▶ Resume"}
        </button>
        <a
          href="http://localhost:3000/focus"
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12, color: "#3b82f6", textDecoration: "none" }}
        >
          Open dashboard →
        </a>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 更新 App.tsx**

```tsx
import { StatusPanel } from "./components/StatusPanel";

function App() {
  return <StatusPanel />;
}

export default App;
```

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat: add React dropdown panel UI with timeline and status"
```

---

### Task 22: Tauri 配置调整

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: 调整 tauri.conf.json 关键配置**

确保以下配置正确：

```json
{
  "app": {
    "windows": [
      {
        "title": "Focus Tracker",
        "width": 300,
        "height": 480,
        "visible": false,
        "decorations": false,
        "resizable": false
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "identifier": "com.secondbrain.focus-tracker",
    "icon": ["icons/icon.png"]
  }
}
```

关键点：`visible: false`（启动时不显示窗口，通过托盘图标控制）、`decorations: false`（无窗口边框）。

- [ ] **Step 2: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat: configure Tauri for menubar mode"
```

---

### Task 23: 构建验证（Tauri）

- [ ] **Step 1: 前端构建检查**

```bash
pnpm build
```

Expected: Vite 构建成功。

- [ ] **Step 2: Rust 编译检查**

```bash
cd src-tauri && cargo check
```

Expected: Cargo 编译通过，无错误。

- [ ] **Step 3: 完整 Tauri 构建**

```bash
cd .. && pnpm tauri build
```

Expected: 生成 .app 或 .dmg 文件。

- [ ] **Step 4: 修复发现的问题（如有），然后 commit**

```bash
git add -A
git commit -m "fix: resolve build issues"
```

---

### Task 24: 留档

**Files:**
- Create: `docs/changelog/focus-tracker.md`

- [ ] **Step 1: 创建 Phase 留档**

记录本次实现的功能列表、文件清单、数据库变更、验证结果。

- [ ] **Step 2: Commit**

```bash
git add docs/changelog/focus-tracker.md
git commit -m "docs: add focus tracker changelog"
```
