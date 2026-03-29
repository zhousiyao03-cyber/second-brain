# 2026-03-29 Focus Popup Information Pruning

## Task / Goal

继续压缩 Focus Tracker 桌面端 popup 的信息密度，让它更像 menubar 状态卡，而不是调试面板。

## Key Changes

- 调整 `focus-tracker/src/App.tsx`：
  - hero 区只强调 `Working Hours` 和剩余 8 小时时长
  - `Focused time` 和当前状态降成次级说明
  - `Reconnect` 从主按钮降成次级入口
  - summary 区移除采样频率等技术实现细节，改成 `focused time + 剩余目标时长`
- 调整 `focus-tracker/src/App.css`：
  - 强化主信息层级
  - 弱化次级按钮和说明文案
  - 继续减轻“功能面板”感

## Files Touched

- `focus-tracker/src/App.tsx`
- `focus-tracker/src/App.css`

## Verification

- `cd focus-tracker && pnpm build`
  - passed

## Remaining Risks / Follow-up

- `Reconnect` 仍然默认可见，只是权重已降低；如果后续还觉得吵，可以继续收到 hover 菜单或 setup/error 态里。
- 当前状态文案里仍保留 app 名称提示，后续如需更克制，可以只在活跃采样时展示。
