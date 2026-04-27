# file-ref 令牌内联替换方案

## 背景

当用户在编辑器中选择文件内容并引用到聊天输入框时，系统会生成 `{{file-ref:...}}` 令牌嵌入到用户消息文本中。目前发送给 AI 模型时，该令牌原样保留，实际的文件内容被**追加**到消息末尾。模型看到的是脱离上下文的引用块，无法理解令牌与周围文本的语义关联。

本方案将 `{{file-ref:...}}` 令牌替换为真实的文件内容片段，嵌入在令牌原本所在的位置，使模型能准确理解引用内容与用户提示的上下文关系。

---

## 现状分析

### 1. 令牌格式

```
{{file-ref:referenceId|fileName|startLine|endLine}}
```

- `referenceId`：稳定的引用 ID（对应 `ChatMessageFileReference.id`）
- `fileName`：文件名
- `startLine`：起始行号（0 表示无行号）
- `endLine`：结束行号

**示例**：
```
{{file-ref:EoBFgefXhWEPqfH0W63bo|未命名|3|3}}
```

### 2. 核心数据结构

```typescript
// types/chat.d.ts:25
interface ChatMessageFileReference {
  id: string;           // 匹配令牌中的 referenceId
  token: string;        // 完整令牌原文 "{{file-ref:...}}"
  documentId: string;   // 文档 ID
  fileName: string;     // 文件名
  line: string;         // 格式化行号（"3" 或 "3-5"）
  path: string | null;  // 文件路径
  snapshotId: string;   // 对应 ChatReferenceSnapshot.id，快照未生成时为空字符串 ""
}

// types/chat.d.ts:47
interface ChatReferenceSnapshot {
  id: string;           // 快照 ID
  documentId: string;   // 文档 ID
  title: string;        // 文档标题
  content: string;      // 快照时的全文内容
  createdAt: string;    // 创建时间
}
```

### 3. 当前数据流

```
用户引用文件
    ↓
handleChatInsertFileReference (index.vue:379)
    ├── 生成 token: "{{file-ref:...}}"
    ├── 插入编辑器文本
    └── 加入 draftReferences（snapshotId 为空）
    ↓
用户点击发送 → handleChatSubmit (index.vue:320)
    ├── getActiveDraftReferences：过滤出 content 中仍存在的引用
    ├── create.userMessage(content, references)
    ├── handleBeforeSend → persistReferenceSnapshots
    │     ├── 创建 ChatReferenceSnapshot（保存全文到 SQLite）
    │     ├── 填充 references[].snapshotId ← snapshot.id
    │     └── 持久化到 chatStorage
    └── chatStream.streamMessages(messages, config)
          ↓
      handleStreamMessages (useChatStream.ts:285)
          ├── loadReferenceSnapshotMap：按 snapshotId 批量查 SQLite
          └── buildModelReadyMessages(sourceMessages, snapshotsById)
                │
                ▼  【当前行为】尾部追加
                将文件内容块拼接到 message.content 末尾
```

### 4. 当前 buildModelReadyMessages 行为

```typescript
// fileReferenceContext.ts:65 — 当前实现
export function buildModelReadyMessages(sourceMessages, snapshotsById) {
  return sourceMessages.map((message) => {
    if (message.role !== 'user' || isEmpty(message.references)) return message;

    // 按 snapshotId 分组
    const collection = groupBy(message.references, (ref) => ref.snapshotId);

    // 为每组构建上下文块
    const contextBlocks = flatMap(collection, (references, snapshotId) => {
      const snapshot = snapshotsById.get(snapshotId);
      return snapshot ? [buildReferenceContextBlock(snapshot, references)] : [];
    });

    // 尾部追加
    const modelContent = join([message.content, ...contextBlocks], '\n\n');
    return { ...message, content: modelContent, parts: [{ type: 'text', text: modelContent }] };
  });
}
```

**问题**：
- 模型看到的用户消息为：`"帮我分析一下 {{file-ref:xxx|foo.ts|3|3}} 这个函数\n\n引用文件：foo.ts\n引用行：3\n全文内容：..."` 
- 令牌和文件内容在空间上分离，模型难以将 `{{file-ref:...}}` 与后面的引用块关联

---

## 修改方案

### 整体思路

在 `buildModelReadyMessages` 中，不再在**尾部追加**引用块，而是用正则匹配 `{{file-ref:...}}` 令牌，将每个令牌**原位替换**为对应的文件内容片段。

**关键设计决策**：

1. **每个 token 只用自己的行号**（不用 `groupBy` 合并）
   - 尾部追加时代码用 `groupBy` 合并同一文件的多个引用行号（如 `引用行：3、10`），这在追加到消息末尾时没有问题
   - 但内联替换后，合并行号会与 token 在消息中的实际位置产生语义矛盾：第 3 行的 token 被替换成显示 `引用行：3、10` 的内容，模型无法判断这到底指向第 3 行还是第 10 行
   - **新方案**：`buildReferenceContextBlock(snapshot, [reference])` 始终只传当前 token 的单条引用，每个 token 的引用块只展示它自身的行号

2. **同文件多引用：首次完整 + 后续简洁**
   - 首个同文件 token → 替换为完整引用块（仅该 token 的行号）
   - 后续同文件 token → 替换为简洁标注 `[引用：fileName 第N行]`
   - 避免重复展开大段文件内容，同时让模型能区分每个 token 对应的具体行号

3. **标注语义：使用"引用"而非"同上"**
   - `[引用：...]` 是中性的引用声明，不暗示"内容在上面"，避免两处引用行号相差过大时（如第 3 行和第 500 行）"同上"无法兑现的问题
   - 后续 token 的简洁标注不依赖首次完整块的内容，语义上自洽

4. **换行策略**：替换块前后各加一个 `\n`，保证排版整洁

5. **路径暴露**：`buildReferenceContextBlock` 内部使用了 `reference.path`（完整路径），这是已有行为不做改动。本方案新增的简洁标注仅使用 `reference.fileName`（文件名），不暴露本地绝对路径

6. **i18n**：`[引用：...]` 和 `buildReferenceContextBlock` 中的中文均为硬编码，标注 `// TODO: i18n` 便于后续统一处理

### 修改范围

仅需修改 **1 个文件**：
- `src/components/BChatSidebar/utils/fileReferenceContext.ts`

### 修改前后对比

**修改前**（当前行为）：
```
帮我分析一下 {{file-ref:abc|foo.ts|3|3}} 这个函数的逻辑

引用文件：foo.ts
引用行：3
全文内容：
function hello() {
  console.log("world");
}
...
```

**修改后**（目标行为）：
```
帮我分析一下 
引用文件：foo.ts
引用行：3
全文内容：
function hello() {
  console.log("world");
}
...
 这个函数的逻辑
```

> **关于 token 前后可能出现孤立空格**：原始 token 被替换为多行文本后，token 前的空格可能成为行首孤立的缩进空白。这在渲染时对模型理解文本无实质影响，不做额外处理。

**同文件多引用示例**（引用 foo.ts 第 3 行和第 10 行）：
```
用户输入：帮我查一下 {{file-ref:abc|foo.ts|3|3}} 和 {{file-ref:def|foo.ts|10|10}} 的关系

替换后：
帮我查一下 
引用文件：foo.ts
引用行：3
全文内容：
function hello() {
  console.log("world");
}
...
 和 [引用：foo.ts 第10行] 的关系
```

---

## 实现细节

### 完整实现

```typescript
export function buildModelReadyMessages(
  sourceMessages: Message[],
  snapshotsById: Map<string, ChatReferenceSnapshot>
): Message[] {
  return sourceMessages.map((message) => {
    if (message.role !== 'user' || isEmpty(message.references)) return message;

    // 构建 referenceId → ChatMessageFileReference 的快速查找映射
    const referenceById = new Map(
      message.references.map((ref) => [ref.id, ref])
    );

    // 追踪已完成首次替换的 snapshotId，用于同文件后续 token 的简洁标注
    const replacedSnapshotIds = new Set<string>();

    // 每次调用 replace 前创建新的正则实例，避免 /g 标志的 lastIndex 陷阱
    // 正则采用宽松匹配（三个可选管道段），兼容完整和不完整的 token 格式
    // 这是有意为之的设计：未来 token 格式可能变化，宽松匹配确保向后兼容
    const regex = new RegExp(
      '\\{\\{file-ref:([A-Za-z0-9_-]+)(?:\\|[^|}]*)?(?:\\|[^|}]*)?(?:\\|[^|}]*)?\\}\\}',
      'g'
    );

    const modelContent = message.content.replace(regex, (match, referenceId) => {
      const reference = referenceById.get(referenceId);

      // 引用记录不存在（如用户手动删除了引用但内容里还有 token），
      // 或快照尚未生成（snapshotId 为空字符串 ""），均保留原文
      if (!reference || !reference.snapshotId) return match;

      const snapshot = snapshotsById.get(reference.snapshotId);

      // 快照未加载（如存储已清理），保留原文
      if (!snapshot) return match;

      // 同文件首次出现：替换为完整内容块，仅使用当前 token 的行号
      if (!replacedSnapshotIds.has(reference.snapshotId)) {
        replacedSnapshotIds.add(reference.snapshotId);
        const context = buildReferenceContextBlock(snapshot, [reference]);
        return `\n${context}\n`;
      }

      // 后续出现：简洁标注，避免重复内容块，同时让模型能区分具体行号
      // TODO: i18n — 中文硬编码，后续国际化时需抽取为资源字符串
      const lineLabel = reference.line ? ` 第${reference.line}行` : '';
      return `[引用：${reference.fileName}${lineLabel}]`;
    });

    // 内容无变化，直接返回原始消息
    if (modelContent === message.content) return message;

    return {
      ...message,
      content: modelContent,
      parts: [{ type: 'text', text: modelContent }]
    };
  });
}
```

### 关键逻辑详解

#### 每个 token 只用自己的行号（不再用 groupBy 合并）

旧代码中 `groupBy` 将同一文件的多个引用合并为一组，传给 `buildReferenceContextBlock(snapshot, [ref1, ref2])`，引用块头部显示 `引用行：3、10`。

新方案下，`buildReferenceContextBlock(snapshot, [reference])` 每次只传当前 token 的单条引用，行号头部只显示该 token 自身的行号（`引用行：3` 或 `引用行：10`）。这样引用块出现在消息中哪个位置，行号就对应哪个 token，语义一致。

#### 同文件多引用的"首次完整 + 后续简洁"策略

```
消息 token 顺序 → replace 回调按序触发

第 1 个 foo.ts token（第3行） → replacedSnapshotIds 不含 → 输出完整块（仅第3行行号），加入 Set
第 2 个 foo.ts token（第10行）→ replacedSnapshotIds 已含 → 输出 [引用：foo.ts 第10行]
第 1 个 bar.ts token（第5行）  → replacedSnapshotIds 不含 → 输出完整块（仅第5行行号），加入 Set
```

#### `[引用：...]` 标注语义说明

相比早期版本使用的 `[同上：...]`，`[引用：...]` 不隐含"内容在上方"的前置条件。当两处引用行号相差较大时（例如一条消息中同时引用 `foo.ts` 第 3 行和第 500 行），首次完整块的附近片段（±120 行）可能不包含第 500 行的内容。使用 `[引用：...]` 不会给模型一个无法兑现的暗示。

> **未来可选优化**：若实测发现行号距离过大场景频繁出现，可改为在后续 token 处独立展示局部片段（而非简洁标注），或增加行号范围检测来决定输出格式。

#### 简洁标注格式

仅使用 `reference.fileName`，不暴露 `reference.path` 完整绝对路径：

| 引用行号 | 输出 |
|---|---|
| 有行号 | `[引用：foo.ts 第10行]` |
| 无行号（line=""） | `[引用：foo.ts]` |

### buildReferenceContextBlock 行为不变

该函数继续按三档策略生成引用内容：

| 文件行数 | 策略 |
|---|---|
| ≤ 200 行 | 全文内容 |
| ≤ 800 行 | 引用行 ±120 行的附近片段 |
| > 800 行 | 文档概述 + 附近片段 |

### 兜底策略

| 场景 | 处理 | 说明 |
|---|---|---|
| 令牌中的 referenceId 不在 references 中 | 保留原令牌 | 用户可能手动编辑了消息删除引用但未删除 token |
| 引用没有 snapshotId（空字符串 `""`） | 保留原令牌 | 快照尚未持久化生成，极少数竞态场景 |
| snapshotId 对应的快照不存在 | 保留原令牌 | 存储清理或数据不一致 |
| message.references 为空 | 直接返回原消息 | 无需处理 |
| 内容无任何变化 | 返回原始 message 对象 | 避免不必要的对象拷贝 |

### 边界说明

- **`snapshotId` 初始为空字符串而非 `undefined`**：类型定义中 `snapshotId: string` 非可选，初始值为 `""`。`!reference.snapshotId` 能同时命中 `""` 和 `undefined`，不会误替换，需在测试中显式覆盖

---

## 代码清理

### 保留的 import

- `isEmpty` — 空引用判断
- `join` — `buildDocumentOverview`（第 35 行）中用于拼接文档概览行，本次未修改该函数
- `compact` — `buildReferenceContextBlock` 内部使用
- `min`, `max` — `buildReferenceContextBlock` 内部使用

### 移除的 import

- `groupBy` — 新方案中每个 token 使用自身行号，不再需要按 snapshotId 分组合并
- `flatMap` — 同上述原因

### 不再使用的代码

- 原 `buildModelReadyMessages` 内的 `join([message.content, ...contextBlocks], '\n\n')` — 尾部追加逻辑移除

---

## 测试要点

### 现有测试文件
`test/components/BChat/file-reference-context.test.ts`

### 需要验证的场景

1. **单令牌替换**：一条消息中有一个 `{{file-ref:...}}`，替换为对应文件内容，行号与 token 一致
2. **同文件多引用 — 首次完整块行号**：首个 token 替换为完整引用块，`buildReferenceContextBlock` 收到的引用数组仅含当前 token（长度=1），行号头部只显示该 token 的行号（如 `引用行：3`），不包含同一文件其他 token 的行号
3. **同文件多引用 — 后续简洁标注**：同一文件的后续 token 替换为 `[引用：...]` 标注，标注中的行号取自该 token 自身的 `reference.line` 字段（区别于场景 2 的完整块行号）
4. **不同文件多引用**：多个 token 指向不同文件，每个文件首次 token 替换为各自完整块，行号各自独立
5. **无令牌消息**：普通纯文本消息不受影响
6. **空引用列表**：`message.references` 为空时直接返回原消息
7. **令牌不在 references 中**：保留原令牌
8. **snapshotId 为空字符串 `""`**：保留原令牌（快照未生成），验证不会被错误匹配
9. **快照不存在**（snapshotId 有效但 Map 中无对应快照）：保留原令牌
10. **大文件三档策略**（回归验证）：确认内联替换不影响已有函数行为——≤200 行全文、≤800 行片段、>800 行概述+片段
11. **行号透传 — buildReferenceContextBlock**（回归验证）：确认 `reference.line` 字段（"3" 或 "3-5" 格式）正确传递并被 `parseLineRange` 解析为行范围，进而影响附近片段的裁剪
12. **行号输出 — 简洁标注**：验证后续 token 的 `[引用：...]` 标注中，`reference.line` 字段按预期格式输出（区别于场景 11 的解析行为，这是纯字符串拼接）
13. **简洁标注不暴露完整路径**：验证标注中仅使用 `reference.fileName`，不出现 `reference.path` 的绝对路径内容
