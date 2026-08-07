# App Rem Scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not create commits; the user will commit manually.

**Goal:** Add an application UI display-size setting while keeping source styles authored in design px and converting app chrome px to rem at build time.

**Architecture:** Store `rootFontSize` in the existing application setting store and apply it to `document.documentElement`. Add a local Vite/PostCSS plugin that converts app chrome `px` declarations to `rem` with `14px` as the baseline while excluding content, editor, widget, and measurement-sensitive areas. Ant Design number tokens are derived from the same root size because PostCSS cannot transform AntD runtime token numbers.

**Tech Stack:** Vue 3, Pinia, TypeScript strict mode, Less, Vite CSS PostCSS pipeline, Ant Design Vue 4, Vitest.

## Global Constraints

- Do not commit; the user will commit manually.
- No `any` types.
- All new functions, interfaces, and complex logic need comments.
- Default root font size is `14`.
- Allowed persisted root font size values are normalized to the range `12` to `18`.
- Source styles for application UI chrome stay authored in `px`.
- Build output converts eligible app chrome `px` to `rem` with `rootValue = 14`.
- Markdown content, Monaco/CodeMirror editing font size, Widget canvas data, PDF export, and browser-pixel measurement logic stay independent.
- `1px` borders, outlines, dividers, drag measurement, screenshots, and media/container query breakpoints remain `px`.

---

### Task 1: Root Font Size Store Behavior

**Files:**
- Modify: `test/stores/ui/setting.test.ts`
- Modify: `src/stores/ui/setting.ts`

**Interfaces:**
- Produces: `SettingState.rootFontSize: number`
- Produces: `useSettingStore().setRootFontSize(size: number): void`
- Produces: `useSettingStore().init(): void` applies the persisted root font size.

- [x] **Step 1: Write failing tests**

Add tests for invalid persisted values, `setRootFontSize(16)`, and restoring persisted `15px` during `init()`.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/stores/ui/setting.test.ts`

- [x] **Step 3: Implement store support**

Add `DEFAULT_ROOT_FONT_SIZE = 14`, `MIN_ROOT_FONT_SIZE = 12`, `MAX_ROOT_FONT_SIZE = 18`, `normalizeRootFontSize(value)`, `applyRootFontSize(size)`, persisted `rootFontSize`, `setRootFontSize(size)`, and `init()` restoration.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/stores/ui/setting.test.ts`

### Task 2: Build-Time Px To Rem Plugin

**Files:**
- Add: `test/build/px-to-rem.test.ts`
- Add: `build/pxToRem.ts`
- Modify: `vite.config.ts`

**Interfaces:**
- Produces: `createRemPlugin(options?: PxToRemOptions): CssPostcssPlugin`
- Consumes: Vite `css.postcss.plugins`

- [x] **Step 1: Write failing plugin tests**

Cover `14px -> 1rem`, `12px -> 0.8571rem`, `28px -> 2rem`, `1px` preservation, excluded paths, quoted strings, and `url(...)`.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/build/px-to-rem.test.ts`

- [x] **Step 3: Implement plugin**

Create `build/pxToRem.ts` with:

```typescript
export function createRemPlugin(options: PxToRemOptions = {}): CssPostcssPlugin {
  const resolvedOptions: Required<PxToRemOptions> = {
    rootValue: options.rootValue ?? 14,
    precision: options.precision ?? 4,
    minPixelValue: options.minPixelValue ?? 1,
    include: options.include ?? [/\/src\//u],
    exclude: options.exclude ?? [
      /\/src\/assets\/styles\/markdown\.less$/u,
      /\/src\/components\/BEditor\//u,
      /\/src\/components\/BMonaco\//u,
      /\/src\/components\/BSmart\//u,
      /\/src\/components\/BWidget\//u,
      /\/src\/views\/widget\//u
    ]
  };

  return {
    postcssPlugin: 'tibis-px-to-rem',
    Once(root, api): void {
      // Convert eligible declaration values from px to rem.
    }
  };
}
```

In `vite.config.ts`, add:

```typescript
css: {
  postcss: {
    plugins: [createRemPlugin()]
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/build/px-to-rem.test.ts`

### Task 3: Settings Entry and Px-Authored Chrome

**Files:**
- Modify: `test/components/app-rem-scaling-styles.test.ts`
- Modify: `src/views/settings/basic/index.vue`
- Modify: `src/views/settings/tools/memory/components/MemoryContent.vue`
- Delete: `src/assets/styles/app-size.less`
- Modify: `src/assets/styles/index.less`

**Interfaces:**
- Consumes: `useSettingStore().rootFontSize`
- Consumes: `useSettingStore().setRootFontSize(size: number): void`
- Consumes: `createRemPlugin()`

- [x] **Step 1: Write style/source tests**

Assert that `app-size.less` is absent, Vite imports `createRemPlugin`, key app chrome source remains px-authored, and migrated app chrome roots do not contain `--app-*` sizing tokens or `rem` units.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/components/app-rem-scaling-styles.test.ts`

- [x] **Step 3: Implement settings input and source cleanup**

Use `BInputNumber` for “界面大小” with `min=12`, `max=18`, `step=1`, `precision=0`, `defaultValue=14`, and `addonAfter=px`. Restore previously hand-authored `rem` and `--app-*` sizing references back to source `px`. Move JS inline style px that needs scaling into CSS classes so the PostCSS plugin can convert it.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/components/app-rem-scaling-styles.test.ts`

### Task 4: Ant Design Runtime Metrics

**Files:**
- Add: `test/theme/antd-token.test.ts`
- Modify: `src/theme/core/derive.ts`
- Modify: `src/hooks/useAntdTheme/index.ts`

**Interfaces:**
- Produces: `toAntdToken(tokens: ThemeTokens, rootFontSize?: number): AntdThemeConfig`
- Consumes: `settingStore.rootFontSize`

- [x] **Step 1: Write failing token tests**

Assert AntD font and control metrics scale from the `14px` design baseline for root sizes `12` and `16`.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/theme/antd-token.test.ts`

- [x] **Step 3: Implement AntD metric scaling**

Add `scaleMetric(value, rootFontSize)` and include `fontSize`, `controlHeight`, `controlHeightSM`, and `controlHeightLG` in global and relevant component tokens. Pass `settingStore.rootFontSize` from `useAntdTheme`.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/theme/antd-token.test.ts`

### Task 5: Final Verification

**Files:**
- Modify: `changelog/2026-08-07.md`
- Modify: `docs/superpowers/specs/2026-08-07-app-rem-scaling-design.md`

**Interfaces:**
- Consumes: all previous task deliverables.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm exec vitest run test/build/px-to-rem.test.ts test/components/app-rem-scaling-styles.test.ts test/stores/ui/setting.test.ts test/theme/antd-token.test.ts
```

- [ ] **Step 2: Run static verification**

Run:

```bash
pnpm lint
pnpm lint:style
pnpm exec tsc --noEmit
git diff --check
```

- [ ] **Step 3: Confirm no manual commit**

Run:

```bash
git status --short
```
