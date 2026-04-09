# Ask AI M3 — Output Actions Implementation Plan

**Goal:** 把 Inline Ask AI 的输出从"一个按钮把 plain text 塞到光标位置"升级为真正的**动作层**：

1. **Insert at caret**（已有）
2. **Replace selection**（已有，rewrite 模式下的"替换"）
3. **Append to end of current note**（新）
4. **Append to another note**（新 —— 选一条已有 note 追加进去，可以跨 note）
5. **Copy**（新，复制到剪贴板）
6. **AI 输出结构化 Tiptap blocks**（新 —— 强制 AI 输出 JSON 格式的 ProseMirror blocks 而不是 Markdown）

**Why M3 (vs M2):**
- M2 解决了"给 AI 正确的上下文"，但用户还在做最后一步"复制 → 粘贴"的活儿。
- Notion 的杀手级体验就是 AI 答案作为 first-class block，可以跳转插入、追加到任意 note、继续编辑。
- "结构化 blocks 输出"解决 M1 `aiTextToTiptapJson` 的 fidelity 天花板 —— 目前只支持 heading / bullet list / code fence / paragraph，AI 写的表格、callout、toggle 都会退化成纯文本。让 AI 直接输出 JSON 后这些高级块就能原样入库。

**Architecture:**

- **前端 action bar**：Inline popover 的底部按钮区，根据场景显示不同 action（只有文本时显示 Insert / Copy / Append here / Append to... / Discard；rewrite 时多一个 Replace）。
- **Append to another note**：点击后弹一个类似 mention menu 的选 note 下拉，选中后通过一个新的 tRPC mutation `notes.appendBlocks` 把 blocks 塞到目标 note 末尾（server 端操作，不需要把目标 note load 到当前 editor）。
- **AI 输出结构化 blocks**：扩展 system prompt，要求 AI 在 `<ai_blocks>...</ai_blocks>` XML 标签里返回 JSON 数组，元素就是 Tiptap `JSONContent`。前端 parse 这段 JSON，失败时 fall back 到 `aiTextToTiptapJson` 继续用现有路径（保证兼容性 + 容错）。
- **provider 能力评估**：结构化 JSON 输出对 provider 的指令遵循能力要求高，M3 第一版**可选 opt-in**：在 system prompt 里 "**优先**输出 `<ai_blocks>` JSON" 而不是 "**只**输出"，parse 失败就退回 text。下版本再强制。

**Tech Stack:** Next.js 16, React 19, Tiptap v3, `@ai-sdk/react`, tRPC v11, zod/v4, Tailwind.

**Scope boundaries（本 Milestone 不做）：**
- ❌ 多模态（M4）
- ❌ Inline citation 角标（M5）
- ❌ Daemon 模式的 action bar（和 M1/M2 一样，inline 用 stream 模式）
- ❌ 撤销/重做跨 note 的 append（用户可以手动回到目标 note 按 Cmd+Z，但不做跨 tab 的 undo）
- ❌ Append to **project notes** / learning notes（只做普通 `notes` 表，project / learning 有独立 router，留给后续）

---

## File Structure

### Create
- `src/components/editor/inline-ask-ai-action-bar.tsx` — 把 popover 底部按钮区独立出来的子组件，负责渲染 action 按钮 + 处理 append-to-note 菜单。~180 行。
- `src/components/editor/inline-ask-ai-append-target-menu.tsx` — 选目标 note 的下拉菜单（可以复用 mention menu 的 pattern，但只搜 notes，不搜 bookmarks）。~110 行。
- `src/lib/parse-ai-blocks.ts` — 纯函数 `parseAiBlocks(text: string): { blocks: JSONContent[] | null, cleanText: string }`，从 AI 输出里抽出 `<ai_blocks>...</ai_blocks>` JSON，解析失败返回 `null`。~80 行。
- `e2e/ask-ai-actions.spec.ts` — 覆盖 Append / Copy / Append to another note 三个新路径。

### Modify
- `src/components/editor/inline-ask-ai-popover.tsx`
  - 抽出 action bar 到子组件
  - 新增 `handleAppendHere` / `handleCopy` / `handleAppendToOther` 函数
  - `handleInsert` 里优先走 `parseAiBlocks` 路径，失败回退现有 `aiTextToTiptapJson`
- `src/server/routers/notes.ts`
  - 新增 `appendBlocks` mutation：输入 `{ noteId: string, blocks: JSONContent[] }`，服务端读 note、把 blocks 追加到 content 的 doc 末尾、写回 db、同时更新 `plainText` 索引。
  - **SECURITY**：严格 `userId` scope，防止跨用户 append。
- `src/server/ai/chat-system-prompt.ts`
  - `BuildSystemPromptOptions` 新增 `preferStructuredBlocks?: boolean`
  - `finalizePrompt` 里如果 flag true，在 prompt 末尾追加一段"**优先输出结构化格式**：如果回答包含多种块（标题、列表、代码块、callout），把整个回答包在 `<ai_blocks>` 里作为 JSON 数组..."
- `src/app/api/chat/route.ts`
  - `chatInputSchema` 加 `preferStructuredBlocks: z.boolean().optional()`
  - stream 分支透传给 `buildSystemPrompt`
- `docs/changelog/2026-04-10-ask-ai-m3-output-actions.md` — M3 留档

---

## Task 1: Backend `notes.appendBlocks` mutation

**Files:**
- Modify: `src/server/routers/notes.ts`

- [ ] **Step 1: Look up the existing notes router structure**
- [ ] **Step 2: Add new mutation:**

  ```ts
  appendBlocks: protectedProcedure
    .input(z.object({
      noteId: z.string().min(1),
      blocks: z.array(z.any()).min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .select()
        .from(notes)
        .where(and(eq(notes.id, input.noteId), eq(notes.userId, ctx.userId)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      const doc = row.content ? JSON.parse(row.content) : { type: "doc", content: [] };
      doc.content = [...(doc.content ?? []), ...input.blocks];

      const plain = extractPlainTextFromDoc(doc); // reuse existing helper if any

      await db.update(notes)
        .set({
          content: JSON.stringify(doc),
          plainText: plain,
          updatedAt: new Date(),
        })
        .where(eq(notes.id, input.noteId));

      return { ok: true, blocksAppended: input.blocks.length };
    }),
  ```

  - 如果现有 notes 的 plainText 抽取逻辑是个独立 helper 就直接复用，否则 inline 一个最小版本
  - `content` 存储格式确认（JSON string vs object），按现状走
- [ ] **Step 3: Typecheck + commit**

---

## Task 2: `parseAiBlocks` utility

**Files:**
- Create: `src/lib/parse-ai-blocks.ts`

- [ ] **Step 1: Implement**

  ```ts
  import type { JSONContent } from "@tiptap/react";

  const AI_BLOCKS_REGEX = /<ai_blocks>\s*([\s\S]*?)\s*<\/ai_blocks>/;

  export function parseAiBlocks(text: string): {
    blocks: JSONContent[] | null;
    cleanText: string;
  } {
    const match = text.match(AI_BLOCKS_REGEX);
    if (!match) return { blocks: null, cleanText: text };

    try {
      const parsed = JSON.parse(match[1]);
      if (!Array.isArray(parsed)) return { blocks: null, cleanText: text };
      const cleanText = text.replace(AI_BLOCKS_REGEX, "").trim();
      return { blocks: parsed, cleanText };
    } catch {
      return { blocks: null, cleanText: text };
    }
  }
  ```

- [ ] **Step 2: Commit**

---

## Task 3: System prompt opt-in for structured blocks

**Files:**
- Modify: `src/server/ai/chat-system-prompt.ts`
- Modify: `src/app/api/chat/route.ts`

- [ ] **Step 1: Add `preferStructuredBlocks` to `BuildSystemPromptOptions`**
- [ ] **Step 2: Append instruction snippet inside `finalizePrompt` when flag is on:**

  ```
  ---

  **结构化输出（首选）**：如果你的回答包含多种块类型（标题、列表、代码、callout 等），优先在回答里用 <ai_blocks>...</ai_blocks> XML 标签包裹一个 JSON 数组，每个元素是 Tiptap ProseMirror JSONContent 节点。示例：

  <ai_blocks>
  [
    {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"要点"}]},
    {"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"第一点"}]}]}]}
  ]
  </ai_blocks>

  如果回答只是一段纯文本或一两个段落，用纯文本即可，不必包在 ai_blocks 里。
  ```

- [ ] **Step 3: Schema + transport**
  - `chatInputSchema` 加 `preferStructuredBlocks: z.boolean().optional()`
  - Stream 分支透传给 `buildSystemPrompt`
  - Inline popover 的 `sendMessage` body 里默认打开这个 flag

- [ ] **Step 4: Commit**

---

## Task 4: Action bar component + append-target menu

**Files:**
- Create: `src/components/editor/inline-ask-ai-action-bar.tsx`
- Create: `src/components/editor/inline-ask-ai-append-target-menu.tsx`

- [ ] **Step 1: Action bar contract**

  ```ts
  interface Props {
    isRewrite: boolean;
    hasAnswer: boolean;
    isLoading: boolean;
    onInsert: () => void;    // insert at caret (existing behavior)
    onReplace: () => void;   // replace selection (rewrite mode only)
    onAppendHere: () => void;
    onAppendToOther: (noteId: string) => void;
    onCopy: () => void;
    onDiscard: () => void;
  }
  ```

  Render a horizontal row:
  - While loading: show "停止" only
  - When has answer:
    - Primary button: "替换" (rewrite) or "插入" (default)
    - Secondary: "追加到末尾" → triggers onAppendHere
    - Secondary: "追加到... ▾" → opens <InlineAskAiAppendTargetMenu>
    - Icon button: Copy → onCopy + toast
    - Text button: 丢弃 → onDiscard

- [ ] **Step 2: Append target menu**

  复用 `InlineAskAiMentionMenu` 的 pattern，只搜 notes。点击一条 note 时调用 `onSelect(note.id)`。

- [ ] **Step 3: Commit**

---

## Task 5: Wire actions into `InlineAskAiPopover`

**Files:**
- Modify: `src/components/editor/inline-ask-ai-popover.tsx`

- [ ] **Step 1: Extract text → blocks helper**

  ```ts
  function answerToBlocks(text: string): JSONContent[] {
    const parsed = parseAiBlocks(text);
    if (parsed.blocks && parsed.blocks.length > 0) return parsed.blocks;
    return aiTextToTiptapJson(parsed.cleanText);
  }
  ```

- [ ] **Step 2: New handler functions**

  ```ts
  const handleAppendHere = () => {
    const blocks = answerToBlocks(lastAssistantText);
    if (!blocks.length) return;
    const endPos = editor.state.doc.content.size;
    editor.chain().focus().insertContentAt(endPos, blocks).run();
    onClose();
  };

  const handleCopy = async () => {
    const cleaned = parseAiBlocks(lastAssistantText).cleanText;
    await navigator.clipboard.writeText(cleaned);
    // show a toast; leave popover open so users can continue
  };

  const appendBlocksToOther = trpc.notes.appendBlocks.useMutation();

  const handleAppendToOther = async (noteId: string) => {
    const blocks = answerToBlocks(lastAssistantText);
    if (!blocks.length) return;
    await appendBlocksToOther.mutateAsync({ noteId, blocks });
    // show a toast linking to /notes/{noteId}; leave popover open
  };
  ```

- [ ] **Step 3: Replace inline action buttons with `<InlineAskAiActionBar>`**

- [ ] **Step 4: Default `sendMessage` body to `preferStructuredBlocks: true`**

- [ ] **Step 5: Commit**

---

## Task 6: E2E

**Files:**
- Create: `e2e/ask-ai-actions.spec.ts`

- [ ] **Step 1: Seed a target note (UI create + wait for "Saved")**
- [ ] **Step 2: Mock `/api/chat` to return a response containing `<ai_blocks>` JSON** — e.g.:
  ```
  Here's what I found:
  <ai_blocks>
  [
    {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"TEST_HEADING"}]}
  ]
  </ai_blocks>
  ```
- [ ] **Step 3: Test scenarios**
  1. `/ai` → type prompt → answer arrives → click "追加到末尾" → assert current editor ends with a heading containing TEST_HEADING
  2. Click "追加到..." → pick the seeded target note → assert `appendBlocks` mutation was called (intercept `/api/trpc/notes.appendBlocks` via `page.route`) with the right blocks payload
  3. Click "复制" → assert clipboard contains the cleaned text (use `context.grantPermissions(['clipboard-read'])`)
  4. Fallback: mock a response **without** `<ai_blocks>` → "插入" still works via `aiTextToTiptapJson`

- [ ] **Step 4: Commit**

---

## Task 7: Changelog + verification

- [ ] `pnpm build` ✅
- [ ] `pnpm lint` ✅
- [ ] `pnpm test:e2e e2e/ask-ai-actions.spec.ts` ✅
- [ ] `pnpm test:e2e --workers=1 e2e/ask-ai-*.spec.ts` ✅ (full inline AI suite still green)
- [ ] Write `docs/changelog/2026-04-10-ask-ai-m3-output-actions.md`
- [ ] Commit

---

## Success criteria

- Insert / Replace 保持原有行为
- 新 "追加到末尾" 按钮：把 answer 写到当前 note 的 doc 尾部
- 新 "追加到..." 按钮：选一条其它 note，通过 `notes.appendBlocks` mutation 写到目标 note 的 doc 尾部，userId scope 严格
- 新 "复制" 按钮：剪贴板里是 cleaned text（去掉 `<ai_blocks>` 和 sources 标记）
- 如果 AI 按要求输出了 `<ai_blocks>` JSON，插入时用 parsed blocks；否则回退 `aiTextToTiptapJson`
- E2E 四条 scenarios 全绿
- build / lint / 既有 ask-ai e2e 无 regression

---

## Follow-up for M3+

- Append to **project notes** / **learning notes**：这两个表各自有独立 router，需要单独 mutation；等基础 append 跑稳后统一接口
- Undo for cross-note append：目前跨 note 追加没有 client-side undo，应该至少 toast 里给"撤销"按钮调 tRPC mutation 切掉尾部 N 个 blocks
- Structured blocks 严格模式：第一版 opt-in，观察 provider 实际 compliance 率；如果 ≥95% 就可以改成强制
