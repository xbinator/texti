# BChat 结构化消息片段

日期：2026-04-22

这份文档记录 `BChat` 消息结构在 2026-04-22 的调整：聊天消息从“主要依赖 `content` 文本和临时工具结果回注”改为“以 `parts` 作为界面展示、模型上下文和工具链恢复的主数据”。

## 背景

聊天侧已经支持工具多轮循环：

1. 模型输出 assistant 文本或 tool-call。
2. renderer 执行本地工具。
3. 工具结果回注给模型。
4. 模型继续生成，可能再次调用工具。

旧结构里 `Message.content` 是单一字符串，`toolCalls` 只能描述 assistant 发起过哪些工具调用，工具结果则通过临时 `pendingToolResults` 拼进下一轮请求。这个结构有三个问题：

- 视图无法按顺序展示“文本 -> 工具调用 -> 工具结果 -> 文本”。
- 工具结果不在聊天消息里，刷新或恢复会话后无法完整恢复工具上下文。
- 一条 UI 消息和 AI SDK 的多条 `ModelMessage` 之间缺少明确转换规则。

## 新规则

`Message.parts` 是聊天消息的主数据。

`Message.content` 是纯文本聚合字段，只用于复制、标题、搜索和其他需要纯文本的场景。

```ts
export interface Message {
  id: string;
  role: ChatMessageRole;
  content: string;
  parts: ChatMessagePart[];
  thinking?: string;
  files?: ChatMessageFile[];
  usage?: AIUsage;
  createdAt: string;
  loading?: boolean;
  finished?: boolean;
}
```

`content` 只由 `text` parts 聚合，不包含 thinking、tool-call 和 tool-result。

## Part 类型

`ChatMessagePart` 定义在 `types/chat.d.ts`：

```ts
export type ChatMessagePart =
  | ChatMessageTextPart
  | ChatMessageThinkingPart
  | ChatMessageToolCallPart
  | ChatMessageToolResultPart;
```

### text

用于普通用户输入和 assistant 可见回复。

```ts
{ type: 'text', text: '我来读取当前文档。' }
```

流式 text chunk 写入时，如果最后一个 part 也是 `text`，直接追加到该 part；否则创建新的 text part。

### thinking

用于模型思考内容。

```ts
{ type: 'thinking', thinking: '需要先读取文档，再总结结构。' }
```

`thinking` 不进入 `content`。为了兼容现有渲染和持久化统计，消息上仍保留 `message.thinking` 聚合字段。

### tool-call

用于 assistant 发起的工具调用。

```ts
{
  type: 'tool-call',
  toolCallId: 'call_123',
  toolName: 'read_current_document',
  input: {}
}
```

`tool-call` 不进入 `content`，但会进入模型上下文转换。

### tool-result

用于记录本地工具执行结果。

```ts
{
  type: 'tool-result',
  toolCallId: 'call_123',
  toolName: 'read_current_document',
  result: {
    toolName: 'read_current_document',
    status: 'success',
    data: { content: '...' }
  }
}
```

工具结果采用方案 A：直接放在对应 assistant message 的 `parts` 中。写入时优先插入到匹配 `toolCallId` 的 `tool-call` 后面，保证 UI 顺序和上下文顺序一致。

当工具结果触发下一轮续流时，新的 assistant 输出会继续追加到当前 assistant message，而不是新建一条新的 assistant 消息。这样一轮“文本 -> 工具调用 -> 工具结果 -> 续写文本”会稳定保留在同一条消息里。

## 写入约定

用户提交普通文本时：

```ts
{
  role: 'user',
  content,
  parts: [{ type: 'text', text: content }]
}
```

assistant 流式输出文本时：

- 写入或合并 `text` part。
- 同步更新 `content = textParts.join('')`。

assistant 流式输出 thinking 时：

- 写入或合并 `thinking` part。
- 同步更新 `message.thinking`。
- 不更新 `content`。

assistant 发起工具调用时：

- 写入 `tool-call` part。
- 不更新 `content`。

工具执行完成时：

- 写入 `tool-result` part。
- 不更新 `content`。
- `pendingToolResults` 仍只作为“是否需要续轮”的运行时信号；模型上下文从 `parts` 重建。

错误消息：

```ts
{
  role: 'error',
  content: errorMessage,
  parts: [{ type: 'text', text: errorMessage }]
}
```

## UI 渲染

`MessageBubble` 不再直接把 `message.content` 作为唯一气泡内容，而是按 `message.parts` 渲染：

- `text`：Markdown 文本。
- `thinking`：思考块。
- `tool-call`：工具调用块，展示工具名和输入。
- `tool-result`：工具结果块，展示工具名、状态和结构化结果，支持单独折叠。

默认复制仍然复制 `message.content`，即纯文本答案，不复制工具调用和工具结果 JSON。

深度思考和工具结果都支持按片段折叠，便于在长工具链回复里快速浏览最终答案。

## 模型上下文转换

UI 层采用方案 A：工具结果和工具调用同属一条 assistant message 的 `parts`。

AI SDK 层仍需要标准消息序列，所以 `toModelMessages()` 会把一条 assistant UI message 拆成多条 `ModelMessage`：

```ts
assistant: text + tool-call
tool: tool-result
assistant: text
tool: tool-result
assistant: text
```

转换规则：

- user message 转为 `{ role: 'user', content: message.content }`。
- error message 不进入模型上下文。
- assistant 的 `text` 和 `tool-call` 聚合成 assistant message。
- assistant 的 `tool-result` 聚合成 tool message。
- `thinking` 当前不进入模型上下文。

这样既保持 UI 数据结构简单，又满足 AI SDK 对工具结果的消息形态要求。

## 持久化

聊天消息记录 `ChatMessageRecord` 新增：

```ts
parts: ChatMessagePart[];
```

SQLite `chat_messages` 表新增：

```sql
parts_json TEXT
```

新建数据库会直接包含该字段；已有数据库通过 `migrateDatabase()` 自动补列。

本项目目前还没有投入使用，所以不做旧数据迁移兼容。读取已有空 `parts_json` 时会得到空数组，但新消息必须写入完整 `parts`。

## 关键文件

- `types/chat.d.ts`
- `src/components/BChat/types.ts`
- `src/components/BChat/message.ts`
- `src/components/BChat/index.vue`
- `src/components/BChat/components/MessageBubble.vue`
- `src/stores/chat.ts`
- `src/shared/storage/chats/sqlite.ts`
- `electron/main/modules/database/service.mts`

## 验证

本次调整已通过：

- `pnpm test`
- `pnpm build`
