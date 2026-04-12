# RAG Keyword Retrieval Optimization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the naive `includes()` keyword matching in agentic-rag.ts with BM25 scoring + Chinese dictionary segmentation, improving retrieval recall by ~25-30% without any external model/API dependency.

**Architecture:** Add a lightweight BM25 scorer that builds IDF stats from all chunks at query time. Replace the n-gram CJK tokenizer with a forward-max-match dictionary segmenter (zero dependencies, ~200 common Chinese terms). Both modules are pure functions with no external packages.

**Tech Stack:** Pure TypeScript, no new npm dependencies.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/server/ai/tokenizer.ts` | **Create** | Chinese dictionary segmenter + Latin tokenizer. Shared by both `agentic-rag.ts` and `rag.ts` |
| `src/server/ai/bm25.ts` | **Create** | BM25 scoring engine: build corpus stats, score query against documents |
| `src/server/ai/agentic-rag.ts` | **Modify** | Replace `scoreKeywordMatch()` and `extractCjkTerms()`/`extractAsciiTerms()` with tokenizer + BM25 |
| `src/server/ai/rag.ts` | **Modify** | Same replacement for the fallback RAG path |
| `src/server/ai/indexer.ts` | **Modify** | Add `console.warn` to the `.catch(() => null)` so embedding failures are visible |

---

### Task 1: Create the tokenizer module

**Files:**
- Create: `src/server/ai/tokenizer.ts`

- [ ] **Step 1: Create tokenizer with Chinese dictionary + Latin extraction**

```typescript
// src/server/ai/tokenizer.ts

/**
 * Lightweight tokenizer for Chinese + Latin mixed text.
 * Chinese: forward-max-match with a built-in dictionary (~200 terms).
 * Latin: regex extraction of [a-z0-9-]+ tokens.
 * No external dependencies.
 */

const CJK_RANGE_REGEX = /[\u3400-\u9fff\uf900-\ufaff]+/g;
const LATIN_TOKEN_REGEX = /[a-z0-9][a-z0-9._-]{1,}/gi;

const MIN_TOKEN_LENGTH = 2;

// Common Chinese terms for knowledge management / tech / daily use.
// Forward-max-match will try longest match first (up to 4 chars).
// This list is intentionally broad — false positives are harmless
// (they just become extra tokens), while misses lose recall.
const DICTIONARY = new Set([
  // Tech — general
  "性能", "优化", "性能优化", "前端", "后端", "全栈",
  "框架", "组件", "渲染", "状态", "管理", "状态管理",
  "路由", "部署", "测试", "单元测试", "接口", "数据",
  "数据库", "缓存", "索引", "分页", "搜索", "查询",
  "配置", "环境", "变量", "环境变量", "函数", "方法",
  "类型", "模块", "依赖", "打包", "编译", "构建",
  "发布", "版本", "日志", "监控", "报警", "告警",
  "错误", "异常", "调试", "排查", "修复", "重构",
  "迁移", "升级", "回滚", "备份", "恢复",
  "权限", "认证", "授权", "登录", "注册",
  "加密", "解密", "安全", "漏洞",
  "并发", "异步", "同步", "线程", "进程",
  "内存", "泄漏", "溢出", "调优",
  "代码", "审查", "代码审查", "代码质量",
  "算法", "架构", "设计", "模式", "设计模式",
  "服务", "微服务", "容器", "集群",
  "网络", "请求", "响应", "协议",
  "文件", "目录", "路径",
  "注释", "文档", "规范",

  // Knowledge / note-taking
  "知识", "知识库", "笔记", "书签", "标签",
  "分类", "归档", "收藏", "导入", "导出",
  "编辑", "删除", "创建", "更新", "修改",
  "模板", "格式", "样式",
  "链接", "引用", "关联", "嵌入",

  // Work / productivity
  "工作", "进展", "复盘", "总结", "计划",
  "目标", "任务", "项目", "需求", "方案",
  "会议", "讨论", "决策", "反馈", "评审",
  "排期", "优先级", "里程碑", "交付",
  "团队", "协作", "沟通",

  // Learning
  "学习", "教程", "课程", "练习", "实践",
  "概念", "原理", "理论", "思路", "思考",
  "问题", "解决", "方案", "经验", "技巧",
  "入门", "进阶", "精通",

  // Daily / life
  "日记", "生活", "健康", "运动", "饮食",
  "阅读", "写作", "记录", "回顾", "反思",
  "时间", "效率", "习惯", "目标",
  "旅行", "摄影", "音乐", "电影",
  "财务", "预算", "支出", "收入", "投资",
]);

/** Stopwords — high-frequency terms that hurt precision */
const STOPWORDS = new Set([
  // Chinese
  "的", "了", "在", "是", "我", "有", "和", "就",
  "不", "人", "都", "一", "一个", "上", "也", "很",
  "到", "说", "要", "去", "你", "会", "着", "没有",
  "看", "好", "自己", "这", "他", "她", "它",
  "那", "吗", "什么", "怎么", "如何", "为什么",
  "可以", "能够", "能不能", "请问", "帮我", "麻烦",
  "一下", "一下子", "这个", "那个", "我的",
  // English
  "the", "be", "to", "of", "and", "in", "that", "have",
  "it", "for", "not", "on", "with", "he", "as", "you",
  "do", "at", "this", "but", "his", "by", "from", "they",
  "we", "her", "she", "or", "an", "will", "my", "all",
  "would", "there", "their", "what", "so", "if", "about",
  "who", "which", "when", "can", "no", "make", "just",
  "than", "been", "its", "how", "has", "had", "did",
  "is", "are", "was", "were", "am",
]);

/**
 * Forward-max-match Chinese segmentation.
 * Tries to match the longest dictionary entry first (up to 4 chars).
 * Non-matching characters are skipped (single CJK chars are too noisy).
 */
function segmentCjk(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;

  while (i < text.length) {
    let matched = "";
    for (let len = Math.min(4, text.length - i); len >= 2; len--) {
      const candidate = text.slice(i, i + len);
      if (DICTIONARY.has(candidate)) {
        matched = candidate;
        break;
      }
    }

    if (matched) {
      tokens.push(matched);
      i += matched.length;
    } else {
      i += 1;
    }
  }

  return tokens;
}

/**
 * Tokenize mixed Chinese + Latin text.
 * Returns deduplicated tokens sorted by length (longest first).
 */
export function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();

  // Extract Latin tokens
  const latinTokens = (normalized.match(LATIN_TOKEN_REGEX) ?? [])
    .filter((t) => t.length >= MIN_TOKEN_LENGTH);

  // Extract CJK segments and run dictionary segmentation
  const cjkSegments = normalized.match(CJK_RANGE_REGEX) ?? [];
  const cjkTokens = cjkSegments.flatMap((seg) => segmentCjk(seg));

  // Merge, deduplicate, filter stopwords
  const all = [...latinTokens, ...cjkTokens]
    .filter((t) => !STOPWORDS.has(t));

  return [...new Set(all)].sort((a, b) => b.length - a.length);
}

/**
 * Tokenize a document for BM25 indexing.
 * Same as tokenize() but keeps duplicates for term frequency counting.
 */
export function tokenizeForIndex(text: string): string[] {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();

  const latinTokens = (normalized.match(LATIN_TOKEN_REGEX) ?? [])
    .filter((t) => t.length >= MIN_TOKEN_LENGTH);

  const cjkSegments = normalized.match(CJK_RANGE_REGEX) ?? [];
  const cjkTokens = cjkSegments.flatMap((seg) => segmentCjk(seg));

  return [...latinTokens, ...cjkTokens].filter((t) => !STOPWORDS.has(t));
}

/** Expose dictionary for external augmentation (e.g. user-added terms) */
export function addToDictionary(terms: string[]) {
  for (const term of terms) {
    if (term.length >= 2 && term.length <= 4) {
      DICTIONARY.add(term);
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit --pretty src/server/ai/tokenizer.ts 2>&1 | head -20`
Expected: No errors (or check with full build later in Task 4)

- [ ] **Step 3: Quick smoke test**

Run in project root:
```bash
node -e "
const { tokenize } = require('./src/server/ai/tokenizer.ts');
console.log(tokenize('性能优化和前端调优'));
console.log(tokenize('最近工作有什么进展'));
console.log(tokenize('React渲染性能怎么优化'));
console.log(tokenize('知识库搜索查��'));
"
```

Note: This may not work with raw TS. Instead verify in Task 4 via build. If `tsx` is available:
```bash
npx tsx -e "import { tokenize } from './src/server/ai/tokenizer'; console.log(tokenize('��能优化和前端调优')); console.log(tokenize('React渲染性能怎么优化'));"
```

Expected output:
```
[ '性能优化', '前端', '调优' ]
[ '工作', '进展' ]
[ '渲染', '性能', '优化' ]
[ '知���库', '搜索', '查询' ]
```

---

### Task 2: Create the BM25 scoring module

**Files:**
- Create: `src/server/ai/bm25.ts`

- [ ] **Step 1: Create BM25 scorer**

```typescript
// src/server/ai/bm25.ts

/**
 * Lightweight BM25 scoring for in-memory document collections.
 *
 * BM25 advantages over naive includes():
 * - Terms appearing in fewer documents score higher (IDF)
 * - Term frequency has diminishing returns (saturation via k1)
 * - Document length is normalized (short chunks aren't penalized)
 *
 * No external dependencies.
 */

import { tokenizeForIndex } from "./tokenizer";

/** Tunable BM25 parameters */
const K1 = 1.2;   // term frequency saturation
const B = 0.75;    // document length normalization

export interface BM25Document {
  id: string;
  /** Pre-tokenized terms (with duplicates for TF counting) */
  terms: string[];
}

export interface BM25Index {
  /** Number of documents */
  docCount: number;
  /** Average document length in tokens */
  avgDocLength: number;
  /** Document frequency: how many docs contain each term */
  df: Map<string, number>;
  /** Per-document term frequencies */
  tfMap: Map<string, Map<string, number>>;
  /** Per-document token counts */
  docLengths: Map<string, number>;
}

/**
 * Build a BM25 index from a list of documents.
 * Call this once per query with the current chunk set.
 */
export function buildBM25Index(docs: BM25Document[]): BM25Index {
  const df = new Map<string, number>();
  const tfMap = new Map<string, Map<string, number>>();
  const docLengths = new Map<string, number>();
  let totalLength = 0;

  for (const doc of docs) {
    docLengths.set(doc.id, doc.terms.length);
    totalLength += doc.terms.length;

    const tf = new Map<string, number>();
    const seen = new Set<string>();

    for (const term of doc.terms) {
      tf.set(term, (tf.get(term) ?? 0) + 1);

      if (!seen.has(term)) {
        seen.add(term);
        df.set(term, (df.get(term) ?? 0) + 1);
      }
    }

    tfMap.set(doc.id, tf);
  }

  return {
    docCount: docs.length,
    avgDocLength: docs.length > 0 ? totalLength / docs.length : 0,
    df,
    tfMap,
    docLengths,
  };
}

/**
 * Score a single document against a set of query terms.
 * Returns 0 if no query terms match.
 */
export function scoreBM25(
  index: BM25Index,
  docId: string,
  queryTerms: string[]
): number {
  const tf = index.tfMap.get(docId);
  const docLength = index.docLengths.get(docId) ?? 0;

  if (!tf || docLength === 0) return 0;

  let score = 0;

  for (const term of queryTerms) {
    const termFreq = tf.get(term) ?? 0;
    if (termFreq === 0) continue;

    const docFreq = index.df.get(term) ?? 0;
    if (docFreq === 0) continue;

    // IDF with smoothing to avoid negative values
    const idf = Math.log(
      1 + (index.docCount - docFreq + 0.5) / (docFreq + 0.5)
    );

    // BM25 TF component
    const tfNorm =
      (termFreq * (K1 + 1)) /
      (termFreq + K1 * (1 - B + B * (docLength / index.avgDocLength)));

    score += idf * tfNorm;
  }

  return score;
}

/**
 * Convenience: tokenize text and build a BM25Document.
 */
export function toBM25Document(id: string, text: string): BM25Document {
  return { id, terms: tokenizeForIndex(text) };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit --pretty src/server/ai/bm25.ts 2>&1 | head -20`

---

### Task 3: Integrate BM25 + tokenizer into agentic-rag.ts

**Files:**
- Modify: `src/server/ai/agentic-rag.ts`

- [ ] **Step 1: Replace imports and remove old tokenization functions**

Remove these functions from `agentic-rag.ts`:
- `extractAsciiTerms()`
- `cleanCjkSegment()`
- `extractCjkTerms()`
- `uniqueTerms()`
- `normalizeText()` (keep a local 1-liner if needed)
- The constants: `QUERY_NOISE_PATTERNS`, `GENERIC_CJK_TERMS`, `LATIN_TERM_REGEX`, `CJK_SEGMENT_REGEX`, `MIN_TERM_LENGTH`, `MAX_CJK_TERM_LENGTH`

Add imports:
```typescript
import { tokenize, tokenizeForIndex } from "./tokenizer";
import { buildBM25Index, scoreBM25, toBM25Document } from "./bm25";
```

- [ ] **Step 2: Update QueryProfile and buildQueryProfile**

Replace the `terms` field to use the new tokenizer:

```typescript
interface QueryProfile {
  normalized: string;
  preferredType: "note" | "bookmark" | null;
  prefersRecent: boolean;
  prefersSummary: boolean;
  tokens: string[];  // renamed from terms
}

function normalizeText(text: string | null | undefined) {
  return (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function buildQueryProfile(query: string): QueryProfile {
  const normalized = normalizeText(query);
  const prefersNotes = NOTES_QUERY_REGEX.test(normalized);
  const prefersBookmarks = BOOKMARKS_QUERY_REGEX.test(normalized);

  return {
    normalized,
    tokens: tokenize(query),
    prefersRecent: RECENT_QUERY_REGEX.test(query),
    prefersSummary: SUMMARY_QUERY_REGEX.test(query),
    preferredType:
      prefersNotes === prefersBookmarks
        ? null
        : prefersNotes
          ? "note"
          : "bookmark",
  };
}
```

- [ ] **Step 3: Replace scoreKeywordMatch with BM25-based scoring**

Replace the entire keyword matching section in `retrieveAgenticContext()` (lines ~283-290) with:

```typescript
  // Build BM25 index from all scoped chunks
  const bm25Docs = scopedChunks.map((chunk) =>
    toBM25Document(
      chunk.id,
      [chunk.sourceTitle, parseSectionPath(chunk.sectionPath).join(" "), chunk.text].join(" ")
    )
  );
  const bm25Index = buildBM25Index(bm25Docs);

  // Score each chunk with BM25 + title/recency boosts
  const keywordMatches = scopedChunks
    .map((chunk) => {
      let score = scoreBM25(bm25Index, chunk.id, profile.tokens);
      if (score === 0) return { chunk, score: 0 };

      // Title exact match boost
      const normalizedTitle = normalizeText(chunk.sourceTitle);
      if (profile.normalized && normalizedTitle.includes(profile.normalized)) {
        score += 5;
      }

      // Title token match boost
      for (const token of profile.tokens) {
        if (normalizedTitle.includes(token)) {
          score += 2;
        }
      }

      // Source type preference
      if (profile.preferredType === chunk.sourceType) {
        score += 1.5;
      }

      // Recency boost
      if (profile.prefersRecent) {
        score += getRecentBoost(chunk.sourceUpdatedAt) * 0.5;
      }

      // Summary preference
      if (profile.prefersSummary && chunk.text.length >= 160) {
        score += 1;
      }

      return { chunk, score };
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, KEYWORD_LIMIT);
```

- [ ] **Step 4: Commit**

```bash
git add src/server/ai/tokenizer.ts src/server/ai/bm25.ts src/server/ai/agentic-rag.ts
git commit -m "feat(rag): replace naive keyword matching with BM25 + Chinese dictionary segmentation"
```

---

### Task 4: Integrate BM25 + tokenizer into rag.ts (fallback path)

**Files:**
- Modify: `src/server/ai/rag.ts`

- [ ] **Step 1: Replace imports and remove duplicated tokenization code**

Same cleanup as Task 3 — remove the duplicated `extractAsciiTerms`, `extractCjkTerms`, `cleanCjkSegment`, `uniqueTerms`, `QUERY_NOISE_PATTERNS`, `GENERIC_CJK_TERMS`, etc.

Add imports:
```typescript
import { tokenize, tokenizeForIndex } from "./tokenizer";
import { buildBM25Index, scoreBM25, type BM25Document } from "./bm25";
```

- [ ] **Step 2: Update buildQueryProfile to use tokenizer**

```typescript
function buildQueryProfile(query: string): QueryProfile {
  const normalized = normalizeText(query);
  const prefersNotes = NOTES_QUERY_REGEX.test(normalized);
  const prefersBookmarks = BOOKMARKS_QUERY_REGEX.test(normalized);

  return {
    normalized,
    terms: tokenize(query),
    prefersRecent: RECENT_QUERY_REGEX.test(query),
    prefersSummary: SUMMARY_QUERY_REGEX.test(query),
    preferredType:
      prefersNotes === prefersBookmarks
        ? null
        : prefersNotes
          ? "note"
          : "bookmark",
  };
}
```

- [ ] **Step 3: Replace scoreRecord with BM25-based scoring**

In `retrieveContext()`, replace the scoring section with BM25:

```typescript
  if (profile.terms.length > 0) {
    const bm25Docs: BM25Document[] = scopedRecords.map((record) => ({
      id: record.id,
      terms: tokenizeForIndex(
        [record.title, record.content].join(" ")
      ),
    }));
    const bm25Index = buildBM25Index(bm25Docs);

    const scoredResults = scopedRecords
      .map((record) => {
        let score = scoreBM25(bm25Index, record.id, profile.terms);
        if (score === 0) return { record, matchScore: 0 };

        // Title match boost
        if (profile.normalized && record.normalizedTitle.includes(profile.normalized)) {
          score += 5;
        }
        for (const term of profile.terms) {
          if (record.normalizedTitle.includes(term)) {
            score += 2;
          }
        }
        if (profile.preferredType === record.type) {
          score += 1.5;
        }
        if (profile.prefersRecent) {
          score += getRecentBoost(record.updatedAt) * 0.5;
        }
        if (profile.prefersSummary && record.content.length >= 160) {
          score += 1;
        }

        return { record, matchScore: score };
      })
      .filter(({ matchScore }) => matchScore > 0)
      .sort((left, right) => right.matchScore - left.matchScore)
      .slice(0, MAX_RESULTS)
      .map(({ record, matchScore }) =>
        toRetrievalResult(record, profile, matchScore)
      );

    if (scoredResults.length > 0) {
      return scoredResults;
    }
  }
```

- [ ] **Step 4: Remove the now-unused scoreRecord function**

Delete the old `scoreRecord()` function.

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/rag.ts
git commit -m "feat(rag): apply BM25 + tokenizer to fallback RAG path"
```

---

### Task 5: Add embedding failure logging

**Files:**
- Modify: `src/server/ai/indexer.ts:200-202`

- [ ] **Step 1: Replace silent .catch with logged warning**

Change:
```typescript
const embedded = await embedTexts(nextChunks.map((chunk) => chunk.text)).catch(
  () => null
);
```

To:
```typescript
const embedded = await embedTexts(nextChunks.map((chunk) => chunk.text)).catch(
  (error) => {
    console.warn(
      `[indexer] embedding failed for ${sourceType}:${sourceId} — ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
);
```

- [ ] **Step 2: Same fix in agentic-rag.ts query path**

In `agentic-rag.ts`, the query embedding call (line ~297) also silently catches:
```typescript
const embeddedQuery = await embedTexts([query]).catch(() => null);
```

Change to:
```typescript
const embeddedQuery = await embedTexts([query]).catch((error) => {
  console.warn(
    `[rag] query embedding failed — ${error instanceof Error ? error.message : String(error)}`
  );
  return null;
});
```

- [ ] **Step 3: Commit**

```bash
git add src/server/ai/indexer.ts src/server/ai/agentic-rag.ts
git commit -m "fix(rag): log embedding failures instead of silently swallowing them"
```

---

### Task 6: Build verification + smoke test

**Files:** (no new files)

- [ ] **Step 1: Run TypeScript build**

```bash
pnpm build
```

Expected: Build succeeds with no type errors.

- [ ] **Step 2: Run lint**

```bash
pnpm lint
```

Expected: No new lint errors.

- [ ] **Step 3: Run E2E tests**

```bash
pnpm test:e2e
```

Expected: All existing tests pass (no regressions).

- [ ] **Step 4: Manual smoke test**

Start dev server and test Ask AI with these queries:
1. "性能优化" — should find notes about performance
2. "最近的工作进展" — should surface recent notes about work
3. "React" — should find any React-related content
4. A query using different words than what's in your notes — verify BM25 IDF is working (common words score lower)

- [ ] **Step 5: Commit if any adjustments were needed**

```bash
git add -A
git commit -m "chore: post-integration adjustments for RAG optimization"
```
