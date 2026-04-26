# SessionHistory 自给自足模式重构

## 背景

当前 `BChatSidebar` 同时管理 `sessions` 列表和 `messages`，而 `SessionHistory` 作为子组件通过 prop 接收 sessions 列表。这种模式导致父子组件耦合度高，sessions 的获取逻辑分散。

## 目标

将 `sessions` 的获取和管理逻辑全部下沉到 `SessionHistory` 组件内部，实现自给自足，父组件只需监听会话切换/删除事件并响应。

## 设计

### 1. SessionHistory 内部消化 sessions

**改动点：**
- 删除 `sessions` prop
- 新增内部 `sessions` ref，在 `onMounted` 时调用 `chatStore.getSessions(CHAT_SESSION_TYPE)` 初始化
- 新增 `CHAT_SESSION_TYPE` 常量（从父组件移入）

```typescript
// Props 简化
interface Props {
  activeSessionId?: string | null;
  disabled?: boolean;
}

// 内部状态
const sessions = ref<ChatSession[]>([]);

onMounted(async () => {
  sessions.value = await chatStore.getSessions(CHAT_SESSION_TYPE);
});
```

### 2. emit 暴露 sessionId

**改动点：**
- `switch-session` emit 参数从 `sessionId` 变为只带 `sessionId`（原本就是）
- `delete-session` emit 参数从 `sessionId` 变为只带 `sessionId`（原本就是）
- 父组件负责状态同步

### 3. BChatSidebar 简化

**改动点：**
- 删除本地 `sessions` ref
- `handleSwitchSession(sessionId)` — 通过 chatStore 加载新会话消息，更新 `settingStore.chatSidebarActiveSessionId`
- `handleDeleteSession(sessionId)` — 通过 chatStore 删除，emit 触发后重置状态
- 保留 `loadSessions` 中的激活会话验证逻辑（确保删除后激活 ID 仍然合法）

### 4. 组件通信接口

```
SessionHistory                      BChatSidebar
    │                                    │
    │◄──── props: activeSessionId        │
    │◄──── props: disabled               │
    │                                    │
    │──── emit: switch-session(sessionId) ───► handleSwitchSession
    │                                    │
    │──── emit: delete-session(sessionId) ────► handleDeleteSession
```

## 改动范围

| 文件 | 改动内容 |
|------|----------|
| `SessionHistory.vue` | 删除 sessions prop、内部获取 sessions |
| `BChatSidebar/index.vue` | 移除 sessions ref、简化会话处理逻辑 |

## 风险评估

- 低风险：纯逻辑迁移，无视觉/行为变化
- 需注意：删除会话后父组件仍需调用 `handleNewSession()` 重置 messages 和确认状态（已保留）