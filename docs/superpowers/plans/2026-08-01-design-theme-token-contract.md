# Design Theme Token Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the theme system from color-only tokens to a design token contract and add Overworld as the first strong-personality preset.

**Architecture:** Extend `ThemeTokens` with shape, border, font, motion, and semantic component tokens. Keep existing color consumers intact while adding CSS variable output, Ant Design mapping, validation, and a small first batch of component token consumption.

**Tech Stack:** Vue 3, TypeScript, Less, Ant Design Vue, Vitest, Pinia theme store.

## Global Constraints

- Do not commit; the user will commit manually.
- Do not introduce `any`; use explicit types and `unknown` where needed.
- Use TDD: write failing tests before production code.
- Keep existing theme preset behavior stable for `default`, `graphite`, `shonen`, and `manga-ink`.
- Keep Overworld generic through the token contract, not a one-off button style.
- Preserve existing file comments and add JSDoc for new exported types/functions.

---

## File Map

- Modify `src/theme/types/tokens.ts`: extend `ThemeTokens` with non-color token groups.
- Modify `src/theme/core/factory.ts`: add default design tokens, deep token overrides, and `ThemeTokenOverrides`.
- Modify `src/theme/core/derive.ts`: map design tokens to CSS variables and Ant Design token fields.
- Modify `src/theme/core/apply.ts`: validate color and non-color token formats by key category.
- Create `src/theme/presets/overworld.ts`: define light/dark Overworld palettes and design overrides.
- Modify `src/theme/index.ts`: import Overworld and export override type.
- Modify `src/components/BButton/index.vue`: consume `--control-radius`, `--radius-full`, and motion tokens.
- Modify `src/components/BDropdown/index.vue`, `src/components/BDropdown/Menu.vue`, `src/components/BDropdown/Button.vue`: consume control/overlay radius and motion tokens.
- Modify `src/components/BModal/index.vue`: default modal radius from `--overlay-radius`.
- Modify `src/components/BDrawer/index.vue`: internal control radius from `--control-radius`.
- Modify `src/components/BSelect/index.vue`: tips radius from `--control-radius`.
- Modify `test/theme/preset-list.test.ts`: assert Overworld registration and token output.
- Create `test/theme/design-token-derive.test.ts`: assert Ant Design design token mapping and validation handling.
- Modify or create focused component style tests for migrated component CSS.
- Modify `changelog/2026-08-01.md`: record the theme contract and Overworld preset change.

---

### Task 1: Theme Contract Tests

**Files:**
- Modify: `test/theme/preset-list.test.ts`
- Create: `test/theme/design-token-derive.test.ts`
- Modify: existing component style tests if present

**Interfaces:**
- Consumes: `getPresetList`, `getResolvedTokens`, `toCssVars`, `toAntdToken`, `validateTokens`
- Produces: failing expectations for design token groups and Overworld registration

- [x] **Step 1: Add failing Overworld tests**

Add assertions that `overworld` exists and exposes design tokens:

```typescript
expect(presets).toContainEqual({ id: 'overworld', label: '复古冒险「Overworld」' });
expect(lightTokens.color.primary).toBe('#2e5dd6');
expect(lightTokens.text.primary).toBe('#161310');
expect(lightTokens.control.radius).toBe('0px');
expect(lightTokens.control.borderWidth).toBe('2px');
expect(lightTokens.interaction.pressOffset).toBe('2px');
expect(lightCssVars['--control-radius']).toBe('0px');
expect(lightCssVars['--font-display']).toContain('Pixelify Sans');
expect(lightCssVars['--interaction-press-offset']).toBe('2px');
```

- [x] **Step 2: Add failing derive tests**

Create `test/theme/design-token-derive.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { getResolvedTokens, toAntdToken, validateTokens } from '@/theme';

describe('theme design token derivation', (): void => {
  it('maps design tokens to Ant Design theme fields', (): void => {
    const tokens = getResolvedTokens('overworld', 'light');
    const antd = toAntdToken(tokens);

    expect(antd.token.borderRadius).toBe(0);
    expect(antd.token.borderRadiusLG).toBe(0);
    expect(antd.token.borderRadiusSM).toBe(0);
    expect(antd.token.lineWidth).toBe(2);
    expect(antd.token.fontFamily).toContain('Pixelify Sans');
  });

  it('accepts non-color design token formats during validation', (): void => {
    const warn = vi.spyOn(console, 'warn').mockImplementation((): void => {});
    validateTokens(getResolvedTokens('overworld', 'light'), 'overworld-light');

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
```

- [x] **Step 3: Run tests to verify RED**

Run: `pnpm exec vitest run test/theme/preset-list.test.ts test/theme/design-token-derive.test.ts`

Expected: fail because `overworld`, `control`, `interaction`, and Ant Design design token mapping do not exist yet.

---

### Task 2: Theme Infrastructure

**Files:**
- Modify: `src/theme/types/tokens.ts`
- Modify: `src/theme/core/factory.ts`
- Modify: `src/theme/core/derive.ts`
- Modify: `src/theme/core/apply.ts`
- Modify: `src/theme/index.ts`

**Interfaces:**
- Produces: `ThemeTokenOverrides`, extended `ThemeTokens`, `createThemeTokens(palette, mode, overrides?)`, expanded `toAntdToken`

- [x] **Step 1: Extend token types**

Add the design token groups from the spec to `ThemeTokens`, with JSDoc on each group.

- [x] **Step 2: Add override support**

In `factory.ts`, define:

```typescript
export type ThemeTokenOverrides = PartialDeep<ThemeTokens>;
```

Add a typed recursive merge helper that rejects arrays and avoids `any`. Apply default design token groups before overrides.

- [x] **Step 3: Extend Ant Design mapping**

Add `borderRadius`, `borderRadiusLG`, `borderRadiusSM`, `lineWidth`, and `fontFamily` to `AntdThemeToken`. Use a local `parseDimension` helper that accepts `0`, `px`, `rem`, and `em`.

- [x] **Step 4: Extend validation**

Update `validateTokens` so color keys use color validation, dimension keys use dimension validation, duration keys use time validation, easing keys use easing validation, and font keys accept font stacks.

- [x] **Step 5: Run tests to verify GREEN for infrastructure**

Run: `pnpm exec vitest run test/theme/design-token-derive.test.ts`

Expected: tests still fail only because Overworld is not registered yet, or pass once Task 3 is also complete.

---

### Task 3: Overworld Preset

**Files:**
- Create: `src/theme/presets/overworld.ts`
- Modify: `src/theme/index.ts`
- Modify: `test/theme/preset-list.test.ts`

**Interfaces:**
- Consumes: `BasePalette`, `ThemeTokenOverrides`, `createThemeTokens`, `registerPreset`
- Produces: preset id `overworld`, label `复古冒险「Overworld」`

- [x] **Step 1: Define light/dark palettes and overrides**

Use palette values from the visual reference:

```typescript
const overworldLight: BasePalette = {
  bg0: '#fffaef',
  bg1: '#f1e6d2',
  bg2: '#eadcc3',
  bg3: '#fffaf0',
  bg4: '#d8c7a8',
  fg0: '#161310',
  fg1: '#3f382f',
  fg2: '#7a6e5c',
  red: '#e2522e',
  green: '#2f7554',
  yellow: '#c28b26',
  blue: '#2e5dd6',
  purple: '#6e57b7',
  orange: '#e2522e',
  cyan: '#2e9eb3',
  syntaxComment: '#8b806d',
  syntaxKeyword: '#2e5dd6',
  syntaxString: '#2f7554',
  syntaxFunction: '#161310',
  syntaxNumber: '#c28b26',
  syntaxType: '#2e9eb3',
  syntaxVariable: '#3f382f',
  syntaxOperator: '#161310',
  syntaxTag: '#e2522e',
  syntaxAttribute: '#2e5dd6',
  accent: '#2e5dd6',
  border: '#161310',
  selectionBg: '#c8d7ff'
};
```

Define dark equivalents with deep ink backgrounds, bone foreground, cobalt accent, moss success, and vermillion warning.

- [x] **Step 2: Register preset**

Call `registerPreset({ id: 'overworld', label: '复古冒险「Overworld」', light, dark })` and import it from `src/theme/index.ts`.

- [x] **Step 3: Run tests to verify GREEN**

Run: `pnpm exec vitest run test/theme/preset-list.test.ts test/theme/design-token-derive.test.ts`

Expected: PASS.

---

### Task 4: First Component Migration

**Files:**
- Modify: `src/components/BButton/index.vue`
- Modify: `src/components/BDropdown/index.vue`
- Modify: `src/components/BDropdown/Menu.vue`
- Modify: `src/components/BDropdown/Button.vue`
- Modify: `src/components/BModal/index.vue`
- Modify: `src/components/BDrawer/index.vue`
- Modify: `src/components/BSelect/index.vue`
- Modify/create focused component style tests

**Interfaces:**
- Consumes: CSS variables `--control-radius`, `--radius-full`, `--overlay-radius`, `--motion-duration-base`, `--motion-easing-standard`
- Produces: base components whose radius/motion follow theme contract

- [x] **Step 1: Add failing style tests**

Use source-based tests matching the repo's existing style tests:

```typescript
expect(source).toContain('border-radius: var(--control-radius);');
expect(source).toContain('transition:');
expect(source).toContain('var(--motion-duration-base)');
expect(source).toContain('border-radius: var(--overlay-radius);');
```

- [x] **Step 2: Run tests to verify RED**

Run focused component style tests.

Expected: fail because components still contain hard-coded `6px` / `8px` radius and literal transition durations.

- [x] **Step 3: Replace hard-coded values in first batch**

Update only the first-batch base components. Preserve explicit props such as `BModal` `borderRadius`.

- [x] **Step 4: Run tests to verify GREEN**

Run focused component style tests and theme tests.

Expected: PASS.

---

### Task 5: Changelog and Verification

**Files:**
- Modify/Create: `changelog/2026-08-01.md`

**Interfaces:**
- Consumes: implemented theme contract and tests
- Produces: changelog entry and final verification output

- [x] **Step 1: Update changelog**

Add entries under `Added` and `Changed` for Overworld and design token contract.

- [x] **Step 2: Run focused tests**

Run: `pnpm exec vitest run test/theme/preset-list.test.ts test/theme/design-token-derive.test.ts`

Expected: PASS.

- [x] **Step 3: Run type/lint checks if time allows**

Run: `pnpm exec tsc --noEmit`

Expected: PASS.

- [x] **Step 4: Check git status without committing**

Run: `git status --short`

Expected: source, tests, docs, and changelog are modified/untracked; no staged or committed changes.

---

### Task 6: High-Frequency Chat Chrome Migration

**Files:**
- Modify: `src/components/BChat/index.vue`
- Modify: `src/components/BChat/components/InputToolbar.vue`
- Modify: `src/components/BChat/components/MessageBubble.vue`
- Modify: `src/components/BChat/components/QuestionCard.vue`
- Modify: `src/components/BChat/components/ConfirmationSheet.vue`
- Modify: `src/components/BChat/components/SessionHistory.vue`
- Modify: `src/components/BChat/components/InputToolbar/ModelSelector.vue`
- Modify: `test/components/theme-design-token-styles.test.ts`

**Interfaces:**
- Consumes: CSS variables `--surface-radius`, `--control-radius`, `--overlay-radius`, `--radius-full`, and motion duration/easing tokens.
- Produces: chat composer, message attachments, confirmation sheet, session history, model selector, and question cards whose chrome follows the active theme contract.

- [x] **Step 1: Add failing chat style tests**

Add source-based assertions for chat surfaces and motion tokens.

- [x] **Step 2: Run tests to verify RED**

Run focused style and preset tests.

- [x] **Step 3: Replace chat chrome hard-coded radius and transition values**

Update only high-frequency chat shell components and keep layout-specific values untouched.

- [x] **Step 4: Run tests to verify GREEN**

Run focused style and preset tests.

---

### Task 7: Semantic Border Width Consumption

**Files:**
- Modify: `src/components/BButton/index.vue`
- Modify: `src/components/BDropdown/index.vue`
- Modify: `src/components/BDropdown/Menu.vue`
- Modify: `src/components/BDropdown/Button.vue`
- Modify: `src/components/BSegmented/index.vue`
- Modify: `src/components/BToolbar/index.vue`
- Modify: `src/components/BSmart/Select.vue`
- Modify: `src/components/BSmart/components/_SelectDropdown.vue`
- Modify: `src/components/BChat/index.vue`
- Modify: `src/components/BChat/components/MessageBubble.vue`
- Modify: `src/components/BChat/components/QuestionCard.vue`
- Modify: `src/components/BChat/components/ConfirmationSheet.vue`
- Modify: `test/components/theme-design-token-styles.test.ts`

**Interfaces:**
- Consumes: CSS variables `--control-border-width`, `--surface-border-width`, and `--overlay-border-width`.
- Produces: migrated control, surface, and overlay chrome whose border weight follows the active theme contract.

- [x] **Step 1: Add failing border width style tests**

Add source-based assertions for semantic border width token usage.

- [x] **Step 2: Run tests to verify RED**

Run focused style tests and confirm migrated components still use literal `1px` borders.

- [x] **Step 3: Replace literal chrome border widths**

Update only visual chrome borders. Leave graphic-only borders, loading rings, and layout separators untouched.

- [x] **Step 4: Run tests to verify GREEN**

Run focused style tests.

---

## Remaining Work Plan

The completed tasks establish the contract and prove that Overworld can drive color, radius, border width, and motion through first-wave chrome. The remaining work should deepen that contract in priority order: make fonts visible, make press feedback tactile, map stronger Ant Design component defaults, migrate the next user-visible surfaces, then add custom theme persistence and visual QA.

### Task 8: Font Token Consumption and Optional Local Font Assets

**Files:**
- Modify: `src/assets/styles/reset.less`
- Modify: `src/assets/styles/index.less`
- Modify: `test/components/theme-design-token-styles.test.ts`
- Optional assets after license review: `src/assets/fonts/overworld/PixelifySans-Regular.woff2`
- Optional assets after license review: `src/assets/fonts/overworld/VT323-Regular.woff2`

**Interfaces:**
- Consumes: CSS variables `--font-sans`, `--font-mono`, and `--font-display`.
- Produces: global text, code text, and high-personality controls that visibly consume theme font tokens.

- [x] **Step 1: Add failing font consumption style tests**

Add assertions to `test/components/theme-design-token-styles.test.ts`:

```typescript
it('uses theme font tokens in global and display chrome styles', (): void => {
  const resetSource = readSource('src/assets/styles/reset.less');
  const buttonSource = readSource('src/components/BButton/index.vue');
  const dropdownButtonSource = readSource('src/components/BDropdown/Button.vue');

  expect(resetSource).toContain('font-family: var(--font-sans);');
  expect(resetSource).toContain('font-family: var(--font-mono);');
  expect(buttonSource).toContain('font-family: var(--font-display);');
  expect(dropdownButtonSource).toContain('font-family: var(--font-display);');
});
```

- [x] **Step 2: Run tests to verify RED**

Run: `pnpm exec vitest run test/components/theme-design-token-styles.test.ts`

Expected: FAIL because `src/assets/styles/reset.less` does not yet include theme font reset rules and themed chrome does not consume `--font-display`.

- [x] **Step 3: Add global font stylesheet**

Append theme font reset rules to `src/assets/styles/reset.less`:

```less
/**
 * @file reset.less
 * @description Applies global app resets plus theme font and Ant Design input chrome normalization.
 */

html,
body,
#app {
  font-family: var(--font-sans);
}

code,
pre,
kbd,
samp {
  font-family: var(--font-mono);
}
```

Modify `src/assets/styles/index.less`:

```less
@import './normalize.less';
@import './scrollbar.less';
@import './markdown.less';
@import 'katex/dist/katex.min.css';
@import './reset.less';
```

- [x] **Step 4: Apply display font to first-wave personality chrome**

In `src/components/BButton/index.vue`, add to `.b-button`:

```less
font-family: var(--font-display);
```

In `src/components/BDropdown/Button.vue`, add to `.b-dropdown-button`:

```less
font-family: var(--font-display);
```

- [x] **Step 5: Add optional local font-face rules only after font files are present**

If the licensed WOFF2 files exist at the optional asset paths, prepend this to `src/assets/styles/reset.less`:

```less
@font-face {
  font-family: 'Pixelify Sans';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('@/assets/fonts/overworld/PixelifySans-Regular.woff2') format('woff2');
}

@font-face {
  font-family: 'VT323';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('@/assets/fonts/overworld/VT323-Regular.woff2') format('woff2');
}
```

If the files are not present, leave the `@font-face` block out and rely on installed fonts plus the existing fallback stack.

- [x] **Step 6: Run tests to verify GREEN**

Run: `pnpm exec vitest run test/components/theme-design-token-styles.test.ts`

Expected: PASS.

---

### Task 9: Press Offset and Hard Shadow Interaction Tokens

**Files:**
- Modify: `src/theme/types/tokens.ts`
- Modify: `src/theme/core/factory.ts`
- Modify: `src/theme/core/apply.ts`
- Modify: `src/theme/presets/overworld.ts`
- Modify: `src/components/BButton/index.vue`
- Modify: `src/components/BDropdown/Button.vue`
- Modify: `src/components/BChat/components/QuestionCard.vue`
- Modify: `test/theme/preset-list.test.ts`
- Modify: `test/components/theme-design-token-styles.test.ts`

**Interfaces:**
- Consumes: existing `interaction.pressOffset`.
- Produces: `interaction.raisedShadow` and `interaction.pressedShadow` tokens plus chrome that can render Overworld-style hard shadows without one-off component CSS.

- [x] **Step 1: Add failing interaction token tests**

Extend the `DesignTokenProbe` in `test/theme/preset-list.test.ts`:

```typescript
interaction: {
  pressOffset: string;
  raisedShadow: string;
  pressedShadow: string;
};
button: {
  border: string;
  borderWidth: string;
  shadow: string;
  activeShadow: string;
  pressedShadow: string;
};
```

Add assertions in the Overworld test:

```typescript
expect(probe.interaction.raisedShadow).toBe('2px 2px 0 0 #161310');
expect(probe.interaction.pressedShadow).toBe('none');
expect(probe.button.border).toBe('#161310');
expect(probe.button.borderWidth).toBe('2px');
expect(probe.button.shadow).toBe('2px 2px 0 0 #161310');
expect(probe.button.activeShadow).toBe('2px 2px 0 0 #2e5dd6');
expect(probe.button.pressedShadow).toBe('none');
expect(lightCssVars['--interaction-raised-shadow']).toBe('2px 2px 0 0 #161310');
expect(lightCssVars['--interaction-pressed-shadow']).toBe('none');
expect(lightCssVars['--button-border']).toBe('#161310');
expect(lightCssVars['--button-border-width']).toBe('2px');
expect(lightCssVars['--button-shadow']).toBe('2px 2px 0 0 #161310');
expect(lightCssVars['--button-active-shadow']).toBe('2px 2px 0 0 #2e5dd6');
expect(lightCssVars['--button-pressed-shadow']).toBe('none');
```

- [x] **Step 2: Add failing press style tests**

Add assertions to `test/components/theme-design-token-styles.test.ts`:

```typescript
expect(buttonSource).toContain('box-shadow: var(--button-shadow);');
expect(buttonSource).toContain('box-shadow: var(--button-pressed-shadow);');
expect(buttonSource).toContain('translate(var(--interaction-press-offset), var(--interaction-press-offset))');
expect(dropdownButtonSource).toContain('box-shadow: var(--interaction-raised-shadow);');
expect(questionCardSource).toContain('box-shadow: var(--interaction-raised-shadow);');
```

- [x] **Step 3: Run tests to verify RED**

Run: `pnpm exec vitest run test/theme/preset-list.test.ts test/components/theme-design-token-styles.test.ts`

Expected: FAIL because `raisedShadow` and `pressedShadow` do not exist yet and components do not use press shadows.

- [x] **Step 4: Extend interaction token types and defaults**

In `src/theme/types/tokens.ts`, extend `ThemeTokens['interaction']`:

```typescript
interaction: {
  pressOffset: string;
  raisedShadow: string;
  pressedShadow: string;
};
button: {
  border: string;
  borderWidth: string;
  shadow: string;
  activeShadow: string;
  pressedShadow: string;
};
```

In `createDefaultDesignTokens()` inside `src/theme/core/factory.ts`, set:

```typescript
interaction: {
  pressOffset: '0px',
  raisedShadow: 'none',
  pressedShadow: 'none'
},
button: {
  border: 'transparent',
  borderWidth: '0px',
  shadow: 'none',
  activeShadow: 'none',
  pressedShadow: 'none'
}
```

- [x] **Step 5: Update validation for shadow interaction tokens**

In `src/theme/core/apply.ts`, classify `--button-border-width` as a dimension and classify `--interaction-raised-shadow`, `--interaction-pressed-shadow`, `--button-shadow`, `--button-active-shadow`, and `--button-pressed-shadow` as shadow-like values. Accept `none`, `rgb()`, `color-mix()`, and standard CSS shadow strings.

- [x] **Step 6: Add Overworld shadow overrides**

In `src/theme/presets/overworld.ts`, update `overworldDesignOverrides.interaction`:

```typescript
interaction: {
  pressOffset: '2px',
  raisedShadow: '2px 2px 0 0 #161310',
  pressedShadow: 'none'
},
button: {
  border: '#161310',
  borderWidth: '2px',
  shadow: '2px 2px 0 0 #161310',
  activeShadow: '2px 2px 0 0 #2e5dd6',
  pressedShadow: 'none'
}
```

For dark mode, override the shadow color in the dark `createThemeTokens()` call:

```typescript
interaction: {
  pressOffset: '2px',
  raisedShadow: '2px 2px 0 0 #fff4df',
  pressedShadow: 'none'
},
button: {
  border: '#fff4df',
  borderWidth: '2px',
  shadow: '2px 2px 0 0 #fff4df',
  activeShadow: '2px 2px 0 0 #5f8cff',
  pressedShadow: 'none'
}
```

- [x] **Step 7: Apply press interaction to first-wave controls**

In `.b-dropdown-button` and `.choice-card__option-btn`, add:

```less
box-shadow: var(--interaction-raised-shadow);
```

In `.b-button`, add:

```less
border: var(--button-border-width) solid var(--button-border);
box-shadow: var(--button-shadow);
```

In each matching active state, add:

```less
transform: translate(var(--interaction-press-offset), var(--interaction-press-offset));
```

Use `--button-pressed-shadow` for `.b-button`; keep `--interaction-pressed-shadow` for shared pressable surfaces such as dropdown buttons and question cards. Overworld sets both pressed shadows to `none` so pressed controls visually sit flush with only their border showing.

Keep default themes visually stable because their button border width is `0px`, offset is `0px`, and shadows are `none`.

- [x] **Step 8: Run tests to verify GREEN**

Run: `pnpm exec vitest run test/theme/preset-list.test.ts test/theme/design-token-derive.test.ts test/components/theme-design-token-styles.test.ts`

Expected: PASS.

---

### Task 10: Ant Design Component Token Expansion

**Files:**
- Modify: `src/theme/core/derive.ts`
- Modify: `test/theme/design-token-derive.test.ts`

**Interfaces:**
- Consumes: `ThemeTokens.control`, `ThemeTokens.surface`, `ThemeTokens.overlay`, `ThemeTokens.motion`, and `ThemeTokens.font`.
- Produces: Ant Design component tokens for Button, Input, Select, Modal, Drawer, Dropdown, Segmented, and Tooltip.

- [x] **Step 1: Add failing Ant Design component token tests**

Extend the Ant Design probe in `test/theme/design-token-derive.test.ts`:

```typescript
interface AntdDesignTokenProbe {
  token: {
    borderRadius: number;
    borderRadiusLG: number;
    borderRadiusSM: number;
    lineWidth: number;
    fontFamily: string;
  };
  components: {
    Button: { borderRadius: number; lineWidth: number; fontFamily: string };
    Input: { borderRadius: number; lineWidth: number };
    Select: { borderRadius: number; lineWidth: number };
    Modal: { borderRadiusLG: number };
    Drawer: { borderRadiusLG: number };
    Dropdown: { borderRadiusLG: number; lineWidth: number };
    Segmented: { borderRadius: number };
    Tooltip: { borderRadius: number };
  };
}
```

Add assertions:

```typescript
expect(antd.components.Button.borderRadius).toBe(0);
expect(antd.components.Button.lineWidth).toBe(2);
expect(antd.components.Button.fontFamily).toContain('Pixelify Sans');
expect(antd.components.Input.borderRadius).toBe(0);
expect(antd.components.Select.lineWidth).toBe(2);
expect(antd.components.Modal.borderRadiusLG).toBe(0);
expect(antd.components.Dropdown.lineWidth).toBe(2);
expect(antd.components.Segmented.borderRadius).toBe(0);
```

- [x] **Step 2: Run tests to verify RED**

Run: `pnpm exec vitest run test/theme/design-token-derive.test.ts`

Expected: FAIL because `toAntdToken()` does not emit component tokens yet.

- [x] **Step 3: Extend `AntdThemeToken`**

In `src/theme/core/derive.ts`, add:

```typescript
components?: {
  Button?: Record<string, string | number>;
  Input?: Record<string, string | number>;
  Select?: Record<string, string | number>;
  Modal?: Record<string, string | number>;
  Drawer?: Record<string, string | number>;
  Dropdown?: Record<string, string | number>;
  Segmented?: Record<string, string | number>;
  Tooltip?: Record<string, string | number>;
};
```

- [x] **Step 4: Map semantic tokens to Ant Design components**

Inside `toAntdToken()`, derive:

```typescript
const controlRadius = parseDimension(tokens.control.radius, 6);
const surfaceRadius = parseDimension(tokens.surface.radius, 8);
const overlayRadius = parseDimension(tokens.overlay.radius, 8);
const controlLineWidth = parseDimension(tokens.control.borderWidth, 1);
const overlayLineWidth = parseDimension(tokens.overlay.borderWidth, 1);
```

Return:

```typescript
components: {
  Button: { borderRadius: controlRadius, lineWidth: controlLineWidth, fontFamily: tokens.font.display },
  Input: { borderRadius: controlRadius, lineWidth: controlLineWidth },
  Select: { borderRadius: controlRadius, lineWidth: controlLineWidth },
  Modal: { borderRadiusLG: overlayRadius },
  Drawer: { borderRadiusLG: overlayRadius },
  Dropdown: { borderRadiusLG: overlayRadius, lineWidth: overlayLineWidth },
  Segmented: { borderRadius: controlRadius },
  Tooltip: { borderRadius: surfaceRadius }
}
```

- [x] **Step 5: Run tests to verify GREEN**

Run: `pnpm exec vitest run test/theme/design-token-derive.test.ts`

Expected: PASS.

---

### Task 11: Next High-Frequency Chat and Message Surface Migration

**Files:**
- Modify: `src/components/BSmart/Editor.vue`
- Modify: `src/components/BChat/components/ImagePreview.vue`
- Modify: `src/components/BChat/components/TodoPanel.vue`
- Modify: `src/components/BChat/components/AgentTaskProjectionNotice.vue`
- Modify: `src/components/BChat/components/InteractionContainer/ToastItem.vue`
- Modify: `src/components/BChat/components/MessageBubble/BubblePart/index.vue`
- Modify: `src/components/BChat/components/MessageBubble/BubblePartText/index.vue`
- Modify: `src/components/BChat/components/MessageBubble/BubblePartAgent/index.vue`
- Modify: `src/components/BChat/components/MessageBubble/BubblePartStatus/index.vue`
- Modify: `test/components/theme-design-token-styles.test.ts`

**Interfaces:**
- Consumes: `--control-radius`, `--surface-radius`, `--radius-full`, `--control-border-width`, `--surface-border-width`, and motion tokens.
- Produces: the remaining high-frequency chat surfaces with fewer hard-coded modern radii and transitions.

- [x] **Step 1: Add failing chat internals style tests**

Add a new test:

```typescript
it('uses design tokens in remaining chat internals', (): void => {
  const editorSource = readSource('src/components/BSmart/Editor.vue');
  const imagePreviewSource = readSource('src/components/BChat/components/ImagePreview.vue');
  const todoPanelSource = readSource('src/components/BChat/components/TodoPanel.vue');
  const noticeSource = readSource('src/components/BChat/components/AgentTaskProjectionNotice.vue');
  const toastSource = readSource('src/components/BChat/components/InteractionContainer/ToastItem.vue');
  const bubblePartSource = readSource('src/components/BChat/components/MessageBubble/BubblePart/index.vue');
  const bubbleTextSource = readSource('src/components/BChat/components/MessageBubble/BubblePartText/index.vue');
  const bubbleAgentSource = readSource('src/components/BChat/components/MessageBubble/BubblePartAgent/index.vue');
  const bubbleStatusSource = readSource('src/components/BChat/components/MessageBubble/BubblePartStatus/index.vue');

  expect(editorSource).toContain('border-radius: var(--control-radius);');
  expect(editorSource).toContain('border: var(--control-border-width) solid var(--input-border);');
  expect(imagePreviewSource).toContain('border-radius: var(--surface-radius);');
  expect(todoPanelSource).toContain('border-radius: var(--surface-radius);');
  expect(noticeSource).toContain('border-radius: var(--surface-radius);');
  expect(toastSource).toContain('border-radius: var(--surface-radius);');
  expect(bubblePartSource).toContain('border-radius: var(--surface-radius);');
  expect(bubbleTextSource).toContain('border-radius: var(--surface-radius);');
  expect(bubbleAgentSource).toContain('border-radius: var(--surface-radius);');
  expect(bubbleStatusSource).toContain('border-radius: var(--radius-full);');
});
```

- [x] **Step 2: Run tests to verify RED**

Run: `pnpm exec vitest run test/components/theme-design-token-styles.test.ts`

Expected: FAIL because these files still contain literal `4px`, `6px`, `8px`, `999px`, and fixed transition values.

- [x] **Step 3: Replace only semantic chrome**

Use these replacements:

```less
border-radius: var(--control-radius);
border-radius: var(--surface-radius);
border-radius: var(--radius-full);
border: var(--control-border-width) solid var(--input-border);
border: var(--surface-border-width) solid var(--border-primary);
transition: opacity var(--motion-duration-base) var(--motion-easing-standard);
transition: background var(--motion-duration-fast) var(--motion-easing-standard);
```

Leave avatars, circular progress rings, image crop masks, and loading spinners as local geometry.

- [x] **Step 4: Run tests to verify GREEN**

Run: `pnpm exec vitest run test/components/theme-design-token-styles.test.ts`

Expected: PASS.

---

### Task 12: Settings and Provider Chrome Migration

**Files:**
- Modify: `src/views/settings/_components/SettingsPage.vue`
- Modify: `src/views/settings/_components/SettingsSection.vue`
- Modify: `src/views/settings/provider/layout.vue`
- Modify: `src/views/settings/provider/components/ProviderCard.vue`
- Modify: `src/views/settings/provider/components/ProviderInfo.vue`
- Modify: `src/views/settings/provider/components/ModelList.vue`
- Modify: `src/views/settings/provider/components/SidebarItem.vue`
- Modify: `src/views/settings/provider/components/SidebarSearch.vue`
- Modify: `src/views/settings/provider/components/ApiConfig.vue`
- Create: `test/components/theme-settings-token-styles.test.ts`

**Interfaces:**
- Consumes: same surface/control/overlay radius, border width, and motion tokens.
- Produces: settings surfaces that visually follow strong themes without touching provider business logic.

- [x] **Step 1: Add failing settings style tests**

Create `test/components/theme-settings-token-styles.test.ts`:

```typescript
/**
 * @file theme-settings-token-styles.test.ts
 * @description Verifies settings and provider chrome consume theme design tokens.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

describe('settings theme token styles', (): void => {
  it('uses design tokens in settings and provider chrome', (): void => {
    const settingsPageSource = readSource('src/views/settings/_components/SettingsPage.vue');
    const settingsSectionSource = readSource('src/views/settings/_components/SettingsSection.vue');
    const providerLayoutSource = readSource('src/views/settings/provider/layout.vue');
    const providerCardSource = readSource('src/views/settings/provider/components/ProviderCard.vue');
    const providerInfoSource = readSource('src/views/settings/provider/components/ProviderInfo.vue');
    const modelListSource = readSource('src/views/settings/provider/components/ModelList.vue');
    const sidebarItemSource = readSource('src/views/settings/provider/components/SidebarItem.vue');
    const sidebarSearchSource = readSource('src/views/settings/provider/components/SidebarSearch.vue');
    const apiConfigSource = readSource('src/views/settings/provider/components/ApiConfig.vue');

    expect(settingsPageSource).toContain('border-radius: var(--surface-radius);');
    expect(settingsSectionSource).toContain('border-radius: var(--surface-radius);');
    expect(providerLayoutSource).toContain('border-radius: var(--surface-radius);');
    expect(providerCardSource).toContain('border-radius: var(--surface-radius);');
    expect(providerInfoSource).toContain('border-radius: var(--surface-radius);');
    expect(modelListSource).toContain('border-radius: var(--surface-radius);');
    expect(sidebarItemSource).toContain('border-radius: var(--control-radius);');
    expect(sidebarSearchSource).toContain('border-radius: var(--control-radius);');
    expect(apiConfigSource).toContain('border-radius: var(--surface-radius);');
  });
});
```

- [x] **Step 2: Run tests to verify RED**

Run: `pnpm exec vitest run test/components/theme-settings-token-styles.test.ts`

Expected: FAIL because settings/provider chrome still uses literal radii and fixed transition durations.

- [x] **Step 3: Replace settings chrome literals**

Use `surface` tokens for cards/panels and `control` tokens for clickable rows/search inputs. Replace fixed transitions with `--motion-duration-fast` or `--motion-duration-base` based on the current duration: `0.15s` maps to fast, `0.2s` maps to base.

- [x] **Step 4: Run tests to verify GREEN**

Run: `pnpm exec vitest run test/components/theme-settings-token-styles.test.ts`

Expected: PASS.

---

### Task 13: Custom Theme Config Schema and Registry Hydration

**Files:**
- Create: `src/theme/types/custom.ts`
- Modify: `src/theme/core/factory.ts`
- Modify: `src/theme/core/registry.ts`
- Modify: `src/theme/index.ts`
- Create: `test/theme/custom-theme-config.test.ts`

**Interfaces:**
- Produces: `CustomThemeConfig` and `registerCustomTheme(config)`.
- Consumes: `ThemeTokenOverrides` and existing `registerPreset`.

- [x] **Step 1: Add failing custom theme schema tests**

Create `test/theme/custom-theme-config.test.ts`:

```typescript
/**
 * @file custom-theme-config.test.ts
 * @description Verifies custom theme configs are normalized and registered through the preset registry.
 */
import { describe, expect, it } from 'vitest';
import { getPresetList, getResolvedTokens, registerCustomTheme } from '@/theme';

describe('custom theme config', (): void => {
  it('registers a schema-versioned custom theme with partial token overrides', (): void => {
    registerCustomTheme({
      schemaVersion: 1,
      id: 'custom-square',
      label: 'Custom Square',
      light: {
        color: { primary: '#123456' },
        control: { radius: '0px', borderWidth: '2px' }
      },
      dark: {
        color: { primary: '#abcdef' },
        control: { radius: '0px', borderWidth: '2px' }
      }
    });

    expect(getPresetList()).toContainEqual({ id: 'custom-square', label: 'Custom Square' });
    expect(getResolvedTokens('custom-square', 'light').color.primary).toBe('#123456');
    expect(getResolvedTokens('custom-square', 'light').control.borderWidth).toBe('2px');
  });
});
```

- [x] **Step 2: Run tests to verify RED**

Run: `pnpm exec vitest run test/theme/custom-theme-config.test.ts`

Expected: FAIL because `registerCustomTheme` does not exist.

- [x] **Step 3: Add custom theme types**

Create `src/theme/types/custom.ts`:

```typescript
/**
 * @file custom.ts
 * @description Custom theme configuration schema for persisted user themes.
 */
import type { ThemeTokenOverrides } from '../core/factory';

/**
 * Persisted custom theme configuration.
 */
export interface CustomThemeConfig {
  /** Schema version for future migrations. */
  schemaVersion: 1;
  /** Theme preset ID. */
  id: string;
  /** Theme preset display label. */
  label: string;
  /** Light mode token overrides. */
  light: ThemeTokenOverrides;
  /** Dark mode token overrides. */
  dark: ThemeTokenOverrides;
}
```

- [x] **Step 4: Add a base-token override helper**

In `src/theme/core/factory.ts`, export:

```typescript
/**
 * Creates a theme token object by applying partial overrides to an existing token object.
 * @param baseTokens - Base theme tokens
 * @param overrides - Partial token overrides
 * @returns Merged theme tokens
 */
export function createThemeTokensFromBase(baseTokens: ThemeTokens, overrides?: ThemeTokenOverrides): ThemeTokens {
  return merge({}, baseTokens, overrides ?? {}) as ThemeTokens;
}

```

- [x] **Step 5: Implement registry hydration**

In `src/theme/core/registry.ts`, export:

```typescript
import type { CustomThemeConfig } from '../types/custom';
import { createThemeTokensFromBase } from './factory';

export function registerCustomTheme(config: CustomThemeConfig): void {
  if (config.schemaVersion !== 1) {
    throw new Error(`[theme-registry] Unsupported custom theme schema version: ${config.schemaVersion}`);
  }

  const defaultLight = getResolvedTokens('default', 'light');
  const defaultDark = getResolvedTokens('default', 'dark');

  registerPreset({
    id: config.id,
    label: config.label,
    light: createThemeTokensFromBase(defaultLight, config.light),
    dark: createThemeTokensFromBase(defaultDark, config.dark)
  });
}
```

- [x] **Step 6: Export custom theme API**

In `src/theme/index.ts`, export:

```typescript
export type { CustomThemeConfig } from './types/custom';
export { registerCustomTheme } from './core/registry';
```

- [x] **Step 7: Run tests to verify GREEN**

Run: `pnpm exec vitest run test/theme/custom-theme-config.test.ts test/theme/preset-list.test.ts`

Expected: PASS.

---

### Task 14: Overworld Visual QA and Regression Checklist

**Files:**
- Create: `docs/qa/overworld-theme-checklist.md`
- Optional if Playwright is already configured: `test/e2e/overworld-theme.spec.ts`

**Interfaces:**
- Consumes: completed token implementation and local app runtime.
- Produces: a repeatable checklist for verifying Overworld across the actual UI, not only source-based style tests.

- [x] **Step 1: Create visual QA checklist**

Create `docs/qa/overworld-theme-checklist.md`:

```markdown
# Overworld Theme QA Checklist

## Setup

- Start the app locally.
- Set theme preset to `overworld`.
- Check light mode and dark mode.

## Screens

- Chat screen: input composer, model selector, session history, question card, confirmation sheet.
- Settings basic page: theme selector and controls.
- Provider settings: provider cards, model rows, search/sidebar controls.
- Editor: command panel, toolbar menus, code block surfaces, selection toolbar.
- Widget/Webview panels: sidebars, toolbars, overlays.

## Visual Checks

- Cobalt primary color is visible in primary actions and selection states.
- Control, surface, and overlay corners are square in Overworld.
- Control, surface, and overlay borders read as 2px pixel edges where applicable.
- Buttons and selectable options show hard-shadow press feedback after Task 9.
- Text remains readable with the Overworld font stack.
- No text overlaps or clips after thicker borders.
- Ant Design controls match custom components for radius and border weight after Task 10.
```

- [ ] **Step 2: Run app and capture screenshots**

Run the existing app start command used by the project. If no server is running, start the normal dev command and open the app manually.

Expected: screenshots for chat, settings, provider, editor, and one overlay state in light and dark mode.

- [ ] **Step 3: Record findings**

Append a `## Findings` section to `docs/qa/overworld-theme-checklist.md` with concrete file references for every visual mismatch that needs a follow-up task.

- [x] **Step 4: Run final verification**

Run:

```bash
pnpm exec vitest run test/theme/preset-list.test.ts test/theme/design-token-derive.test.ts test/components/BButton/index.test.ts test/components/theme-design-token-styles.test.ts
pnpm exec tsc --noEmit
pnpm exec eslint src/theme/types/tokens.ts src/theme/core/factory.ts src/theme/core/derive.ts src/theme/core/apply.ts src/theme/index.ts src/theme/presets/default.ts src/theme/presets/graphite.ts src/theme/presets/overworld.ts test/components/theme-design-token-styles.test.ts test/theme/preset-list.test.ts test/theme/design-token-derive.test.ts --ext .vue,.ts
pnpm exec stylelint src/components/**/*.vue src/views/**/*.vue
git diff --check
git status --short
```

Expected: all commands exit 0 except `git status --short`, which should show modified and untracked files with no staged changes unless the user explicitly stages them.

---

### Task 15: Deep Chrome Theme Token Migration

**Files:**
- Create: `test/components/theme-deep-token-styles.test.ts`
- Modify: `src/assets/styles/markdown.less`
- Modify: `src/components/BMessage/index.vue`
- Modify: `src/components/BMessage/components/CodeBlockNode.vue`
- Modify: `src/components/BMessage/components/ImageNode.vue`
- Modify: `src/components/BBubble/index.vue`
- Modify: `src/components/BEditor/Markdown.vue`
- Modify: `src/components/BEditor/components/CodeBlock.vue`
- Modify: `src/components/BEditor/components/CurrentBlockMenu.vue`
- Modify: `src/components/BEditor/components/LinkPopover.vue`
- Modify: `src/components/BEditor/shared/SelectionToolbar.vue`
- Modify: `src/components/BEditor/shared/SelectionAIInput.vue`
- Modify: `src/components/BEditor/shared/FindBar.vue`
- Modify: `src/components/BEditor/shared/CommentCard.vue`
- Modify: `src/views/widget/components/SidebarTools.vue`
- Modify: `src/views/widget/components/SidebarLayer.vue`
- Modify: `src/views/widget/components/DesignSetter/ControlPanel.vue`
- Modify: `src/views/widget/components/BatchSetter.vue`
- Modify: `src/components/BWidget/components/Toolbar.vue`
- Modify: `src/views/webview/web/components/AddressBar.vue`
- Modify: `src/views/webview/native/components/AddressBar.vue`
- Modify: `src/views/webview/web/index.vue`
- Modify: `src/views/webview/native/index.vue`
- Modify: `src/views/webview/web/components/InspectorPanel.vue`
- Modify: `src/components/BColorPicker/index.vue`
- Modify: `src/components/BImageViewer/index.vue`
- Modify: `src/components/BImageViewer/components/Carousel.vue`
- Modify: `src/components/BJsonViewer/index.vue`
- Modify: `src/components/BJsonViewer/components/NodeDetailModal.vue`
- Modify: `src/components/BEditor/components/MathBlock.vue`
- Modify: `src/components/BEditor/components/TableView.vue`
- Modify: `src/components/BEditor/components/FrontMatterBlock.vue`
- Modify: `src/components/BEditor/components/ImageBlock.vue`
- Modify: `src/components/BEditor/components/HoverIndicator.vue`

**Interfaces:**
- Consumes: design token CSS variables emitted by Task 2/3.
- Produces: broader source-level guardrails for deep app chrome so Overworld and future custom themes do not regress to hard-coded modern styling.

- [x] **Step 1: Add RED tests for deep chrome token usage**

Create `test/components/theme-deep-token-styles.test.ts` and assert that Markdown/message surfaces, editor deep chrome, widget/webview panels, utility viewers, and editor content blocks consume semantic radius, border width, font, and motion tokens.

Expected: first run fails on existing hard-coded values.

- [x] **Step 2: Migrate Markdown and legacy message surfaces**

Replace hard-coded mono font stacks, 1px borders, fixed radii, and fixed transitions in shared Markdown, legacy BMessage code/image placeholders, and BBubble containers with `--font-mono`, `--surface-*`, `--control-*`, and `--motion-*` tokens.

Expected: Markdown-rendered content and older message primitives follow Overworld square corners and theme border widths.

- [x] **Step 3: Migrate editor deep chrome**

Move editor shell, code/math/frontmatter/image/table blocks, block menu, link popover, selection toolbar, AI preview, find bar, comment card, and hover indicator chrome to semantic surface/control/overlay tokens.

Expected: editor internals no longer keep isolated 4px/6px/8px radius islands in Overworld.

- [x] **Step 4: Migrate widget, webview, and utility viewer chrome**

Move widget sidebar rows, batch disabled panel, widget floating toolbar, webview address bars, webview shell/viewport, inspector panel, color picker, image viewer buttons, carousel controls, and JSON viewer mono/detail chrome to theme tokens.

Expected: deep tool panels and utility overlays are visually compatible with strong custom themes.

- [x] **Step 5: Verify focused tests**

Run: `pnpm exec vitest run test/components/theme-deep-token-styles.test.ts`

Expected: PASS.

---

### Task 16: Page and Default Layout Theme Token Migration

**Files:**
- Create: `test/views/theme-page-token-styles.test.ts`
- Modify: `test/views/webview/web-use-webview.test.ts`
- Modify: `src/layouts/default/index.vue`
- Modify: `src/layouts/default/components/HeaderUpdateNotice.vue`
- Modify: `src/layouts/default/components/HeaderTabMenu.vue`
- Modify: `src/layouts/default/components/HeaderTab.vue`
- Modify: `src/layouts/default/components/MainDropZone.vue`
- Modify: `src/layouts/default/components/ShortcutsHelp.vue`
- Modify: `src/layouts/default/components/ChatSider.vue`
- Modify: `src/views/welcome/index.vue`
- Modify: `src/views/skill/index.vue`
- Modify: `src/views/chat/index.vue`
- Modify: `src/views/settings/index.vue`
- Modify: `src/views/settings/basic/index.vue`
- Modify: `src/views/settings/provider/detail.vue`
- Modify: `src/views/settings/provider/components/ModelList.vue`
- Modify: `src/views/settings/provider/components/ProviderCard.vue`
- Modify: `src/views/settings/provider/components/SidebarSection.vue`
- Modify: `src/views/settings/provider/components/ModelModal.vue`
- Modify: `src/views/settings/logger/components/LogTimeline.vue`
- Modify: `src/views/settings/tools/search/index.vue`
- Modify: `src/views/settings/tools/mcp/components/ServerEditor.vue`
- Modify: `src/views/settings/tools/mcp/components/ServerCard.vue`
- Modify: `src/views/settings/tools/memory/index.vue`
- Modify: `src/views/settings/tools/memory/components/MemoryInput.vue`
- Modify: `src/views/settings/tools/memory/components/MemoryContent.vue`
- Modify: `src/views/settings/tools/skill/index.vue`
- Modify: `src/views/settings/tools/skill/components/SkillCreator.vue`
- Modify: `src/views/settings/tools/skill/components/SkillItemRow.vue`
- Modify: `src/views/settings/tools/widget/index.vue`
- Modify: `src/views/settings/tools/widget/components/WidgetCreator.vue`
- Modify: `src/views/settings/tools/widget/components/WidgetItemRow.vue`
- Modify: `src/views/widget/index.vue`
- Modify: `src/views/widget/components/PanelSidebar.vue`
- Modify: `src/views/widget/components/SidebarState.vue`
- Modify: `src/views/widget/components/SidebarAction.vue`
- Modify: `src/views/widget/components/SidebarLayer.vue`
- Modify: `src/views/widget/components/PageSetter/SchemaTreeEditor.vue`
- Modify: `src/views/webview/web/index.vue`
- Modify: `src/views/webview/web/utils/elementPicker.ts`

**Interfaces:**
- Consumes: design token CSS variables emitted by the active theme.
- Produces: source-level guardrails for page shells, default layout chrome, settings tool pages, widget page panels, and webview element picker injection.

- [x] **Step 1: Add RED tests for page and layout token usage**

Create `test/views/theme-page-token-styles.test.ts` and update the Webview element picker test so fixed page/layout radius, border width, font, and motion values fail before migration.

Expected: first run fails on existing hard-coded values.

- [x] **Step 2: Migrate default layout chrome**

Move header controls, update notice, header tab menu, tabs, main drop zone, shortcuts help, and chat sider to semantic `--control-*`, `--surface-*`, `--overlay-*`, `--font-mono`, and `--motion-*` tokens.

Expected: app shell and global navigation follow Overworld square corners and theme border widths.

- [x] **Step 3: Migrate page shells and settings tool pages**

Move welcome, skill, chat, settings navigation/basic/provider/logger/tools, and widget page shell styles to semantic theme tokens.

Expected: all page-level chrome under `src/views` no longer retains fixed modern radius or fixed transition timings.

- [x] **Step 4: Migrate Webview element picker injection**

Extend `WebviewElementPickerTheme` with border width and radius fields, read them from current CSS variables in the Webview page, and inject them into the page selection overlay script.

Expected: DOM element picker overlays also follow strong theme radius and border width settings.

- [x] **Step 5: Verify focused tests and source scan**

Run:

```bash
pnpm exec vitest run test/views/theme-page-token-styles.test.ts test/views/webview/web-use-webview.test.ts -t "page theme token styles|renders themed selected element toolbar"
rg -n "border-radius:\s*(3|4|5|6|8|10|12|14|16|20|24|999)px|border-radius:\s*50%|border:\s*1px solid|border:\s*2px solid|border:\s*0\.5px solid|box-shadow:\s*0|transition:\s*(all|background|color|opacity|width|border-color|transform|box-shadow)\s+0\.|font-family:\s*(ui-monospace|'Fira Code'|'SF Mono'|Monaco|Menlo|\"SFMono|monospace)" src/views src/layouts/default
```

Expected: focused tests PASS and the scan returns no matches for page/layout chrome.

---

### Task 17: Input Token Contract and Search Field Migration

**Files:**
- Modify: `src/theme/types/tokens.ts`
- Modify: `src/theme/core/factory.ts`
- Modify: `src/theme/core/derive.ts`
- Modify: `src/theme/core/apply.ts`
- Modify: `src/theme/presets/overworld.ts`
- Modify: `src/components/BButton/index.vue`
- Modify: `src/components/BSelect/index.vue`
- Modify: `src/components/BCommandPanel/index.vue`
- Modify: `src/components/BSmart/Editor.vue`
- Modify: `src/components/BSmart/Input.vue`
- Modify: `src/components/BChat/index.vue`
- Modify: `src/views/settings/provider/components/SidebarSearch.vue`
- Modify: `src/views/settings/provider/components/ModelList.vue`
- Modify: `src/views/webview/web/components/AddressBar.vue`
- Modify: `src/views/webview/native/components/AddressBar.vue`
- Modify: `src/views/settings/tools/mcp/components/ServerEditor.vue`
- Modify: `src/components/BMonaco/Modal.vue`
- Modify: `src/components/BEditor/shared/FindBar.vue`
- Modify: `src/views/settings/tools/memory/components/MemoryInput.vue`
- Modify: `src/layouts/default/index.vue`
- Modify: `src/layouts/default/components/ChatSider.vue`
- Modify: `src/layouts/default/components/HeaderTab.vue`
- Modify: `src/views/settings/index.vue`
- Modify: `test/components/BButton/index.test.ts`
- Create: `test/components/theme-input-token-styles.test.ts`
- Modify: `test/components/theme-design-token-styles.test.ts`
- Modify: `test/layouts/default/chat-sider.test.ts`
- Modify: `test/views/theme-page-token-styles.test.ts`
- Modify: `test/theme/preset-list.test.ts`
- Modify: `test/theme/design-token-derive.test.ts`

**Interfaces:**
- Consumes: Overworld input reference language: paper fill, thick ink border, square corners, hard shadow, pixel font, subdued placeholder, icon color, and optional keycap.
- Produces: generic `input` token fields and component source guardrails so future custom themes can style inputs without one-off component patches.

- [x] **Step 1: Add RED tests for input-level tokens**

Extend theme preset and derive tests to assert `input.radius`, `input.borderWidth`, padding, gap, font, placeholder/icon colors, shadows, and keycap fields while explicitly keeping input height out of the theme contract. Add source-level tests for command panel search, chat/Smart inputs, settings search, and Webview address bars.

Expected: initial run fails because input tokens only cover colors and components still consume `control` or hard-coded input styling.

- [x] **Step 2: Extend theme input contract**

Add flat input token fields to `ThemeTokens.input` so CSS variable output remains one-level and backward-compatible with `toCssVars`. Update default token derivation, validator dimension/shadow/font key handling, and Ant Design text input component mapping.

Expected: default themes keep modern input behavior, while strong themes can override input shape independently from generic controls.

- [x] **Step 3: Add Overworld input semantics**

Set Overworld input radius to `0px`, border width to `2px`, zero vertical padding, pixel font stack, `2px 2px` hard shadow, paper/keycap backgrounds, and ink/placeholder colors. Keep light and dark mode color/shadow values separate while sharing keycap structure and letting each component own its local height.

Expected: Overworld inputs can match the reference image without encoding the visual design into a single component.

- [x] **Step 4: Migrate high-frequency input components**

Move command panel search, SmartEditor, SmartInput, chat composer shell, provider search, model search, Webview address bars, MCP ServerEditor, Monaco modal host, FindBar input text, and memory input placeholder/font to input tokens. Add command panel search icon and optional `/` keycap markup.

Expected: high-frequency input surfaces follow the same theme contract, with compact toolbars preserving their local heights.

- [x] **Step 4.1: Cover Ant Design default input/select shadows**

Add a global reset layer in `src/assets/styles/reset.less` for Ant Design Input, InputNumber, Picker, affix wrappers, and Select selectors. This layer applies `--input-shadow` in the default state and `--input-active-shadow` in focused/open states, because Ant Design component tokens do not apply a normal-state box shadow to these controls. Select selectors use duplicated selector specificity and clear `outline` so Ant Design's CSS-in-JS focus glow cannot sit on top of the input token shadow.

Expected: AInput/ASelect controls show Overworld hard shadows consistently without per-page overrides.

- [x] **Step 4.2: Prevent hidden ChatSider horizontal overflow**

Add ChatSider source regression tests, hide the `BPanelSplitter` section and resize line only when the sidebar is hidden and no explicit visibility animation is running, clear the idle transform, and keep the visible 6px sidebar gap inside the panel content instead of as an external flex-item margin. Add a default layout regression test that the app shell clips horizontal overflow and lets flex children shrink. This prevents preserved sidebar width, splitter handles, external gaps, transforms, and themed shadows from increasing page `scrollWidth`.

Expected: closing ChatSider no longer leaves a horizontally scrollable blank area, while button-triggered open/close animation keeps its section visible during the transition.

- [x] **Step 4.3: Align select, button, and navigation chrome shadows**

Add regression coverage for BSelect focus/open shadows, BButton border and shadow sizing, BDropdown button chrome, HeaderTab/HeaderTabs pressed chrome, the default layout welcome tab button, and native Settings sidebar navigation. Update BSelect to override Ant Design selector focus/open shadows with high-specificity input token selectors; update BButton and button-like navigation/dropdown chrome to use independent button border/shadow tokens so default themes keep border width `0px` and Overworld supplies the `2px` ink border plus matching `2px 2px` hard shadow; keep explicit `outline`/`bordered` variants as semantic visible-border exceptions.

Expected: Select focus no longer shows Ant Design's mismatched glow, buttons have themed borders with their own shadow variables, header tabs feel like the same control family, and Settings navigation keeps its native markup while sharing the same interaction styling.

- [x] **Step 5: Verify focused tests**

Run:

```bash
pnpm vitest run test/theme/preset-list.test.ts test/theme/design-token-derive.test.ts test/components/theme-input-token-styles.test.ts test/components/theme-design-token-styles.test.ts test/components/theme-deep-token-styles.test.ts test/views/theme-page-token-styles.test.ts
```

Expected: PASS.
