# Uncommitted Chat Runtime Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对当前工作区相对 `HEAD` 的全部未提交改动执行可复核的风险审查，逐项修复所有有证据的 P0–P2 问题并完成全量验证。

**Architecture:** 审查分为基线、系统不变量、逐文件穷举、场景反证和最终复审五层。审查任务本身只读；一旦发现问题，先把根因、失败测试、最小生产修复和验证命令作为新的具体修复 Task 追加到本计划，再按 TDD 执行，避免审查与猜测性修改混杂。

**Tech Stack:** Vue 3、Pinia、TypeScript strict、Electron IPC、Main ChatRuntime、Vitest、Vue Test Utils、ESLint、Stylelint。

## Global Constraints

- 范围是当前工作区相对 `HEAD` 的全部已跟踪和未跟踪改动。
- 只修复有证据、可复现的安全性、数据一致性、竞态、资源泄漏和功能回归问题；纯风格 P3 只记录。
- 所有生产修复必须先有失败测试并观察到预期失败，再实施最小修复。
- 禁止使用 `any`；新增函数、接口和复杂逻辑必须有准确注释。
- 异步错误处理使用 `src/utils/asyncTo.ts`，不新增异步 `try/catch`。
- 保留所有用户未提交改动，不回退、不覆盖无关内容。
- 不执行 `git add`、`git commit`、push 或创建 PR。
- 同一问题三次修复尝试仍未收敛时停止并重新评估架构。

---

### Task 1: 建立全量验证基线

**Files:**
- Verify: `src/**/*.ts`
- Verify: `src/**/*.vue`
- Verify: `electron/**/*.mts`
- Verify: `test/**/*.test.ts`
- Verify: `types/**/*.d.ts`

**Interfaces:**
- Consumes: 当前工作区全部未提交改动。
- Produces: 修改前测试、Lint、类型和构建基线；任何失败的完整错误证据。

- [x] **Step 1: 固化改动清单与空白检查**

Run:

```bash
git status --short
git diff --stat
git diff --check
git ls-files --others --exclude-standard
```

Expected: 清单与规格中的范围一致；`git diff --check` 退出码为 0。

- [x] **Step 2: 运行全部 Vitest 测试**

Run: `pnpm exec vitest run`

Expected: 全部测试通过。若失败，完整记录测试名、错误栈和首次失败位置，并在进入生产修改前完成根因追踪。

- [x] **Step 3: 运行静态、类型与 Main 构建检查**

Run:

```bash
pnpm exec eslint src electron test types --ext .vue,.ts,.tsx,.js,.jsx,.mts
pnpm exec stylelint 'src/**/*.{vue,less,css}'
pnpm exec tsc --noEmit
pnpm electron:build-main
```

Expected: 四个命令均以退出码 0 完成且没有 ESLint/Stylelint warning。

### Task 2: 审查会话身份、Runtime 生命周期与确认隔离

**Files:**
- Review: `src/components/BChat/hooks/useChatRuntimeLauncher.ts`
- Review: `src/components/BChat/hooks/useChatSessionRuntime.ts`
- Review: `src/components/BChat/hooks/useChatSubmitter.ts`
- Review: `src/components/BChat/hooks/useChatWorkflow.ts`
- Review: `src/components/BChat/hooks/useRuntimeBridgeHandler.ts`
- Review: `src/components/BChat/hooks/useRuntimeRequestConfig.ts`
- Review: `src/components/BChat/hooks/useRuntimeTools.ts`
- Review: `src/components/BChat/index.vue`
- Review: `src/components/BChat/utils/confirmationController.ts`
- Review: `src/stores/chat/confirmationQueue.ts`
- Review: `src/stores/chat/tab.ts`
- Review: `src/ai/chat/runtimeCapabilities.ts`
- Review: `src/ai/tools/builtin/ShellTool/index.ts`
- Review: `src/ai/tools/context/webview.ts`
- Review: `src/ai/tools/stream.ts`
- Test: `test/components/BChat/confirmation-controller.test.ts`
- Test: `test/components/BChat/confirmation-sheet.component.test.ts`
- Test: `test/components/BChat/session-id-runtime.test.ts`
- Test: `test/components/BChat/use-runtime-tools.test.ts`
- Test: `test/stores/chat/confirmation-queue.test.ts`
- Test: `test/stores/chat/tab-runtime.test.ts`

**Interfaces:**
- Consumes: Runtime ID、Session ID、tab owner、confirmation broker、renderer tool request context。
- Produces: 对会话身份唯一性、Runtime 状态转移、确认精确路由和资源清理的不变量结论。

- [x] **Step 1: 阅读完整差异和调用方**

Run:

```bash
git diff -- src/components/BChat/hooks/useChatRuntimeLauncher.ts src/components/BChat/hooks/useChatSessionRuntime.ts src/components/BChat/hooks/useChatSubmitter.ts src/components/BChat/hooks/useChatWorkflow.ts src/components/BChat/hooks/useRuntimeBridgeHandler.ts src/components/BChat/hooks/useRuntimeRequestConfig.ts src/components/BChat/hooks/useRuntimeTools.ts src/components/BChat/index.vue src/components/BChat/utils/confirmationController.ts src/stores/chat/confirmationQueue.ts src/stores/chat/tab.ts src/ai/chat/runtimeCapabilities.ts src/ai/tools/builtin/ShellTool/index.ts src/ai/tools/context/webview.ts src/ai/tools/stream.ts
rg -n "runtimeId|sessionId|ensureTab|bindSession|promoteTab|detach|confirmation|dispose|unsubscribe|onUnmounted" src/components/BChat src/stores/chat src/ai
```

Expected: 每个新增或修改符号都能追踪到创建、迁移、消费和清理位置。

- [x] **Step 2: 对照测试矩阵检查不变量**

逐项确认现有测试是否实际验证：多个 Session 并行、草稿晋升、关闭后后台运行、等待确认时卸载、重新挂载、过期 Runtime 事件和错误 Session ID。仅验证 mock 被调用而未验证最终状态的用例不算覆盖。

Run:

```bash
pnpm exec vitest run test/components/BChat/confirmation-controller.test.ts test/components/BChat/confirmation-sheet.component.test.ts test/components/BChat/session-id-runtime.test.ts test/components/BChat/use-runtime-tools.test.ts test/stores/chat/confirmation-queue.test.ts test/stores/chat/tab-runtime.test.ts
```

Expected: 测试通过；缺失的风险场景被记录为具体发现，而不是直接修改生产代码。

- [x] **Step 3: 为每个发现追加并执行具体修复 Task**

每个 Task 必须写明：严重级别、确定的根因、精确测试文件与测试代码、RED 命令和预期失败、精确生产文件与最小补丁、GREEN 命令和相关回归集合。未完成这些字段不得修改生产代码。

### Task 3: 审查历史单调性、恢复与回滚

**Files:**
- Review: `src/components/BChat/hooks/useChatHistory.ts`
- Review: `src/components/BChat/hooks/useRollback.ts`
- Review: `src/hooks/useChat/useRuntimeEvents.ts`
- Review: `src/hooks/useChat/useRuntimeRecovery.ts`
- Review: `src/components/BChat/utils/runtimeError.ts`
- Test: `test/components/BChat/use-chat-history.test.ts`
- Test: `test/components/BChat/use-rollback.test.ts`
- Test: `test/hooks/use-runtime-events.test.ts`
- Test: `test/hooks/use-runtime-recovery.test.ts`

**Interfaces:**
- Consumes: 持久化历史响应、活动 Runtime/Checkpoint 快照、流式消息事件和 abort 错误。
- Produces: A→B→A、活动草稿恢复、伪中断清理和回滚后的单调消息状态结论。

- [x] **Step 1: 追踪历史响应与流事件的写入顺序**

Run:

```bash
git diff -- src/components/BChat/hooks/useChatHistory.ts src/components/BChat/hooks/useRollback.ts src/hooks/useChat/useRuntimeEvents.ts src/hooks/useChat/useRuntimeRecovery.ts src/components/BChat/utils/runtimeError.ts
rg -n "loadHistory|requestId|sessionId|messages\.value|replace|merge|recovery|interrupted|abort" src/components/BChat src/hooks/useChat
```

Expected: 每个写入 `messages` 的异步入口都具有会话身份或请求世代保护，且恢复逻辑不会覆盖更新流状态。

- [x] **Step 2: 执行历史与恢复场景测试**

Run:

```bash
pnpm exec vitest run test/components/BChat/use-chat-history.test.ts test/components/BChat/use-rollback.test.ts test/hooks/use-runtime-events.test.ts test/hooks/use-runtime-recovery.test.ts
```

Expected: A→B→A、活动 Runtime、Checkpoint、查询失败保守策略和真实用户中止用例全部通过。

- [x] **Step 3: 为每个发现追加并执行具体修复 Task**

使用 Task 2 Step 3 的完整字段要求；每个回归测试必须断言最终消息 part 数量、状态和 Session 归属，不能只断言 IPC mock 调用。

### Task 4: 审查安全删除、Main 锁与界面投影

**Files:**
- Review: `electron/main/modules/chat/ipc.mts`
- Review: `electron/main/modules/chat/runtime/infrastructure/locks.mts`
- Review: `electron/preload/index.mts`
- Review: `types/chat-runtime.d.ts`
- Review: `types/electron-api.d.ts`
- Review: `src/stores/chat/session.ts`
- Review: `src/components/BChat/components/SessionHistory.vue`
- Review: `src/layouts/default/components/ChatSider.vue`
- Review: `src/layouts/default/hooks/useChatRoute.ts`
- Review: `src/layouts/default/hooks/useChatSession.ts`
- Review: `src/layouts/default/hooks/useTabCloseGuard.ts`
- Review: `src/views/chat/index.vue`
- Test: `test/electron/main/modules/chat/runtime/ipc.test.ts`
- Test: `test/stores/chat/session.test.ts`
- Test: `test/components/BChat/session-history.test.ts`
- Test: `test/layouts/default/chat-sider.test.ts`
- Test: `test/layouts/default/header-tabs-chat-status.test.ts`
- Test: `test/layouts/default/use-chat-route.test.ts`
- Test: `test/layouts/default/use-chat-session.test.ts`
- Test: `test/layouts/default/use-tab-close-guard.test.ts`
- Test: `test/views/chat/index.test.ts`

**Interfaces:**
- Consumes: Main active Runtime/Checkpoint 列表、abort/cancel IPC、Session 写锁、Renderer owner 与删除路由。
- Produces: 删除事务不可绕过、失败时不清理 Renderer、状态文案与图标不参与安全决策的结论。

- [x] **Step 1: 追踪删除事务的完整跨进程顺序**

Run:

```bash
git diff -- electron/main/modules/chat/ipc.mts electron/main/modules/chat/runtime/infrastructure/locks.mts electron/preload/index.mts types/chat-runtime.d.ts types/electron-api.d.ts src/stores/chat/session.ts src/components/BChat/components/SessionHistory.vue src/layouts/default/components/ChatSider.vue src/layouts/default/hooks/useChatRoute.ts src/layouts/default/hooks/useChatSession.ts src/layouts/default/hooks/useTabCloseGuard.ts src/views/chat/index.vue
rg -n "deleteSession|chatSessionDelete|assertSessionDeletable|SESSION_BUSY|abort|cancelCheckpoint|findOwner|removeTab|runtime-status-change" electron src types
```

Expected: 删除只能在 Main 确认无 continuation fence 和写锁后发生；所有 Renderer 预清理都晚于持久化成功。

- [x] **Step 2: 执行删除、关闭与状态投影测试**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/runtime/ipc.test.ts test/stores/chat/session.test.ts test/components/BChat/session-history.test.ts test/layouts/default/chat-sider.test.ts test/layouts/default/header-tabs-chat-status.test.ts test/layouts/default/use-chat-route.test.ts test/layouts/default/use-chat-session.test.ts test/layouts/default/use-tab-close-guard.test.ts test/views/chat/index.test.ts
```

Expected: 运行、等待、空闲、复查仍忙、abort/cancel/delete 失败和关闭后重开场景全部通过。

- [x] **Step 3: 为每个发现追加并执行具体修复 Task**

使用 Task 2 Step 3 的完整字段要求；跨进程问题必须同时验证 Renderer 调用顺序与 Main 最终拒绝行为。

### Task 5: 逐文件穷举与契约扫尾

**Files:**
- Review: 所有 `git status --short` 返回的文件。
- Review: `changelog/2026-07-31.md`
- Review: `changelog/2026-08-01.md`
- Review: `docs/superpowers/specs/2026-07-31-chat-background-runtime-sidebar-actions-design.md`
- Review: `docs/superpowers/plans/2026-07-31-chat-background-runtime-sidebar-actions.md`
- Review: `docs/superpowers/plans/2026-08-01-active-runtime-draft-recovery.md`
- Review: `docs/superpowers/plans/2026-08-01-chat-session-terminate-delete.md`

**Interfaces:**
- Consumes: Tasks 2–4 的不变量结论和全部未提交差异。
- Produces: 每个改动文件均已阅读、每个新增契约均与调用方匹配、没有遗漏的 P0–P2 发现。

- [x] **Step 1: 生成并逐一核销完整文件清单**

Run:

```bash
git status --short
git diff --name-only
git ls-files --others --exclude-standard
```

Expected: 每个路径都归入 Task 2、3、4 或本任务的文档/测试复核；没有未审查路径。

- [x] **Step 2: 检查高风险语法与契约不一致**

Run:

```bash
rg -n "\bany\b|@ts-ignore|@ts-expect-error|void [a-zA-Z_].*\(|\.then\(|setTimeout\(|addEventListener|on[A-Z].*\(" electron src types
rg -n "chatMessageDelete|chatRuntimeListActive|chatAgentListActive|chatRuntimeAbort|chatAgentCancelCheckpoint" electron src types test
```

Expected: 每个命中都有明确类型、错误处理、取消或卸载路径；跨进程方法在 type、preload、IPC 与调用方四处一致。

- [x] **Step 3: 对照规格、计划、changelog 与实现**

逐条核对状态语义、删除顺序、恢复行为、非目标和验证声明。文档不得声明未被实现或未被测试证明的行为。

- [x] **Step 4: 为每个发现追加并执行具体修复 Task**

生产缺陷继续使用 Task 2 Step 3 的 TDD 字段要求；仅文档描述错误可直接修正文档，但必须运行 `git diff --check`。

### Task 6: 场景反证、第二轮复审与最终验证

**Files:**
- Verify: Tasks 1–5 覆盖的全部生产、测试、类型和文档文件。
- Modify: `changelog/2026-08-01.md`（仅记录本轮实际修复）。

**Interfaces:**
- Consumes: 所有审查结论和问题修复。
- Produces: 没有剩余证据型 P0–P2 发现的复审记录与完整验证证据。

- [x] **Step 1: 从头复审系统不变量和完整差异**

重新执行 Tasks 2–5 的所有只读 diff、`rg` 和文件清单检查。重点反证修复是否引入新的 Session 身份、状态转移、错误处理或资源清理问题。

- [x] **Step 2: 运行聚焦场景矩阵**

Run:

```bash
pnpm exec vitest run test/components/BChat/confirmation-controller.test.ts test/components/BChat/confirmation-sheet.component.test.ts test/components/BChat/session-history.test.ts test/components/BChat/session-id-runtime.test.ts test/components/BChat/use-chat-history.test.ts test/components/BChat/use-rollback.test.ts test/components/BChat/use-runtime-tools.test.ts test/electron/main/modules/chat/runtime/ipc.test.ts test/hooks/use-runtime-events.test.ts test/hooks/use-runtime-recovery.test.ts test/layouts/default/chat-sider.test.ts test/layouts/default/header-tabs-chat-status.test.ts test/layouts/default/use-chat-route.test.ts test/layouts/default/use-chat-session.test.ts test/layouts/default/use-tab-close-guard.test.ts test/stores/chat/confirmation-queue.test.ts test/stores/chat/session.test.ts test/stores/chat/tab-runtime.test.ts test/views/chat/index.test.ts
```

Expected: 所有聚焦测试通过，输出无失败。

- [x] **Step 3: 运行最终全量验证**

Run:

```bash
pnpm exec vitest run
pnpm exec eslint src electron test types --ext .vue,.ts,.tsx,.js,.jsx,.mts
pnpm exec stylelint 'src/**/*.{vue,less,css}'
pnpm exec tsc --noEmit
pnpm electron:build-main
git diff --check
git status --short
```

Observed: 聚焦测试、当前变更文件 ESLint、Stylelint、TypeScript、Main 构建与差异检查以退出码 0 完成。全量 Vitest 保持审查前相同的 5 文件/10 项失败；全仓 ESLint 剩余 24 项 error 均位于未修改文件，未纳入本轮扩改。

- [x] **Step 4: 更新 changelog 与交付审查报告**

仅将本轮实际修复加入 `changelog/2026-08-01.md` 对应章节。交付报告按 P0、P1、P2、P3/观察项列出根因、修复文件、回归测试和验证结果，并明确未执行 Git 提交。

### Task 7: 修复 A→B→A 后旧预检操作恢复执行

**Severity:** P2

**Root Cause:** `useChatWorkflow` 只用操作序号和当前 Session ID 判断异步预检结果是否仍有效。Session 从 A 切到 B 再切回 A 时，操作序号未变化且 Session ID 再次相等，属于旧页面世代的预检结果会被误判为当前结果并启动 Runtime。

**Files:**
- Modify: `src/components/BChat/hooks/useChatWorkflow.ts`
- Test: `test/components/BChat/session-id-runtime.test.ts`

**Interfaces:**
- Consumes: `activeSessionId` 的每次身份变更和草稿首次创建后的内部 Session 晋升。
- Produces: 绑定到启动时 Session 世代的 renderer 操作；离开过原 Session 后即使返回也不能恢复旧操作，同时保留 `null` 草稿晋升到新 Session 的首次发送流程。

- [x] **Step 1: 添加 A→B→A 失败测试**

在现有“切换到不同 Session 后不启动旧请求”用例旁新增测试：阻塞资源同步，提交 Session A 消息，依次切到 B 和 A，再释放同步；断言 `chatRuntimeSend` 未调用且旧消息未重新注入当前消息列表。

Run: `pnpm exec vitest run test/components/BChat/session-id-runtime.test.ts -t "does not resume a stale prepared request after an A-B-A switch"`

Expected: RED；修复前 `chatRuntimeSend` 被调用一次。

- [x] **Step 2: 用 Session 世代使旧操作失效**

在 `useChatWorkflow` 中同步监听 `activeSessionId` 并递增 Session 世代；`beginOperation` 捕获世代，`isCurrentOperation` 同时校验世代。`adoptOperationSession` 仅在仍为同一操作且属于草稿首次创建时更新捕获世代，避免破坏 `null`→持久化 Session 的合法晋升。

- [x] **Step 3: 验证修复与相关回归**

Run:

```bash
pnpm exec vitest run test/components/BChat/session-id-runtime.test.ts -t "does not resume a stale prepared request after an A-B-A switch"
pnpm exec vitest run test/components/BChat/session-id-runtime.test.ts
pnpm exec eslint src/components/BChat/hooks/useChatWorkflow.ts test/components/BChat/session-id-runtime.test.ts --ext .ts
pnpm exec tsc --noEmit
```

Expected: 新用例和完整 Session Runtime 用例通过，ESLint 与 TypeScript 检查退出码均为 0。

### Task 8: 修复后台 Runtime 漂移到当前 WebView

**Severity:** P1

**Root Cause:** `useRuntimeTools` 已接收冻结的 `RuntimeToolBinding.webviewId`，但传给内置网页工具的 `getWebviewContext` 仍无条件读取 `webviewToolContextRegistry.getCurrentContext()`。Runtime 启动后切换 WebView 时，旧 Runtime 的读取或操作请求会落到新激活页面，破坏资源隔离并可能误操作用户正在浏览的网页。

**Files:**
- Modify: `src/components/BChat/hooks/useRuntimeTools.ts`
- Test: `test/components/BChat/use-runtime-tools.test.ts`

**Interfaces:**
- Consumes: Runtime 启动时冻结的 `webviewId` 和 WebView context registry。
- Produces: 绑定执行器只能读取对应 `webviewId` 的上下文；请求准备阶段未绑定时仍使用当前 WebView 做能力发现。

- [x] **Step 1: 添加 WebView 切换隔离失败测试**

扩展内置工具工厂夹具以暴露 `getWebviewContext`，让当前 WebView 为 B、绑定 ID 为 A，并断言绑定回调返回 A 的上下文。

Run: `pnpm exec vitest run test/components/BChat/use-runtime-tools.test.ts -t "binds WebView callbacks to the immutable Runtime resource"`

Expected: RED；修复前绑定回调返回当前 WebView B。

- [x] **Step 2: 按 binding.webviewId 解析上下文**

创建绑定工具时，存在 binding 则仅通过 `getContext(binding.webviewId)` 读取冻结资源；binding 没有 `webviewId` 时返回 `undefined`，不得回退当前页面。仅无 binding 的请求准备阶段继续使用 `getCurrentContext()`。

- [x] **Step 3: 验证修复与工具回归**

Run:

```bash
pnpm exec vitest run test/components/BChat/use-runtime-tools.test.ts -t "binds WebView callbacks to the immutable Runtime resource"
pnpm exec vitest run test/components/BChat/use-runtime-tools.test.ts test/components/BChat/session-id-runtime.test.ts
pnpm exec eslint src/components/BChat/hooks/useRuntimeTools.ts test/components/BChat/use-runtime-tools.test.ts --ext .ts
pnpm exec tsc --noEmit
```

Expected: 隔离用例和完整工具、Session Runtime 回归通过，ESLint 与 TypeScript 检查无错误和 warning。

### Task 9: 清理成功删除会话的 Renderer Runtime 事实

**Severity:** P2

**Root Cause:** 历史列表删除通过 Session Store 直接调用 Main `chatRuntimeAbort`，不会经过可见 `BChat.abort()` 的 Renderer 收尾。Main 已终止并删除持久化会话后，Supervisor Session、Runtime route、冻结 capability、Session UI 事件缓存和 Runtime confirmation flight 仍可能留在内存中。

**Files:**
- Modify: `src/ai/chat/actorSystem.ts`
- Modify: `src/components/BChat/utils/confirmationController.ts`
- Modify: `src/layouts/default/components/ChatSider.vue`
- Test: `test/ai/chat/actor-system.test.ts`
- Test: `test/components/BChat/confirmation-controller.test.ts`
- Test: `test/layouts/default/chat-sider.test.ts`

- [x] **Step 1: 添加删除后应用级事实仍残留的失败测试**

分别断言 Session 删除能力会清理 actor、Runtime route、capability、UI subscription 和同会话 Runtime confirmation，并断言 ChatSider 成功删除事件会调用这两类清理。

Run: `pnpm exec vitest run test/ai/chat/actor-system.test.ts test/components/BChat/confirmation-controller.test.ts test/layouts/default/chat-sider.test.ts`

Expected: RED；`removeSession`、`expireSessionConfirmations` 不存在，ChatSider 不执行应用级收尾。

- [x] **Step 2: 增加显式 Session 删除和 confirmation 过期能力**

`ChatActorSystem.removeSession` 在 Supervisor 删除 Session 前冻结所属 Runtime IDs，随后清理 capability 与 Session event bus；confirmation broker 按不可变 `sessionId` 拒绝并删除全部 Runtime flights。ChatSider 仅在 Session Store 已成功删除并 emit 后执行这两项清理，再同步路由与标签。

- [x] **Step 3: 验证删除收尾回归**

Run:

```bash
pnpm exec vitest run test/ai/chat/actor-system.test.ts test/components/BChat/confirmation-controller.test.ts test/layouts/default/chat-sider.test.ts
pnpm exec eslint src/ai/chat/actorSystem.ts src/components/BChat/utils/confirmationController.ts src/layouts/default/components/ChatSider.vue test/ai/chat/actor-system.test.ts test/components/BChat/confirmation-controller.test.ts test/layouts/default/chat-sider.test.ts
```

Expected: 44 项测试全部通过，ESLint 无错误和 warning。

### Task 10: 防止确认决议 IPC 失败后 Runtime 永久等待

**Severity:** P1

**Root Cause:** Main confirmation 没有超时。手动决议会先完成并移除 Renderer flight，再提交 IPC；提交失败时 UI 已消失且没有新的 waiter。记忆授权自动提交失败时错误又被全局事件订阅吞掉，Main 会永久等待无法重试的 confirmation。

**Files:**
- Modify: `src/components/BChat/hooks/useChatWorkflow.ts`
- Modify: `src/hooks/useChat/useRuntimeEvents.ts`
- Test: `test/components/BChat/session-id-runtime.test.ts`
- Test: `test/hooks/use-runtime-events.test.ts`

- [x] **Step 1: 添加手动决议与记忆授权提交失败测试**

手动决议首次返回 `{ ok: false }` 后断言同一 confirmation 重新出现并可第二次成功提交；记忆授权提交失败后断言 Session 进入可见 waiting 状态。

Expected: RED；手动 confirmation 消失，记忆授权路径没有任何可见确认。

- [x] **Step 2: 恢复同一 confirmation 身份并提供可见降级**

手动提交失败时重新向 Session event bus 发布原始权威事件，由当前或下次挂载的唯一订阅者重建 flight；记忆授权提交失败时继续执行普通可见确认分支。两条路径都保留 Main 原 confirmation ID。

- [x] **Step 3: 验证确认重试回归**

Run:

```bash
pnpm exec vitest run test/components/BChat/session-id-runtime.test.ts
pnpm exec vitest run test/hooks/use-runtime-events.test.ts
pnpm exec eslint src/components/BChat/hooks/useChatWorkflow.ts src/hooks/useChat/useRuntimeEvents.ts test/components/BChat/session-id-runtime.test.ts test/hooks/use-runtime-events.test.ts
```

Expected: Session Runtime 83 项和 Runtime Events 12 项全部通过，ESLint 无错误和 warning。

### Task 11: 保证破坏性启动与后台失败正确收敛

**Severity:** P2

**Root Cause:** 再生成流程先截断并持久化历史，再检查页面是否仍为当前 Session；切页发生在持久化期间时，流程会直接返回，留下已丢失后续消息但没有 Runtime 的会话。另一方面，发送、压缩和用户选择续跑在 Main 启动失败后只更新当前可见 Session Actor；若已切到其他会话，原 Session Actor 会永远停留在 busy 状态。

**Files:**
- Modify: `src/components/BChat/hooks/useChatWorkflow.ts`
- Test: `test/components/BChat/session-id-runtime.test.ts`

- [x] **Step 1: 添加破坏性持久化和后台启动失败测试**

分别阻塞再生成历史持久化与 Runtime 启动：持久化开始后切页，断言原 Session 仍启动 Runtime；Runtime 启动失败后切页再返回，断言原 Session 不再 loading。

Expected: RED；修复前前者不调用 Main，后者原 Session Actor 保持 busy。

- [x] **Step 2: 调整启动提交点并按冻结 Session 路由失败**

再生成先在 Renderer 注册冻结 Runtime 归属，再提交不可逆历史截断；一旦持久化开始，即使页面离开也继续在原 Session 后台启动。所有启动与续跑失败均按捕获的 Session ID 投递到原 Actor，只有消息列表和 Toast 等可见 UI 更新仍受当前 Session 限制。

- [x] **Step 3: 验证两类终态回归**

Run:

```bash
pnpm exec vitest run test/components/BChat/session-id-runtime.test.ts -t "continues regeneration in its original Session after destructive history persistence starts"
pnpm exec vitest run test/components/BChat/session-id-runtime.test.ts -t "settles the original Session when a started request fails after switching away"
pnpm exec vitest run test/components/BChat/session-id-runtime.test.ts
pnpm exec eslint src/components/BChat/hooks/useChatWorkflow.ts test/components/BChat/session-id-runtime.test.ts
```

Expected: 两个新增用例和 Session Runtime 全量 85 项通过，ESLint 无错误和 warning。

### Task 12: 收敛切页预检与准备态

**Severity:** P2

**Root Cause:** Session 切换只使异步操作结果失效，但没有立即退出旧 Session 的 `preparing` 状态或释放页面 `preflightLoading`；内部草稿晋升与外部切页又共用同一身份变化，不能简单地统一取消。

**Files:**
- Modify: `src/ai/chat/machine/sessionMachine.ts`
- Modify: `src/components/BChat/hooks/useChatWorkflow.ts`
- Modify: `src/components/BChat/index.vue`
- Test: `test/components/BChat/session-id-runtime.test.ts`

- [x] **Step 1: 添加切页准备态与 loading 失败测试**

阻塞预检后切换 Session，断言原 Actor 离开 `preparing` 且页面 loading 立即释放；同时保留草稿 `null`→新 Session 的合法内部晋升。

- [x] **Step 2: 增加准备取消事件并区分草稿晋升**

Session 机增加 `session.preparationCancelled`；workflow 在真实切页时投递取消并释放预检状态，通过 `isDraftPromotion` 避免误取消首次创建会话。

- [x] **Step 3: 验证切页和草稿回归**

新增用例与 Session Runtime 聚焦测试通过。

### Task 13: 固化确认身份、并发状态与失败重试

**Severity:** P1

**Root Cause:** confirmation flight 缺少不可变请求比对与终态 tombstone；Session UI 事件缓存按会话仅保留一个事件；本地确认没有进入 Session waiting 投影。并发或提交失败时会出现覆盖、重复提交、永久等待或状态图标错误。

**Files:**
- Modify: `src/ai/chat/sessionEvents.ts`
- Modify: `src/components/BChat/utils/confirmationController.ts`
- Modify: `src/components/BChat/index.vue`
- Modify: `src/hooks/useChat/useRuntimeEvents.ts`
- Test: `test/ai/chat/session-events.test.ts`
- Test: `test/components/BChat/confirmation-controller.test.ts`
- Test: `test/components/BChat/session-id-runtime.test.ts`
- Test: `test/hooks/use-runtime-events.test.ts`

- [x] **Step 1: 添加身份、终态、并发与本地 waiting 失败测试**

覆盖同 ID 不同请求、终态过期后迟到重放、同 Session 多确认缓存、提交失败重试，以及 Renderer 本地确认状态投影。

- [x] **Step 2: 按 confirmation ID 缓存并维护终态**

以不可变请求身份匹配 flight，终态确认不再恢复或重复提交；Session 事件改为 per-ID Map，并在 Runtime 终态或工具取消时清理 flight 与缓存；本地确认优先投影 waiting。

- [x] **Step 3: 验证确认矩阵**

确认控制器、Runtime 事件、Session 事件和 BChat 聚焦用例通过。

### Task 14: 从预检开始冻结 Runtime 资源

**Severity:** P1

**Root Cause:** 工具清单在异步预检中生成，但 capability descriptor 在 Promise 完成后才读取当前 WebView 与编辑器；用户在等待期间切页会把旧请求绑定到新资源。

**Files:**
- Modify: `src/components/BChat/hooks/useChatRuntimeLauncher.ts`
- Test: `test/components/BChat/session-id-runtime.test.ts`

- [x] **Step 1: 添加异步预检资源漂移失败测试**

预检开始时为资源 A，完成前切到 B，断言 descriptor 仍绑定 A。

- [x] **Step 2: 预检入口捕获资源快照**

`prepare()` 开始即捕获 document 与 WebView ID，后续能力描述仅消费该快照。

- [x] **Step 3: 验证资源冻结回归**

新增失败用例修复后通过，Runtime 工具绑定测试保持通过。

### Task 15: 保证恢复重放可重试且保持顺序

**Severity:** P2

**Root Cause:** 恢复器在首次 snapshot 中即把失败请求标为已重放，第二份权威 snapshot 无法重试；修正标记后仍会跳过失败请求继续执行后续请求，破坏原始请求顺序。

**Files:**
- Modify: `src/hooks/useChat/useRuntimeRecovery.ts`
- Test: `test/hooks/use-runtime-recovery.test.ts`

- [x] **Step 1: 添加首次失败与顺序失败测试**

让首个 tool replay 暂时失败并在第二 snapshot 成功，断言 bridge 请求必须在重试成功后执行。

- [x] **Step 2: 成功后再标记并在失败处暂停当前 Runtime**

首次 snapshot 容忍瞬时失败但不标记；当前 Runtime 遇到失败后停止后续 replay，由第二 snapshot 从失败位置按原顺序重试。

- [x] **Step 3: 验证恢复矩阵**

恢复聚焦用例通过，瞬时失败只产生一次有序重试。

### Task 16: 阻断空白草稿和删除后的迟到启动

**Severity:** P1

**Root Cause:** 空白草稿没有 Session ID，父级重置无法通过身份世代使预检失效；删除流程只检查活动 Main Runtime，Renderer 预检完成后仍可向已删除的显式 Session 启动并写入孤儿消息。

**Files:**
- Modify: `src/components/BChat/index.vue`
- Modify: `electron/main/modules/chat/runtime/ipc.mts`
- Test: `test/components/BChat/session-id-runtime.test.ts`
- Test: `test/electron/main/modules/chat/runtime/ipc.test.ts`

- [x] **Step 1: 添加草稿重置和删除竞态失败测试**

覆盖 loading 草稿被父级重置，以及显式 Session 删除后迟到 `chatRuntimeSend` 的场景。

- [x] **Step 2: dispose 未归属预检并在 Main 校验 Session**

`resetDraft()` 先 dispose Renderer-only 预检；Main 在 send、continue、compact 与 user-choice 入口同步校验显式 Session 存在性，不给删除和 Runtime 锁获取之间留下 await 间隙。

- [x] **Step 3: 验证删除与草稿回归**

新增失败用例修复后通过，删除 IPC 与 Session Runtime 聚焦测试保持通过。

### Task 17: 删除提交后无条件清理 Renderer 路由事实

**Severity:** P3

**Root Cause:** 会话数据已经删除，但 fallback 导航错误或阻塞型失败会让 `handleDeletedSession()` 提前返回，顶部标签和 Runtime owner 继续宣称该 Session 存在。

**Files:**
- Modify: `src/layouts/default/hooks/useChatRoute.ts`
- Test: `test/layouts/default/use-chat-route.test.ts`

- [x] **Step 1: 添加导航阻塞失败测试**

导航返回阻塞型失败后，断言已删除 Session 的标签与 Runtime owner 都必须消失。修复前标签仍为 1 且 owner 存在。

- [x] **Step 2: 删除导航失败提前返回**

导航继续通过 `asyncTo()` 做 best-effort；删除已经提交后，无条件应用 close plan 并移除目标及 detached Runtime owner。

- [x] **Step 3: 验证路由回归**

`use-chat-route` 16 项测试全部通过。

### Task 18: 为 Agent confirmation 终态 cursor 建立容量上限

**Severity:** P3

**Root Cause:** `agentCursors` 为防止迟到 pending 复活而永久保留终态 cursor；同时 recovery 响应缺失只删除 item，没有把 cursor 终态化。长期运行会无界增长，并允许缺失项被伪造高版本 pending 复活。

**Files:**
- Modify: `src/stores/chat/confirmationQueue.ts`
- Test: `test/stores/chat/confirmation-queue.test.ts`

- [x] **Step 1: 添加容量、恢复缺失与最近顺序失败测试**

覆盖 513 个终态 cursor、活动 pending 保留、recovery 缺失终态化，以及纯数字 confirmation ID 更新后的最近顺序。

- [x] **Step 2: 增加显式终态顺序与 512 上限**

`agentTerminalOrder` 独立记录从最旧到最新的终态身份，避免依赖 JavaScript 对象键顺序；只淘汰超过 512 的终态 cursor，pending cursor 永不参与容量淘汰。

- [x] **Step 3: 验证 confirmation queue 回归**

confirmation queue 18 项测试全部通过。

### Task 19: 为 Runtime recovery replay 增加有限退避

**Severity:** P3

**Root Cause:** 第一份 snapshot 的失败会由第二份权威 snapshot 重试，但第二次仍遇到瞬时 IPC 失败时立即放弃，需要重新挂载才能再次恢复。

**Files:**
- Modify: `src/hooks/useChat/useRuntimeRecovery.ts`
- Test: `test/hooks/use-runtime-recovery.test.ts`

- [x] **Step 1: 添加退避成功与耗尽失败测试**

覆盖第一、第二次立即失败后在 50ms、100ms 重试，断言 tool 成功前 bridge 不得执行；耗尽时必须抛出第四次的最后错误。

- [x] **Step 2: 在第二份权威 snapshot 阶段有限重试**

第一份 snapshot 仍只尝试一次；第二份 snapshot 立即尝试并依次等待 50ms、100ms，所有尝试都使用 `asyncTo()`，成功后才标记 replayed。

- [x] **Step 3: 验证 Runtime recovery 回归**

Runtime recovery 10 项测试全部通过，无未处理 Promise rejection。
