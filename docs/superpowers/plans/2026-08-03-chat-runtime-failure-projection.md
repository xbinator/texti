# Chat Runtime Failure Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让模型流失败后的 assistant 错误终态可靠投影并持久化到 Renderer，同时保证异常路径不会残留 Runtime、写锁或 pending 请求。

**Architecture:** 从 `completeRuntime` 提取只负责资源回收和写锁释放的内部清理函数。成功与失败路径在清理后分别广播唯一终态；失败路径先广播 assistant 终态，再广播错误事件。Renderer 负责在消息事件缺失时降级收敛，并在 Main 落盘失败时补写；Renderer 请求控制器与多窗口广播器隔离 IPC 通知故障。

**Tech Stack:** TypeScript、Electron Main、Vitest、Vue Renderer Runtime events

## Global Constraints

- 禁止使用 `any`。
- 新增函数必须具有明确参数、返回类型和 JSDoc。
- 异步错误处理沿用现有 Runtime best-effort 事件边界。
- 代码改动记录到 `changelog/2026-08-03.md`。

---

### Task 1: 锁定失败终态事件契约

**Files:**
- Modify: `test/electron/main/modules/chat/runtime/service.test.ts`

**Interfaces:**
- Consumes: `createChatRuntimeService()` 产生的 Runtime 事件。
- Produces: 失败路径事件顺序与唯一终态的回归约束。

- [x] **Step 1: Write the failing test**

在现有 stream executor failure 用例中收集指定 Runtime 的 `chat:runtime:message-updated`、`chat:runtime:error` 和 `chat:runtime:complete`，断言事件名严格为：

```typescript
['chat:runtime:message-updated', 'chat:runtime:error']
```

并断言 `message-updated` 携带 error Part、`loading: false`、`finished: true`。

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/runtime/service.test.ts -t "marks assistant message as failed and emits runtime error when stream executor fails"
```

Expected: FAIL，当前事件缺少最终 `message-updated`，并包含错误的 `runtime:complete`。

### Task 2: 分离清理与终态广播

**Files:**
- Modify: `electron/main/modules/chat/runtime/service.mts`
- Test: `test/electron/main/modules/chat/runtime/service.test.ts`

**Interfaces:**
- Consumes: `ActiveChatRuntime`、安全 assistant 消息映射与 Runtime 控制器。
- Produces: `cleanupRuntime(runtime: ActiveChatRuntime): ChatMessageRecord | undefined`，仅回收资源并返回安全消息快照。

- [x] **Step 1: Write minimal implementation**

提取 `cleanupRuntime`，让 `completeRuntime` 复用它。修改 `completeFailedRuntime`：先调用 `cleanupRuntime`，再分别以 best-effort 方式广播最终 `message-updated` 和 `runtime:error`，不广播 `runtime:complete`。

- [x] **Step 2: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/runtime/service.test.ts -t "marks assistant message as failed and emits runtime error when stream executor fails"
```

Expected: PASS。

### Task 3: 记录并验证修复

**Files:**
- Modify: `changelog/2026-08-03.md`

**Interfaces:**
- Consumes: 修复后的 Main Runtime 事件契约。
- Produces: 回归记录与验证证据。

- [x] **Step 1: Update changelog**

在 `Changed` 和 `Test` 中记录 Runtime 失败消息实时投影与事件顺序覆盖。

- [x] **Step 2: Run focused tests**

```bash
pnpm exec vitest run test/electron/main/modules/chat/runtime/service.test.ts test/components/BChat/session-id-runtime.test.ts
```

- [x] **Step 3: Run static checks**

```bash
pnpm exec eslint electron/main/modules/chat/runtime/service.mts test/electron/main/modules/chat/runtime/service.test.ts
pnpm exec tsc --noEmit
```

Expected: 所有命令退出码为 0。

### Task 4: 故障注入审计

**Files:**
- Modify: `types/chat-runtime.d.ts`
- Modify: `electron/main/modules/chat/runtime/controllers/renderer-tool.mts`
- Modify: `electron/main/modules/chat/runtime/controllers/confirmation.mts`
- Modify: `electron/main/modules/chat/runtime/controllers/bridge.mts`
- Modify: `src/components/BChat/hooks/useChatWorkflow.ts`
- Modify: `src/components/BChat/utils/messageHelper.ts`
- Modify: `src/components/BChat/utils/runtimeError.ts`
- Test: `test/electron/main/modules/chat/runtime/recovery-requests.test.ts`
- Test: `test/components/BChat/session-id-runtime.test.ts`
- Test: `test/components/BChat/runtime-error.test.ts`

- [x] **Step 1: 注入失败 assistant 终态持久化异常，验证 Runtime 与写锁仍释放**
- [x] **Step 2: 注入终态消息事件缺失，验证 Renderer 收敛消息和工具 Part**
- [x] **Step 3: 通过错误事件落盘失败标记，验证 Renderer 补写且不重复错误 Part**
- [x] **Step 4: 注入工具、确认和 Bridge 初始通知异常，验证 pending 资源回滚**
- [x] **Step 5: 注入工具取消通知异常，验证 Promise 与清理不被阻塞**
- [x] **Step 6: 注入失效 Electron 窗口，验证健康窗口继续收到广播**
