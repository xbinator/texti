# Chat 标签后台状态同步设计

## 背景

聊天 Runtime 的真实状态保存在 `src/stores/chat/tab.ts`，并同步为通用标签的 `tab.status`。`src/layouts/default/components/HeaderTab.vue` 只负责把 `tab.status` 渲染为 loading、waiting、error 或 completed 视觉状态。

当前聊天页即使正处于活动路由，Runtime 状态变化仍会写入 `tab.status`，导致用户已经在查看消息时，HeaderTab 仍显示 loading 或 error。目标是把这些视觉状态限定为后台提示，同时保持 HeaderTab 的通用性。

## 目标

- 活动聊天页不向 HeaderTab 暴露 loading、waiting、error 或 completed 状态。
- Runtime 在后台运行或等待用户时，HeaderTab 显示对应状态。
- 用户返回仍在运行或等待的聊天页后隐藏状态；再次离开时重新显示。
- Runtime 在后台失败时显示 error；用户返回查看后清除 error。
- Runtime 在活动聊天页失败时不显示 HeaderTab error。
- HeaderTab 不包含任何聊天页面或 Runtime 的个性化判断。

## 非目标

- 不改变 HeaderTab 的通用状态渲染协议与样式。
- 不改变 BChat、Main Runtime 或 Actor 的执行状态。
- 不改变聊天标签关闭、草稿晋升和恢复机制。

## 方案

### 状态分层

`ChatTabRuntimeRecord.status` 继续保存真实聊天状态。通用 `Tab.status` 仅作为 HeaderTab 的视觉投影，可以在活动页面被清除，而不丢失 running 或 waiting 状态。

终态提示 error 和 completed 在用户查看后视为已读，将真实聊天状态归一为 idle。running 和 waiting 在用户查看后仍保留真实状态，因此再次离开页面时可以恢复提示。

### ChatTab Store

沿用现有两个动作，不向 HeaderTab 增加依赖：

- `markViewed(tabId)`：
  - error/completed 转为 idle；
  - running/waiting 保持不变；
  - 无论真实状态为何，都清除通用 `Tab.status`。
- `syncStatus(tabId)`：根据当前 `ChatTabRuntimeRecord.status` 重新写入通用 `Tab.status`。

### Chat 页面

`src/views/chat/index.vue` 作为唯一的活动状态协调者：

1. 监听当前页面拥有的聊天标签是否处于活动路由。
2. 进入活动路由时调用 `markViewed`，隐藏视觉状态并确认终态提示已读。
3. 离开活动路由时调用 `syncStatus`，根据真实状态恢复后台提示。
4. 收到 BChat Runtime 状态事件时先更新真实状态；若目标标签当前活动，立即调用 `markViewed`，避免活动页出现瞬时或残留状态。
5. completed 继续使用现有 `markCompleted(tabId, active)` 契约。

活动判断继续复用页面现有 `isTabActive`，支持标签保存的完整路径以及会话路径回退，不在 HeaderTab 重复实现路由规则。

## 状态行为

| Runtime 事件 | 页面状态 | 真实聊天状态 | HeaderTab 投影 |
| --- | --- | --- | --- |
| running | 活动 | running | 无 |
| running | 后台 | running | loading |
| running 中返回 | 活动 | running | 无 |
| running 中再次离开 | 后台 | running | loading |
| waiting | 活动 | waiting | 无 |
| waiting | 后台 | waiting | attention |
| error | 活动 | idle（已查看） | 无 |
| error | 后台 | error | error |
| 后台 error 后返回 | 活动 | idle（已查看） | 无 |
| completed | 活动 | idle（已查看） | 无 |
| completed | 后台 | completed | completed |

## 竞态与边界

- Runtime 状态事件可能与路由切换相邻发生；每次事件处理都重新调用 `isTabActive(tabId)`，不依赖过期的活动快照。
- 带 `sessionId` 的终态事件必须更新真实会话拥有的标签，而不是当前页面实例的默认标签。
- KeepAlive 页面重新激活时再次执行 `markViewed`，确保恢复后的活动页面不保留后台视觉状态。
- HeaderTab 继续只消费 `tab.status`，因此普通编辑器、WebView 等标签的状态行为不受影响。

## 测试

在 `test/views/chat/index.test.ts` 覆盖：

1. 活动页面收到 running 与 error 时不设置 HeaderTab 状态。
2. running 时离开页面显示 loading。
3. running 时返回隐藏 loading，再次离开重新显示。
4. 后台从 running 转为 error 时显示 error，返回后清除。
5. 活动页面直接发生 error 时保持无状态。

在 `test/stores/chat/tab-runtime.test.ts` 覆盖：

- `markViewed` 保留 running/waiting 的真实状态但清除通用 Tab 状态。
- `markViewed` 将 error/completed 归一为 idle。
- `syncStatus` 可以在再次离开时恢复 running/waiting 的视觉投影。

现有 HeaderTab 测试保持不变，用于证明组件仍是通用的纯 `tab.status` 渲染器。
