# BEditor CodeMirror Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the source-mode textarea with CodeMirror 6 and move Tiptap-specific orchestration out of `src/components/BEditor/index.vue` behind a clean adapter boundary.

**Architecture:** `index.vue` remains the layout and mode orchestration shell. Rich editing moves into a dedicated Tiptap host component that owns front matter parsing, Tiptap instance creation, rich-editor search, and body-outline synchronization. Source editing becomes a CodeMirror host component exposing the same editor controller contract, so the shell talks to both modes through one adapter-shaped API.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript strict mode, Tiptap 3, CodeMirror 6 (`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/lang-markdown`, `@codemirror/language`), Vitest, existing `BScrollbar`/BEditor components.

---

## File Structure

- Modify: `package.json` and `pnpm-lock.yaml`
  - Add the minimal CodeMirror 6 packages used by source mode.
- Create: `src/components/BEditor/adapters/types.ts`
  - Define the shared editor controller/search contract consumed by `index.vue`.
- Modify: `src/components/BEditor/hooks/useEditorController.ts`
  - Depend on the shared adapter type instead of the rich/source component internals.
- Create: `test/components/BEditor/useEditorController.test.ts`
  - Verify mode switching and fallback behavior without mounting Vue components.
- Replace: `src/components/BEditor/components/PaneSourceEditor.vue`
  - Replace textarea implementation with CodeMirror while preserving `v-model:value` and exposed controller methods.
- Create: `src/components/BEditor/components/RichEditorHost.vue`
  - Own Tiptap-specific hooks: `useFrontMatter`, `useRichEditor`, `PaneRichEditor`, and rich search commands.
- Modify: `src/components/BEditor/index.vue`
  - Remove direct Tiptap/front matter orchestration; wire only layout, sidebar, active pane controller, and find bar.
- Modify: `src/components/BEditor/types.ts`
  - Re-export public editor instance/search types from the adapter type file.
- Modify: `changelog/2026-04-18.md`
  - Add entries for the CodeMirror source editor and BEditor adapter refactor.

---

### Task 1: Add CodeMirror Dependencies

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Install the CodeMirror packages**

Run:

```bash
pnpm add @codemirror/state @codemirror/view @codemirror/commands @codemirror/lang-markdown @codemirror/language
```

Expected: `package.json` gains the five dependencies and `pnpm-lock.yaml` is updated.

- [ ] **Step 2: Verify the dependency tree resolves**

Run:

```bash
pnpm build
```

Expected: PASS. Dependency resolution must not fail with missing package or lockfile errors.

- [ ] **Step 3: Commit dependency changes**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add codemirror dependencies"
```

---

### Task 2: Define The Editor Adapter Contract

**Files:**
- Create: `src/components/BEditor/adapters/types.ts`
- Modify: `src/components/BEditor/types.ts`
- Modify: `src/components/BEditor/hooks/useEditorController.ts`
- Create: `test/components/BEditor/useEditorController.test.ts`

- [ ] **Step 1: Write the failing controller tests**

Create `test/components/BEditor/useEditorController.test.ts`:

```ts
import { computed, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { EditorController } from '@/components/BEditor/adapters/types';
import { useEditorController } from '@/components/BEditor/hooks/useEditorController';

function createController(canUndoValue: boolean, canRedoValue: boolean): EditorController {
  return {
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: vi.fn(() => canUndoValue),
    canRedo: vi.fn(() => canRedoValue),
    focusEditor: vi.fn(),
    focusEditorAtStart: vi.fn(),
    setSearchTerm: vi.fn(),
    findNext: vi.fn(),
    findPrevious: vi.fn(),
    clearSearch: vi.fn(),
    getSearchState: vi.fn(() => ({ currentIndex: 0, matchCount: 0, term: '' }))
  };
}

describe('useEditorController', () => {
  it('returns the rich controller when rich mode is active', () => {
    const richController = createController(true, false);
    const sourceController = createController(false, true);
    const isRichMode = ref(true);

    const controller = useEditorController({
      isRichMode: computed(() => isRichMode.value),
      richEditorPaneRef: ref(richController),
      sourceEditorPaneRef: ref(sourceController)
    });

    controller.value.undo();

    expect(richController.undo).toHaveBeenCalledTimes(1);
    expect(sourceController.undo).not.toHaveBeenCalled();
    expect(controller.value.canUndo()).toBe(true);
  });

  it('returns the source controller when source mode is active', () => {
    const richController = createController(true, false);
    const sourceController = createController(false, true);
    const isRichMode = ref(false);

    const controller = useEditorController({
      isRichMode: computed(() => isRichMode.value),
      richEditorPaneRef: ref(richController),
      sourceEditorPaneRef: ref(sourceController)
    });

    controller.value.redo();

    expect(sourceController.redo).toHaveBeenCalledTimes(1);
    expect(richController.redo).not.toHaveBeenCalled();
    expect(controller.value.canRedo()).toBe(true);
  });

  it('uses a safe no-op controller before a pane is mounted', () => {
    const controller = useEditorController({
      isRichMode: computed(() => true),
      richEditorPaneRef: ref(null),
      sourceEditorPaneRef: ref(null)
    });

    expect(controller.value.canUndo()).toBe(false);
    expect(controller.value.canRedo()).toBe(false);
    expect(controller.value.getSearchState()).toEqual({ currentIndex: 0, matchCount: 0, term: '' });
    expect(() => controller.value.focusEditor()).not.toThrow();
    expect(() => controller.value.setSearchTerm('text')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm test test/components/BEditor/useEditorController.test.ts
```

Expected: FAIL because `src/components/BEditor/adapters/types.ts` does not exist or `useEditorController` does not yet accept the shared controller type.

- [ ] **Step 3: Create the shared adapter types**

Create `src/components/BEditor/adapters/types.ts`:

```ts
export interface EditorSearchState {
  currentIndex: number;
  matchCount: number;
  term: string;
}

export interface EditorController {
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  focusEditor: () => void;
  focusEditorAtStart: () => void;
  setSearchTerm: (term: string) => void;
  findNext: () => void;
  findPrevious: () => void;
  clearSearch: () => void;
  getSearchState: () => EditorSearchState;
}

export const EMPTY_SEARCH_STATE: EditorSearchState = {
  currentIndex: 0,
  matchCount: 0,
  term: ''
};

export function createNoopEditorController(): EditorController {
  return {
    undo(): void {},
    redo(): void {},
    canUndo(): boolean {
      return false;
    },
    canRedo(): boolean {
      return false;
    },
    focusEditor(): void {},
    focusEditorAtStart(): void {},
    setSearchTerm(): void {},
    findNext(): void {},
    findPrevious(): void {},
    clearSearch(): void {},
    getSearchState(): EditorSearchState {
      return { ...EMPTY_SEARCH_STATE };
    }
  };
}
```

- [ ] **Step 4: Re-export the public types**

Replace the search/controller portion of `src/components/BEditor/types.ts` with:

```ts
export type { EditorController, EditorSearchState, EditorController as BEditorPublicInstance } from './adapters/types';

export type BEditorViewMode = 'rich' | 'source';

export interface SelectionRange {
  // 选中的文本起始位置
  from: number;
  //  选择结束位置
  to: number;
  // 选中的文本内容
  text: string;
}
```

- [ ] **Step 5: Update `useEditorController`**

Replace `src/components/BEditor/hooks/useEditorController.ts` with:

```ts
import type { ComputedRef, Ref } from 'vue';
import { computed } from 'vue';
import type { EditorController } from '../adapters/types';
import { createNoopEditorController } from '../adapters/types';

interface UseEditorControllerParams {
  isRichMode: ComputedRef<boolean>;
  richEditorPaneRef: Ref<EditorController | null>;
  sourceEditorPaneRef: Ref<EditorController | null>;
}

export function useEditorController({ isRichMode, richEditorPaneRef, sourceEditorPaneRef }: UseEditorControllerParams): ComputedRef<EditorController> {
  const fallbackController = createNoopEditorController();

  return computed<EditorController>(() => {
    if (isRichMode.value) {
      return richEditorPaneRef.value ?? fallbackController;
    }

    return sourceEditorPaneRef.value ?? fallbackController;
  });
}
```

- [ ] **Step 6: Run the controller tests**

Run:

```bash
pnpm test test/components/BEditor/useEditorController.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the adapter contract**

```bash
git add src/components/BEditor/adapters/types.ts src/components/BEditor/types.ts src/components/BEditor/hooks/useEditorController.ts test/components/BEditor/useEditorController.test.ts
git commit -m "refactor: add editor adapter contract"
```

---

### Task 3: Replace Source Textarea With CodeMirror

**Files:**
- Modify: `src/components/BEditor/components/PaneSourceEditor.vue`

- [ ] **Step 1: Write the source editor implementation**

Replace `src/components/BEditor/components/PaneSourceEditor.vue` with:

```vue
<template>
  <div ref="editorRootRef" class="source-editor-pane"></div>
</template>

<script setup lang="ts">
import type { Extension } from '@codemirror/state';
import type { EditorSearchState } from '../adapters/types';
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view';

const editorContent = defineModel<string>('value', { default: '' });

interface Props {
  editable?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  editable: true
});

const editorRootRef = ref<HTMLElement | null>(null);
const editorView = shallowRef<EditorView | null>(null);
const editableCompartment = new Compartment();
const isApplyingExternalValue = ref(false);

const editable = computed(() => props.editable);

function createExtensions(): Extension[] {
  return [
    lineNumbers(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    markdown(),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
    editableCompartment.of(EditorView.editable.of(editable.value)),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (!update.docChanged || isApplyingExternalValue.value) {
        return;
      }

      editorContent.value = update.state.doc.toString();
    }),
    EditorView.theme({
      '&': {
        height: '100%',
        minHeight: '100%',
        color: 'var(--editor-text)',
        backgroundColor: 'transparent',
        fontSize: '16px'
      },
      '.cm-scroller': {
        fontFamily: 'inherit',
        lineHeight: '1.74'
      },
      '.cm-content': {
        minHeight: '100%',
        padding: '0',
        caretColor: 'var(--editor-caret)'
      },
      '.cm-gutters': {
        color: 'var(--text-tertiary)',
        backgroundColor: 'transparent',
        borderRight: '1px solid var(--border-secondary)'
      },
      '.cm-activeLine': {
        backgroundColor: 'var(--bg-hover)'
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'var(--bg-hover)'
      },
      '.cm-selectionBackground': {
        backgroundColor: 'var(--selection-bg) !important'
      },
      '&.cm-focused': {
        outline: 'none'
      }
    })
  ];
}

function createEditorView(parent: HTMLElement): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: editorContent.value,
      extensions: createExtensions()
    })
  });
}

function replaceDocument(value: string): void {
  const view = editorView.value;
  if (!view) {
    return;
  }

  const currentValue = view.state.doc.toString();
  if (currentValue === value) {
    return;
  }

  isApplyingExternalValue.value = true;
  view.dispatch({
    changes: {
      from: 0,
      to: view.state.doc.length,
      insert: value
    }
  });
  isApplyingExternalValue.value = false;
}

function undoEditor(): void {
  const view = editorView.value;
  if (view) {
    undo(view);
  }
}

function redoEditor(): void {
  const view = editorView.value;
  if (view) {
    redo(view);
  }
}

function canUndo(): boolean {
  const view = editorView.value;
  return view ? undoDepth(view.state) > 0 : false;
}

function canRedo(): boolean {
  const view = editorView.value;
  return view ? redoDepth(view.state) > 0 : false;
}

function focusEditor(): void {
  editorView.value?.focus();
}

function focusEditorAtStart(): void {
  const view = editorView.value;
  if (!view) {
    return;
  }

  view.dispatch({ selection: { anchor: 0 } });
  view.focus();
}

function setSearchTerm(): void {}

function findNext(): void {}

function findPrevious(): void {}

function clearSearch(): void {}

function getSearchState(): EditorSearchState {
  return { currentIndex: 0, matchCount: 0, term: '' };
}

watch(editorContent, (value) => {
  replaceDocument(value);
});

watch(editable, (value) => {
  editorView.value?.dispatch({
    effects: editableCompartment.reconfigure(EditorView.editable.of(value))
  });
});

nextTick(() => {
  if (editorRootRef.value && !editorView.value) {
    editorView.value = createEditorView(editorRootRef.value);
  }
});

onBeforeUnmount(() => {
  editorView.value?.destroy();
  editorView.value = null;
});

defineExpose({
  undo: undoEditor,
  redo: redoEditor,
  canUndo,
  canRedo,
  focusEditor,
  focusEditorAtStart,
  setSearchTerm,
  findNext,
  findPrevious,
  clearSearch,
  getSearchState
});
</script>

<style lang="less">
.source-editor-pane {
  height: 100%;
  min-height: 100%;
}
</style>
```

- [ ] **Step 2: Run type/build verification**

Run:

```bash
pnpm build
```

Expected: PASS or a TypeScript error pointing to the new CodeMirror file. If there is a type error, fix only the exact type mismatch in `PaneSourceEditor.vue`, then rerun `pnpm build`.

- [ ] **Step 3: Commit the CodeMirror source editor**

```bash
git add src/components/BEditor/components/PaneSourceEditor.vue
git commit -m "feat: use codemirror for source editor"
```

---

### Task 4: Move Tiptap Into `RichEditorHost`

**Files:**
- Create: `src/components/BEditor/components/RichEditorHost.vue`

- [ ] **Step 1: Create the rich editor host**

Create `src/components/BEditor/components/RichEditorHost.vue`:

```vue
<template>
  <PaneRichEditor
    ref="richEditorPaneRef"
    v-model:front-matter-data="frontMatterModel"
    :editor="editorInstance"
    :editor-id="props.editorId"
    :should-show-front-matter-card="shouldShowFrontMatterCard"
  />
</template>

<script setup lang="ts">
import type { EditorController, EditorSearchState } from '../adapters/types';
import type { FrontMatterData } from '../hooks/useFrontMatter';
import type { SearchSnapshot } from '../extensions/Search';
import { computed, ref, toRef, watch } from 'vue';
import { EMPTY_SEARCH_STATE } from '../adapters/types';
import { getSearchSnapshot } from '../extensions/Search';
import { useFrontMatter } from '../hooks/useFrontMatter';
import { useRichEditor } from '../hooks/useRichEditor';
import PaneRichEditor from './PaneRichEditor.vue';

interface Props {
  editable?: boolean;
  editorId?: string;
  onSearchMatchElementFocus?: (targetElement: HTMLElement) => void;
}

const props = withDefaults(defineProps<Props>(), {
  editable: true,
  editorId: ''
});

const editorContent = defineModel<string>('value', { default: '' });
const outlineContent = defineModel<string>('outlineContent', { default: '' });

type RichEditorPaneController = Pick<EditorController, 'undo' | 'redo' | 'canUndo' | 'canRedo' | 'focusEditor' | 'focusEditorAtStart'>;

const richEditorPaneRef = ref<RichEditorPaneController | null>(null);
const editorInstanceId = computed(() => `${props.editorId || ''}`);

const { bodyContent, frontMatterData, hasFrontMatter, updateFrontMatter, reconstructContent } = useFrontMatter(editorContent);
const shouldShowFrontMatterCard = computed(() => Boolean(hasFrontMatter.value));

watch(
  bodyContent,
  (content) => {
    outlineContent.value = content;
  },
  { immediate: true }
);

function syncToExternal(): void {
  editorContent.value = reconstructContent();
}

const frontMatterModel = computed<FrontMatterData>({
  get(): FrontMatterData {
    return frontMatterData.value;
  },
  set(data: FrontMatterData): void {
    updateFrontMatter(data);
    syncToExternal();
  }
});

const { editorInstance, setContent: setRichEditorContent } = useRichEditor({
  bodyContent,
  editable: toRef(props, 'editable'),
  editorInstanceId,
  onContentChange: syncToExternal,
  onSearchMatchFocus: ({ targetElement }) => {
    if (targetElement instanceof HTMLElement) {
      props.onSearchMatchElementFocus?.(targetElement);
    }
  }
});

function setContent(text: string): void {
  setRichEditorContent(text);
}

function undo(): void {
  richEditorPaneRef.value?.undo();
}

function redo(): void {
  richEditorPaneRef.value?.redo();
}

function canUndo(): boolean {
  return richEditorPaneRef.value?.canUndo() ?? false;
}

function canRedo(): boolean {
  return richEditorPaneRef.value?.canRedo() ?? false;
}

function focusEditor(): void {
  richEditorPaneRef.value?.focusEditor();
}

function focusEditorAtStart(): void {
  richEditorPaneRef.value?.focusEditorAtStart();
}

function setSearchTerm(term: string): void {
  editorInstance.value?.commands.setSearchTerm?.(term);
}

function findNext(): void {
  editorInstance.value?.commands.findNext?.();
}

function findPrevious(): void {
  editorInstance.value?.commands.findPrevious?.();
}

function clearSearch(): void {
  editorInstance.value?.commands.clearSearch?.();
}

function getSearchState(): EditorSearchState {
  const snapshot: SearchSnapshot = getSearchSnapshot(editorInstance.value);
  return snapshot ?? { ...EMPTY_SEARCH_STATE };
}

defineExpose({
  setContent,
  undo,
  redo,
  canUndo,
  canRedo,
  focusEditor,
  focusEditorAtStart,
  setSearchTerm,
  findNext,
  findPrevious,
  clearSearch,
  getSearchState
});
</script>
```

- [ ] **Step 2: Run build verification**

Run:

```bash
pnpm build
```

Expected: PASS or a type error from expose typing. If TypeScript reports a component-ref method mismatch, make the exposed methods match `EditorController` exactly and rerun.

- [ ] **Step 3: Commit the rich host**

```bash
git add src/components/BEditor/components/RichEditorHost.vue
git commit -m "refactor: isolate tiptap editor host"
```

---

### Task 5: Simplify `BEditor/index.vue`

**Files:**
- Modify: `src/components/BEditor/index.vue`

- [ ] **Step 1: Replace direct Tiptap orchestration with adapter refs**

In `src/components/BEditor/index.vue`, update the template pane section to:

```vue
<RichEditorHost
  v-if="isRichMode"
  ref="richEditorPaneRef"
  v-model:value="editorContent"
  v-model:outline-content="outlineContent"
  :editor-id="props.editorId"
  :editable="props.editable"
  :on-search-match-element-focus="scrollSearchMatchElementIntoView"
/>

<PaneSourceEditor v-else ref="sourceEditorPaneRef" v-model:value="editorContent" :editable="props.editable" />
```

Keep the existing `BEditorSidebar`, `BScrollbar`, and `FindBar` in `index.vue`.

- [ ] **Step 2: Replace the script with a clean shell**

Replace the `<script setup lang="ts">` block in `src/components/BEditor/index.vue` with:

```ts
import type { EditorController } from './adapters/types';
import type { BEditorPublicInstance, BEditorViewMode } from './types';
import { computed, ref } from 'vue';
import BScrollbar from '@/components/BScrollbar/index.vue';
import FindBar from './components/FindBar.vue';
import PaneSourceEditor from './components/PaneSourceEditor.vue';
import RichEditorHost from './components/RichEditorHost.vue';
import { useAnchors } from './hooks/useAnchors';
import { useEditorController } from './hooks/useEditorController';

const layoutRef = ref<HTMLElement | null>(null);
const scrollbarRef = ref<InstanceType<typeof BScrollbar> | null>(null);

interface Props {
  editable?: boolean;
  // 编辑器实例ID
  editorId?: string;
  // 文件路径
  filePath?: string | null;
  // 编辑器视图模式
  viewMode?: BEditorViewMode;
  // 是否显示大纲
  showOutline?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  editable: true,
  editorId: '',
  filePath: null,
  viewMode: 'rich',
  showOutline: true
});

const emit = defineEmits(['rename-file', 'delete-file', 'show-in-folder']);

const isRichMode = computed(() => props.viewMode === 'rich');
const editorContent = defineModel<string>('value', { default: '' });
const editorTitle = defineModel<string>('title', { default: '' });

const richEditorPaneRef = ref<EditorController | null>(null);
const sourceEditorPaneRef = ref<EditorController | null>(null);
const outlineContent = ref('');
const findBarVisible = ref(false);

const { activeAnchorId, handleChangeAnchor, handleEditorScroll } = useAnchors(layoutRef, scrollbarRef);

const editorController = useEditorController({
  isRichMode,
  richEditorPaneRef,
  sourceEditorPaneRef
});

function scrollSearchMatchElementIntoView(targetElement: HTMLElement): void {
  const scrollElement = scrollbarRef.value?.getScrollElement();
  if (!scrollElement) {
    targetElement.scrollIntoView({ block: 'center', inline: 'nearest' });
    return;
  }

  const scrollRect = scrollElement.getBoundingClientRect();
  const targetRect = targetElement.getBoundingClientRect();
  const centeredTop = scrollElement.scrollTop + (targetRect.top - scrollRect.top) - (scrollElement.clientHeight - targetRect.height) / 2;
  const maxScrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
  const nextTop = Math.min(Math.max(centeredTop, 0), maxScrollTop);

  scrollbarRef.value?.scrollTo({ top: nextTop, behavior: 'auto' });
}

function setContent(text: string): void {
  editorContent.value = text;
}

function undo(): void {
  editorController.value.undo();
}

function redo(): void {
  editorController.value.redo();
}

function canUndo(): boolean {
  return editorController.value.canUndo();
}

function canRedo(): boolean {
  return editorController.value.canRedo();
}

function setSearchTerm(term: string): void {
  editorController.value.setSearchTerm(term);
}

function findNext(): void {
  editorController.value.findNext();
}

function findPrevious(): void {
  editorController.value.findPrevious();
}

function clearSearch(): void {
  editorController.value.clearSearch();
}

function focusEditor(): void {
  editorController.value.focusEditor();
}

function getSearchState(): BEditorPublicInstance['getSearchState'] extends () => infer State ? State : never {
  return editorController.value.getSearchState();
}

const editorPublicInstance = computed<BEditorPublicInstance>(() => ({
  undo,
  redo,
  canUndo,
  canRedo,
  focusEditor,
  setSearchTerm,
  findNext,
  findPrevious,
  clearSearch,
  getSearchState
}));

defineExpose({
  setContent,
  undo,
  redo,
  canUndo,
  canRedo,
  setSearchTerm,
  findNext,
  findPrevious,
  clearSearch,
  focusEditor,
  getSearchState
});
```

- [ ] **Step 3: Remove obsolete imports and refs**

Ensure `index.vue` no longer imports these symbols:

```ts
import type { FrontMatterData } from './hooks/useFrontMatter';
import { useTextareaAutosize } from '@vueuse/core';
import PaneRichEditor from './components/PaneRichEditor.vue';
import { getSearchSnapshot, type SearchScrollContext, type SearchSnapshot } from './extensions/Search';
import { useFrontMatter } from './hooks/useFrontMatter';
import { useRichEditor } from './hooks/useRichEditor';
import { toRef } from 'vue';
```

Ensure `index.vue` no longer declares these local values:

```ts
const editorInstanceCounter = ref(0);
const titleTextareaRef = ref<HTMLTextAreaElement | null>(null);
const editorInstanceId = computed(() => `${props.editorId || ''}`);
const frontMatterModel = computed<FrontMatterData>(...);
const bodyContentForSidebar = computed(...);
const shouldShowFrontMatterCard = computed(...);
```

- [ ] **Step 4: Run tests and build**

Run:

```bash
pnpm test test/components/BEditor/useEditorController.test.ts
pnpm build
```

Expected: Both commands PASS.

- [ ] **Step 5: Commit the clean shell integration**

```bash
git add src/components/BEditor/index.vue
git commit -m "refactor: simplify beditor shell"
```

---

### Task 6: Update Changelog And Final Verification

**Files:**
- Modify: `changelog/2026-04-18.md`

- [ ] **Step 1: Add changelog entries**

Append these bullets under the existing matching sections in `changelog/2026-04-18.md`. If a section is missing, create it using the project format:

```md
## Added
- 为 BEditor 源码模式接入 CodeMirror 6，提供 Markdown 编辑、高亮、行号和历史记录能力。

## Changed
- 重构 BEditor 编辑器适配层，将 Tiptap 富文本逻辑迁移到独立 RichEditorHost，保持 index.vue 专注于布局和模式编排。
```

- [ ] **Step 2: Run lint/build verification**

Run:

```bash
pnpm test test/components/BEditor/useEditorController.test.ts
pnpm build
```

Expected: Both commands PASS with no TypeScript errors.

- [ ] **Step 3: Inspect the BEditor files for forbidden `any`**

Run:

```bash
rg "\\bany\\b" src/components/BEditor
```

Expected: No new `any` usages are introduced. Existing `as unknown as` casts are allowed by the project rules.

- [ ] **Step 4: Commit the changelog**

```bash
git add changelog/2026-04-18.md
git commit -m "docs: update beditor changelog"
```

---

## Self-Review

- Spec coverage: Task 3 replaces textarea with CodeMirror. Tasks 2, 4, and 5 create the adapter boundary and move Tiptap orchestration into `RichEditorHost`. Task 6 satisfies the project changelog rule.
- Placeholder scan: The plan contains no unresolved placeholders or unspecified test steps.
- Type consistency: `EditorController`, `EditorSearchState`, and `BEditorPublicInstance` all resolve through `src/components/BEditor/adapters/types.ts`; component refs in `index.vue` use the same contract for rich and source panes.
