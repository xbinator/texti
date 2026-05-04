# ConfirmationCard 自定义输入方案

## 背景

`src/components/BChatSidebar/components/ConfirmationCard.vue` 当前只支持固定确认动作，例如 `应用`、`本会话允许`、`始终允许` 和 `取消`。这类交互适合工具权限确认，但当大模型返回一组建议动作时，用户可能不想直接接受这些预设项，而是希望自己补充一个更准确的回复。

这类输入与 `ask_user_choice` 并不完全等价。确认卡背后没有天然的“等待用户回答”的工具结果，因此不能简单复用 `submitUserChoice` 语义，而应该把它建模为“用户拒绝当前确认，并发起一条新的用户消息继续对话”。

## 目标

- 在 `ConfirmationCard` 中支持“固定确认动作 + 用户自由输入”
- 用户自由输入后，取消当前确认，并沿用正常聊天消息流继续交给模型
- 保持现有确认动作链路兼容，不影响纯权限确认卡的行为

## 非目标

- 第一版不改造底层工具权限模型
- 第一版不在确认卡中引入复杂表单、额外配置页或范围规则编辑
- 第一版不要求所有确认卡都支持自定义输入，只对具备“模型建议作答”语义的场景开放

## 总体方案

将 `ConfirmationCard` 中的“用户不按预设项执行，而是自己补充回复”建模为一次新的用户消息。

具体来说：

1. `ConfirmationCard` 继续保留原有 `confirmation-action`
2. 当当前卡片具备“建议选项”语义时，卡片额外展示一个 `自己输入` 入口
3. 用户输入并提交后，组件向上派发一个独立的自定义输入事件
4. 上游先取消当前确认，再把该输入作为一条新的用户消息继续交给模型

这样可以把“工具确认”和“用户补充回复”分开：

- `confirmation-action` 负责执行型动作
- `confirmation-custom-input` 负责放弃当前建议并继续发起新对话

## 组件与数据设计

### `ConfirmationCard.vue`

新增一个轻量自定义输入区：

- 默认只显示 `自己输入` 文字按钮
- 点击后展开输入框
- 输入框旁提供 `发送` 和 `取消`
- 当卡片状态不是 `pending` 时，不显示该输入区

自定义输入区仅在当前卡片携带“可自由作答”的数据时出现，避免对普通权限确认卡造成干扰。

### 数据模型

第一版建议在确认卡片数据中补充确认卡自有的轻量配置，例如：

- `enabled`：是否允许自定义输入
- `placeholder`：输入框提示文案
- `triggerLabel`：入口按钮文案

这部分字段应补充在 `types/chat.d.ts` 的确认卡片类型中，并保持可选，以兼容现有确认卡数据。

### 事件链

保留现有链路：

- `ConfirmationCard.vue`
- `MessageBubble.vue`
- `ConversationView.vue`
- `src/components/BChatSidebar/index.vue`

在这条链路上新增对 `confirmation-custom-input` 的透传，最终由 `src/components/BChatSidebar/index.vue` 负责取消当前确认并发起新的用户消息。

## 交互细节

- 用户点击预设项时，沿用原有行为
- 用户点击 `自己输入` 后，展开输入框并自动聚焦
- 输入为空时禁用 `发送`
- 提交后收起输入框并清空内容，避免重复提交
- 若用户先选中某个建议、随后编辑输入框，以输入框内容作为最终答案

文案上建议把入口命名为 `自己输入` 或 `其他答案`，强调“这是对模型建议的补充”，而不是新的权限模式。

## 错误处理

- 如果当前卡片没有标记允许自由输入，则不显示该入口
- 如果模型配置不可用，父层不应继续发起新消息
- 如果确认项在输入期间已失效，父层取消确认时应保持幂等

## 测试建议

- 组件测试：确认卡在不同状态下的展开、输入、提交和取消行为
- 事件测试：`confirmation-custom-input` 透传是否携带正确的确认项 ID 和文本内容
- 回归测试：原有 `approve`、`approve-session`、`approve-always`、`cancel` 不受影响
- 流程测试：提交自定义输入后，是否会取消当前确认并作为新用户消息继续流式响应

## 实施范围

预计改动文件：

- `src/components/BChatSidebar/components/ConfirmationCard.vue`
- `src/components/BChatSidebar/components/MessageBubble.vue`
- `src/components/BChatSidebar/components/ConversationView.vue`
- `src/components/BChatSidebar/index.vue`
- `src/ai/tools/builtin/settings.ts`
- `types/chat.d.ts`
- 相关测试文件

## 决策结论

第一版采用“确认卡支持自由输入，并在提交时取消当前确认后继续发起新用户消息”的方案。它既保留了确认卡现有执行语义，也让用户在模型建议不足时能够直接补充自己的答案，同时避免把确认卡错误建模为 `ask_user_choice`。当前首个接入的真实 producer 为 `update_settings`。
