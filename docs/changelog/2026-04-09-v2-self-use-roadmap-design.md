# 2026-04-09 — V2 self-use roadmap design

## Goal

把当前关于 V2 的产品方向讨论沉淀成正式设计文档，明确为什么下一阶段要优先解决卡顿、编辑器体验和 Ask AI 摩擦，而不是继续扩功能。

## Key changes

- 新增 V2 设计文档：
  - `docs/superpowers/specs/2026-04-09-v2-self-use-roadmap-design.md`
- 文档明确了 V2 的核心判断：
  - 当前最大问题不是功能不够，而是使用阻力过高
  - 推荐路线是 `性能优先 -> 阅读体验优先 -> 知识编译优先`
  - 将里程碑拆为：
    - Milestone 1：流畅度修复
    - Milestone 2：编辑器重构为写作 + 阅读环境
    - Milestone 3：Ask AI 融入工作流
    - Milestone 4：首页改造为 Today Workspace
    - Milestone 5：知识编译层
- 文档同时补充了：
  - 非目标
  - 设计原则
  - P0 / P1 / P2 backlog 分层
  - 成功衡量与风险取舍

## Files touched

- `docs/superpowers/specs/2026-04-09-v2-self-use-roadmap-design.md` (new)
- `docs/changelog/2026-04-09-v2-self-use-roadmap-design.md` (this file)

## Verification

- `sed -n '1,260p' docs/superpowers/specs/2026-04-09-v2-self-use-roadmap-design.md`
  - 确认设计文档已写入，包含路线选择、里程碑、backlog、风险与下一步
- `sed -n '1,220p' docs/changelog/2026-04-09-v2-self-use-roadmap-design.md`
  - 确认 changelog 已记录目标、关键改动、文件列表、验证和后续项
- `git diff --check`
  - 预期无 whitespace / patch 格式错误

## Remaining risks / follow-ups

- 当前只完成了路线设计，还没有进入可执行实施计划
- 设计文档里的 Milestone 1 仍需进一步拆成具体工程任务，尤其是：
  - 页面卡顿定位
  - 编辑器重组件拆分
  - Ask AI 页面交互收敛
- 在进入实施前，建议先由用户 review 文档，确认里程碑排序和取舍是否符合真实使用优先级
