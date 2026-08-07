# BChat Pipe Shell Stable Terminal Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 BChat 普通 pipe Shell 的逐行错位、spinner 中间帧闪烁、Runtime 消息覆盖临时终端态和浏览器二次折行，并补齐 `close` 尾部输出、稳定帧刷新、投影背压与空 finished 状态的 CR 问题。

**Architecture:** stdout/stderr 原始 chunk 继续通过 `shell:output` 即时发送；headless terminal 串行投影受 1 MiB/512 KiB 高低水位背压保护，并通过 16ms trailing settle、50ms 最大等待发布 `terminal_update`。正常进程只在 `close` 后收敛；Renderer 不为孤立 `finished` 创建空终端状态。

**Tech Stack:** Electron main process、Vue 3、TypeScript strict、`@xterm/headless`、Vitest、Vue Test Utils、ESLint、Stylelint

## Global Constraints

- 普通 pipe 命令不能切换到 PTY，不能启用或修改 `TIBIS_SHELL_AUTO_DEFAULT_CAPABILITY`，不能自动输入。
- 原始 stdout/stderr、stream、sequence、退出码、取消、超时和安全分析语义保持不变。
- pipe raw chunk 即时发送；Screen Snapshot 最多 20 FPS，实时内容最多 12,000 字符。
- projector 失败只能关闭显示旁路，不能改变命令生命周期或原始结果。
- 所有工具继续只展示活动状态，并保留现有“继续等待/停止”按钮逻辑。
- 禁止 `any`；函数参数与返回值显式标注；新增接口、函数和复杂逻辑带意图注释；函数名不超过四个单词。
- 用户明确要求不执行 `git add`、`git commit` 或其他提交操作。

---

### Task 1: 修复 Pipe LF 终端语义

**Files:**
- Modify: `test/electron/main/modules/shell/screen-projector.test.ts`
- Modify: `electron/main/modules/shell/interaction/screen-projector.mts`

**Interfaces:**
- Consumes: `createScreenProjector(options: ScreenProjectorOptions): TerminalSnapshotProjector`
- Produces: `ScreenProjectorOptions.convertEol?: boolean`

- [x] **Step 1: 写入失败测试**

在 `screen-projector.test.ts` 使用真实 projector 验证 pipe LF：

```ts
it('returns to column zero for pipe line feeds when convertEol is enabled', async (): Promise<void> => {
  const projector = createScreenProjector({ columns: 40, rows: 8, convertEol: true });
  await projector.write('alpha\nbeta\ngamma');

  expect(projector.snapshot(Date.now()).content).toBe('alpha\nbeta\ngamma');
  projector.dispose();
});
```

- [x] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run test/electron/main/modules/shell/screen-projector.test.ts`

Expected: FAIL，实际内容为向右错位的 `alpha\n     beta\n         gamma`。

- [x] **Step 3: 写入最小实现**

扩展 projector 选项并传给 xterm：

```ts
export interface ScreenProjectorOptions {
  columns: number;
  rows: number;
  convertEol?: boolean;
}

const terminal = new Terminal({
  cols: options.columns,
  rows: options.rows,
  convertEol: options.convertEol ?? false,
  scrollback: DEFAULT_SCROLLBACK_ROWS,
  allowProposedApi: true
});
```

- [x] **Step 4: 运行测试并确认 GREEN**

Run: `pnpm exec vitest run test/electron/main/modules/shell/screen-projector.test.ts`

Expected: PASS，既有 PTY projector 用例不变。

### Task 2: 将 Pipe 画面改为稳定 run-event

**Files:**
- Modify: `test/electron/main/modules/shell/runner.test.ts`
- Modify: `electron/main/modules/shell/runner.mts`
- Modify: `electron/main/modules/shell/types.mts`
- Modify: `types/electron-api.d.ts`
- Modify: `types/chat.d.ts`
- Modify: `electron/preload/index.mts`
- Modify: `electron/main/modules/shell/ipc.mts`
- Modify: `src/components/BChat/utils/messageHelper.ts`

**Interfaces:**
- Consumes: `ShellRunEventSink`、`TerminalSnapshotProjector`
- Produces: pipe `terminal_update` / `finished` 事件；不含 Screen Snapshot 的原始 `ShellCommandOutputChunk`

- [ ] **Step 1: 写入失败测试**

修改 runner spinner 用例，使 raw sink 与 run-event 分别断言：

```ts
it('emits only the latest pipe screen after adjacent redraw chunks', async (): Promise<void> => {
  const { child, finish } = createChildProcess();
  const chunks: ShellCommandOutputChunk[] = [];
  const events: ShellRunEventEnvelope[] = [];
  const runner = createShellCommandRunner({
    spawnProcess: (): ChildProcessWithoutNullStreams => child
  });
  const resultPromise = runner.run(createPipeRequest('pipe-spinner'), (chunk): void => chunks.push(chunk), (event): void => events.push(event));

  await waitForChildListeners(child);
  emitChildOutput(child, 'stdout', '\u001b[1G\u001b[J');
  emitChildOutput(child, 'stdout', 'Cloning repository…');
  finish();
  const result = await resultPromise;

  expect(chunks.map((chunk): string => chunk.text)).toEqual(['\u001b[1G\u001b[J', 'Cloning repository…']);
  expect(chunks.every((chunk): boolean => !('terminalContent' in chunk))).toBe(true);
  expect(events.filter((event): boolean => event.event.type === 'terminal_update')).toEqual([
    expect.objectContaining({ event: { type: 'terminal_update', content: 'Cloning repository…' } })
  ]);
  expect(events.at(-1)?.event.type).toBe('finished');
  expect(result.terminalOutput).toBe('Cloning repository…');
});
```

同时更新 factory 断言，要求 pipe 创建 projector 时传入 `{ columns: 100, rows: 30, convertEol: true }`。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run test/electron/main/modules/shell/runner.test.ts`

Expected: FAIL，当前实现把快照附在每个 raw chunk 上，且 pipe 不产生 run-event。

- [ ] **Step 3: 实现即时 raw 与 50ms 稳定画面**

在 `runner.mts`：

```ts
const TERMINAL_UPDATE_INTERVAL_MS = 50;

function emitRunEvent(event: ShellRunEvent): void {
  runEventSequence += 1;
  try {
    eventSink?.({ commandId: request.commandId, sequence: runEventSequence, createdAt: new Date().toISOString(), event });
  } catch {
    // 显示旁路异常不能改变命令生命周期。
  }
}

function queueTerminalUpdate(content: string): void {
  pendingTerminalContent = content;
  if (terminalUpdateTimer) return;
  terminalUpdateTimer = setTimeout(flushTerminalUpdate, TERMINAL_UPDATE_INTERVAL_MS);
}
```

`handleOutput` 先 `emitOutput(rawChunk)`，再把 projector write 加入 Promise 队列。每次投影只更新 pending；终态 `await projectionQueue` 后调用 `flushTerminalUpdate()`，构建结果，再发送 `{ type: 'finished', result }`。

- [ ] **Step 4: 清理上一版 chunk 快照契约**

从三个 chunk 类型删除 `terminalContent`，并让 `shellOutputPart` 只执行：

```ts
const output = [...(existingPart.shellOutput ?? []), chunk];
existingPart.shellOutput = boundShellOutput(output);
```

把 `ShellRunEvent`、preload 与 IPC 的注释从 PTY 专属改为通用 Shell 有序事件；事件结构不变。

- [ ] **Step 5: 运行主进程与消息 helper 测试并确认 GREEN**

Run: `pnpm exec vitest run test/electron/main/modules/shell/runner.test.ts test/electron/main/modules/shell/screen-projector.test.ts test/electron/main/modules/shell/pty-runner.test.ts test/components/BChat/shell-output.test.ts test/components/BChat/shell-run-events.test.ts`

Expected: PASS；raw chunk 连续保留，屏幕只从 run-event 更新。

### Task 3: 避免 Pipe 画面重复上报工具活动

**Files:**
- Modify: `test/hooks/use-runtime-events.test.ts`
- Modify: `src/hooks/useChat/useRuntimeEvents.ts`

**Interfaces:**
- Consumes: `ShellEventRoute.outputChars`、`terminal_update`
- Produces: pipe raw 只上报一次进展；PTY terminal update 继续上报进展

- [ ] **Step 1: 写入失败测试**

在已有 Shell 路由测试中，先发送 raw chunk，再发送对应 terminal update，断言 `chatRuntimeSubmitToolActivity` 的 progress 数量没有增加：

```ts
emitShellOutput({ commandId, stream: 'stdout', text: 'raw output', sequence: 1, createdAt: 'now' });
await flushPromises();
const progressCount = readProgressCalls().length;

emitShellRunEvent({
  commandId,
  sequence: 1,
  createdAt: 'now',
  event: { type: 'terminal_update', content: 'raw output' }
});
await flushPromises();

expect(readProgressCalls()).toHaveLength(progressCount);
```

保留或增加 PTY-only 用例，未收到 raw chunk 时 terminal update 必须产生 progress。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run test/hooks/use-runtime-events.test.ts`

Expected: FAIL，当前 raw 与 terminal update 都调用 `route.reportProgress`。

- [ ] **Step 3: 写入最小实现**

只在 PTY 路由上报 terminal update 活动：

```ts
if (event.event.type === 'terminal_update' && event.event.content !== route.lastTerminalContent) {
  route.lastTerminalContent = event.event.content;
  if (route.outputChars === 0) {
    route.reportProgress({
      phase: 'shell_output',
      completed: event.event.content.length,
      message: createShellSummary(event.event.content)
    });
  }
}
```

同时将函数注释从 PTY 事件改为 Shell 事件。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `pnpm exec vitest run test/hooks/use-runtime-events.test.ts`

Expected: PASS，pipe 无重复 progress，PTY 行为不变。

### Task 4: 保留执行中 Shell 的 Renderer 临时态

**Files:**
- Modify: `test/components/BChat/use-chat-history.test.ts`
- Modify: `src/components/BChat/hooks/useChatHistory.ts`

**Interfaces:**
- Consumes: 当前 `Message.parts` 与 incoming `Message.parts`
- Produces: `preserveShellState(current: Message, next: Message): Message`

- [ ] **Step 1: 写入失败测试**

增加两个测试：执行中 incoming part 缺少瞬时字段时保留，done part 不保留。

```ts
it('preserves renderer Shell state across executing message updates', (): void => {
  const history = useChatHistory();
  history.setLoadedMessages([createShellMessage('executing', true)]);

  history.upsertLiveMessage(createShellMessage('executing', false));

  const part = history.messages.value[0]?.parts[0];
  expect(part?.type === 'tool' ? part.shellRunState?.terminalContent : undefined).toBe('stable screen');
  expect(part?.type === 'tool' ? part.shellOutput?.[0]?.text : undefined).toBe('raw output');
});
```

done 用例期望 `shellRunState` 和 `shellOutput` 为 `undefined`，并保留 incoming 结构化 result。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run test/components/BChat/use-chat-history.test.ts`

Expected: FAIL，当前浅合并整体替换 `parts`。

- [ ] **Step 3: 写入最小实现**

新增带 JSDoc 的纯函数，按 `toolCallId` 只补回缺失的 Shell 临时字段：

```ts
function preserveShellState(current: Message, next: Message): Message {
  if (!current.parts || !next.parts) return next;
  const currentTools = new Map(
    current.parts
      .filter((part): part is ChatMessageToolPart => part.type === 'tool' && part.toolName === 'run_shell_command')
      .map((part): [string, ChatMessageToolPart] => [part.toolCallId, part])
  );
  const parts = next.parts.map((part): ChatMessagePart => {
    if (part.type !== 'tool' || part.toolName !== 'run_shell_command' || part.status === 'done') return part;
    const previous = currentTools.get(part.toolCallId);
    if (!previous) return part;
    return {
      ...part,
      ...(part.shellOutput === undefined && previous.shellOutput !== undefined ? { shellOutput: previous.shellOutput } : {}),
      ...(part.shellRunState === undefined && previous.shellRunState !== undefined ? { shellRunState: previous.shellRunState } : {})
    };
  });
  return { ...next, parts };
}
```

`upsertLiveMessage` 在 splice 前调用该函数；其他 message 字段仍由 incoming 覆盖。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `pnpm exec vitest run test/components/BChat/use-chat-history.test.ts test/components/BChat/session-id-runtime.test.ts`

Expected: PASS，实时历史竞态回归不受影响。

### Task 5: 固定终端字符网格并阻止空屏回退

**Files:**
- Modify: `test/components/BChat/bubble-part-tool-shell.test.ts`
- Modify: `src/components/BChat/components/MessageBubble/BubblePartTool/index.vue`
- Modify: `src/components/BChat/components/MessageBubble/BubblePartTool/ToolShellDisplay.vue`

**Interfaces:**
- Consumes: `ChatMessageToolPart.shellRunState`
- Produces: 空 Screen Snapshot 仍具权威性；终端输出不二次折行

- [ ] **Step 1: 写入失败测试**

增加执行态空屏测试：

```ts
it('does not fall back to raw output when a projected screen is empty', (): void => {
  const part = createShellPart({
    shellOutput: [{ commandId: 'command-empty', stream: 'stdout', text: 'stale raw', sequence: 1, createdAt: 'now' }],
    shellRunState: { terminalContent: '', autoAnswers: [], lastSequence: 1, finished: false }
  });
  const wrapper = mountShellPart(part);

  expect(wrapper.text()).not.toContain('stale raw');
});
```

增加源码样式断言：output 规则包含 `white-space: pre`，不含 `pre-wrap`，并包含 `overflow-wrap: normal`、`word-break: normal`。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run test/components/BChat/bubble-part-tool-shell.test.ts`

Expected: FAIL，当前空字符串回退 raw，CSS 使用 `pre-wrap`。

- [ ] **Step 3: 写入最小实现**

修改执行态优先级：

```ts
if (props.part.shellRunState) return props.part.shellRunState.terminalContent;
```

修改终端样式：

```less
.bubble-part-tool__shell-terminal {
  line-height: 1.2;
}

.bubble-part-tool__shell-output {
  overflow-wrap: normal;
  color: var(--text-secondary);
  white-space: pre;
  word-break: normal;
}
```

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `pnpm exec vitest run test/components/BChat/bubble-part-tool-shell.test.ts`

Expected: PASS，命令、执行态、最终结构化结果和失败提示回归均通过。

### Task 6: 文档、变更日志与完整验证

**Files:**
- Modify: `changelog/2026-08-07.md`
- Verify: `docs/superpowers/specs/2026-08-07-bchat-pipe-terminal-projection-design.md`
- Verify: `docs/superpowers/plans/2026-08-07-bchat-pipe-terminal-projection.md`

**Interfaces:**
- Consumes: Tasks 1–5 的实现与测试
- Produces: 可由用户自行审阅和提交的未暂存工作区

- [ ] **Step 1: 更新 changelog**

在 `## Changed` 记录：

```md
- 修复 BChat 普通管道 Shell 的 LF 换行错位、spinner 中间帧闪烁和 Runtime 消息更新擦除临时终端态的问题；原始输出继续实时传输，终端画面改为有界稳定帧，并使用固定字符网格展示。
```

- [ ] **Step 2: 运行相关测试**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/shell/runner.test.ts test/electron/main/modules/shell/screen-projector.test.ts test/electron/main/modules/shell/pty-runner.test.ts test/components/BChat/shell-output.test.ts test/components/BChat/shell-run-events.test.ts test/components/BChat/bubble-part-tool-shell.test.ts test/components/BChat/use-chat-history.test.ts test/hooks/use-runtime-events.test.ts test/components/BChat/session-id-runtime.test.ts
```

Expected: 所有测试通过，无未处理异常。

- [ ] **Step 3: 运行类型与规范检查**

Run:

```bash
pnpm exec tsc --noEmit
pnpm exec tsc -p electron/tsconfig.json --noEmit
pnpm exec eslint src --ext .vue,.ts,.tsx,.js,.jsx
pnpm exec stylelint 'src/**/*.{vue,less,css}'
```

Expected: 四条命令退出码均为 0。

- [ ] **Step 4: 审核范围与不变量**

Run:

```bash
git diff --check
git diff -- electron/main/modules/shell/interaction/capability.mts
git diff --cached --name-only
git status --short
```

Expected: diff check 无输出；capability 文件无 diff；暂存区为空；只有用户既有和本次未暂存/未跟踪变更。

### Task 7: 等待 Stdio Close 并保留退出尾部

**Files:**
- Modify: `test/electron/main/modules/shell/runner.test.ts`
- Modify: `electron/main/modules/shell/runner.mts`

- [x] **Step 1: 写入失败测试**

让可控 child 分别暴露 `exit` 与 `close`：先发出 `exit`，再注入 stdout 尾部，断言 Promise 和 `finished` 尚未完成；发出 `close` 后断言 raw、`terminalOutput` 与最终结果都包含尾部。

- [x] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run test/electron/main/modules/shell/runner.test.ts`

Expected: FAIL，当前 runner 在 `exit` 时提前收敛。

- [x] **Step 3: 写入最小实现**

正常生命周期从监听 `exit` 改为监听 `close` 并在该事件中派生 termination；取消/超时的双宽限期强制 resolve 保持不变。

- [x] **Step 4: 运行测试并确认 GREEN**

Run: `pnpm exec vitest run test/electron/main/modules/shell/runner.test.ts`

Expected: PASS，既有正常退出、取消、超时语义不变。

### Task 8: 稳定帧与投影队列背压

**Files:**
- Modify: `test/electron/main/modules/shell/runner.test.ts`
- Modify: `electron/main/modules/shell/runner.mts`

- [x] **Step 1: 写入两个失败测试**

1. 使用 fake timers 模拟已发布非空帧、清屏跨越旧 50ms 边界、16ms 内重绘，断言事件中从未出现空画面且最终发布重绘帧。
2. 使用延迟 projector write 形成超过 1 MiB 的积压，断言 stdout/stderr 被暂停；逐步释放写入至 512 KiB 以下后断言两条流恢复，且顺序未丢失。

- [x] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run test/electron/main/modules/shell/runner.test.ts`

Expected: FAIL，固定窗口会发布空帧，当前投影链无背压。

- [x] **Step 3: 写入最小实现**

- 使用 `lodash-es/debounce` 建立 `wait: 16`、`maxWait: 50` 的 trailing publisher。
- 非终态发布时，如果上一帧非空且当前帧为空，则仅保留 pending，不覆盖 UI。
- 记录 `pendingProjectionChars`；达到 1 MiB 时暂停两条流，低于或等于 512 KiB 时恢复。
- 每个队列任务通过 `finally` 扣减字符数并尝试恢复，cleanup 取消 timer 并保证流恢复。

- [x] **Step 4: 运行测试并确认 GREEN**

Run: `pnpm exec vitest run test/electron/main/modules/shell/runner.test.ts`

Expected: PASS，连续输出仍有 50ms 最大刷新等待，raw 与投影均不丢失。

### Task 9: 忽略孤立 Finished 显示状态

**Files:**
- Modify: `test/components/BChat/shell-run-events.test.ts`
- Modify: `src/components/BChat/utils/messageHelper.ts`

- [x] **Step 1: 写入失败测试**

创建只有 raw `shellOutput`、没有 `shellRunState` 的执行中 part，应用 `finished` 后断言 `shellRunState` 仍为 `undefined`。

- [x] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run test/components/BChat/shell-run-events.test.ts`

Expected: FAIL，当前 helper 会凭空创建空终端状态。

- [x] **Step 3: 写入最小实现并确认 GREEN**

在创建 state 前忽略“无既有 state 的 finished”；terminal update 与 auto answer 仍可创建状态。

Run: `pnpm exec vitest run test/components/BChat/shell-run-events.test.ts`

Expected: PASS，既有 sequence 与 freeze 测试不变。

### Task 10: CR 修复完整验证

- [x] **Step 1: 更新 `changelog/2026-08-07.md`**

记录正常结束等待 stdio close、稳定帧空擦除抑制、投影高低水位背压和孤立 finished 状态修复。

- [x] **Step 2: 运行相关与全量测试**

Run: Task 6 的九个测试文件；随后执行项目测试命令。

- [x] **Step 3: 运行类型和规范检查**

Run: renderer/electron TypeScript、ESLint、Stylelint、`git diff --check`。

- [x] **Step 4: 审核不变量**

确认 capability 文件无 diff、暂存区为空、未执行提交。
