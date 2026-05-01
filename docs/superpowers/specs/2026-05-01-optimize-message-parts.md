# 优化建议：BChatSidebar 消息 parts 处理

## 问题定位

**文件**: `src/components/BChatSidebar/index.vue#L318-323`

**当前代码**:
```typescript
const nextMessage = create.userMessage(content, references);
nextMessage.content = content;
nextMessage.parts = [{ type: 'text', text: nextMessage.content }];
if (images.length && supportsVision.value) {
  nextMessage.files = [...images];
}
```

## 问题分析

### 1. 重复设置
- `create.userMessage()` 内部已设置 `content` 和 `parts`
- 外部又重复赋值了一遍

### 2. 空内容问题
- 当 `content` 为空字符串时，仍创建 `{ type: 'text', text: '' }` 的空 part
- 应该只在有内容时才添加到 `parts`

## 优化方案

### 方案 A：修改调用处（改动范围小）

**文件**: `src/components/BChatSidebar/index.vue`

```typescript
const nextMessage = create.userMessage(content, references);
// 只有有内容时才设置 parts
if (content) {
  nextMessage.parts = [{ type: 'text', text: content }];
} else {
  nextMessage.parts = [];
}
if (images.length && supportsVision.value) {
  nextMessage.files = [...images];
}
```

**优点**: 改动范围小，风险低
**缺点**: 需要手动处理，其他调用处可能也有类似问题

### 方案 B：修改源头（推荐）

**文件**: `src/components/BChatSidebar/utils/messageHelper.ts`

```typescript
// 创建用户消息
userMessage(content: string, references?: Message['references']): Message {
  const parts = content ? [{ type: 'text', text: content }] : [];
  return createBase({ role: 'user', content, references, parts, finished: true });
}
```

**文件**: `src/components/BChatSidebar/index.vue`

```typescript
const nextMessage = create.userMessage(content, references);
// 移除重复的 content 和 parts 设置
if (images.length && supportsVision.value) {
  nextMessage.files = [...images];
}
```

**优点**: 从源头解决问题，所有调用处自动受益
**缺点**: 需要确认其他调用点是否依赖原有行为

## 影响范围

需要检查 `create.userMessage` 的其他调用点：
- `src/components/BChatSidebar/index.vue` - 主要调用处

## 建议

推荐 **方案 B**，理由：
1. 从源头统一处理，避免重复代码
2. 语义更清晰：空内容 = 空 parts
3. 后续维护更简单

---

**审核状态**: ✅ 已审核通过并实施（方案 B）
