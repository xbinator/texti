# Editor Page Width Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted editor page-width setting with `default` / `wide` / `full` modes, wire it into the in-app view menu, system menu, and AI settings tool, and make it affect only the BEditor content column.

**Architecture:** Keep `src/stores/setting.ts` as the single source of truth. The editor shell reads `editorPageWidth` and maps it to a component-local CSS variable, while menu actions and AI settings changes all flow through `settingStore.setEditorPageWidth()`. Tests should cover store persistence, editor rendering, menu action dispatch, and AI settings validation.

**Tech Stack:** Vue 3, Pinia, TypeScript, Electron menu templates, Vitest, Vue Test Utils.

---

### Task 1: Extend setting store for editor page width

**Files:**
- Modify: `<project>/src/stores/setting.ts`
- Test: `<project>/test/stores/setting.test.ts`

- [ ] **Step 1: Write the failing store tests**

Add these test cases to `<project>/test/stores/setting.test.ts`:

```ts
  it('persists editor page width into app settings', async () => {
    const { useSettingStore } = await import('@/stores/setting');
    const settingStore = useSettingStore();

    settingStore.setEditorPageWidth('wide');

    expect(settingStore.editorPageWidth).toBe('wide');
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toContain('"editorPageWidth":"wide"');
  });

  it('restores editor page width from persisted app settings', async () => {
    const { local } = await import('@/shared/storage/base');

    local.setItem(SETTINGS_STORAGE_KEY, {
      chatSidebarActiveSessionId: null,
      providerSidebarCollapsed: false,
      settingsSidebarCollapsed: false,
      theme: 'system',
      showOutline: true,
      sourceMode: false,
      editorPageWidth: 'full',
      sidebarVisible: false,
      sidebarWidth: 340,
      toolPermissionMode: 'ask',
      alwaysToolPermissionGrants: {}
    });

    const { useSettingStore } = await import('@/stores/setting');
    const settingStore = useSettingStore();

    expect(settingStore.editorPageWidth).toBe('full');
  });

  it('falls back to default editor page width when persisted value is invalid', async () => {
    const { local } = await import('@/shared/storage/base');

    local.setItem(SETTINGS_STORAGE_KEY, {
      chatSidebarActiveSessionId: null,
      providerSidebarCollapsed: false,
      settingsSidebarCollapsed: false,
      theme: 'system',
      showOutline: true,
      sourceMode: false,
      editorPageWidth: 'giant',
      sidebarVisible: false,
      sidebarWidth: 340,
      toolPermissionMode: 'ask',
      alwaysToolPermissionGrants: {}
    });

    const { useSettingStore } = await import('@/stores/setting');
    const settingStore = useSettingStore();

    expect(settingStore.editorPageWidth).toBe('default');
  });
```

- [ ] **Step 2: Run the store test file to confirm failure**

Run:

```bash
pnpm test -- test/stores/setting.test.ts
```

Expected: `FAIL` because `editorPageWidth` and `setEditorPageWidth` do not exist yet.

- [ ] **Step 3: Implement the store state, normalization, and action**

Update `<project>/src/stores/setting.ts` with these changes:

```ts
export type EditorPageWidth = 'default' | 'wide' | 'full';

interface PersistedSettingState {
  // ...
  editorPageWidth: EditorPageWidth;
  // ...
}

const DEFAULT_SETTINGS: PersistedSettingState = {
  chatSidebarActiveSessionId: null,
  providerSidebarCollapsed: false,
  settingsSidebarCollapsed: false,
  theme: 'system',
  showOutline: true,
  sourceMode: false,
  editorPageWidth: 'default',
  sidebarVisible: false,
  sidebarWidth: 340,
  toolPermissionMode: 'ask',
  alwaysToolPermissionGrants: {}
};

function isEditorPageWidth(value: unknown): value is EditorPageWidth {
  return value === 'default' || value === 'wide' || value === 'full';
}

function normalizeSettings(value: unknown): PersistedSettingState {
  // existing normalization
  if (!isEditorPageWidth(normalized.editorPageWidth)) {
    normalized.editorPageWidth = DEFAULT_SETTINGS.editorPageWidth;
  }
  return normalized;
}

syncNativeMenuState(): void {
  native.updateMenuItem?.('view:source', { checked: this.sourceMode });
  native.updateMenuItem?.('view:outline', { checked: this.showOutline });
  native.updateMenuItem?.('theme:light', { checked: this.theme === 'light' });
  native.updateMenuItem?.('theme:dark', { checked: this.theme === 'dark' });
  native.updateMenuItem?.('theme:system', { checked: this.theme === 'system' });
  native.updateMenuItem?.('view:pageWidth:default', { checked: this.editorPageWidth === 'default' });
  native.updateMenuItem?.('view:pageWidth:wide', { checked: this.editorPageWidth === 'wide' });
  native.updateMenuItem?.('view:pageWidth:full', { checked: this.editorPageWidth === 'full' });
}

persistSettings(): void {
  const settings: PersistedSettingState = {
    chatSidebarActiveSessionId: this.chatSidebarActiveSessionId,
    providerSidebarCollapsed: this.providerSidebarCollapsed,
    settingsSidebarCollapsed: this.settingsSidebarCollapsed,
    theme: this.theme,
    showOutline: this.showOutline,
    sourceMode: this.sourceMode,
    editorPageWidth: this.editorPageWidth,
    sidebarVisible: this.sidebarVisible,
    sidebarWidth: this.sidebarWidth,
    toolPermissionMode: this.toolPermissionMode,
    alwaysToolPermissionGrants: this.alwaysToolPermissionGrants
  };
  local.setItem(SETTINGS_STORAGE_KEY, settings);
}

setEditorPageWidth(width: EditorPageWidth): void {
  this.editorPageWidth = width;
  this.persistSettings();
  this.syncNativeMenuState();
}
```

- [ ] **Step 4: Re-run the store test file**

Run:

```bash
pnpm test -- test/stores/setting.test.ts
```

Expected: `PASS`.

- [ ] **Step 5: Commit the store slice**

Run:

```bash
git add src/stores/setting.ts test/stores/setting.test.ts
git commit -m "feat: add editor page width setting store"
```

---

### Task 2: Apply page width to BEditor content column

**Files:**
- Modify: `<project>/src/components/BEditor/index.vue`
- Test: `<project>/test/components/BEditor/index.page-width.test.ts`

- [ ] **Step 1: Write the failing BEditor rendering test**

Create `<project>/test/components/BEditor/index.page-width.test.ts`:

```ts
/**
 * @file index.page-width.test.ts
 * @description 验证 BEditor 正文区页宽设置映射。
 */
/* @vitest-environment jsdom */

import { createPinia, setActivePinia } from 'pinia';
import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import BEditor from '@/components/BEditor/index.vue';
import { useSettingStore } from '@/stores/setting';

const storage = new Map<string, string>();

globalThis.localStorage = {
  getItem(key: string): string | null {
    return storage.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    storage.set(key, value);
  },
  removeItem(key: string): void {
    storage.delete(key);
  },
  clear(): void {
    storage.clear();
  }
} as Storage;

const ScrollbarStub = defineComponent({
  name: 'BScrollbar',
  template: '<div class="scrollbar-stub"><slot /></div>'
});

function mountEditor() {
  return mount(BEditor, {
    props: { value: '# Title', title: 'Doc' },
    global: {
      stubs: {
        BScrollbar: ScrollbarStub,
        BEditorSidebar: true,
        FindBar: true,
        PaneRichEditor: true,
        PaneSourceEditor: true
      }
    }
  });
}

describe('BEditor page width', () => {
  beforeEach(() => {
    storage.clear();
    setActivePinia(createPinia());
  });

  it('uses 900px max width in default mode', () => {
    const wrapper = mountEditor();
    expect(wrapper.find('.b-editor-container').attributes('style')).toContain('--editor-page-max-width: 900px');
  });

  it('uses 1200px max width in wide mode', () => {
    const settingStore = useSettingStore();
    settingStore.setEditorPageWidth('wide');

    const wrapper = mountEditor();
    expect(wrapper.find('.b-editor-container').attributes('style')).toContain('--editor-page-max-width: 1200px');
  });

  it('uses none max width in full mode', () => {
    const settingStore = useSettingStore();
    settingStore.setEditorPageWidth('full');

    const wrapper = mountEditor();
    expect(wrapper.find('.b-editor-container').attributes('style')).toContain('--editor-page-max-width: none');
  });
});
```

- [ ] **Step 2: Run the BEditor test to confirm failure**

Run:

```bash
pnpm test -- test/components/BEditor/index.page-width.test.ts
```

Expected: `FAIL` because the component still hardcodes `max-width: 900px`.

- [ ] **Step 3: Implement the BEditor width mapping**

Update `<project>/src/components/BEditor/index.vue`:

```ts
import type { CSSProperties } from 'vue';
import { computed, defineAsyncComponent, ref } from 'vue';
import { useSettingStore } from '@/stores/setting';

const settingStore = useSettingStore();

const editorPageMaxWidth = computed<string>(() => {
  switch (settingStore.editorPageWidth) {
    case 'wide':
      return '1200px';
    case 'full':
      return 'none';
    default:
      return '900px';
  }
});

const editorContainerStyle = computed<CSSProperties>(() => ({
  '--editor-page-max-width': editorPageMaxWidth.value
}));
```

Bind the style in template and update the style rule:

```vue
<div class="b-editor-container" :style="editorContainerStyle">
```

```less
.b-editor-container {
  position: relative;
  max-width: var(--editor-page-max-width);
  padding: 20px 40px 90px;
  margin: 0 auto;
  font-size: 16px;
}
```

Add file header and JSDoc comments where they are missing while touching the script, to match repo rules.

- [ ] **Step 4: Re-run the BEditor test**

Run:

```bash
pnpm test -- test/components/BEditor/index.page-width.test.ts
```

Expected: `PASS`.

- [ ] **Step 5: Commit the editor UI slice**

Run:

```bash
git add src/components/BEditor/index.vue test/components/BEditor/index.page-width.test.ts
git commit -m "feat: add editor page width rendering"
```

---

### Task 3: Wire page width into view menu and system menu actions

**Files:**
- Modify: `<project>/src/layouts/default/hooks/useViewActive.ts`
- Modify: `<project>/src/hooks/useMenuAction.ts`
- Modify: `<project>/electron/main/modules/menu/service.mts`
- Test: `<project>/test/hooks/useMenuAction.test.ts`

- [ ] **Step 1: Write the failing menu action test**

Create `<project>/test/hooks/useMenuAction.test.ts`:

```ts
/**
 * @file useMenuAction.test.ts
 * @description 验证系统菜单 action 能切换编辑器页宽。
 */
/* @vitest-environment jsdom */

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const menuCallbacks: Array<(action: string) => void> = [];

vi.mock('@/shared/platform', () => ({
  native: {
    onMenuAction(callback: (action: string) => void) {
      menuCallbacks.push(callback);
      return () => undefined;
    },
    updateMenuItem: vi.fn(),
    setWindowTitle: vi.fn(async () => undefined)
  }
}));

describe('useMenuAction', () => {
  beforeEach(() => {
    menuCallbacks.length = 0;
    setActivePinia(createPinia());
  });

  it('maps page-width menu actions to setting store updates', async () => {
    const { useMenuAction } = await import('@/hooks/useMenuAction');
    const { useSettingStore } = await import('@/stores/setting');

    useMenuAction();
    const settingStore = useSettingStore();

    menuCallbacks[0]('view:pageWidth:wide');
    expect(settingStore.editorPageWidth).toBe('wide');

    menuCallbacks[0]('view:pageWidth:full');
    expect(settingStore.editorPageWidth).toBe('full');

    menuCallbacks[0]('view:pageWidth:default');
    expect(settingStore.editorPageWidth).toBe('default');
  });
});
```

- [ ] **Step 2: Run the menu action test to confirm failure**

Run:

```bash
pnpm test -- test/hooks/useMenuAction.test.ts
```

Expected: `FAIL` because the new page-width actions are not handled yet.

- [ ] **Step 3: Implement view menu, system menu, and action dispatch**

Update `<project>/src/layouts/default/hooks/useViewActive.ts` by adding a page-width submenu next to theme:

```ts
    {
      value: 'page-width',
      label: '页宽',
      selected: false,
      children: [
        {
          value: 'default',
          label: '默认',
          selected: settingStore.editorPageWidth === 'default',
          onClick: () => {
            settingStore.setEditorPageWidth('default');
          }
        },
        {
          value: 'wide',
          label: '较宽',
          selected: settingStore.editorPageWidth === 'wide',
          onClick: () => {
            settingStore.setEditorPageWidth('wide');
          }
        },
        {
          value: 'full',
          label: '全宽',
          selected: settingStore.editorPageWidth === 'full',
          onClick: () => {
            settingStore.setEditorPageWidth('full');
          }
        }
      ]
    },
```

Update `<project>/src/hooks/useMenuAction.ts`:

```ts
      case 'view:pageWidth:default':
        settingStore.setEditorPageWidth('default');
        break;
      case 'view:pageWidth:wide':
        settingStore.setEditorPageWidth('wide');
        break;
      case 'view:pageWidth:full':
        settingStore.setEditorPageWidth('full');
        break;
```

Update `<project>/electron/main/modules/menu/service.mts`:

```ts
      {
        label: '页宽',
        submenu: [
          { id: 'view:pageWidth:default', type: 'checkbox', label: '默认', click: () => sendMenuAction('view:pageWidth:default') },
          { id: 'view:pageWidth:wide', type: 'checkbox', label: '较宽', click: () => sendMenuAction('view:pageWidth:wide') },
          { id: 'view:pageWidth:full', type: 'checkbox', label: '全宽', click: () => sendMenuAction('view:pageWidth:full') }
        ]
      },
```

Add file header comments and explicit return types to touched functions where missing.

- [ ] **Step 4: Re-run the menu action test**

Run:

```bash
pnpm test -- test/hooks/useMenuAction.test.ts
```

Expected: `PASS`.

- [ ] **Step 5: Commit the menu integration slice**

Run:

```bash
git add src/layouts/default/hooks/useViewActive.ts src/hooks/useMenuAction.ts electron/main/modules/menu/service.mts test/hooks/useMenuAction.test.ts
git commit -m "feat: add page width menu controls"
```

---

### Task 4: Extend AI settings tool for editor page width

**Files:**
- Modify: `<project>/src/ai/tools/builtin/settings.ts`
- Test: `<project>/test/ai/tools/builtin-settings.test.ts`

- [ ] **Step 1: Write the failing AI settings tests**

Add these test cases to `<project>/test/ai/tools/builtin-settings.test.ts`:

```ts
  it('updates editor page width after confirmation', async () => {
    const confirm = vi.fn(async () => ({ approved: true }));
    const tools = createBuiltinSettingsTools({ confirm });
    const settingStore = useSettingStore();

    const result = await tools.updateSettings.execute({ key: 'editorPageWidth', value: 'wide' }, createToolContext());

    expect(result.status).toBe('success');
    expect(settingStore.editorPageWidth).toBe('wide');
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        beforeText: 'editorPageWidth: default',
        afterText: 'editorPageWidth: wide'
      })
    );
  });

  it('rejects invalid editor page width values before confirmation', async () => {
    const confirm = vi.fn(async () => ({ approved: true }));
    const tools = createBuiltinSettingsTools({ confirm });

    const result = await tools.updateSettings.execute({ key: 'editorPageWidth', value: 'ultra' }, createToolContext());

    expect(result.status).toBe('failure');
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('returns editor page width from get_settings', async () => {
    const tools = createBuiltinSettingsTools({ confirm: vi.fn(async () => ({ approved: true })) });
    const settingStore = useSettingStore();

    settingStore.setEditorPageWidth('full');

    const result = await tools.getSettings.execute({ keys: 'editorPageWidth' }, createToolContext());

    expect(result.status).toBe('success');
    expect(result.data?.settings.editorPageWidth).toBe('full');
  });
```

- [ ] **Step 2: Run the built-in settings test file to confirm failure**

Run:

```bash
pnpm test -- test/ai/tools/builtin-settings.test.ts
```

Expected: `FAIL` because `editorPageWidth` is not in the supported key or validation paths.

- [ ] **Step 3: Implement AI settings tool support**

Update `<project>/src/ai/tools/builtin/settings.ts`:

```ts
import type { EditorPageWidth, ThemeMode } from '@/stores/setting';

const SUPPORTED_SETTING_KEYS = ['theme', 'showOutline', 'sourceMode', 'editorPageWidth'] as const;

function isEditorPageWidth(value: unknown): value is EditorPageWidth {
  return value === 'default' || value === 'wide' || value === 'full';
}

function validateSettingsInput(input: UpdateSettingsInput): UpdateSettingsInput | string {
  if (input.key === 'theme') {
    return isThemeMode(input.value) ? input : 'theme 只能设置为 dark、light 或 system。';
  }

  if (input.key === 'editorPageWidth') {
    return isEditorPageWidth(input.value) ? input : 'editorPageWidth 只能设置为 default、wide 或 full。';
  }

  if (isBooleanSettingKey(input.key)) {
    return typeof input.value === 'boolean' ? input : `${input.key} 必须设置为布尔值。`;
  }

  return '不支持修改该设置项。';
}

function applySettingValue(input: UpdateSettingsInput): void {
  const settingStore = useSettingStore();

  if (input.key === 'editorPageWidth' && isEditorPageWidth(input.value)) {
    settingStore.setEditorPageWidth(input.value);
    return;
  }

  // existing theme/showOutline/sourceMode branches
}
```

Update the tool descriptions so they mention page width in both `update_settings` and `get_settings`.

- [ ] **Step 4: Re-run the built-in settings test file**

Run:

```bash
pnpm test -- test/ai/tools/builtin-settings.test.ts
```

Expected: `PASS`.

- [ ] **Step 5: Commit the AI settings slice**

Run:

```bash
git add src/ai/tools/builtin/settings.ts test/ai/tools/builtin-settings.test.ts
git commit -m "feat: add editor page width ai setting"
```

---

### Task 5: Full verification, docs sync, and final commit

**Files:**
- Modify: `<project>/changelog/2026-04-30.md`
- Verify: `<project>/src/stores/setting.ts`
- Verify: `<project>/src/components/BEditor/index.vue`
- Verify: `<project>/src/layouts/default/hooks/useViewActive.ts`
- Verify: `<project>/src/hooks/useMenuAction.ts`
- Verify: `<project>/electron/main/modules/menu/service.mts`
- Verify: `<project>/src/ai/tools/builtin/settings.ts`

- [ ] **Step 1: Update changelog for the implementation**

Add this line under `## Changed` in `<project>/changelog/2026-04-30.md`:

```md
- 为编辑器新增正文页宽设置，支持默认、较宽、全宽三档，并打通视图菜单、系统菜单和 AI 设置工具。
```

- [ ] **Step 2: Run focused verification tests**

Run:

```bash
pnpm test -- test/stores/setting.test.ts test/components/BEditor/index.page-width.test.ts test/hooks/useMenuAction.test.ts test/ai/tools/builtin-settings.test.ts
```

Expected: all four test files `PASS`.

- [ ] **Step 3: Run lint on touched source files**

Run:

```bash
pnpm exec eslint src/stores/setting.ts src/components/BEditor/index.vue src/layouts/default/hooks/useViewActive.ts src/hooks/useMenuAction.ts src/ai/tools/builtin/settings.ts --ext .ts,.vue
```

Expected: `0 problems`.

- [ ] **Step 4: Review the final diff**

Run:

```bash
git diff -- src/stores/setting.ts src/components/BEditor/index.vue src/layouts/default/hooks/useViewActive.ts src/hooks/useMenuAction.ts electron/main/modules/menu/service.mts src/ai/tools/builtin/settings.ts test/stores/setting.test.ts test/components/BEditor/index.page-width.test.ts test/hooks/useMenuAction.test.ts test/ai/tools/builtin-settings.test.ts changelog/2026-04-30.md
```

Expected: only the planned page-width changes and required comment/type updates appear.

- [ ] **Step 5: Commit the final integrated change**

Run:

```bash
git add src/stores/setting.ts src/components/BEditor/index.vue src/layouts/default/hooks/useViewActive.ts src/hooks/useMenuAction.ts electron/main/modules/menu/service.mts src/ai/tools/builtin/settings.ts test/stores/setting.test.ts test/components/BEditor/index.page-width.test.ts test/hooks/useMenuAction.test.ts test/ai/tools/builtin-settings.test.ts changelog/2026-04-30.md
git commit -m "feat: add editor page width setting"
```

---

## Self-review

- Spec coverage check:
  - `settingStore` single source of truth: Task 1
  - BEditor正文区宽度映射: Task 2
  - 应用内视图菜单和系统菜单: Task 3
  - AI settings tool: Task 4
  - changelog and end-to-end verification: Task 5
- Placeholder scan: no `TODO`/`TBD`/“write tests later” placeholders remain.
- Type consistency check:
  - Setting key name is consistently `editorPageWidth`
  - Store action name is consistently `setEditorPageWidth`
  - Menu action ids are consistently `view:pageWidth:default|wide|full`
  - Width values are consistently `default|wide|full`
