# WebView History Observation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 只向模型发送当前有效的完整 WebView 快照，把历史网页观察替换为轻量存根，并通过 `operate_webpage.step` 保存跨步骤语义记忆。

**Architecture:** 保持数据库和 Renderer WebView 控制器不变，在 ChatRuntime 模型投影层新增 WebView 专用纯函数。正常请求根据最新用户轮次维护唯一当前观察，compaction 摘要源把全部网页读取视为历史；主进程仅持久化步骤记忆，发往 Renderer 的 bridge payload 继续只有 `snapshotId` 与 `action`。

**Tech Stack:** TypeScript、Electron 主进程 ChatRuntime、Vue Renderer bridge、AI SDK 7、Vitest。

## Global Constraints

- 不新增依赖，不引入第二套 WebView Agent 循环。
- 不修改或迁移数据库中的原始消息；模型投影必须是非原地变换。
- 正常模型请求最多保留一个当前有效完整网页快照；compaction 摘要请求不得包含完整网页快照。
- `evaluation` 最大 500 字符，`memory` 最大 1,200 字符，`nextGoal` 最大 300 字符。
- 历史投影不得包含旧 `snapshotId`、`[N]` 句柄或简化 DOM 行。
- 不使用 `any`；新增文件、函数、接口和复杂逻辑必须按项目规范添加注释。
- Renderer 页面操作协议不接收 `step`，确认卡片不展示步骤记忆。
- 不执行 `git add` 或 `git commit`；由用户自行提交。

## Implementation Audit Outcome

本计划中的逐步代码片段记录初始实施路径；最终实现经过多轮失败测试审计后做了以下加固，实际代码与设计规格优先：

- 新增 `WebviewTool/input.mts`，在用户确认前严格校验动作必填字段、枚举、长度、数值范围和安全整数句柄；旧调用可缺少 `step`，但 `step` 不进入 Renderer bridge。
- 新增 `WebviewTool/result.mts`，对白名单成功结果和失败错误执行发送侧清理，移除未知字段、DOM、快照令牌和 `error.details`。
- 当前观察必须通过主进程 WebView snapshot guard；结构不完整、快照 ID 空白或超长的旧结果只能作为历史存根。
- `done` 但缺少结果的 WebView Part 按未知终态清除旧观察；非终态操作输入也会防御性清理。
- compaction 摘要源额外移除 `inputText`、`providerMetadata`、`shellOutput` 与 `shellRunState`，原始 fingerprint source 保持不变。
- 同一轮工具续跑测试在第二次模型请求外部断言投影结果，避免 Runtime 捕获内部断言造成假绿。

---

## File Structure

- Create: `electron/main/modules/chat/runtime/context/webview-tool-output.mts`
  - 负责识别当前网页观察、生成历史读取存根、清理历史操作输入和复用 compaction 历史 Part 投影。
- Create: `test/electron/main/modules/chat/runtime/webview-tool-output.test.ts`
  - 纯函数状态机、清理、兼容和非原地变换测试。
- Modify: `shared/ai/tools/WebviewTool/index.ts`
  - 定义 `step` JSON Schema、字段上限和模型约束说明。
- Modify: `electron/main/modules/chat/runtime/tools/WebviewTool/index.mts`
  - 从 `operate_webpage` 模型输入构造不包含 `step` 的 Renderer bridge payload。
- Modify: `electron/main/modules/chat/runtime/compaction/projector.mts`
  - 在通用大型结果剪枝前接入正常 WebView 历史投影。
- Modify: `electron/main/modules/chat/runtime/compaction/planner.mts`
  - 对 compaction 摘要源的全部 WebView Part 使用历史投影，同时保留原始 fingerprint source。
- Modify: `test/ai/tools/tool-registry.test.ts`
  - 验证公开工具 Schema 和字段限制。
- Modify: `test/electron/main/modules/chat/runtime/main-tools.test.ts`
  - 验证步骤记忆不进入确认文案与 Renderer bridge。
- Modify: `test/electron/main/modules/chat/runtime/compaction/projector.test.ts`
  - 验证 projectContext 的当前观察状态机。
- Modify: `test/electron/main/modules/chat/runtime/compaction/planner.test.ts`
  - 验证摘要源无历史 DOM、fingerprint source 保持原文。
- Modify: `test/electron/main/modules/chat/runtime/service.test.ts`
  - 验证实际模型请求使用裁剪投影且不回写持久化消息。
- Modify: `changelog/2026-08-03.md`
  - 记录实现与测试范围。

---

### Task 1: `operate_webpage` 步骤记忆与 Bridge 边界

**Files:**
- Modify: `shared/ai/tools/WebviewTool/index.ts`
- Modify: `electron/main/modules/chat/runtime/tools/WebviewTool/index.mts`
- Test: `test/ai/tools/tool-registry.test.ts`
- Test: `test/electron/main/modules/chat/runtime/main-tools.test.ts`

**Interfaces:**
- Consumes: 现有 `ToolJsonSchema`、`ToolRegistryEntry`、`MainToolsDependencies.requestBridge`。
- Produces: 公开工具输入 `{ snapshotId?: string; step: WebviewStepMemory; action: WebpageOperationAction }`；Renderer bridge payload 仍为 `{ snapshotId?: string; action: WebpageOperationAction }`。

- [ ] **Step 1: 为工具 Schema 写失败测试**

在 `test/ai/tools/tool-registry.test.ts` 更新 navigate 测试，并新增步骤字段断言：

```ts
it('requires bounded step memory for operate_webpage', (): void => {
  const definition = getToolDefinitionByName(OPERATE_WEBPAGE_TOOL_NAME);
  const stepSchema = definition?.parameters.properties.step as {
    required?: string[];
    additionalProperties?: boolean;
    properties?: Record<string, { maxLength?: number; description?: string }>;
  };

  expect(definition?.parameters.required).toEqual(['step', 'action']);
  expect(stepSchema.required).toEqual(['evaluation', 'memory', 'nextGoal']);
  expect(stepSchema.additionalProperties).toBe(false);
  expect(stepSchema.properties?.evaluation?.maxLength).toBe(500);
  expect(stepSchema.properties?.memory?.maxLength).toBe(1_200);
  expect(stepSchema.properties?.nextGoal?.maxLength).toBe(300);
  expect(stepSchema.properties?.memory?.description).toContain('不得包含 [N]');
});
```

把原有 navigate 测试中的断言改为：

```ts
expect(operateDefinition?.parameters.required).toEqual(['step', 'action']);
```

- [ ] **Step 2: 为主进程 Bridge 剥离步骤记忆写失败测试**

在 `test/electron/main/modules/chat/runtime/main-tools.test.ts` 的操作测试中使用：

```ts
const toolInput = {
  snapshotId: 'snap-1',
  step: {
    evaluation: '结果列表已经出现。',
    memory: '当前最低价格为 ¥820。',
    nextGoal: '打开下一页继续比较。'
  },
  action: { type: 'click', index: 2 }
};
```

确认请求描述不包含记忆，并要求 bridge 只收到页面操作字段：

```ts
expect(requestConfirmation).toHaveBeenCalledWith(
  expect.objectContaining({
    request: expect.objectContaining({
      description: '点击当前网页元素 #2'
    })
  })
);
expect(JSON.stringify(requestConfirmation.mock.calls)).not.toContain('当前最低价格');
expect(bridgeRequests).toEqual([
  {
    runtimeId: 'runtime-1',
    toolCallId: 'tool-call-web-2',
    kind: 'webview-operate',
    payload: { snapshotId: 'snap-1', action: { type: 'click', index: 2 } }
  }
]);
```

保留一个缺少 `step` 的旧输入测试，断言主进程仍只转发旧页面操作字段，证明恢复路径兼容。

- [ ] **Step 3: 运行定向测试并确认失败**

Run:

```bash
pnpm exec vitest run test/ai/tools/tool-registry.test.ts test/electron/main/modules/chat/runtime/main-tools.test.ts
```

Expected: FAIL；Schema 仍只要求 `action`，bridge payload 仍包含完整 `toolInput`。

- [ ] **Step 4: 实现步骤记忆 Schema**

在 `shared/ai/tools/WebviewTool/index.ts` 增加：

```ts
/** 网页操作步骤记忆 Schema。 */
const WEBPAGE_STEP_MEMORY_SCHEMA: ToolJsonSchema = {
  type: 'object',
  properties: {
    evaluation: {
      type: 'string',
      maxLength: 500,
      description: '根据最新网页观察判断上一步是否达到目标；没有上一步时使用空字符串。'
    },
    memory: {
      type: 'string',
      maxLength: 1200,
      description: '后续步骤仍需保留的业务事实；不得包含 [N]、snapshotId、CSS selector、HTML、简化 DOM 行或大段页面原文。'
    },
    nextGoal: {
      type: 'string',
      maxLength: 300,
      description: '本次 action 希望达到的单一目标，不要编排多个后续动作。'
    }
  },
  required: ['evaluation', 'memory', 'nextGoal'],
  additionalProperties: false
};
```

把 `operateWebpageToolRegistryEntry.definition.parameters` 更新为：

```ts
parameters: {
  type: 'object',
  properties: {
    snapshotId: {
      type: 'string',
      description: 'read_current_webpage 返回的 snapshotId；非 navigate 动作必须提供。页面内可操作项不得改用 navigate。'
    },
    step: WEBPAGE_STEP_MEMORY_SCHEMA,
    action: WEBPAGE_OPERATION_ACTION_SCHEMA
  },
  required: ['step', 'action'],
  additionalProperties: false
}
```

同步更新工具 description，明确操作后重新读取和步骤记忆限制。

- [ ] **Step 5: 实现主进程 Bridge payload 投影**

在 `electron/main/modules/chat/runtime/tools/WebviewTool/index.mts` 增加纯函数：

```ts
/**
 * 创建 Renderer 实际需要的 WebView 操作载荷。
 * @param input - 模型工具输入
 * @returns 不包含步骤记忆的 Renderer 载荷
 */
function createOperateBridgePayload(input: unknown): unknown {
  if (!isRecord(input)) return input;

  return {
    ...(typeof input.snapshotId === 'string' ? { snapshotId: input.snapshotId } : {}),
    action: input.action
  };
}
```

`executeOperateWebpage` 的 bridge 请求改为：

```ts
payload: createOperateBridgePayload(input.input)
```

确认描述继续只读取 `action`。不要把 `step` 添加到 Renderer 类型或 `src/components/BChat/utils/runtimeBridge.ts`。

- [ ] **Step 6: 运行定向测试并确认通过**

Run:

```bash
pnpm exec vitest run test/ai/tools/tool-registry.test.ts test/electron/main/modules/chat/runtime/main-tools.test.ts
```

Expected: PASS。

---

### Task 2: WebView 历史语义投影纯函数

**Files:**
- Create: `electron/main/modules/chat/runtime/context/webview-tool-output.mts`
- Create: `test/electron/main/modules/chat/runtime/webview-tool-output.test.ts`

**Interfaces:**
- Consumes: `ChatMessageRecord`、`ChatMessagePart`、`ChatMessageToolPart`、`READ_CURRENT_WEBPAGE_TOOL_NAME`、`OPERATE_WEBPAGE_TOOL_NAME`。
- Produces:
  - `projectWebviewToolOutputs(messages: ChatMessageRecord[]): ChatMessageRecord[]`
  - `projectHistoricalWebviewPart(part: ChatMessagePart): ChatMessagePart`

- [ ] **Step 1: 建立测试 fixture 与失败用例**

创建 `test/electron/main/modules/chat/runtime/webview-tool-output.test.ts`。先定义可复用 fixture：

```ts
/**
 * 创建投影测试消息。
 * @param id - 消息 ID
 * @param role - 消息角色
 * @param parts - 消息 Part
 * @returns 完整消息
 */
function createMessage(id: string, role: 'user' | 'assistant', parts: ChatMessagePart[]): ChatMessageRecord {
  return {
    id,
    sessionId: 'session-1',
    role,
    content: '',
    parts,
    createdAt: '2026-08-03T00:00:00.000Z',
    finished: true
  };
}

/**
 * 创建成功网页读取 Part。
 * @param id - Part ID
 * @param snapshotId - 快照 ID
 * @returns 网页读取 Part
 */
function createReadPart(id: string, snapshotId: string): ChatMessageToolPart {
  return {
    id,
    type: 'tool',
    toolCallId: `call-${id}`,
    toolName: 'read_current_webpage',
    status: 'done',
    input: {},
    result: {
      toolName: 'read_current_webpage',
      status: 'success',
      data: {
        url: 'https://example.com',
        title: 'Example',
        summary: 'DOM_SENTINEL',
        content: 'DOM_SENTINEL',
        capturedAt: 1,
        snapshotId
      }
    }
  };
}

/**
 * 创建网页操作 Part。
 * @param id - Part ID
 * @param snapshotId - 快照 ID
 * @param result - 操作结果
 * @returns 网页操作 Part
 */
function createOperatePart(id: string, snapshotId: string, result: AIToolExecutionResult): ChatMessageToolPart {
  return {
    id,
    type: 'tool',
    toolCallId: `call-${id}`,
    toolName: 'operate_webpage',
    status: 'done',
    input: {
      snapshotId,
      step: { evaluation: '', memory: '价格为 ¥820', nextGoal: '继续比较' },
      action: { type: 'click', index: 2 }
    },
    result
  };
}

/**
 * 查找指定工具 Part 的成功数据。
 * @param messages - 投影消息
 * @param id - Part ID
 * @returns 成功结果数据
 */
function readData(messages: ChatMessageRecord[], id: string): unknown {
  const part = messages.flatMap((message) => message.parts).find((candidate) => candidate.id === id);
  return part?.type === 'tool' && part.result?.status === 'success' ? part.result.data : undefined;
}
```

测试文件导入 `AIToolExecutionResult`、`ChatMessagePart`、`ChatMessageRecord`、`ChatMessageToolPart`、Vitest API 和两个待实现投影函数，然后加入以下用例：

```ts
it('keeps only the current successful read after the latest user message', (): void => {
  const success: AIToolExecutionResult = { toolName: 'operate_webpage', status: 'success', data: { ok: true } };
  const messages = [
    createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '比较价格' }]),
    createMessage('assistant-1', 'assistant', [
      createReadPart('read-1', 'snapshot-1'),
      createOperatePart('operate-1', 'snapshot-1', success),
      createReadPart('read-2', 'snapshot-2')
    ])
  ];
  const original = structuredClone(messages);

  const projected = projectWebviewToolOutputs(messages);

  expect(messages).toEqual(original);
  expect(readData(projected, 'read-1')).toMatchObject({ pruned: true, pruneReason: 'historical_webview_snapshot' });
  expect(readData(projected, 'read-2')).toMatchObject({ snapshotId: 'snapshot-2', content: 'DOM_SENTINEL' });
});

const terminalResults: AIToolExecutionResult[] = [
  { toolName: 'operate_webpage', status: 'success', data: { ok: true } },
  { toolName: 'operate_webpage', status: 'failure', error: { code: 'USER_CANCELLED', message: 'denied' } },
  { toolName: 'operate_webpage', status: 'failure', error: { code: 'EXECUTION_FAILED', message: 'failed' } },
  { toolName: 'operate_webpage', status: 'cancelled', error: { code: 'USER_CANCELLED', message: 'cancelled' } }
];

it.each(terminalResults)('consumes a read after a terminal operate result', (result: AIToolExecutionResult): void => {
  const messages = [
    createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '继续' }]),
    createMessage('assistant-1', 'assistant', [
      createReadPart('read-1', 'snapshot-1'),
      createOperatePart('operate-1', 'snapshot-1', result)
    ])
  ];

  expect(readData(projectWebviewToolOutputs(messages), 'read-1')).toMatchObject({ pruned: true });
});

it('does not consume the current read after a non-WebView tool', (): void => {
  const readFilePart: ChatMessageToolPart = {
    id: 'read-file',
    type: 'tool',
    toolCallId: 'call-read-file',
    toolName: 'read_file',
    status: 'done',
    input: { path: 'README.md' },
    result: { toolName: 'read_file', status: 'success', data: { content: 'file' } }
  };
  const messages = [
    createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '继续' }]),
    createMessage('assistant-1', 'assistant', [createReadPart('read-1', 'snapshot-1'), readFilePart])
  ];

  expect(readData(projectWebviewToolOutputs(messages), 'read-1')).toMatchObject({ content: 'DOM_SENTINEL' });
});

it('prunes all reads before the latest user message', (): void => {
  const messages = [
    createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '第一轮' }]),
    createMessage('assistant-1', 'assistant', [createReadPart('read-1', 'snapshot-1')]),
    createMessage('user-2', 'user', [{ id: 'user-part-2', type: 'text', text: '第二轮' }])
  ];

  expect(readData(projectWebviewToolOutputs(messages), 'read-1')).toMatchObject({ pruned: true });
});

it('keeps a failed read error but does not restore an older observation', (): void => {
  const failedRead: ChatMessageToolPart = {
    ...createReadPart('read-failed', 'snapshot-failed'),
    result: { toolName: 'read_current_webpage', status: 'failure', error: { code: 'BRIDGE_TIMEOUT', message: 'timeout' } }
  };
  const messages = [
    createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '继续' }]),
    createMessage('assistant-1', 'assistant', [createReadPart('read-1', 'snapshot-1'), failedRead])
  ];
  const projected = projectWebviewToolOutputs(messages);
  const projectedFailure = projected[1].parts[1];

  expect(readData(projected, 'read-1')).toMatchObject({ pruned: true });
  expect(projectedFailure).toMatchObject({ type: 'tool', result: { status: 'failure', error: { code: 'BRIDGE_TIMEOUT' } } });
});

it('removes handles, snapshot tokens, and DOM lines from historical operate memory', (): void => {
  const part = createOperatePart(
    'operate-1',
    'webview-snapshot-SNAPSHOT_SENTINEL',
    { toolName: 'operate_webpage', status: 'success', data: { ok: true } }
  );
  part.input = {
    snapshotId: 'webview-snapshot-SNAPSHOT_SENTINEL',
    step: {
      evaluation: '[2] 已出现',
      memory: '[2]<button>购买</button>\n最低价 ¥820',
      nextGoal: '点击 *[3]'
    },
    action: { type: 'click', index: 3 }
  };

  const projected = projectHistoricalWebviewPart(part);
  const serialized = JSON.stringify(projected);

  expect(serialized).not.toContain('SNAPSHOT_SENTINEL');
  expect(serialized).not.toContain('<button>');
  expect(serialized).not.toContain('[2]');
  expect(projected).toMatchObject({
    type: 'tool',
    input: { step: { memory: '最低价 ¥820' }, action: { type: 'click', index: 3 } }
  });
});

it('projects every successful read as historical when projecting one Part', (): void => {
  const projected = projectHistoricalWebviewPart(createReadPart('read-1', 'snapshot-1'));

  expect(projected).toMatchObject({
    type: 'tool',
    result: { data: { pruned: true, pruneReason: 'historical_webview_snapshot' } }
  });
  expect(JSON.stringify(projected)).not.toContain('DOM_SENTINEL');
});
```

- [ ] **Step 2: 运行新测试并确认模块缺失**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/runtime/webview-tool-output.test.ts
```

Expected: FAIL；`webview-tool-output.mjs` 无法解析或导出函数不存在。

- [ ] **Step 3: 实现历史存根与步骤记忆清理**

创建 `electron/main/modules/chat/runtime/context/webview-tool-output.mts`，先实现以下常量和辅助函数：

```ts
/** WebView 步骤记忆最大长度。 */
const WEBVIEW_STEP_LIMITS = { evaluation: 500, memory: 1_200, nextGoal: 300 } as const;

/** 历史网页快照固定摘要。 */
const HISTORICAL_WEBVIEW_SUMMARY =
  'Historical webpage snapshot omitted. Its snapshotId and [N] handles are invalid. Call read_current_webpage to observe the current page.';

/** 简化 DOM 行。 */
const WEBVIEW_DOM_LINE_PATTERN = /^\s*\*?\[\d+\]<[^\n]*$/gmu;
/** WebView snapshot 令牌。 */
const WEBVIEW_SNAPSHOT_PATTERN = /webview-snapshot-[A-Za-z0-9_-]+/gu;
/** WebView 元素句柄。 */
const WEBVIEW_HANDLE_PATTERN = /\*?\[\d+\]/gu;
```

实现并为每个函数添加 JSDoc：

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value);
}

function sanitizeMemoryText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';

  return value
    .replace(WEBVIEW_DOM_LINE_PATTERN, '')
    .replace(WEBVIEW_SNAPSHOT_PATTERN, '')
    .replace(WEBVIEW_HANDLE_PATTERN, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
    .slice(0, maxLength);
}

function sanitizeStepMemory(value: unknown): Record<string, string> {
  const source = isRecord(value) ? value : {};
  return {
    evaluation: sanitizeMemoryText(source.evaluation, WEBVIEW_STEP_LIMITS.evaluation),
    memory: sanitizeMemoryText(source.memory, WEBVIEW_STEP_LIMITS.memory),
    nextGoal: sanitizeMemoryText(source.nextGoal, WEBVIEW_STEP_LIMITS.nextGoal)
  };
}

function createSnapshotStub(data: unknown): Record<string, unknown> {
  const source = isRecord(data) ? data : {};
  return {
    ...(typeof source.url === 'string' ? { url: source.url.slice(0, 2_048) } : {}),
    ...(typeof source.title === 'string' ? { title: source.title.slice(0, 300) } : {}),
    ...(typeof source.capturedAt === 'number' && Number.isFinite(source.capturedAt) ? { capturedAt: source.capturedAt } : {}),
    pruned: true,
    pruneReason: 'historical_webview_snapshot',
    summary: HISTORICAL_WEBVIEW_SUMMARY
  };
}

type CompletedToolPart = ChatMessageToolPart & { result: NonNullable<ChatMessageToolPart['result']> };

function isCompletedTool(part: ChatMessagePart): part is CompletedToolPart {
  return part.type === 'tool' && part.status === 'done' && part.result !== undefined;
}

function isTerminalToolResult(part: CompletedToolPart): boolean {
  return part.result.status !== 'awaiting_user_input';
}
```

文件顶部从 `lodash-es` 导入 `isPlainObject`，不要手写普通对象判定。

`sanitizeMemoryText` 的执行顺序固定为：删除简化 DOM 行 → 删除 snapshot 令牌 → 删除 `[N]` 句柄 → 合并三行以上空白 → trim → `slice(0, maxLength)`。

`createSnapshotStub` 只复制最多 2,048 字符的 `url`、最多 300 字符的 `title` 和有限数值 `capturedAt`，再写入 `pruned`、`pruneReason` 和固定摘要。

- [ ] **Step 4: 实现单 Part 历史投影**

实现：

```ts
/**
 * 将单个 WebView Part 投影为历史步骤。
 * @param part - 原始消息 Part
 * @returns 不含历史 DOM 和快照句柄的 Part clone
 */
export function projectHistoricalWebviewPart(part: ChatMessagePart): ChatMessagePart {
  const cloned = structuredClone(part);
  if (cloned.type !== 'tool' || cloned.status !== 'done') return cloned;

  if (cloned.toolName === READ_CURRENT_WEBPAGE_TOOL_NAME && cloned.result?.status === 'success') {
    return {
      ...cloned,
      result: { ...cloned.result, data: createSnapshotStub(cloned.result.data) }
    };
  }

  if (cloned.toolName !== OPERATE_WEBPAGE_TOOL_NAME) return cloned;
  const input = isRecord(cloned.input) ? cloned.input : {};
  return {
    ...cloned,
    input: {
      step: sanitizeStepMemory(input.step),
      ...(input.action !== undefined ? { action: structuredClone(input.action) } : {})
    }
  };
}
```

失败读取结果原样 clone；历史操作结果保持不变；历史操作输入不复制 `snapshotId` 或未知字段。

- [ ] **Step 5: 实现当前观察状态机**

实现：

```ts
/**
 * 查找最新用户轮次中仍有效的完整读取 Part。
 * @param messages - 模型投影消息
 * @returns 当前读取 Part ID，不存在时返回 undefined
 */
function findCurrentReadPart(messages: ChatMessageRecord[]): string | undefined {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== 'user') continue;
    latestUserIndex = index;
    break;
  }
  if (latestUserIndex < 0) return undefined;

  let currentReadPartId: string | undefined;
  for (let messageIndex = latestUserIndex + 1; messageIndex < messages.length; messageIndex += 1) {
    for (const part of messages[messageIndex].parts) {
      if (!isCompletedTool(part)) continue;
      if (part.toolName === READ_CURRENT_WEBPAGE_TOOL_NAME && isTerminalToolResult(part)) {
        currentReadPartId = part.result?.status === 'success' ? part.id : undefined;
      } else if (part.toolName === OPERATE_WEBPAGE_TOOL_NAME && isTerminalToolResult(part)) {
        currentReadPartId = undefined;
      }
    }
  }

  return currentReadPartId;
}

/**
 * 投影 WebView 工具历史并最多保留一个当前观察。
 * @param messages - 原始模型投影消息
 * @returns 不修改输入的 WebView 安全投影
 */
export function projectWebviewToolOutputs(messages: ChatMessageRecord[]): ChatMessageRecord[] {
  const currentReadPartId = findCurrentReadPart(messages);

  return messages.map((message): ChatMessageRecord => ({
    ...structuredClone(message),
    parts: message.parts.map((part): ChatMessagePart => {
      if (
        part.type === 'tool' &&
        part.status === 'done' &&
        part.toolName === READ_CURRENT_WEBPAGE_TOOL_NAME &&
        part.result?.status === 'success' &&
        part.id !== currentReadPartId
      ) {
        return projectHistoricalWebviewPart(part);
      }
      if (part.type === 'tool' && part.status === 'done' && part.toolName === OPERATE_WEBPAGE_TOOL_NAME) {
        return projectHistoricalWebviewPart(part);
      }

      return structuredClone(part);
    })
  }));
}
```

`findCurrentReadPart` 从最后一条 user 消息之后扫描终态工具：成功 read 设置当前 ID；失败 read 或任意终态 operate 清空；`awaiting_user_input` 和其他工具忽略。没有 user 消息时不保留当前读取。

`projectWebviewToolOutputs` 先 `structuredClone` 每条消息，再把所有历史成功 read 和所有终态 operate 交给 `projectHistoricalWebviewPart`；当前 read 保持完整。

- [ ] **Step 6: 运行纯函数测试并确认通过**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/runtime/webview-tool-output.test.ts
```

Expected: PASS。

---

### Task 3: 正常 ChatRuntime 模型投影接入

**Files:**
- Modify: `electron/main/modules/chat/runtime/compaction/projector.mts`
- Modify: `test/electron/main/modules/chat/runtime/compaction/projector.test.ts`
- Modify: `test/electron/main/modules/chat/runtime/service.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `projectWebviewToolOutputs`。
- Produces: `projectContext` 返回已经执行 WebView 语义裁剪和 Token 重估的 `ContextProjection`。

- [ ] **Step 1: 为 projectContext 写失败测试**

在 `test/electron/main/modules/chat/runtime/compaction/projector.test.ts` 增加 `createWebviewReadPart` 和 `createWebviewOperatePart` fixture，返回与 Task 2 相同结构的 `ChatMessageToolPart`，再增加三个集成用例：

```ts
it('只保留最新用户轮次中尚未消费的网页观察', (): void => {
  const messages = [
    createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '比较价格' }]),
    createMessage('assistant-1', 'assistant', [
      createWebviewReadPart('read-1', 'snapshot-1'),
      createWebviewOperatePart('operate-1', 'snapshot-1'),
      createWebviewReadPart('read-2', 'snapshot-2')
    ])
  ];
  const original = structuredClone(messages);
  const projection = projectContext({ messages });
  const serialized = JSON.stringify(projection.messages);

  expect(messages).toEqual(original);
  expect(serialized).toContain('snapshot-2');
  expect(serialized.match(/DOM_SENTINEL/gu)).toHaveLength(2);
});

it('网页操作后不再把已消费观察发送给模型', (): void => {
  const messages = [
    createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '继续' }]),
    createMessage('assistant-1', 'assistant', [
      createWebviewReadPart('read-1', 'snapshot-1'),
      createWebviewOperatePart('operate-1', 'snapshot-1')
    ])
  ];
  const serialized = JSON.stringify(projectContext({ messages }).messages);

  expect(serialized).not.toContain('DOM_SENTINEL');
  expect(serialized).not.toContain('snapshot-1');
  expect(serialized).toContain('当前最低价格为 ¥820');
});

it('新用户轮次不继承上一轮完整网页观察', (): void => {
  const messages = [
    createMessage('user-1', 'user', [{ id: 'user-part-1', type: 'text', text: '第一轮' }]),
    createMessage('assistant-1', 'assistant', [createWebviewReadPart('read-1', 'snapshot-1')]),
    createMessage('user-2', 'user', [{ id: 'user-part-2', type: 'text', text: '第二轮' }])
  ];

  expect(JSON.stringify(projectContext({ messages }).messages)).not.toContain('DOM_SENTINEL');
});
```

每个测试先保存 `structuredClone(messages)`，最后断言输入未修改。

- [ ] **Step 2: 为实际模型请求写失败测试**

在 `test/electron/main/modules/chat/runtime/service.test.ts` 参照“prunes old large tool results only in the model projection”测试，构造上一轮完整网页读取：

```ts
result: {
  toolName: 'read_current_webpage',
  status: 'success',
  data: {
    url: 'https://example.com',
    title: 'Example',
    summary: 'DOM_SENTINEL',
    header: 'header',
    content: 'DOM_SENTINEL',
    footer: 'footer',
    text: 'DOM_SENTINEL',
    selectedText: '',
    headings: [],
    links: [],
    capturedAt: 1,
    truncated: {},
    snapshotId: 'webview-snapshot-SNAPSHOT_SENTINEL',
    elements: []
  }
}
```

捕获 `streamExecutor` 的 `sourceMessages`，断言请求不含 `DOM_SENTINEL` 和 `SNAPSHOT_SENTINEL`，数据库 fixture 与原始 clone 相等，且没有针对旧 assistant 的 update 事件。

- [ ] **Step 3: 运行集成测试并确认失败**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/runtime/compaction/projector.test.ts test/electron/main/modules/chat/runtime/service.test.ts
```

Expected: FAIL；`projectContext` 仍保留最近历史网页结果。

- [ ] **Step 4: 在 projectContext 接入 WebView 投影**

在 `electron/main/modules/chat/runtime/compaction/projector.mts` 导入 Task 2 函数，并将顺序固定为：

```ts
const skillProjectedMessages = invalidateStaleSkillToolResults(rawMessages, input.skillContentHashes);
const webviewProjectedMessages = projectWebviewToolOutputs(skillProjectedMessages);
const oldToolPrunedMessages = pruneProjection(webviewProjectedMessages);
const messages = input.activeTurnToolPruneMode
  ? pruneActiveTurnToolOutputs(oldToolPrunedMessages, input.activeTurnToolPruneMode)
  : oldToolPrunedMessages;
```

不要把投影加入 `toRuntimeModelMessages`，避免 Token 估算与实际发送内容不一致。

- [ ] **Step 5: 运行集成测试并确认通过**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/runtime/compaction/projector.test.ts test/electron/main/modules/chat/runtime/service.test.ts
```

Expected: PASS。

---

### Task 4: Compaction 摘要源历史裁剪

**Files:**
- Modify: `electron/main/modules/chat/runtime/compaction/planner.mts`
- Modify: `test/electron/main/modules/chat/runtime/compaction/planner.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `projectHistoricalWebviewPart`。
- Produces: 不含历史网页 DOM 的 `CompactionSourceSnapshot.sourceParts`；原始 `fingerprintSources` 不变。

- [ ] **Step 1: 为摘要源写失败测试**

在 `test/electron/main/modules/chat/runtime/compaction/planner.test.ts` 增加手动压缩用例：

```ts
it('从摘要源移除网页 DOM 但保留 fingerprint 原文', (): void => {
  const input = createInput('', 'manual');
  input.messages[0] = createMessage('old-webview', 'assistant', [createWebviewReadPart('DOM_SENTINEL')]);

  const result = createCompactionPlan(input);

  expect(result.status).toBe('ready');
  if (result.status !== 'ready') return;
  expect(JSON.stringify(result.plan.sourceSnapshot)).not.toContain('DOM_SENTINEL');
  expect(result.plan.sourceSnapshot.sourceParts[0].part).toMatchObject({
    type: 'tool',
    result: { data: { pruned: true, pruneReason: 'historical_webview_snapshot' } }
  });
  expect(JSON.stringify(result.plan.fingerprintSources)).toContain('DOM_SENTINEL');
});
```

再增加历史 operate 输入用例：

```ts
it('清理摘要源中的网页操作句柄并保留步骤记忆', (): void => {
  const input = createInput('', 'manual');
  input.messages[0] = createMessage('old-operate', 'assistant', [
    {
      id: 'source-operate',
      type: 'tool',
      toolCallId: 'call-source-operate',
      toolName: 'operate_webpage',
      status: 'done',
      input: {
        snapshotId: 'webview-snapshot-SNAPSHOT_SENTINEL',
        step: { evaluation: '[2] 已出现', memory: '最低价格为 ¥820', nextGoal: '点击 [3]' },
        action: { type: 'click', index: 3 }
      },
      result: { toolName: 'operate_webpage', status: 'success', data: { ok: true } }
    }
  ]);

  const result = createCompactionPlan(input);

  expect(result.status).toBe('ready');
  if (result.status !== 'ready') return;
  const serialized = JSON.stringify(result.plan.sourceSnapshot);
  expect(serialized).not.toContain('SNAPSHOT_SENTINEL');
  expect(serialized).not.toContain('[2]');
  expect(serialized).toContain('最低价格为 ¥820');
  expect(serialized).toContain('"action":{"type":"click","index":3}');
});
```

- [ ] **Step 2: 运行 Planner 测试并确认失败**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/runtime/compaction/planner.test.ts
```

Expected: FAIL；小于 4 KB 的网页 DOM 仍进入 `sourceSnapshot`。

- [ ] **Step 3: 在摘要源投影中复用历史 Part 函数**

在 `electron/main/modules/chat/runtime/compaction/planner.mts` 新增无条件 WebView 摘要源投影：

```ts
function projectSummarySources(sourceParts: ImmutableChatPart[]): ImmutableChatPart[] {
  return sourceParts.map(
    (source): ImmutableChatPart => ({
      messageId: source.messageId,
      part: projectHistoricalWebviewPart(source.part)
    })
  );
}
```

初始化摘要源时调用：

```ts
let summarySources = projectSummarySources(fingerprintSources);
```

现有 `pruneSummarySources` 继续只在摘要超预算时处理通用大型工具结果。不要修改 `collectSourceParts` 返回的 `fingerprintSources`，也不要让通用大型结果在预算充足时提前被裁剪。

- [ ] **Step 4: 运行 Planner 与 compaction 集成测试**

Run:

```bash
pnpm exec vitest run test/electron/main/modules/chat/runtime/compaction/planner.test.ts test/electron/main/modules/chat/runtime/compaction/projector.test.ts test/electron/main/modules/chat/runtime/service.test.ts
```

Expected: PASS。

---

### Task 5: 文档、回归与最终验证

**Files:**
- Modify: `changelog/2026-08-03.md`
- Verify: all files changed by Tasks 1–4

**Interfaces:**
- Consumes: Tasks 1–4 的完整实现。
- Produces: 可由用户自行审查和提交的已验证工作区改动。

- [ ] **Step 1: 更新 Changelog**

在 `changelog/2026-08-03.md` 的 `## Changed` 增加实现说明，在 `## Test` 增加覆盖说明：

```markdown
- WebView 模型上下文改为只保留当前有效完整网页观察，历史读取使用轻量存根；`operate_webpage` 新增受长度约束的步骤反思、记忆和目标，Renderer bridge 继续只接收页面操作字段。
```

```markdown
- 新增 WebView 历史观察状态机、步骤记忆清理、正常模型投影、compaction 摘要源和持久化非原地变换测试。
```

- [ ] **Step 2: 运行全部相关 Vitest**

Run:

```bash
pnpm exec vitest run \
  test/ai/tools/tool-registry.test.ts \
  test/electron/main/modules/chat/runtime/main-tools.test.ts \
  test/electron/main/modules/chat/runtime/webview-tool-output.test.ts \
  test/electron/main/modules/chat/runtime/compaction/projector.test.ts \
  test/electron/main/modules/chat/runtime/compaction/planner.test.ts \
  test/electron/main/modules/chat/runtime/service.test.ts
```

Expected: 所有测试文件通过，无失败用例。

- [ ] **Step 3: 运行 TypeScript 检查**

Run:

```bash
pnpm exec tsc --noEmit
pnpm exec tsc -p electron/tsconfig.json --noEmit
```

Expected: 两条命令均 exit 0，无类型错误。

- [ ] **Step 4: 运行 ESLint**

Run:

```bash
pnpm exec eslint \
  shared/ai/tools/WebviewTool/index.ts \
  electron/main/modules/chat/runtime/tools/WebviewTool/index.mts \
  electron/main/modules/chat/runtime/context/webview-tool-output.mts \
  electron/main/modules/chat/runtime/compaction/projector.mts \
  electron/main/modules/chat/runtime/compaction/planner.mts \
  test/ai/tools/tool-registry.test.ts \
  test/electron/main/modules/chat/runtime/main-tools.test.ts \
  test/electron/main/modules/chat/runtime/webview-tool-output.test.ts \
  test/electron/main/modules/chat/runtime/compaction/projector.test.ts \
  test/electron/main/modules/chat/runtime/compaction/planner.test.ts \
  test/electron/main/modules/chat/runtime/service.test.ts
```

Expected: exit 0，无 lint 错误；不得使用 `--fix` 修改无关文件。

- [ ] **Step 5: 运行最终差异检查**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` 无输出；`git status --short` 只列出本设计、计划、实现、测试和 changelog 相关文件。不要暂存或提交。

---

## Self-Review Checklist

- [ ] 规格中的步骤记忆、当前观察状态机、历史存根、操作输入清理、compaction、兼容和测试要求均映射到具体 Task。
- [ ] `projectWebviewToolOutputs` 与 `projectHistoricalWebviewPart` 在所有任务中名称一致。
- [ ] 正常模型投影与 Token 估算使用同一份消息；没有在 ModelMessage 转换阶段重复裁剪。
- [ ] compaction 只裁剪 `sourceSnapshot`，不裁剪 `fingerprintSources`。
- [ ] 主进程从 bridge payload 移除 `step`，Renderer 无需修改类型。
- [ ] 所有新增函数名不超过四个单词，且没有 `any`、占位符或未定义接口。
- [ ] 计划没有暂存或提交步骤。
