# File Reference 标记化重构方案

## 目标

将发送给 LLM 的 `{{file-ref:...}}` token 从**内容预展开**方式改为**结构化标记**方式，由 LLM 自主决定是否通过 `read_file` 工具读取文件内容。

## 动机

**现状问题**：
1. `handleStreamMessages` 每次调用都执行 `loadReferenceSnapshotMap`（SQLite 查询）+ `buildModelReadyMessages`（全量 .map() + regex 替换）
2. 工具调用续轮时，快照映射不变，user 消息展开结果也不变，但上述两步仍重复执行
3. `read_file` 工具已存在，但聊天侧边栏未传入 `workspaceRoot`，且不支持 `documentId` 读取

**改后收益**：
- 砍掉 `loadReferenceSnapshotMap` 和 `buildModelReadyMessages` 两个函数
- `handleStreamMessages` 不再有 DB 查询和全量遍历
- 首轮 token 大幅减少（不塞入完整文件内容）
- 文件读取统一走工具系统，架构一致

---

## 一、现状 vs 目标对比

### 发送前处理

```
现状: {{file-ref:id|fileName|3|5}}
  → loadReferenceSnapshotMap → SQLite 查询快照
  → buildModelReadyMessages → 替换为完整文件内容（可能数百行）
  → LLM 收到: "请解释\n\n引用文件: <project>/src/foo.ts\n全文内容:\n...(数百行)..."
  → LLM 直接基于内容回答

目标: {{file-ref:id|fileName|3|5}}
  → convertFileRefTokensToMarkers → 替换为结构化标记
  → LLM 收到: "请解释\n\n[file: <project>/src/foo.ts#L3-L5]"
  → LLM 自己调用 read_file({path: "<project>/src/foo.ts", offset: 3, limit: 3})
  → LLM 基于工具返回的内容回答
```

### 路径来源说明

`reference.path` 的来源是 `useFileReference.ts:96`：
```typescript
filePath: reference.filePath ?? toolContext?.document.path ?? null
```

- `reference.filePath`：来自编辑器的 `ChatFileReferenceInsertPayload`，为**完整绝对路径**
- `toolContext?.document.path`：来自编辑器上下文，也为**绝对路径**

**因此标记中使用的 `reference.path` 始终是绝对路径**（如 `<project>/src/foo.ts`），`read_file` 在无 `workspaceRoot` 时通过绝对路径 + 用户确认即可正常工作。

### 标记格式

`ChatMessageFileReference.line` 字段说明（`types/chat.d.ts`）：
- 有行号时：`"3"` 或 `"3-5"`（字符串）
- **全文件引用时（startLine=0, endLine=0）：`line` 为 `""`（空字符串），不是 `"0"`**

| 场景 | Token（用户可见） | `reference.line` | `reference.path` | 标记（发给 LLM） |
|------|-------------------|-------------------|------------------|------------------|
| 磁盘文件，单行 | `{{file-ref:id\|foo.ts\|3\|3}}` | `"3"` | `<project>/src/foo.ts` | `[file: <project>/src/foo.ts#L3]` |
| 磁盘文件，范围 | `{{file-ref:id\|foo.ts\|3\|5}}` | `"3-5"` | `<project>/src/foo.ts` | `[file: <project>/src/foo.ts#L3-L5]` |
| 磁盘文件，全文件 | `{{file-ref:id\|foo.ts\|0\|0}}` | `""` | `<project>/src/foo.ts` | `[file: <project>/src/foo.ts]` |
| 未保存文件，有行号 | `{{file-ref:id\|unsaved\|3\|5}}` | `"3-5"` | `null` | `[file: id=abc123 name="unsaved" @L3-L5]` |
| 未保存文件，全文件 | `{{file-ref:id\|unsaved\|0\|0}}` | `""` | `null` | `[file: id=abc123 name="unsaved"]` |

规则：
- 有 `path`（绝对路径）→ `[file: <path>#L<start>]` 或 `[file: <path>#L<start>-L<end>]`，全文件省略 `#`
- 无 `path`（未保存文件）→ `[file: id=<documentId> name="<fileName>" @L<start>-L<end>]`，全文件省略 `@`
- 语言无关，`#` 做路径/行号分隔，`@` 做 ID/行号分隔
- LLM 通过 `read_file({path})` 读磁盘文件，通过 `read_file({documentId})` 读未保存文件

> **注意**：标记中暴露绝对路径到 LLM 的消息内容中，可能被 LLM 在回复中引用。当前 `buildModelReadyMessages` 同样存在此问题（快照 header 中包含完整路径），不是新引入的问题。后续可评估是否在标记生成时做路径脱敏。

---

## 二、改动用到的文件

### 修改文件

| 文件 | 改动描述 |
|------|----------|
| `src/components/BChatSidebar/utils/fileReferenceContext.ts` | 新增 `convertFileRefTokensToMarkers`；移除 `buildModelReadyMessages`、`buildReferenceContextBlock`、`buildDocumentOverview` 及三个阈值常量 |
| `src/components/BChatSidebar/hooks/useChatStream.ts` | 移除 `loadReferenceSnapshotMap` 函数及调用；替换为 `convertFileRefTokensToMarkers`；system prompt 注入（仅首轮） |
| `src/ai/tools/builtin/read-file.ts` | 新增 `documentId` 参数 + SQLite 降级 + 工具描述更新 + 提取 `extractLines` 辅助函数 |
| `src/components/BChatSidebar/index.vue` | **不传 `getWorkspaceRoot`**（`reference.path` 已是绝对路径，无 workspaceRoot 时 absolute path + 确认即可工作） |

### 移除的代码

| 函数/常量 | 位置 | 说明 |
|-----------|------|------|
| `loadReferenceSnapshotMap` | useChatStream.ts:270-279 | 不再需要从 SQLite 加载快照展开内容 |
| `buildModelReadyMessages` | fileReferenceContext.ts:72-116 | 替换为 `convertFileRefTokensToMarkers` |
| `buildReferenceContextBlock` | fileReferenceContext.ts:38-63 | 不再需要构建完整引用内容块 |
| `buildDocumentOverview` | fileReferenceContext.ts:33-36 | 不再需要 |
| `CONTEXT_WINDOW_LINES` | fileReferenceContext.ts:11 | 不再需要 |
| `SMALL_DOCUMENT_LINE_THRESHOLD` | fileReferenceContext.ts:9 | 不再需要 |
| `MEDIUM_DOCUMENT_LINE_THRESHOLD` | fileReferenceContext.ts:10 | 不再需要 |

### 保留的代码

| 函数/文件 | 原因 |
|-----------|------|
| `persistReferenceSnapshots` | 职责变为：为 `read_file({documentId})` 提供 SQLite 降级数据源 |
| `parseLineRange` | 标记生成时仍需解析行号范围 |
| `import type { ChatReferenceSnapshot }` | `persistReferenceSnapshots` 仍需要 |

---

## 三、核心实现

### 3.1 `convertFileRefTokensToMarkers` 新增

> **幂等性说明**：标记替换是幂等的——续轮时再次调用不会产生副作用。已替换为 `[file: ...]` 的内容不包含 `{{file-ref:` 前缀，正则不会命中已处理的文本。

```typescript
/**
 * 将消息中的 {{file-ref:...}} token 替换为结构化标记。
 * 不读取文件内容，仅生成语言无关的标记供 LLM 参考。
 *
 * Token 格式: {{file-ref:referenceId|fileName|startLine|endLine}}
 * 标记格式（有 path）: [file: <project>/src/foo.ts#L3-L5]
 * 标记格式（无 path）: [file: id=abc123 name="unsaved" @L3-L5]
 *
 * reference.path 为绝对路径，因此标记中直接使用。
 * 续轮调用时幂等，已替换的文本不会被二次处理。
 */
export function convertFileRefTokensToMarkers(
  sourceMessages: Message[]
): Message[] {
  return sourceMessages.map((message) => {
    if (message.role !== 'user' || isEmpty(message.references)) return message;

    const referenceById = new Map(
      (message.references ?? []).map((ref) => [ref.id, ref])
    );

    const regex = /\{\{file-ref:([A-Za-z0-9_-]+)(?:\|[^|}]*)?(?:\|[^|}]*)?(?:\|[^|}]*)?\}\}/g;

    const modelContent = message.content.replace(regex, (match, referenceId) => {
      const reference = referenceById.get(referenceId);
      if (!reference) return match;

      if (reference.path) {
        // 有磁盘路径（绝对路径）—— [file: <project>/path/to/file.ts#L3-L5]
        const lines = reference.line
          ? `#L${reference.line.replace('-', '-L')}`
          : '';
        return `[file: ${reference.path}${lines}]`;
      }

      // 无磁盘路径（未保存文件）—— [file: id=abc123 name="foo" @L3-L5]
      const lines = reference.line
        ? ` @L${reference.line.replace('-', '-L')}`
        : '';
      return `[file: id=${reference.documentId} name="${reference.fileName}"${lines}]`;
    });

    if (modelContent === message.content) return message;

    // 保留非 text parts（如图片），只更新 text part 的内容
    return {
      ...message,
      content: modelContent,
      parts: message.parts?.map((p) =>
        p.type === 'text' ? { ...p, text: modelContent } : p
      ) ?? [{ type: 'text', text: modelContent }]
    };
  });
}
```

### 3.2 `handleStreamMessages` 简化

移除 `loadReferenceSnapshotMap` 调用，替换 `buildModelReadyMessages` 为 `convertFileRefTokensToMarkers`。

```typescript
async function handleStreamMessages(
  sourceMessages: Message[],
  config: ServiceConfig,
  reuseLastAssistant = false
): Promise<void> {
  loading.value = true;
  lastServiceConfig = config;
  currentToolRoundId += 1;
  currentToolCallTracker = createToolCallTracker();
  handlePrepareAssistantMessage(reuseLastAssistant);

  // 原两行（异步 DB 查询 + 内容展开）→ 简化为一行同步标记替换
  const modelMessages = convertFileRefTokensToMarkers(sourceMessages);
  currentModelMessageCache = convert.toCachedModelMessages(
    modelMessages,
    currentModelMessageCache
  );

  const continuedMessages = [...currentModelMessageCache.modelMessages];
  const transportTools = config.toolSupport.supported && Boolean(tools?.length)
    ? toTransportTools(tools ?? [])
    : undefined;

  // System prompt 引导：仅在首轮注入，续轮时 LLM 已知道如何处理标记
  const isFirstRound = !sourceMessages.some((m) => m.role === 'assistant');
  const hasReferences = sourceMessages.some(
    (m) => m.role === 'user' && m.references?.length
  );
  if (hasReferences && isFirstRound) {
    continuedMessages.unshift({
      role: 'system',
      content:
        '当用户消息中包含 [file: ...] 标记时，表示用户引用了某个文件。' +
        '请使用 read_file 工具读取对应文件内容后再回答。\n' +
        '- 路径格式 [file: /path/to/file.ts#L3-L5]：使用 read_file({path: "/path/to/file.ts", offset: 3, limit: 3})\n' +
        '- 路径格式 [file: /path/to/file.ts]（无行号）：使用 read_file({path: "/path/to/file.ts"})\n' +
        '- ID 格式 [file: id=xxx name="foo" @L3-L5]：使用 read_file({documentId: "xxx", offset: 3, limit: 3})\n' +
        '- ID 格式 [file: id=xxx name="foo"]（无行号）：使用 read_file({documentId: "xxx"})'
    });
  }

  agent.stream({
    messages: continuedMessages,
    modelId: config.modelId,
    providerId: config.providerId,
    tools: transportTools
  });
}
```

移除内容：
- `loadReferenceSnapshotMap` 函数定义（270-279 行）
- `useChatStream` 内部调用处两行替换为一行

### 3.3 `read_file` 工具扩展

#### 3.3.1 参数扩展

```typescript
export interface ReadFileInput {
  /** 文件路径（磁盘文件），与 documentId 二选一 */
  path?: string;
  /** 文档 ID（未保存的编辑器文件），与 path 二选一 */
  documentId?: string;
  /** 起始行号，默认 1 */
  offset?: number;
  /** 读取行数，不传时读取到文件末尾 */
  limit?: number;
}
```

#### 3.3.2 工具描述更新

```typescript
definition: {
  name: READ_FILE_TOOL_NAME,
  description:
    '读取指定本地文件或编辑器文档的内容。' +
    '当用户消息中包含 [file: /path/to/file.ts#L3-L5] 标记时，使用 path 参数读取磁盘文件，offset 从标记中的行号获取。' +
    '当用户消息中包含 [file: id=xxx name="foo" @L3-L5] 标记时，使用 documentId 参数（id 的值）读取编辑器中的未保存文档。',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径（绝对路径）。与 documentId 二选一。'
      },
      documentId: {
        type: 'string',
        description:
          '文档 ID（未保存的编辑器文件）。与 path 二选一。对应 [file: id=xxx ...] 标记中的 id 值。'
      },
      offset: { type: 'number', description: '起始行号，默认 1。' },
      limit: { type: 'number', description: '读取行数；不传时读到文件末尾。' }
    },
    required: [],
    additionalProperties: false
  }
}
```

#### 3.3.3 行内容提取辅助函数

将 documentId 分支两处重复的 offset/limit 截取逻辑提取为独立函数，避免类型断言问题：

```typescript
/**
 * 从文本内容中按 offset/limit 截取行。
 * 不依赖 ReadFileInput 的必填字段约束。
 */
interface ExtractLinesParams {
  offset?: number;
  limit?: number;
}

interface ExtractLinesResult {
  excerpt: string;
  totalLines: number;
  readLines: number;
  hasMore: boolean;
  nextOffset: number | null;
}

function extractLines(content: string, params: ExtractLinesParams): ExtractLinesResult {
  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;
  const offset = params.offset && params.offset >= 1 ? params.offset : 1;
  const hasLimit = params.limit !== undefined && params.limit >= 1;
  const endIndex = hasLimit ? Math.min(offset - 1 + params.limit!, totalLines) : totalLines;

  const excerpt = lines.slice(offset - 1, endIndex).join('\n');
  const readLines = endIndex - offset + 1;
  const hasMore = endIndex < totalLines;

  return {
    excerpt,
    totalLines,
    readLines,
    hasMore,
    nextOffset: hasMore ? offset + readLines : null
  };
}
```

#### 3.3.4 执行逻辑（含 SQLite 降级）

```typescript
async execute(input: ReadFileInput) {
  // ── documentId 分支：编辑器内存 → SQLite 快照降级 ──
  if (input.documentId) {
    const context = editorToolContextRegistry.getContext(input.documentId);
    let content: string;
    let pathLabel: string;

    if (context) {
      // 路径 1：从编辑器内存读取（当前激活的 tab）
      content = context.document.getContent();
      pathLabel = context.document.path ?? '';
    } else {
      // 路径 2：降级到 SQLite 快照（tab 已关闭，但有历史快照）
      const snapshot = await chatStorage.getReferenceSnapshotByDocumentId(input.documentId);
      if (snapshot) {
        content = snapshot.content;
        pathLabel = `[快照] ${snapshot.title}`;
      } else {
        return createToolFailureResult(
          READ_FILE_TOOL_NAME,
          'EXECUTION_FAILED',
          '文档未在编辑器中打开，且无历史快照'
        );
      }
    }

    const { excerpt, totalLines, readLines, hasMore, nextOffset } = extractLines(
      content,
      { offset: input.offset, limit: input.limit }
    );
    return createToolSuccessResult(READ_FILE_TOOL_NAME, {
      path: pathLabel,
      content: excerpt,
      totalLines,
      readLines,
      hasMore,
      nextOffset
    });
  }

  // ── path 分支：原有磁盘读取逻辑 ──
  if (!input.path) {
    return createToolFailureResult(
      READ_FILE_TOOL_NAME,
      'INVALID_INPUT',
      'path 或 documentId 必须提供一个'
    );
  }

  // ... 原有路径读取逻辑（不变）
}
```

需要新增 import：
```typescript
import { editorToolContextRegistry } from '@/ai/tools/editor-context';
import { chatStorage } from '@/shared/storage';
```

### 3.4 `workspaceRoot` 处理

**不传入 `getWorkspaceRoot`**。理由：
- `reference.path` 来自 `useFileReference.ts:96`，始终为**绝对路径**
- `read_file` 在无 `workspaceRoot` 时，绝对路径 + 用户确认即可正常工作
- 传入错误的 `workspaceRoot`（如文件路径）会导致 `isWithinWorkspace` 安全检查全部失败

`BChatSidebar/index.vue` 创建工具处保持不变（不新增 `getWorkspaceRoot`）：
```typescript
const tools = createBuiltinTools({
  confirm: confirmationController.createAdapter(),
  getPendingQuestion: () => { /* 不变 */ }
  // 不传 getWorkspaceRoot：reference.path 为绝对路径，无需 workspaceRoot
}).filter((tool) => {
  return getDefaultChatToolNames().includes(tool.definition.name);
});
```

### 3.5 清理 `fileReferenceContext.ts`

保留：
- `parseLineRange` — `convertFileRefTokensToMarkers` 中不直接使用（改用 `reference.line.replace('-', '-L')`），但 `persistReferenceSnapshots` 仍可能引用

移除：
- `buildDocumentOverview` — 不再需要
- `buildReferenceContextBlock` — 不再需要
- `buildModelReadyMessages` — 替换为 `convertFileRefTokensToMarkers`
- `SMALL_DOCUMENT_LINE_THRESHOLD` — 不再需要
- `MEDIUM_DOCUMENT_LINE_THRESHOLD` — 不再需要
- `CONTEXT_WINDOW_LINES` — 不再需要

---

## 四、LLM 交互流程

### 用户发送消息
```
用户输入: "解释一下这段代码 {{file-ref:abc|foo.ts|3|5}}"
  ↓ convertFileRefTokensToMarkers
LLM 收到: "解释一下这段代码 [file: <project>/src/foo.ts#L3-L5]"
  （首轮会前置 system prompt 引导）
```

### LLM 处理流程
```
LLM 分析: 用户引用了 <project>/src/foo.ts 第 3-5 行 → 需要 read_file
  ↓ 调用工具（绝对路径 + 用户确认）
LLM: read_file({path: "<project>/src/foo.ts", offset: 3, limit: 3})
  ↓ 用户确认后，工具返回
{
  path: "<project>/src/foo.ts",
  content: "export function hello() {\n  return 'world';\n}",
  totalLines: 100,
  readLines: 3,
  hasMore: true,
  nextOffset: 6
}
  ↓ LLM 基于返回内容生成回答
LLM: "这段代码定义了一个 hello 函数..."
```

### 错误处理路径
| 错误场景 | 工具返回 | LLM 行为 |
|----------|----------|----------|
| 绝对路径 + 用户取消确认 | TOOL_CANCELLED | 告知用户需要确认文件读取 |
| 文件不存在 | EXECUTION_FAILED (FILE_NOT_FOUND) | 告知用户文件未找到 |
| 未保存文件 tab 已关闭 + 无快照 | EXECUTION_FAILED | 告知用户文档不可用 |
| 未保存文件 tab 已关闭 + 有快照 | 成功（`[快照]` 前缀） | 基于快照内容回答 |

---

## 五、风险与注意事项

| 风险 | 缓解措施 |
|------|----------|
| LLM 不主动调用 read_file | System prompt 引导（仅首轮）+ 工具描述明确说明标记含义 |
| 工具调用增加往返延迟（~2-5s） | 简单引用延迟可接受；后续可考虑小文件（≤50 行）仍然内联 |
| `persistReferenceSnapshots` 职责变化 | 从"内容展开数据源"变为"documentId SQLite 降级数据源" |
| 续轮时标记替换重复执行 | 幂等——已替换为 `[file: ...]` 的内容不含 `{{file-ref:` 前缀 |
| 绝对路径暴露到 LLM 消息中 | 当前 `buildModelReadyMessages` 同样暴露；非新问题，后续可评估脱敏 |
| `read_file` 绝对路径需用户确认 | 用户可对信任的文件路径做会话级批准（`approve-session`） |

---

## 六、设计决策

### 6.1 小文件是否仍然内联？

**本次方案**：一刀切改为标记方式，所有文件引用都需 LLM 调用 `read_file`。

**可选混合策略**（后续优化）：小文件（≤50 行）仍然内联内容，省去工具调用往返。混合策略需要保留部分快照加载逻辑，增加复杂度。本次不做。

### 6.2 `persistReferenceSnapshots` 职责变化

| 维度 | 旧职责 | 新职责 |
|------|--------|--------|
| 触发时机 | 消息发送时 | 消息发送时（不变） |
| 数据用途 | `loadReferenceSnapshotMap` 加载 → 展开到消息 | `read_file({documentId})` 编辑器降级数据源 |
| 存储表 | `chatStorage.referenceSnapshots` | 不变 |

### 6.3 是否保留 `buildModelReadyMessages` 作为可选策略？

不在本次实施。如果未来用户反馈"标记+工具"方式体验不佳，可添加设置项让用户选择。
