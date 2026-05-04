# BubblePartUserInput 组件拆分实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 BubblePartText.vue 拆分为 BubblePartUserInput.vue 和简化后的 BubblePartText.vue，实现职责分离。

**Architecture:** 创建新的 BubblePartUserInput 组件专门处理用户输入渲染（文件引用标签解析），简化 BubblePartText 组件只处理助手消息的 Markdown 渲染。

**Tech Stack:** Vue 3 Composition API, TypeScript

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/components/BChatSidebar/components/MessageBubble/BubblePartUserInput.vue` | 创建 | 用户输入渲染（文件引用标签） |
| `src/components/BChatSidebar/components/MessageBubble/BubblePartText.vue` | 修改 | 简化为只处理助手消息 |
| `src/components/BChatSidebar/components/MessageBubble.vue` | 修改 | 更新调用方式 |

---

### Task 1: 创建 BubblePartUserInput 组件

**Files:**
- Create: `src/components/BChatSidebar/components/MessageBubble/BubblePartUserInput.vue`

- [ ] **Step 1: 创建 BubblePartUserInput.vue 文件**

```vue
<template>
  <div :class="bem()">
    <div :class="bem('text')">
      <template v-for="(segment, index) in segments" :key="`${segment.type}-${index}`">
        <span v-if="segment.type === 'text'">{{ segment.text }}</span>
        <span v-else :class="bem('tag')" data-value="file-reference">
          {{ segment.label }}
        </span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file BubblePartUserInput.vue
 * @description 渲染用户输入消息，处理文件引用标签解析和显示。
 */
import type { ChatMessageFileReferencePart, ChatMessageTextPart } from 'types/chat';
import { computed } from 'vue';
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'BubblePartUserInput' });

/**
 * 用户气泡内的可渲染文本片段。
 */
interface TextDisplaySegment {
  /** 片段类型标识 */
  type: 'text';
  /** 纯文本内容 */
  text: string;
}

/**
 * 用户气泡内的可渲染文件引用标签片段。
 */
interface FileReferenceDisplaySegment {
  /** 片段类型标识 */
  type: 'file-reference';
  /** 展示给用户的标签文本 */
  label: string;
}

/**
 * 气泡文本渲染片段的联合类型。
 */
type MessageBubbleTextSegment = TextDisplaySegment | FileReferenceDisplaySegment;

interface Props {
  /** 要渲染的消息片段 */
  part: ChatMessageTextPart | ChatMessageFileReferencePart;
}

const props = defineProps<Props>();

const FILE_REFERENCE_TOKEN_PATTERN = /\{\{@([^\s:}]+)(?::(\d+)(?:-(\d+))?)?\}\}/g;

const [, bem] = createNamespace('', 'message-bubble-user-input');

/**
 * 将原始文本拆分为纯文本和文件引用标签片段。
 */
const segments = computed<MessageBubbleTextSegment[]>(() => {
  if (props.part.type === 'file-reference') {
    const lineLabel = props.part.startLine > 0 ? `${props.part.startLine}${props.part.endLine > props.part.startLine ? `-${props.part.endLine}` : ''}` : '';

    return [{ type: 'file-reference', label: lineLabel ? `${props.part.fileName}:${lineLabel}` : props.part.fileName }];
  }

  const textPart = props.part as ChatMessageTextPart;
  const parts: MessageBubbleTextSegment[] = [];
  let lastIndex = 0;

  textPart.text.replace(FILE_REFERENCE_TOKEN_PATTERN, (match: string, fileName?: string, start?: string, end?: string, offset?: number) => {
    if (offset !== undefined && offset > lastIndex) {
      parts.push({ type: 'text', text: textPart.text.slice(lastIndex, offset) });
    }

    if (fileName) {
      const startLine = start ? Number(start) : 0;
      const endLine = end ? Number(end) : startLine;
      let lineLabel = '';
      if (startLine > 0) {
        lineLabel = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;
      }
      parts.push({ type: 'file-reference', label: lineLabel ? `${fileName}:${lineLabel}` : fileName });
    }

    lastIndex = offset !== undefined ? offset + match.length : lastIndex;
    return match;
  });

  if (lastIndex < textPart.text.length) {
    parts.push({ type: 'text', text: textPart.text.slice(lastIndex) });
  }

  if (!parts.length) {
    parts.push({ type: 'text', text: textPart.text });
  }

  return parts;
});
</script>

<style scoped lang="less">
.message-bubble-user-input {
  white-space: pre-wrap;
  word-break: break-word;
}

.message-bubble-user-input__tag {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  font-size: 12px;
  line-height: 20px;
  color: var(--text-primary);
  border: 1px solid var(--border-secondary);
  border-radius: 4px;
}
</style>
```

- [ ] **Step 2: 验证文件创建成功**

Run: `ls -la src/components/BChatSidebar/components/MessageBubble/BubblePartUserInput.vue`
Expected: 文件存在

---

### Task 2: 简化 BubblePartText 组件

**Files:**
- Modify: `src/components/BChatSidebar/components/MessageBubble/BubblePartText.vue`

- [ ] **Step 1: 简化 BubblePartText.vue，移除用户输入相关逻辑**

```vue
<template>
  <div :class="bem({ error: isErrorMessage })">
    <BMessage :content="'text' in part ? part.text : ''" type="markdown" />
  </div>
</template>

<script setup lang="ts">
/**
 * @file BubblePartText.vue
 * @description 在消息气泡中渲染助手文本片段，使用 Markdown 格式。
 */
import type { ChatMessageErrorPart, ChatMessageTextPart } from 'types/chat';
import { computed } from 'vue';
import BMessage from '@/components/BMessage/index.vue';
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'BubblePartText' });

interface Props {
  /** 要渲染的文本片段 */
  part: ChatMessageTextPart | ChatMessageErrorPart;
}

const props = defineProps<Props>();

const [, bem] = createNamespace('', 'message-bubble-text');

const isErrorMessage = computed(() => props.part.type === 'error');
</script>

<style scoped lang="less">
.message-bubble-text--error {
  padding: 10px 14px;
  font-size: 12px;
  color: var(--color-error);
  background: var(--color-error-bg);
  border: 1px solid var(--color-error);
  border-radius: 8px;
}
</style>
```

- [ ] **Step 2: 验证文件修改成功**

Run: `cat src/components/BChatSidebar/components/MessageBubble/BubblePartText.vue | head -20`
Expected: 文件内容已更新，不包含 `enableFileReferenceChips`

---

### Task 3: 更新 MessageBubble.vue 调用方式

**Files:**
- Modify: `src/components/BChatSidebar/components/MessageBubble.vue`

- [ ] **Step 1: 添加 BubblePartUserInput 组件导入**

在 `<script setup>` 部分的导入区域添加：

```typescript
import BubblePartUserInput from './MessageBubble/BubblePartUserInput.vue';
```

- [ ] **Step 2: 添加类型守卫函数**

在 `<script setup>` 部分添加类型守卫函数：

```typescript
/**
 * 判断片段是否为文本或文件引用类型（用户消息）。
 * @param part - 消息片段
 */
function isTextOrFileReference(part: ChatMessagePart): part is ChatMessageTextPart | ChatMessageFileReferencePart {
  return part.type === 'text' || part.type === 'file-reference';
}

/**
 * 判断片段是否为文本或错误类型（助手消息）。
 * @param part - 消息片段
 */
function isTextOrError(part: ChatMessagePart): part is ChatMessageTextPart | ChatMessageErrorPart {
  return part.type === 'text' || part.type === 'error';
}
```

- [ ] **Step 3: 更新模板中的条件渲染逻辑**

将原来的：

```vue
<BubblePartText
  v-if="item.type === 'text' || item.type === 'error' || item.type === 'file-reference'"
  :part="item"
  :enable-file-reference-chips="isUserMessage"
/>
```

替换为：

```vue
<BubblePartUserInput
  v-if="isUserMessage && isTextOrFileReference(item)"
  :part="item"
/>

<BubblePartText
  v-else-if="!isUserMessage && isTextOrError(item)"
  :part="item"
/>
```

- [ ] **Step 4: 验证类型检查通过**

Run: `npm run typecheck`
Expected: 无类型错误

---

### Task 4: 提交变更

- [ ] **Step 1: 提交所有变更**

```bash
git add src/components/BChatSidebar/components/MessageBubble/BubblePartUserInput.vue
git add src/components/BChatSidebar/components/MessageBubble/BubblePartText.vue
git add src/components/BChatSidebar/components/MessageBubble.vue
git commit -m "refactor: split BubblePartText into BubblePartUserInput and BubblePartText"
```

- [ ] **Step 2: 验证提交成功**

Run: `git log -1 --oneline`
Expected: 显示最新提交记录
