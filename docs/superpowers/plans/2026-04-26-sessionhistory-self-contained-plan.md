# SessionHistory 自给自足模式重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 sessions 的获取和管理逻辑下沉到 SessionHistory 组件内部，实现自给自足，父组件 BChatSidebar 只需监听会话切换/删除事件并响应。

**Architecture:** SessionHistory 内部通过 chatStore 获取 sessions 列表，emit sessionId 变化事件；BChatSidebar 监听事件并同步 messages 状态。

**Tech Stack:** Vue 3 Composition API, Pinia (chatStore), TypeScript

---

## 文件改动概览

| 文件 | 改动内容 |
|------|----------|
| `src/components/BChatSidebar/components/SessionHistory.vue` | 删除 sessions prop，内部获取 sessions，emit 只带 sessionId |
| `src/components/BChatSidebar/index.vue` | 移除 sessions ref，简化会话处理逻辑 |

---

## Task 1: 修改 SessionHistory.vue

**Files:**
- Modify: `src/components/BChatSidebar/components/SessionHistory.vue`

- [ ] **Step 1: 移除 sessions prop，添加内部状态**

删除 Props 中的 `sessions` 属性，添加内部 `sessions` ref：

```typescript
interface Props {
  activeSessionId?: string | null;
  disabled?: boolean;
}

// 删除 sessions prop 相关代码
// const props = withDefaults(defineProps<Props>(), {
//   sessions: () => [],  // 删除这行
//   activeSessionId: null,
//   disabled: false
// });

// 新增内部状态
const sessions = ref<ChatSession[]>([]);
```

- [ ] **Step 2: 添加 CHAT_SESSION_TYPE 常量并移入 onMounted 获取逻辑**

从 index.vue 移入常量，在 onMounted 时获取 sessions：

```typescript
const CHAT_SESSION_TYPE = 'assistant';

onMounted(async () => {
  sessions.value = await chatStore.getSessions(CHAT_SESSION_TYPE);
});
```

- [ ] **Step 3: 添加 refreshSessions 方法供外部调用**

新增一个刷新 sessions 的方法，供 BChatSidebar 在需要时调用：

```typescript
async function refreshSessions(): Promise<void> {
  sessions.value = await chatStore.getSessions(CHAT_SESSION_TYPE);
}

// defineExpose 暴露给父组件
defineExpose({
  refreshSessions
});
```

- [ ] **Step 4: 调整 delete-session emit 参数**

当前 `handleDeleteSession` 调用 `emit('delete-session', sessionId)`，保持不变（原本就只有 sessionId）。但确认删除后会调用 `refreshSessions` 刷新列表：

```typescript
async function handleDeleteSession(sessionId: string) {
  if (props.disabled) return;
  if (loading.value) return;

  loading.value = true;
  const [error] = await asyncTo(chatStore.deleteSession(sessionId));
  loading.value = false;

  if (!error) {
    await refreshSessions();  // 新增：删除成功后刷新列表
  }

  error ? message.error(error.message || '删除会话失败，请重试') : emit('delete-session', sessionId);
}
```

- [ ] **Step 5: 调整 switch-session emit 参数**

`handleSwitchSession` 保持不变（原本就只有 sessionId）。

---

## Task 2: 修改 BChatSidebar/index.vue

**Files:**
- Modify: `src/components/BChatSidebar/index.vue`

- [ ] **Step 1: 移除 sessions ref**

```typescript
// 删除这行
// const sessions = ref<ChatSession[]>([]);

// 保留 loading ref，后续用于刷新逻辑
const historyLoading = ref(false);
```

- [ ] **Step 2: 添加 SessionHistory 组件 ref**

```typescript
const sessionHistoryRef = ref<{ refreshSessions: () => Promise<void> } | null>(null);
```

- [ ] **Step 3: 简化 handleSwitchSession**

```typescript
async function handleSwitchSession(sessionId: string): Promise<void> {
  if (chatStream.loading.value) return;
  if (loading.value) return;

  loading.value = true;
  confirmationController.dispose();
  settingStore.setChatSidebarActiveSessionId(sessionId);
  hasMoreHistory.value = false;

  try {
    setLoadedMessages(await chatStore.getSessionMessages(sessionId));
  } finally {
    loading.value = false;
  }
}
```

- [ ] **Step 4: 简化 handleDeleteSession**

```typescript
async function handleDeleteSession(sessionId: string): Promise<void> {
  if (chatStream.loading.value) return;

  const wasActive = settingStore.chatSidebarActiveSessionId === sessionId;

  // 通知 SessionHistory 刷新列表
  sessionHistoryRef.value?.refreshSessions();

  if (wasActive) {
    confirmationController.dispose();
    await handleNewSession();
  }
}
```

- [ ] **Step 5: 更新模板中 SessionHistory 绑定**

```html
<SessionHistory
  ref="sessionHistoryRef"
  :active-session-id="settingStore.chatSidebarActiveSessionId"
  :disabled="chatStream.loading.value"
  @delete-session="handleDeleteSession"
  @switch-session="handleSwitchSession"
/>
```

删除 `:sessions="sessions"` 绑定。

- [ ] **Step 6: 移除 loadSessions 调用（onMounted）**

```typescript
// onMounted 中删除 loadSessions();
// 只保留
onMounted(() => {
  unregisterFileReferenceInsert = onChatFileReferenceInsert((reference) => {
    handleFileReferenceInsert(reference);
  });
});
```

- [ ] **Step 7: 移除 CHAT_SESSION_TYPE 常量**

该常量已移到 SessionHistory.vue。

---

## Task 3: 验证与检查

- [ ] **Step 1: 运行 TypeScript 类型检查**

```bash
npm run typecheck
```

预期：无类型错误

- [ ] **Step 2: 运行 ESLint 检查**

```bash
npm run lint
```

预期：无 lint 错误

- [ ] **Step 3: 手动测试场景**

1. 打开聊天侧边栏，验证历史会话下拉正常显示
2. 点击切换会话，验证消息列表正确切换
3. 点击删除会话，验证列表正确刷新且状态正确重置
4. 新建会话后验证下拉列表包含新会话

---

**Plan complete.**