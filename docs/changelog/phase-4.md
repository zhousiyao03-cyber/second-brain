# Phase 4：AI 集成

**完成日期**：2026-03-21

## 完成的功能

### Ask AI 对话页
1. 基于 Vercel AI SDK v6 的流式对话
2. 使用 `TextStreamChatTransport` + `useChat` hook
3. 用户/AI 消息气泡样式区分
4. 流式响应时显示加载动画
5. 错误状态提示（含 API Key 配置提示）
6. 空状态引导提示

### 收藏箱 AI 摘要
1. 收藏卡片 hover 显示「AI 生成摘要」按钮
2. 调用 `/api/summarize` 生成中文摘要 + 标签
3. 摘要结果回写数据库并刷新列表
4. 处理中显示旋转加载图标
5. 失败时更新状态为 `failed`

### API 端点
- `POST /api/chat` — 流式对话（Claude Sonnet，中文系统提示词）
- `POST /api/summarize` — 收藏摘要生成（JSON 格式返回 summary + tags）

## 新增/修改的文件

- `src/app/ask/page.tsx` — Ask AI 对话页面
- `src/app/bookmarks/page.tsx` — 添加 AI 摘要按钮
- `src/app/api/chat/route.ts` — 聊天流式 API
- `src/app/api/summarize/route.ts` — 摘要生成 API
- `e2e/phase4.spec.ts` — 8 个测试用例

## 依赖变更

- `@ai-sdk/anthropic` — Anthropic 模型适配
- `@ai-sdk/react` — React hooks（useChat）
- `ai` — AI SDK 核心（streamText, generateText, TextStreamChatTransport）

## 验证结果

- `pnpm build` ✅ 编译通过
- `pnpm lint` ✅ 无 ESLint 错误
- `pnpm test:e2e` ✅ 40/40 通过（Phase 1: 11 + Phase 2: 10 + Phase 3: 11 + Phase 4: 8）

## 已知问题

- AI 功能需要配置 `ANTHROPIC_API_KEY` 环境变量才能使用
- 摘要目前基于标题/URL/内容文本，暂不支持 URL 自动抓取网页内容
