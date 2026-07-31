# 会话工作区控件调整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将会话工作区选择入口移到左侧，并让用户能恢复当前会话到默认 `~/.tibis` 工作区。

**Architecture:** 已保存会话通过新的 clear IPC 删除 `metadata.workspaceRoot`，草稿会话只清除 composable 的内存覆盖值。`InputToolbar` 以一个左侧工作区分组显示名称，分组悬停且存在覆盖时显示恢复默认图标，并由 BChat 将事件路由到 composable。

**Tech Stack:** Vue 3 Composition API、Pinia、TypeScript strict、Electron IPC、better-sqlite3、Vitest、Vue Test Utils。

## Global Constraints

- 不使用 `any`；新增函数、接口、类型和复杂逻辑须有中文 JSDoc，文件保持文件头注释。
- 异步错误使用 `asyncTo`；恢复默认失败由 BChat Toast 展示。
- `workspaceRoot` 缺失是默认 `~/.tibis` 的唯一表示，清除操作不得破坏模型或未知 metadata。
- 工作流繁忙时选择与恢复均禁用；本次不创建 Git 提交。
- 代码变更更新 `changelog/2026-07-31.md`，验证 Vitest、ESLint、Stylelint 与 TypeScript。

---

## 文件结构

| 文件 | 责任 |
| --- | --- |
| `electron/main/modules/chat/service.mts` | 在事务中删除单个会话的工作区 metadata。 |
| `electron/main/modules/chat/ipc.mts`、`electron/preload/index.mts`、`types/electron-api.d.ts` | 提供受限的清除会话工作区 IPC。 |
| `src/stores/chat/session.ts` | 将主进程返回的已清除会话合并到 Pinia。 |
| `src/components/BChat/hooks/useSessionWorkspace.ts` | 清除草稿或已持久化会话的覆盖。 |
| `src/components/BChat/index.vue` | 把恢复事件传入 composable 并显示错误。 |
| `src/components/BChat/components/InputToolbar.vue` | 左侧工作区分组和悬停恢复图标。 |
| `test/**` | 覆盖清除持久化、草稿状态及工具栏事件。 |

## Task 1: 清除已保存会话的工作区覆盖

**Files:**

- Modify: `electron/main/modules/chat/service.mts:570-582`
- Modify: `electron/main/modules/chat/ipc.mts:63-68`
- Modify: `electron/preload/index.mts:298`
- Modify: `types/electron-api.d.ts:580`
- Modify: `src/stores/chat/session.ts:414-427`
- Modify: `test/electron/main/modules/chat/service-runtime-fields.test.ts`
- Modify: `test/electron/main/modules/chat/session-model-ipc.test.ts`
- Modify: `test/stores/chat/session.test.ts`

**Interfaces:**

- Produces `ChatSessionManager.clearSessionWorkspace(sessionId: string): ChatSession`.
- Produces `ElectronAPI.chatSessionClearWorkspace(sessionId: string): Promise<ChatHandlerResult<ChatSession>>`.
- Produces `useChatSessionStore().clearSessionWorkspace(sessionId: string): Promise<ChatSession>`.

- [ ] **Step 1: 写失败测试**

在 service、IPC 和 store 测试中加入清除断言，要求保留非工作区 metadata：

```ts
const cleared = createSession('session-1', {
  metadata: { model: { providerId: 'provider-1', modelId: 'model-1' } }
});
mockElectronAPI.chatSessionClearWorkspace.mockResolvedValue({ ok: true, data: cleared });

await expect(store.clearSessionWorkspace('session-1')).resolves.toEqual(cleared);
expect(mockElectronAPI.chatSessionClearWorkspace).toHaveBeenCalledWith('session-1');
expect(cleared.metadata?.workspaceRoot).toBeUndefined();
```

IPC 测试将 mock service 增加 `clearSessionWorkspace`，并断言：

```ts
expect(callHandler<ChatSession>('chat:session:clearWorkspace', 'session-1')).toEqual({ ok: true, data: cleared });
expect(mocks.clearSessionWorkspace).toHaveBeenCalledWith('session-1');
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm exec vitest run test/electron/main/modules/chat/service-runtime-fields.test.ts test/electron/main/modules/chat/session-model-ipc.test.ts test/stores/chat/session.test.ts`

Expected: FAIL，缺少 `clearSessionWorkspace` 与 `chat:session:clearWorkspace`。

- [ ] **Step 3: 实现清除 IPC、服务和 store action**

在服务中保留其余 metadata；只剩空对象时写入 `null`：

```ts
clearSessionWorkspace(sessionId: string): ChatSession {
  return transaction((): ChatSession => {
    const session = this.getSessionById(sessionId);
    if (!session) throw new Error('找不到聊天会话');

    const metadata: ChatSessionMetadata = { ...(session.metadata ?? {}) };
    delete metadata.workspaceRoot;
    const nextMetadata = Object.keys(metadata).length ? metadata : undefined;
    const updatedAt = dayjs().toISOString();
    dbExecute(UPDATE_SESSION_METADATA_SQL, [stringifyJson(nextMetadata), updatedAt, sessionId]);
    return { ...session, metadata: nextMetadata, updatedAt };
  });
}
```

使用下列透传合约，store 的 action 与现有 `updateSessionWorkspace` 一样在 `asyncTo`、`unwrap` 成功后才用 `mergeSessions` 更新缓存：

```ts
chatSessionClearWorkspace: (sessionId) => ipcRenderer.invoke('chat:session:clearWorkspace', sessionId),
ipcMain.handle('chat:session:clearWorkspace', wrapHandler((_event, sessionId) => chatSessionManager.clearSessionWorkspace(sessionId as string)));
```

- [ ] **Step 4: 运行通过测试**

Run: `pnpm exec vitest run test/electron/main/modules/chat/service-runtime-fields.test.ts test/electron/main/modules/chat/session-model-ipc.test.ts test/stores/chat/session.test.ts`

Expected: PASS，清除工作区不影响模型 metadata，失败时缓存不变。

- [ ] **Step 5: 不创建提交**

用户明确要求本次不创建 Git 提交；保留工作区改动供用户检查。

## Task 2: 清除草稿与当前会话工作区状态

**Files:**

- Modify: `src/components/BChat/hooks/useSessionWorkspace.ts:20-118`
- Modify: `src/components/BChat/index.vue:63-76,235-244`
- Modify: `test/components/BChat/use-session-workspace.test.ts`
- Modify: `test/components/BChat/session-id-runtime.test.ts`

**Interfaces:**

- Consumes `clearSessionWorkspace(sessionId: string): Promise<ChatSession>` from Task 1.
- Produces `clearWorkspace(): Promise<void>` from `useSessionWorkspace`.
- Produces `workspace-clear` handling in BChat.

- [ ] **Step 1: 写失败测试**

为 composable 加两个独立行为：草稿清除不调用 store，已保存会话使用 clear action 并立刻使有效根目录回退；为 BChat stub 增加 `workspace-clear`，验证触发后调用 store：

```ts
await workspace.clearWorkspace();
expect(workspace.workspaceOverride.value).toBeUndefined();
expect(workspace.workspaceRoot.value).toBe('/Users/test/.tibis');

await workspace.clearWorkspace();
expect(chatStore.clearSessionWorkspace).toHaveBeenCalledWith('session-1');
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm exec vitest run test/components/BChat/use-session-workspace.test.ts test/components/BChat/session-id-runtime.test.ts`

Expected: FAIL，composable 未公开 `clearWorkspace`，BChat 未订阅 `workspace-clear`。

- [ ] **Step 3: 实现草稿与会话清除**

在 composable 中添加方法；已保存会话先使旧读取失效，再等待 store 返回。只在当前会话未切换时更新投影：

```ts
async function clearWorkspace(): Promise<void> {
  const sessionId = options.activeSessionId.value;
  if (!sessionId) {
    workspaceOverride.value = undefined;
    return;
  }

  loadSequence += 1;
  const [error, session] = await asyncTo(chatStore.clearSessionWorkspace(sessionId));
  if (error) throw error;
  if (options.activeSessionId.value === sessionId) {
    workspaceOverride.value = session.metadata?.workspaceRoot;
  }
}
```

在 BChat 使用 `asyncTo(clearWorkspace())`，失败时显示 `恢复默认工作区失败：${error.message}`；成功不提示。将 `workspaceOverride.value !== undefined` 传给工具栏，并监听 `@workspace-clear`。

- [ ] **Step 4: 运行通过测试**

Run: `pnpm exec vitest run test/components/BChat/use-session-workspace.test.ts test/components/BChat/session-id-runtime.test.ts`

Expected: PASS，草稿和已保存会话都会回退到默认根目录，切换会话时不会被过期结果覆盖。

- [ ] **Step 5: 不创建提交**

用户明确要求本次不创建 Git 提交；保留工作区改动供用户检查。

## Task 3: 重排工具栏并悬停显示恢复按钮

**Files:**

- Modify: `src/components/BChat/components/InputToolbar.vue:7-38,64-92,143-170`
- Modify: `test/components/BChat/input-toolbar-workspace.test.ts`
- Modify: `test/components/BChat/session-id-runtime.test.ts`

**Interfaces:**

- Consumes `hasWorkspaceOverride: boolean`、`workspaceDisabled: boolean`。
- Produces `workspace-select` 和 `workspace-clear` 事件。

- [ ] **Step 1: 写失败测试**

重写工具栏测试，使用类选择器而非 data-testid。验证文字分组位于 `.toolbar-space` 前、选择按钮没有工作区图标及 tooltip/aria/data-testid、覆盖存在时显示恢复按钮并发出事件：

```ts
const workspace = wrapper.get('.chat-input-toolbar__workspace');
expect(workspace.element.compareDocumentPosition(wrapper.get('.toolbar-space').element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
expect(workspace.find('.chat-input-toolbar__workspace-select').text()).toContain('project');
await workspace.get('.chat-input-toolbar__workspace-clear').trigger('click');
expect(wrapper.emitted('workspace-clear')).toEqual([[]]);
```

另以 `hasWorkspaceOverride: false` 挂载，断言恢复按钮不存在；以 `workspaceDisabled: true` 挂载，断言两个操作都禁用。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm exec vitest run test/components/BChat/input-toolbar-workspace.test.ts test/components/BChat/session-id-runtime.test.ts`

Expected: FAIL，控件仍在右侧、没有恢复图标或事件。

- [ ] **Step 3: 实现左侧工作区分组**

在图片上传控件之后、`.toolbar-space` 之前放入以下分组；不传 tooltip、`data-testid` 或 `aria-label`，也不渲染选择图标：

```vue
<div class="chat-input-toolbar__workspace">
  <BButton class="chat-input-toolbar__workspace-select" size="small" type="text" :disabled="workspaceDisabled" @click="$emit('workspace-select')">
    <span class="chat-input-toolbar__workspace-label">{{ workspaceLabel }}</span>
  </BButton>
  <BButton
    v-if="hasWorkspaceOverride"
    class="chat-input-toolbar__workspace-clear"
    size="small"
    square
    type="text"
    :disabled="workspaceDisabled"
    @click="$emit('workspace-clear')"
  >
    <BIcon icon="lucide:rotate-ccw" :size="14" />
  </BButton>
</div>
```

新增 `hasWorkspaceOverride` prop 和 `workspace-clear` emit，删除 `workspacePath` prop。以 opacity、max-width 和 pointer-events 默认隐藏清除按钮，仅在 `.chat-input-toolbar__workspace:hover` 与 `.chat-input-toolbar__workspace:focus-within` 下显示；保留禁用态。

- [ ] **Step 4: 运行通过测试**

Run: `pnpm exec vitest run test/components/BChat/input-toolbar-workspace.test.ts test/components/BChat/session-id-runtime.test.ts`

Expected: PASS，工作区选择位于左侧，恢复按钮只对覆盖会话出现并正确路由事件。

- [ ] **Step 5: 不创建提交**

用户明确要求本次不创建 Git 提交；保留工作区改动供用户检查。

## Task 4: 记录变更并完成验证

**Files:**

- Modify: `changelog/2026-07-31.md`

- [ ] **Step 1: 更新 changelog**

在 `## Changed` 下记录：

```markdown
- 聊天工作区选择入口移至输入工具栏左侧；已选择临时目录时可悬停恢复默认 `~/.tibis`，并清除会话保存的覆盖目录。
```

- [ ] **Step 2: 运行定向测试**

Run: `pnpm exec vitest run test/electron/main/modules/chat/service-runtime-fields.test.ts test/electron/main/modules/chat/session-model-ipc.test.ts test/stores/chat/session.test.ts test/components/BChat/use-session-workspace.test.ts test/components/BChat/input-toolbar-workspace.test.ts test/components/BChat/session-id-runtime.test.ts`

Expected: PASS。

- [ ] **Step 3: 运行静态检查**

Run: `pnpm lint`

Expected: PASS。

Run: `pnpm lint:style`

Expected: PASS。

Run: `pnpm exec tsc --noEmit`

Expected: PASS。

- [ ] **Step 4: 确认不创建提交**

Run: `git status --short`

Expected: 显示本次未提交的文件改动；不执行 `git add` 或 `git commit`。
