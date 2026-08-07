# WebView Full-Page Scrollbar Hiding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the root page scrollbar and every internal scroll container scrollbar while a WebView full-page screenshot is running, then restore them on cleanup.

**Architecture:** Extend the existing full-page capture setup and cleanup scripts with a dedicated, idempotent scrollbar style node. Keep scrollbar rules separate from the fixed/sticky visibility style so per-slice positioning updates cannot overwrite them.

**Tech Stack:** TypeScript, Electron WebView, Chromium scrollbar CSS, Vitest with jsdom.

## Global Constraints

- Do not change `overflow`, scroll positions, or scroll dimensions.
- Do not change viewport or selected-element screenshot behavior.
- Keep the existing first-slice top and last-slice bottom positioned-overlay policy unchanged.
- Do not use `any`; all new TypeScript parameters and return values require explicit types.
- Do not run `git add`, `git commit`, or otherwise submit the changes.
- Update `changelog/2026-08-07.md` and leave all changes uncommitted.

---

### Task 1: Add temporary global scrollbar hiding

**Files:**
- Modify: `test/views/webview/web-use-screenshot.test.ts`
- Modify: `src/views/webview/web/utils/screenshot.ts:924-1112`
- Modify: `changelog/2026-08-07.md`

**Interfaces:**
- Consumes: `createFixedElementCaptureSetupScript(): string` and `createFixedElementCaptureCleanupScript(): string`.
- Produces: Idempotent setup that creates `#__tibis_full_page_capture_scrollbar_style__` and cleanup that removes it.

- [ ] **Step 1: Write the failing scrollbar lifecycle test**

Add this test beside the existing stable positioned-element ID test:

```typescript
it('hides every scrollbar during full-page capture and restores them on cleanup', (): void => {
  new Script(createFixedElementCaptureSetupScript()).runInThisContext();
  new Script(createFixedElementCaptureSetupScript()).runInThisContext();

  const scrollbarStyles = document.querySelectorAll('#__tibis_full_page_capture_scrollbar_style__');
  const scrollbarStyle = scrollbarStyles.item(0);
  expect(scrollbarStyles).toHaveLength(1);
  expect(scrollbarStyle?.textContent).toContain('html, body, * { scrollbar-width: none !important; }');
  expect(scrollbarStyle?.textContent).toContain('html::-webkit-scrollbar');
  expect(scrollbarStyle?.textContent).toContain('body::-webkit-scrollbar');
  expect(scrollbarStyle?.textContent).toContain('*::-webkit-scrollbar');

  new Script(createFixedElementCaptureCleanupScript()).runInThisContext();

  expect(document.querySelector('#__tibis_full_page_capture_scrollbar_style__')).toBeNull();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
node node_modules/vitest/vitest.mjs run test/views/webview/web-use-screenshot.test.ts -t "hides every scrollbar" --pool=threads --maxWorkers=1
```

Expected: FAIL because the scrollbar style node does not exist.

- [ ] **Step 3: Add an idempotent scrollbar style node**

Add a constant beside `FULL_PAGE_CAPTURE_STYLE_ID`:

```typescript
/** 用于在 full-page 截图期间隐藏所有滚动条的样式节点 ID。 */
const FULL_PAGE_CAPTURE_SCROLLBAR_STYLE_ID = '__tibis_full_page_capture_scrollbar_style__';
```

In `createFixedElementCaptureSetupScript()`, inject the constant and create the separate style node after the positioned-element style node:

```typescript
  const scrollbarStyleId = ${JSON.stringify(FULL_PAGE_CAPTURE_SCROLLBAR_STYLE_ID)};
```

```typescript
  if (!document.getElementById(scrollbarStyleId)) {
    const scrollbarStyle = document.createElement('style');
    scrollbarStyle.id = scrollbarStyleId;
    scrollbarStyle.textContent = [
      'html, body, * { scrollbar-width: none !important; }',
      'html::-webkit-scrollbar, body::-webkit-scrollbar, *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }'
    ].join('\n');
    document.documentElement.appendChild(scrollbarStyle);
  }
```

Do not add the scrollbar rules to `FULL_PAGE_CAPTURE_STYLE_ID`, because `createFixedElementVisibilityScript()` replaces that node's `textContent` for every screenshot slice.

- [ ] **Step 4: Remove the scrollbar style during cleanup**

In `createFixedElementCaptureCleanupScript()`, inject the style ID and remove the node with the existing positioned-element style:

```typescript
  const scrollbarStyleId = ${JSON.stringify(FULL_PAGE_CAPTURE_SCROLLBAR_STYLE_ID)};
```

```typescript
  document.getElementById(styleId)?.remove();
  document.getElementById(scrollbarStyleId)?.remove();
```

- [ ] **Step 5: Run the focused test and verify GREEN**

```bash
node node_modules/vitest/vitest.mjs run test/views/webview/web-use-screenshot.test.ts -t "hides every scrollbar" --pool=threads --maxWorkers=1
```

Expected: PASS with no warnings.

- [ ] **Step 6: Update the changelog**

Append this bullet under `## Changed` in `changelog/2026-08-07.md`:

```markdown
- WebView 完整页面截图期间隐藏页面根滚动条和所有内部滚动容器滚动条，并在截图结束或失败后恢复。
```

- [ ] **Step 7: Run complete verification**

```bash
node node_modules/vitest/vitest.mjs run test/views/webview/web-use-screenshot.test.ts test/views/webview/web-capture-mask.test.ts --pool=threads --maxWorkers=1
node node_modules/eslint/bin/eslint.js src/views/webview/web/utils/screenshot.ts test/views/webview/web-use-screenshot.test.ts --ext .ts
node node_modules/stylelint/bin/stylelint.mjs 'src/**/*.{vue,less,css}'
node node_modules/typescript/bin/tsc --noEmit
git diff --check
git status --short
```

Expected: 2 Vitest files pass, ESLint/Stylelint/TypeScript exit with code `0`, `git diff --check` prints nothing, and the approved spec/plan/code/test/changelog files remain uncommitted.
