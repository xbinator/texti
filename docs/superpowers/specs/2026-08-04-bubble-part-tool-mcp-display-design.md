# BubblePartTool MCP 工具专属展示设计

## 背景

聊天消息气泡中的工具调用由 `src/components/BChat/components/MessageBubble/BubblePartTool/index.vue` 统一编排。当前 MCP 工具（AI SDK 工具名形如 `mcp_<serverId hex>_<toolName hex>`）仅通过 `src/components/BChat/utils/toolLabels.ts` 解码出工具名，在标题显示 `MCP: <工具名>`；正文在成功且无内置摘要时直接展示原始 JSON，失败时复用通用错误摘要。缺少 server 维度信息，成功结果的文本内容可读性差，识别度不足。

目标：为 MCP 工具新增专属展示卡片，标题区展示 server 徽标与工具名，正文按状态展示输入参数、执行结果（文本/结构化）与失败原因，整体风格与现有 Shell、问答卡片一致并带 MCP 识别度。

## 现状数据链路

- 主进程 `electron/main/modules/mcp/tools.mts` 的 `toMcpSdkToolName(serverId, toolName)` 生成 `mcp_${hex(serverId)}_${hex(toolName)}`，`part.toolName` 在渲染端可直接解析回 serverId 与原始工具名。
- MCP 工具执行结果经 `electron/main/modules/chat/runtime/tools/results.mts` 归一化为 `AIToolExecutionResult`，`part.result.data` 为 MCP 原始返回，常见结构为 `{ content: [{ type: 'text', text }], structuredContent?, isError? }`。
- 渲染端 `useToolSettingsStore().getMcpServerById(serverId)` 可读取 server 显示名；server 被删除或未加载时无回退展示。
- `BubblePart` 提供折叠容器（标题插槽 + 内容插槽），`BubblePartToolCode` 提供格式化原始数据展示，均可复用。

## 设计

采用方案 A：新增 `ToolMcp.vue` 专属组件，MCP 工具整块走新卡片，不动主进程。

### 工具名解析（新增 util）

新增 `src/components/BChat/utils/mcpTool.ts`：

- `parseMcpToolName(toolName): McpToolIdentity | null`：匹配 `/^mcp_([0-9a-f]+)_([0-9a-f]+)$/i`，将两段 hex 解码为 UTF-8 得到 `{ serverId, toolName }`；任意环节失败返回 `null`。
- `getMcpServerDisplayName(serverId): string`：通过 `useToolSettingsStore().getMcpServerById(serverId)` 读取显示名，server 不存在时回退为 serverId。
- `isMcpToolName(toolName): boolean`：解析结果非空的快捷判断。

`toolLabels.ts` 现有 `getMcpActionAlias` 的解码逻辑迁移到新 util 复用，保持对外文案不变，避免重复实现。

### index.vue 编排调整

- 新增 `isMcpTool` computed，MCP 工具时标题插槽改为「MCP 徽标 + server 名 + 工具名（截断）」，替代当前 `MCP: <工具名>` 文本。
- 正文分发：在 `ToolActivity` 之后新增 `ToolMcp` 分支，MCP 工具渲染专属卡片；Shell、任务、问答、摘要分支与 MCP 工具天然互斥，顺序保持不变。
- `ToolMcp` 内部自行处理输入/结果/错误，不再进入通用 `ToolSummary` 与 `BubblePartToolCode` 的默认路径（原始数据折叠仍复用 `BubblePartToolCode`）。
- 折叠行为沿用 `BubblePart` 规则：`inputting` 与带活动状态的 `executing` 默认展开，`done` 默认折叠。

### 新增 ToolMcp.vue

按状态渲染：

- `inputting` / `executing`：输入参数 key-value 列表。`part.input` 为记录时逐字段展示，标量直接显示，嵌套对象/数组展示 JSON 摘要并支持展开原始数据；无输入时显示「等待模型输入」或「执行中」占位。
- `done` + success：优先从 `result.data.content` 提取 `type: 'text'` 片段拼接为结果文本（人可读）；`structuredContent` 与完整原始数据放入「查看原始数据」折叠区（复用 `BubblePartToolCode`）。
- `done` + failure / cancelled：展示 `result.error.message` 与错误码标签，红色弱提示，样式与 `ToolSummary` 的 failure/cancelled 变体一致。
- 带 `activity` 时保留 `ToolActivity` 进度展示，与现有执行中卡片行为一致。

样式使用 `createNamespace('', 'bubble-part-tool')` 生成 `bubble-part-tool__mcp-*` 类名，卡片底色、圆角、字号沿用现有工具气泡风格（`--bg-secondary`、`--border-primary` 等），MCP 徽标使用主色系小标签。

### 错误处理与回退

- 工具名解析失败（非 MCP 工具或格式异常）时，`isMcpTool` 为 false，走原有展示路径，不阻断渲染。
- server 在 store 中不存在时，徽标回退显示 serverId，卡片其余内容不受影响。
- `result.data` 结构异常（非对象、无 `content` 数组）时，结果区直接展示原始数据，不抛错。

## 测试

- 新增 `test/components/BChat/mcp-tool-utils.test.ts` util 单测：`parseMcpToolName` 正常解析、非法输入返回 null、hex 解码正确；`getMcpServerDisplayName` 命中与回退。
- 新增 `test/components/BChat/bubble-part-tool-mcp.test.ts` BubblePartTool 回归测试：MCP 工具渲染专属卡片、标题含 server 徽标与工具名、成功结果提取文本、失败展示原因、原始数据折叠、非 MCP 工具不受影响。
- 运行定向 Vitest、`pnpm exec tsc --noEmit` 与 `pnpm lint`，确认既有 Shell/问答/任务卡片展示不受影响。

## Changelog

记录到 `changelog/2026-08-04.md` 的 Changed 或 Added 章节。
