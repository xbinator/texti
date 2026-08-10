# Settings Theme Runtime Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep theme descriptions with their registered presets while SettingsTool consumes only a shared, theme-agnostic settings contract and discovers all theme options at runtime.

**Architecture:** `ThemePreset` owns `id`, `label`, `description`, and tokens; `getPresetList()` exposes those fields for renderer snapshots. `shared/settings/definitions.ts` owns setting keys, tool names, and generic descriptions without importing `src/theme`; Electron consumers import this contract directly instead of routing it through `constants.mts`.

**Tech Stack:** TypeScript 5.9, Vue 3/Pinia, Electron, Vitest.

## Global Constraints

- Do not use `any`; all new interfaces and functions require explicit types and comments.
- Do not add a separate built-in theme metadata constant or file.
- Keep SettingsTool in `shared/ai/tools` as part of the cross-process registry.
- Keep SettingsTool schemas stable and theme-agnostic; runtime options are authoritative.
- Do not commit; leave all changes in the working tree for the user.

---

### Task 1: Make Theme Registry Own Descriptions

**Files:**
- Modify: `src/theme/core/registry.ts`
- Modify: `src/theme/types/custom.ts`
- Modify: `src/theme/presets/graphite.ts`
- Modify: `src/theme/presets/classic.ts`
- Modify: `src/theme/presets/shonen.ts`
- Modify: `src/theme/presets/overworld.ts`
- Modify: `src/theme/index.ts`
- Delete: `src/theme/presets/meta.ts`
- Test: `test/theme/preset-list.test.ts`
- Test: `test/theme/custom-theme-config.test.ts`

**Interfaces:**
- Produces: `ThemePresetInfo { id; label; description }`, `ThemePreset extends ThemePresetInfo`, and `getPresetList(): ThemePresetInfo[]`.
- Produces: optional `CustomThemeConfig.description`, falling back to `label` during registration.

- [ ] **Step 1: Write failing registry tests**

Assert each built-in preset list item includes its existing ID, label, and description. Assert a custom theme with `description` preserves it, while one without it uses `label`.

```ts
expect(getPresetList()).toContainEqual({
  id: 'default',
  label: '默认「Graphite」',
  description: '白/浅灰/黑灰'
});
```

- [ ] **Step 2: Run registry tests and verify RED**

Run: `pnpm exec vitest run test/theme/preset-list.test.ts test/theme/custom-theme-config.test.ts`

Expected: FAIL because `getPresetList()` does not return `description`.

- [ ] **Step 3: Extend registry and preset registrations**

Add `ThemePresetInfo`, make `ThemePreset` extend it, map all three metadata fields in `getPresetList()`, and add these descriptions directly to each registration:

```ts
default: '白/浅灰/黑灰'
classic: '暖米白/棕色'
shonen: '暖白/朱红/金黄/红黑'
overworld: '纸面/钴蓝天空/墨线像素边/苔藓绿'
```

Delete `meta.ts`, remove its imports/exports, and restore literal IDs and labels in each preset file.

- [ ] **Step 4: Run registry tests and verify GREEN**

Run: `pnpm exec vitest run test/theme/preset-list.test.ts test/theme/custom-theme-config.test.ts`

Expected: PASS.

---

### Task 2: Make Shared Settings Contract Theme-Agnostic

**Files:**
- Modify: `shared/settings/definitions.ts`
- Modify: `shared/ai/tools/SettingsTool/index.ts`
- Modify: `electron/main/modules/chat/runtime/tools/constants.mts`
- Modify: `electron/main/modules/chat/runtime/tools/types.mts`
- Modify: `electron/main/modules/chat/runtime/tools/guards.mts`
- Modify: `electron/main/modules/chat/runtime/tools/SettingsTool/index.mts`
- Test: `test/ai/tools/tool-registry.test.ts`
- Test: `test/ai/tools/builtin-main-process-tool.test.ts`

**Interfaces:**
- Produces: shared `GET_SETTINGS_TOOL_NAME`, `UPDATE_SETTINGS_TOOL_NAME`, `SUPPORTED_SETTING_KEYS`, `SupportedSettingKey`, and generic description formatters.
- Consumers: shared SettingsTool and Electron settings types, guards, and executor import the contract directly.

- [ ] **Step 1: Write failing shared-boundary tests**

Assert SettingsTool descriptions contain `themePresetOptions`, contain no built-in theme IDs or color descriptions, and retain shared setting-key enums. Assert `constants.mts` contains no `SUPPORTED_SETTING_KEYS` import or export.

- [ ] **Step 2: Run tool tests and verify RED**

Run: `pnpm exec vitest run test/ai/tools/tool-registry.test.ts test/ai/tools/builtin-main-process-tool.test.ts`

Expected: FAIL because shared definitions still import theme metadata and Electron constants still re-export setting keys.

- [ ] **Step 3: Remove theme knowledge from shared settings**

Delete the `src/theme` import. Export tool names from `shared/settings/definitions.ts` and use this generic value text:

```ts
themePreset: {
  summary: '主题预设（整套界面色彩氛围）',
  value: '为主题预设 ID，实际可用 ID、名称和描述以 get_settings 返回的 themePresetOptions 为准'
}
```

Import and re-export the tool names from shared SettingsTool so existing registry consumers keep the same API.

- [ ] **Step 4: Remove the Electron constants relay**

Delete the `SUPPORTED_SETTING_KEYS` re-export from `constants.mts`. Import keys/types/tool names directly from `shared/settings/definitions.ts` in `types.mts`, `guards.mts`, and the main-process SettingsTool.

- [ ] **Step 5: Run tool tests and verify GREEN**

Run: `pnpm exec vitest run test/ai/tools/tool-registry.test.ts test/ai/tools/builtin-main-process-tool.test.ts`

Expected: PASS.

---

### Task 3: Carry Theme Descriptions Through Runtime Settings

**Files:**
- Modify: `src/components/BChat/utils/runtimeBridge.ts`
- Modify: `electron/main/modules/chat/runtime/tools/types.mts`
- Modify: `electron/main/modules/chat/runtime/tools/guards.mts`
- Test: `test/components/BChat/runtime-bridge.test.ts`
- Test: `test/components/BChat/use-runtime-settings.test.ts`
- Test: `test/electron/main/modules/chat/runtime/settings-tool.test.ts`

**Interfaces:**
- Extends renderer and main-process `themePresetOptions` items with required `description: string`.
- Preserves conditional `get_settings` output and pre-confirmation ID validation.

- [ ] **Step 1: Write failing runtime description tests**

Update every runtime theme option fixture and assertion to include `description`. Verify custom theme descriptions returned by `useRuntimeSettings()` and `get_settings` survive unchanged.

- [ ] **Step 2: Run runtime tests and verify RED**

Run: `pnpm exec vitest run test/components/BChat/runtime-bridge.test.ts test/components/BChat/use-runtime-settings.test.ts test/electron/main/modules/chat/runtime/settings-tool.test.ts`

Expected: FAIL because runtime option types and registry output omit descriptions.

- [ ] **Step 3: Extend runtime option types and guards**

Add `description: string` to `BChatRuntimeThemePresetOption` and `RuntimeThemePresetOption`. Require a non-empty description in `isRuntimeThemePresetOption()`.

- [ ] **Step 4: Run runtime tests and verify GREEN**

Run: `pnpm exec vitest run test/components/BChat/runtime-bridge.test.ts test/components/BChat/use-runtime-settings.test.ts test/electron/main/modules/chat/runtime/settings-tool.test.ts`

Expected: PASS.

---

### Task 4: Update Documentation And Verify

**Files:**
- Modify: `docs/development/theme-development.md`
- Modify: `changelog/2026-08-10.md`

**Interfaces:**
- Documents preset-owned descriptions, theme-agnostic SettingsTool definitions, and runtime custom-theme discovery.

- [ ] **Step 1: Update documentation and changelog**

Remove all references to `src/theme/presets/meta.ts`. Document `description` beside `id` and `label` in `registerPreset()`. State that SettingsTool reads no concrete theme list and that `get_settings.themePresetOptions` is authoritative.

- [ ] **Step 2: Run focused tests**

Run: `pnpm exec vitest run test/theme/preset-list.test.ts test/theme/custom-theme-config.test.ts test/ai/tools/tool-registry.test.ts test/ai/tools/builtin-main-process-tool.test.ts test/components/BChat/runtime-bridge.test.ts test/components/BChat/use-runtime-settings.test.ts test/electron/main/modules/chat/runtime/settings-tool.test.ts`

Expected: PASS.

- [ ] **Step 3: Run static verification**

Run targeted ESLint on changed TypeScript files, then run `pnpm exec tsc --noEmit` and `pnpm run electron:build-main`.

Expected: all commands exit 0 with no warnings or errors.

- [ ] **Step 4: Review final working tree**

Run `git diff --check` and `git status --short`. Confirm `src/theme/presets/meta.ts` is absent, `constants.mts` has no settings-key relay, and no commit was created.
