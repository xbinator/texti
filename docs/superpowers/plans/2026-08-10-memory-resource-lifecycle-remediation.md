# Memory And Resource Lifecycle Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the confirmed unbounded caches, orphaned native resources, workers, timers, and listener registrations found by the 2026-08-10 project-wide memory audit.

**Architecture:** Main-process resources are owned by the invoking `webContents.id` and are released when that owner is destroyed. Renderer caches expose explicit release boundaries and retain only bounded LRU/TTL state; every asynchronous setup path uses a disposed barrier so cleanup cannot race with late registration.

**Tech Stack:** Electron, Vue 3, Pinia, TypeScript strict mode, Vitest, lodash-es.

## Global Constraints

- Do not use `any`; every new function and type has JSDoc and explicit parameter/return types.
- Use `asyncTo` for new renderer asynchronous error normalization instead of new asynchronous `try/catch` blocks.
- Write and run a failing regression test before each production change.
- Preserve unrelated uncommitted BMessage changes and append the final result to `changelog/2026-08-10.md`.
- Run targeted tests after every task, then TypeScript, ESLint check-only, Stylelint check-only, and `pnpm test` before completion.

---

### Task 1: MCP runtime forgetting

**Files:**
- Modify: `electron/main/modules/mcp/status.mts`
- Modify: `electron/main/modules/mcp/session.mts`
- Modify: `electron/main/modules/mcp/ipc.mts`
- Modify: `electron/preload/index.mts`
- Modify: `types/electron-api.d.ts`
- Modify: `src/views/settings/tools/mcp/index.vue`
- Test: `test/electron/main/modules/mcp/session.test.ts`
- Test: `test/views/settings/tools/mcp/index.test.ts`

**Interfaces:**
- Produces: `deleteStatus(serverId: string): void` and `forgetMcpServer(serverId: string): Promise<void>`.
- Produces: renderer API `forgetMcpServer(serverId: string): Promise<void>` over `tools:mcp:forget`.

- [ ] Add a session test that connects a wrapper, calls `forgetMcpServer`, and proves disconnect plus discovery/status removal.
- [ ] Run `pnpm exec vitest run test/electron/main/modules/mcp/session.test.ts` and observe the missing export failure.
- [ ] Implement `forgetMcpServer` as `closeSession` followed by `deleteDiscoveryCache` and `deleteStatus`; keep `disconnectMcpServer` as the visible idle transition.
- [ ] Add settings-page tests proving disable and remove call the forget API before refreshing local state.
- [ ] Run the two targeted tests and require all assertions to pass.

### Task 2: Main-process owner scopes and request backpressure

**Files:**
- Modify: `electron/main/modules/webview/ipc.mts`
- Modify: `electron/main/modules/workspace/watch.mts`
- Modify: `electron/main/modules/workspace/ipc.mts`
- Modify: `electron/main/modules/request/core/constants.mts`
- Modify: `electron/main/modules/request/core/queue.mts`
- Modify: `electron/main/modules/request/service.mts`
- Modify: `electron/main/modules/request/ipc.mts`
- Test: `test/electron/main/modules/webview-ipc.test.ts`
- Test: `test/electron/main/modules/workspace/watch.test.ts`
- Test: `test/electron/main/modules/request-ipc.test.ts`

**Interfaces:**
- Produces: `RequestQueue.add(run, { signal? })`, bounded by `REQUEST_MAX_PENDING`.
- Produces: `FileWatchService.releaseOwner(ownerId: number): Promise<void>` and owner-aware watch/unwatch methods.
- Produces: WebView ownership tracked by sender ID with `destroyOwner(ownerId: number): void`.

- [ ] Add failing tests for queue overflow and queued abort removal.
- [ ] Implement a fixed pending limit, AbortSignal-aware dequeue, per-sender IPC limit, and sender-destroy abort.
- [ ] Add a failing WebView test that emits sender `destroyed` and expects every owned view to close and leave its host window.
- [ ] Store each view together with its host window and owner ID; release all owned views on sender destruction.
- [ ] Add failing watcher tests for shared ownership, owner destruction, and pending unlink timer cleanup.
- [ ] Add owner reference sets for files/directories; make `fs:unwatchAll` owner-scoped and make service shutdown clear timers.
- [ ] Run all three targeted test files and require them to pass.

### Task 3: Bounded renderer and agent caches

**Files:**
- Modify: `src/components/BEditor/utils/richMarkdownParser.ts`
- Modify: `src/components/BEditor/hooks/useRichEditor.ts`
- Modify: `src/components/BChat/hooks/useWorkspaceMentions.ts`
- Modify: `src/stores/chat/agentTask.ts`
- Modify: `src/components/BChat/index.vue`
- Modify: `src/stores/chat/session.ts`
- Modify: `electron/main/modules/chat/agents/coordinator.mts`
- Modify: `src/stores/ai/skill.ts`
- Modify: `src/stores/ai/widget.ts`
- Test: `test/components/BEditor/rich-markdown-parser.test.ts`
- Test: `test/components/BChat/use-workspace-mentions.test.ts`
- Test: `test/stores/chat/agent-task.test.ts`
- Test: `test/electron/main/modules/chat/agents/coordinator.test.ts`
- Test: `test/stores/ai/skill.test.ts`
- Test: `test/stores/ai/widget.test.ts`

**Interfaces:**
- Produces: `releaseRichParseEngine(editorInstanceId: string): void` with an eight-entry LRU fallback.
- Produces: `releaseSession(sessionId: string): void` with a unique request epoch that rejects late responses.
- Produces: a 256-entry Coordinator terminal-state bound and 512-entry Skill/Widget operation tombstone bounds.

- [ ] Add failing size/release tests for Rich Markdown engines and workspace mention entries.
- [ ] Implement explicit release plus LRU/TTL pruning and invoke parser release from Rich editor scope disposal.
- [ ] Add a failing Agent Store test that releases one session while preserving another and ignores a late response from the released epoch.
- [ ] Implement `releaseSession`, call it on chat scope disposal and persisted session deletion, and remove all matching indexes/details/cursors.
- [ ] Add a failing Coordinator test that creates 257 terminal checkpoints and expects the oldest terminal state to be evicted.
- [ ] Bound terminal Coordinator state while preserving running states and duplicate acceptance for recent terminals.
- [ ] Add Skill/Widget tests that apply more than 512 unique resource paths and assert diagnostic tombstone size remains bounded.
- [ ] Run all six targeted test files and require them to pass.

### Task 4: Terminal cleanup and asynchronous teardown barriers

**Files:**
- Modify: `electron/main/modules/mcp/oauth/callback-server.mts`
- Modify: `src/views/settings/tools/skill/components/SkillCreator.vue`
- Modify: `src/hooks/useWatchResource/index.ts`
- Create: `test/electron/main/modules/mcp/oauth/callback-server.test.ts`
- Modify: `test/views/settings/tools/skill/skill-creator.test.ts`
- Create: `test/hooks/use-watch-resource.test.ts`

**Interfaces:**
- Produces: one `settle` path in OAuth that always clears the timeout and closes the server.
- Produces: a disposed-aware cleanup registrar for `useWatchResource` that immediately runs late cleanup.

- [ ] Add an OAuth fake-server/fake-timer test proving success, invalid callback, server error, and timeout each leave zero timers and a closed server.
- [ ] Implement a stored timer handle and idempotent `settle` closure.
- [ ] Add Worker tests proving success, parse error, and component unmount each call `terminate` exactly once.
- [ ] Terminate the Worker in every message/error terminal branch and in `onUnmounted`.
- [ ] Add mount/unmount race tests for delayed `getHomeDir` and delayed `watchDirectory`.
- [ ] Implement a disposed barrier and immediate late-disposer execution.
- [ ] Run all three targeted test files and require them to pass.

### Task 5: Root listeners, KeepAlive wrappers, RAF, and delayed callbacks

**Files:**
- Modify: `src/hooks/useSystem/index.ts`
- Modify: `src/stores/ui/setting.ts`
- Modify: `src/hooks/useMenuAction/index.ts`
- Modify: `src/layouts/default/hooks/useKeepAlive.ts`
- Modify: `src/layouts/default/index.vue`
- Modify: `src/components/BEditor/components/CodeBlock.vue`
- Modify: `src/views/webview/web/hooks/useHostLayer.ts`
- Modify: `src/views/webview/web/index.vue`
- Modify: `src/views/settings/provider/detail.vue`
- Test: `test/hooks/use-system.test.ts`
- Test: `test/stores/ui/setting.test.ts`
- Create: `test/layouts/default/use-keep-alive.test.ts`
- Modify: `test/views/webview/web-hosting.test.ts`
- Modify: `test/views/webview/web-recent-record.test.ts`
- Modify: `test/stores/ai/provider.test.ts`

**Interfaces:**
- Produces: `KeepAliveCache.prune(validCacheNames: readonly string[]): void`.
- Produces: `settingStore.disposeTheme(): void` and idempotent `initTheme()`.

- [ ] Add failing remount tests for the default system file handler and theme media-query listener.
- [ ] Store and invoke their unregister functions; dispose theme from `useMenuAction`.
- [ ] Add a failing KeepAlive prune test and implement pruning from `tabsStore.cachedComponentNames` changes.
- [ ] Add failing unmount/deactivation tests for HostLayer RAF and both debounced writes.
- [ ] Cancel RAF/debounce during teardown and disconnect the shared Mermaid observer during HMR disposal.
- [ ] Run all targeted tests and require them to pass.

### Task 6: Final verification and documentation

**Files:**
- Modify: `changelog/2026-08-10.md`

- [ ] Append one `Changed` entry describing owner-scoped native cleanup, bounded caches, and terminal resource disposal.
- [ ] Run `pnpm exec tsc --noEmit` and `pnpm run electron:build-main`.
- [ ] Run `pnpm exec eslint src --ext .vue,.ts,.tsx,.js,.jsx,.mts` without `--fix` and `pnpm exec stylelint 'src/**/*.{vue,less,css}'` without `--fix`.
- [ ] Run `pnpm test` and record exact file/test totals.
- [ ] Run a deterministic lifecycle stress test covering 100 queue/cache/session/owner cycles and assert every exposed diagnostic count is zero or below its fixed bound.
- [ ] Review `git diff --check`, `git status --short`, and the final diff to confirm unrelated user edits were preserved and no generated artifacts were added.
