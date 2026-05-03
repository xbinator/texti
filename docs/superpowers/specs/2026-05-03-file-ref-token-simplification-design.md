# file-ref Token 格式简化设计

## 背景

当前 `{{file-ref:...}}` token 格式对大模型不够直观，需要额外解释才能理解。本设计将 token 格式简化为 `@fileName:行号` 形式，同时通过引用索引块提供 documentId 映射，让模型能够调用 `read_file` 工具查询文件内容。

## 目标

1. **模型友好**：token 格式直观易懂，无需额外解释
2. **工具兼容**：模型能通过引用索引块获取 documentId，调用现有 `read_file` 工具
3. **同名区分**：引用索引块提供完整路径，区分同名文件
4. **向后兼容**：过渡期支持解析旧格式 token

## Token 格式

### 新格式

| 场景 | 格式 | 示例 |
|------|------|------|
| 有行号范围 | `@fileName:startLine-endLine` | `@foo.ts:3-5` |
| 单行 | `@fileName:line` | `@foo.ts:3` |
| 无行号 | `@fileName` | `@foo.ts` |

### 旧格式（兼容）

```
{{file-ref:documentId|fileName|startLine|endLine}}
```

### 对比

| 项目 | 旧格式 | 新格式 |
|------|--------|--------|
| 有行号 | `{{file-ref:doc-1\|foo.ts\|3\|5}}` | `@foo.ts:3-5` |
| 无行号 | `{{file-ref:doc-1\|foo.ts\|0\|0}}` | `@foo.ts` |
| 单行 | `{{file-ref:doc-1\|foo.ts\|3\|3}}` | `@foo.ts:3` |

## 引用索引块

发送给模型时，在消息末尾附加引用索引块，提供 documentId 映射：

```
---
File References:
- [doc-1] src/utils/foo.ts (lines 3-5)
- [doc-2] config/bar.md (unsaved, lines 10-20)
- [doc-3] README.md
```

### 格式规则

| 字段 | 说明 |
|------|------|
| `[documentId]` | 用于调用 `read_file` 工具 |
| 路径 | 完整路径，未保存文件显示文件名并标注 `(unsaved)` |
| 行号 | 有行号时显示 `(lines start-end)` 或 `(line n)`，无行号时省略 |

### 模型调用示例

```
用户: @foo.ts:3-5 这段代码有问题

模型: 我来看看这个文件的内容
→ 调用 read_file({ documentId: "doc-1", offset: 3, limit: 3 })
```

## 底层数据结构

数据结构保持不变，仅修改 token 格式：

```typescript
interface ChatMessageFileReference {
  id: string;           // documentId，用于 read_file 工具
  token: string;        // 新格式: "@foo.ts:3-5"
  documentId: string;   // 文档 ID
  fileName: string;     // 文件名
  line: string;         // 格式化行号（"3" 或 "3-5" 或 ""）
  path: string | null;  // 完整路径，未保存文件为 null
  snapshotId: string;   // 快照 ID
}
```

## 解析逻辑

### 新格式解析

```typescript
const NEW_TOKEN_RE = /@([^\s:]+)(?::(\d+)(?:-(\d+))?)?/g;
```

匹配规则：
- `@foo.ts:3-5` → fileName=`foo.ts`, startLine=3, endLine=5
- `@foo.ts:3` → fileName=`foo.ts`, startLine=3, endLine=3
- `@foo.ts` → fileName=`foo.ts`, startLine=0, endLine=0

### 旧格式兼容

过渡期保留旧格式解析：

```typescript
const OLD_TOKEN_RE = /\{\{file-ref:([^|}]+)\|([^|}]+)\|(\d+)(?:\|(\d+))?\}\}/g;
```

## 涉及修改的文件

| 文件 | 修改内容 |
|------|----------|
| `src/components/BChatSidebar/hooks/useFileReference.ts` | 生成新格式 token |
| `src/components/BChatSidebar/utils/chipResolver.ts` | 解析新格式 token，兼容旧格式 |
| `src/components/BChatSidebar/utils/messageHelper.ts` | 转换 token 为引用索引块 |
| `src/components/BChatSidebar/utils/fileReferenceContext.ts` | 构建引用索引块格式 |
| `src/components/BChatSidebar/components/MessageBubble/BubblePartText.vue` | 渲染新格式 token |
| 测试文件 | 更新测试用例 |

## 实现步骤

1. **修改 token 生成**：`useFileReference.ts` 中 `onPasteFiles` 和 `insertReference` 函数
2. **修改 token 解析**：`chipResolver.ts` 支持新格式解析，保留旧格式兼容
3. **修改消息处理**：`messageHelper.ts` 中 `buildMessagePartsFromDraft` 函数
4. **修改引用索引块**：`fileReferenceContext.ts` 中 `buildReferenceIndexBlock` 函数
5. **修改渲染逻辑**：`BubblePartText.vue` 中 token 正则匹配
6. **更新测试**：所有相关测试文件

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 旧消息兼容 | 保留旧格式解析逻辑 |
| 同名文件混淆 | 引用索引块提供完整路径 |
| 文件名含特殊字符 | 文件名中不含空格和冒号时可正常解析，否则需要转义 |

## 后续优化

1. **内容预览**：在引用索引块中包含文件内容片段
2. **智能摘要**：大文件自动生成摘要而非完整内容
3. **多语言支持**：引用索引块支持中文等语言
