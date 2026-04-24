# File Reference Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chat messages keep inline file-reference chips visually unchanged while model context is built from per-send snapshots keyed by `documentId`.

**Architecture:** Split visible message content from model-only reference context. Persist `references` on chat messages, generate per-send `snapshot` records when submitting, and teach the model-message builder to append reference context without rewriting user-visible text. Reuse one snapshot per `documentId` within a single send, but never across messages.

**Tech Stack:** Vue 3, TypeScript, Pinia, Vitest, existing chat storage layer, BPromptEditor contenteditable chip encoding.

---

## File Map

- Modify: `types/chat.d.ts`
  Add `ChatMessageFileReference`, `ChatReferenceSnapshot`, and `references` fields on persisted chat records.
- Modify: `src/components/BPromptEditor/hooks/useVariableEncoder.ts`
  Switch file-ref serialization from JSON payload tokens to `{{file-ref:ref_xxx}}` tokens and keep chip DOM attrs aligned with reference ids.
- Modify: `src/components/BPromptEditor/index.vue`
  Track draft-scoped file references and expose insertion helpers that create token plus reference metadata together.
- Modify: `src/components/BChat/types.ts`
  Extend in-memory `Message` type with `references`.
- Modify: `src/components/BChat/index.vue`
  Preserve visible message content on submit, create snapshots during send, and pass richer user messages through `onBeforeSend`.
- Modify: `src/components/BChat/message.ts`
  Replace `expandFileReferencesForModel` with snapshot-backed context building and `parseLineRange`.
- Modify: `src/components/BChat/components/MessageBubblePartText.vue`
  Render text parts with file-reference chips based on `content + references`.
- Modify: `src/stores/chat.ts`
  Persist and load `references`.
- Inspect/Modify as needed: `src/shared/storage/*`
  Store snapshots and fetch them during model-context building.
- Test: `test/components/BPromptEditor/BPromptEditorRegression.test.ts`
- Test: `test/components/BChat/message.test.ts`
- Test: `test/components/BChatSidebar/file-reference-insert.test.ts`
- Test: `test/stores/chat.test.ts`

### Task 1: Extend Chat Types And Storage Contracts

**Files:**
- Modify: `types/chat.d.ts`
- Modify: `src/components/BChat/types.ts`
- Modify: `src/stores/chat.ts`
- Test: `test/stores/chat.test.ts`

- [ ] **Step 1: Write the failing store test for references persistence**

```ts
it('persists chat message references when adding a session message', async () => {
  const { useChatStore } = await import('@/stores/chat');
  const chatStore = useChatStore();

  await chatStore.addSessionMessage('session-1', {
    id: 'msg-1',
    role: 'user',
    content: '{{file-ref:ref-1}}',
    parts: [{ type: 'text', text: '{{file-ref:ref-1}}' }],
    references: [
      {
        id: 'ref-1',
        token: '{{file-ref:ref-1}}',
        documentId: 'doc-1',
        fileName: 'draft.md',
        line: '12-18',
        path: null,
        snapshotId: 'snapshot-1',
        excerpt: '## Heading'
      }
    ],
    createdAt: '2026-04-24T00:00:00.000Z'
  });

  expect(chatStorage.addMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      references: [
        expect.objectContaining({
          id: 'ref-1',
          documentId: 'doc-1',
          snapshotId: 'snapshot-1'
        })
      ]
    })
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/stores/chat.test.ts`
Expected: FAIL because `references` is not part of `ChatMessageRecord` / store mapping yet.

- [ ] **Step 3: Write minimal type and store implementation**

```ts
export interface ChatMessageFileReference {
  id: string;
  token: string;
  documentId: string;
  fileName: string;
  line: string;
  path?: string | null;
  snapshotId: string;
  excerpt?: string;
}

export interface ChatReferenceSnapshot {
  id: string;
  documentId: string;
  title: string;
  content: string;
  createdAt: string;
}

export interface ChatMessageRecord {
  // ...
  references?: ChatMessageFileReference[];
}
```

```ts
function toRecordMessage(sessionId: string, message: PersistableMessage): ChatMessageRecord {
  const { id, role, content, parts, thinking, files, references, usage, createdAt = new Date().toISOString() } = message;
  return { sessionId, id, role, content, parts, thinking, files, references, usage, createdAt };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/stores/chat.test.ts`
Expected: PASS with the new persistence assertion and existing store tests still green.

- [ ] **Step 5: Commit**

```bash
git add types/chat.d.ts src/components/BChat/types.ts src/stores/chat.ts test/stores/chat.test.ts
git commit -m "feat(chat): 持久化文件引用元数据"
```

### Task 2: Switch Prompt Tokens To Reference Ids

**Files:**
- Modify: `src/components/BPromptEditor/hooks/useVariableEncoder.ts`
- Modify: `src/components/BPromptEditor/index.vue`
- Test: `test/components/BPromptEditor/BPromptEditorRegression.test.ts`

- [ ] **Step 1: Write the failing prompt-editor test for token format**

```ts
it('serializes file-reference chips to stable reference-id tokens', async () => {
  const wrapper = mount(BPromptEditor, { props: { value: '' } });

  await wrapper.vm.insertFileReference({
    referenceId: 'ref-1',
    documentId: 'doc-1',
    fileName: 'draft.md',
    filePath: null,
    line: '12-18'
  });

  expect(wrapper.emitted('update:value')?.at(-1)?.[0]).toContain('{{file-ref:ref-1}}');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/components/BPromptEditor/BPromptEditorRegression.test.ts`
Expected: FAIL because the encoder still serializes JSON payload tokens.

- [ ] **Step 3: Write minimal encoder and draft-reference implementation**

```ts
export interface FileReferenceChip {
  referenceId: string;
  documentId: string;
  filePath: string | null;
  fileName: string;
  line: number | string;
  excerpt?: string;
}

export function serializeFileReference(reference: FileReferenceChip): string {
  return `{{file-ref:${reference.referenceId}}}`;
}
```

```ts
function createFileReferenceSpan(reference: FileReferenceChip): HTMLElement {
  const element = document.createElement('span');
  element.className = 'b-prompt-editor-tag b-prompt-editor-tag--file-reference';
  element.dataset.value = 'file-reference';
  element.dataset.referenceId = reference.referenceId;
  element.dataset.documentId = reference.documentId;
  element.dataset.fileName = reference.fileName;
  element.dataset.line = String(reference.line);
  element.textContent = `${reference.fileName}:${reference.line}`;
  return element;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/components/BPromptEditor/BPromptEditorRegression.test.ts`
Expected: PASS with token serialization and existing chip behavior intact.

- [ ] **Step 5: Commit**

```bash
git add src/components/BPromptEditor/hooks/useVariableEncoder.ts src/components/BPromptEditor/index.vue test/components/BPromptEditor/BPromptEditorRegression.test.ts
git commit -m "feat(prompt): 使用稳定 token 序列化文件引用"
```

### Task 3: Preserve Visible User Messages And Render Chips In Bubbles

**Files:**
- Modify: `src/components/BChat/index.vue`
- Modify: `src/components/BChat/components/MessageBubblePartText.vue`
- Modify: `src/components/BChat/components/MessageBubble.vue`
- Test: `test/components/BChatSidebar/file-reference-insert.test.ts`

- [ ] **Step 1: Write the failing UI regression test for visible content**

```ts
it('keeps file-reference token-backed content unchanged in the sent user message', async () => {
  const wrapper = mount(BChat, {
    props: {
      messages: [],
      inputValue: '{{file-ref:ref-1}}',
      onBeforeSend: vi.fn()
    }
  });

  await wrapper.find('.b-chat__input__buttons button').trigger('click');

  expect(wrapper.emitted('update:messages')?.at(-1)?.[0][0]).toEqual(
    expect.objectContaining({
      content: '{{file-ref:ref-1}}',
      parts: [{ type: 'text', text: '{{file-ref:ref-1}}' }]
    })
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/components/BChatSidebar/file-reference-insert.test.ts`
Expected: FAIL because submit still rewrites file refs before persisting the user-visible message.

- [ ] **Step 3: Write minimal submit/render implementation**

```ts
const message: Message = {
  id: nanoid(),
  role: 'user',
  content,
  parts: [{ type: 'text', text: content }],
  references: draftReferences,
  createdAt: new Date().toISOString()
};
```

```vue
<template>
  <BMessageFileReferenceText
    :text="part.text"
    :references="message.references ?? []"
    :loading="loading"
  />
</template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/components/BChatSidebar/file-reference-insert.test.ts test/components/BPromptEditor/BPromptEditorRegression.test.ts`
Expected: PASS with chips still inserted and visible content no longer rewritten on send.

- [ ] **Step 5: Commit**

```bash
git add src/components/BChat/index.vue src/components/BChat/components/MessageBubblePartText.vue src/components/BChat/components/MessageBubble.vue test/components/BChatSidebar/file-reference-insert.test.ts
git commit -m "feat(chat): 保留文件引用消息的可见内容"
```

### Task 4: Build Snapshot-Backed Model Context

**Files:**
- Modify: `src/components/BChat/message.ts`
- Modify: `src/components/BChat/index.vue`
- Modify: `src/ai/tools/editor-context.ts` if a snapshot read helper is needed
- Test: `test/components/BChat/message.test.ts`

- [ ] **Step 1: Write the failing message-context tests**

```ts
it('appends snapshot-backed context for a file reference without changing visible content', () => {
  const modelMessages = toModelMessages([
    {
      id: 'msg-1',
      role: 'user',
      content: '{{file-ref:ref-1}}',
      parts: [{ type: 'text', text: '{{file-ref:ref-1}}' }],
      references: [
        {
          id: 'ref-1',
          token: '{{file-ref:ref-1}}',
          documentId: 'doc-1',
          fileName: 'draft.md',
          line: '12-18',
          path: null,
          snapshotId: 'snapshot-1'
        }
      ],
      createdAt: '2026-04-24T00:00:00.000Z'
    }
  ], {
    snapshots: new Map([
      ['snapshot-1', { id: 'snapshot-1', documentId: 'doc-1', title: 'draft', content: '# Title\\nBody', createdAt: '2026-04-24T00:00:00.000Z' }]
    ])
  });

  expect(modelMessages[0]).toEqual(
    expect.objectContaining({
      role: 'user',
      content: expect.stringContaining('引用文件')
    })
  );
});

it('falls back to overview-only context when parseLineRange fails for a long document', () => {
  expect(buildFileReferenceContext(longSnapshot, { line: 'abc' })).toContain('总行数');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/components/BChat/message.test.ts`
Expected: FAIL because `toModelMessagesForMessage` still reads visible text only.

- [ ] **Step 3: Write minimal snapshot/context builder implementation**

```ts
export interface FileReferenceContextOptions {
  snapshots: Map<string, ChatReferenceSnapshot>;
}

export function parseLineRange(line: string): { start: number; end: number } | null {
  if (/^\d+$/.test(line)) {
    const value = Number(line);
    return value > 0 ? { start: value, end: value } : null;
  }

  const match = line.match(/^(\d+)-(\d+)$/);
  if (!match) {
    return null;
  }

  const start = Number(match[1]);
  const end = Number(match[2]);
  return start > 0 && end >= start ? { start, end } : null;
}
```

```ts
function toModelMessagesForMessage(message: Message, options?: FileReferenceContextOptions): ModelMessage[] {
  if (message.role === 'user') {
    return [{ role: 'user', content: buildUserModelContent(message, options) }];
  }
  return toAssistantModelMessages(message.parts);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run test/components/BChat/message.test.ts`
Expected: PASS for small/medium/large document paths and parse failure fallback.

- [ ] **Step 5: Commit**

```bash
git add src/components/BChat/message.ts src/components/BChat/index.vue test/components/BChat/message.test.ts
git commit -m "feat(chat): 使用快照构建文件引用上下文"
```

### Task 5: Final Integration Verification

**Files:**
- Verify only

- [ ] **Step 1: Run focused component and store tests**

Run: `pnpm exec vitest run test/components/BPromptEditor/BPromptEditorRegression.test.ts test/components/BChat/message.test.ts test/components/BChatSidebar/file-reference-insert.test.ts test/stores/chat.test.ts`
Expected: PASS with all targeted suites green.

- [ ] **Step 2: Run full build verification**

Run: `pnpm build`
Expected: build succeeds with exit code `0`.

- [ ] **Step 3: Review spec coverage against implementation**

Check:

```text
- visible content preserved in chat bubbles
- documentId-based references persisted
- snapshot reuse only within one send
- parseLineRange uses 1-based rules
- fallback order remains intact
```

- [ ] **Step 4: Commit any final doc or test adjustments**

```bash
git add .
git commit -m "test(chat): 验证文件引用上下文链路"
```
