# Chat Runtime P3 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理删除后的陈旧聊天事实、限制 Agent confirmation 终态游标容量，并为 Runtime 恢复增加保持顺序的有限退避。

**Architecture:** 三项修复保持在现有职责边界内：路由 hook 对已提交删除执行无条件本地收尾；confirmation Pinia Store 维护有界终态 tombstone；Runtime recovery hook 只在第二份权威快照阶段进行两次短退避。每项先写失败测试，再做最小实现。

**Tech Stack:** Vue 3、Pinia、TypeScript strict、Vitest 4、Vue Router、Electron Renderer IPC。

## Global Constraints

- 不改变关闭聊天标签时 Runtime 继续后台运行、重新打开后恢复投影流的行为。
- Agent pending cursor 永不因容量限制淘汰；终态 tombstone 上限固定为 512。
- Runtime replay 延迟固定为 50ms、100ms；达到上限后抛出最后一次原始错误。
- 所有异步错误使用 `asyncTo()` 归一化，不手写异步 `try/catch`。
- 所有新增函数、类型和复杂逻辑添加 JSDoc；禁止 `any`。
- 遵照用户要求，不执行 Git 暂存或提交。

---

### Task 1: 删除后无条件清理标签与 Runtime 投影

**Files:**
- Modify: `test/layouts/default/use-chat-route.test.ts`
- Modify: `src/layouts/default/hooks/useChatRoute.ts`

**Interfaces:**
- Consumes: `TabsStore.getClosePlan()`、`TabsStore.applyClosePlan()`、`ChatTabStore.removeTab()`、`router.push()`。
- Produces: `handleDeletedSession(sessionId: string): Promise<void>` 在删除已提交后始终移除目标标签和全部 Session owner 投影。

- [x] **Step 1: 将导航阻塞用例改为失败测试**

把现有用例替换为以下断言：

```ts
it('clears the deleted-session tab and Runtime owner when fallback navigation is blocked', async (): Promise<void> => {
  routeMock.fullPath = '/chat/session-a';
  const tabsStore = useTabsStore();
  const runtimeStore = useChatTabStore();
  tabsStore.tabs = [createTab('chat:session-a', '/chat/session-a')];
  runtimeStore.ensureTab('chat:session-a', 'session-a');
  routerPushMock.mockResolvedValue(routeFailureMock);

  await createRouteApi().handleDeletedSession('session-a');

  expect(syncDeletedSessionMock).toHaveBeenCalledWith('session-a');
  expect(routerPushMock).toHaveBeenCalledWith('/welcome');
  expect(tabsStore.tabs).toHaveLength(0);
  expect(runtimeStore.records['chat:session-a']).toBeUndefined();
});
```

- [x] **Step 2: 运行测试并确认 RED**

Run:

```bash
pnpm exec vitest run test/layouts/default/use-chat-route.test.ts -t "clears the deleted-session tab"
```

Expected: FAIL；修复前 `tabsStore.tabs` 仍有 1 项且 Runtime record 仍存在。

- [x] **Step 3: 删除导航失败的提前返回**

将 `handleDeletedSession()` 中导航段改为：

```ts
if (plan.requiresNavigation) {
  await asyncTo(router.push(plan.nextActivePath ?? '/welcome'));
}

tabsStore.applyClosePlan(plan);
runtimeStore.removeTab(target.tabId);
if (runtimeOwner && runtimeOwner.tabId !== target.tabId) runtimeStore.removeTab(runtimeOwner.tabId);
```

`isBlockingNavigationFailure` 仍由 `openChatPage()` 与 `handleSwitchSession()` 使用，不删除导入。

- [x] **Step 4: 运行完整路由测试并确认 GREEN**

Run:

```bash
pnpm exec vitest run test/layouts/default/use-chat-route.test.ts
```

Expected: 文件内全部测试通过。

### Task 2: 限制 Agent confirmation 终态 tombstone

**Files:**
- Modify: `test/stores/chat/confirmation-queue.test.ts`
- Modify: `src/stores/chat/confirmationQueue.ts`

**Interfaces:**
- Consumes: `AgentConfirmationCursor`、`applyAgent()`、`applyRecovery()`。
- Produces: `MAX_AGENT_TERMINAL_CURSORS = 512` 和内部 `setAgentCursor(cursors, confirmationId, cursor): void`；pending cursor 不参与淘汰。

- [x] **Step 1: 添加容量与 pending 保留失败测试**

在 confirmation queue 测试中新增：

```ts
it('bounds terminal Agent cursors without evicting pending cursors', (): void => {
  const store = useChatConfirmationQueueStore();
  const active = confirmation('active-pending', 'write', '2026-07-27T00:00:00.000Z');
  store.applyAgent(active);

  for (let index = 0; index < 513; index += 1) {
    const createdAt = new Date(Date.UTC(2026, 6, 28, 0, 0, index)).toISOString();
    const pending = confirmation(`terminal-${index}`, 'write', createdAt);
    store.applyAgent(pending);
    store.applyAgent({ ...pending, status: 'approved', version: 2, updatedAt: createdAt });
  }

  const terminalCursors = Object.values(store.agentCursors).filter((cursor): boolean => cursor.terminal);
  expect(terminalCursors).toHaveLength(512);
  expect(store.agentCursors['terminal-0']).toBeUndefined();
  expect(store.agentCursors['terminal-1']).toMatchObject({ terminal: true });
  expect(store.agentCursors['active-pending']).toMatchObject({ terminal: false });
});
```

- [x] **Step 2: 添加 recovery 缺失项终态化失败测试**

在既有 recovery 测试旁新增：

```ts
it('turns an unchanged recovery-missing cursor into a terminal fence', async (): Promise<void> => {
  const store = useChatConfirmationQueueStore();
  const missing = confirmation('missing-terminal', 'write', '2026-07-27T00:00:00.000Z');
  store.applyAgent(missing);
  agentAPI.listConfirmations.mockResolvedValue({ ok: true, data: [] });

  await store.recoverAgent();
  store.applyAgent({ ...missing, version: 99, updatedAt: '2026-07-27T00:01:39.000Z' });

  expect(store.items['missing-terminal']).toBeUndefined();
  expect(store.agentCursors['missing-terminal']).toMatchObject({ terminal: true });
});
```

- [x] **Step 3: 运行两个测试并确认 RED**

Run:

```bash
pnpm exec vitest run test/stores/chat/confirmation-queue.test.ts -t "bounds terminal Agent cursors|turns an unchanged recovery-missing cursor"
```

Expected: FAIL；终态游标为 513，且 recovery 缺失 cursor 仍为 `terminal: false` 并可被高版本 pending 复活。

- [x] **Step 4: 实现有界终态游标写入**

在 Store 定义前新增：

```ts
/** Renderer 最多保留的 Agent 终态 tombstone 数量。 */
const MAX_AGENT_TERMINAL_CURSORS = 512;

/**
 * 写入 Agent cursor，并按最近终态顺序淘汰最旧 tombstone。
 * @param cursors - 当前 Agent cursor 表
 * @param confirmationId - confirmation 身份
 * @param cursor - 最新单调 cursor
 */
function setAgentCursor(
  cursors: Record<string, AgentConfirmationCursor>,
  confirmationId: string,
  cursor: AgentConfirmationCursor
): void {
  delete cursors[confirmationId];
  cursors[confirmationId] = cursor;
  const terminalIds = Object.entries(cursors)
    .filter(([, currentCursor]): boolean => currentCursor.terminal)
    .map(([currentId]): string => currentId);
  while (terminalIds.length > MAX_AGENT_TERMINAL_CURSORS) {
    const oldestId = terminalIds.shift();
    if (oldestId) delete cursors[oldestId];
  }
}
```

`applyAgent()` 使用 `setAgentCursor()` 写入最新 cursor。实现中增加显式 `agentTerminalOrder: string[]`，避免纯数字 confirmation ID 受 JavaScript 对象键排序规则影响；终态刷新时先从顺序表移除再追加。`applyRecovery()` 确认 baseline 未变化且响应缺失时，先用 `{ ...cursor, terminal: true }` 写回，再删除 pending item 和 selection。

- [x] **Step 5: 运行完整 queue 测试并确认 GREEN**

Run:

```bash
pnpm exec vitest run test/stores/chat/confirmation-queue.test.ts
```

Expected: 文件内全部测试通过；最近终态 fence 仍拒绝伪造高版本 pending。

### Task 3: 为 Runtime replay 增加有限退避

**Files:**
- Modify: `test/hooks/use-runtime-recovery.test.ts`
- Modify: `src/hooks/useChat/useRuntimeRecovery.ts`

**Interfaces:**
- Consumes: `replayPendingRequest(actorSystem, request): Promise<void>`、`asyncTo()`、两份 Runtime snapshot。
- Produces: 内部 `REPLAY_RETRY_DELAYS = [50, 100]`、`waitForReplay(delayMs): Promise<void>`、`replayWithRetry(actorSystem, request): Promise<void>`。

- [x] **Step 1: 添加退避成功与顺序失败测试**

新增使用 fake timer 的测试：第一份快照、第二份快照和 50ms 重试失败，100ms 重试成功；分别在 49ms、50ms、149ms、150ms 检查调用次数，并断言 bridge 调用顺序晚于第四次 tool 调用。

```ts
it('backs off twice before replaying later requests in order', async (): Promise<void> => {
  vi.useFakeTimers();
  const snapshot = createSnapshot();
  electronAPIMock.chatRuntimeListActive.mockResolvedValue({ ok: true, data: [snapshot] });
  electronAPIMock.chatRuntimeSubmitToolResult
    .mockResolvedValueOnce({ ok: false, error: 'first', code: 'IPC_FAILED' })
    .mockResolvedValueOnce({ ok: false, error: 'second', code: 'IPC_FAILED' })
    .mockResolvedValueOnce({ ok: false, error: 'third', code: 'IPC_FAILED' })
    .mockResolvedValueOnce({ ok: true });
  electronAPIMock.chatRuntimeSubmitBridgeResponse.mockResolvedValue({ ok: true });
  const system = createChatActorSystem();
  system.start();

  const recovery = recoverRuntimes(system);
  await vi.advanceTimersByTimeAsync(0);
  expect(electronAPIMock.chatRuntimeSubmitToolResult).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(49);
  expect(electronAPIMock.chatRuntimeSubmitToolResult).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(electronAPIMock.chatRuntimeSubmitToolResult).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(100);
  await recovery;

  expect(electronAPIMock.chatRuntimeSubmitToolResult).toHaveBeenCalledTimes(4);
  expect(electronAPIMock.chatRuntimeSubmitToolResult.mock.invocationCallOrder[3]).toBeLessThan(
    electronAPIMock.chatRuntimeSubmitBridgeResponse.mock.invocationCallOrder[0]
  );
  system.stop();
  vi.useRealTimers();
});
```

- [x] **Step 2: 添加重试耗尽失败测试**

让 tool replay 永久返回 `{ ok: false }`，推进 150ms 后断言 `recoverRuntimes()` reject、tool 共调用 4 次、bridge 未调用，并恢复 real timer。

- [x] **Step 3: 运行两个测试并确认 RED**

Run:

```bash
pnpm exec vitest run test/hooks/use-runtime-recovery.test.ts -t "backs off twice|rejects after bounded replay retries"
```

Expected: FAIL；当前第二份快照失败后立即 reject，没有 50ms/100ms 两次重试。

- [x] **Step 4: 实现两次有限退避**

在 `replayPendingRequest()` 后新增：

```ts
/** 第二份权威快照确认 pending 后的 replay 退避序列。 */
const REPLAY_RETRY_DELAYS = [50, 100] as const;

/**
 * 等待下一次 Runtime replay。
 * @param delayMs - 等待毫秒数
 */
function waitForReplay(delayMs: number): Promise<void> {
  return new Promise<void>((resolve): void => {
    setTimeout(resolve, delayMs);
  });
}

/**
 * 立即重放一次，并在失败后执行两次有限退避。
 * @param actorSystem - 应用级 Chat actor system
 * @param request - Main 仍在等待的 Renderer 请求
 */
async function replayWithRetry(actorSystem: ChatActorSystem, request: ChatRuntimeRecoveryPendingRequest): Promise<void> {
  let lastError: unknown;
  const retryDelays = [0, ...REPLAY_RETRY_DELAYS];
  for (const delayMs of retryDelays) {
    if (delayMs > 0) {
      // eslint-disable-next-line no-await-in-loop
      await waitForReplay(delayMs);
    }
    // eslint-disable-next-line no-await-in-loop
    const [replayError] = await asyncTo(replayPendingRequest(actorSystem, request));
    if (!replayError) return;
    lastError = replayError;
  }
  throw lastError ?? new Error('Runtime replay failed');
}
```

`hydrateSnapshots()` 在 `tolerateReplayFailure` 为 `true` 时只调用一次 `replayPendingRequest()`；第二份快照阶段调用 `replayWithRetry()`。两种路径都只在成功后写入 `replayedRequestKeys`，失败时继续保持 `break` 或抛错，禁止越过当前请求。

- [x] **Step 5: 运行完整 recovery 测试并确认 GREEN**

Run:

```bash
pnpm exec vitest run test/hooks/use-runtime-recovery.test.ts
```

Expected: 文件内全部测试通过，无未处理 Promise rejection。

### Task 4: 文档与最终验证

**Files:**
- Modify: `changelog/2026-08-01.md`
- Modify: `docs/superpowers/plans/2026-08-01-uncommitted-chat-runtime-review.md`
- Modify: `docs/superpowers/plans/2026-08-01-chat-runtime-p3-hardening.md`

**Interfaces:**
- Consumes: Tasks 1–3 的 RED/GREEN 证据。
- Produces: 可审计的 changelog、完成清单和最终验证结果。

- [x] **Step 1: 记录三项修复**

在 `changelog/2026-08-01.md` 的 `Fixed` 增加删除导航失败收尾、512 个终态 tombstone 上限和 50ms/100ms Runtime replay 退避。

- [x] **Step 2: 执行三文件聚焦测试**

Run:

```bash
pnpm exec vitest run test/layouts/default/use-chat-route.test.ts test/stores/chat/confirmation-queue.test.ts test/hooks/use-runtime-recovery.test.ts
```

Expected: 全部通过。

- [x] **Step 3: 执行聊天 Runtime 聚焦矩阵**

Run:

```bash
pnpm exec vitest run test/ai/chat/actor-system.test.ts test/ai/chat/session-events.test.ts test/ai/chat/session-machine.test.ts test/components/BChat/confirmation-controller.test.ts test/components/BChat/confirmation-sheet.component.test.ts test/components/BChat/session-history.test.ts test/components/BChat/session-id-runtime.test.ts test/components/BChat/use-chat-history.test.ts test/components/BChat/use-rollback.test.ts test/components/BChat/use-runtime-tools.test.ts test/electron/main/modules/chat/runtime/ipc.test.ts test/hooks/use-runtime-events.test.ts test/hooks/use-runtime-recovery.test.ts test/layouts/default/chat-sider.test.ts test/layouts/default/header-tabs-chat-status.test.ts test/layouts/default/use-chat-route.test.ts test/layouts/default/use-chat-session.test.ts test/layouts/default/use-tab-close-guard.test.ts test/stores/chat/confirmation-queue.test.ts test/stores/chat/session.test.ts test/stores/chat/tab-runtime.test.ts test/views/chat/index.test.ts
```

Expected: 全部通过，测试数在原 336 项基础上增加。

- [x] **Step 4: 执行静态与构建验证**

Run:

```bash
pnpm exec eslint src/layouts/default/hooks/useChatRoute.ts src/stores/chat/confirmationQueue.ts src/hooks/useChat/useRuntimeRecovery.ts test/layouts/default/use-chat-route.test.ts test/stores/chat/confirmation-queue.test.ts test/hooks/use-runtime-recovery.test.ts --ext .ts
pnpm exec stylelint 'src/**/*.{vue,less,css}'
pnpm exec tsc --noEmit
pnpm electron:build-main
git diff --check
```

Expected: 所有命令退出码为 0，ESLint 无 warning。

- [x] **Step 5: 与全量基线对比**

Run:

```bash
pnpm exec vitest run
pnpm exec eslint src electron test types --ext .vue,.ts,.tsx,.js,.jsx,.mts --quiet
```

Expected: 本轮不新增稳定测试失败；全仓 ESLint 仅保留此前确认的未修改文件问题。记录实际数量，不声明范围外失败已修复。

Observed: 全量 Vitest 为 429 文件/3605 项通过，保持既有 5 文件/10 项失败；全仓 ESLint 保持未修改文件中的 24 项 error。本轮 6 个代码与测试文件 ESLint 为 0 error/0 warning。

- [x] **Step 6: 核对工作区且不提交**

Run:

```bash
git status --short
```

Expected: 仅显示未提交工作区修改，没有 staged 文件或新 commit。
