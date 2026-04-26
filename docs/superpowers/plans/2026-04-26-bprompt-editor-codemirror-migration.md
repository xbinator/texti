# BPromptEditor CodeMirror 迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 CodeMirror 6 替换 BPromptEditor 的 contenteditable，保留现有 Props/Emits API，分 5 个 Phase 逐步交付。

**Architecture:** 以 CodeMirror 6 EditorView 为核心，通过 StateField + ViewPlugin 管理变量 chip 渲染和触发器菜单，Compartment 支持 disabled/maxHeight 动态响应式更新，Annotation 防循环 emit。

**Tech Stack:** CodeMirror 6 (`@codemirror/view`, `@codemirror/state`, `@codemirror/commands`)，Vue 3.4+ `defineModel`，TypeScript。

---

## 文件结构

**新建：**
```
src/components/BPromptEditor/extensions/
├── base.ts           # EditorView 创建、extension 组装
├── variableChip.ts   # {{variable}} 和 {{file-ref:...}} Decoration.mark 渲染
├── triggerState.ts   # 变量菜单 StateField（from/to/query/activeIndex）
├── triggerPlugin.ts  # 触发器 ViewPlugin（coordsAtPos 同步菜单位置到 Vue）
├── pasteHandler.ts   # 粘贴/拖拽拦截
└── placeholder.ts    # 占位符 extension
```

**修改：**
- `src/components/BPromptEditor/index.vue` — 完全重写
- `src/components/BPromptEditor/hooks/index.ts` — 清理 export，只保留 useVariableEncoder

**删除：**
- `src/components/BPromptEditor/hooks/useEditorCore.ts`
- `src/components/BPromptEditor/hooks/useEditorSelection.ts`
- `src/components/BPromptEditor/hooks/useEditorTrigger.ts`
- `src/components/BPromptEditor/hooks/useEditorKeyboard.ts`
- `src/components/BPromptEditor/hooks/useEditorPaste.ts`

**保留：**
- `src/components/BPromptEditor/hooks/useVariableEncoder.ts` — 编码/解码逻辑
- `src/components/BPromptEditor/components/VariableSelect.vue` — 变量下拉菜单
- `src/components/BPromptEditor/types.ts` — 类型定义

---

## Task 1: 创建 placeholder extension

**Files:**
- Create: `src/components/BPromptEditor/extensions/placeholder.ts`

- [ ] **Step 1: 创建 placeholder.ts**

```ts
import { ViewPlugin } from '@codemirror/view';
import { placeholder as cmPlaceholder } from '@codemirror/view';

export function createPlaceholderExtension(placeholderText: string): ViewPlugin {
  return cmPlaceholder(placeholderText);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/BPromptEditor/extensions/placeholder.ts
git commit -m "feat(BPromptEditor): add placeholder extension"
```

---

## Task 2: 创建 pasteHandler extension

**Files:**
- Create: `src/components/BPromptEditor/extensions/pasteHandler.ts`

- [ ] **Step 1: 创建 pasteHandler.ts**

```ts
import { EditorView } from '@codemirror/view';

export function createPasteHandler(): ViewPlugin {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const files = event.clipboardData?.files;

      if (files?.length) {
        event.preventDefault();
        const insert = Array.from(files)
          .map(f => `{{file-ref:${encodeURIComponent(f.name)}|${encodeURIComponent(f.name)}}}`)
          .join('');

        const range = view.state.selection.main;
        view.dispatch({
          changes: { from: range.from, to: range.to, insert },
          selection: { anchor: range.from + insert.length },
          scrollIntoView: true
        });
        return true;
      }

      // 普通文本不拦截，交给 CodeMirror 默认处理
      return false;
    },

    drop(event, view) {
      const files = event.dataTransfer?.files;
      if (!files?.length) return false;

      event.preventDefault();

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return true;

      const insert = Array.from(files)
        .map(f => `{{file-ref:${encodeURIComponent(f.name)}|${encodeURIComponent(f.name)}}}`)
        .join('');

      view.dispatch({
        changes: { from: pos, insert },
        selection: { anchor: pos + insert.length },
        scrollIntoView: true
      });

      return true;
    }
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/BPromptEditor/extensions/pasteHandler.ts
git commit -m "feat(BPromptEditor): add pasteHandler extension"
```

---

## Task 3: 创建 variableChip extension

**Files:**
- Create: `src/components/BPromptEditor/extensions/variableChip.ts`

- [ ] **Step 1: 创建 variableChip.ts**

```ts
import { StateField, type StateEffect } from '@codemirror/state';
import { Decoration, type DecorationSet, type Range } from '@codemirror/view';

export const variableChipField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state.doc.toString());
  },

  update(deco, tr) {
    if (tr.docChanged) {
      return buildDecorations(tr.newDoc.toString());
    }
    return deco.map(tr.changes);
  },

  provide: field => EditorView.decorations.from(field)
});

function buildDecorations(text: string): DecorationSet {
  const builder: Range<Decoration>[] = [];

  for (const match of text.matchAll(/\{\{([^{}\n]+)\}\}/g)) {
    const body = match[1];
    const from = match.index!;
    const to = from + match[0].length;

    if (body.startsWith('file-ref:')) {
      const fileMatch = body.match(/^file-ref:([^|\n{}]+)\|([^{}\n]+)$/);
      if (!fileMatch) continue;
      builder.push(
        Decoration.mark({ class: 'b-prompt-chip b-prompt-chip--file' }).range(from, to)
      );
    } else {
      builder.push(
        Decoration.mark({ class: 'b-prompt-chip' }).range(from, to)
      );
    }
  }

  return Decoration.set(builder, true);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/BPromptEditor/extensions/variableChip.ts
git commit -m "feat(BPromptEditor): add variableChip extension"
```

---

## Task 4: 创建 triggerState extension

**Files:**
- Create: `src/components/BPromptEditor/extensions/triggerState.ts`

- [ ] **Step 1: 创建 triggerState.ts**

```ts
import { StateField, StateEffect, EditorState, type Extension } from '@codemirror/state';

// Effects
export const setTriggerActiveIndex = StateEffect.define<number>();
export const closeTrigger = StateEffect.define<void>();

export interface TriggerState {
  visible: boolean;
  from: number;
  to: number;
  query: string;
  activeIndex: number;
}

export const triggerStateField = StateField.define<TriggerState | null>({
  create() {
    return null;
  },

  update(state, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setTriggerActiveIndex) && state) {
        return { ...state, activeIndex: effect.value };
      }
      if (effect.is(closeTrigger)) {
        return null;
      }
    }

    if (!tr.selectionSet && !tr.docChanged) return state;

    const selection = tr.newState.selection.main;
    if (!selection.empty) return null;

    const pos = selection.head;
    const context = getTriggerContext(tr.newState, pos);

    if (!context) return null;

    return {
      visible: true,
      from: context.from,
      to: context.to,
      query: context.query,
      activeIndex: 0
    };
  }
});

function getTriggerContext(
  state: EditorState,
  pos: number
): { from: number; to: number; query: string } | null {
  const from = Math.max(0, pos - 100);
  const text = state.doc.sliceString(from, pos);

  const open = text.lastIndexOf('{{');
  if (open === -1) return null;

  const afterOpen = text.slice(open + 2);

  if (afterOpen.includes('}}')) return null;
  if (afterOpen.includes('{{')) return null;
  if (/[{}\n]/.test(afterOpen)) return null;

  return {
    from: from + open,
    to: pos,
    query: afterOpen
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/BPromptEditor/extensions/triggerState.ts
git commit -m "feat(BPromptEditor): add triggerState extension"
```

---

## Task 5: 创建 triggerPlugin extension

**Files:**
- Create: `src/components/BPromptEditor/extensions/triggerPlugin.ts`

- [ ] **Step 1: 创建 triggerPlugin.ts**

```ts
import { ViewPlugin } from '@codemirror/view';
import { triggerStateField } from './triggerState';

export function createTriggerPlugin(params: {
  triggerVisible: { value: boolean };
  triggerPosition: { value: { top: number; left: number } };
  triggerActiveIndex: { value: number };
  triggerQuery: { value: string };
}): ViewPlugin {
  return ViewPlugin.define(view => ({
    update(update) {
      const triggerState = update.state.field(triggerStateField, false);

      if (!triggerState) {
        params.triggerVisible.value = false;
        return;
      }

      const coords = update.view.coordsAtPos(triggerState.to);
      params.triggerPosition.value = coords
        ? { top: coords.bottom, left: coords.left }
        : { top: 0, left: 0 };
      params.triggerVisible.value = true;
      params.triggerActiveIndex.value = triggerState.activeIndex;
      params.triggerQuery.value = triggerState.query;
    }
  }));
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/BPromptEditor/extensions/triggerPlugin.ts
git commit -m "feat(BPromptEditor): add triggerPlugin extension"
```

---

## Task 6: 创建 base.ts extension 组装

**Files:**
- Create: `src/components/BPromptEditor/extensions/base.ts`

- [ ] **Step 1: 创建 base.ts**

```ts
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab
} from '@codemirror/commands';
import { insertNewline } from '@codemirror/commands';

import type { Ref } from 'vue';
import type { Extension } from '@codemirror/state';
import type { BPromptEditorProps } from '../types';

export const editableCompartment = new Compartment();
export const readOnlyCompartment = new Compartment();
export const themeCompartment = new Compartment();

export function createBaseExtensions(params: {
  props: BPromptEditorProps;
  resolvedMaxHeight: Ref<string | number | undefined>;
  submitOnEnter: Ref<boolean>;
  emit: (event: 'submit') => void;
  modelSyncExtension: Extension;
  variableChipField: Extension;
  triggerStateField: Extension;
  triggerPlugin: Extension;
}): Extension[] {
  const { props, resolvedMaxHeight, submitOnEnter, emit } = params;

  return [
    history(),
    editableCompartment.of(EditorView.editable.of(!props.disabled)),
    readOnlyCompartment.of(EditorState.readOnly.of(props.disabled)),
    themeCompartment.of(
      EditorView.theme({
        '&': { maxHeight: addCssUnit(resolvedMaxHeight.value) },
        '.cm-scroller': {
          maxHeight: addCssUnit(resolvedMaxHeight.value),
          overflow: 'auto'
        }
      })
    ),
    placeholder(props.placeholder ?? '请输入内容...'),
    keymap.of([
      indentWithTab,
      { key: 'Shift-Enter', run: insertNewline },
      {
        key: 'Enter',
        run() {
          if (submitOnEnter.value) {
            emit('submit');
            return true;
          }
          return false;
        }
      },
      ...defaultKeymap,
      ...historyKeymap
    ]),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ spellcheck: 'false' }),
    params.modelSyncExtension,
    params.variableChipField,
    params.triggerStateField,
    params.triggerPlugin
  ];
}

function addCssUnit(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return `${value}px`;
  return value;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/BPromptEditor/extensions/base.ts
git commit -m "feat(BPromptEditor): add base extension assembly"
```

---

## Task 7: 重写 index.vue 主组件（Phase 1 核心）

**Files:**
- Modify: `src/components/BPromptEditor/index.vue`

> 完全重写。以下是完整的 index.vue 代码，基于设计文档实现 Phase 1（纯文本编辑器）+ Phase 2（Decoration）+ Phase 3（变量菜单）+ Phase 4（粘贴/拖拽）。

- [ ] **Step 1: 编写 index.vue 完整代码**

```vue
<template>
  <div ref="wrapperRef" class="b-prompt-editor" @click="handleContainerClick">
    <div class="b-prompt-editor__container">
      <div v-if="!disabled" v-show="editorIsEmpty" class="b-prompt-editor__placeholder">
        {{ placeholder }}
      </div>

      <div ref="editorHostRef" class="b-prompt-editor__codemirror"></div>

      <VariableSelect
        :visible="triggerVisible.value"
        :variables="filteredVariables"
        :position="triggerPosition.value"
        :active-index="triggerActiveIndex.value"
        @select="handleVariableSelect"
        @update:active-index="handleActiveIndexChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { FileReferenceChip } from './hooks/useVariableEncoder';
import type { Variable, BPromptEditorProps as Props } from './types';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Annotation, Compartment, EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createPlaceholderExtension } from './extensions/placeholder';
import { createPasteHandler } from './extensions/pasteHandler';
import { variableChipField } from './extensions/variableChip';
import {
  triggerStateField,
  setTriggerActiveIndex,
  closeTrigger
} from './extensions/triggerState';
import { createTriggerPlugin } from './extensions/triggerPlugin';
import { createBaseExtensions } from './extensions/base';
import VariableSelect from './components/VariableSelect.vue';

const props = withDefaults(defineProps<Props>(), {
  placeholder: '请输入内容...',
  options: () => [],
  disabled: false,
  maxHeight: undefined,
  submitOnEnter: false
});

const emit = defineEmits<{
  change: [value: string];
  submit: [];
}>();

// Model
const modelValue = defineModel<string>('value', { default: '' });

// Refs
const wrapperRef = ref<HTMLDivElement>();
const editorHostRef = ref<HTMLDivElement>();
const editorView = ref<EditorView | null>(null);

// Trigger state refs (synced from CM via triggerPlugin)
const triggerVisible = ref(false);
const triggerPosition = ref({ top: 0, left: 0 });
const triggerActiveIndex = ref(0);
const triggerQuery = ref('');
const editorIsEmpty = ref(true);
const lastSelection = ref<EditorSelection | null>(null);

// Resolved maxHeight
const resolvedMaxHeight = computed(() => props.maxHeight);

// Submit on Enter ref
const submitOnEnterRef = computed(() => props.submitOnEnter);

// Flatten options
const flattenedOptions = computed(() =>
  (props.options ?? []).flatMap(group => group.options)
);

// Filtered variables
const filteredVariables = computed(() => {
  const keyword = triggerQuery.value.trim().toLowerCase();
  if (!keyword) return flattenedOptions.value;
  return flattenedOptions.value.filter(item =>
    item.label.toLowerCase().includes(keyword) ||
    item.value.toLowerCase().includes(keyword)
  );
});

// External update annotation
const externalUpdate = Annotation.define<boolean>();

// Variable chip field
const variableChip = variableChipField;

// Trigger state field
const triggerState = triggerStateField;

// Trigger plugin
const triggerPlugin = createTriggerPlugin({
  triggerVisible,
  triggerPosition,
  triggerActiveIndex,
  triggerQuery
});

// Model sync extension
const modelSyncExtension = EditorView.updateListener.of((update) => {
  if (!update.docChanged) return;

  const isExternal = update.transactions.some(tr =>
    tr.annotation(externalUpdate)
  );

  if (isExternal) return;

  const newValue = update.state.doc.toString();

  if (modelValue.value !== newValue) {
    modelValue.value = newValue;
  }

  editorIsEmpty.value = newValue.trim() === '';
  emit('change', newValue);
});

// Base extensions
const baseExtensions = createBaseExtensions({
  props,
  resolvedMaxHeight,
  submitOnEnter: submitOnEnterRef,
  emit,
  modelSyncExtension,
  variableChipField: variableChip,
  triggerStateField: triggerState,
  triggerPlugin
});

// Create EditorView
function createEditorView(): EditorView {
  const state = EditorState.create({
    doc: modelValue.value ?? '',
    extensions: [
      ...baseExtensions,
      createPlaceholderExtension(props.placeholder ?? '请输入内容...'),
      createPasteHandler()
    ]
  });

  return new EditorView({
    parent: editorHostRef.value!,
    state
  });
}

// Focus
function focus(): void {
  editorView.value?.focus();
}

// Capture cursor position
function captureCursorPosition(): void {
  if (!editorView.value) return;
  lastSelection.value = editorView.value.state.selection;
}

// Insert file reference
function insertFileReference(reference: FileReferenceChip): void {
  if (!editorView.value) return;

  const insert = `{{file-ref:${encodeURIComponent(reference.path)}|${encodeURIComponent(reference.name)}}}`;
  const selection = lastSelection.value ?? editorView.value.state.selection;
  const range = selection.main;

  editorView.value.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + insert.length },
    scrollIntoView: true
  });

  editorView.value.focus();
}

// Handle container click
function handleContainerClick(): void {
  if (!props.disabled && editorView.value) {
    editorView.value.focus();
  }
}

// Variable select
function handleVariableSelect(variable: Variable): void {
  if (!editorView.value) return;

  const state = editorView.value.state.field(triggerStateField, false);
  if (!state) return;

  const insert = `{{${variable.value}}}`;

  editorView.value.dispatch({
    changes: { from: state.from, to: state.to, insert },
    selection: { anchor: state.from + insert.length },
    effects: closeTrigger.of()
  });

  editorView.value.focus();
}

// Active index change
function handleActiveIndexChange(index: number): void {
  if (!editorView.value) return;

  editorView.value.dispatch({
    effects: setTriggerActiveIndex.of(index)
  });
}

// Watch external modelValue changes
watch(
  modelValue,
  (value) => {
    if (!editorView.value) return;

    const nextValue = value ?? '';
    const currentValue = editorView.value.state.doc.toString();

    if (nextValue === currentValue) return;

    editorView.value.dispatch({
      changes: { from: 0, to: editorView.value.state.doc.length, insert: nextValue },
      annotations: externalUpdate.of(true)
    });

    editorIsEmpty.value = nextValue.trim() === '';
  }
);

// Watch disabled changes
watch(
  () => props.disabled,
  (disabled) => {
    if (!editorView.value) return;
    editorView.value.dispatch({
      effects: [
        editableCompartment.reconfigure(EditorView.editable.of(!disabled)),
        readOnlyCompartment.reconfigure(EditorState.readOnly.of(disabled))
      ]
    });
  }
);

// Watch maxHeight changes
watch(
  resolvedMaxHeight,
  (maxHeight) => {
    if (!editorView.value) return;
    editorView.value.dispatch({
      effects: themeCompartment.reconfigure(
        EditorView.theme({
          '&': { maxHeight: addCssUnit(maxHeight) },
          '.cm-scroller': { maxHeight: addCssUnit(maxHeight), overflow: 'auto' }
        })
      )
    });
  }
);

onMounted(() => {
  editorView.value = createEditorView();
  editorIsEmpty.value = (modelValue.value ?? '').trim() === '';
});

onBeforeUnmount(() => {
  editorView.value?.destroy();
  editorView.value = null;
});

function addCssUnit(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return `${value}px`;
  return value;
}

defineExpose({ focus, captureCursorPosition, insertFileReference });
</script>

<style lang="less">
@import url('@/assets/styles/scrollbar.less');

.b-prompt-editor {
  width: 100%;
  min-height: 80px;
  overflow-y: auto;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-all;
  overflow-wrap: break-word;
  white-space: pre-wrap;
  outline: none;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 6px;
  transition: all 0.2s;

  &:hover {
    border-color: var(--border-hover);
  }

  &:focus-within {
    background: var(--input-bg);
    border-color: var(--input-focus-border);
    box-shadow: 0 0 0 2px var(--input-focus-shadow);
  }

  .scrollbar-style();
}

.b-prompt-editor__container {
  position: relative;
  width: 100%;
  height: 100%;
}

.b-prompt-editor__codemirror {
  width: 100%;

  .cm-editor {
    min-height: 80px;
    font: inherit;
    line-height: 1.6;
    background: transparent;
  }

  .cm-focused {
    outline: none;
  }

  .cm-scroller {
    overflow: visible;
    font: inherit;
  }

  .cm-content {
    padding: 12px;
    caret-color: var(--color-primary);
  }

  .cm-line {
    padding: 0;
  }

  .cm-placeholder {
    color: var(--text-placeholder);
  }

  .cm-selectionBackground,
  .cm-focused .cm-selectionBackground {
    background-color: var(--color-primary-selection-bg, rgba(64, 128, 255, 0.2)) !important;
  }

  // Chip decorations
  .b-prompt-chip {
    display: inline;
    padding: 0 6px;
    font-size: 12px;
    line-height: 20px;
    color: var(--color-primary);
    background-color: rgb(var(--color-primary-value, 64, 128, 255), 0.1);
    border-radius: 4px;
  }

  .b-prompt-chip--file {
    color: var(--text-primary);
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-primary);
  }
}

.b-prompt-editor__placeholder {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  padding: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: inherit;
  color: var(--text-placeholder);
  pointer-events: none;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/BPromptEditor/index.vue
git commit -m "feat(BPromptEditor): rewrite with CodeMirror 6"
```

---

## Task 8: 清理 hooks/index.ts

**Files:**
- Modify: `src/components/BPromptEditor/hooks/index.ts`

- [ ] **Step 1: 修改 hooks/index.ts**

当前文件内容替换为：

```ts
export { useVariableEncoder, CARET_SPACER, type VariableEncoderOptions } from './useVariableEncoder';
```

- [ ] **Step 2: Commit**

```bash
git add src/components/BPromptEditor/hooks/index.ts
git commit -m "refactor(BPromptEditor): clean up hooks index"
```

---

## Task 9: 删除废弃的 hooks 文件

**Files:**
- Delete: `src/components/BPromptEditor/hooks/useEditorCore.ts`
- Delete: `src/components/BPromptEditor/hooks/useEditorSelection.ts`
- Delete: `src/components/BPromptEditor/hooks/useEditorTrigger.ts`
- Delete: `src/components/BPromptEditor/hooks/useEditorKeyboard.ts`
- Delete: `src/components/BPromptEditor/hooks/useEditorPaste.ts`

- [ ] **Step 1: 删除废弃文件**

```bash
git rm src/components/BPromptEditor/hooks/useEditorCore.ts \
       src/components/BPromptEditor/hooks/useEditorSelection.ts \
       src/components/BPromptEditor/hooks/useEditorTrigger.ts \
       src/components/BPromptEditor/hooks/useEditorKeyboard.ts \
       src/components/BPromptEditor/hooks/useEditorPaste.ts
```

- [ ] **Step 2: Commit**

```bash
git commit -m "refactor(BPromptEditor): remove deprecated hooks"
```

---

## Task 10: 验证构建

**Files:**
- None (verification only)

- [ ] **Step 1: 运行类型检查**

```bash
npx tsc --noEmit --project tsconfig.app.json 2>&1 | head -50
```

- [ ] **Step 2: 运行构建**

```bash
npm run build 2>&1 | tail -30
```

- [ ] **Step 3: 如有问题，修复后 commit**

```bash
git add -A && git commit -m "fix(BPromptEditor): resolve build errors"
```

---

## Task 11: 回归测试

**Files:**
- None (test existing test file)

- [ ] **Step 1: 检查是否有现有测试**

```bash
ls test/components/BPromptEditor/
```

- [ ] **Step 2: 运行 BPromptEditor 测试**

```bash
npm run test -- --run test/components/BPromptEditor/ 2>&1
```

- [ ] **Step 3: 提交测试修复或更新**

```bash
git add -A && git commit -m "test(BPromptEditor): update regression tests"
```

---

## 实施顺序

| Phase | 内容 | 交付 Task |
|-------|------|-----------|
| Phase 1 | 纯文本编辑器（EditorView + v-model + keymap + history + disabled + placeholder + maxHeight） | Task 1, 6, 7 |
| Phase 2 | Decoration 渲染（variableChip） | Task 3, 7 |
| Phase 3 | 变量菜单（triggerState + triggerPlugin + VariableSelect 集成） | Task 4, 5, 7 |
| Phase 4 | 粘贴/拖拽 | Task 2, 7 |
| Phase 5 | 清理（hooks 清理 + 样式迁移 + 验证） | Task 8, 9, 10, 11 |

---

## 依赖关系

- Task 3 依赖 Task 6 中的 `variableChipField` import 路径
- Task 4 依赖 Task 5 的 `triggerStateField`（Task 4 创建 state，Task 5 创建 plugin 同步 Vue）
- Task 6 依赖 Task 1-5 的 extension 定义
- Task 7 依赖 Task 1-6 全部完成
- Task 8, 9 依赖 Task 7 完成
- Task 10, 11 依赖 Task 7-9 完成
