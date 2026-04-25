# BChat 组件迁移到 BChatSidebar 计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `src/components/BChat/components/` 下的 9 个组件和 5 个 utils 迁移到 `src/components/BChatSidebar/components/` 和 `src/components/BChatSidebar/utils/`，并重命名组件以反映其归属。

**Architecture:**
- 组件命名统一加 `Chat` 前缀（如 `MessageBubble` → `ChatMessageBubble`）
- utils 保持原名（工具函数，非组件）
- BChat 保留为基础聊天组件，但其子组件通过 BChatSidebar 使用
- 所有导入路径更新为新位置

**Tech Stack:** Vue 3, TypeScript, less

---

## 组件命名映射

| 原组件文件 | 新组件文件 | defineOptions name |
|-----------|-----------|-------------------|
| Container.vue | ChatContainer.vue | ChatContainer |
| MessageBubble.vue | ChatMessageBubble.vue | ChatMessageBubble |
| MessageBubblePartText.vue | ChatMessageBubblePartText.vue | ChatMessageBubblePartText |
| MessageBubblePartThinking.vue | ChatMessageBubblePartThinking.vue | ChatMessageBubblePartThinking |
| MessageBubblePartToolCall.vue | ChatMessageBubblePartToolCall.vue | ChatMessageBubblePartToolCall |
| MessageBubblePartToolResult.vue | ChatMessageBubblePartToolResult.vue | ChatMessageBubblePartToolResult |
| ConfirmationCard.vue | ChatConfirmationCard.vue | ChatConfirmationCard |
| AskUserChoiceCard.vue | ChatAskUserChoiceCard.vue | ChatAskUserChoiceCard |
| ToBottomButton.vue | ChatToBottomButton.vue | ChatToBottomButton |

## Utils 迁移

| 原路径 | 新路径 |
|-------|-------|
| BChat/utils/confirmationCard.ts | BChatSidebar/utils/confirmationCard.ts |
| BChat/utils/fileReferenceContext.ts | BChatSidebar/utils/fileReferenceContext.ts |
| BChat/utils/messagePart.ts | BChatSidebar/utils/messagePart.ts |
| BChat/utils/toolCallTracker.ts | BChatSidebar/utils/toolCallTracker.ts |
| BChat/utils/toolLoopGuard.ts | BChatSidebar/utils/toolLoopGuard.ts |

---

## 文件变更总览

**新建 (23 files):**
- `src/components/BChatSidebar/components/` - 9 个 Vue 组件
- `src/components/BChatSidebar/utils/` - 5 个 ts 工具文件

**修改 (2 files):**
- `src/components/BChat/index.vue` - 更新导入路径
- `src/components/BChatSidebar/index.vue` - 更新导入路径

**删除 (14 files):**
- `src/components/BChat/components/` - 9 个 Vue 组件
- `src/components/BChat/utils/` - 5 个 ts 工具文件

---

## Task 1: 创建 ChatContainer.vue

**Files:**
- Create: `src/components/BChatSidebar/components/ChatContainer.vue`
- Modify: `src/components/BChat/index.vue` (imports)
- Delete: `src/components/BChat/components/Container.vue`

- [ ] **Step 1: 创建 ChatContainer.vue**

内容与原 `Container.vue` 相同，但：
- `defineOptions({ name: 'ChatContainer' })` 改名
- 导入的 `ToBottomButton` 改为 `./ChatToBottomButton.vue`

```vue
<template>
  <div class="b-chat-container">
    <div ref="mainRef" class="b-chat-container__main">
      <div class="b-chat-container__placeholder"></div>
      <div class="b-chat-container__content">
        <slot></slot>
      </div>
    </div>

    <ChatToBottomButton :visible="isBackBottom" :loading="loading" @click="scrollToBottom" />
  </div>
</template>

<script setup lang="ts">
/**
 * @file ChatContainer.vue
 * @description 聊天消息滚动容器，负责回到底部、历史加载触发和滚动锚定。
 */
import { nextTick, onMounted, ref } from 'vue';
import { useEventListener } from '@vueuse/core';
import { getScrollTop, getScroller, setScrollTop } from '@/utils/scroll';
import ChatToBottomButton from './ChatToBottomButton.vue';

defineOptions({ name: 'ChatContainer' });

interface Props {
  loading: boolean;
}

withDefaults(defineProps<Props>(), {
  loading: false
});

const emit = defineEmits<{
  (e: 'load-history'): void;
}>();

// ... (其余代码与原文件相同)
</script>
```

- [ ] **Step 2: 更新 BChat/index.vue 的 Container 导入**

将：
```typescript
import Container from './components/Container.vue';
```

改为：
```typescript
import Container from '@/components/BChatSidebar/components/ChatContainer.vue';
```

- [ ] **Step 3: 删除原文件**

删除 `src/components/BChat/components/Container.vue`

---

## Task 2: 创建 ChatMessageBubble.vue

**Files:**
- Create: `src/components/BChatSidebar/components/ChatMessageBubble.vue`
- Modify: `src/components/BChat/index.vue` (imports)
- Delete: `src/components/BChat/components/MessageBubble.vue`

- [ ] **Step 1: 创建 ChatMessageBubble.vue**

- `defineOptions({ name: 'ChatMessageBubble' })` 改名
- 导入子组件路径更新：
  - `./AskUserChoiceCard.vue` → `./ChatAskUserChoiceCard.vue`
  - `./ConfirmationCard.vue` → `./ChatConfirmationCard.vue`
  - `./MessageBubblePartText.vue` → `./ChatMessageBubblePartText.vue`
  - `./MessageBubblePartThinking.vue` → `./ChatMessageBubblePartThinking.vue`
  - `./MessageBubblePartToolCall.vue` → `./ChatMessageBubblePartToolCall.vue`
  - `./MessageBubblePartToolResult.vue` → `./ChatMessageBubblePartToolResult.vue`

- [ ] **Step 2: 更新 BChat/index.vue 的 MessageBubble 导入**

将：
```typescript
import MessageBubble from './components/MessageBubble.vue';
```

改为：
```typescript
import MessageBubble from '@/components/BChatSidebar/components/ChatMessageBubble.vue';
```

- [ ] **Step 3: 删除原文件**

删除 `src/components/BChat/components/MessageBubble.vue`

---

## Task 3: 创建 ChatMessageBubblePartText.vue

**Files:**
- Create: `src/components/BChatSidebar/components/ChatMessageBubblePartText.vue`
- Delete: `src/components/BChat/components/MessageBubblePartText.vue`

- [ ] **Step 1: 创建 ChatMessageBubblePartText.vue**

- `defineOptions({ name: 'ChatMessageBubblePartText' })` 改名

- [ ] **Step 2: 删除原文件**

---

## Task 4: 创建 ChatMessageBubblePartThinking.vue

**Files:**
- Create: `src/components/BChatSidebar/components/ChatMessageBubblePartThinking.vue`
- Delete: `src/components/BChat/components/MessageBubblePartThinking.vue`

- [ ] **Step 1: 创建 ChatMessageBubblePartThinking.vue**

- `defineOptions({ name: 'ChatMessageBubblePartThinking' })` 改名

- [ ] **Step 2: 删除原文件**

---

## Task 5: 创建 ChatMessageBubblePartToolCall.vue

**Files:**
- Create: `src/components/BChatSidebar/components/ChatMessageBubblePartToolCall.vue`
- Delete: `src/components/BChat/components/MessageBubblePartToolCall.vue`

- [ ] **Step 1: 创建 ChatMessageBubblePartToolCall.vue**

- `defineOptions({ name: 'ChatMessageBubblePartToolCall' })` 改名
- 导入路径 `../utils/messagePart` 保持不变（等 utils 迁移后自动生效）

- [ ] **Step 2: 删除原文件**

---

## Task 6: 创建 ChatMessageBubblePartToolResult.vue

**Files:**
- Create: `src/components/BChatSidebar/components/ChatMessageBubblePartToolResult.vue`
- Delete: `src/components/BChat/components/MessageBubblePartToolResult.vue`

- [ ] **Step 1: 创建 ChatMessageBubblePartToolResult.vue**

- `defineOptions({ name: 'ChatMessageBubblePartToolResult' })` 改名

- [ ] **Step 2: 删除原文件**

---

## Task 7: 创建 ChatConfirmationCard.vue

**Files:**
- Create: `src/components/BChatSidebar/components/ChatConfirmationCard.vue`
- Delete: `src/components/BChat/components/ConfirmationCard.vue`

- [ ] **Step 1: 创建 ChatConfirmationCard.vue**

- `defineOptions({ name: 'ChatConfirmationCard' })` 改名
- 导入路径 `../utils/confirmationCard` 保持不变（等 utils 迁移后自动生效）

- [ ] **Step 2: 删除原文件**

---

## Task 8: 创建 ChatAskUserChoiceCard.vue

**Files:**
- Create: `src/components/BChatSidebar/components/ChatAskUserChoiceCard.vue`
- Delete: `src/components/BChat/components/AskUserChoiceCard.vue`

- [ ] **Step 1: 创建 ChatAskUserChoiceCard.vue**

- 无 `defineOptions` 需要改名（该文件没有）
- 导入路径无需修改（无内部组件依赖）

- [ ] **Step 2: 删除原文件**

---

## Task 9: 创建 ChatToBottomButton.vue

**Files:**
- Create: `src/components/BChatSidebar/components/ChatToBottomButton.vue`
- Delete: `src/components/BChat/components/ToBottomButton.vue`

- [ ] **Step 1: 创建 ChatToBottomButton.vue**

内容与原文件完全相同（无组件名依赖）

- [ ] **Step 2: 删除原文件**

---

## Task 10: 迁移 Utils 到 BChatSidebar/utils

**Files:**
- Create: `src/components/BChatSidebar/utils/confirmationCard.ts`
- Create: `src/components/BChatSidebar/utils/fileReferenceContext.ts`
- Create: `src/components/BChatSidebar/utils/messagePart.ts`
- Create: `src/components/BChatSidebar/utils/toolCallTracker.ts`
- Create: `src/components/BChatSidebar/utils/toolLoopGuard.ts`
- Modify: `src/components/BChat/index.vue` (更新 utils 导入路径)
- Delete: `src/components/BChat/utils/` (5 files)

- [ ] **Step 1: 迁移 confirmationCard.ts**

直接复制到 `src/components/BChatSidebar/utils/confirmationCard.ts`

- [ ] **Step 2: 迁移 fileReferenceContext.ts**

直接复制，注意其导入的 `Message` 类型来自 `../types`，迁移后路径不变

- [ ] **Step 3: 迁移 messagePart.ts**

直接复制

- [ ] **Step 4: 迁移 toolCallTracker.ts**

直接复制

- [ ] **Step 5: 迁移 toolLoopGuard.ts**

直接复制

- [ ] **Step 6: 更新 BChat/index.vue 中的 utils 导入**

将：
```typescript
import { buildModelReadyMessages } from './utils/fileReferenceContext';
import { createToolCallTracker, type ToolCallTracker } from './utils/toolCallTracker';
import { createToolLoopGuard, type ToolLoopGuard } from './utils/toolLoopGuard';
```

改为：
```typescript
import { buildModelReadyMessages } from '@/components/BChatSidebar/utils/fileReferenceContext';
import { createToolCallTracker, type ToolCallTracker } from '@/components/BChatSidebar/utils/toolCallTracker';
import { createToolLoopGuard, type ToolLoopGuard } from '@/components/BChatSidebar/utils/toolLoopGuard';
```

- [ ] **Step 7: 删除原 utils 目录**

删除 `src/components/BChat/utils/` 整个目录

---

## Task 11: 验证构建

**Files:**
- Check: `src/components/BChat/index.vue`
- Check: `src/components/BChatSidebar/index.vue`

- [ ] **Step 1: 运行 TypeScript 检查**

```bash
npm run typecheck
```

预期：无错误

- [ ] **Step 2: 运行 ESLint 检查**

```bash
npm run lint
```

预期：无错误

- [ ] **Step 3: 确认功能正常**

检查是否有运行时错误

---

## 执行顺序

1. Task 1-9: 按顺序创建新组件文件并删除旧文件
2. Task 10: 迁移 utils
3. Task 11: 验证构建

建议每个 Task 完成一个组件的完整迁移（创建→更新导入→删除），确保每步可独立验证。
