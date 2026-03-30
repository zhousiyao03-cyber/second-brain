## 2026-03-30

### Task / Goal

Make non-work filtering on `/focus` more transparent: exclude WeChat/Weixin/WhatsApp from `Working Hours`, show the excluded time in its own card, and remove the low-value raw activity drilldown.

### Key Changes

- Extended non-work tagging so these activities fall into the existing non-work bucket:
  - `WeChat`
  - `Weixin`
  - `WhatsApp`
  - `web.whatsapp.com`
  - `weixin.qq.com` / `wx.qq.com`
- Added server-side non-work aggregation to daily focus stats:
  - `filteredOutSecs`
  - `nonWorkBreakdown`
- Updated `/focus` UI:
  - removed the `Raw activity` section from the main view
  - added a `Filtered out` card showing excluded time and per-reason bars
  - restored a stable `focus-session-count` test id for the focus-block count pill
- Tightened the Focus e2e coverage so it now checks the new page structure directly:
  - `Filtered out` is visible
  - `Raw activity` is absent

### Files Touched

- `src/server/focus/tags.ts`
- `src/server/focus/tags.js`
- `src/server/focus/tags.test.mjs`
- `src/server/focus/aggregates.ts`
- `src/server/focus/aggregates.test.mjs`
- `src/server/routers/focus.ts`
- `src/components/focus/focus-page-client.tsx`
- `e2e/focus-tracker.spec.ts`
- `README.md`
- `docs/changelog/2026-03-30-focus-non-work-filtering-ui.md`

### Verification Commands And Results

- `node --test --experimental-strip-types src/server/focus/tags.test.mjs src/server/focus/aggregates.test.mjs src/components/focus/focus-top-apps.test.mjs src/components/focus/focus-display.test.mjs`
  - PASS, `43/43`
- `pnpm lint src/server/focus/tags.ts src/server/focus/aggregates.ts src/server/routers/focus.ts src/components/focus/focus-page-client.tsx src/components/focus/focus-shared.tsx src/components/focus/focus-top-apps.ts src/components/focus/focus-top-apps.test.mjs`
  - PASS
- `pnpm test:e2e e2e/focus-tracker.spec.ts`
  - PASS, `1/1`

### Remaining Risks / Follow-up

- `WeChat / Weixin / WhatsApp` are intentionally mapped into the existing `social-media` non-work bucket rather than a dedicated messaging class, so work-related chats in those apps will still be excluded from `Working Hours`.
- The page no longer exposes raw sessions in the main UI. If you later want a debugging path, it may be better as a separate developer view instead of returning it to the default page.
