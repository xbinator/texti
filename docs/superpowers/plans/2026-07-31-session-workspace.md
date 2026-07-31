# 会话级临时工作区 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在 BChat 中为单个聊天会话选择、持久化并安全使用临时本地工作区，未选择时继续使用 `~/.tibis`。

**Architecture:** 将覆盖目录放在 `chat_sessions.metadata_json` 的 `metadata.workspaceRoot`。BChat 的会话工作区 composable 合并覆盖值与默认根目录，并把有效根目录传给 Runtime、工具工厂和文件引用解析。目录只经 Electron 原生选择器传入，由主进程 `realpath` 规范化。

**Tech Stack:** Vue 3 Composition API、Pinia、TypeScript strict、Electron IPC、better-sqlite3、Vitest、Vue Test Utils。

## Global Constraints

- 禁止 `any`；所有新函数、接口、类型和复杂逻辑必须带中文 JSDoc，文件必须有文件头注释。
- 异步错误通过 `asyncTo(promise)` 归一化；目录选择失败由 BChat Toast 展示。
- B 开头组件自动导入；新增 BChat 样式使用 `createNamespace('chat')` 生成的类名，不能使用 `&__` 拼接类名。
- 覆盖只影响当前会话；未覆盖时使用 `~/.tibis`；运行中不得切换，工作区在请求准备时冻结。
- 所有代码变更记录到 `changelog/2026-07-31.md`；最终运行 Vitest、ESLint、Stylelint 与 TypeScript 检查。

---

## File Structure

| 文件 | 责任 |
| --- | --- |
| `electron/main/modules/dialog/ipc.mts` | 返回原生目录选择结果的真实路径。 |
| `electron/preload/index.mts`、`types/electron-api.d.ts` | 受限地暴露目录选择与会话工作区更新 IPC。 |
| `src/shared/platform/native/{types,electron,web}.ts` | 提供跨平台 `selectDirectory()`。 |
| `types/chat.d.ts`、`electron/main/modules/chat/{service,ipc}.mts`、`src/stores/chat/session.ts` | 维护 `metadata.workspaceRoot`。 |
| `src/components/BChat/hooks/useSessionWorkspace.ts` | 管理草稿、会话覆盖和目录可用性预检。 |
| `src/components/BChat/{index.vue,components/InputToolbar.vue,hooks/*.ts}` | 注入有效根目录、显示选择入口并冻结繁忙状态。 |

## Task 1: 添加受限的原生目录选择 IPC

**Files:**

- Create: `test/electron/main/modules/dialog/ipc.test.ts`
- Modify: `electron/main/modules/dialog/ipc.mts`
- Modify: `electron/preload/index.mts`
- Modify: `types/electron-api.d.ts`
- Modify: `src/shared/platform/native/types.ts`
- Modify: `src/shared/platform/native/electron.ts`
- Modify: `src/shared/platform/native/web.ts`

**Interfaces:**

- Produces `ElectronAPI.openDirectory(): Promise<string | null>`.
- Produces `Native.selectDirectory(): Promise<string | null>`.
- Task 3 consumes `native.selectDirectory()`.

- [ ] **Step 1: 写失败测试**

Mock `showOpenDialog` 和 `node:fs/promises`，覆盖取消、成功和规范化失败：

```ts
it('returns the canonical native-selected directory', async (): Promise<void> => {
  mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/link-workspace'] });
  mocks.realpath.mockResolvedValue('/private/tmp/workspace');

  await expect(callHandler<string | null>('dialog:openDirectory')).resolves.toBe('/private/tmp/workspace');
  expect(mocks.showOpenDialog).toHaveBeenCalledWith({ properties: ['openDirectory'] });
  expect(mocks.realpath).toHaveBeenCalledWith('/tmp/link-workspace');
});
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm exec vitest run test/electron/main/modules/dialog/ipc.test.ts`

Expected: FAIL，尚未注册 `dialog:openDirectory`。

- [ ] **Step 3: 实现主进程、preload 和平台抽象**

在 dialog handler 中以目录模式打开并将用户选中的第一项 realpath：

```ts
ipcMain.handle('dialog:openDirectory', async (): Promise<string | null> => {
  return openLock.run(async (): Promise<string | null> => {
    const result = await showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    return fs.realpath(result.filePaths[0]);
  });
});
```

同步新增以下合约；Electron 转发 preload API，Web 固定返回 `null`：

```ts
// ElectronAPI
openDirectory: () => Promise<string | null>;
// Native
selectDirectory(): Promise<string | null>;
// preload
openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
```

- [ ] **Step 4: 运行通过测试**

Run: `pnpm exec vitest run test/electron/main/modules/dialog/ipc.test.ts`

Expected: PASS，三个目录选择情形全部通过。

- [ ] **Step 5: 提交 Task 1**

```bash
git add electron/main/modules/dialog/ipc.mts electron/preload/index.mts types/electron-api.d.ts src/shared/platform/native/types.ts src/shared/platform/native/electron.ts src/shared/platform/native/web.ts test/electron/main/modules/dialog/ipc.test.ts
git commit -m "feat(chat): 支持选择会话工作区目录"
```

## Task 2: 持久化会话工作区 metadata

**Files:**

- Modify: `types/chat.d.ts`
- Modify: `types/electron-api.d.ts`
- Modify: `electron/preload/index.mts`
- Modify: `electron/main/modules/chat/ipc.mts`
- Modify: `electron/main/modules/chat/service.mts`
- Modify: `src/stores/chat/session.ts`
- Modify: `test/electron/main/modules/chat/session-model-ipc.test.ts`
- Modify: `test/electron/main/modules/chat/service-runtime-fields.test.ts`
- Modify: `test/electron/main/modules/chat/branch.test.ts`
- Modify: `test/stores/chat/session.test.ts`

**Interfaces:**

- Produces `ChatSessionMetadata.workspaceRoot?: string`.
- Produces `updateSessionWorkspace(sessionId: string, workspaceRoot: string): ChatSession` on Main and Pinia.
- Extends `createSession` options with `workspaceRoot?: string`.

- [ ] **Step 1: 写失败测试**

服务层测试必须验证合并已有 model 与未知 metadata；IPC 测试必须验证 `chat:session:updateWorkspace`；分支测试必须验证继承覆盖目录；store 测试必须验证失败不改变缓存：

```ts
expect(chatSessionManager.updateSessionWorkspace('session-1', '/private/tmp/project').metadata).toEqual({
  layout: 'compact',
  model: { providerId: 'provider-1', modelId: 'model-1' },
  workspaceRoot: '/private/tmp/project'
});
expect(branch.session.metadata?.workspaceRoot).toBe('/private/tmp/project');
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm exec vitest run test/electron/main/modules/chat/session-model-ipc.test.ts test/electron/main/modules/chat/service-runtime-fields.test.ts test/electron/main/modules/chat/branch.test.ts test/stores/chat/session.test.ts`

Expected: FAIL，缺少 workspace API 和 metadata 字段。

- [ ] **Step 3: 实现 metadata 合并与 IPC**

添加 metadata 字段和专用 IPC；服务层验证去除首尾空白后非空，且必须在事务内保留现有 metadata：

```ts
updateSessionWorkspace(sessionId: string, workspaceRoot: string): ChatSession {
  const normalizedWorkspaceRoot = workspaceRoot.trim();
  if (!normalizedWorkspaceRoot) throw new Error('会话工作区格式无效');

  return transaction((): ChatSession => {
    const session = this.getSessionById(sessionId);
    if (!session) throw new Error('找不到聊天会话');
    const updatedAt = dayjs().toISOString();
    const metadata: ChatSessionMetadata = { ...(session.metadata ?? {}), workspaceRoot: normalizedWorkspaceRoot };
    dbExecute(UPDATE_SESSION_METADATA_SQL, [stringifyJson(metadata), updatedAt, sessionId]);
    return { ...session, metadata, updatedAt };
  });
}
```

store action 必须使用 `asyncTo`、`unwrap` 和 `mergeSessions([session], this.sessions)`。创建会话时把可选 model 与 workspaceRoot 组合为 metadata；两个值都不存在时保留 `undefined`。

- [ ] **Step 4: 运行通过测试**

Run: `pnpm exec vitest run test/electron/main/modules/chat/session-model-ipc.test.ts test/electron/main/modules/chat/service-runtime-fields.test.ts test/electron/main/modules/chat/branch.test.ts test/stores/chat/session.test.ts`

Expected: PASS，metadata 合并、会话读取、分支继承和 store 失败回滚均通过。

- [ ] **Step 5: 提交 Task 2**

```bash
git add types/chat.d.ts types/electron-api.d.ts electron/preload/index.mts electron/main/modules/chat/ipc.mts electron/main/modules/chat/service.mts src/stores/chat/session.ts test/electron/main/modules/chat/session-model-ipc.test.ts test/electron/main/modules/chat/service-runtime-fields.test.ts test/electron/main/modules/chat/branch.test.ts test/stores/chat/session.test.ts
git commit -m "feat(chat): 持久化会话工作区"
```

## Task 3: 实现会话工作区状态和统一 Runtime 预检

**Files:**

- Create: `src/components/BChat/hooks/useSessionWorkspace.ts`
- Create: `test/components/BChat/use-session-workspace.test.ts`
- Modify: `src/components/BChat/hooks/useChatSessionRuntime.ts`
- Modify: `src/components/BChat/hooks/useRuntimeRequestConfig.ts`
- Modify: `src/components/BChat/hooks/useRuntimeTools.ts`
- Modify: `test/components/BChat/use-runtime-tools.test.ts`
- Modify: `test/components/BChat/session-id-runtime.test.ts`

**Interfaces:**

```ts
interface UseSessionWorkspaceReturn {
  workspaceRoot: ComputedRef<string | null>;
  workspaceOverride: Readonly<Ref<string | undefined>>;
  workspaceLabel: ComputedRef<string>;
  selectWorkspace: () => Promise<void>;
  assertWorkspaceAvailable: () => Promise<void>;
}
```

- [ ] **Step 1: 写失败测试**

使用 Pinia 和 native mock 覆盖草稿、持久化会话、取消、会话切换竞态和失效目录；扩展 BChat Runtime 测试，确认首轮 session metadata 与 Runtime `workspaceRoot` 一致：

```ts
nativeMock.selectDirectory.mockResolvedValue('/private/tmp/project');
await workspace.selectWorkspace();
expect(workspace.workspaceRoot.value).toBe('/private/tmp/project');
expect(chatStore.updateSessionWorkspace).toHaveBeenCalledWith('session-1', '/private/tmp/project');

nativeMock.getPathStatus.mockResolvedValue({ exists: false, isFile: false, isDirectory: false });
await expect(workspace.assertWorkspaceAvailable()).rejects.toThrow('当前会话工作区不可用，请重新选择目录');
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm exec vitest run test/components/BChat/use-session-workspace.test.ts test/components/BChat/use-runtime-tools.test.ts test/components/BChat/session-id-runtime.test.ts`

Expected: FAIL，缺少 composable 与有效根目录注入。

- [ ] **Step 3: 实现 composable、会话创建和统一预检**

`useSessionWorkspace` 接收 `activeSessionId` 与默认根目录 Ref。它读取 `metadata.workspaceRoot`，在覆盖缺失时返回默认根目录，并以递增请求序号和 session ID 防止异步旧值覆盖当前会话。`selectWorkspace` 在草稿会话只修改覆盖 Ref，在已有会话调用 store action；取消不修改状态。

`assertWorkspaceAvailable` 只校验覆盖目录，要求 `native.getPathStatus(path)` 返回 `exists && isDirectory`，否则抛出固定错误。将该方法注入 `useRuntimeRequestConfig` 并在所有资源同步前 `await`，使首次发送、重试、压缩与用户选择续跑共享预检。

将 `useWorkspaceRoot()` 移至 BChat 页面，先得到默认根目录，再构造会话工作区，最后把有效 Ref 和 getter 传入 `useRuntimeTools`。`useRuntimeTools` 不再自行调用 `useWorkspaceRoot`，其 builtin tools callback 与 `read_directory` 过滤均使用注入的有效根目录。`useChatSessionRuntime` 接收 `getWorkspaceOverride`，并用下列创建选项保存草稿选择：

```ts
const session = await chatStore.createSession('assistant', {
  title,
  model,
  workspaceRoot: options.getWorkspaceOverride()
});
```

- [ ] **Step 4: 运行通过测试**

Run: `pnpm exec vitest run test/components/BChat/use-session-workspace.test.ts test/components/BChat/use-runtime-tools.test.ts test/components/BChat/session-id-runtime.test.ts`

Expected: PASS，草稿持久化、会话恢复、隔离、失效目录阻止 Runtime 和有效根目录的工具暴露均通过。

- [ ] **Step 5: 提交 Task 3**

```bash
git add src/components/BChat/hooks/useSessionWorkspace.ts src/components/BChat/hooks/useChatSessionRuntime.ts src/components/BChat/hooks/useRuntimeRequestConfig.ts src/components/BChat/hooks/useRuntimeTools.ts test/components/BChat/use-session-workspace.test.ts test/components/BChat/use-runtime-tools.test.ts test/components/BChat/session-id-runtime.test.ts
git commit -m "feat(chat): 使用会话级工作区运行对话"
```

## Task 4: 在输入工具栏选择工作区

**Files:**

- Create: `test/components/BChat/input-toolbar-workspace.test.ts`
- Modify: `src/components/BChat/components/InputToolbar.vue`
- Modify: `src/components/BChat/index.vue`
- Modify: `test/components/BChat/session-id-runtime.test.ts`

**Interfaces:**

- `InputToolbar` 新增 `workspaceLabel: string`、`workspacePath?: string`、`workspaceDisabled: boolean` props。
- `InputToolbar` 新增 `workspace-select` event。
- BChat handler 使用 `asyncTo(selectWorkspace())`，失败时显示 Toast。

- [ ] **Step 1: 写失败测试**

在 jsdom 组件测试中覆盖默认与覆盖目录的 tooltip、点击事件和禁用状态；在 BChat 集成测试中从 InputToolbar stub 发出 `workspace-select`，验证 Runtime 根目录和错误 Toast：

```ts
await wrapper.get('[data-testid="chat-workspace-selector"]').trigger('click');
expect(wrapper.emitted('workspace-select')).toEqual([[]]);

await wrapper.setProps({ workspaceDisabled: true });
expect(wrapper.get('[data-testid="chat-workspace-selector"]').attributes('disabled')).toBeDefined();
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm exec vitest run test/components/BChat/input-toolbar-workspace.test.ts test/components/BChat/session-id-runtime.test.ts`

Expected: FAIL，尚无工作区按钮和事件。

- [ ] **Step 3: 实现按钮与页面接线**

在模型选择器之前添加按钮，保留稳定测试选择器、完整路径 tooltip、无障碍标签与禁用状态：

```vue
<BButton
  data-testid="chat-workspace-selector"
  size="small"
  type="text"
  :aria-label="`选择工作区：${workspaceLabel}`"
  :disabled="workspaceDisabled"
  :tooltip="workspacePath ? `工作区：${workspacePath}` : '工作区：默认 ~/.tibis'"
  @click="$emit('workspace-select')"
>
  <BIcon icon="lucide:folder-search" :size="16" />
  <span class="chat-input-toolbar__workspace-label">{{ workspaceLabel }}</span>
</BButton>
```

在 BChat 把 `loading.value` 作为 `workspaceDisabled`，它覆盖运行、等待、预检和回退。选择取消不显示消息；选择或持久化错误显示 `选择工作区失败：${error.message}`。样式写完整 `.chat-input-toolbar__workspace-label`，不能使用 `&__workspace-label`。

- [ ] **Step 4: 运行通过测试**

Run: `pnpm exec vitest run test/components/BChat/input-toolbar-workspace.test.ts test/components/BChat/session-id-runtime.test.ts`

Expected: PASS，按钮、禁用、事件、错误提示与后续 Runtime 根目录均符合预期。

- [ ] **Step 5: 提交 Task 4**

```bash
git add src/components/BChat/components/InputToolbar.vue src/components/BChat/index.vue test/components/BChat/input-toolbar-workspace.test.ts test/components/BChat/session-id-runtime.test.ts
git commit -m "feat(chat): 在输入栏切换会话工作区"
```

## Task 5: 变更日志和完整验证

**Files:**

- Modify: `changelog/2026-07-31.md`

- [ ] **Step 1: 记录变更日志**

在 `## Added` 下写入：

```markdown
- 聊天输入栏支持为当前会话选择并持久化独立的本地工作区；未选择时继续使用默认 `~/.tibis`。
```

- [ ] **Step 2: 运行全部相关测试**

Run: `pnpm exec vitest run test/electron/main/modules/dialog/ipc.test.ts test/electron/main/modules/chat/session-model-ipc.test.ts test/electron/main/modules/chat/service-runtime-fields.test.ts test/electron/main/modules/chat/branch.test.ts test/stores/chat/session.test.ts test/components/BChat/use-session-workspace.test.ts test/components/BChat/use-runtime-tools.test.ts test/components/BChat/input-toolbar-workspace.test.ts test/components/BChat/session-id-runtime.test.ts`

Expected: PASS，所有指定测试零失败。

- [ ] **Step 3: 运行静态检查和项目测试**

Run: `pnpm lint && pnpm lint:style && pnpm exec tsc --noEmit && pnpm test`

Expected: 每条命令 exit code 为 0；自动修复若改变文件，重新运行受影响测试。

- [ ] **Step 4: 检查交付 diff**

Run: `git diff --check && git status --short`

Expected: 无空白错误，变更仅包括该功能、测试与当天 changelog。

- [ ] **Step 5: 提交 Task 5**

```bash
git add changelog/2026-07-31.md
git commit -m "docs: 记录会话工作区支持"
```
