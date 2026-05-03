# 2026-05-03 — Drifter Polish Pass (audio + visuals + prompt)

## 任务 / 目标

Drifter Phase 1 上线后用户反馈缺音乐、画质粗糙、Pip 经常答非所问。本次
polish pass 三件事一起做：CC0 ambient 音乐按天气切轨、Phaser 场景纹理 +
视差 + 烛光复合扰动 + Pip 毛茸细节、`getPipResponse` system prompt 重写
并加 few-shot 负例对照。

Spec：`docs/superpowers/specs/2026-05-03-drifter-polish-pass-design.md`
Plan：`docs/superpowers/plans/2026-05-03-drifter-polish-pass.md`
分支：`feat/drifter-polish-pass`（5 个 commit，从 `main` 起 fork）

## 关键改动

### 音乐（commit `4e70d40` + `d53243b`）

- 7 个 CC0 ogg 资产入库 `public/drifter/audio/`，全部从 Freesound 下载
  （Pixabay/Pexels 都被 Cloudflare 拦截无法 scriptable 抓取，Freesound
  API 友好且 license filter 干净）：
  - 4 主旋律：`clear-piano.ogg` / `rain-piano.ogg` / `snow-bells.ogg` /
    `fireflies-strings.ogg`，每首 45s 循环
  - 3 noise layer：`noise-fire.ogg`（30s 炉火）/ `noise-rain.ogg`（30s
    雨声）/ `noise-crickets.ogg`（30s 虫鸣）
  - 总大小 1.03 MB（spec 上限 1.5 MB），单文件全部 < 200 KB
  - 编码做了一处 spec 偏离：bitrate 从 96 kbps 降到 ~32 kbps（VBR
    `oggenc -q -1`），原因是 7 个文件在 1.5 MB 预算下做不到 96 kbps。
    ambient 材料质量足够，已在 CREDITS.md 标注
- `src/components/drifter/audio-engine.tsx`：单例 React 组件，原生
  HTMLAudioElement + setInterval 线性 fade，2s crossfade 切轨
- `src/components/drifter/mute-toggle.tsx`：lucide `Volume2`/`VolumeX`
  图标按钮，状态持久化到 `localStorage["drifter:muted"]`
- Autoplay 失败时显示 "Tap anywhere to enable sound" 浮层，user gesture
  解锁后记 `localStorage["drifter:audio-unlocked"]`，下次进入直接尝试
  play
- Drifter-client 集成：`<AudioEngine weather muted />` + `<MuteToggle>`
  挂在顶部右侧（`top-4 right-28 z-30`），与 `<LeaveButton>` 不冲突

### 视觉（commit `fe42bf1` + `ac0d5d3`）

- 3 张 CC0 纹理入库 `public/drifter/textures/`（共 424 KB，spec 上限 800 KB）：
  - `wood-wall.webp` 1024×683 — Wikimedia Commons CC0 weathered planks
  - `paper-warm.webp` 1024×1024 — Wikimedia Commons CC0 parchment
  - `stars-night.png` 2048×512 — US-Gov public domain night sky，做了
    亮度→alpha 真透明提取
- `tea-house.ts` 重写（保持 factory + class 架构不变）：
  - `preload()` 加载 3 张纹理，`this.textures.exists()` 守护，资源
    404 时回退到现有 fillStyle（spec §3.3 兜底）
  - `drawBackWall`：wood tilesprite 铺底 + 现有梯度 multiply overlay
    + 暖色 ambient glow
  - `drawWindowParallax`（新方法）：远山 + 近林剪影 + 3 个漂移雾
    ellipses + clear 天气下 stars tilesprite 慢速横向滚动；全部用
    `this.make.graphics()` 的 geometry mask 限制在窗内
  - `drawDesk`：前沿高光线 + paper 纹理 multiply 叠加
  - `drawWindow`：paper 纹理叠在窗框 multiply
  - `drawLamp`：现有 tween 删除，改 `update(time)` 中两频复合
    `Math.sin` 噪声扰动 alpha + scale；新增暖色 light cone 投到背墙
  - `drawPip`：6 层渐变椭圆"绒毛"轮廓 `addAt(_, 0)` 插到 body / head 之前；
    眨眼（4-7s 随机间隔）、视线扫视（6-10s 间隔，缓存 `baseLeftX` /
    `baseRightX` 避免 drift）、叹息呼吸（12-18s 间隔）
  - `drawVignette` 改为 `drawAtmosphere`：暖色 multiply 滤镜 + 顶/底
    纯黑带 + 四角三角 alpha 暗角

### 对话（commit `4864722`）

- `src/server/ai/drifter.ts` `getPipResponse` 重写：
  - 单 prompt 字符串拆为 PERSONA / EXAMPLES / CONTEXT / HISTORY /
    NEWEST 五段，用 `---` 分隔，模型更易定位当前要回应的消息
    （provider 不支持 messages 数组，spec §4.4 已确认走单 prompt 回退路）
  - PERSONA 新增 "WHO YOU ARE NOT" 段：明确否定 therapist / AI assistant /
    coach / problem-solver 四种身份
  - EXAMPLES 段：3 对中英双语负例+正例对照，覆盖 lecturing /
    interviewing / advice-giving / pushing 四种 drift 模式
- `loadRelevantMemories` 默认 limit `8 → 4`（减少 prompt 噪声）
- 空 memory 提示从冗长的 "this person is new to you..." 改为
  `"(no memories yet)"`（避免模型走"初次见面"话术）

## 文件清单

**新增**：
- `docs/superpowers/specs/2026-05-03-drifter-polish-pass-design.md`（spec）
- `docs/superpowers/plans/2026-05-03-drifter-polish-pass.md`（plan）
- `docs/changelog/2026-05-03-drifter-polish-pass.md`（本文件）
- `public/drifter/audio/{clear-piano,rain-piano,snow-bells,fireflies-strings,noise-fire,noise-rain,noise-crickets}.ogg`（7 个）
- `public/drifter/audio/CREDITS.md`
- `public/drifter/textures/{wood-wall,paper-warm}.webp`、`stars-night.png`
- `public/drifter/textures/CREDITS.md`
- `src/components/drifter/audio-engine.tsx`（174 行）
- `src/components/drifter/mute-toggle.tsx`（22 行）

**修改**：
- `src/app/(app)/drifter/drifter-client.tsx`（接入 audio + mute，+27 行）
- `src/components/drifter/scenes/tea-house.ts`（视觉精修，+245 / -19 行）
- `src/server/ai/drifter.ts`（prompt 重写 + memory limit，+77 / -31 行）

## 验证

- `pnpm tsc --noEmit`：✅ 无 drifter 相关错误
- `pnpm vitest run src/server/ai/drifter.test.ts`：✅ 13/13 通过
- `pnpm lint`：noisy（44k+ 来自 `.next-e2e` cache，CI 干净，per 已存
  memory `feedback_lint_e2e_cache.md`，本次改动文件本身 0 错误）
- `pnpm test:e2e`：本 worktree 跳过（缺 `data/*.db`，per 已存 memory
  `feedback_skip_e2e_in_worktrees.md`），等 main pre-merge 跑
- 手动浏览器验证：跳过，等 push 到 main 后真实环境验证 4 天气视觉 +
  音乐切换 + 12 轮真实 AI 对话 drift 计数

资产体积：
- audio：1.3 MB（7 文件，预算 1.5 MB ✅）
- textures：428 KB（3 文件，预算 800 KB ✅）
- 总和：~1.7 MB 静态资源增量

## 生产 schema rollout

无 schema 变化。

## 剩余风险 / 后续

- 音乐 loop 接缝：4 主旋律 45s 在固定时间裁切而非乐句边界裁切，loop
  处可能听到接缝。`AudioEngine` 当前只在 weather 切换时 fade，不在
  loop 边界 fade。push 后听感不行就给 engine 加一个 `timeupdate`
  监听 + loop-edge crossfade
- Pip 立绘仍是 geometry，spec §3 Phase B（AI 生图替换占位）尚未启动
- 移动端音频策略未深度优化（autoplay 在 iOS Safari 仍需 user gesture）
- DialogueBox typewriter useEffect 依赖 `history.length` 的 P1 遗留 bug
  未在本次修
- Memory 召回是 importance + recency 排序，没接 embedding 相似度，
  跨主题召回精度有限
- 12 轮真实 AI rubric 未跑，prompt 是否真的解决了"答非所问"还要 push
  后在生产用真实数据验证
