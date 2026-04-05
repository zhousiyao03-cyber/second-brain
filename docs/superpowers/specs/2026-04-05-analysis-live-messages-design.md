# Analysis Live Messages — 实时展示分析过程

## 背景

源码分析已改为 daemon 模式执行，但前端只能看到 "queued" / "running" 的状态，无法知道 Claude 正在做什么。需要实时展示 Claude 的工具调用日志（读了哪些文件、grep 了什么、跑了什么命令）。

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 实时推送方式 | 前端轮询（2 秒） | Vercel serverless 不支持 WebSocket 长连接 |
| 消息详细程度 | 仅摘要行，不可展开 | 监控"在干什么"就够，不需要完整 input/output |
| UI 位置 | 替换现有蓝色 banner | 分析完后 timeline 无用（结果在笔记里），保持简洁 |
| 消息存储 | 只存摘要，不存完整 input/output | 省空间，前端不需要 |

## 数据模型

### 新表 `analysis_messages`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| task_id | TEXT FK → analysis_tasks | 所属任务 |
| seq | INTEGER | 顺序号 |
| type | TEXT | "tool_use" \| "tool_result" \| "text" \| "error" |
| tool | TEXT | 工具名（Read, Grep, Bash 等），仅 tool_use/tool_result |
| summary | TEXT | 摘要行（如 "Read src/index.ts"） |
| created_at | TIMESTAMP | 创建时间 |

## API

### `POST /api/analysis/progress`（无认证，daemon 调用）

Daemon 批量上报消息。

入参：
```json
{
  "taskId": "xxx",
  "messages": [
    { "seq": 1, "type": "tool_use", "tool": "Read", "summary": "src/index.ts" },
    { "seq": 2, "type": "tool_use", "tool": "Bash", "summary": "git log --oneline -5" }
  ]
}
```

行为：批量插入 analysis_messages。

### `GET /api/analysis/messages?taskId=xxx&afterSeq=0`（无认证，前端轮询）

返回 `seq > afterSeq` 的消息列表，按 seq 升序。

响应：
```json
{
  "messages": [
    { "seq": 1, "type": "tool_use", "tool": "Read", "summary": "src/index.ts" },
    { "seq": 2, "type": "tool_use", "tool": "Bash", "summary": "git log --oneline -5" }
  ]
}
```

## Daemon 改造

`spawnClaude` 改为使用 `--output-format stream-json --verbose`：

- 逐行解析 stdout 的 JSON 对象
- `type: "assistant"` 且 content 含 `tool_use` → 提取工具名，生成摘要（文件路径、命令、pattern 等）
- `type: "assistant"` 且 content 含 `text` → 生成 text 类型摘要
- `type: "result"` → 忽略（最终结果走 /api/analysis/complete）
- 每积攒 5 条或每 2 秒 flush 一次，POST 到 `/api/analysis/progress`

### 摘要生成规则

| 工具 | 摘要格式 |
|------|----------|
| Read | 文件路径（取最后 2-3 段） |
| Grep | `"pattern" in path` |
| Glob | pattern |
| Bash | description 字段，或 command 截取前 80 字符 |
| Edit | 文件路径 |
| Write | 文件路径 |
| 其他 | 工具名 |

## 前端改动

### 替换蓝色 banner 为 timeline 区块

当 `analysisStatus` 为 `queued` 或 `running` 时，渲染 timeline 区块：

- 顶部：状态文案 + Loader2 旋转 + 已用时间（每秒更新）
- 下方：消息列表，每条一行：
  - `tool_use`: `🔧 {Tool}: {summary}`
  - `text`: `💬 {summary}`
  - `error`: `❌ {summary}`
- 自动滚动到最新消息
- 最大高度 300px，超出可滚动
- 分析完成后区块消失，笔记列表刷新

### 轮询逻辑

- 当 `analysisStatus` 为 `running` 时，每 2 秒 GET `/api/analysis/messages?taskId=xxx&afterSeq=lastSeq`
- 新消息追加到列表，更新 lastSeq
- `analysisStatus` 变为 `completed` 或 `failed` 后停止轮询
