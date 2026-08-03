# Chat Tab Background Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让聊天标签只在对应 Chat 页面处于后台时显示 Runtime 状态，并在活动页查看后正确隐藏或确认终态提示。

**Architecture:** `ChatTabRuntimeRecord.status` 保留真实 Runtime 状态，通用 `Tab.status` 仅保存 HeaderTab 视觉投影。`src/views/chat/index.vue` 根据页面活动/后台生命周期调用 ChatTab Store 的 `markViewed` 与 `syncStatus`；`HeaderTab.vue` 保持不变。

**Tech Stack:** Vue 3、Vue Router、Pinia、Vitest、Vue Test Utils、TypeScript

## Global Constraints

- 禁止修改 `src/layouts/default/components/HeaderTab.vue` 或加入聊天个性化逻辑。
- 禁止使用 `any`，新增函数必须有明确类型和 JSDoc。
- 所有生产变更必须先有失败测试。
- 代码改动记录到 `changelog/2026-08-03.md`。
- 按用户要求，实施计划和后续代码不创建 Git commit。

---

### Task 1: 分离真实 Runtime 状态与活动页视觉投影

**Files:**
- Modify: `test/stores/chat/tab-runtime.test.ts`
- Modify: `src/stores/chat/tab.ts`

**Interfaces:**
- Consumes: `useTabsStore().setTabStatus(tabId: string, status?: TabStatus): void`
- Produces: `markViewed(tabId: string): void` 清除视觉投影，但只将 error/completed 归一为 idle
- Produces: `syncStatus(tabId: string): void` 重新投影保留的 running/waiting

- [ ] **Step 1: Write failing Store tests**

在 `test/stores/chat/tab-runtime.test.ts` 新增：

```typescript
it('hides viewed active states while preserving resumable runtime status', (): void => {
  const tabsStore = useTabsStore();
  tabsStore.tabs = [createTab('chat:session-a')];
  const store = useChatTabStore();
  store.ensureTab('chat:session-a', 'session-a');
  store.setStatus('chat:session-a', 'running');

  store.markViewed('chat:session-a');

  expect(store.getStatus('chat:session-a')).toBe('running');
  expect(tabsStore.tabs[0]?.status).toBeUndefined();
  store.syncStatus('chat:session-a');
  expect(tabsStore.tabs[0]?.status).toBe('loading');
});

it.each(['error', 'completed'] as const)('acknowledges viewed %s status as idle', (status): void => {
  const tabsStore = useTabsStore();
  tabsStore.tabs = [createTab('chat:session-a')];
  const store = useChatTabStore();
  store.ensureTab('chat:session-a', 'session-a');
  if (status === 'completed') store.markCompleted('chat:session-a', false);
  else store.setStatus('chat:session-a', status);

  store.markViewed('chat:session-a');

  expect(store.getStatus('chat:session-a')).toBe('idle');
  expect(tabsStore.tabs[0]?.status).toBeUndefined();
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm exec vitest run test/stores/chat/tab-runtime.test.ts -t "hides viewed active states|acknowledges viewed"
```

Expected: running 仍投影 loading，error 仍保持 error。

- [ ] **Step 3: Implement minimal Store behavior**

将 `src/stores/chat/tab.ts` 的 `markViewed` 改为：

```typescript
/**
 * 标记用户正在查看聊天标签。
 * running/waiting 保留真实状态以便再次进入后台时恢复提示；终态提示被确认后归一为 idle。
 * @param tabId - 标签 ID
 */
markViewed(tabId: string): void {
  const record = this.records[tabId];
  if (!record) return;
  if (record.status === 'error' || record.status === 'completed') record.status = 'idle';
  useTabsStore().setTabStatus(tabId, undefined);
},
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm exec vitest run test/stores/chat/tab-runtime.test.ts
```

Expected: 全部 PASS。

---

### Task 2: 由 Chat 页面协调活动与后台状态

**Files:**
- Modify: `test/views/chat/index.test.ts`
- Modify: `src/views/chat/index.vue`

**Interfaces:**
- Consumes: `ownerActive`、`runtimeStore.markViewed(tabId)`、`runtimeStore.syncStatus(tabId)`
- Produces: `syncOwnerStatus(active: boolean): void`
- Preserves: `HeaderTab.vue` 仅消费 `tab.status`

- [ ] **Step 1: Expose the KeepAlive test wrapper**

将测试 helper 改为返回 wrapper：

```typescript
function mountKeepAlivePage(sessionId: string | null): {
  visible: { value: boolean };
  wrapper: ReturnType<typeof mount>;
  bChat: ComponentPublicInstance;
} {
  const visible = ref<boolean>(true);
  routerMocks.route.params = sessionId ? { sessionId } : {};
  routerMocks.route.path = sessionId ? `/chat/${sessionId}` : '/chat';
  routerMocks.route.fullPath = routerMocks.route.path;
  const wrapper = mount(
    defineComponent({
      name: 'ChatPageKeepAliveHarness',
      components: { ChatPage },
      setup(): { visible: typeof visible } {
        return { visible };
      },
      template: '<KeepAlive><ChatPage v-if="visible" /></KeepAlive>'
    })
  );
  return { visible, wrapper, bChat: findBChat(wrapper) };
}
```

- [ ] **Step 2: Write failing active status tests**

```typescript
it.each(['running', 'error'] as const)('does not expose %s status while its chat page is active', async (status): Promise<void> => {
  routerMocks.route.path = '/chat/session-a';
  routerMocks.route.fullPath = '/chat/session-a';
  const tabsStore = useTabsStore();
  tabsStore.tabs = [{ id: 'chat:session-a', path: '/chat/session-a', title: '会话 A', cacheKey: 'chat:session-a' }];
  const wrapper = mountPage('session-a');

  findBChat(wrapper).$emit('runtime-status-change', { status });
  await nextTick();

  expect(tabsStore.tabs[0]?.status).toBeUndefined();
  expect(useChatTabStore().getStatus('chat:session-a')).toBe(status === 'error' ? 'idle' : 'running');
});
```

- [ ] **Step 3: Write failing leave-return-leave test**

```typescript
it('restores running status whenever an active chat page moves to the background', async (): Promise<void> => {
  const tabsStore = useTabsStore();
  tabsStore.tabs = [{ id: 'chat:session-a', path: '/chat/session-a', title: '会话 A', cacheKey: 'chat:session-a' }];
  const { visible, bChat } = mountKeepAlivePage('session-a');

  bChat.$emit('runtime-status-change', { status: 'running' });
  await nextTick();
  expect(tabsStore.tabs[0]?.status).toBeUndefined();

  visible.value = false;
  await nextTick();
  expect(tabsStore.tabs[0]?.status).toBe('loading');

  visible.value = true;
  await nextTick();
  expect(tabsStore.tabs[0]?.status).toBeUndefined();

  visible.value = false;
  await nextTick();
  expect(tabsStore.tabs[0]?.status).toBe('loading');
});
```

- [ ] **Step 4: Write failing background error test**

```typescript
it('shows a background error and clears it when the chat page is viewed', async (): Promise<void> => {
  const tabsStore = useTabsStore();
  tabsStore.tabs = [{ id: 'chat:session-a', path: '/chat/session-a', title: '会话 A', cacheKey: 'chat:session-a' }];
  const { visible, bChat } = mountKeepAlivePage('session-a');
  visible.value = false;
  await nextTick();

  bChat.$emit('runtime-status-change', { status: 'error' });
  await nextTick();
  expect(tabsStore.tabs[0]?.status).toBe('error');

  visible.value = true;
  await nextTick();
  expect(tabsStore.tabs[0]?.status).toBeUndefined();
  expect(useChatTabStore().getStatus('chat:session-a')).toBe('idle');
});
```

- [ ] **Step 5: Verify RED**

Run:

```bash
pnpm exec vitest run test/views/chat/index.test.ts -t "does not expose|restores running status|shows a background error"
```

Expected: 活动状态仍写入 HeaderTab，返回后 error 未确认，KeepAlive 离开没有恢复投影。

- [ ] **Step 6: Implement Chat page synchronization**

在 `src/views/chat/index.vue` 从 Vue 导入 `onDeactivated`，新增：

```typescript
/**
 * 根据页面活动状态同步当前聊天标签的后台视觉投影。
 * @param active - 当前聊天页是否处于活动路由
 */
function syncOwnerStatus(active: boolean): void {
  if (active) runtimeStore.markViewed(ownerTabId.value);
  else runtimeStore.syncStatus(ownerTabId.value);
}
```

将路由 watch 替换为：

```typescript
watch(ownerActive, syncOwnerStatus, { immediate: true });
```

在非 completed 的 `handleRuntimeStatus` 分支中，`setStatus` 后加入：

```typescript
if (isTabActive(tabId)) runtimeStore.markViewed(tabId);
```

新增 KeepAlive 后台同步：

```typescript
onDeactivated((): void => {
  runtimeStore.syncStatus(ownerTabId.value);
});
```

保留 `onActivated` 中的 `markCurrentViewed()` 作为幂等确认。

- [ ] **Step 7: Verify GREEN and unchanged HeaderTab behavior**

Run:

```bash
pnpm exec vitest run test/views/chat/index.test.ts test/layouts/default/header-tabs-chat-status.test.ts test/layouts/default/header-tabs-icon.test.ts
```

Expected: 全部 PASS。

---

### Task 3: Changelog and final verification

**Files:**
- Modify: `changelog/2026-08-03.md`
- Verify unchanged: `src/layouts/default/components/HeaderTab.vue`

**Interfaces:**
- Consumes: Task 1/2 的状态同步行为
- Produces: 变更记录与最终验证证据

- [ ] **Step 1: Update changelog**

在 `Changed` 记录 Chat 页面接管后台标签状态同步；在 `Test` 记录活动、后台、返回、再次离开和后台错误测试。

- [ ] **Step 2: Run scoped tests**

```bash
pnpm exec vitest run test/stores/chat/tab-runtime.test.ts test/views/chat/index.test.ts test/layouts/default/header-tabs-chat-status.test.ts test/layouts/default/header-tabs-icon.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 3: Run static checks**

```bash
pnpm exec tsc --noEmit
pnpm exec eslint src/stores/chat/tab.ts src/views/chat/index.vue test/stores/chat/tab-runtime.test.ts test/views/chat/index.test.ts
```

Expected: TypeScript exit code 0，ESLint 0 errors。

- [ ] **Step 4: Verify scope and diff**

```bash
git diff --check
git diff --name-only
```

Expected: 没有空白错误，且不包含 `src/layouts/default/components/HeaderTab.vue`。
