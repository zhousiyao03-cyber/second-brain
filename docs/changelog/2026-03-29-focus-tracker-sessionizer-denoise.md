# 2026-03-29 Focus Tracker sessionizer denoise

## task / goal

- 把桌面端 raw session 的噪声先压下去，不再把每次瞬时切窗都直接当成有效 session。
- 为后续 working hours / focused work 指标打更稳的底层数据基础。

## key changes

- 修改 `focus-tracker/src-tauri/src/sessionizer.rs`
  - 新增 `10s` 切换确认延迟
  - 只有新窗口稳定停留 `10s` 后才确认切换
  - `< 30s` 的 session 不再单独产出
  - `Finder / focus-tracker / Rize / SystemUIServer / Spotlight / Control Center / NotificationCenter / loginwindow`
    这类低权重 app 在 `< 2min` 时不会单独产出
  - 新增 `pending switch` 状态，避免瞬时切回造成碎片 session
- 扩展 Rust 单测，覆盖：
  - 确认延迟
  - 瞬时切回不拆 session
  - 短 session 丢弃
  - 低权重 app 抑制
- 更新 `focus-tracker/README.md`

## files touched

- `focus-tracker/src-tauri/src/sessionizer.rs`
- `focus-tracker/README.md`
- `docs/changelog/2026-03-29-focus-tracker-sessionizer-denoise.md`

## verification commands and results

- `cd focus-tracker/src-tauri && cargo test`
  - ✅ 13 passed
- `cd focus-tracker/src-tauri && cargo check`
  - ✅ 通过
- `cd focus-tracker && pnpm build`
  - ✅ 通过

## remaining risks or follow-up items

- 这次先做的是 collector-side denoise，还没有把“短中断 merge + 任务组归并”做成更强的语义层。
- 低权重 app 列表目前是内置规则，后续如果误杀正常窗口，需要再做可配置化。
- 当前确认延迟是 `10s`，如果手测觉得仍偏敏感或过钝，再按真实使用节奏调。
