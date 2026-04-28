# 用户消息 Footer：时间戳与复制按钮

## 目标

用户消息气泡底部 hover 时显示发送时间和复制按钮：
- 今天 → 时间（`14:30`）
- 昨天 → 昨天 + 时间（`昨天 14:30`）
- 前天及更早 → 日期 + 时间（`04-26 14:30`）

## 方案

### 1. 时间格式化工具

新建 `utils/timeFormat.ts`，使用 dayjs（项目已有依赖，`isSame` 为内置方法，无需额外插件）。

```typescript
import dayjs from 'dayjs';

export function formatMessageTime(timestamp: string): string {
  const date = dayjs(timestamp);
  const now = dayjs();

  if (date.isSame(now, 'day')) return date.format('HH:mm');
  if (date.isSame(now.subtract(1, 'day'), 'day')) return `昨天 ${date.format('HH:mm')}`;
  return date.format('MM-DD HH:mm');
}
```

### 2. MessageBubble 模板

在 `</BBubble>` 之后追加 footer（仅用户消息且已完成时渲染）。

MessageBubble 已有 `useClipboard` 引入（`src/hooks/useClipboard.ts`），直接复用。

```vue
<div v-if="isUserMessage && message.finished" class="message-bubble__footer">
  <span class="message-bubble__time">{{ formatMessageTime(message.createdAt) }}</span>
  <BButton type="text" size="small" square icon="lucide:copy" @click="handleCopy(message)" />
</div>
```

script 中新增导入：

```typescript
import { formatMessageTime } from '../utils/timeFormat';

const handleCopy = (message: Message) => copy(message.content);
```

### 3. 样式

纯 CSS hover 控制显隐，footer 必须是 `.message-bubble` 的 DOM 后代（当前结构满足，`BBubble` 无 teleport）。

```less
.message-bubble__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
  opacity: 0;
  transition: opacity 0.15s ease;

  .message-bubble:hover & {
    opacity: 1;
  }
}

.message-bubble__time {
  font-size: 11px;
  color: var(--text-disabled);
  user-select: none;
}
```

## 注意事项

- **`finished` 语义确认**：需核查用户消息的 `finished` 字段是否会正确设置为 `true`，若恒为 `false` 则 footer 永不渲染，需换用其他条件（如去掉该判断，或改为检查 `createdAt` 已赋值）。
- **CSS hover 层级**：`.message-bubble:hover &` 依赖 footer 是 `.message-bubble` 的 DOM 直接后代，当前结构无 teleport 或跨层，满足条件。

## 改动范围

| 文件 | 改动 |
|------|------|
| `src/components/BChatSidebar/utils/timeFormat.ts` | 新增，使用 dayjs 实现 `formatMessageTime` |
| `src/components/BChatSidebar/components/MessageBubble.vue` | 新增 footer 模板块、导入 `formatMessageTime`、样式 |
