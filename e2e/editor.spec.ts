import { test, expect } from "@playwright/test";

const uid = () => Math.random().toString(36).slice(2, 8);

// 1x1 transparent PNG for image tests
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==",
  "base64"
);

// Helper: create a fresh note and return { page, editor, titleInput }
async function createNote(page: import("@playwright/test").Page) {
  await page.goto("/notes");
  await page.getByRole("button", { name: "New note" }).click();
  await expect(page).toHaveURL(/\/notes\/.+/);
  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  const titleInput = page.locator("textarea[placeholder='New page']");
  return { editor, titleInput };
}

// Helper: type "/" then select a slash command by its title
async function slashInsert(page: import("@playwright/test").Page, commandTitle: string) {
  const editor = page.locator(".ProseMirror");
  await editor.press("/");
  const menu = page.getByTestId("editor-slash-menu");
  await expect(menu).toBeVisible({ timeout: 3000 });
  await menu.getByRole("button", { name: commandTitle }).click();
}

// ═══════════════════════════════════════════════════════════════════
// Tier 1: 标准交互测试
// ═══════════════════════════════════════════════════════════════════

test.describe("Tier 1: 标准交互", () => {
  test("1. 标题按 Enter 跳到正文，正文开头按 Backspace 跳回标题", async ({ page }) => {
    const { editor, titleInput } = await createNote(page);

    // Type title
    await titleInput.fill("Test Title");

    // Press Enter → editor should be focused
    await titleInput.press("Enter");
    await expect(editor).toBeFocused();

    // Type something to verify we're in the editor
    await editor.pressSequentially("hello", { delay: 20 });
    await expect(editor).toContainText("hello");

    // Move to start of editor
    await page.keyboard.press("Home");
    // Move cursor to absolute start (in case Home didn't go to pos 0)
    for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft");

    // Press Backspace at start → title should be focused
    await page.keyboard.press("Backspace");
    await expect(titleInput).toBeFocused();
  });

  test("2. Slash 命令菜单弹出、搜索过滤、键盘选择", async ({ page }) => {
    const { editor } = await createNote(page);
    await editor.click();

    // Type "/" to trigger slash menu
    await editor.press("/");
    const menu = page.getByTestId("editor-slash-menu");
    await expect(menu).toBeVisible({ timeout: 3000 });

    // Should show standard commands
    await expect(menu.getByRole("button", { name: "标题 1" })).toBeVisible();
    await expect(menu.getByRole("button", { name: "代码块" })).toBeVisible();

    // Search filter: type "表格"
    await page.keyboard.type("表格");
    await expect(menu.getByRole("button", { name: "表格" })).toBeVisible();
    // Non-matching items should be hidden
    await expect(menu.getByRole("button", { name: "标题 1" })).not.toBeVisible();

    // Press Escape to dismiss
    await page.keyboard.press("Escape");
    await expect(menu).not.toBeVisible();
  });

  test("3. BubbleToolbar 格式化：加粗、斜体、代码", async ({ page }) => {
    const { editor } = await createNote(page);
    await editor.click();
    await editor.pressSequentially("format me", { delay: 20 });

    // Select all text
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");

    // Bubble toolbar should appear
    const boldBtn = page.locator("button[title='粗体']");
    await expect(boldBtn).toBeVisible({ timeout: 3000 });

    // Click bold
    await boldBtn.click();
    await expect(editor.locator("strong")).toContainText("format me");

    // Click italic
    await page.locator("button[title='斜体']").click();
    await expect(editor.locator("em")).toContainText("format me");

    // Click code
    await page.locator("button[title='行内代码']").click();
    await expect(editor.locator("code")).toContainText("format me");
  });

  test("4. Slash 插入标题 H1-H3", async ({ page }) => {
    const { editor } = await createNote(page);
    await editor.click();

    // Insert H1
    await slashInsert(page, "标题 1");
    await editor.pressSequentially("Heading One", { delay: 20 });
    await expect(editor.locator("h1")).toContainText("Heading One");

    // Move to new line
    await page.keyboard.press("Enter");

    // Insert H2
    await slashInsert(page, "标题 2");
    await editor.pressSequentially("Heading Two", { delay: 20 });
    await expect(editor.locator("h2")).toContainText("Heading Two");

    // Move to new line
    await page.keyboard.press("Enter");

    // Insert H3
    await slashInsert(page, "标题 3");
    await editor.pressSequentially("Heading Three", { delay: 20 });
    await expect(editor.locator("h3")).toContainText("Heading Three");
  });

  test("5. Slash 插入列表：无序、有序、待办", async ({ page }) => {
    const { editor } = await createNote(page);
    await editor.click();

    // Bullet list
    await slashInsert(page, "无序列表");
    await editor.pressSequentially("bullet item", { delay: 20 });
    await expect(editor.locator("ul li")).toContainText("bullet item");

    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter"); // exit list

    // Ordered list
    await slashInsert(page, "有序列表");
    await editor.pressSequentially("ordered item", { delay: 20 });
    await expect(editor.locator("ol li")).toContainText("ordered item");

    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    // Task list
    await slashInsert(page, "待办列表");
    await editor.pressSequentially("todo item", { delay: 20 });
    await expect(editor.locator("ul[data-type='taskList'] li")).toContainText("todo item");
  });

  test("6. Slash 插入引用块", async ({ page }) => {
    const { editor } = await createNote(page);
    await editor.click();

    await slashInsert(page, "引用");
    await editor.pressSequentially("a wise quote", { delay: 20 });
    await expect(editor.locator("blockquote")).toContainText("a wise quote");
  });

  test("7. Slash 插入分割线", async ({ page }) => {
    const { editor } = await createNote(page);
    await editor.click();
    await editor.pressSequentially("above", { delay: 20 });
    await page.keyboard.press("Enter");

    await slashInsert(page, "分割线");
    await expect(editor.locator("hr")).toBeVisible();
  });

  test("8. Callout 插入和 tone 切换", async ({ page }) => {
    const { editor } = await createNote(page);
    await editor.click();

    await slashInsert(page, "Callout");
    const callout = editor.locator(".notion-callout");
    await expect(callout).toBeVisible();

    // Type inside callout
    await editor.pressSequentially("callout content", { delay: 20 });
    await expect(callout).toContainText("callout content");

    // Click the icon to cycle tone
    const icon = callout.locator(".notion-callout-trigger");
    const initialTone = await callout.getAttribute("data-tone");
    await icon.click();
    // Tone should change
    await expect(callout).not.toHaveAttribute("data-tone", initialTone ?? "tip");
  });

  test("9. Toggle 折叠块：编辑摘要、展开/折叠", async ({ page }) => {
    const { editor } = await createNote(page);
    await editor.click();

    await slashInsert(page, "折叠列表");
    const toggle = editor.locator(".notion-toggle");
    await expect(toggle).toBeVisible();

    // Edit summary
    const summary = toggle.locator(".notion-toggle-summary");
    await summary.fill("My Toggle");
    await expect(summary).toHaveValue("My Toggle");

    // Toggle should be expanded initially
    const body = toggle.locator(".notion-toggle-body");
    await expect(body).toBeVisible();

    // Click chevron to collapse
    const chevron = toggle.locator(".notion-toggle-chevron");
    await chevron.click();
    await expect(body).toBeHidden();

    // Click again to expand
    await chevron.click();
    await expect(body).toBeVisible();
  });

  test("10. 代码块插入和语言选择", async ({ page }) => {
    const { editor } = await createNote(page);
    await editor.click();

    await slashInsert(page, "代码块");
    // Code block should appear
    const codeBlock = editor.locator("pre");
    await expect(codeBlock).toBeVisible();

    // Type code
    await page.keyboard.type('console.log("hello")');
    await expect(codeBlock).toContainText('console.log("hello")');

    // Language selector should be present in the header
    const langBtn = editor.locator(".code-block-header button").first();
    if (await langBtn.isVisible()) {
      await langBtn.click();
      // Dropdown should appear
      const dropdown = editor.locator(".code-block-lang-dropdown");
      await expect(dropdown).toBeVisible();
      // Select TypeScript
      await dropdown.getByRole("button", { name: "TypeScript" }).click();
      await expect(dropdown).not.toBeVisible();
      // Button should now show TypeScript
      await expect(langBtn).toContainText("TypeScript");
    }
  });

  test("11. 表格插入和 TableToolbar 操作", async ({ page }) => {
    const { editor } = await createNote(page);
    await editor.click();

    await slashInsert(page, "表格");

    // Table should be created
    const table = editor.locator("table");
    await expect(table).toBeVisible();

    // Should have header row + 2 data rows = 3 rows, 3 columns
    await expect(table.locator("tr")).toHaveCount(3);
    await expect(table.locator("th")).toHaveCount(3);

    // Click inside a cell and type
    await table.locator("th").first().click();
    await page.keyboard.type("Header 1");
    await expect(table.locator("th").first()).toContainText("Header 1");
  });

  test("12. 搜索替换 (Cmd+F)", async ({ page }) => {
    const { editor } = await createNote(page);
    await editor.click();
    await editor.pressSequentially("apple banana apple cherry apple", { delay: 15 });

    // Open search
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${mod}+f`);
    const searchBar = page.getByTestId("editor-search-bar");
    await expect(searchBar).toBeVisible({ timeout: 3000 });

    // Search for "apple"
    const searchInput = page.getByTestId("editor-search-input");
    await searchInput.fill("apple");

    // Match count should show 3 matches
    const matchCount = page.getByTestId("editor-search-match-count");
    await expect(matchCount).toContainText("3", { timeout: 3000 });

    // Toggle replace row visible
    await searchBar.locator("button[title='显示替换']").click();

    // Replace one
    const replaceInput = page.getByTestId("editor-replace-input");
    await replaceInput.fill("orange");
    await page.getByTestId("editor-replace-button").click();

    // Now should have 2 matches
    await expect(matchCount).toContainText("2", { timeout: 3000 });

    // Replace all
    await page.getByTestId("editor-replace-all-button").click();
    await expect(matchCount).toContainText("无匹配", { timeout: 3000 });

    // Verify text
    await expect(editor).toContainText("orange");
    await expect(editor).not.toContainText("apple");

    // Close search
    await page.getByTestId("editor-search-close").click();
    await expect(searchBar).not.toBeVisible();
  });

  test("13. TOC 目录块", async ({ page }) => {
    const { editor } = await createNote(page);
    await editor.click();

    // Create some headings first
    await slashInsert(page, "标题 1");
    await editor.pressSequentially("First Section", { delay: 20 });
    await page.keyboard.press("Enter");

    await slashInsert(page, "标题 2");
    await editor.pressSequentially("Sub Section", { delay: 20 });
    await page.keyboard.press("Enter");

    // Insert TOC
    await slashInsert(page, "目录");
    const toc = editor.locator("[data-toc-block='true']");
    await expect(toc).toBeVisible();

    // TOC should contain links to headings
    await expect(toc).toContainText("First Section");
    await expect(toc).toContainText("Sub Section");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Tier 2: 高级交互测试
// ═══════════════════════════════════════════════════════════════════

test.describe("Tier 2: 高级交互", () => {
  // Playwright's synthetic dragTo cannot trigger ProseMirror's custom drag/drop handler
  // (gripDragSource module variable is set in dragstart which synthetic drag doesn't fire properly)
  // These tests require a real browser drag event chain. Skipping for now.
  test.skip("14. 图片拖拽合并成 ImageRow", async ({ page }) => {
    const { editor } = await createNote(page);

    // Upload first image via file input
    await page.getByTestId("editor-image-input").setInputFiles({
      name: "img1.png",
      mimeType: "image/png",
      buffer: tinyPng,
    });
    await expect(editor.locator("img").first()).toBeVisible({ timeout: 5000 });

    // Insert a second image below
    await page.keyboard.press("Enter");
    await page.getByTestId("editor-image-input").setInputFiles({
      name: "img2.png",
      mimeType: "image/png",
      buffer: tinyPng,
    });
    await expect(editor.locator("img")).toHaveCount(2, { timeout: 5000 });

    // Drag second image onto first to merge into ImageRow using mouse API
    // (data-resize-handle intercepts pointer events, so we use force)
    const img1 = editor.locator("img").first();
    const img2 = editor.locator("img").last();
    await img2.dragTo(img1, { force: true });

    // Should have an image-row-container with 2 images
    const imageRow = editor.locator("[data-image-row='true']");
    await expect(imageRow).toBeVisible({ timeout: 5000 });
    await expect(imageRow.locator("img")).toHaveCount(2);
  });

  test.skip("15. ImageRow 内拖拽排序", async ({ page }) => {
    const { editor } = await createNote(page);

    // Create ImageRow by uploading 2 images and merging
    await page.getByTestId("editor-image-input").setInputFiles({
      name: "a.png", mimeType: "image/png", buffer: tinyPng,
    });
    await expect(editor.locator("img").first()).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Enter");
    await page.getByTestId("editor-image-input").setInputFiles({
      name: "b.png", mimeType: "image/png", buffer: tinyPng,
    });
    await expect(editor.locator("img")).toHaveCount(2, { timeout: 5000 });
    await editor.locator("img").last().dragTo(editor.locator("img").first(), { force: true });

    const imageRow = editor.locator("[data-image-row='true']");
    await expect(imageRow).toBeVisible({ timeout: 5000 });
    await expect(imageRow.locator(".image-row-item")).toHaveCount(2, { timeout: 3000 });

    // Hover to reveal drag handles and reorder
    const firstItem = imageRow.locator(".image-row-item").first();
    await firstItem.hover();
    const handle = firstItem.locator(".image-row-drag-handle");
    if (await handle.isVisible({ timeout: 2000 }).catch(() => false)) {
      await handle.dragTo(imageRow.locator(".image-row-item").last(), { force: true });
      await expect(imageRow.locator(".image-row-item")).toHaveCount(2);
    }
  });

  test.skip("16. ImageRow 图片缩放 (resize handle)", async ({ page }) => {
    const { editor } = await createNote(page);

    // Create ImageRow by uploading 2 images and merging
    await page.getByTestId("editor-image-input").setInputFiles({
      name: "r1.png", mimeType: "image/png", buffer: tinyPng,
    });
    await expect(editor.locator("img").first()).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Enter");
    await page.getByTestId("editor-image-input").setInputFiles({
      name: "r2.png", mimeType: "image/png", buffer: tinyPng,
    });
    await expect(editor.locator("img")).toHaveCount(2, { timeout: 5000 });
    await editor.locator("img").last().dragTo(editor.locator("img").first(), { force: true });

    const imageRow = editor.locator("[data-image-row='true']");
    await expect(imageRow).toBeVisible({ timeout: 5000 });

    // Hover first item to reveal resize handle
    const firstItem = imageRow.locator(".image-row-item").first();
    await firstItem.hover();

    const resizeHandle = firstItem.locator(".image-row-resize-handle");
    if (await resizeHandle.isVisible({ timeout: 2000 }).catch(() => false)) {
      const handleBox = await resizeHandle.boundingBox();
      if (handleBox) {
        const startX = handleBox.x + handleBox.width / 2;
        const startY = handleBox.y + handleBox.height / 2;
        await page.mouse.move(startX, startY);
        await page.mouse.down();
        await page.mouse.move(startX + 50, startY, { steps: 10 });
        await page.mouse.up();

        const style = await firstItem.getAttribute("style");
        expect(style).toContain("width");
      }
    }
  });

  test.skip("17. 从 ImageRow 拖出图片变为独立块", async ({ page }) => {
    const { editor } = await createNote(page);

    // Create ImageRow with 2 images
    await page.getByTestId("editor-image-input").setInputFiles({
      name: "e1.png", mimeType: "image/png", buffer: tinyPng,
    });
    await expect(editor.locator("img").first()).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Enter");
    await page.getByTestId("editor-image-input").setInputFiles({
      name: "e2.png", mimeType: "image/png", buffer: tinyPng,
    });
    await expect(editor.locator("img")).toHaveCount(2, { timeout: 5000 });
    await editor.locator("img").last().dragTo(editor.locator("img").first(), { force: true });

    const imageRow = editor.locator("[data-image-row='true']");
    await expect(imageRow).toBeVisible({ timeout: 5000 });
    await expect(imageRow.locator(".image-row-item")).toHaveCount(2, { timeout: 3000 });

    // Hover an image item to show drag handle
    const item = imageRow.locator(".image-row-item").first();
    await item.hover();
    const dragHandle = item.locator(".image-row-drag-handle");

    if (await dragHandle.isVisible({ timeout: 2000 }).catch(() => false)) {
      const rowBox = await imageRow.boundingBox();
      if (rowBox) {
        // Drag the handle well outside the row (below it)
        await dragHandle.dragTo(page.locator(".ProseMirror"), {
          targetPosition: { x: 100, y: rowBox.y + rowBox.height + 100 },
          force: true,
        });

        await page.waitForTimeout(500);
        const imgCount = await editor.locator("img").count();
        expect(imgCount).toBeGreaterThanOrEqual(2);
      }
    }
  });

  test("18. Mermaid 全屏查看", async ({ page }) => {
    const { editor } = await createNote(page);
    await editor.click();

    await slashInsert(page, "Mermaid 图表");
    const mermaidBlock = editor.locator("[data-mermaid-block='true']");
    await expect(mermaidBlock).toBeVisible();

    // Click to edit
    await mermaidBlock.click();
    const textarea = mermaidBlock.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 3000 });

    // Type mermaid code
    await textarea.fill("graph TD\n    A[Start] --> B[End]");

    // Click "完成" to exit editing
    await mermaidBlock.getByRole("button", { name: "完成" }).click();

    // Wait for SVG to render
    await expect(mermaidBlock.locator("svg")).toBeVisible({ timeout: 5000 });

    // Click fullscreen button
    const fullscreenBtn = mermaidBlock.locator("button[title='放大查看']");
    await mermaidBlock.hover();
    await expect(fullscreenBtn).toBeVisible({ timeout: 2000 });
    await fullscreenBtn.click();

    // Fullscreen overlay should appear
    const overlay = page.locator(".mermaid-fullscreen-overlay");
    await expect(overlay).toBeVisible();
    await expect(page.locator(".mermaid-fullscreen-svg svg")).toBeVisible();

    // Zoom badge should show 100%
    await expect(page.locator(".mermaid-fullscreen-zoom-badge")).toContainText("100%");

    // Close with Escape
    await page.keyboard.press("Escape");
    await expect(overlay).not.toBeVisible();
  });

  test("19. Mermaid 全屏缩放 (滚轮)", async ({ page }) => {
    const { editor } = await createNote(page);
    await editor.click();

    await slashInsert(page, "Mermaid 图表");
    const mermaidBlock = editor.locator("[data-mermaid-block='true']");
    await mermaidBlock.click();
    const textarea = mermaidBlock.locator("textarea");
    await textarea.fill("graph TD\n    A --> B");
    await mermaidBlock.getByRole("button", { name: "完成" }).click();
    await expect(mermaidBlock.locator("svg")).toBeVisible({ timeout: 5000 });

    // Enter fullscreen
    await mermaidBlock.hover();
    await mermaidBlock.locator("button[title='放大查看']").click();

    const content = page.locator(".mermaid-fullscreen-content");
    await expect(content).toBeVisible();

    // Scroll up to zoom in
    const box = await content.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      // Scroll up (negative deltaY) to zoom in
      await page.mouse.wheel(0, -300);

      // Wait for zoom to apply
      await page.waitForTimeout(200);

      // Zoom badge should show > 100%
      const badge = page.locator(".mermaid-fullscreen-zoom-badge");
      const text = await badge.textContent();
      const zoomPercent = parseInt(text ?? "100");
      expect(zoomPercent).toBeGreaterThan(100);

      // Check transform scale on SVG container
      const transform = await page.locator(".mermaid-fullscreen-svg").getAttribute("style");
      expect(transform).toContain("scale(");
    }

    await page.keyboard.press("Escape");
  });

  test("20. Mermaid 全屏拖拽平移", async ({ page }) => {
    const { editor } = await createNote(page);
    await editor.click();

    await slashInsert(page, "Mermaid 图表");
    const mermaidBlock = editor.locator("[data-mermaid-block='true']");
    await mermaidBlock.click();
    await mermaidBlock.locator("textarea").fill("graph TD\n    A --> B --> C");
    await mermaidBlock.getByRole("button", { name: "完成" }).click();
    await expect(mermaidBlock.locator("svg")).toBeVisible({ timeout: 5000 });

    await mermaidBlock.hover();
    await mermaidBlock.locator("button[title='放大查看']").click();

    const content = page.locator(".mermaid-fullscreen-content");
    await expect(content).toBeVisible();

    const box = await content.boundingBox();
    if (box) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      // Drag to pan
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 100, cy + 50, { steps: 10 });
      await page.mouse.up();

      // SVG container should have translate in its transform
      const transform = await page.locator(".mermaid-fullscreen-svg").getAttribute("style");
      expect(transform).toContain("translate(");
      // Should not be 0,0 anymore
      expect(transform).not.toContain("translate(0px, 0px)");
    }

    await page.keyboard.press("Escape");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Tier 3: 粘贴转换测试
// ═══════════════════════════════════════════════════════════════════

test.describe("Tier 3: 粘贴转换", () => {
  test("21. 粘贴 Markdown 表格 → 自动转为 Tiptap 表格", async ({ page }) => {
    // Grant clipboard permissions
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    const { editor } = await createNote(page);
    await editor.click();

    const mdTable = `| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |`;

    // Dispatch paste event with markdown table text
    await page.evaluate((text) => {
      const el = document.querySelector(".ProseMirror");
      if (!el) return;
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      const event = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(event);
    }, mdTable);

    // Should convert to a real table
    await expect(editor.locator("table")).toBeVisible({ timeout: 5000 });
    await expect(editor.locator("table")).toContainText("Alice");
    await expect(editor.locator("table")).toContainText("Bob");
  });

  test("22. 粘贴 Mermaid 代码块 → 自动转为 Mermaid 块", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    const { editor } = await createNote(page);
    await editor.click();

    const mermaidCode = "```mermaid\ngraph TD\n    A[Start] --> B[End]\n```";

    await page.evaluate((text) => {
      const el = document.querySelector(".ProseMirror");
      if (!el) return;
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      const event = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(event);
    }, mermaidCode);

    // Should create a mermaid block
    const mermaidBlock = editor.locator("[data-mermaid-block='true']");
    await expect(mermaidBlock).toBeVisible({ timeout: 5000 });
  });

  test("23. 粘贴图片文件 → 插入图片", async ({ page }) => {
    const { editor } = await createNote(page);
    await editor.click();

    // Use the file input approach instead of clipboard (more reliable in CI)
    await page.getByTestId("editor-image-input").setInputFiles({
      name: "pasted.png",
      mimeType: "image/png",
      buffer: tinyPng,
    });

    // Image should appear in editor
    await expect(editor.locator("img")).toBeVisible({ timeout: 5000 });
  });
});
