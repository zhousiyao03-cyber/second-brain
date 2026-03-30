## 2026-03-30

### Task / Goal

Show a broader app breakdown on `/focus` by increasing the `Top apps` list from four rows to ten.

### Key Changes

- Extracted top-app aggregation into a dedicated helper so the ranking limit is easier to tune and test.
- Increased the default `Top apps` limit from `4` to `10`.
- Added a regression test to verify the helper keeps the ten longest-running apps in descending order.

### Files Touched

- `src/components/focus/focus-top-apps.ts`
- `src/components/focus/focus-top-apps.test.mjs`
- `src/components/focus/focus-shared.tsx`
- `docs/changelog/2026-03-30-focus-top-apps-limit.md`

### Verification Commands And Results

- `node --test --experimental-strip-types src/components/focus/focus-top-apps.test.mjs src/components/focus/focus-display.test.mjs`
  - PASS, `4/4`
- `pnpm lint src/components/focus/focus-top-apps.ts src/components/focus/focus-top-apps.test.mjs src/components/focus/focus-shared.tsx src/components/focus/focus-page-client.tsx`
  - PASS

### Remaining Risks / Follow-up

- This only changes how many rows the card shows; it does not change how focus time is attributed to apps.
- If the right column starts to feel visually tall on smaller laptop screens, we may want to make the card scroll internally or adapt the row count by breakpoint.
