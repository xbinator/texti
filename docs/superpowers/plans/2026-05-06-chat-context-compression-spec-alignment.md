# Chat Context Compression Spec Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the chat context compression implementation back into alignment with `docs/superpowers/specs/2026-05-06-chat-context-compression-design.md`, especially around incremental summarization, effective-context sizing, file-semantic preservation, manual rebuild fallback, summary validity, and summarizer prompt inputs.

**Architecture:** Keep the existing `policy / planner / summarizer / assembler / coordinator / storage` split, but tighten the contracts between them so `policy` measures the same context shape that `assembler` sends, `coordinator` computes true incremental windows, `planner` emits the documented file-semantic layer, and `storage` enforces summary validity/version rules when records are read. Avoid widening UI responsibilities; the sidebar should continue to depend on coordinator/storage APIs rather than reimplementing compression logic.

**Tech Stack:** Vue 3 Composition API, TypeScript strict mode, Electron main/renderer IPC, AI SDK 6.x structured output, SQLite/localStorage fallback, Vitest

---

### Task 1: True Incremental Summary Windowing

**Files:**
- Modify: `src/components/BChatSidebar/utils/compression/coordinator.ts`
- Modify: `src/components/BChatSidebar/utils/compression/types.ts`
- Test: `test/components/BChatSidebar/utils/compression/coordinator.test.ts`

- [ ] **Step 1: Write the failing incremental-window tests**

```ts
it('starts incremental summaries after the previous coveredEndMessageId', async () => {
  const existingSummary = makeSummary({
    id: 'summary-prev',
    coveredStartMessageId: 'm1',
    coveredEndMessageId: 'm30',
    coveredUntilMessageId: 'm30',
    summaryText: 'previous summary',
    structuredSummary: {
      goal: 'Existing goal',
      recentTopic: 'Existing topic',
      userPreferences: [],
      constraints: [],
      decisions: [],
      importantFacts: [],
      fileContext: [],
      openQuestions: [],
      pendingActions: []
    }
  });
  const mockStorage = createMockStorage(existingSummary);
  const coordinator = createCompressionCoordinator(mockStorage);
  const messages = makeLongConversation(92);
  const currentUserMessage = makeMsg({
    id: 'current',
    role: 'user',
    content: 'Current question',
    parts: [{ type: 'text', text: 'Current question' } as never]
  });

  await coordinator.prepareMessagesBeforeSend({
    sessionId: 'session-1',
    messages,
    currentUserMessage,
    excludeMessageIds: [currentUserMessage.id]
  });

  expect(mockStorage.createSummary).toHaveBeenCalledWith(
    expect.objectContaining({
      derivedFromSummaryId: 'summary-prev',
      coveredStartMessageId: 'm31'
    })
  );
});
```

- [ ] **Step 2: Run the coordinator test to verify it fails**

Run: `pnpm vitest run test/components/BChatSidebar/utils/compression/coordinator.test.ts`

Expected: FAIL because `coveredStartMessageId` still points at the oldest compressible message and incremental mode still scans full history.

- [ ] **Step 3: Introduce an explicit compression-window model in the coordinator/types layer**

```ts
// src/components/BChatSidebar/utils/compression/types.ts
export interface CompressionWindow {
  sourceMessages: Message[];
  preservedMessages: Message[];
  recentMessages: Message[];
  previousSummary?: ConversationSummaryRecord;
  buildMode: SummaryBuildMode;
}
```

```ts
// src/components/BChatSidebar/utils/compression/coordinator.ts
function resolveIncrementalWindow(
  messages: Message[],
  currentSummary: ConversationSummaryRecord | undefined,
  currentUserMessageId?: string
): Message[] {
  if (!currentSummary) {
    return messages.filter((message) => message.id !== currentUserMessageId);
  }

  const startIndex = messages.findIndex((message) => message.id === currentSummary.coveredEndMessageId);
  const tailMessages = startIndex >= 0 ? messages.slice(startIndex + 1) : messages;
  return tailMessages.filter((message) => message.id !== currentUserMessageId);
}
```

- [ ] **Step 4: Rework `buildSummaryRecord()` so automatic mode only summarizes the incremental window**

```ts
const windowMessages = buildMode === 'incremental'
  ? resolveIncrementalWindow(messages, currentSummary, currentUserMessageId)
  : messages.filter((message) => message.id !== currentUserMessageId);

const classification = planCompression(windowMessages, RECENT_ROUND_PRESERVE, currentUserMessageId, excludeMessageIds);

const coveredStartMessageId = buildMode === 'incremental'
  ? classification.compressibleMessages[0]?.id ?? currentSummary?.coveredEndMessageId ?? ''
  : classification.compressibleMessages[0]?.id ?? '';
```

- [ ] **Step 5: Pass the previous summary into the summarizer call site**

```ts
const structuredSummary = await generateStructuredSummary({
  items: trimmed.items,
  previousSummary: buildMode === 'incremental' ? currentSummary : undefined
});
```

- [ ] **Step 6: Re-run the coordinator tests**

Run: `pnpm vitest run test/components/BChatSidebar/utils/compression/coordinator.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/BChatSidebar/utils/compression/types.ts src/components/BChatSidebar/utils/compression/coordinator.ts test/components/BChatSidebar/utils/compression/coordinator.test.ts
git commit -m "fix: align compression coordinator with incremental summary spec"
```

### Task 2: Effective Context Sizing Must Match Assembled Context

**Files:**
- Modify: `src/components/BChatSidebar/utils/compression/policy.ts`
- Modify: `src/components/BChatSidebar/utils/compression/assembler.ts`
- Test: `test/components/BChatSidebar/utils/compression/policy.test.ts`

- [ ] **Step 1: Write the failing effective-context sizing tests**

```ts
it('counts summary overhead and preserved passthrough messages when evaluating compression', async () => {
  const { evaluateCompression } = await import('@/components/BChatSidebar/utils/compression/policy');

  const summary = makeSummary({
    coveredUntilMessageId: 'm10',
    preservedMessageIds: ['m11'],
    summaryText: 'S'.repeat(5000)
  });
  const messages = [
    makeMsg({ id: 'm11', role: 'assistant', content: 'P'.repeat(10000), parts: [{ type: 'text', text: 'P'.repeat(10000) } as never] }),
    makeMsg({ id: 'm12', role: 'user', content: 'recent', parts: [{ type: 'text', text: 'recent' } as never] })
  ];

  const result = evaluateCompression(messages, summary);
  expect(result.charCount).toBeGreaterThanOrEqual(15000);
  expect(result.shouldCompress).toBe(true);
});
```

- [ ] **Step 2: Run the policy tests to verify they fail**

Run: `pnpm vitest run test/components/BChatSidebar/utils/compression/policy.test.ts`

Expected: FAIL because current sizing only counts messages after `coveredUntilMessageId`.

- [ ] **Step 3: Add a helper that assembles the same effective context shape used by the chat request**

```ts
// src/components/BChatSidebar/utils/compression/policy.ts
function buildEffectiveContextMessages(messages: Message[], currentSummary?: ConversationSummaryRecord): ModelMessage[] {
  const preservedIdSet = new Set(currentSummary?.preservedMessageIds ?? []);
  const preservedMessages = messages.filter((message) => preservedIdSet.has(message.id));
  const coveredIndex = currentSummary
    ? messages.findIndex((message) => message.id === currentSummary.coveredUntilMessageId)
    : -1;
  const recentMessages = coveredIndex >= 0 ? messages.slice(coveredIndex + 1).filter((message) => !preservedIdSet.has(message.id)) : messages;

  return assembleContext({
    summaryRecord: currentSummary,
    preservedMessages,
    recentMessages,
    currentUserMessage: recentMessages[recentMessages.length - 1]
  }).modelMessages;
}
```

- [ ] **Step 4: Refactor `evaluateCompression()` to use the effective assembled context for `charCount`**

```ts
const modelMessages = buildEffectiveContextMessages(messagesToEvaluate, currentSummary);
const charCount = estimateContextSize(modelMessages);
```

- [ ] **Step 5: Keep round counting consistent with the same visible-effective window**

```ts
const roundCount = countMessageRounds([
  ...preservedMessages,
  ...recentMessages
]);
```

- [ ] **Step 6: Re-run the policy tests**

Run: `pnpm vitest run test/components/BChatSidebar/utils/compression/policy.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/BChatSidebar/utils/compression/policy.ts src/components/BChatSidebar/utils/compression/assembler.ts test/components/BChatSidebar/utils/compression/policy.test.ts
git commit -m "fix: measure effective assembled context for compression policy"
```

### Task 3: Implement the File-Semantic Layer From the Spec

**Files:**
- Modify: `src/components/BChatSidebar/utils/compression/planner.ts`
- Modify: `src/components/BChatSidebar/utils/compression/summarizer.ts`
- Modify: `src/components/BChatSidebar/utils/compression/types.ts`
- Test: `test/components/BChatSidebar/utils/compression/planner.test.ts`
- Test: `test/components/BChatSidebar/utils/compression/summarizer.test.ts`

- [ ] **Step 1: Write the failing planner test for file-semantic classification**

```ts
it('moves historical file-reference messages into the file-semantic layer', async () => {
  const { planCompression } = await import('@/components/BChatSidebar/utils/compression/planner');
  const messages = [
    makeMsg({
      id: 'm1',
      role: 'user',
      content: 'Check src/app.ts lines 1-20',
      references: [
        {
          token: '{{#file:1-20}}',
          path: '/project/src/app.ts',
          selectedContent: 'const value = 1;',
          fullContent: 'const value = 1;',
          startLine: 1,
          endLine: 20
        }
      ]
    }),
    makeMsg({ id: 'm2', role: 'assistant', content: 'Done', parts: [{ type: 'text', text: 'Done' } as never] })
  ];

  const result = planCompression(messages, 0);
  expect(result.fileSemanticMessages.map((message) => message.id)).toContain('m1');
  expect(result.compressibleMessages.map((message) => message.id)).not.toContain('m1');
});
```

- [ ] **Step 2: Run planner and summarizer tests to verify they fail**

Run: `pnpm vitest run test/components/BChatSidebar/utils/compression/planner.test.ts test/components/BChatSidebar/utils/compression/summarizer.test.ts`

Expected: FAIL because `fileSemanticMessages` is always empty and file references are still treated as ordinary compressible text.

- [ ] **Step 3: Add explicit file-semantic detection to the planner**

```ts
function shouldPreserveAsFileSemantic(message: Message): boolean {
  return message.references?.length > 0;
}

for (const msg of olderMessages) {
  if (mustPreserve(msg)) {
    preservedMessages.push(msg);
    preservedMessageIds.push(msg.id);
  } else if (shouldPreserveAsFileSemantic(msg)) {
    fileSemanticMessages.push(msg);
  } else {
    compressibleMessages.push(msg);
  }
}
```

- [ ] **Step 4: Teach the summarizer to serialize file-semantic messages into the documented path/range/intent form**

```ts
function extractFileSemanticText(message: Message): string {
  return (message.references ?? [])
    .map((reference) => {
      const range = reference.startLine && reference.endLine ? `${reference.startLine}-${reference.endLine}` : 'unknown';
      return `[file: ${reference.path}, range: ${range}, intent: ${message.content}, snippet: ${reference.selectedContent.slice(0, 120)}]`;
    })
    .join(' ');
}
```

- [ ] **Step 5: Merge file-semantic messages into the summarizer input instead of discarding them**

```ts
const trimInputMessages = [...classification.fileSemanticMessages, ...classification.compressibleMessages];
const trimmed = ruleTrim(trimInputMessages);
```

- [ ] **Step 6: Re-run planner and summarizer tests**

Run: `pnpm vitest run test/components/BChatSidebar/utils/compression/planner.test.ts test/components/BChatSidebar/utils/compression/summarizer.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/BChatSidebar/utils/compression/planner.ts src/components/BChatSidebar/utils/compression/summarizer.ts src/components/BChatSidebar/utils/compression/types.ts test/components/BChatSidebar/utils/compression/planner.test.ts test/components/BChatSidebar/utils/compression/summarizer.test.ts
git commit -m "feat: preserve historical file semantics in compression planning"
```

### Task 4: Manual Compression Fallback and Degrade Recording

**Files:**
- Modify: `src/components/BChatSidebar/utils/compression/types.ts`
- Modify: `src/components/BChatSidebar/utils/compression/coordinator.ts`
- Modify: `src/components/BChatSidebar/hooks/useCompression.ts`
- Test: `test/components/BChatSidebar/compression.integration.test.ts`

- [ ] **Step 1: Write the failing manual-fallback tests**

```ts
it('degrades manual full rebuild to incremental when trim input exceeds the hard limit', async () => {
  const { createCompressionCoordinator } = await import('@/components/BChatSidebar/utils/compression/coordinator');
  const coordinator = createCompressionCoordinator(createMockStorage());
  const messages = makeLargeConversationExceedingTrimLimit();

  const summary = await coordinator.compressSessionManually({
    sessionId: 'session-1',
    messages
  });

  expect(summary?.buildMode).toBe('full_rebuild');
  expect(summary?.invalidReason).toBe('degraded_to_incremental');
});
```

- [ ] **Step 2: Run the manual compression test to verify it fails**

Run: `pnpm vitest run test/components/BChatSidebar/compression.integration.test.ts`

Expected: FAIL because manual compression has no degrade path or degrade metadata.

- [ ] **Step 3: Extend the summary record metadata for manual-degrade bookkeeping**

```ts
// src/components/BChatSidebar/utils/compression/types.ts
export interface ConversationSummaryRecord {
  // existing fields...
  degradeReason?: 'degraded_to_incremental';
}
```

- [ ] **Step 4: Add a size-based fallback branch in `compressSessionManually()`**

```ts
const fullRebuildTrim = ruleTrim(messages);
const shouldDegrade = fullRebuildTrim.charCount >= COMPRESSION_INPUT_CHAR_LIMIT;

const summaryResult = await buildSummaryRecord(
  storage,
  sessionId,
  messages,
  'full_rebuild',
  'manual',
  currentSummary,
  undefined,
  undefined,
  shouldDegrade ? 'incremental' : 'full_rebuild'
);
```

- [ ] **Step 5: Bubble the degrade reason back to `useCompression()` so the UI can message it later**

```ts
if (result?.degradeReason === 'degraded_to_incremental') {
  error.value = undefined;
}
```

- [ ] **Step 6: Re-run the manual compression test**

Run: `pnpm vitest run test/components/BChatSidebar/compression.integration.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/BChatSidebar/utils/compression/types.ts src/components/BChatSidebar/utils/compression/coordinator.ts src/components/BChatSidebar/hooks/useCompression.ts test/components/BChatSidebar/compression.integration.test.ts
git commit -m "fix: add manual compression degrade path"
```

### Task 5: Enforce Summary Validity and Schema-Version Rules When Reading

**Files:**
- Modify: `src/shared/storage/chat-summaries/sqlite.ts`
- Modify: `src/components/BChatSidebar/utils/compression/constant.ts`
- Test: `test/shared/storage/chat-summaries.test.ts`

- [ ] **Step 1: Write the failing storage validity tests**

```ts
it('ignores summaries with unsupported schema version', async () => {
  localStorage.clear();
  const { chatSummariesStorage } = await import('@/shared/storage/chat-summaries');

  await seedFallbackSummary({
    sessionId: 'session-1',
    schemaVersion: 999,
    status: 'valid'
  });

  const summary = await chatSummariesStorage.getValidSummary('session-1');
  expect(summary).toBeUndefined();
});
```

```ts
it('marks malformed structured summaries invalid instead of fabricating empty data', async () => {
  const rows = [
    {
      id: 'summary-1',
      session_id: 'session-1',
      structured_summary_json: '{bad json}',
      schema_version: 1,
      status: 'valid'
    }
  ];
  dbSelectMock.mockResolvedValue(rows);

  const { chatSummariesStorage } = await import('@/shared/storage/chat-summaries');
  const summary = await chatSummariesStorage.getValidSummary('session-1');

  expect(summary).toBeUndefined();
  expect(dbExecuteMock).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the storage tests to verify they fail**

Run: `pnpm vitest run test/shared/storage/chat-summaries.test.ts`

Expected: FAIL because malformed/unsupported summaries are currently returned as valid.

- [ ] **Step 3: Replace the “empty summary object” fallback with explicit validation**

```ts
function parseStructuredSummary(row: ChatSessionSummaryRow): StructuredConversationSummary | null {
  const parsed = parseJson<StructuredConversationSummary>(row.structured_summary_json);
  if (!parsed) return null;
  if (row.schema_version !== CURRENT_SCHEMA_VERSION) return null;
  return parsed;
}
```

- [ ] **Step 4: Invalidate bad rows at read time and skip them**

```ts
const parsedSummary = parseStructuredSummary(row);
if (!parsedSummary) {
  await chatSummariesStorage.updateSummaryStatus(row.id, 'invalid', 'unsupported_schema_version');
  return undefined;
}
```

- [ ] **Step 5: Apply the same filtering to the localStorage fallback path**

```ts
const validSummaries = allSummaries.filter((summary) => {
  return summary.sessionId === sessionId
    && summary.status === 'valid'
    && summary.schemaVersion === CURRENT_SCHEMA_VERSION;
});
```

- [ ] **Step 6: Re-run the storage tests**

Run: `pnpm vitest run test/shared/storage/chat-summaries.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/shared/storage/chat-summaries/sqlite.ts src/components/BChatSidebar/utils/compression/constant.ts test/shared/storage/chat-summaries.test.ts
git commit -m "fix: enforce summary schema validity on read"
```

### Task 6: Summarizer Input Contract Must Support `{{PREVIOUS_SUMMARY}}`

**Files:**
- Modify: `src/components/BChatSidebar/utils/compression/summaryGenerator.ts`
- Modify: `src/components/BChatSidebar/utils/compression/coordinator.ts`
- Test: `test/components/BChatSidebar/utils/compression/summaryGenerator.test.ts`

- [ ] **Step 1: Write the failing summarizer-input tests**

```ts
it('includes previous summary context in incremental summary prompts', async () => {
  const { generateStructuredSummary } = await import('@/components/BChatSidebar/utils/compression/summaryGenerator');

  await generateStructuredSummary({
    items: [{ messageId: 'm1', role: 'user', trimmedText: 'new detail' }],
    previousSummary: {
      summaryText: 'previous summary',
      structuredSummary: {
        goal: 'Existing goal',
        recentTopic: 'Existing topic',
        userPreferences: [],
        constraints: [],
        decisions: [],
        importantFacts: [],
        fileContext: [],
        openQuestions: [],
        pendingActions: []
      }
    }
  });

  expect(aiInvokeMock).toHaveBeenCalledWith(
    expect.any(Object),
    expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('previous summary')
        })
      ])
    })
  );
});
```

- [ ] **Step 2: Run the summary-generator tests to verify they fail**

Run: `pnpm vitest run test/components/BChatSidebar/utils/compression/summaryGenerator.test.ts`

Expected: FAIL because the generator currently cannot accept `previousSummary`.

- [ ] **Step 3: Change `generateStructuredSummary()` to accept an object payload instead of a bare item array**

```ts
export interface GenerateStructuredSummaryInput {
  items: TrimmedMessageItem[];
  previousSummary?: Pick<ConversationSummaryRecord, 'summaryText' | 'structuredSummary'>;
}
```

- [ ] **Step 4: Build the documented prompt variables into the summarizer request**

```ts
function buildSummaryUserPrompt(input: GenerateStructuredSummaryInput): string {
  const conversationText = input.items.map((item) => `[${item.role}]: ${item.trimmedText}`).join('\n\n');
  const previousSummaryText = input.previousSummary
    ? `${input.previousSummary.summaryText}\n${JSON.stringify(input.previousSummary.structuredSummary)}`
    : '无';

  return [
    'PREVIOUS_SUMMARY:',
    previousSummaryText,
    '',
    'CONVERSATION_CONTENT:',
    conversationText
  ].join('\n');
}
```

- [ ] **Step 5: Update the coordinator call sites to pass `previousSummary` only for automatic incremental runs**

```ts
const structuredSummary = await generateStructuredSummary({
  items: trimmed.items,
  previousSummary: buildMode === 'incremental' ? currentSummary : undefined
});
```

- [ ] **Step 6: Re-run the summary-generator tests**

Run: `pnpm vitest run test/components/BChatSidebar/utils/compression/summaryGenerator.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/BChatSidebar/utils/compression/summaryGenerator.ts src/components/BChatSidebar/utils/compression/coordinator.ts test/components/BChatSidebar/utils/compression/summaryGenerator.test.ts
git commit -m "fix: pass previous summary into incremental summarizer prompts"
```

### Task 7: Regression Verification and Documentation Sync

**Files:**
- Modify: `changelog/2026-05-06.md`
- Test: `test/components/BChatSidebar/utils/compression/coordinator.test.ts`
- Test: `test/components/BChatSidebar/utils/compression/policy.test.ts`
- Test: `test/components/BChatSidebar/utils/compression/planner.test.ts`
- Test: `test/components/BChatSidebar/utils/compression/summarizer.test.ts`
- Test: `test/components/BChatSidebar/utils/compression/summaryGenerator.test.ts`
- Test: `test/components/BChatSidebar/compression.integration.test.ts`
- Test: `test/shared/storage/chat-summaries.test.ts`

- [ ] **Step 1: Update changelog entries to mention spec-alignment fixes**

```md
- 对齐聊天上下文压缩设计文档：
  - 自动压缩改为真正基于上一条摘要边界执行增量摘要
  - 有效上下文体积估算纳入摘要注入和 preserved passthrough 消息
  - 补齐历史文件引用轻量语义层、手动压缩降级、摘要有效性校验和 `PREVIOUS_SUMMARY` 提示词输入
```

- [ ] **Step 2: Run the full compression regression suite**

Run: `pnpm vitest run test/components/BChatSidebar/utils/compression/coordinator.test.ts test/components/BChatSidebar/utils/compression/policy.test.ts test/components/BChatSidebar/utils/compression/planner.test.ts test/components/BChatSidebar/utils/compression/summarizer.test.ts test/components/BChatSidebar/utils/compression/summaryGenerator.test.ts test/components/BChatSidebar/compression.integration.test.ts test/shared/storage/chat-summaries.test.ts`

Expected: PASS

- [ ] **Step 3: Run the Electron AI service tests to ensure structured-output support still works**

Run: `pnpm vitest run test/electron/aiService.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add changelog/2026-05-06.md test/components/BChatSidebar/utils/compression/coordinator.test.ts test/components/BChatSidebar/utils/compression/policy.test.ts test/components/BChatSidebar/utils/compression/planner.test.ts test/components/BChatSidebar/utils/compression/summarizer.test.ts test/components/BChatSidebar/utils/compression/summaryGenerator.test.ts test/components/BChatSidebar/compression.integration.test.ts test/shared/storage/chat-summaries.test.ts
git commit -m "test: cover chat compression spec alignment regressions"
```
