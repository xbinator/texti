# Chat Session Terminate-Then-Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让所有聊天会话始终可发起经确认的删除，并在删除前可靠终止同会话的 Main Runtime 与 Child Checkpoint。

**Architecture:** `SessionHistory` 只负责统一确认和防重复交互，`useChatSessionStore` 通过 Main 权威 list/abort/cancel API 编排终止后删除。Main IPC 在同步删除事务前检查 continuation fence 和普通 Runtime 写锁；ChatSider 仅补齐界面运行态投影，不参与删除安全判断。

**Tech Stack:** Vue 3、Pinia、TypeScript strict、Electron IPC、Vitest、Vue Test Utils、lodash-es。

## Global Constraints

- 禁止使用 `any`；所有新增函数、接口和复杂逻辑必须有准确注释。
- 所有异步错误归一化使用 `src/utils/asyncTo.ts`；不新增异步 `try/catch`。
- 删除按钮始终可见且不添加 `disabled`。
- 无论会话是否运行，删除都先显示统一确认框。
- 删除确认文案按 `running`、`waiting`、其他状态三类区分，标题需去除首尾空白并提供“未命名聊天”回退。
- 会话历史仅为 `running` 和 `waiting` 显示常驻状态图标；运行图标持续旋转，其他状态不显示。
- 删除顺序固定为 Main Runtime abort、Child Checkpoint cancel、权威复查、持久化 delete。
- 不把 Renderer Runtime Store 当作删除安全性的事实源。
- 保留工作区现有未提交修改，只编辑本计划列出的相关区域。
- 不执行 `git add`、`git commit` 或 push；用户自行提交。

---

### Task 1: Main 进程最终删除保护

**Files:**
- Modify: `electron/main/modules/chat/runtime/infrastructure/locks.mts`（错误类型与删除断言）
- Modify: `electron/main/modules/chat/ipc.mts`（`chat:session:delete` handler）
- Test: `test/electron/main/modules/chat/runtime/ipc.test.ts`

**Interfaces:**
- Consumes: `RuntimeLockRegistry.getWritingOwner(sessionId)`、`assertSessionHistoryWritable(sessionId)`。
- Produces: `assertSessionDeletable(sessionId: string, locks?: RuntimeLockRegistry): void`；活动普通 Runtime 返回稳定错误码 `SESSION_BUSY`。

- [ ] **Step 1: 写普通 Runtime 写锁阻止删除的失败测试**

在 `test/electron/main/modules/chat/runtime/ipc.test.ts` 注册 chat handlers，获取 `session-running` 写锁后调用删除 handler：

```ts
it('rejects session deletion while a main Runtime owns the writing lock', async (): Promise<void> => {
  registerChatHandlers();
  const lock = chatRuntimeLocks.acquireWritingLock({ sessionId: 'session-running', runtimeId: 'runtime-1' });
  expect(lock).toEqual({ ok: true });

  try {
    const handler = mocks.handlers.get('chat:session:delete');
    if (!handler) throw new Error('chat:session:delete handler was not registered');
    expect(await handler({}, 'session-running')).toMatchObject({ ok: false, code: 'SESSION_BUSY' });
    expect(mocks.deleteSession).not.toHaveBeenCalled();
  } finally {
    chatRuntimeLocks.releaseWritingLock({ sessionId: 'session-running', runtimeId: 'runtime-1' });
  }
});
```

- [ ] **Step 2: 运行测试并确认当前错误地删除成功**

Run: `pnpm exec vitest run test/electron/main/modules/chat/runtime/ipc.test.ts`

Expected: 新测试 FAIL，返回 `{ ok: true }` 或调用了 `deleteSession`。

- [ ] **Step 3: 添加最小删除断言并接入 IPC**

在锁模块添加稳定错误和断言：

```ts
/** Session 仍由普通 Runtime 写入时的稳定错误。 */
export class ChatSessionBusyError extends Error {
  /** Renderer 和主进程共同判断的稳定错误码。 */
  readonly code = 'SESSION_BUSY';

  /**
   * 创建 Session busy 错误。
   * @param sessionId - Session ID
   * @param runtimeId - 写锁 owner
   */
  constructor(sessionId: string, readonly runtimeId: string) {
    super(`Session ${sessionId} is still running ${runtimeId}`);
    this.name = 'ChatSessionBusyError';
  }
}

/**
 * 断言 Session 当前可以安全删除。
 * @param sessionId - Session ID
 * @param locks - 共享锁注册表
 */
export function assertSessionDeletable(sessionId: string, locks: RuntimeLockRegistry = chatRuntimeLocks): void {
  assertSessionHistoryWritable(sessionId, undefined, locks);
  const runtimeId = locks.getWritingOwner(sessionId);
  if (runtimeId) throw new ChatSessionBusyError(sessionId, runtimeId);
}
```

在 `electron/main/modules/chat/ipc.mts` 将删除 handler 的 `assertSessionHistoryWritable` 替换为 `assertSessionDeletable`，其他历史写入入口保持原断言。

- [ ] **Step 4: 运行 Main IPC 测试**

Run: `pnpm exec vitest run test/electron/main/modules/chat/runtime/ipc.test.ts`

Expected: PASS；continuation fence 仍返回 `TURN_WAITING_CHILDREN`，普通写锁返回 `SESSION_BUSY`。

### Task 2: Store 编排终止后删除

**Files:**
- Modify: `src/stores/chat/session.ts`（活动执行查询、终止、复查与删除）
- Test: `test/stores/chat/session.test.ts`

**Interfaces:**
- Consumes: `chatRuntimeListActive()`、`chatRuntimeAbort({ runtimeId })`、`chatAgentListActive()`、`chatAgentCancelCheckpoint({ checkpointId })`。
- Produces: `deleteSession(sessionId: string): Promise<void>` 保持原公开签名，但在持久化删除前完成终止和复查。

- [ ] **Step 1: 扩充 Electron API mock 并写调用顺序失败测试**

给 `mockElectronAPI` 添加严格类型 mock：

```ts
chatRuntimeAbort: vi.fn<(input: ChatRuntimeAbortInput) => Promise<ChatRuntimeHandlerResult<ChatRuntimeAbortResult>>>(),
chatAgentCancelCheckpoint: vi.fn<(input: ChatAgentCancelCheckpointInput) => Promise<ChatAgentHandlerResult<ChatAgentCheckpointSnapshot>>>()
```

新增用例覆盖：同会话 Runtime 先 abort 后 delete、Checkpoint 先 cancel 后 delete、非目标会话不终止、复查仍忙不 delete、abort/cancel/list 失败保留会话。顺序断言使用：

```ts
expect(mockElectronAPI.chatRuntimeAbort.mock.invocationCallOrder[0]).toBeLessThan(
  mockElectronAPI.chatSessionDelete.mock.invocationCallOrder[0]
);
```

- [ ] **Step 2: 运行 Store 测试并确认失败**

Run: `pnpm exec vitest run test/stores/chat/session.test.ts`

Expected: 新用例 FAIL；当前 `deleteSession` 不调用 abort/cancel/list-active。

- [ ] **Step 3: 添加权威活动执行读取与终止 helper**

在 `src/stores/chat/session.ts` 添加聚焦 helper：

```ts
/** 单个会话当前由 Main 投影的活动执行。 */
interface SessionExecutions {
  /** 活动主 Runtime。 */
  runtimes: ChatRuntimeRecoverySnapshot[];
  /** 活动 Child Checkpoint。 */
  checkpoints: ChatAgentCheckpointSnapshot[];
}

/**
 * 读取指定会话的 Main 权威活动执行。
 * @param sessionId - 目标会话 ID
 * @returns 同会话 Runtime 与 Checkpoint
 */
async function listSessionExecutions(sessionId: string): Promise<SessionExecutions> {
  const electronAPI = getElectronAPI();
  const [runtimeResponse, checkpointResponse] = await Promise.all([electronAPI.chatRuntimeListActive(), electronAPI.chatAgentListActive()]);
  return {
    runtimes: unwrap(runtimeResponse).filter((runtime: ChatRuntimeRecoverySnapshot): boolean => runtime.sessionId === sessionId),
    checkpoints: unwrap(checkpointResponse).filter((checkpoint: ChatAgentCheckpointSnapshot): boolean => checkpoint.sessionId === sessionId)
  };
}

/**
 * 终止指定会话的所有活动执行并验证已收敛。
 * @param sessionId - 目标会话 ID
 */
async function stopSessionExecutions(sessionId: string): Promise<void> {
  const electronAPI = getElectronAPI();
  const initial = await listSessionExecutions(sessionId);
  await Promise.all(initial.runtimes.map(async (runtime: ChatRuntimeRecoverySnapshot): Promise<void> => {
    unwrap(await electronAPI.chatRuntimeAbort({ runtimeId: runtime.runtimeId }));
  }));
  await Promise.all(initial.checkpoints.map(async (checkpoint: ChatAgentCheckpointSnapshot): Promise<void> => {
    unwrap(await electronAPI.chatAgentCancelCheckpoint({ checkpointId: checkpoint.checkpointId }));
  }));

  const remaining = await listSessionExecutions(sessionId);
  if (remaining.runtimes.length || remaining.checkpoints.length) {
    throw new Error('会话仍在运行，请稍后重试');
  }
}
```

给 `deleteSession` 在 `chatSessionDelete` 前增加 `await stopSessionExecutions(sessionId)`；成功后的内存、Recent、Todo 清理保持原顺序。

- [ ] **Step 4: 运行 Store 测试**

Run: `pnpm exec vitest run test/stores/chat/session.test.ts`

Expected: PASS；失败路径不移除 `store.sessions`，成功路径 delete 最后执行。

### Task 3: SessionHistory 统一确认且始终可删除

**Files:**
- Modify: `src/components/BChat/components/SessionHistory.vue`
- Test: `test/components/BChat/session-history.test.ts`

**Interfaces:**
- Consumes: `Modal.delete(content)`、`chatStore.deleteSession(sessionId)`。
- Produces: 成功时才发送 `delete-session(sessionId)`；同会话一次只存在一个确认/删除事务。

- [ ] **Step 1: 将旧忙碌隐藏测试改为统一确认测试**

Mock `Modal.delete`，默认返回 `[false, true]`。覆盖以下断言：

```ts
expect(wrapper.find('.session-history__actions').exists()).toBe(true);
expect(modalDeleteMock).toHaveBeenCalledWith(
  '确定删除聊天“会话 session-a”吗？如果仍在运行，将先终止所有任务和等待中的交互。删除后无法恢复。'
);
```

分别验证 `running`、`waiting`、晋升和 idle 都展示按钮；取消 `[true, false]` 不调用 Store；确认才删除；可控 Promise 下连续点击两次只弹一次；Store 失败只显示错误且不 emit。

- [ ] **Step 2: 运行组件测试并确认旧行为失败**

Run: `pnpm exec vitest run test/components/BChat/session-history.test.ts`

Expected: 新用例 FAIL；当前忙碌状态隐藏按钮且不显示确认。

- [ ] **Step 3: 移除 UI 忙碌门禁并实现确认事务**

模板无条件渲染 `.session-history__actions`。移除 `activeRuntimeIds` 以及相关 Runtime Store、`filter` 导入，并增加 `Modal` 与在途 Set：

```ts
/** 正在确认或删除的会话，避免快速重复点击创建并行事务。 */
const deletingSessionIds = new Set<string>();

/**
 * 删除指定会话，保持当前分页状态不变。
 * @param sessionId - 要删除的会话 ID
 */
async function handleDeleteSession(sessionId: string): Promise<void> {
  if (chatStore.sessionsLoading || deletingSessionIds.has(sessionId)) return;

  deletingSessionIds.add(sessionId);
  const session = chatStore.sessions.find((item: ChatSession): boolean => item.id === sessionId);
  const content = `确定删除聊天“${session?.title || '未命名聊天'}”吗？如果仍在运行，将先终止所有任务和等待中的交互。删除后无法恢复。`;
  const [confirmError, result] = await asyncTo(Modal.delete(content));
  if (!confirmError && result?.[1]) {
    const [deleteError] = await asyncTo(chatStore.deleteSession(sessionId));
    if (deleteError) message.error(deleteError.message || '删除会话失败，请重试');
    else emit('delete-session', sessionId);
  }
  deletingSessionIds.delete(sessionId);
}
```

不得给按钮、历史组件或侧边栏控制添加 `disabled`。

- [ ] **Step 4: 运行 SessionHistory 测试**

Run: `pnpm exec vitest run test/components/BChat/session-history.test.ts`

Expected: PASS；所有状态均确认，取消和失败均不发送成功事件。

### Task 4: ChatSider 运行状态投影与删除清理

**Files:**
- Modify: `src/layouts/default/components/ChatSider.vue`
- Modify: `src/layouts/default/hooks/useChatRoute.ts`
- Test: `test/layouts/default/chat-sider.test.ts`
- Test: `test/layouts/default/use-chat-route.test.ts`

**Interfaces:**
- Consumes: `BChatRuntimeStatusChange`、`createChatTabId(sessionId)`、`useChatTabStore.findOwner/ensureTab/setStatus/markCompleted/removeTab`。
- Produces: 侧边栏启动的会话拥有唯一 Runtime Store 记录；删除侧边栏独占会话时该记录也被清理。

- [ ] **Step 1: 写 ChatSider 状态投影失败测试**

给 BChat stub 增加 `runtime-status-change` emit。新增用例：

```ts
it('projects sidebar runtime status without disabling controls', async (): Promise<void> => {
  const settingStore = useSettingStore();
  settingStore.setSidebarVisible(true);
  settingStore.setChatSidebarActiveSessionId('session-running');
  chatStore.sessions = [createSession('session-running', '运行会话')];
  const wrapper = mountChatSider();

  wrapper.findComponent({ name: 'BChat' }).vm.$emit('runtime-status-change', { status: 'running' });
  await nextTick();

  expect(useChatTabStore().findOwner('session-running')).toMatchObject({ status: 'running' });
  expect(wrapper.find('[disabled]').exists()).toBe(false);
});
```

再覆盖首次发送时 `runtime-status-change: running` 先于 `session-created`，以及完成事件按 `sessionId` 更新正确 owner。

- [ ] **Step 2: 写侧边栏独占 Runtime 记录删除清理失败测试**

在 `use-chat-route.test.ts` 创建无顶部 tab 的 owner：

```ts
it('removes a sidebar-only runtime owner after deletion', async (): Promise<void> => {
  useChatTabStore().ensureTab('chat:session-a', 'session-a');
  await createRouteApi().handleDeletedSession('session-a');
  expect(useChatTabStore().findOwner('session-a')).toBeUndefined();
});
```

- [ ] **Step 3: 运行布局测试并确认失败**

Run: `pnpm exec vitest run test/layouts/default/chat-sider.test.ts test/layouts/default/use-chat-route.test.ts`

Expected: 新状态投影和 sidebar-only owner 清理测试 FAIL。

- [ ] **Step 4: 实现 ChatSider 状态投影**

监听 `@runtime-status-change="handleRuntimeStatus"`，保存最近 source status，并按真实会话解析 owner：

```ts
/** BChat 最近一次持续运行状态，用于首轮会话创建后补齐投影。 */
const sideRuntimeStatus = ref<BChatRuntimeSourceStatus>('idle');
/** 聊天标签运行时投影 Store。 */
const runtimeStore = useChatTabStore();

/**
 * 确保侧边栏会话拥有唯一运行态记录。
 * @param sessionId - 持久化会话 ID
 * @returns 运行态 owner
 */
function ensureRuntimeOwner(sessionId: string): ChatTabRuntimeRecord {
  return runtimeStore.findOwner(sessionId) ?? runtimeStore.ensureTab(createChatTabId(sessionId), sessionId);
}

/**
 * 同步侧边栏 BChat 的运行状态。
 * @param event - BChat 状态事件
 */
function handleRuntimeStatus(event: BChatRuntimeStatusChange): void {
  if (event.status === 'completed') {
    const owner = ensureRuntimeOwner(event.sessionId);
    const active = settingStore.sidebarVisible && settingStore.chatSidebarActiveSessionId === event.sessionId;
    runtimeStore.markCompleted(owner.tabId, active);
    return;
  }

  sideRuntimeStatus.value = event.status;
  const sessionId = settingStore.chatSidebarActiveSessionId;
  if (sessionId) runtimeStore.setStatus(ensureRuntimeOwner(sessionId).tabId, event.status);
}
```

`handleSessionCreated` 在写入 active session 后调用 `runtimeStore.setStatus(ensureRuntimeOwner(session.id).tabId, sideRuntimeStatus.value)`。

- [ ] **Step 5: 清理 sidebar-only owner**

在 `useChatRoute.handleDeletedSession` 开头保存 `runtimeOwner`；若不存在顶部 tab，成功同步删除后仍调用 `runtimeStore.removeTab(runtimeOwner.tabId)`。已有顶部 tab 的导航与 close plan 流程保持原子性：导航失败时仍保留顶部 tab owner。

- [ ] **Step 6: 运行布局测试**

Run: `pnpm exec vitest run test/layouts/default/chat-sider.test.ts test/layouts/default/use-chat-route.test.ts`

Expected: PASS；运行态能投影，所有侧栏控制继续不带 `disabled`，删除后无幽灵 owner。

### Task 5: SessionHistory 状态反馈与三态删除文案

**Files:**
- Modify: `src/components/BChat/components/SessionHistory.vue`
- Test: `test/components/BChat/session-history.test.ts`

**Interfaces:**
- Consumes: `useChatTabStore().findOwner(sessionId)` 返回的 `ChatTabRuntimeStatus`。
- Produces: `getSessionStatus(sessionId: string): ChatTabRuntimeStatus` 与 `getDeleteContent(sessionId: string): string`，供状态图标和删除确认共用同一份状态投影。

- [ ] **Step 1: 写状态图标与三态文案失败测试**

将 `BIcon` stub 改成可观测 icon 与 class 的组件，然后分别验证：

```ts
BIcon: {
  props: ['icon'],
  template: '<i class="b-icon-stub" :data-icon="icon" />'
}
```

```ts
expect(wrapper.find('.session-history__status-icon').attributes('data-icon')).toBe('lucide:loader-2');
expect(wrapper.find('.session-history__status-icon').classes()).toContain('is-spinning');
expect(modalDeleteMock).toHaveBeenCalledWith(
  '确定终止并删除聊天“会话 session-a”吗？当前聊天仍在运行，删除前会先终止所有任务。删除后无法恢复。'
);
```

`waiting` 断言 `lucide:circle-help` 且没有 `is-spinning`，确认文案为“当前聊天正在等待你的操作，删除时会取消等待中的交互”。`idle`、`completed`、`error` 断言不渲染 `.session-history__status-icon`，并使用普通删除文案。另用仅含空格的标题断言“未命名聊天”回退。

- [ ] **Step 2: 运行组件测试并确认失败原因正确**

Run: `pnpm exec vitest run test/components/BChat/session-history.test.ts`

Expected: 新用例 FAIL；当前没有会话状态图标，且确认框仍使用固定文案。

- [ ] **Step 3: 实现共享状态读取、图标和三态文案**

在组件中引入 `useChatTabStore` 和 `ChatTabRuntimeStatus`，增加：

```ts
/** 聊天会话运行态投影 Store。 */
const runtimeStore = useChatTabStore();

/**
 * 获取会话当前的界面运行状态。
 * @param sessionId - 会话 ID
 * @returns Runtime Store 中的状态，找不到记录时返回 idle
 */
function getSessionStatus(sessionId: string): ChatTabRuntimeStatus {
  return runtimeStore.findOwner(sessionId)?.status ?? 'idle';
}

/**
 * 根据会话状态生成删除确认文案。
 * @param sessionId - 会话 ID
 * @returns 对应状态的危险确认文案
 */
function getDeleteContent(sessionId: string): string {
  const session = chatStore.sessions.find((item: ChatSession): boolean => item.id === sessionId);
  const title = session?.title.trim() || '未命名聊天';
  const status = getSessionStatus(sessionId);
  if (status === 'running') {
    return `确定终止并删除聊天“${title}”吗？当前聊天仍在运行，删除前会先终止所有任务。删除后无法恢复。`;
  }
  if (status === 'waiting') {
    return `确定终止并删除聊天“${title}”吗？当前聊天正在等待你的操作，删除时会取消等待中的交互。删除后无法恢复。`;
  }
  return `确定删除聊天“${title}”吗？删除后无法恢复。`;
}
```

标题左侧按 `getSessionStatus(session.id)` 渲染 `lucide:loader-2` 或 `lucide:circle-help`。两者使用 `.session-history__status-icon`，仅 loading 同时使用 `.is-spinning`；状态位放在内容区内，不改变删除操作区。

- [ ] **Step 4: 运行组件测试并确认通过**

Run: `pnpm exec vitest run test/components/BChat/session-history.test.ts`

Expected: PASS；running loading 持续旋转、waiting 图标常驻、其他状态无图标，三态文案和标题回退均正确。

### Task 6: Changelog 与完整验证

**Files:**
- Modify: `changelog/2026-08-01.md`
- Verify: 所有上述生产和测试文件

**Interfaces:**
- Consumes: Tasks 1–5 的完整实现。
- Produces: 可由用户自行提交的、已验证工作区修改。

- [ ] **Step 1: 更新当日 changelog**

在 `## Changed` 或对应现有章节补充：

```markdown
- 聊天会话删除统一增加确认流程；运行中删除会先终止 Main Runtime 与 Child Checkpoint，并由主进程锁断言阻止未收敛删除。
- 补齐聊天侧边栏 Runtime 状态投影，删除按钮在所有运行状态下保持可用且不使用禁用属性。
- 会话历史增加运行中与等待操作状态图标，并按运行、等待和其他状态显示对应删除确认文案。
```

- [ ] **Step 2: 运行聚焦回归测试**

Run:

```bash
pnpm exec vitest run \
  test/components/BChat/session-history.test.ts \
  test/stores/chat/session.test.ts \
  test/electron/main/modules/chat/runtime/ipc.test.ts \
  test/layouts/default/chat-sider.test.ts \
  test/layouts/default/use-chat-route.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 3: 运行类型与静态检查**

Run:

```bash
pnpm exec eslint \
  src/components/BChat/components/SessionHistory.vue \
  src/stores/chat/session.ts \
  src/layouts/default/components/ChatSider.vue \
  src/layouts/default/hooks/useChatRoute.ts \
  test/components/BChat/session-history.test.ts \
  test/stores/chat/session.test.ts \
  test/electron/main/modules/chat/runtime/ipc.test.ts \
  test/layouts/default/chat-sider.test.ts \
  test/layouts/default/use-chat-route.test.ts
pnpm exec stylelint 'src/components/BChat/components/SessionHistory.vue' 'src/layouts/default/components/ChatSider.vue'
pnpm exec tsc --noEmit
pnpm electron:build-main
```

Expected: 所有命令退出码为 0。

- [ ] **Step 4: 检查改动范围且不提交**

Run: `git diff --check && git status --short`

Expected: 无 whitespace 错误；仅报告工作区修改，不执行暂存或提交。
