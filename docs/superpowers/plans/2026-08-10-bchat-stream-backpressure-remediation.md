# BChat Stream Backpressure Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 BChat 流式回复使用小型增量事件与合并耐久快照，补齐 Markdown、工具输入、强制回答、Shell 和文件工具隐私边界。

**Architecture:** 主进程保留唯一工作消息，通过 16/50 毫秒实时增量通道和 100/250 毫秒完整快照通道分别服务 UI 与 SQLite。Renderer 使用消息级 revision 连续应用追加型 mutation，并以完整检查点恢复；复杂 Markdown 通过安全扫描与 Worker 解析，文件变更工具使用不接收正文的专用展示组件。

**Tech Stack:** Electron IPC、Vue 3、TypeScript strict、Vitest、lodash-es debounce、marked、Vite module Worker、better-sqlite3。

## Global Constraints

- 禁止使用 `any`；新增函数、类型、复杂逻辑必须包含准确注释和明确返回类型。
- 实时 delta 等待 16 毫秒、最大等待 50 毫秒、累计 64 KiB 立即刷新。
- 耐久快照等待 100 毫秒、最大等待 250 毫秒；语义边界与终态强制刷新。
- Markdown Worker 阈值 32 KiB、纯文本硬降级阈值 2 MiB、推算容器嵌套上限 128。
- 单模型步骤文本上限 2 MiB、流事件上限 100,000、模型/工具续轮预算 32。
- `write_file`、`edit_file` 永不展示 `content`、`oldString`、`newString`、`inputText` 或结果正文。
- 所有异步错误继续使用 `asyncTo`；同步解析防御允许 `try/catch`。
- 所有代码改动记录到 `changelog/2026-08-10.md`。
- 用户自行提交代码；计划中的任务不执行 `git add` 或 `git commit`。

---

### Task 1: 文件变更工具隐私展示

**Files:**

- Create: `src/components/BChat/components/MessageBubble/BubblePartTool/ToolFileTarget.vue`
- Modify: `src/components/BChat/components/MessageBubble/BubblePartTool/index.vue`
- Modify: `test/components/BChat/bubble-part-tool-open-file.test.ts`

**Interfaces:**

- Consumes: `ChatMessageToolPart` 的 `input` 与结构化 `result`。
- Produces: `ToolFileTarget` Props `{ fileName: string; filePath: string; openable: boolean }`，只发布 `open` 事件。

- [ ] **Step 1: Write the failing privacy tests**

新增参数化用例，为 `write_file` 与 `edit_file` 的 `inputting`、`executing`、成功和失败状态分别注入 `secret-content`、`secret-old`、`secret-new`、`secret-input-text`、`secret-result`，断言：

```typescript
expect(wrapper.text()).toContain('report.md');
expect(wrapper.text()).toContain('/workspace/docs/report.md');
expect(wrapper.html()).not.toMatch(/secret-content|secret-old|secret-new|secret-input-text|secret-result/u);
expect(wrapper.text()).not.toContain('查看原始数据');
expect(wrapper.findComponent(ToolCode).exists()).toBe(false);
```

保留并调整打开文件用例，点击 `.bubble-part-tool__file-target--openable` 后断言 `openFile({ filePath: '/workspace/docs/report.md' })`。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/components/BChat/bubble-part-tool-open-file.test.ts --reporter=dot`

Expected: FAIL，因为当前 `write_file` 预览会显示正文，且不存在专用文件目标节点。

- [ ] **Step 3: Implement the isolated target component**

`ToolFileTarget.vue` 只接受净化字符串：

```typescript
interface Props {
  /** 文件名。 */
  fileName: string;
  /** 完整文件路径。 */
  filePath: string;
  /** 是否允许打开文件。 */
  openable: boolean;
}

const emit = defineEmits<{ (event: 'open'): void }>();
```

模板显示文件名和路径；仅 `openable` 时响应点击。组件不能接收 `part`、`input`、`result` 或 `unknown` 原始值。

- [ ] **Step 4: Route mutation tools before generic previews**

在 `index.vue` 增加：

```typescript
const FILE_MUTATION_TOOLS = new Set<string>(['write_file', 'edit_file']);
const isFileMutationTool = computed<boolean>(() => FILE_MUTATION_TOOLS.has(props.part.toolName));

interface FileTarget {
  /** 文件名。 */
  fileName: string;
  /** 完整路径。 */
  filePath: string;
}
```

路径只从 `part.input.path`、成功 `result.data.path` 或失败 `result.error.details.path` 读取。将 `ToolFileTarget` 分支放在 Shell、Todo、Question、Summary、ToolCode 之前；文件工具的 `hasContent` 固定由目标路径决定，`previewValue` 和 `summary` 不再接触该分支。

- [ ] **Step 5: Run focused tests**

Run: `pnpm exec vitest run test/components/BChat/bubble-part-tool-open-file.test.ts test/components/BChat/tool-result-summary.test.ts --reporter=dot`

Expected: PASS；非文件工具摘要行为保持不变。

### Task 2: Assistant 投影合并器

**Files:**

- Create: `electron/main/modules/chat/runtime/stream/projection.mts`
- Create: `test/electron/main/modules/chat/runtime/stream/projection.test.ts`
- Modify: `electron/main/modules/chat/runtime/types.mts`

**Interfaces:**

- Consumes: 工作 `ChatMessageRecord`、延迟创建快照函数、完整写入函数、小型 delta 发送函数。
- Produces: `AssistantProjection`，包含 `append`、`mark`、`checkpoint`、`flush`、`cancel`、`revision`。

- [ ] **Step 1: Write fake-timer scheduler tests**

覆盖：16 毫秒普通实时刷新、50 毫秒最大等待、64 KiB 立即刷新、100/250 毫秒快照刷新、慢写期间只保留最新脏状态、检查点顺序、失败传播和取消后无晚到计时器。

核心断言：

```typescript
projection.append({ kind: 'append-text', partId: 'text-1', text: 'a' });
projection.append({ kind: 'append-text', partId: 'text-1', text: 'b' });
await vi.advanceTimersByTimeAsync(16);
expect(emitDelta).toHaveBeenCalledWith({ baseRevision: 0, revision: 2, mutations: [{ kind: 'append-text', partId: 'text-1', text: 'ab' }] });
expect(persist).not.toHaveBeenCalled();
await vi.advanceTimersByTimeAsync(84);
expect(persist).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/electron/main/modules/chat/runtime/stream/projection.test.ts --reporter=dot`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: Implement projection types**

在 `types.mts` 定义：

```typescript
export type ChatRuntimeAssistantUpdater = (message: ChatMessageRecord, revision?: number) => Promise<void>;
export type ChatRuntimeAssistantDeltaEmitter = (delta: ChatRuntimeMessageDelta) => void;
export type ChatRuntimeStreamExecutor = (
  input: ChatRuntimeStreamExecutorInput,
  updateAssistant: ChatRuntimeAssistantUpdater,
  emitDelta?: ChatRuntimeAssistantDeltaEmitter
) => Promise<ChatRuntimeStreamExecutorResult>;
```

- [ ] **Step 4: Implement the coalescer**

使用 `lodash-es/debounce` 建立两个互不竞争的调度器。`append` 每次递增 revision、合并相邻同目标 mutation 并标脏；`mark` 只递增 revision 并标脏；`checkpoint` 先刷新 delta，再串行刷新最新快照；`flush` 循环直到没有写入期间新增的脏状态；`cancel` 清理 timer 和引用。

- [ ] **Step 5: Run scheduler tests**

Run: `pnpm exec vitest run test/electron/main/modules/chat/runtime/stream/projection.test.ts --reporter=dot`

Expected: PASS，且 fake timers 结束后 `vi.getTimerCount()` 为 0。

### Task 3: Shared delta protocol and Renderer projection

**Files:**

- Modify: `types/chat-runtime.d.ts`
- Modify: `types/electron-api.d.ts`
- Modify: `electron/preload/index.mts`
- Modify: `electron/main/modules/chat/runtime/service.mts`
- Modify: `src/ai/chat/sessionEvents.ts`
- Modify: `src/hooks/useChat/useRuntimeEvents.ts`
- Modify: `src/components/BChat/hooks/useChatHistory.ts`
- Modify: `src/components/BChat/hooks/useChatWorkflow.ts`
- Modify: `test/components/BChat/runtime-event-test-utils.ts`
- Modify: `test/components/BChat/use-chat-history.test.ts`
- Modify: `test/components/BChat/session-id-runtime.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/service.test.ts`

**Interfaces:**

- Consumes: Task 2 `ChatRuntimeMessageDelta`。
- Produces: `chat:runtime:message-delta`、`chatRuntimeOnMessageDelta`、`applyLiveDelta(event): boolean`。

- [ ] **Step 1: Write protocol and history failures**

测试连续 revision、旧 revision、缺口 revision、缺失目标 Part 创建、完整检查点恢复，以及 runtime 地址过滤。期望 API：

```typescript
history.upsertLiveMessage(createMessage('assistant-1', ''), 0);
expect(history.applyLiveDelta({ messageId: 'assistant-1', baseRevision: 0, revision: 1, mutations: [mutation] })).toBe(true);
expect(history.applyLiveDelta({ messageId: 'assistant-1', baseRevision: 0, revision: 1, mutations: [mutation] })).toBe(false);
expect(history.applyLiveDelta({ messageId: 'assistant-1', baseRevision: 3, revision: 4, mutations: [mutation] })).toBe(false);
```

- [ ] **Step 2: Verify the protocol tests fail**

Run: `pnpm exec vitest run test/components/BChat/use-chat-history.test.ts test/components/BChat/session-id-runtime.test.ts test/electron/main/modules/chat/runtime/service.test.ts --reporter=dot`

Expected: FAIL，因为共享事件、Preload listener 与局部应用函数尚不存在。

- [ ] **Step 3: Add shared event types**

新增：

```typescript
export type ChatRuntimeMessageMutation =
  | { kind: 'append-text'; partId: string; text: string }
  | { kind: 'append-reasoning'; partId: string; text: string }
  | { kind: 'append-tool-input'; toolCallId: string; text: string };

export interface ChatRuntimeMessageDeltaEvent extends ChatRuntimeEventBase {
  /** Assistant 消息 ID。 */
  messageId: string;
  /** 合并前修订号。 */
  baseRevision: number;
  /** 合并后修订号。 */
  revision: number;
  /** 有序追加变更。 */
  mutations: ChatRuntimeMessageMutation[];
}
```

`ChatRuntimeMessageEvent` 增加可选 `revision`，事件映射增加 `chat:runtime:message-delta`。

- [ ] **Step 4: Wire Main and Preload**

`updateAssistantMessage(runtime, message, revision?)` 把 revision 放入检查点；执行器第三个回调把 delta 与 `createRuntimeEventBase(runtime)` 组合后发送。Preload 与 `ElectronAPI` 增加 `chatRuntimeOnMessageDelta`，销毁时精确移除同一个 handler。

- [ ] **Step 5: Apply deltas locally**

`useChatHistory` 为 Runtime revision 使用独立 Map。只在 `baseRevision` 等于本地 revision 时追加目标 Part；更新 `message.content`、`message.thinking` 或工具 `inputText`，并推进既有历史竞争 revision。完整 `upsertLiveMessage(message, revision)` 接受较新检查点并恢复缺口。

- [ ] **Step 6: Route the event**

应用级 listener 先执行现有 Runtime 地址校验，再发布 `messageDelta` Session UI 事件；`useChatWorkflow` 调用 `options.applyLiveDelta`。事件总线不缓存 delta，重新挂载依靠数据库与后续检查点恢复。

- [ ] **Step 7: Run protocol tests**

Run: `pnpm exec vitest run test/components/BChat/use-chat-history.test.ts test/components/BChat/session-id-runtime.test.ts test/electron/main/modules/chat/runtime/service.test.ts --reporter=dot`

Expected: PASS。

### Task 4: Stream executor integration and tool-input boundary parsing

**Files:**

- Modify: `electron/main/modules/chat/runtime/stream/index.mts`
- Modify: `electron/main/modules/chat/runtime/stream/message-parts.mts`
- Modify: `test/electron/main/modules/chat/runtime/stream/executor.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/stream/message-parts.test.ts`

**Interfaces:**

- Consumes: Task 2 `createAssistantProjection`，Task 3 delta emitter。
- Produces: 文本/思考/工具输入不阻塞的流热路径，以及工具输入结束时的一次解析。

- [ ] **Step 1: Add failing hot-path tests**

使用 1,000 个同步文本 chunk，断言执行完成前 updater 调用有界、delta 内容无损、最终快照完整；用分片工具 JSON 断言 `input` 在 `tool-input-end` 前保持 `null`，结束后只解析一次完整值。

- [ ] **Step 2: Verify tests fail**

Run: `pnpm exec vitest run test/electron/main/modules/chat/runtime/stream/executor.test.ts test/electron/main/modules/chat/runtime/stream/message-parts.test.ts --reporter=dot`

Expected: FAIL，因为当前每个 chunk 都 await 完整写入并重复解析 JSON。

- [ ] **Step 3: Return stable Part IDs**

`appendTextDelta` 与 `appendReasoningDelta` 返回实际追加的 Part ID。新建或复用 Part 后都返回 `lastPart.id`，供 mutation 精确寻址。

- [ ] **Step 4: Move JSON parsing to input end**

`appendToolInputDelta` 只追加 `inputText`；`appendToolInputEnd` 对完整非空文本同步解析一次，失败时保留 `inputText` 且将 `input` 保持 `null`，随后切换 `executing`。权威 `tool-call` 继续覆盖 `input`。

- [ ] **Step 5: Replace per-chunk persistence**

在执行器入口创建 projection。文本、思考、工具输入 delta 调用 `projection.append`；工具开始/结束/调用/结果、协议错误、未知工具和完成调用 `await projection.checkpoint()`；Watchdog 调用 `projection.mark()`。外层 `finally` 在正常路径 `flush`，结束后 `cancel`；错误路径保留原错误并清理 timer。

- [ ] **Step 6: Run stream regression tests**

Run: `pnpm exec vitest run test/electron/main/modules/chat/runtime/stream --reporter=dot`

Expected: PASS，最终 Assistant 内容、工具结果与延迟委派过滤保持原语义。

### Task 5: Force-final streaming filter and output budgets

**Files:**

- Modify: `electron/main/modules/chat/runtime/stream/final-text.mts`
- Modify: `electron/main/modules/chat/runtime/stream/index.mts`
- Modify: `electron/main/modules/ai/errors/codes.mts`
- Modify: `electron/main/modules/ai/tool-loop-policy.mts`
- Create: `electron/main/modules/chat/runtime/messages/round-budget.mts`
- Modify: `electron/main/modules/chat/runtime/service.mts`
- Modify: `test/electron/main/modules/chat/runtime/stream/final-text.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/stream/executor.test.ts`
- Modify: `test/electron/main/modules/ai/tool-loop-policy.test.ts`
- Create: `test/electron/main/modules/chat/runtime/messages/round-budget.test.ts`

**Interfaces:**

- Consumes: Task 4 projection append/checkpoint。
- Produces: `createFinalTextFilter()`、流事件/文本硬边界、32 轮可恢复用户确认边界。

- [ ] **Step 1: Write split-marker and budget failures**

逐字符切分每种协议标记，断言普通前缀在流结束前释放且协议正文不泄漏。构造超过 2 MiB 文本、100,001 个事件和 32 个不同工具步骤，断言稳定错误或可恢复等待状态。

- [ ] **Step 2: Verify tests fail**

Run: `pnpm exec vitest run test/electron/main/modules/chat/runtime/stream/final-text.test.ts test/electron/main/modules/chat/runtime/stream/executor.test.ts test/electron/main/modules/ai/tool-loop-policy.test.ts --reporter=dot`

Expected: FAIL，因为当前强制回答全量缓存且没有资源计数。

- [ ] **Step 3: Implement bounded final filter**

接口固定为：

```typescript
export interface FinalTextFilter {
  /** 输入一个 Provider 文本片段并返回可立即展示的安全前缀。 */
  push: (text: string) => string;
  /** 结束时返回剩余安全尾文本。 */
  finish: () => string;
  /** 是否已经识别协议泄漏。 */
  blocked: () => boolean;
}
```

只保留最长协议标记前缀所需尾部；发现标记后输出一次稳定阻止说明并丢弃后续文本。保留 `sanitizeFinalText` 作为完整文本兼容入口，并让它复用过滤器。

- [ ] **Step 4: Enforce stream budgets**

每个 `streamExecutor` 调用维护 `streamEventCount` 与 `streamTextChars`。超过上限时中止当前 Runtime controller，并抛出新增 `OUTPUT_TOO_LARGE` 或 `STREAM_EVENT_LIMIT`。计数只记录数字，不记录正文。

- [ ] **Step 5: Enforce round budget**

新增 `appendRoundBudgetPrompt(message)`，创建一个结构合法的内部 `question` Tool Part：

```typescript
export function appendRoundBudgetPrompt(message: ChatMessageRecord, createId: () => string): void {
  const toolCallId = `runtime-round-budget-${createId()}`;
  const questionId = `runtime-round-question-${createId()}`;
  const question = '本次任务已连续执行 32 个模型步骤，是否继续？';
  const options = [
    { label: '继续', value: 'continue' },
    { label: '停止', value: 'stop' }
  ];
  message.parts.push({
    id: createId(),
    type: 'tool',
    toolCallId,
    toolName: 'question',
    status: 'done',
    input: { question, mode: 'single', options },
    result: { toolName: 'question', status: 'awaiting_user_input', data: { questionId, toolCallId, question, mode: 'single', options } }
  });
  message.loading = true;
  message.finished = false;
}
```

`executeRuntimeStreamRounds` 在第 32 个仍要求续轮的步骤后写入该 Part、持久化并返回。现有 `createPendingInteraction`、用户选择提交和 continuation 会把“继续”结果转换为成功 Tool Result，新 Runtime 自动获得新的 32 轮预算；选择“停止”按既有取消语义收口。该边界不增加总墙钟，不影响工具 Watchdog 与等待用户时钟。

- [ ] **Step 6: Run focused tests**

Run: `pnpm exec vitest run test/electron/main/modules/chat/runtime/stream/final-text.test.ts test/electron/main/modules/chat/runtime/stream/executor.test.ts test/electron/main/modules/ai/tool-loop-policy.test.ts --reporter=dot`

Expected: PASS。

### Task 6: Streaming state and stable message tails

**Files:**

- Modify: `src/components/BChat/components/MessageBubble.vue`
- Modify: `src/components/BChat/components/MessageBubble/BubblePartText/index.vue`
- Modify: `src/components/BChat/components/MessageBubble/BubblePartThinking/index.vue`
- Modify: `test/components/BChat/message-bubble.component.test.ts`
- Modify: `test/components/BChat/bubble-part-thinking.test.ts`
- Modify: `test/components/BMessage/parser.test.ts`

**Interfaces:**

- Consumes: Assistant `finished` 与有序 Part。
- Produces: 文本/思考 `streaming: boolean` Prop 和稳定流式尾节点 ID。

- [ ] **Step 1: Write failing propagation tests**

挂载未完成 Assistant，断言只有最后一个文本或思考 Part 的 `BMessage.loading` 为 true；完成消息与工具之前的旧文本为 false。追加内容后断言尾节点 ID 保持 `block-tail-*`。

- [ ] **Step 2: Verify tests fail**

Run: `pnpm exec vitest run test/components/BChat/message-bubble.component.test.ts test/components/BChat/bubble-part-thinking.test.ts test/components/BMessage/parser.test.ts --reporter=dot`

Expected: FAIL，当前两个 Part 都未传 `loading`。

- [ ] **Step 3: Propagate precise streaming state**

`MessageBubbleRenderItem` 的 text/thinking 分支增加 `streaming`。仅当 Assistant 未完成且该 Part 是消息最后一个 Part 时为 true；传给两个 Part 组件，再传给 `BMessage :loading="streaming"`。

- [ ] **Step 4: Run focused tests**

Run: `pnpm exec vitest run test/components/BChat/message-bubble.component.test.ts test/components/BChat/bubble-part-thinking.test.ts test/components/BMessage/parser.test.ts --reporter=dot`

Expected: PASS。

### Task 7: Markdown complexity guard and Worker parsing

**Files:**

- Create: `src/components/BMessage/utils/messageSafety.ts`
- Create: `src/components/BMessage/utils/messageParser.worker.ts`
- Create: `src/components/BMessage/utils/messageWorker.ts`
- Modify: `src/components/BMessage/index.vue`
- Modify: `test/components/BMessage/parser.test.ts`
- Create: `test/components/BMessage/message-safety.test.ts`
- Create: `test/components/BMessage/message-worker.test.ts`
- Modify: `test/components/BMessage/scheduling.test.ts`

**Interfaces:**

- Consumes: `ParseMessageNodesOptions`。
- Produces: `inspectMessageSafety(content)`、`parseMessageInWorker(options)`、`cancelMessageParse(requestId)`。

- [ ] **Step 1: Write safety and async ordering failures**

测试 4,000 层引用、4,000 层列表、混合容器和 2 MiB 文本返回 `mode: 'text'`；测试较旧 Worker Promise 后完成时不能覆盖较新结果，卸载后结果被忽略，Worker 失败显示当前纯文本。

- [ ] **Step 2: Verify tests fail**

Run: `pnpm exec vitest run test/components/BMessage/message-safety.test.ts test/components/BMessage/message-worker.test.ts test/components/BMessage/scheduling.test.ts --reporter=dot`

Expected: FAIL，安全扫描与 Worker 管理器尚不存在。

- [ ] **Step 3: Implement linear safety inspection**

`inspectMessageSafety` 返回：

```typescript
export interface MessageSafetyResult {
  /** 实际解析模式。 */
  mode: MessageNodeRenderMode;
  /** 降级原因。 */
  reason?: 'content-too-large' | 'container-depth';
}
```

逐行扫描引用前缀，并扫描单行连续列表标记；推算深度超过 128 或长度超过 2 MiB 时返回 text。扫描不得调用 `marked`。

- [ ] **Step 4: Implement Worker and manager**

Worker 接收 `{ requestId, options }`，调用 `parseMessageNodes` 后发送 `{ requestId, result }`；失败只发送错误名称。共享 manager 使用 Map 保存 resolver，组件取消时删除 resolver，Worker 不可用或错误时 reject，让组件走纯文本降级。

- [ ] **Step 5: Integrate BMessage**

小于 32 KiB 继续使用现有 scheduler；大消息在安全扫描后进入 Worker。每个 snapshot 绑定递增 request token，只有仍等于 `latestSnapshot` 的结果可以提交。所有异常都用当前内容执行 text 模式；调用 `console.error` 时只包含长度、模式和错误类型。

- [ ] **Step 6: Run BMessage tests**

Run: `pnpm exec vitest run test/components/BMessage --reporter=dot`

Expected: PASS，深度输入不再触发 RangeError。

### Task 8: Shell output coalescing

**Files:**

- Create: `src/hooks/useChat/shellOutputCoalescer.ts`
- Modify: `src/hooks/useChat/useRuntimeEvents.ts`
- Modify: `test/components/BChat/shell-run-events.test.ts`
- Modify: `test/components/BChat/shell-output.test.ts`

**Interfaces:**

- Consumes: `ElectronShellCommandOutputChunk`。
- Produces: 每 command 16/50 毫秒有序合并器，支持 `push`、`flush`、`cancel`。

- [ ] **Step 1: Write fake-timer output tests**

快速推入 stdout、stdout、stderr，断言相邻同 stream 文本合并、跨 stream 顺序保留、50 毫秒必发、finished/cancel/dispose 前刷新或清理。

- [ ] **Step 2: Verify tests fail**

Run: `pnpm exec vitest run test/components/BChat/shell-run-events.test.ts test/components/BChat/shell-output.test.ts --reporter=dot`

Expected: FAIL，当前 raw chunk 直接发布。

- [ ] **Step 3: Implement and route coalescer**

合并器使用 `lodash-es/debounce`。`handleShellOutput` 只校验路由并 push；flush 回调批量发布保持 sequence/createdAt 的安全 chunk。`finished`、工具清理、取消和 `onScopeDispose` 分别 flush 或 cancel，不能留下 timer。

- [ ] **Step 4: Run Shell tests**

Run: `pnpm exec vitest run test/components/BChat/shell-run-events.test.ts test/components/BChat/shell-output.test.ts test/components/BChat/bubble-part-tool-shell.test.ts --reporter=dot`

Expected: PASS。

### Task 9: Changelog and complete verification

**Files:**

- Modify: `changelog/2026-08-10.md`
- Review: all files changed by Tasks 1-8

**Interfaces:**

- Consumes: 全部实现与专项测试。
- Produces: 可由用户自行提交的已验证工作区。

- [ ] **Step 1: Record the change**

在 `Changed` 中记录实时 delta/耐久快照解耦、Markdown 安全降级、Shell 背压和文件工具隐私展示；不存在对应章节时按项目格式新增。

- [ ] **Step 2: Run the full focused suite**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/runtime/stream test/electron/main/modules/chat/runtime/service.test.ts test/electron/main/modules/ai/tool-loop-policy.test.ts test/components/BChat test/components/BMessage --reporter=dot
```

Expected: 0 failed test files and 0 failed tests。

- [ ] **Step 3: Run static checks**

Run:

```bash
pnpm exec tsc --noEmit
pnpm exec eslint src electron test --ext .vue,.ts,.tsx,.js,.jsx,.mts
pnpm exec stylelint 'src/**/*.{vue,less,css}'
```

Expected: all commands exit 0。

- [ ] **Step 4: Inspect the final diff**

Run: `git diff --check && git status --short && git diff --stat`

Expected: no whitespace errors；只包含本计划文档、设计文档、实现、测试和当天 changelog，不包含临时基准文件或 Git 提交。

- [ ] **Step 5: Re-audit every acceptance criterion**

逐项对照 `docs/superpowers/specs/2026-08-10-bchat-stream-backpressure-remediation-design.md` 的十条验收标准，并用上述测试或静态检查输出定位证据。发现缺口时回到对应任务补失败测试，不以解释代替验证。
