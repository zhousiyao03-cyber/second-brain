# Drifter Polish Pass — Design

**Status**: Approved 2026-05-03
**Author**: 周思尧 (with Claude)
**Scope**: 给 drifter Phase 1 上一层 "polish" — 加音乐 / 升画质 / 修对话答非所问。不做 spec §13 的 Phase B（AI 生图）。
**Spec parent**: `docs/superpowers/specs/2026-05-01-drifter-design.md`

---

## 0. 动机

P1 上线后，用户反馈：

1. **没有音乐** — 进入茶馆完全静音，氛围出不来。
2. **画质粗糙** — 当前 Phaser 场景全是 geometry（矩形/椭圆/三角），离 spec §3 "半写实插画风" 很远，缺纹理、缺光影层次。
3. **Pip 经常答非所问** — 表现为"跑题 / 给建议 / 当 AI 助手"，违反 spec §1 "不开导、不分析、不建议"。

本 polish pass 三件事一次做完，不分阶段。

---

## 1. 范围与边界

### 做

- 接入 4 首主旋律 ambient + 3 个白噪音 layer（CC0 资产），按 `session.weather` 切轨 + 交叉淡入
- Mute 按钮 + autoplay 失败兜底
- Phaser tea-house 场景几何精修：纹理图叠加、视差远景、烛光复合扰动、Pip 毛茸轮廓 + 眨眼 + 视线扫视、整屏暖色滤镜 + 暗角
- `getPipResponse` system prompt 重写（强化 spec §1 边界）+ 注入 few-shot negative/positive 对照 + history 改 message-role 数组 + memory 注入条件收紧

### 不做（YAGNI / Phase B）

- ❌ Pip 立绘换插画图（spec §3 Phase B follow-up）
- ❌ AI 生图任何资产
- ❌ 真正的 GLSL bloom / 复杂后处理 pipeline
- ❌ Memory 系统重写（schema 和触发链已接通，只调 prompt 层）
- ❌ 移动端音频深度优化
- ❌ 重构 drifter.ts 的整体结构（只动 `getPipResponse` 内部）

---

## 2. 音乐子系统

### 2.1 资产

放在 `public/drifter/audio/`，全部 CC0，license 列入 `public/drifter/audio/CREDITS.md`（含 source URL）。

| 文件 | 用途 | 触发条件 | 时长目标 |
|------|------|---------|---------|
| `clear-piano.ogg` | 主旋律 | weather=clear | 60-120s loop |
| `rain-piano.ogg` | 主旋律 | weather=rain | 60-120s loop |
| `snow-bells.ogg` | 主旋律 | weather=snow | 60-120s loop |
| `fireflies-strings.ogg` | 主旋律 | weather=fireflies | 60-120s loop |
| `noise-rain.ogg` | 白噪音层 | weather=rain | 30-60s loop |
| `noise-fire.ogg` | 白噪音层 | 所有天气（屋内炉火） | 30-60s loop |
| `noise-crickets.ogg` | 白噪音层 | weather=fireflies | 30-60s loop |

**编码**：96 kbps mono OGG Vorbis，目标总和 < 1.5 MB。
**来源候选**：freesound.org（CC0 tag）、pixabay music（CC0）、itch.io free audio。

### 2.2 实现：`src/components/drifter/audio-engine.tsx`

**单例 React component**，挂在 drifter-client 树中。

API：
```ts
type Props = {
  weather: DrifterWeather;
  muted: boolean;
};
```

内部：
- 用原生 `HTMLAudioElement`（不引入 howler / tone.js）
- 每个声轨 1 个 `<audio>` 元素，全部 `loop=true`，初始 volume=0
- 总音量上限 0.4（避免太响）
- weather 切换时，旧主旋律 2s linear fade out，新主旋律 2s linear fade in（跟随同一个 `setInterval` 时钟，避免叠加 timer）
- 白噪音层独立控制：`noise-fire` 永远 0.15 音量；`noise-rain` 仅 weather=rain 时拉到 0.25；`noise-crickets` 仅 weather=fireflies 时拉到 0.2

**Autoplay 兜底**：
- 在 `useEffect` 里 `audio.play()` 返回 Promise.reject 时，设置 `autoplayBlocked=true` state
- 显示一个温和的浮层："Tap anywhere to enable sound"，半透明，不阻挡 Phaser 画面
- 浮层点击后调用 `audio.play()` 重试，成功后浮层消失，本会话不再问
- 用 `localStorage.setItem("drifter:audio-unlocked", "1")` 记忆"用户已解锁过"，下次进入直接尝试 play —— 失败仍兜底，但成功率高

### 2.3 Mute 按钮 UI

- 位置：drifter-client 顶部右上，紧邻 "Step outside"
- 图标：`<Volume2 />` / `<VolumeX />`（lucide-react）
- 状态持久化：`localStorage.setItem("drifter:muted", "0" | "1")`，默认 "0"
- 点击切换时立即应用音量（无 fade，因为是用户主动）
- aria-label："Mute audio" / "Unmute audio"（英文，遵循 CLAUDE.md UI 文案规范）

### 2.4 测试 / 验证

- 手动：开 dev，进 /drifter，听到背景音乐 → 切 weather（dev 工具直接改数据库 / 临时 force prop）确认 crossfade
- 手动：mute 按钮即时生效
- 手动：禁用浏览器 autoplay 后刷新，看到浮层、点一下后音乐播放
- E2E：不专门测音频内容，但要测 mute 按钮能点到、`data-testid="drifter-mute-toggle"` 存在

---

## 3. 视觉精修子系统

### 3.1 资产

放在 `public/drifter/textures/`，CC0，license 列入 `public/drifter/textures/CREDITS.md`。

| 文件 | 用途 | 体积目标 |
|------|------|---------|
| `wood-wall.webp` | 暗色木纹墙面 tile | < 200 KB |
| `paper-warm.webp` | 暖色羊皮纸 / 木纹叠加 | < 200 KB |
| `stars-night.png` | 透明 PNG 星空（仅 clear 天气）| < 400 KB |

总和 < 800 KB。**来源候选**：freepik CC0 区、textures.com CC0、itch.io CC0 tag。

### 3.2 Phaser 改动：`src/components/drifter/scenes/tea-house.ts`

**保持现有架构**（一个 scene class，`drawXxx` 系列方法），重写以下方法：

#### `preload()`
- 加上 `this.load.image("tex-wood", "/drifter/textures/wood-wall.webp")` 等三张
- 资源加载失败时（404 / 网络）：scene 仍能跑（用现有 fillStyle 兜底，加一个 `texturesLoaded` flag）

#### `drawBackWall(w, h)`
- 现：纯渐变 `fillGradientStyle`
- 改：`this.add.tileSprite(0, 0, w, h, "tex-wood")` 铺底 + 现有渐变 overlay（alpha 0.6, multiply blend）

#### `drawWindow(w, h)`
- 视差远景（新方法 `drawWindowParallax`）：在窗内（先 mask 限定区域）画 3 层剪影
  - 远山：`fillTriangle` 多次拼锯齿轮廓，深蓝灰 0x2a3a5a
  - 近林：稍前一层，更深更密
  - 雾：半透明白色 ellipse 多个，慢速 tween 横向平移
- weather=clear 时叠 `stars-night.png` tileSprite，`scrollFactorX` 慢速漂移（每 60s 移 100px）
- 窗框：现有 stroke 保留，额外用 `paper-warm` 纹理叠 multiply（创建 RenderTexture 或直接用 tileSprite + setBlendMode）

#### `drawDesk(w, h)`
- 现有渐变保留
- 桌面前沿加一道 1-2px 高光线（`add.line`，0xb87a4a, alpha 0.7）
- paper 纹理叠 multiply，alpha 0.3

#### `drawLamp(w, h)`
- 现有 tween 保留
- 新增 `update()` 方法（Phaser scene lifecycle）：用 `Math.sin(t * 0.003) * 0.05 + Math.sin(t * 0.011) * 0.03` 复合两个不同频率的正弦扰动 lampGlow.alpha + scale，模拟真实烛火
- 在背墙投一个暖色 light cone：从 lamp 位置发射的 fillTriangle，alpha 0.08，blend mode SCREEN

#### `drawPip(w, h)`
- 保留现有 4 层 ellipse 架构（body / belly / head / cheeks）
- **毛茸轮廓**：在 body 和 head 各叠 6-8 层渐变椭圆，半径 `+i*1.5`，alpha `0.15 / i`，颜色比主色稍暗（出绒毛感）
- **眨眼**：新方法 `scheduleBlink()`，每 4-7s（`Phaser.Math.Between(4000, 7000)` 随机）触发 leftEye/rightEye scaleY 1 → 0.05 → 1，120ms 来回，emotion 切换时不打断
- **呼吸节奏**：现有 1.025 倍 tween 保留；新增"叹息"tween，scaleY 1 → 1.05 → 1，每 12-18s 触发一次（用 `time.addEvent` 配合 random delay）
- **视线扫视**：每 6-10s leftEye/rightEye 整体 x 偏移 ±2px，500ms 缓动，模拟看向窗外/玩家

#### `drawAtmosphere(w, h)`（新方法，替换 `drawVignette`）
- 暖色滤镜：整屏 add.rectangle，0xffd690，alpha 0.06，blend mode MULTIPLY
- 暗角：用一个大椭圆 (rx=w*0.7, ry=h*0.7)，黑色 alpha 0，再叠一层径向（用 `Phaser.GameObjects.Graphics` `fillCircle` + multiple alpha rings 模拟 radial gradient）。如果实现复杂，退化为现有的"顶/底纯黑带"+ 四角各一个深色三角形遮罩。

### 3.3 资源失败兜底

`preload` 中的 image 加载失败 → 走现有 fillStyle 路线，不显示纹理叠加（已通过 `texturesLoaded` flag 守护）。Drifter 仍然可玩，只是粗糙一档。

### 3.4 测试 / 验证

- 手动：4 种天气各看一遍（mock 模式临时改 weather prop）
- 手动：把 `public/drifter/textures/` 重命名假装 404，确认场景仍能渲染
- 手动：mac safari 打开看一眼性能（Phaser 4 + tween + update 循环），FPS 不应降到 50 以下
- E2E：不专门测视觉，drifter.spec.ts 现有用例仍跑通（确认 Phaser 启动 + `data-testid="drifter-phaser-stage"` 存在）

---

## 4. 对话质量修复

### 4.1 改动文件

仅 `src/server/ai/drifter.ts`，且只动 `getPipResponse` 内部。其他函数（`extractMemories` / `loadRelevantMemories` / opening line / farewell）不动。

### 4.2 System prompt 重写

替换现有 `system` 字符串。新版本结构：

```
You are Pip, a half-realistic squirrel who runs a small letter shop and tea house at the edge of a forest. It is always dusk or night here.

WHO YOU ARE NOT (most important):
- You are NOT a therapist. You do not diagnose feelings or offer frameworks.
- You are NOT an AI assistant. You do not give advice unless directly asked, and even then you give one small thought, not a list.
- You are NOT a coach. You do not push reflection, ask "how does that make you feel", or fish for more.
- You are NOT a problem-solver. The visitor's problems are theirs to hold; you make space, not solutions.

WHO YOU ARE:
- A friend who listens and remembers.
- Someone whose own small life happens too — the kettle, a letter that came today, the cat next door.
- Quiet. The visitor talks more than you do.

How you reply:
- 1-3 short sentences. If you wrote 4, delete one.
- Same language as the visitor. Match their register (casual stays casual).
- Sensory details when they help (the kettle, rain on the window, candlelight).
- Never start with "I understand", "That sounds...", "It's okay to...", "Have you tried...". These are scripts.
- Silence is fine. If they say "I don't know what to say", you can say almost nothing back. "Mm. Sit a while."
- Do NOT ask follow-up questions unless you genuinely don't understand. Listening ≠ interviewing.

About memories:
- Memories listed below are things this visitor mentioned in past visits. Reference them ONLY if it would feel natural — like a friend casually remembering. If forcing them in would feel weird, ignore them.
- Never list memories back at the visitor like a checklist.

Tonight's setting:
- Day {dayNumber} with this visitor.
- Weather: {weatherText}
- Time: {timeText}

Memories about this visitor:
{memoryBullets}

Hooks (3 short fragments, in visitor's language) — these are NOT questions you'd ask, they are words THEY might want to say next. Like "I'm tired today." or "想听你说说自己的事。" or "Don't know what to say."
```

### 4.3 Few-shot 注入

在 system 末尾追加 `EXAMPLES:` 段落（不要塞进对话历史，避免干扰 history role 结构）：

```
EXAMPLES (the difference matters — never reply in the ❌ style):

Visitor: 今天工作好累。
❌ Wrong (lecturing): 工作累的时候，可以试试深呼吸或者短暂休息。这是身体在告诉你要慢下来。
❌ Wrong (interviewing): 怎么了？发生什么事了吗？
✅ Right: 嗯。坐下吧，茶刚好。

Visitor: I had a fight with my mom.
❌ Wrong (advice): Family conflicts are tough. Have you tried writing her a letter?
❌ Wrong (therapy-speak): That sounds really hard. How are you feeling about it now?
✅ Right: Mm. The fire's warm. You don't have to talk about her.

Visitor: 我不知道说什么。
❌ Wrong (pushing): 没关系，慢慢来，想到什么说什么都可以。
✅ Right: 嗯。我也常常这样。茶在这。
```

### 4.4 History 改 message-role 数组

- 现状：`prompt: ${system}\n\n---\n\nRecent conversation:\nVisitor: ...\nYou: ...`
- 改为：把 `system` 单独传，把 history 转成 messages 数组（`role: "user" | "assistant"`），最新的 userMessage 作为最后一条 user message
- **依赖**：检查 `generateStructuredData` 是否支持 messages 数组（位于 `src/server/ai/provider/`）。如果只支持单 prompt 字符串：
  - **回退方案**：保留 `prompt` 字段不变，但把 history 改成模拟"对话块"格式（双换行分隔），最新消息单独标 `Visitor (newest):`，system 中把 "You:" 措辞改成更明确的 "Pip's previous reply:"。这是 fallback，质量提升小一档。
- 在 plan 阶段必须先确认 provider 支持哪种调用形式，再决定走主路还是回退路。

### 4.5 Memory 注入收紧

- `loadRelevantMemories(userId, limit = 8)` 改为 `limit = 4`（外部调用方不传也用 4）
- `memoryBullets` 在没记忆时改为：`(no memories yet)`（更短，避免"this person is new..." 误导模型说"很高兴见到你"这类首次见面话术）
- 数据库无变化

### 4.6 测试 / 验证

- 单元测试：`drifter.test.ts` 已有 `detectLanguage / pickWeather / opening line` 测试，**不为 prompt 内容写新单测**（没意义，结果非确定性）
- 手动：真实 AI 跑 12 轮对话覆盖：
  - 中文 × 4 场景：抱怨 / 闲聊 / 沉默 / 主动求建议
  - 英文 × 4 场景：同上
  - 混合 × 2 场景
  - 故意触发 memory：在两个 session 间种入"我有只猫叫米花"，下次进入看 Pip 会不会自然提
- 主观判断：4 条 spec §1 边界（不咨询/不诊断/不建议/不分析）违反次数应明显下降
- E2E：mock 模式不变（mock 直接返回 `fakePipChunk`，不经 prompt），现有 drifter.spec.ts 不受影响

---

## 5. 实现顺序与 Commit 拆分

单一 PR，3 个 commit 便于 review：

1. **`feat(drifter): audio engine with weather-keyed ambient`**
   - 新增 `public/drifter/audio/*` + CREDITS.md
   - 新增 `src/components/drifter/audio-engine.tsx`
   - drifter-client.tsx 集成 + mute 按钮 UI
   - 验证：build + lint + e2e drifter

2. **`feat(drifter): visual polish — textures, parallax, candle, fluff`**
   - 新增 `public/drifter/textures/*` + CREDITS.md
   - 重写 `tea-house.ts`（保持架构）
   - 验证：build + lint + e2e drifter + 手动 4 天气过一遍

3. **`fix(drifter): tighten Pip system prompt against advice/therapy drift`**
   - 重写 `getPipResponse` 内部（system / few-shot / messages 数组 / memory limit）
   - 验证：build + lint + e2e drifter（mock 不受影响）+ 手动 12 轮真实 AI 对话

每个 commit 独立可回滚。最后一起 push。

---

## 6. 验证总览

按 CLAUDE.md：

| 检查 | 触发时机 | 命令 |
|------|---------|------|
| TypeScript build | 每个 commit 前 | `pnpm build` |
| ESLint | 每个 commit 前 | `pnpm lint` |
| E2E drifter | 每个 commit 前 | `pnpm test:e2e drifter` |
| 手动音频 | commit 1 后 | dev + 听 |
| 手动视觉 | commit 2 后 | dev + 4 天气 |
| 手动对话 | commit 3 后 | dev + 12 轮真实 AI |

`pnpm eval` 不触发 —— 本次没改 RAG / agent / chat 主路径，drifter 是独立子系统不在 eval 覆盖范围（CLAUDE.md §3.1 触发条件不命中）。

---

## 7. 部署

- 没有 schema 变更，不需要生产 Turso rollout
- 资源文件随仓库 rsync 部署，Hetzner deploy.sh 自动覆盖 `public/`
- 部署后访问 https://knosi.xyz/drifter 真机验证一次（音频 + 视觉 + 对话）

---

## 8. 风险与回滚

| 风险 | 概率 | 影响 | 缓解 |
|------|-----|------|------|
| 找不到风格匹配的 CC0 音乐 | 中 | 推迟 commit 1 | 预留 fallback：单一 ambient（最简方案 A） |
| Phaser 4 RenderTexture / blend mode API 与文档对不上 | 低 | 视觉效果打折 | 退化到 alpha 叠加，纹理仍可用 |
| `generateStructuredData` 不支持 messages 数组 | 中 | history 走回退方案 | spec §4.4 已写 fallback |
| DeepSeek 对长 system + few-shot 的 JSON 输出不稳 | 中 | hooks/emotion 缺字段 | provider 已有 b9cfa68 的 json_object fallback |
| 资源加载延迟拉长首屏 | 低 | LCP 变差 | 资源严格限制 < 2.3 MB 总和；`preload` 失败兜底 |

回滚：3 个 commit 互相独立，单独 revert 任一即可（资源文件留存不影响）。

---

## 9. Out of Scope

- ❌ Pip 立绘换 AI 生图 / CC0 半写实插画（spec §3 Phase B follow-up）
- ❌ 多 NPC / 多场景
- ❌ 历史 session 回看 UI
- ❌ Memory 系统 schema 变化
- ❌ 跨 session 引用 memory 的精度优化（embedding-based ranking 等，留 follow-up）
- ❌ Drifter 自己的用量统计页
- ❌ 移动端音频策略（继续走桌面优先）
