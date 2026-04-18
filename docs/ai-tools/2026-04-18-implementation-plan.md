# AI Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add built-in AI tools for reading and editing the current editor document, with renderer-side orchestration and abstractions that can later support custom tools and MCP.

**Architecture:** The renderer owns tool execution because the active document, selection, and editor instance live there. Electron continues to own model streaming and only transports tool-call events. Tool definitions, execution results, editor context, confirmation, and built-in tools live in focused modules under `src/ai/tools`.

**Tech Stack:** Vue 3, Pinia, TypeScript strict mode, Electron IPC, Vercel AI SDK `streamText`, Vitest, Ant Design Vue modal utilities.

---

## File Structure

Create:

- `src/ai/tools/types.ts` — shared tool contracts, permissions, context, execution result types.
- `src/ai/tools/results.ts` — small helpers for success, failure, and cancellation results.
- `src/ai/tools/editor-context.ts` — active editor tool context registry.
- `src/ai/tools/builtin/read.ts` — read-only built-in tools.
- `src/ai/tools/builtin/write.ts` — write built-in tools.
- `src/ai/tools/builtin/index.ts` — built-in tool registry export.
- `src/ai/tools/confirmation.ts` — write-tool confirmation adapter.
- `src/ai/tools/stream.ts` — renderer-side tool-call loop helpers.
- `test/ai/tools/results.test.ts` — result helper tests.
- `test/ai/tools/editor-context.test.ts` — editor context registry tests.
- `test/ai/tools/builtin-read.test.ts` — read-only built-in tool tests.
- `test/ai/tools/builtin-write.test.ts` — write built-in tool tests.
- `test/ai/tools/stream.test.ts` — tool-call loop helper tests.

Modify:

- `types/ai.d.ts` — add tool request, tool call, and tool result transport types.
- `types/electron-api.d.ts` — add tool-call stream listener.
- `electron/main/modules/ai/service.mts` — pass tools into `streamText`.
- `electron/main/modules/ai/ipc.mts` — forward tool-call chunks to renderer.
- `electron/preload/index.mts` — expose `onAiStreamToolCall`.
- `src/hooks/useChat.ts` — surface tool-call callbacks and accept tools in requests.
- `src/components/BEditor/types.ts` — extend `BEditorPublicInstance`.
- `src/components/BEditor/hooks/useEditorController.ts` — include editor read/write commands.
- `src/components/BEditor/components/PaneRichEditor.vue` — expose rich editor selection and edit commands.
- `src/components/BEditor/components/PaneSourceEditor.vue` — expose source editor selection and edit commands.
- `src/components/BEditor/index.vue` — expose the new public editor methods.
- `src/views/editor/index.vue` — register and unregister active editor tool context.
- `src/components/BChat/types.ts` — add optional tool configuration props.
- `src/components/BChat/index.vue` — connect stream callbacks to tool orchestration and show status.
- `src/components/BChatSidebar/index.vue` — provide built-in tool registry and current editor context.
- `changelog/2026-04-18.md` — record implementation work as it lands.

---

## Task 1: Core Tool Contracts

**Files:**
- Create: `src/ai/tools/types.ts`
- Create: `src/ai/tools/results.ts`
- Test: `test/ai/tools/results.test.ts`

- [ ] **Step 1: Write failing tests for result helpers**

Create `test/ai/tools/results.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createToolCancelledResult, createToolFailureResult, createToolSuccessResult } from '@/ai/tools/results';

describe('AI tool result helpers', () => {
  it('creates a successful result with data', () => {
    const result = createToolSuccessResult('read_current_document', { title: 'Note' });

    expect(result).toEqual({
      toolName: 'read_current_document',
      status: 'success',
      data: { title: 'Note' }
    });
  });

  it('creates a failed result with a stable error code', () => {
    const result = createToolFailureResult('replace_selection', 'NO_SELECTION', '当前没有选区');

    expect(result).toEqual({
      toolName: 'replace_selection',
      status: 'failure',
      error: {
        code: 'NO_SELECTION',
        message: '当前没有选区'
      }
    });
  });

  it('creates a cancelled result', () => {
    const result = createToolCancelledResult('insert_at_cursor');

    expect(result).toEqual({
      toolName: 'insert_at_cursor',
      status: 'cancelled',
      error: {
        code: 'USER_CANCELLED',
        message: '用户取消了工具调用'
      }
    });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm test test/ai/tools/results.test.ts
```

Expected: FAIL because `@/ai/tools/results` does not exist.

- [ ] **Step 3: Add core types**

Create `src/ai/tools/types.ts`:

```ts
export type AIToolSource = 'builtin' | 'custom' | 'mcp';
export type AIToolPermission = 'read' | 'write' | 'dangerous';
export type AIToolExecutionStatus = 'success' | 'failure' | 'cancelled';

export interface AIToolParameterSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface AIToolDefinition {
  name: string;
  description: string;
  source: AIToolSource;
  permission: AIToolPermission;
  parameters: AIToolParameterSchema;
}

export interface EditorSelection {
  from: number;
  to: number;
  text: string;
}

export interface AIToolContext {
  document: {
    id: string;
    title: string;
    path: string | null;
    getContent: () => string;
  };
  editor: {
    getSelection: () => EditorSelection | null;
    insertAtCursor: (content: string) => Promise<void>;
    replaceSelection: (content: string) => Promise<void>;
    replaceDocument: (content: string) => Promise<void>;
  };
}

export interface AIToolExecutionError {
  code:
    | 'TOOL_NOT_FOUND'
    | 'INVALID_INPUT'
    | 'NO_ACTIVE_DOCUMENT'
    | 'NO_SELECTION'
    | 'USER_CANCELLED'
    | 'EDITOR_UNAVAILABLE'
    | 'EXECUTION_FAILED';
  message: string;
}

export interface AIToolExecutionResult<TResult = unknown> {
  toolName: string;
  status: AIToolExecutionStatus;
  data?: TResult;
  error?: AIToolExecutionError;
}

export interface AIToolExecutor<TInput = unknown, TResult = unknown> {
  definition: AIToolDefinition;
  execute: (input: TInput, context: AIToolContext) => Promise<AIToolExecutionResult<TResult>>;
}
```

- [ ] **Step 4: Add result helpers**

Create `src/ai/tools/results.ts`:

```ts
import type { AIToolExecutionError, AIToolExecutionResult } from './types';

export function createToolSuccessResult<TResult>(toolName: string, data: TResult): AIToolExecutionResult<TResult> {
  return { toolName, status: 'success', data };
}

export function createToolFailureResult(toolName: string, code: AIToolExecutionError['code'], message: string): AIToolExecutionResult {
  return { toolName, status: 'failure', error: { code, message } };
}

export function createToolCancelledResult(toolName: string): AIToolExecutionResult {
  return createToolFailureLikeResult(toolName, 'cancelled', 'USER_CANCELLED', '用户取消了工具调用');
}

function createToolFailureLikeResult(
  toolName: string,
  status: 'failure' | 'cancelled',
  code: AIToolExecutionError['code'],
  message: string
): AIToolExecutionResult {
  return { toolName, status, error: { code, message } };
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm test test/ai/tools/results.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ai/tools/types.ts src/ai/tools/results.ts test/ai/tools/results.test.ts
git commit -m "feat: add AI tool core result types"
```

---

## Task 2: Active Editor Tool Context Store

**Files:**
- Create: `src/ai/tools/editor-context.ts`
- Test: `test/ai/tools/editor-context.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/ai/tools/editor-context.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { AIToolContext } from '@/ai/tools/types';
import { createEditorToolContextRegistry } from '@/ai/tools/editor-context';

function createContext(id: string): AIToolContext {
  return {
    document: {
      id,
      title: `Title ${id}`,
      path: null,
      getContent: () => `Content ${id}`
    },
    editor: {
      getSelection: () => null,
      insertAtCursor: async () => undefined,
      replaceSelection: async () => undefined,
      replaceDocument: async () => undefined
    }
  };
}

describe('editor tool context registry', () => {
  it('returns undefined when no active context exists', () => {
    const registry = createEditorToolContextRegistry();

    expect(registry.getCurrentContext()).toBeUndefined();
  });

  it('registers and returns the active context', () => {
    const registry = createEditorToolContextRegistry();
    const context = createContext('editor-1');

    registry.register('editor-1', context);

    expect(registry.getCurrentContext()?.document.id).toBe('editor-1');
    expect(registry.getCurrentContext()?.document.getContent()).toBe('Content editor-1');
  });

  it('removes the active context when it is unregistered', () => {
    const registry = createEditorToolContextRegistry();

    registry.register('editor-1', createContext('editor-1'));
    registry.unregister('editor-1');

    expect(registry.getCurrentContext()).toBeUndefined();
  });

  it('keeps the most recently registered context active', () => {
    const registry = createEditorToolContextRegistry();

    registry.register('editor-1', createContext('editor-1'));
    registry.register('editor-2', createContext('editor-2'));

    expect(registry.getCurrentContext()?.document.id).toBe('editor-2');
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm test test/ai/tools/editor-context.test.ts
```

Expected: FAIL because `@/ai/tools/editor-context` does not exist.

- [ ] **Step 3: Implement the registry**

Create `src/ai/tools/editor-context.ts`:

```ts
import type { AIToolContext } from './types';

export interface EditorToolContextRegistry {
  register: (editorId: string, context: AIToolContext) => void;
  unregister: (editorId: string) => void;
  getCurrentContext: () => AIToolContext | undefined;
}

export function createEditorToolContextRegistry(): EditorToolContextRegistry {
  const contexts = new Map<string, AIToolContext>();
  let activeEditorId: string | null = null;

  return {
    register(editorId: string, context: AIToolContext): void {
      contexts.set(editorId, context);
      activeEditorId = editorId;
    },
    unregister(editorId: string): void {
      contexts.delete(editorId);

      if (activeEditorId === editorId) {
        activeEditorId = Array.from(contexts.keys()).at(-1) ?? null;
      }
    },
    getCurrentContext(): AIToolContext | undefined {
      return activeEditorId ? contexts.get(activeEditorId) : undefined;
    }
  };
}

export const editorToolContextRegistry = createEditorToolContextRegistry();
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm test test/ai/tools/editor-context.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/tools/editor-context.ts test/ai/tools/editor-context.test.ts
git commit -m "feat: add active editor tool context registry"
```

---

## Task 3: Built-In Read Tools

**Files:**
- Create: `src/ai/tools/builtin/read.ts`
- Create: `src/ai/tools/builtin/index.ts`
- Test: `test/ai/tools/builtin-read.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/ai/tools/builtin-read.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { AIToolContext } from '@/ai/tools/types';
import { createBuiltinReadTools } from '@/ai/tools/builtin/read';

function createContext(content = 'alpha beta\nbeta gamma'): AIToolContext {
  return {
    document: {
      id: 'doc-1',
      title: 'My Note',
      path: '/tmp/my-note.md',
      getContent: () => content
    },
    editor: {
      getSelection: () => ({ from: 1, to: 5, text: 'lpha' }),
      insertAtCursor: async () => undefined,
      replaceSelection: async () => undefined,
      replaceDocument: async () => undefined
    }
  };
}

describe('built-in read tools', () => {
  it('reads the current document', async () => {
    const tools = createBuiltinReadTools();
    const result = await tools.readCurrentDocument.execute({}, createContext());

    expect(result.status).toBe('success');
    expect(result.data).toEqual({
      id: 'doc-1',
      title: 'My Note',
      path: '/tmp/my-note.md',
      content: 'alpha beta\nbeta gamma'
    });
  });

  it('reads the current selection', async () => {
    const tools = createBuiltinReadTools();
    const result = await tools.getCurrentSelection.execute({}, createContext());

    expect(result.status).toBe('success');
    expect(result.data).toEqual({ from: 1, to: 5, text: 'lpha' });
  });

  it('returns an empty selection when nothing is selected', async () => {
    const context = createContext();
    context.editor.getSelection = () => null;

    const tools = createBuiltinReadTools();
    const result = await tools.getCurrentSelection.execute({}, context);

    expect(result.status).toBe('success');
    expect(result.data).toEqual({ from: 0, to: 0, text: '' });
  });

  it('searches the current document case-insensitively', async () => {
    const tools = createBuiltinReadTools();
    const result = await tools.searchCurrentDocument.execute({ query: 'BETA' }, createContext());

    expect(result.status).toBe('success');
    expect(result.data).toEqual({
      query: 'BETA',
      matchCount: 2,
      matches: [
        { index: 6, preview: 'alpha beta\nbeta gamma' },
        { index: 11, preview: 'alpha beta\nbeta gamma' }
      ]
    });
  });

  it('rejects empty search input', async () => {
    const tools = createBuiltinReadTools();
    const result = await tools.searchCurrentDocument.execute({ query: '   ' }, createContext());

    expect(result.status).toBe('failure');
    expect(result.error?.code).toBe('INVALID_INPUT');
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm test test/ai/tools/builtin-read.test.ts
```

Expected: FAIL because `@/ai/tools/builtin/read` does not exist.

- [ ] **Step 3: Implement read tools**

Create `src/ai/tools/builtin/read.ts`:

```ts
import type { AIToolContext, AIToolExecutor, EditorSelection } from '../types';
import { createToolFailureResult, createToolSuccessResult } from '../results';

export interface ReadCurrentDocumentResult {
  id: string;
  title: string;
  path: string | null;
  content: string;
}

export interface SearchCurrentDocumentInput {
  query: string;
}

export interface SearchCurrentDocumentMatch {
  index: number;
  preview: string;
}

export interface SearchCurrentDocumentResult {
  query: string;
  matchCount: number;
  matches: SearchCurrentDocumentMatch[];
}

function buildPreview(content: string, index: number): string {
  const start = Math.max(0, index - 80);
  const end = Math.min(content.length, index + 80);

  return content.slice(start, end);
}

function searchContent(content: string, query: string): SearchCurrentDocumentMatch[] {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matches: SearchCurrentDocumentMatch[] = [];
  let index = lowerContent.indexOf(lowerQuery);

  while (index !== -1 && matches.length < 20) {
    matches.push({ index, preview: buildPreview(content, index) });
    index = lowerContent.indexOf(lowerQuery, index + lowerQuery.length);
  }

  return matches;
}

export function createBuiltinReadTools(): {
  readCurrentDocument: AIToolExecutor<Record<string, never>, ReadCurrentDocumentResult>;
  getCurrentSelection: AIToolExecutor<Record<string, never>, EditorSelection>;
  searchCurrentDocument: AIToolExecutor<SearchCurrentDocumentInput, SearchCurrentDocumentResult>;
} {
  return {
    readCurrentDocument: {
      definition: {
        name: 'read_current_document',
        description: '读取当前编辑器文档的标题、路径和 Markdown 内容。',
        source: 'builtin',
        permission: 'read',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      },
      async execute(_input: Record<string, never>, context: AIToolContext) {
        return createToolSuccessResult('read_current_document', {
          id: context.document.id,
          title: context.document.title,
          path: context.document.path,
          content: context.document.getContent()
        });
      }
    },
    getCurrentSelection: {
      definition: {
        name: 'get_current_selection',
        description: '读取当前编辑器选区文本和范围。',
        source: 'builtin',
        permission: 'read',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      },
      async execute(_input: Record<string, never>, context: AIToolContext) {
        return createToolSuccessResult('get_current_selection', context.editor.getSelection() ?? { from: 0, to: 0, text: '' });
      }
    },
    searchCurrentDocument: {
      definition: {
        name: 'search_current_document',
        description: '在当前文档中搜索关键词并返回匹配片段。',
        source: 'builtin',
        permission: 'read',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '要搜索的关键词。' }
          },
          required: ['query'],
          additionalProperties: false
        }
      },
      async execute(input: SearchCurrentDocumentInput, context: AIToolContext) {
        const query = typeof input.query === 'string' ? input.query.trim() : '';
        if (!query) {
          return createToolFailureResult('search_current_document', 'INVALID_INPUT', '搜索关键词不能为空');
        }

        const matches = searchContent(context.document.getContent(), query);

        return createToolSuccessResult('search_current_document', { query: input.query, matchCount: matches.length, matches });
      }
    }
  };
}
```

- [ ] **Step 4: Add built-in registry export**

Create `src/ai/tools/builtin/index.ts`:

```ts
import type { AIToolExecutor } from '../types';
import { createBuiltinReadTools } from './read';

export function createBuiltinTools(): AIToolExecutor[] {
  const readTools = createBuiltinReadTools();

  return [readTools.readCurrentDocument, readTools.getCurrentSelection, readTools.searchCurrentDocument];
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm test test/ai/tools/builtin-read.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ai/tools/builtin/read.ts src/ai/tools/builtin/index.ts test/ai/tools/builtin-read.test.ts
git commit -m "feat: add built-in AI read tools"
```

---

## Task 4: Editor Public Read/Write Methods

**Files:**
- Modify: `src/components/BEditor/types.ts`
- Modify: `src/components/BEditor/hooks/useEditorController.ts`
- Modify: `src/components/BEditor/components/PaneRichEditor.vue`
- Modify: `src/components/BEditor/components/PaneSourceEditor.vue`
- Modify: `src/components/BEditor/index.vue`

- [ ] **Step 1: Extend public types**

Modify `src/components/BEditor/types.ts`:

```ts
export type BEditorViewMode = 'rich' | 'source';

export interface SelectionRange {
  // 选中的文本起始位置
  from: number;
  //  选择结束位置
  to: number;
  // 选中的文本内容
  text: string;
}

export interface EditorSearchState {
  currentIndex: number;
  matchCount: number;
  term: string;
}

export interface BEditorPublicInstance {
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  setSearchTerm: (term: string) => void;
  findNext: () => void;
  findPrevious: () => void;
  clearSearch: () => void;
  focusEditor: () => void;
  getSearchState: () => EditorSearchState;
  getSelection: () => SelectionRange | null;
  insertAtCursor: (content: string) => Promise<void>;
  replaceSelection: (content: string) => Promise<void>;
  replaceDocument: (content: string) => Promise<void>;
}
```

- [ ] **Step 2: Extend `EditorController`**

Modify `src/components/BEditor/hooks/useEditorController.ts` so `EditorController` includes:

```ts
export interface EditorController {
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  focusEditor: () => void;
  focusEditorAtStart: () => void;
  getSelection: () => SelectionRange | null;
  insertAtCursor: (content: string) => Promise<void>;
  replaceSelection: (content: string) => Promise<void>;
  replaceDocument: (content: string) => Promise<void>;
}
```

Add `SelectionRange` import:

```ts
import type { SelectionRange } from '../types';
```

Use this source-mode fallback inside `sourceEditorController`:

```ts
getSelection(): SelectionRange | null {
  return sourceEditorPaneRef.value?.getSelection() ?? null;
},
async insertAtCursor(content: string): Promise<void> {
  await sourceEditorPaneRef.value?.insertAtCursor(content);
},
async replaceSelection(content: string): Promise<void> {
  await sourceEditorPaneRef.value?.replaceSelection(content);
},
async replaceDocument(content: string): Promise<void> {
  await sourceEditorPaneRef.value?.replaceDocument(content);
}
```

Update `UseEditorControllerParams` so `sourceEditorPaneRef` can expose the full editor command subset:

```ts
sourceEditorPaneRef: Ref<Pick<EditorController, 'focusEditor' | 'focusEditorAtStart' | 'getSelection' | 'insertAtCursor' | 'replaceSelection' | 'replaceDocument'> | null>;
```

- [ ] **Step 3: Expose rich editor methods**

Modify the script section of `src/components/BEditor/components/PaneRichEditor.vue` by importing `TextSelection`:

```ts
import { TextSelection } from '@tiptap/pm/state';
```

Add methods near the existing editor commands:

```ts
function getSelection(): SelectionRange | null {
  const editor = props.editor;
  if (!editor) return null;

  const { from, to } = editor.state.selection;
  if (from === to) return null;

  return { from, to, text: editor.state.doc.textBetween(from, to, '') };
}

async function insertAtCursor(content: string): Promise<void> {
  props.editor?.chain().focus().insertContent(content).run();
}

async function replaceSelection(content: string): Promise<void> {
  const editor = props.editor;
  if (!editor) return;

  const { from, to } = editor.state.selection;
  if (from === to) return;

  editor.chain().focus().insertContentAt({ from, to }, content).run();
}

async function replaceDocument(content: string): Promise<void> {
  const editor = props.editor;
  if (!editor) return;

  editor.commands.setContent(content, { contentType: 'markdown', emitUpdate: true });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 0)));
}
```

Update expose:

```ts
defineExpose({ undo, redo, canUndo, canRedo, focusEditor, focusEditorAtStart, getSelection, insertAtCursor, replaceSelection, replaceDocument });
```

- [ ] **Step 4: Expose source editor methods**

Modify `src/components/BEditor/components/PaneSourceEditor.vue`:

```ts
import type { SelectionRange } from '../types';
import { ref } from 'vue';
import { useTextareaAutosize } from '@vueuse/core';
```

Add methods:

```ts
function getSelection(): SelectionRange | null {
  const textarea = sourceTextareaRef.value;
  if (!textarea || textarea.selectionStart === textarea.selectionEnd) return null;

  const from = textarea.selectionStart;
  const to = textarea.selectionEnd;

  return { from, to, text: editorContent.value.slice(from, to) };
}

async function insertAtCursor(content: string): Promise<void> {
  const textarea = sourceTextareaRef.value;
  if (!textarea) return;

  const from = textarea.selectionStart;
  const to = textarea.selectionEnd;
  editorContent.value = `${editorContent.value.slice(0, from)}${content}${editorContent.value.slice(to)}`;
  textarea.focus();
  const nextPosition = from + content.length;
  textarea.setSelectionRange(nextPosition, nextPosition);
}

async function replaceSelection(content: string): Promise<void> {
  const selection = getSelection();
  if (!selection) return;

  const textarea = sourceTextareaRef.value;
  editorContent.value = `${editorContent.value.slice(0, selection.from)}${content}${editorContent.value.slice(selection.to)}`;
  textarea?.focus();
  const nextPosition = selection.from + content.length;
  textarea?.setSelectionRange(nextPosition, nextPosition);
}

async function replaceDocument(content: string): Promise<void> {
  editorContent.value = content;
  sourceTextareaRef.value?.focus();
  sourceTextareaRef.value?.setSelectionRange(0, 0);
}
```

Update expose:

```ts
defineExpose({ focusEditor, focusEditorAtStart, getSelection, insertAtCursor, replaceSelection, replaceDocument });
```

- [ ] **Step 5: Expose methods from `BEditor`**

Modify `src/components/BEditor/index.vue` by adding wrapper functions:

```ts
function getSelection(): SelectionRange | null {
  return editorController.value.getSelection();
}

async function insertAtCursor(content: string): Promise<void> {
  await editorController.value.insertAtCursor(content);
}

async function replaceSelection(content: string): Promise<void> {
  await editorController.value.replaceSelection(content);
}

async function replaceDocument(content: string): Promise<void> {
  editorContent.value = content;
  if (isRichMode.value) {
    setRichEditorContent(content);
  } else {
    await editorController.value.replaceDocument(content);
  }
}
```

Import `SelectionRange`:

```ts
import type { BEditorPublicInstance, BEditorViewMode, SelectionRange } from './types';
```

Add the methods to `editorPublicInstance` and `defineExpose`.

- [ ] **Step 6: Run type check**

Run:

```bash
pnpm build
```

Expected: PASS through `vue-tsc --noEmit` and Vite build.

- [ ] **Step 7: Commit**

```bash
git add src/components/BEditor/types.ts src/components/BEditor/hooks/useEditorController.ts src/components/BEditor/components/PaneRichEditor.vue src/components/BEditor/components/PaneSourceEditor.vue src/components/BEditor/index.vue
git commit -m "feat: expose editor methods for AI tools"
```

---

## Task 5: Register Active Editor Context

**Files:**
- Modify: `src/views/editor/index.vue`

- [ ] **Step 1: Register context on editor page**

Modify `src/views/editor/index.vue` imports:

```ts
import { computed, onBeforeUnmount, watchEffect, ref } from 'vue';
import { editorToolContextRegistry } from '@/ai/tools/editor-context';
```

Add after `editorRef`:

```ts
watchEffect(() => {
  const id = fileState.value.id;
  if (!id) return;

  editorToolContextRegistry.register(id, {
    document: {
      id,
      title: fileState.value.name,
      path: fileState.value.path,
      getContent: () => fileState.value.content
    },
    editor: {
      getSelection: () => editorRef.value?.getSelection() ?? null,
      insertAtCursor: async (content: string): Promise<void> => {
        await editorRef.value?.insertAtCursor(content);
      },
      replaceSelection: async (content: string): Promise<void> => {
        await editorRef.value?.replaceSelection(content);
      },
      replaceDocument: async (content: string): Promise<void> => {
        fileState.value.content = content;
        await editorRef.value?.replaceDocument(content);
      }
    }
  });
});

onBeforeUnmount(() => {
  const id = fileState.value.id;
  if (id) {
    editorToolContextRegistry.unregister(id);
  }
});
```

- [ ] **Step 2: Run type check**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/views/editor/index.vue
git commit -m "feat: register active editor context for AI tools"
```

---

## Task 6: Write Tool Confirmation and Built-In Write Tools

**Files:**
- Create: `src/ai/tools/confirmation.ts`
- Create: `src/ai/tools/builtin/write.ts`
- Modify: `src/ai/tools/builtin/index.ts`
- Test: `test/ai/tools/builtin-write.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/ai/tools/builtin-write.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { AIToolContext } from '@/ai/tools/types';
import { createBuiltinWriteTools } from '@/ai/tools/builtin/write';

function createContext(): AIToolContext {
  return {
    document: {
      id: 'doc-1',
      title: 'My Note',
      path: null,
      getContent: () => 'Hello world'
    },
    editor: {
      getSelection: () => ({ from: 0, to: 5, text: 'Hello' }),
      insertAtCursor: vi.fn(async () => undefined),
      replaceSelection: vi.fn(async () => undefined),
      replaceDocument: vi.fn(async () => undefined)
    }
  };
}

describe('built-in write tools', () => {
  it('inserts content after confirmation', async () => {
    const context = createContext();
    const tools = createBuiltinWriteTools({ confirm: async () => true });

    const result = await tools.insertAtCursor.execute({ content: 'New text' }, context);

    expect(result.status).toBe('success');
    expect(context.editor.insertAtCursor).toHaveBeenCalledWith('New text');
  });

  it('does not insert content when user cancels', async () => {
    const context = createContext();
    const tools = createBuiltinWriteTools({ confirm: async () => false });

    const result = await tools.insertAtCursor.execute({ content: 'New text' }, context);

    expect(result.status).toBe('cancelled');
    expect(context.editor.insertAtCursor).not.toHaveBeenCalled();
  });

  it('replaces selection after confirmation', async () => {
    const context = createContext();
    const tools = createBuiltinWriteTools({ confirm: async () => true });

    const result = await tools.replaceSelection.execute({ content: 'Hi' }, context);

    expect(result.status).toBe('success');
    expect(context.editor.replaceSelection).toHaveBeenCalledWith('Hi');
  });

  it('fails replace selection when there is no selection', async () => {
    const context = createContext();
    context.editor.getSelection = () => null;
    const tools = createBuiltinWriteTools({ confirm: async () => true });

    const result = await tools.replaceSelection.execute({ content: 'Hi' }, context);

    expect(result.status).toBe('failure');
    expect(result.error?.code).toBe('NO_SELECTION');
    expect(context.editor.replaceSelection).not.toHaveBeenCalled();
  });

  it('treats replace document as dangerous and executes after confirmation', async () => {
    const context = createContext();
    const tools = createBuiltinWriteTools({ confirm: async (request) => request.permission === 'dangerous' });

    const result = await tools.replaceDocument.execute({ content: '# New document' }, context);

    expect(result.status).toBe('success');
    expect(context.editor.replaceDocument).toHaveBeenCalledWith('# New document');
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
pnpm test test/ai/tools/builtin-write.test.ts
```

Expected: FAIL because `@/ai/tools/builtin/write` does not exist.

- [ ] **Step 3: Add confirmation adapter**

Create `src/ai/tools/confirmation.ts`:

```ts
import type { AIToolPermission } from './types';

export interface AIToolConfirmationRequest {
  toolName: string;
  title: string;
  description: string;
  permission: AIToolPermission;
  beforeText?: string;
  afterText?: string;
}

export interface AIToolConfirmationAdapter {
  confirm: (request: AIToolConfirmationRequest) => Promise<boolean>;
}
```

- [ ] **Step 4: Implement write tools**

Create `src/ai/tools/builtin/write.ts`:

```ts
import type { AIToolConfirmationAdapter } from '../confirmation';
import type { AIToolContext, AIToolExecutor } from '../types';
import { createToolCancelledResult, createToolFailureResult, createToolSuccessResult } from '../results';

export interface EditorContentInput {
  content: string;
}

function readContentInput(input: EditorContentInput, toolName: string) {
  const content = typeof input.content === 'string' ? input.content : '';
  if (!content) {
    return createToolFailureResult(toolName, 'INVALID_INPUT', '写入内容不能为空');
  }

  return content;
}

export function createBuiltinWriteTools(adapter: AIToolConfirmationAdapter): {
  insertAtCursor: AIToolExecutor<EditorContentInput, { applied: true }>;
  replaceSelection: AIToolExecutor<EditorContentInput, { applied: true }>;
  replaceDocument: AIToolExecutor<EditorContentInput, { applied: true }>;
} {
  return {
    insertAtCursor: {
      definition: {
        name: 'insert_at_cursor',
        description: '在当前光标处插入 Markdown 内容。',
        source: 'builtin',
        permission: 'write',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '要插入的 Markdown 内容。' }
          },
          required: ['content'],
          additionalProperties: false
        }
      },
      async execute(input: EditorContentInput, context: AIToolContext) {
        const content = readContentInput(input, 'insert_at_cursor');
        if (typeof content !== 'string') return content;

        const confirmed = await adapter.confirm({
          toolName: 'insert_at_cursor',
          title: 'AI 想要插入内容',
          description: '将在当前光标处插入 Markdown 内容。',
          permission: 'write',
          afterText: content
        });

        if (!confirmed) return createToolCancelledResult('insert_at_cursor');

        await context.editor.insertAtCursor(content);
        return createToolSuccessResult('insert_at_cursor', { applied: true });
      }
    },
    replaceSelection: {
      definition: {
        name: 'replace_selection',
        description: '替换当前编辑器选区。',
        source: 'builtin',
        permission: 'write',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '用于替换选区的新 Markdown 内容。' }
          },
          required: ['content'],
          additionalProperties: false
        }
      },
      async execute(input: EditorContentInput, context: AIToolContext) {
        const selection = context.editor.getSelection();
        if (!selection) return createToolFailureResult('replace_selection', 'NO_SELECTION', '当前没有选区');

        const content = readContentInput(input, 'replace_selection');
        if (typeof content !== 'string') return content;

        const confirmed = await adapter.confirm({
          toolName: 'replace_selection',
          title: 'AI 想要替换当前选区',
          description: '将用新内容替换当前选中的文本。',
          permission: 'write',
          beforeText: selection.text,
          afterText: content
        });

        if (!confirmed) return createToolCancelledResult('replace_selection');

        await context.editor.replaceSelection(content);
        return createToolSuccessResult('replace_selection', { applied: true });
      }
    },
    replaceDocument: {
      definition: {
        name: 'replace_document',
        description: '替换当前文档全文。',
        source: 'builtin',
        permission: 'dangerous',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '新的完整 Markdown 文档内容。' }
          },
          required: ['content'],
          additionalProperties: false
        }
      },
      async execute(input: EditorContentInput, context: AIToolContext) {
        const content = readContentInput(input, 'replace_document');
        if (typeof content !== 'string') return content;

        const confirmed = await adapter.confirm({
          toolName: 'replace_document',
          title: 'AI 想要替换全文',
          description: '这会替换当前文档的全部内容。',
          permission: 'dangerous',
          beforeText: context.document.getContent(),
          afterText: content
        });

        if (!confirmed) return createToolCancelledResult('replace_document');

        await context.editor.replaceDocument(content);
        return createToolSuccessResult('replace_document', { applied: true });
      }
    }
  };
}
```

- [ ] **Step 5: Update built-in registry**

Modify `src/ai/tools/builtin/index.ts`:

```ts
import type { AIToolConfirmationAdapter } from '../confirmation';
import type { AIToolExecutor } from '../types';
import { createBuiltinReadTools } from './read';
import { createBuiltinWriteTools } from './write';

export function createBuiltinTools(adapter: AIToolConfirmationAdapter): AIToolExecutor[] {
  const readTools = createBuiltinReadTools();
  const writeTools = createBuiltinWriteTools(adapter);

  return [
    readTools.readCurrentDocument,
    readTools.getCurrentSelection,
    readTools.searchCurrentDocument,
    writeTools.insertAtCursor,
    writeTools.replaceSelection,
    writeTools.replaceDocument
  ];
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm test test/ai/tools/builtin-write.test.ts test/ai/tools/builtin-read.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ai/tools/confirmation.ts src/ai/tools/builtin/write.ts src/ai/tools/builtin/index.ts test/ai/tools/builtin-write.test.ts
git commit -m "feat: add confirmed built-in AI write tools"
```

---

## Task 7: AI Tool Transport Types and Electron Stream Event

**Files:**
- Modify: `types/ai.d.ts`
- Modify: `types/electron-api.d.ts`
- Modify: `electron/main/modules/ai/service.mts`
- Modify: `electron/main/modules/ai/ipc.mts`
- Modify: `electron/preload/index.mts`

- [ ] **Step 1: Add AI transport types**

Modify `types/ai.d.ts` by adding these exports:

```ts
export interface AITransportTool {
  name: string;
  description: string;
  parameters: unknown;
}

export interface AIStreamToolCallChunk {
  toolCallId: string;
  toolName: string;
  input: unknown;
}
```

Extend `AIRequestOptions`:

```ts
  // 可供模型调用的工具定义
  tools?: AITransportTool[];
```

- [ ] **Step 2: Add Electron API listener type**

Modify `types/electron-api.d.ts` imports:

```ts
import type { AICreateOptions, AIRequestOptions, AIServiceError, AIInvokeResult, AIStreamFinishChunk, AIStreamToolCallChunk } from './ai';
```

Add listener:

```ts
  onAiStreamToolCall: (callback: (payload: AIStreamToolCallChunk) => void) => () => void;
```

- [ ] **Step 3: Pass tools into Vercel AI SDK**

Modify `electron/main/modules/ai/service.mts` import:

```ts
import { generateText, jsonSchema, streamText, tool } from 'ai';
```

Add helper above `class AIService`:

```ts
function toSdkTools(tools: AIRequestOptions['tools']) {
  if (!tools?.length) return undefined;

  return Object.fromEntries(
    tools.map((item) => [
      item.name,
      tool({
        description: item.description,
        inputSchema: jsonSchema(item.parameters)
      })
    ])
  );
}
```

In `streamText`, include SDK tools:

```ts
const baseOptions = { model, system, temperature, abortSignal, tools: toSdkTools(request.tools) };
```

- [ ] **Step 4: Forward tool-call chunks**

Modify `electron/main/modules/ai/ipc.mts` inside the stream loop:

```ts
      for await (const chunk of result.stream) {
        if (chunk.type === 'text-delta') {
          process.stdout.write(chunk.text);

          win.webContents.send('ai:stream:chunk', chunk.text);
        } else if (chunk.type === 'tool-call') {
          win.webContents.send('ai:stream:tool-call', {
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            input: chunk.input
          });
        } else if (chunk.type === 'error') {
          win.webContents.send('ai:stream:error', chunk.error);
        } else if (chunk.type === 'finish') {
          const { inputTokens, outputTokens, totalTokens } = chunk.totalUsage;

          win.webContents.send('ai:stream:finish', { usage: { inputTokens, outputTokens, totalTokens } });
        }
      }
```

- [ ] **Step 5: Expose preload listener**

Modify `electron/preload/index.mts`:

```ts
  onAiStreamToolCall: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AIStreamToolCallChunk) => callback(payload);

    ipcRenderer.on('ai:stream:tool-call', handler);
    return () => {
      ipcRenderer.removeListener('ai:stream:tool-call', handler);
    };
  },
```

Add type import if needed:

```ts
import type { AIStreamToolCallChunk } from '../../types/ai';
```

- [ ] **Step 6: Run type checks**

Run:

```bash
pnpm build
pnpm run electron:build-main
```

Expected: both PASS. If the installed AI SDK exposes different chunk field names, update only this task's Electron mapping and keep renderer transport payload as `AIStreamToolCallChunk`.

- [ ] **Step 7: Commit**

```bash
git add types/ai.d.ts types/electron-api.d.ts electron/main/modules/ai/service.mts electron/main/modules/ai/ipc.mts electron/preload/index.mts
git commit -m "feat: forward AI tool call stream events"
```

---

## Task 8: Renderer Tool Call Loop Helpers

**Files:**
- Create: `src/ai/tools/stream.ts`
- Test: `test/ai/tools/stream.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/ai/tools/stream.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { AIToolContext, AIToolExecutor } from '@/ai/tools/types';
import { executeToolCall } from '@/ai/tools/stream';
import { createToolSuccessResult } from '@/ai/tools/results';

function createContext(): AIToolContext {
  return {
    document: {
      id: 'doc-1',
      title: 'Note',
      path: null,
      getContent: () => 'content'
    },
    editor: {
      getSelection: () => null,
      insertAtCursor: async () => undefined,
      replaceSelection: async () => undefined,
      replaceDocument: async () => undefined
    }
  };
}

const echoTool: AIToolExecutor<{ value: string }, { value: string }> = {
  definition: {
    name: 'echo',
    description: 'Echo value',
    source: 'builtin',
    permission: 'read',
    parameters: {
      type: 'object',
      properties: {
        value: { type: 'string' }
      },
      required: ['value'],
      additionalProperties: false
    }
  },
  async execute(input) {
    return createToolSuccessResult('echo', { value: input.value });
  }
};

describe('executeToolCall', () => {
  it('executes a registered tool', async () => {
    const result = await executeToolCall({ toolCallId: 'call-1', toolName: 'echo', input: { value: 'hi' } }, [echoTool], createContext());

    expect(result).toEqual({
      toolCallId: 'call-1',
      toolName: 'echo',
      result: {
        toolName: 'echo',
        status: 'success',
        data: { value: 'hi' }
      }
    });
  });

  it('returns a failure for unknown tools', async () => {
    const result = await executeToolCall({ toolCallId: 'call-2', toolName: 'missing', input: {} }, [echoTool], createContext());

    expect(result.result.status).toBe('failure');
    expect(result.result.error?.code).toBe('TOOL_NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm test test/ai/tools/stream.test.ts
```

Expected: FAIL because `@/ai/tools/stream` does not exist.

- [ ] **Step 3: Implement helper**

Create `src/ai/tools/stream.ts`:

```ts
import type { AIStreamToolCallChunk } from 'types/ai';
import type { AIToolContext, AIToolExecutionResult, AIToolExecutor } from './types';
import { createToolFailureResult } from './results';

export interface ExecutedToolCall {
  toolCallId: string;
  toolName: string;
  result: AIToolExecutionResult;
}

export function toTransportTools(tools: AIToolExecutor[]) {
  return tools.map((item) => ({
    name: item.definition.name,
    description: item.definition.description,
    parameters: item.definition.parameters
  }));
}

export async function executeToolCall(
  call: AIStreamToolCallChunk,
  tools: AIToolExecutor[],
  context: AIToolContext | undefined
): Promise<ExecutedToolCall> {
  const executor = tools.find((item) => item.definition.name === call.toolName);

  if (!executor) {
    return {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      result: createToolFailureResult(call.toolName, 'TOOL_NOT_FOUND', `未找到工具：${call.toolName}`)
    };
  }

  if (!context) {
    return {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      result: createToolFailureResult(call.toolName, 'NO_ACTIVE_DOCUMENT', '当前没有可用的编辑器文档')
    };
  }

  return {
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    result: await executor.execute(call.input, context)
  };
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm test test/ai/tools/stream.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ai/tools/stream.ts test/ai/tools/stream.test.ts
git commit -m "feat: add renderer AI tool call executor"
```

---

## Task 9: Hook Tool Events Through `useChat`

**Files:**
- Modify: `src/hooks/useChat.ts`

- [ ] **Step 1: Extend hook options**

Modify imports:

```ts
import type { AIServiceError, AIRequestOptions, AICreateOptions, AIStreamFinishChunk, AIStreamToolCallChunk } from 'types/ai';
```

Extend `UseStreamOptions`:

```ts
  /** 工具调用回调 */
  onToolCall?: (chunk: AIStreamToolCallChunk) => void;
```

- [ ] **Step 2: Subscribe and clean up tool-call listener**

Inside `onStream`, add after `cleanupFinish`:

```ts
    const cleanupToolCall = electronAPI.onAiStreamToolCall((toolCallChunk) => {
      options.onToolCall?.(toolCallChunk);
    });
```

Update `cleanupAll()`:

```ts
      cleanupToolCall();
```

- [ ] **Step 3: Run type check**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useChat.ts
git commit -m "feat: expose AI tool call events in chat hook"
```

---

## Task 10: Connect Built-In Tools to `BChatSidebar`

**Files:**
- Modify: `src/components/BChat/types.ts`
- Modify: `src/components/BChat/index.vue`
- Modify: `src/components/BChatSidebar/index.vue`

- [ ] **Step 1: Extend BChat props**

Modify `src/components/BChat/types.ts`:

```ts
import type { AIToolExecutor } from '@/ai/tools/types';
import type { AIToolContext } from '@/ai/tools/types';
```

Extend `BChatProps`:

```ts
  tools?: AIToolExecutor[];
  getToolContext?: () => AIToolContext | undefined;
```

- [ ] **Step 2: Pass tools to AI request**

Modify `src/components/BChat/index.vue` imports:

```ts
import type { AIServiceError, AIStreamFinishChunk, AIStreamToolCallChunk } from 'types/ai';
import { executeToolCall, toTransportTools } from '@/ai/tools/stream';
```

Add local state:

```ts
const toolStatus = ref('');
```

Add `onToolCall` to `useChat`:

```ts
  onToolCall: async (chunk: AIStreamToolCallChunk): Promise<void> => {
    toolStatus.value = `正在执行工具：${chunk.toolName}`;
    const result = await executeToolCall(chunk, props.tools ?? [], props.getToolContext?.());
    toolStatus.value = result.result.status === 'success' ? `工具已完成：${chunk.toolName}` : `工具执行失败：${chunk.toolName}`;
  },
```

Update `streamMessages`:

```ts
function streamMessages(_messages: Message[], config: ServiceConfig): void {
  loading.value = true;

  agent.stream({
    messages: _messages,
    modelId: config.modelId,
    providerId: config.providerId,
    tools: props.tools?.length ? toTransportTools(props.tools) : undefined
  });

  messages.value.push(createAssistantPlaceholder());
}
```

Add simple status rendering below messages:

```vue
<div v-if="toolStatus" class="b-chat__tool-status">{{ toolStatus }}</div>
```

Add styles:

```less
.b-chat__tool-status {
  padding: 0 16px 12px;
  font-size: 12px;
  color: var(--text-secondary);
}
```

This task only surfaces tool calls and executes tools. The full second model round with tool results is Task 11.

- [ ] **Step 3: Create confirmation adapter in sidebar**

Modify `src/components/BChatSidebar/index.vue` imports:

```ts
import { Modal } from '@/utils/modal';
import type { AIToolConfirmationRequest } from '@/ai/tools/confirmation';
import { createBuiltinTools } from '@/ai/tools/builtin';
import { editorToolContextRegistry } from '@/ai/tools/editor-context';
```

Add:

```ts
async function confirmToolUse(request: AIToolConfirmationRequest): Promise<boolean> {
  const description = [request.description, request.beforeText ? `原文：\n${request.beforeText}` : '', request.afterText ? `新内容：\n${request.afterText}` : '']
    .filter(Boolean)
    .join('\n\n');

  const [, confirmed] = await Modal.confirm(request.title, description, { confirmText: '应用', cancelText: '取消' });

  return confirmed;
}

const tools = createBuiltinTools({ confirm: confirmToolUse });
```

Pass props to `BChat`:

```vue
:tools="tools"
:get-tool-context="editorToolContextRegistry.getCurrentContext"
```

- [ ] **Step 4: Run type check**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/BChat/types.ts src/components/BChat/index.vue src/components/BChatSidebar/index.vue
git commit -m "feat: connect built-in AI tools to chat sidebar"
```

---

## Task 11: Continue Model Stream After Tool Results

**Files:**
- Modify: `types/ai.d.ts`
- Modify: `src/ai/tools/stream.ts`
- Modify: `src/components/BChat/index.vue`
- Test: `test/ai/tools/stream.test.ts`

- [ ] **Step 1: Add transport tool result type**

Modify `types/ai.d.ts`:

```ts
export interface AITransportToolResult {
  toolCallId: string;
  toolName: string;
  result: unknown;
}
```

Extend `AIRequestOptions`:

```ts
  // 上一轮工具执行结果，用于继续模型生成
  toolResults?: AITransportToolResult[];
```

- [ ] **Step 2: Add test for tool result messages**

Extend `test/ai/tools/stream.test.ts`:

```ts
import { createToolResultMessages } from '@/ai/tools/stream';

it('creates model messages for executed tool results', () => {
  const messages = createToolResultMessages([
    {
      toolCallId: 'call-1',
      toolName: 'echo',
      result: createToolSuccessResult('echo', { value: 'hi' })
    }
  ]);

  expect(messages).toEqual([
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'echo',
          result: {
            toolName: 'echo',
            status: 'success',
            data: { value: 'hi' }
          }
        }
      ]
    }
  ]);
});
```

- [ ] **Step 3: Implement tool result message helper**

Modify `src/ai/tools/stream.ts`:

```ts
import type { ModelMessage } from 'ai';
```

Add:

```ts
export function createToolResultMessages(results: ExecutedToolCall[]): ModelMessage[] {
  return results.map((item) => ({
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: item.toolCallId,
        toolName: item.toolName,
        result: item.result
      }
    ]
  }));
}
```

- [ ] **Step 4: Accumulate tool results in BChat**

Modify `src/components/BChat/index.vue`:

```ts
import { createToolResultMessages, executeToolCall, toTransportTools, type ExecutedToolCall } from '@/ai/tools/stream';
```

Add:

```ts
const pendingToolResults = ref<ExecutedToolCall[]>([]);
let lastServiceConfig: ServiceConfig | null = null;
```

Update `streamMessages`:

```ts
function streamMessages(_messages: Message[], config: ServiceConfig): void {
  loading.value = true;
  lastServiceConfig = config;

  const toolResultMessages = pendingToolResults.value.length ? createToolResultMessages(pendingToolResults.value) : [];
  pendingToolResults.value = [];

  agent.stream({
    messages: [..._messages, ...toolResultMessages],
    modelId: config.modelId,
    providerId: config.providerId,
    tools: props.tools?.length ? toTransportTools(props.tools) : undefined
  });

  messages.value.push(createAssistantPlaceholder());
}
```

Update `onToolCall`:

```ts
  onToolCall: async (chunk: AIStreamToolCallChunk): Promise<void> => {
    toolStatus.value = `正在执行工具：${chunk.toolName}`;
    const result = await executeToolCall(chunk, props.tools ?? [], props.getToolContext?.());
    pendingToolResults.value.push(result);
    toolStatus.value = result.result.status === 'success' ? `工具已完成：${chunk.toolName}` : `工具执行失败：${chunk.toolName}`;
  },
```

Update `onComplete` before finalizing assistant message:

```ts
    if (pendingToolResults.value.length && lastServiceConfig) {
      const message = messages.value[messages.value.length - 1];
      message.loading = false;
      message.finished = true;
      nextTick(() => streamMessages(messages.value, lastServiceConfig as ServiceConfig));
      return;
    }
```

- [ ] **Step 5: Run tests and type check**

Run:

```bash
pnpm test test/ai/tools/stream.test.ts
pnpm build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add types/ai.d.ts src/ai/tools/stream.ts src/components/BChat/index.vue test/ai/tools/stream.test.ts
git commit -m "feat: continue chat after AI tool results"
```

---

## Task 12: Final Verification and Changelog

**Files:**
- Modify: `changelog/2026-04-18.md`

- [ ] **Step 1: Update changelog**

Add under `## Changed`:

```md
- 实现 AI Tools 内置读写编辑工具链路，支持读取当前文档、读取选区、搜索文档、插入内容、替换选区和替换全文的工具抽象
```

Add under `## Features`:

```md
- 聊天侧边栏支持模型发起内置工具调用，写入类工具在执行前需要用户确认
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm test test/ai/tools/results.test.ts test/ai/tools/editor-context.test.ts test/ai/tools/builtin-read.test.ts test/ai/tools/builtin-write.test.ts test/ai/tools/stream.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full tests**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 4: Run build checks**

Run:

```bash
pnpm build
pnpm run electron:build-main
```

Expected: PASS.

- [ ] **Step 5: Manual verification in Electron**

Run:

```bash
pnpm electron:dev
```

Expected:

- App opens.
- Open or create an editor document.
- Ask chat: `总结当前文档`.
- The model can request `read_current_document`.
- Ask chat: `把我选中的文字改得更简洁`.
- The app shows a confirmation dialog before `replace_selection`.
- Cancelling leaves the document unchanged.
- Confirming applies the edit.
- Chat history still records user and final assistant messages.

- [ ] **Step 6: Commit**

```bash
git add changelog/2026-04-18.md
git commit -m "chore: document AI tools implementation"
```

---

## Self-Review

Spec coverage:

- Renderer-side orchestration is covered by Tasks 8, 10, and 11.
- Electron tool-call transport is covered by Task 7.
- Editor Context Store is covered by Tasks 2 and 5.
- Built-in read tools are covered by Task 3.
- Built-in write tools and confirmation are covered by Task 6.
- Editor public read/write actions are covered by Task 4.
- Tests and changelog are covered by Task 12.
- Future custom/MCP support is preserved by `AIToolSource`, `AIToolExecutor`, and transport boundaries in Tasks 1, 7, and 8.

Type consistency:

- Context uses `getContent()` rather than a static content snapshot.
- Tool execution consistently returns `AIToolExecutionResult`.
- Tool call transport uses `AIStreamToolCallChunk`.
- Write tools use `AIToolConfirmationAdapter`.

Implementation caution:

- If Vercel AI SDK v6 uses different stream chunk field names for tool calls, keep renderer-facing `AIStreamToolCallChunk` stable and adapt only `electron/main/modules/ai/ipc.mts`.
- If `ModelMessage` rejects the planned `role: 'tool'` shape, adapt `createToolResultMessages` to the SDK-supported message part shape while keeping `ExecutedToolCall` stable.
- If `Modal.confirm` cannot render multiline preview comfortably, keep Task 6 functional first and improve the confirmation body UI in a separate small follow-up.
