# V1 收敛变更记录

---

### Pass 1：产品收敛（2026-03-22）

**变更内容**：
- `src/components/layout/sidebar.tsx`：从 navItems 移除 Workflows 和 Learn，"Dashboard" 改为"首页"，移除未使用的 GraduationCap/Workflow import
- `src/app/page.tsx`：标题 "Dashboard" → "首页"
- `e2e/phase1.spec.ts`：断言从 "Dashboard" 改为"首页"，导航项列表移除"学习"和"工作流"
- `e2e/phase5.spec.ts`：学习模块和工作流模块测试标记 `test.describe.skip`
- `e2e/phase6.spec.ts`：Dashboard 断言改为"首页"
- 删除 `src/components/ui/.gitkeep`、`src/server/ai/.gitkeep`

**验证结果**：
- pnpm build：✅
- pnpm lint：✅
- E2E（phase1 + phase5 + phase6）：24 passed, 10 skipped

**已知遗留**：
- 无
