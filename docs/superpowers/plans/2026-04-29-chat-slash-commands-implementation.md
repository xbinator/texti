# Chat Slash Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add line-start slash commands to the chat sidebar input, supporting `/model`, `/usage`, `/new`, and `/clear` without sending slash text as a chat message.

**Architecture:** Keep `BPromptEditor` responsible for slash trigger detection, menu rendering, filtering, and keyboard selection, while keeping chat-specific execution in `BChatSidebar`. Reuse the existing model selector surface via a programmatic `open()` entry point, and read persisted session usage for the `/usage` panel with explicit loading, empty, and error states.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, CodeMirror 6, Pinia, Vitest

---

## File Structure

### Existing files to modify

- `G:/code/ai/tibis/src/components/BPromptEditor/index.vue`
  Responsibility: host the CodeMirror instance, variable trigger UI, keyboard handling, and exposed editor methods. This will gain slash trigger state, slash menu rendering, command filtering, and a `slash-command` emit.
- `G:/code/ai/tibis/src/components/BPromptEditor/types.ts`
  Responsibility: public prop and type contracts for `BPromptEditor`. This will gain slash-command option types and a new optional `slashCommands` prop contract.
- `G:/code/ai/tibis/src/components/BChatSidebar/index.vue`
  Responsibility: own chat session state, input state, toolbar wiring, and command execution. This will gain slash command registry wiring, `/model`/`/usage`/`/new`/`/clear` handlers, and usage panel state.
- `G:/code/ai/tibis/src/components/BChatSidebar/components/InputToolbar/ModelSelector.vue`
  Responsibility: render the existing model dropdown and persist selection changes. This will gain an exposed `open()` method for reuse by `/model`.
- `G:/code/ai/tibis/test/components/BPromptEditor/BPromptEditorRegression.test.ts`
  Responsibility: regression coverage for editor integration. This will gain assertions that the slash menu takes priority over submit and that no-command mode falls back to plain text.

### New files to create

- `G:/code/ai/tibis/src/components/BPromptEditor/components/SlashCommandSelect.vue`
  Responsibility: render the slash command list above the editor, including active-row highlighting and command descriptions.
- `G:/code/ai/tibis/src/components/BChatSidebar/components/UsagePanel.vue`
  Responsibility: render the `/usage` panel content for loading, data, empty, and inline error states with a stable minimum height.
- `G:/code/ai/tibis/src/components/BChatSidebar/utils/slashCommands.ts`
  Responsibility: export the shared chat sidebar slash command registry as metadata-only data.
- `G:/code/ai/tibis/test/components/BPromptEditor/BPromptEditorSlashCommands.test.ts`
  Responsibility: focused slash-trigger behavior tests for line-start detection, filtering, keyboard navigation, command selection, and submit override.
- `G:/code/ai/tibis/test/components/BChatSidebar/chat-slash-commands.test.ts`
  Responsibility: sidebar-level command execution tests for `/new`, `/clear`, `/model`, and `/usage`.

### Optional follow-up if storage read helper is needed

- `G:/code/ai/tibis/src/stores/chat.ts`
  Responsibility: expose a small read helper for persisted session usage if `BChatSidebar` should not read storage directly.
- `G:/code/ai/tibis/test/stores/chat.test.ts`
  Responsibility: cover the new usage read helper if one is added.

## Task 1: Add Shared Slash Command Types And Registry

**Files:**
- Modify: `G:/code/ai/tibis/src/components/BPromptEditor/types.ts`
- Create: `G:/code/ai/tibis/src/components/BChatSidebar/utils/slashCommands.ts`
- Test: `G:/code/ai/tibis/test/components/BChatSidebar/chat-slash-commands.test.ts`

- [ ] **Step 1: Write the failing registry test**

```ts
/**
 * @file chat-slash-commands.test.ts
 * @description 聊天侧边栏 slash 命令注册表测试。
 */
import { describe, expect, it } from 'vitest';
import { chatSlashCommands } from '@/components/BChatSidebar/utils/slashCommands';

describe('chatSlashCommands', () => {
  it('exports the first-version action commands in trigger order', () => {
    expect(chatSlashCommands.map((command) => command.trigger)).toEqual(['/model', '/usage', '/new', '/clear']);
    expect(chatSlashCommands.every((command) => command.type === 'action')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/components/BChatSidebar/chat-slash-commands.test.ts`

Expected: FAIL with a module resolution error for `@/components/BChatSidebar/utils/slashCommands`.

- [ ] **Step 3: Write minimal type and registry implementation**

```ts
/**
 * @file slashCommands.ts
 * @description 聊天侧边栏 slash 命令注册表。
 */
import type { SlashCommandOption } from '@/components/BPromptEditor/types';

/**
 * 聊天侧边栏默认 slash 命令。
 */
export const chatSlashCommands: SlashCommandOption[] = [
  { id: 'model', trigger: '/model', title: 'Model', description: 'Open the model selector', type: 'action' },
  { id: 'usage', trigger: '/usage', title: 'Usage', description: 'Show current session token usage', type: 'action' },
  { id: 'new', trigger: '/new', title: 'New Chat', description: 'Create a new session', type: 'action' },
  { id: 'clear', trigger: '/clear', title: 'Clear Input', description: 'Clear the current draft input', type: 'action' }
];
```

```ts
/**
 * Slash 命令选项。
 */
export interface SlashCommandOption {
  /** 稳定命令 ID */
  id: string;
  /** 完整触发词，例如 /model */
  trigger: string;
  /** 面板标题 */
  title: string;
  /** 面板说明 */
  description: string;
  /** 命令类型 */
  type: 'action' | 'prompt';
}

export interface BPromptEditorProps {
  // ...
  /** slash 命令列表，未提供时禁用 slash 触发 */
  slashCommands?: SlashCommandOption[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/components/BChatSidebar/chat-slash-commands.test.ts`

Expected: PASS with 1 passing test.

- [ ] **Step 5: Commit**

```bash
git add src/components/BPromptEditor/types.ts src/components/BChatSidebar/utils/slashCommands.ts test/components/BChatSidebar/chat-slash-commands.test.ts
git commit -m "feat(chat): add slash command registry"
```

## Task 2: Add Focused Editor Slash Trigger Tests

**Files:**
- Create: `G:/code/ai/tibis/test/components/BPromptEditor/BPromptEditorSlashCommands.test.ts`
- Modify: `G:/code/ai/tibis/test/components/BPromptEditor/BPromptEditorRegression.test.ts`

- [ ] **Step 1: Write the failing slash trigger tests**

```ts
/**
 * @file BPromptEditorSlashCommands.test.ts
 * @description BPromptEditor slash 命令交互测试。
 */
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import BPromptEditor from '@/components/BPromptEditor/index.vue';
import { chatSlashCommands } from '@/components/BChatSidebar/utils/slashCommands';

describe('BPromptEditor slash commands', () => {
  it('opens the slash menu only at line start', async () => {
    const wrapper = mount(BPromptEditor, {
      props: {
        value: '/',
        slashCommands: chatSlashCommands
      }
    });

    expect(wrapper.findComponent({ name: 'SlashCommandSelect' }).exists()).toBe(true);

    await wrapper.setProps({ value: 'hello /model' });

    expect(wrapper.findComponent({ name: 'SlashCommandSelect' }).exists()).toBe(false);
  });

  it('treats slash as plain text when no commands are provided', async () => {
    const wrapper = mount(BPromptEditor, {
      props: {
        value: '/'
      }
    });

    expect(wrapper.findComponent({ name: 'SlashCommandSelect' }).exists()).toBe(false);
  });
});
```

```ts
it('prefers slash selection over submit when the slash menu is open', () => {
  const source = readSource('src/components/BPromptEditor/index.vue');

  expect(source).toContain('if (slashMenuVisible.value)');
  expect(source).toContain("emit('slash-command'");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/components/BPromptEditor/BPromptEditorSlashCommands.test.ts test/components/BPromptEditor/BPromptEditorRegression.test.ts`

Expected: FAIL because `SlashCommandSelect` and slash-command logic do not exist yet.

- [ ] **Step 3: Implement the editor-facing test scaffolding**

```ts
const emit = defineEmits<{
  (e: 'change', value: string): void;
  (e: 'submit'): void;
  (e: 'slash-command', command: SlashCommandOption): void;
}>();
```

```ts
const props = withDefaults(defineProps<Props>(), {
  placeholder: '请输入内容...',
  options: () => [],
  slashCommands: () => [],
  disabled: false,
  maxHeight: undefined,
  submitOnEnter: false,
  chipResolver: undefined,
  onPasteFiles: undefined
});
```

- [ ] **Step 4: Run tests to verify they still fail for the right reason**

Run: `pnpm exec vitest run test/components/BPromptEditor/BPromptEditorSlashCommands.test.ts test/components/BPromptEditor/BPromptEditorRegression.test.ts`

Expected: FAIL with missing slash menu rendering and keyboard behavior, but no TypeScript contract errors.

- [ ] **Step 5: Commit**

```bash
git add test/components/BPromptEditor/BPromptEditorSlashCommands.test.ts test/components/BPromptEditor/BPromptEditorRegression.test.ts src/components/BPromptEditor/types.ts
git commit -m "test(editor): add slash command regression coverage"
```

## Task 3: Implement Slash Menu UI And Editor Trigger Behavior

**Files:**
- Create: `G:/code/ai/tibis/src/components/BPromptEditor/components/SlashCommandSelect.vue`
- Modify: `G:/code/ai/tibis/src/components/BPromptEditor/index.vue`
- Test: `G:/code/ai/tibis/test/components/BPromptEditor/BPromptEditorSlashCommands.test.ts`
- Test: `G:/code/ai/tibis/test/components/BPromptEditor/BPromptEditorRegression.test.ts`

- [ ] **Step 1: Write the remaining failing interaction assertions**

```ts
it('emits the selected slash command and removes the active slash text', async () => {
  const wrapper = mount(BPromptEditor, {
    props: {
      value: '/mo',
      slashCommands: chatSlashCommands
    }
  });

  await wrapper.findComponent({ name: 'SlashCommandSelect' }).vm.$emit('select', chatSlashCommands[0]);

  expect(wrapper.emitted('slash-command')?.[0]?.[0]).toMatchObject({ id: 'model' });
  expect(wrapper.emitted('change')?.at(-1)?.[0]).toBe('');
});
```

```ts
it('filters slash commands by trigger prefix', async () => {
  const wrapper = mount(BPromptEditor, {
    props: {
      value: '/mo',
      slashCommands: chatSlashCommands
    }
  });

  const select = wrapper.findComponent({ name: 'SlashCommandSelect' });
  expect(select.props('commands')).toHaveLength(1);
  expect(select.props('commands')[0]).toMatchObject({ id: 'model' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/components/BPromptEditor/BPromptEditorSlashCommands.test.ts test/components/BPromptEditor/BPromptEditorRegression.test.ts`

Expected: FAIL because the editor does not yet compute slash ranges, prefix filtering, or removal of the active slash range.

- [ ] **Step 3: Write minimal slash menu implementation**

```vue
<template>
  <div v-if="visible" class="slash-command-select" :style="{ left: `${position.left}px`, bottom: `${position.bottom}px` }">
    <button
      v-for="(command, index) in commands"
      :key="command.id"
      type="button"
      class="slash-command-select__item"
      :class="{ 'is-active': index === activeIndex }"
      @mousedown.prevent="$emit('select', command)"
    >
      <span class="slash-command-select__title">{{ command.trigger }}</span>
      <span class="slash-command-select__description">{{ command.description }}</span>
    </button>
  </div>
</template>
```

```ts
interface SlashRange {
  from: number;
  to: number;
  query: string;
}

function getActiveSlashRange(editorView: EditorView): SlashRange | null {
  if (!props.slashCommands.length) return null;
  const selection = editorView.state.selection.main;
  if (!selection.empty) return null;

  const line = editorView.state.doc.lineAt(selection.head);
  const textBeforeCursor = line.text.slice(0, selection.head - line.from);
  const match = textBeforeCursor.match(/^\/([^\s]*)$/);
  if (!match) return null;

  return {
    from: line.from,
    to: selection.head,
    query: match[1] ?? ''
  };
}
```

```ts
const slashMenuVisible = ref(false);
const slashMenuPosition = ref({ left: 0, bottom: 12 });
const slashActiveIndex = ref(0);
const slashRange = ref<SlashRange | null>(null);

const filteredSlashCommands = computed<SlashCommandOption[]>(() => {
  if (!props.slashCommands.length) return [];
  const query = slashRange.value?.query.toLowerCase() ?? '';
  return props.slashCommands.filter((command) => command.trigger.slice(1).toLowerCase().startsWith(query));
});

function selectSlashCommand(command: SlashCommandOption): void {
  if (!view.value || !slashRange.value) return;

  view.value.dispatch({
    changes: { from: slashRange.value.from, to: slashRange.value.to, insert: '' }
  });
  modelValue.value = view.value.state.doc.toString();
  emit('slash-command', command);
}
```

```ts
{
  key: 'Enter',
  run: () => {
    if (slashMenuVisible.value && filteredSlashCommands.value.length > 0) {
      const command = filteredSlashCommands.value[slashActiveIndex.value];
      if (command) {
        selectSlashCommand(command);
        return true;
      }
    }
    if (triggerVisible.value && filteredVariables.value.length > 0) {
      // existing variable selection branch
    }
    if (props.submitOnEnter) {
      emit('submit');
      return true;
    }
    return false;
  }
}
```

- [ ] **Step 4: Run editor tests to verify they pass**

Run: `pnpm exec vitest run test/components/BPromptEditor/BPromptEditorSlashCommands.test.ts test/components/BPromptEditor/BPromptEditorRegression.test.ts`

Expected: PASS with slash trigger, prefix filtering, menu selection, and submit override behavior covered.

- [ ] **Step 5: Commit**

```bash
git add src/components/BPromptEditor/components/SlashCommandSelect.vue src/components/BPromptEditor/index.vue test/components/BPromptEditor/BPromptEditorSlashCommands.test.ts test/components/BPromptEditor/BPromptEditorRegression.test.ts
git commit -m "feat(editor): add slash command menu"
```

## Task 4: Add Programmatic Model Selector Open Support

**Files:**
- Modify: `G:/code/ai/tibis/src/components/BChatSidebar/components/InputToolbar/ModelSelector.vue`
- Test: `G:/code/ai/tibis/test/components/BChatSidebar/chat-slash-commands.test.ts`

- [ ] **Step 1: Write the failing model selector open-path test**

```ts
it('opens the shared model selector surface when /model executes', async () => {
  const open = vi.fn();
  const wrapper = mount(BChatSidebar, {
    global: {
      stubs: {
        ModelSelector: {
          template: '<div />',
          setup(_props, { expose }) {
            expose({ open });
            return {};
          }
        }
      }
    }
  });

  await wrapper.findComponent({ name: 'BPromptEditor' }).vm.$emit('slash-command', { id: 'model', trigger: '/model', title: 'Model', description: '', type: 'action' });

  expect(open).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/components/BChatSidebar/chat-slash-commands.test.ts`

Expected: FAIL because `ModelSelector` does not expose an `open()` method and `BChatSidebar` does not call it.

- [ ] **Step 3: Add the minimal programmatic open implementation**

```ts
const open = ref(false);

defineExpose({
  open: () => {
    open.value = true;
  }
});
```

```ts
const modelSelectorRef = ref<InstanceType<typeof ModelSelector>>();

function handleSlashCommand(command: SlashCommandOption): void {
  const handlers: Record<string, () => void | Promise<void>> = {
    model: () => {
      modelSelectorRef.value?.open();
    }
  };

  void handlers[command.id]?.();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/components/BChatSidebar/chat-slash-commands.test.ts`

Expected: PASS for the `/model` open-path test.

- [ ] **Step 5: Commit**

```bash
git add src/components/BChatSidebar/components/InputToolbar/ModelSelector.vue src/components/BChatSidebar/index.vue test/components/BChatSidebar/chat-slash-commands.test.ts
git commit -m "feat(chat): expose model selector open action"
```

## Task 5: Add Usage Panel And Sidebar Slash Command Execution

**Files:**
- Create: `G:/code/ai/tibis/src/components/BChatSidebar/components/UsagePanel.vue`
- Modify: `G:/code/ai/tibis/src/components/BChatSidebar/index.vue`
- Modify: `G:/code/ai/tibis/src/stores/chat.ts` (only if a usage read helper is needed)
- Modify: `G:/code/ai/tibis/test/stores/chat.test.ts` (only if the helper is added)
- Test: `G:/code/ai/tibis/test/components/BChatSidebar/chat-slash-commands.test.ts`

- [ ] **Step 1: Write the failing sidebar command tests**

```ts
it('clears only inputValue and draftReferences when /clear executes', async () => {
  const wrapper = mount(BChatSidebar);

  await wrapper.findComponent({ name: 'BPromptEditor' }).vm.$emit('slash-command', { id: 'clear', trigger: '/clear', title: 'Clear Input', description: '', type: 'action' });

  expect(wrapper.vm.inputValue).toBe('');
  expect(wrapper.vm.draftReferences).toEqual([]);
});

it('shows loading then inline error when usage loading fails', async () => {
  const getSessionUsage = vi.fn().mockRejectedValue(new Error('boom'));
  const wrapper = mount(BChatSidebar, {
    global: {
      provide: {
        getSessionUsage
      }
    }
  });

  await wrapper.findComponent({ name: 'BPromptEditor' }).vm.$emit('slash-command', { id: 'usage', trigger: '/usage', title: 'Usage', description: '', type: 'action' });

  expect(wrapper.findComponent({ name: 'UsagePanel' }).props('state')).toBe('loading');
  await flushPromises();
  expect(wrapper.findComponent({ name: 'UsagePanel' }).props('state')).toBe('error');
});
```

```ts
it('does not create a new session while streaming when /new executes', async () => {
  const wrapper = mount(BChatSidebar);
  wrapper.vm.chatStream.loading.value = true;

  await wrapper.findComponent({ name: 'BPromptEditor' }).vm.$emit('slash-command', { id: 'new', trigger: '/new', title: 'New Chat', description: '', type: 'action' });

  expect(wrapper.vm.messages).not.toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/components/BChatSidebar/chat-slash-commands.test.ts test/stores/chat.test.ts`

Expected: FAIL because `BChatSidebar` does not expose slash command execution or usage panel state.

- [ ] **Step 3: Implement minimal sidebar command execution and usage panel**

```vue
<UsagePanel
  v-if="usagePanelVisible"
  :state="usagePanelState"
  :usage="sessionUsage"
  :error-message="usagePanelError"
  @close="usagePanelVisible = false"
/>
```

```ts
type UsagePanelState = 'loading' | 'data' | 'empty' | 'error';

const usagePanelVisible = ref(false);
const usagePanelState = ref<UsagePanelState>('empty');
const usagePanelError = ref('');
const sessionUsage = ref<AIUsage>();

async function openUsagePanel(): Promise<void> {
  usagePanelVisible.value = true;
  usagePanelState.value = 'loading';
  usagePanelError.value = '';

  if (!settingStore.chatSidebarActiveSessionId) {
    sessionUsage.value = undefined;
    usagePanelState.value = 'empty';
    return;
  }

  try {
    const usage = await chatStore.getSessionUsage(settingStore.chatSidebarActiveSessionId);
    sessionUsage.value = usage;
    usagePanelState.value = usage ? 'data' : 'empty';
  } catch (error) {
    sessionUsage.value = undefined;
    usagePanelError.value = error instanceof Error ? error.message : 'Failed to load usage';
    usagePanelState.value = 'error';
  }
}

async function handleSlashCommand(command: SlashCommandOption): Promise<void> {
  const handlers: Record<string, () => void | Promise<void>> = {
    model: () => modelSelectorRef.value?.open(),
    usage: () => openUsagePanel(),
    new: () => handleNewSession(),
    clear: () => {
      inputValue.value = '';
      draftReferences.value = [];
      promptEditorRef.value?.focus();
    }
  };

  await handlers[command.id]?.();
}
```

```ts
async getSessionUsage(sessionId: string): Promise<AIUsage | undefined> {
  const session = await chatStorage.getSession(sessionId);
  return session?.usage;
}
```

```vue
<template>
  <div class="usage-panel">
    <div class="usage-panel__body" :class="`is-${state}`">
      <template v-if="state === 'loading'">
        <div class="usage-panel__skeleton"></div>
      </template>
      <template v-else-if="state === 'error'">
        <p class="usage-panel__error">{{ errorMessage }}</p>
      </template>
      <template v-else-if="state === 'empty'">
        <p class="usage-panel__empty">No usage recorded for this session yet.</p>
      </template>
      <template v-else>
        <p>Input Tokens: {{ usage?.inputTokens ?? 0 }}</p>
        <p>Output Tokens: {{ usage?.outputTokens ?? 0 }}</p>
        <p>Total Tokens: {{ usage?.totalTokens ?? 0 }}</p>
      </template>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run test/components/BChatSidebar/chat-slash-commands.test.ts test/stores/chat.test.ts`

Expected: PASS for `/new`, `/clear`, `/usage` loading/error/data, and `/model` command execution paths.

- [ ] **Step 5: Commit**

```bash
git add src/components/BChatSidebar/index.vue src/components/BChatSidebar/components/UsagePanel.vue src/stores/chat.ts test/components/BChatSidebar/chat-slash-commands.test.ts test/stores/chat.test.ts
git commit -m "feat(chat): execute slash commands from sidebar"
```

## Task 6: Final Integration Verification

**Files:**
- Modify: `G:/code/ai/tibis/changelog/2026-04-29.md`
- Test: `G:/code/ai/tibis/test/components/BPromptEditor/BPromptEditorSlashCommands.test.ts`
- Test: `G:/code/ai/tibis/test/components/BPromptEditor/BPromptEditorRegression.test.ts`
- Test: `G:/code/ai/tibis/test/components/BChatSidebar/chat-slash-commands.test.ts`
- Test: `G:/code/ai/tibis/test/stores/chat.test.ts`

- [ ] **Step 1: Add the changelog entry for implementation**

```md
## Added
- 为聊天侧边栏输入框新增行首 slash 命令入口，支持 `/model`、`/usage`、`/new`、`/clear`。

## Changed
- 为 `BPromptEditor` 增加 slash 命令面板、键盘导航与无命令配置时的普通文本回退行为。
- 为聊天侧边栏新增复用模型选择器的可编程打开入口，以及会话 usage 面板的 loading / empty / error 状态。
```

- [ ] **Step 2: Run the full targeted test suite**

Run: `pnpm exec vitest run test/components/BPromptEditor/BPromptEditorSlashCommands.test.ts test/components/BPromptEditor/BPromptEditorRegression.test.ts test/components/BChatSidebar/chat-slash-commands.test.ts test/stores/chat.test.ts`

Expected: PASS with all slash command editor, sidebar, and store tests green.

- [ ] **Step 3: Run the existing related sidebar regression tests**

Run: `pnpm exec vitest run test/components/BChatSidebar/file-reference-insert.test.ts test/components/BChatSidebar/useAutoName.test.ts`

Expected: PASS, confirming slash command changes did not break file reference insertion or auto naming.

- [ ] **Step 4: Review the diff for scope control**

Run: `git diff --stat HEAD~1..HEAD`

Expected: only slash command editor, sidebar, store, test, and changelog files are included.

- [ ] **Step 5: Commit**

```bash
git add changelog/2026-04-29.md
git commit -m "test(chat): verify slash command integration"
```
