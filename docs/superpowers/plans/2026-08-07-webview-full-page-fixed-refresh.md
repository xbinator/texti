# WebView Full-Page Fixed Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure fixed and sticky elements that become visible or are created after scrolling to the second full-page screenshot slice are marked and excluded from middle slices.

**Architecture:** Keep the existing screenshot setup/style lifecycle and first-top/last-bottom overlay policy. Make the setup scan safely repeatable with stable element IDs, then rerun it after each slice restores positioned-element visibility and before the slice snapshot is read.

**Tech Stack:** TypeScript, Electron WebView, Vue 3, Vitest with jsdom, Canvas screenshot stitching.

## Global Constraints

- Do not use `any`; all new parameters and return values require explicit types.
- Keep the existing first-slice top and last-slice bottom overlay policy unchanged.
- Do not change viewport or selected-element screenshot behavior.
- Use `asyncTo` for newly introduced asynchronous application flows; this fix adds no new application flow.
- Add accurate comments for new functions and complex logic.
- Record the code change in `changelog/2026-08-07.md`.

---

### Task 1: Make positioned-element rescanning stable

**Files:**
- Modify: `test/views/webview/web-use-screenshot.test.ts`
- Modify: `src/views/webview/web/utils/screenshot.ts:937-982`

**Interfaces:**
- Consumes: `createFixedElementCaptureSetupScript(): string`
- Produces: An idempotent setup script that preserves an existing `data-tibis-full-page-overlay-id` and allocates a larger ID to newly discovered positioned elements.

- [ ] **Step 1: Write the failing stable-ID regression test**

Extend the screenshot utility imports:

```typescript
import {
  createElementCaptureRectScript,
  createFixedElementCaptureCleanupScript,
  createFixedElementCaptureSetupScript
} from '@/views/webview/web/utils/screenshot';
```

Add this test inside `describe('useScreenshot', ...)`:

```typescript
it('keeps positioned element ids stable when a later scan discovers an earlier DOM sibling', (): void => {
  document.body.innerHTML = `
    <div id="existing-fixed" style="position: fixed; top: 0; width: 100px; height: 40px;"></div>
  `;
  const existingElement = document.querySelector('#existing-fixed');
  if (!(existingElement instanceof HTMLElement)) {
    throw new Error('existing fixed element should exist');
  }

  Object.defineProperty(existingElement, 'getBoundingClientRect', {
    configurable: true,
    value: (): DOMRect => new DOMRect(0, 0, 100, 40)
  });
  new Script(createFixedElementCaptureSetupScript()).runInThisContext();

  const dynamicElement = document.createElement('div');
  dynamicElement.id = 'dynamic-fixed';
  dynamicElement.style.cssText = 'position: fixed; top: 0; width: 120px; height: 48px;';
  Object.defineProperty(dynamicElement, 'getBoundingClientRect', {
    configurable: true,
    value: (): DOMRect => new DOMRect(0, 0, 120, 48)
  });
  document.body.insertBefore(dynamicElement, existingElement);

  new Script(createFixedElementCaptureSetupScript()).runInThisContext();

  expect(existingElement.getAttribute('data-tibis-full-page-overlay-id')).toBe('1');
  expect(dynamicElement.getAttribute('data-tibis-full-page-overlay-id')).toBe('2');
  new Script(createFixedElementCaptureCleanupScript()).runInThisContext();
  document.body.innerHTML = '';
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run test/views/webview/web-use-screenshot.test.ts -t "keeps positioned element ids stable"
```

Expected: FAIL because the second scan resets `overlayIndex`, assigns the newly inserted first sibling ID `1`, and changes the existing element to ID `2`.

- [ ] **Step 3: Preserve IDs while allocating new markers**

Replace the local counter initialization and unconditional ID assignment in `createFixedElementCaptureSetupScript()` with:

```typescript
  const existingIndexes = elements
    .map((element) => Number.parseInt(element.getAttribute(overlayIdMarker) || '', 10))
    .filter((value) => Number.isFinite(value));
  let overlayIndex = existingIndexes.length ? Math.max(...existingIndexes) : 0;
```

Then assign an ID only when the positioned element does not already have one:

```typescript
    if (!element.hasAttribute(overlayIdMarker)) {
      overlayIndex += 1;
      element.setAttribute(overlayIdMarker, String(overlayIndex));
    }
```

Keep the existing fixed/sticky marker assignment and style-node creation unchanged.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm exec vitest run test/views/webview/web-use-screenshot.test.ts -t "keeps positioned element ids stable"
```

Expected: PASS with no warnings.

- [ ] **Step 5: Commit the stable rescan behavior**

```bash
git add test/views/webview/web-use-screenshot.test.ts src/views/webview/web/utils/screenshot.ts
git commit -m "fix(webview): 稳定全页截图定位层标记"
```

---

### Task 2: Refresh positioned elements for every screenshot slice

**Files:**
- Modify: `test/views/webview/web-use-screenshot.test.ts`
- Modify: `src/views/webview/web/hooks/useScreenshot.ts:666-687`

**Interfaces:**
- Consumes: The repeatable `createFixedElementCaptureSetupScript(): string` from Task 1.
- Produces: `captureFullPagePng(element: WebviewTag): Promise<ArrayBuffer>` that refreshes positioned-element markers after every slice scroll.

- [ ] **Step 1: Write the failing per-slice refresh test**

Add this test beside the existing full-page screenshot tests:

```typescript
it('refreshes positioned element markers after every full-page slice scroll', async (): Promise<void> => {
  const pngBytes = new Uint8Array([137, 80, 78, 71, 16]);
  const webviewElement = createScreenshotWebview(pngBytes);
  webviewElement.executeJavaScript = vi.fn().mockImplementation((script: string): Promise<unknown> => {
    if (script.includes('const contentHeight = Math.max(')) {
      return Promise.resolve({
        contentHeight: 180,
        viewportWidth: 200,
        viewportHeight: 100,
        maxScrollTop: 80,
        scrollTop: 0
      });
    }

    if (script.includes("return Array.from(document.querySelectorAll('[' + overlayIdMarker + ']'))")) {
      return Promise.resolve([]);
    }

    return Promise.resolve(null);
  });
  const screenshot = useScreenshot({
    webviewElementRef: ref<WebviewTag | null>(webviewElement),
    webviewState: ref({ title: 'Example', url: 'https://example.com' })
  });

  await screenshot.captureFullPageScreenshot();

  const setupCalls = vi
    .mocked(webviewElement.executeJavaScript)
    .mock.calls.filter(([script]) => String(script).includes('let overlayIndex'));
  expect(setupCalls).toHaveLength(3);
  expect(native.copyImageToClipboard).toHaveBeenCalledTimes(1);
});
```

The three expected setup calls are one lifecycle initialization plus one refresh for each of the two slices.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run test/views/webview/web-use-screenshot.test.ts -t "refreshes positioned element markers"
```

Expected: FAIL with `expected ... to have a length of 3 but got 1`.

- [ ] **Step 3: Refresh markers before reading each slice snapshot**

In `captureFullPagePng()`, immediately after `createFixedElementVisibilityScript(true)` and before `createVisiblePositionedElementSnapshotScript()`, add:

```typescript
      // 当前切片可能在滚动后显示或创建新的定位层，需要在读取快照前补充标记。
      // eslint-disable-next-line no-await-in-loop
      await element.executeJavaScript(createFixedElementCaptureSetupScript());
```

Do not change `buildFixedElementOverlayCaptures`; it must continue dropping middle-slice overlays.

- [ ] **Step 4: Update existing queued WebView script results**

In the three existing full-page tests that pass result arrays to `createScreenshotWebview`, insert one additional `null` immediately before each `[]` snapshot result. This accounts for the new per-slice setup execution while leaving the expected screenshot and mask behavior unchanged.

For the two-slice fast screenshot fixture, use this result sequence:

```typescript
[
  {
    contentHeight: 120,
    viewportWidth: 200,
    viewportHeight: 100,
    maxScrollTop: 20,
    scrollTop: 0
  },
  null,
  null,
  null,
  null,
  [],
  null,
  null,
  null,
  null,
  [],
  null,
  null
]
```

For each one-slice slow/default-mask fixture, use this result sequence:

```typescript
[
  {
    contentHeight: 100,
    viewportWidth: 200,
    viewportHeight: 100,
    maxScrollTop: 0,
    scrollTop: 0
  },
  null,
  null,
  null,
  null,
  [],
  null,
  null
]
```

Use the one-slice sequence for both the slow-mask and default-hosted-mask tests.

- [ ] **Step 5: Run the complete screenshot test file and verify GREEN**

Run:

```bash
pnpm exec vitest run test/views/webview/web-use-screenshot.test.ts
```

Expected: all tests in the file PASS with no warnings.

- [ ] **Step 6: Commit the per-slice refresh**

```bash
git add test/views/webview/web-use-screenshot.test.ts src/views/webview/web/hooks/useScreenshot.ts
git commit -m "fix(webview): 刷新长截图后续屏定位层"
```

---

### Task 3: Document and verify the full fix

**Files:**
- Create: `changelog/2026-08-07.md`
- Verify: `src/views/webview/web/hooks/useScreenshot.ts`
- Verify: `src/views/webview/web/utils/screenshot.ts`
- Verify: `test/views/webview/web-use-screenshot.test.ts`

**Interfaces:**
- Consumes: The completed stable scan and per-slice refresh behavior.
- Produces: A changelog record and repository-level verification evidence.

- [ ] **Step 1: Add the changelog entry**

Create `changelog/2026-08-07.md` with:

```markdown
# 2026-08-07

## Changed

- 修复 WebView 完整页面截图只在首屏扫描定位层，导致第二屏滚动后才显示或动态创建的 `fixed` / `sticky` 元素重复进入最终长图的问题。
```

- [ ] **Step 2: Run targeted tests**

```bash
pnpm exec vitest run test/views/webview/web-use-screenshot.test.ts test/views/webview/web-capture-mask.test.ts
```

Expected: both files PASS.

- [ ] **Step 3: Run non-mutating ESLint verification**

```bash
pnpm exec eslint src/views/webview/web/hooks/useScreenshot.ts src/views/webview/web/utils/screenshot.ts test/views/webview/web-use-screenshot.test.ts --ext .ts
```

Expected: exit code `0` with no errors.

- [ ] **Step 4: Run Stylelint verification**

```bash
pnpm exec stylelint 'src/**/*.{vue,less,css}'
```

Expected: exit code `0` with no errors.

- [ ] **Step 5: Run TypeScript verification**

```bash
pnpm exec tsc --noEmit
```

Expected: exit code `0` with no TypeScript diagnostics.

- [ ] **Step 6: Check the final diff**

```bash
git diff --check
git status --short
git diff -- src/views/webview/web/hooks/useScreenshot.ts src/views/webview/web/utils/screenshot.ts test/views/webview/web-use-screenshot.test.ts changelog/2026-08-07.md
```

Expected: no whitespace errors and only the approved screenshot fix, tests, and changelog remain uncommitted.

- [ ] **Step 7: Commit the changelog**

```bash
git add changelog/2026-08-07.md
git commit -m "docs: 记录 WebView 长截图定位层修复"
```
