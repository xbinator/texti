# Chat 页面工具完全自注册实施计划

> **For Codex:** 使用 `executing-plans` 按任务顺序实施；每个任务先写失败测试，再写最小实现，再运行定向验证。用户明确要求不提交代码，因此所有 `git commit` 步骤均省略，只保留工作区改动供用户自行提交。

**目标：** 新增一种页面及其页面工具时，只需在该页面的 `useChatContext` 中注册工具定义、真实执行器、确认策略、展示信息和历史策略；`BChat`、`shared/ai/tools` 与 Electron 主进程不再增加页面专用分支。

**架构：** 页面工具由渲染进程注册中心持有，BChat 只读取当前绑定并把不可变能力快照交给 Chat Runtime。Electron 主进程继续负责模型流、通用权限 IPC 与历史压缩，但只依据运行时携带的通用工具描述符处理渲染器工具，不识别 Editor、WebView、Widget 或具体页面工具名。应用级工具仍保留在 `shared/ai/tools` 与主进程。

**技术栈：** Vue 3、TypeScript、Electron、Vercel AI SDK、Pinia、Vitest、ESLint、Stylelint。

## 全局约束

- 不执行 `git add`、`git commit` 或分支操作。
- 遵守 `AGENTS.md`：禁止 `any`，所有新增文件、函数、接口和复杂逻辑必须有说明注释。
- 异步错误归一化使用 `src/utils/asyncTo.ts`；不新增异步 `try/catch`。
- 页面工具注册及运行时能力快照必须 fail-closed：绑定过期、工具消失、工具描述符不一致时拒绝执行。
- 所有跨进程数据必须可结构化克隆；函数只能留在渲染进程注册中心，不能进入运行时描述符。
- 每个任务结束只检查 diff 和测试结果，不提交代码。

---

### 任务 1：扩展页面工具注册契约与通用权限执行器

**文件：**

- 修改：`types/chat-runtime.d.ts`
- 修改：`src/hooks/useChat/lib/types.ts`
- 修改：`src/hooks/useChat/lib/registry.ts`
- 修改：`src/hooks/useChat/useChatContextRegistry.ts`
- 修改：`src/ai/tools/permission.ts`
- 测试：`test/hooks/tool-context-registry.test.ts`
- 测试：`test/ai/tools/permission.test.ts`

**步骤 1：先写失败测试**

为注册中心补充以下测试：

- `getTools` 返回重复工具名时拒绝注册或读取。
- `getBoundTools(binding, services)` 只绑定精确 binding 的真实执行器。
- 写工具在执行前调用确认适配器；拒绝后不执行页面 handler。
- 注册被同 binding 的新 owner 替换后，旧执行器只转发给新 owner 的同名工具；资源卸载后拒绝执行。
- 展示信息和历史策略只能从精确绑定读取。
- 非法历史策略（超长占位符、危险路径、过多路径）在注册时被拒绝。

为权限层补充一个保留 `AIToolExecutionResult` 的通用执行测试：成功、失败、拒绝和记住授权四种情况。

**步骤 2：运行测试确认失败**

运行：

```bash
pnpm vitest run test/hooks/tool-context-registry.test.ts test/ai/tools/permission.test.ts
```

预期：新契约尚未实现，类型检查或断言失败。

**步骤 3：实现共享运行时策略类型**

在 `types/chat-runtime.d.ts` 定义仅包含可克隆数据的策略：

```ts
/**
 * 渲染器工具的历史投影策略。
 */
export interface ChatRendererToolHistoryPolicy {
  /** 多次调用是否只保留最新一次完整输出。 */
  mode: 'keep' | 'latest-only'
  /** 被裁剪输出的替代文本。 */
  placeholder?: string
  /** 写入模型历史前需要移除的输入字段路径。 */
  redactInputPaths?: string[]
}

/**
 * 运行时可授权的渲染器工具描述符。
 */
export interface ChatRendererToolDescriptor {
  /** 工具名称。 */
  name: string
  /** 历史投影策略。 */
  history: ChatRendererToolHistoryPolicy
}
```

把 `ChatToolRuntimeDescriptor` 的 `rendererToolNames` 替换为 `rendererTools`。

**步骤 4：实现页面注册契约**

在 `src/hooks/useChat/lib/types.ts` 定义：

```ts
/**
 * 页面注册的单个聊天工具。
 */
export interface ToolContextTool {
  /** 模型定义、参数 Schema 和风险等级。 */
  definition: ToolContextDefinition
  /** 在冻结 binding 对应资源上执行工具。 */
  execute(input: unknown, context?: AIToolContext): Promise<AIToolExecutionResult> | AIToolExecutionResult
  /** 可选的确认展示内容生成器。 */
  createConfirmation?: (input: unknown) => ToolContextConfirmation
  /** 可选的工具历史投影策略。 */
  history?: ChatRendererToolHistoryPolicy
  /** 可选的工具展示信息。 */
  presentation?: ToolContextPresentation
}

/**
 * 页面工具展示信息。
 */
export interface ToolContextPresentation {
  /** 工具显示名称。 */
  label: string
  /** 生成工具结果摘要。 */
  summarize?: (result: unknown) => string
}

/**
 * 页面工具运行时服务。
 */
export interface ToolContextRuntimeServices {
  /** 通用工具确认适配器。 */
  confirmation: AIToolConfirmationAdapter
}
```

`ChatContextProviderOptions.getTools` 改为返回 `ToolContextTool[]`，页面级桥接重命名为可选 `appBridgeHandlers`，并提供按精确绑定读取工具和展示信息的方法。

**步骤 5：实现通用权限包装**

在 `src/ai/tools/permission.ts` 增加 `executeResultWithPermission`，复用现有 permission store、确认请求和生命周期回调，但让 `operation` 直接返回 `AIToolExecutionResult`，不重复包装页面工具结果。只有真实执行成功时才持久化授权。

**步骤 6：实现注册中心校验和 fail-closed 绑定**

注册时验证：

- 工具名非空且同一 provider 内唯一。
- 工具定义名称非空，且页面返回的定义与 execute 始终属于同一工具对象。
- 展示信息只引用已注册工具。
- 历史策略使用默认值补齐并冻结。
- `redactInputPaths` 只允许自有属性点路径，拒绝 `__proto__`、`prototype`、`constructor`。

绑定执行器每次执行前重新确认 provider、version 和工具仍存在，然后通过 `executeResultWithPermission` 调用真实页面执行器。

**步骤 7：运行定向测试**

```bash
pnpm vitest run test/hooks/tool-context-registry.test.ts test/ai/tools/permission.test.ts
pnpm exec tsc --noEmit
```

预期：全部通过。

---

### 任务 2：把运行时能力快照改为通用渲染器工具描述符

**文件：**

- 修改：`src/ai/chat/runtimeCapabilities.ts`
- 修改：`src/components/BChat/hooks/useRuntimeTools.ts`
- 修改：`src/components/BChat/hooks/useChatRuntimeLauncher.ts`
- 修改：`src/hooks/useChat/useRuntimeRecovery.ts`
- 修改：`electron/main/modules/chat/runtime/types.mts`
- 修改：`electron/main/modules/chat/runtime/service.mts`
- 修改：`electron/main/modules/chat/runtime/stream/tools.mts`
- 测试：`test/ai/chat/runtime-capabilities.test.ts`
- 测试：`test/components/BChat/session-id-runtime.test.ts`
- 测试：`test/electron/main/modules/chat/runtime/service.test.ts`
- 测试：`test/electron/main/modules/chat/runtime/stream-tools.test.ts`

**步骤 1：先写失败测试**

覆盖：

- 能力快照冻结 `{ name, history }`，调用方后续修改原对象不影响运行时。
- 重复渲染器工具名被拒绝。
- `isRendererManagedTool` 只认可当前运行时描述符中的工具。
- 恢复运行时会保留描述符，旧版缺失字段按空列表兼容。
- BChat 传入的是注册中心生成的描述符，而不是页面名分支。

**步骤 2：运行测试确认失败**

```bash
pnpm vitest run test/ai/chat/runtime-capabilities.test.ts test/components/BChat/session-id-runtime.test.ts test/electron/main/modules/chat/runtime/service.test.ts test/electron/main/modules/chat/runtime/stream-tools.test.ts
```

**步骤 3：迁移能力快照**

统一使用：

```ts
const rendererTools: ChatRendererToolDescriptor[] = pageTools.map((tool: ToolContextTool): ChatRendererToolDescriptor => ({
  name: tool.definition.name,
  history: tool.history,
}))
```

对数组、描述符、历史策略和路径数组逐层复制并冻结。主进程只按工具名做授权判断，不导入页面常量。

**步骤 4：迁移 BChat 工具绑定**

`useRuntimeTools` 从当前工具上下文取得工具，并传入 `createConfirmationAdapter(binding)`。工具执行列表与描述符来自同一次精确绑定读取；任一步失败都返回空页面工具列表，避免定义与 handler 错配。

**步骤 5：运行定向测试与类型检查**

```bash
pnpm vitest run test/ai/chat/runtime-capabilities.test.ts test/components/BChat/session-id-runtime.test.ts test/electron/main/modules/chat/runtime/service.test.ts test/electron/main/modules/chat/runtime/stream-tools.test.ts
pnpm exec tsc --noEmit
```

---

### 任务 3：实现声明式的通用工具历史投影

**文件：**

- 修改：`types/chat.d.ts`
- 新增：`electron/main/modules/chat/runtime/context/renderer-tool-output.mts`
- 修改：`electron/main/modules/chat/runtime/context/model-message.mts`
- 修改：`electron/main/modules/chat/runtime/compaction/projector.mts`
- 修改：`electron/main/modules/chat/runtime/stream/message-parts.mts`
- 修改：`electron/main/modules/chat/runtime/stream/chunks.mts`
- 删除：`electron/main/modules/chat/runtime/context/webview-tool-output.mts`
- 测试：`test/electron/main/modules/chat/runtime/renderer-tool-output.test.ts`
- 修改：`test/electron/main/modules/chat/runtime/compaction-projector.test.ts`
- 修改：`test/electron/main/modules/chat/runtime/compaction-quality.test.ts`

**步骤 1：先写失败测试**

覆盖：

- `keep` 原样保留多次调用。
- `latest-only` 只保留最新成功/失败调用的完整输出，旧输出替换为受限占位符。
- `redactInputPaths` 在送入模型前删除嵌套自有字段，但不改变数据库中的原始消息。
- 数组索引、缺失路径和非普通对象安全处理。
- 原型污染路径在能力入口被拒绝，投影器仍防御性忽略。
- 页面工具策略随工具调用 part 持久化，运行时恢复和压缩后仍一致。

**步骤 2：运行测试确认失败**

```bash
pnpm vitest run test/electron/main/modules/chat/runtime/renderer-tool-output.test.ts test/electron/main/modules/chat/runtime/compaction-projector.test.ts test/electron/main/modules/chat/runtime/compaction-quality.test.ts
```

**步骤 3：持久化工具调用时的策略快照**

在 `ChatMessageToolPart` 增加可选字段：

```ts
/** 工具调用创建时冻结的渲染器历史策略。 */
rendererHistory?: ChatRendererToolHistoryPolicy
```

只有运行时授权的渲染器工具写入该字段；应用级工具不写。策略来自当前运行时描述符，不根据当前页面重新推断。

**步骤 4：实现通用投影器**

新增 `projectRendererOutputs`：先按工具名和会话顺序确定 `latest-only` 的最新调用，再克隆需要脱敏的 input，最后替换旧 output。投影只作用于送模消息和压缩视图，不回写原始消息。

**步骤 5：移除 WebView 专用投影器**

删除 WebView 工具名判断、专用输出裁剪入口和对应专有常量。原 WebView 需要的压缩行为由页面注册的历史策略表达。

**步骤 6：运行定向测试**

```bash
pnpm vitest run test/electron/main/modules/chat/runtime/renderer-tool-output.test.ts test/electron/main/modules/chat/runtime/compaction-projector.test.ts test/electron/main/modules/chat/runtime/compaction-quality.test.ts
pnpm exec tsc --noEmit
```

---

### 任务 4：迁移 Editor 与 Widget 为页面内真实工具

**文件：**

- 修改：`src/components/BEditor/hooks/useChatContext.ts`
- 修改：`src/views/widget/hooks/useChatContext.ts`
- 修改：`shared/ai/tools/DocumentTool/index.ts`
- 删除：`shared/ai/tools/WidgetTool/index.ts`
- 修改：`shared/ai/tools/index.ts`
- 修改：`src/ai/tools/catalog/runtimeTools.ts`
- 修改：`src/ai/tools/builtin/index.ts`
- 修改：`electron/main/modules/chat/runtime/tools/ReadTool/index.mts`
- 修改：`electron/main/modules/chat/runtime/tools/constants.mts`
- 修改：`electron/main/modules/chat/runtime/tools/guards.mts`
- 修改：`electron/main/modules/chat/runtime/tools/types.mts`
- 测试：`test/components/BEditor/use-chat-context.test.ts`
- 测试：`test/views/widget/use-chat-context.test.ts`
- 修改：`test/ai/tools/builtin-index.test.ts`
- 修改：`test/electron/main/modules/chat/runtime/read-tool.test.ts`

**步骤 1：先写失败测试**

- Editor 的 `read_current_document` 直接调用当前页面 snapshot provider。
- Widget 的 `read_current_widget` 直接调用当前页面 snapshot provider。
- 页面卸载后旧执行器拒绝执行。
- 两个读工具都声明 `read` 权限、展示标签与 `keep` 历史策略。
- `shared/ai/tools` 不再导出两个页面读工具。
- Electron ReadTool 不再含 document/widget bridge kind 或页面工具名。

**步骤 2：运行测试确认失败**

```bash
pnpm vitest run test/components/BEditor/use-chat-context.test.ts test/views/widget/use-chat-context.test.ts test/ai/tools/builtin-index.test.ts test/electron/main/modules/chat/runtime/read-tool.test.ts
```

**步骤 3：在页面 hook 中定义并执行工具**

每个页面 hook 就地持有工具名、Zod input schema、`tool()` 定义、真实 handler、权限定义、展示信息和历史策略。handler 使用当前页面实例读取数据并返回标准 `AIToolExecutionResult`；不再发起 `document-snapshot` 或 `widget-snapshot` bridge。

**步骤 4：清理共享和主进程分支**

`DocumentTool` 只保留应用级 `create_document`；删除 `WidgetTool`。从 runtime catalog、builtin exports、ReadTool、constants、guards 和 types 中删除页面读工具相关声明与桥接类型。

**步骤 5：运行定向测试**

```bash
pnpm vitest run test/components/BEditor/use-chat-context.test.ts test/views/widget/use-chat-context.test.ts test/ai/tools/builtin-index.test.ts test/electron/main/modules/chat/runtime/read-tool.test.ts
pnpm exec tsc --noEmit
```

---

### 任务 5：迁移 WebView 读写工具并删除主进程专用实现

**文件：**

- 修改：`src/views/webview/web/hooks/useChatContext.ts`
- 新增：`src/views/webview/web/hooks/chatToolInput.ts`
- 新增：`src/views/webview/web/hooks/chatToolResult.ts`
- 删除：`shared/ai/tools/WebviewTool/index.ts`
- 修改：`shared/ai/tools/index.ts`
- 修改：`src/ai/tools/catalog/runtimeTools.ts`
- 修改：`src/ai/tools/builtin/index.ts`
- 删除：`electron/main/modules/chat/runtime/tools/WebviewTool/index.mts`
- 删除：`electron/main/modules/chat/runtime/tools/WebviewTool/input.mts`
- 删除：`electron/main/modules/chat/runtime/tools/WebviewTool/result.mts`
- 修改：`electron/main/modules/chat/runtime/tools/index.mts`
- 修改：`electron/main/modules/chat/runtime/tools/constants.mts`
- 修改：`electron/main/modules/chat/runtime/tools/guards.mts`
- 修改：`electron/main/modules/chat/runtime/tools/types.mts`
- 测试：`test/views/webview/use-chat-context.test.ts`
- 新增：`test/views/webview/chat-tool-input.test.ts`
- 新增：`test/views/webview/chat-tool-result.test.ts`
- 修改：`test/electron/main/modules/chat/runtime/tool-dispatch.test.ts`

**步骤 1：先写失败测试**

- `read_current_webpage` 直接读取页面快照并进行结果裁剪。
- `operate_webpage` 在渲染进程校验输入、请求通用写权限并执行当前页面操作。
- 拒绝确认时不操作页面；批准时只执行一次。
- WebView 的 input 规范化、结果清洗与 selector 安全规则保持现有行为。
- 历史策略对读工具使用 `latest-only`，并声明需要脱敏的输入字段；写工具按设计使用 `keep` 或明确的 `latest-only`。
- 主进程通用 dispatch 不再识别 WebView 工具名。

**步骤 2：运行测试确认失败**

```bash
pnpm vitest run test/views/webview/use-chat-context.test.ts test/views/webview/chat-tool-input.test.ts test/views/webview/chat-tool-result.test.ts test/electron/main/modules/chat/runtime/tool-dispatch.test.ts
```

**步骤 3：移动纯逻辑到页面模块**

把现有 `WebviewTool/input.mts` 与 `result.mts` 的纯校验、规范化和清洗逻辑迁移到页面 hook 相邻模块，保持测试语义不变。新增文件使用浏览器可用依赖，不导入 Electron 主进程模块。

**步骤 4：注册真实读写工具**

WebView hook 注册完整工具：

- 读工具直接调用 snapshot provider。
- 写工具直接调用 operate provider，并由任务 1 的通用确认层保护。
- 页面注册提供 label、summary 和 history。
- 只保留应用级 `write-file-content` bridge 拦截，不再保留 `webview-snapshot`、`webview-operate`。

**步骤 5：删除集中式 WebView 工具配置**

删除共享 schema、主进程执行器与专用 dispatch 分支，清理 constants/guards/types/runtime catalog/builtin exports。

**步骤 6：运行定向测试**

```bash
pnpm vitest run test/views/webview/use-chat-context.test.ts test/views/webview/chat-tool-input.test.ts test/views/webview/chat-tool-result.test.ts test/electron/main/modules/chat/runtime/tool-dispatch.test.ts
pnpm exec tsc --noEmit
```

---

### 任务 6：移除 BChat 页面知识并完成通用展示/桥接收口

**文件：**

- 修改：`src/components/BChat/utils/toolLabels.ts`
- 修改：`src/components/BChat/utils/toolResultSummary.ts`
- 修改：`src/components/BChat/hooks/useRuntimeBridge.ts`
- 修改：`src/components/BChat/index.vue`
- 修改：`src/hooks/useChat/lib/registry.ts`
- 修改：`src/hooks/useChat/useChatContextRegistry.ts`
- 测试：`test/components/BChat/tool-labels.test.ts`
- 测试：`test/components/BChat/tool-result-summary.test.ts`
- 修改：`test/components/BChat/session-id-runtime.test.ts`
- 修改：`test/hooks/tool-context-registry.test.ts`

**步骤 1：先写失败测试**

- 已注册页面工具从注册中心得到 label 与 summary。
- 未注册或历史页面工具使用通用 fallback，不抛错。
- 同名工具展示冲突 fail-closed，不根据页面类型猜测。
- runtime bridge 只调用通用 `appBridgeHandlers`。
- BChat 相关源码中不出现 Editor/WebView/Widget 页面工具名和页面桥接 kind。

**步骤 2：运行测试确认失败**

```bash
pnpm vitest run test/components/BChat/tool-labels.test.ts test/components/BChat/tool-result-summary.test.ts test/components/BChat/session-id-runtime.test.ts test/hooks/tool-context-registry.test.ts
```

**步骤 3：接入通用展示解析**

`toolLabels` 和 `toolResultSummary` 只保留应用级工具配置与通用 fallback；页面工具展示通过注册中心的精确绑定解析。历史消息在页面未注册时显示工具名和通用 JSON/文本摘要，不恢复页面专用映射。

**步骤 4：重命名并收窄 bridge**

把 `dispatchBridge`/`bridgeHandlers` 收窄为 `dispatchAppBridge`/`appBridgeHandlers`，只用于页面对应用级工具的可选拦截。页面工具执行完全走 renderer-tool controller。

**步骤 5：运行定向测试与静态扫描**

```bash
pnpm vitest run test/components/BChat/tool-labels.test.ts test/components/BChat/tool-result-summary.test.ts test/components/BChat/session-id-runtime.test.ts test/hooks/tool-context-registry.test.ts
rg -n "read_current_document|read_current_webpage|operate_webpage|read_current_widget|document-snapshot|webview-snapshot|webview-operate|widget-snapshot" src/components/BChat electron/main shared/ai/tools
```

预期：测试通过；扫描只允许迁移说明/测试 fixture，不允许生产代码出现页面专用分支。

---

### 任务 7：用“第四页面”集成测试验证真正零中心配置

**文件：**

- 新增：`test/integration/chat-page-tool-self-registration.test.ts`
- 修改：`docs/superpowers/specs/2026-08-05-chat-tool-context-design.md`
- 修改：`changelog/2026-08-05.md`

**步骤 1：写第四页面集成测试**

在测试内创建虚拟 provider `test-page`，只通过 `useChatContextProvider`/registry 注册一个此前不存在的 `inspect_test_page` 工具，验证：

- BChat 可取得定义和真实执行器。
- 主进程通用 renderer-managed 判定接受运行时描述符中的新名字。
- 确认、展示和历史投影均由注册数据驱动。
- provider 卸载后旧 binding 不能执行。
- 实现不需要修改共享工具表、Electron dispatch 或 BChat 工具名映射。

**步骤 2：运行集成测试确认失败，再完成最小修复**

```bash
pnpm vitest run test/integration/chat-page-tool-self-registration.test.ts
```

只修复通用抽象缺口，不添加 `inspect_test_page` 的生产代码或名称分支。

**步骤 3：更新设计文档和 changelog**

把规范中的实施状态更新为已完成，并记录：

- 页面工具定义、执行、确认、展示、历史策略已归属页面注册。
- 删除三个页面工具共享目录/条目与 Electron 页面专用执行分支。
- 保留的应用级工具边界。
- 第四页面集成测试作为长期回归门禁。

**步骤 4：运行定向测试**

```bash
pnpm vitest run test/integration/chat-page-tool-self-registration.test.ts
```

---

### 任务 8：完整验证与最终漏洞审计

**文件：**

- 检查：本计划涉及的全部文件
- 检查：`docs/superpowers/specs/2026-08-05-chat-tool-context-design.md`
- 检查：`changelog/2026-08-05.md`

**步骤 1：运行页面工具相关测试集合**

```bash
pnpm vitest run test/hooks/useChat test/ai/tools test/ai/chat test/components/BChat test/views/webview test/views/widget test/components/BEditor test/electron/main/modules/chat/runtime test/integration/chat-page-tool-self-registration.test.ts
```

**步骤 2：运行静态检查**

```bash
pnpm exec eslint src electron shared test --ext .vue,.ts,.tsx,.js,.jsx,.mts
pnpm exec stylelint 'src/**/*.{vue,less,css}'
pnpm exec tsc --noEmit
```

如果仓库 ESLint 配置不覆盖 `.mts`，再按项目现有 lint 命令验证：

```bash
pnpm lint
pnpm lint:style
```

**步骤 3：运行完整测试和构建**

```bash
pnpm vitest run
pnpm build
```

**步骤 4：做三轮漏洞审计**

第一轮检查架构遗漏：

```bash
rg -n "read_current_document|read_current_webpage|operate_webpage|read_current_widget|document-snapshot|webview-snapshot|webview-operate|widget-snapshot" src/components/BChat electron/main shared/ai/tools
```

第二轮检查遗留集中配置和旧字段：

```bash
rg -n "rendererToolNames|bridgeHandlers|dispatchBridge|WebviewTool|WidgetTool" src electron shared types test
```

第三轮检查类型与安全问题：

```bash
rg -n "\bany\b|__proto__|prototype|constructor" src/hooks/useChat src/views/webview src/views/widget src/components/BEditor electron/main/modules/chat/runtime/context
```

逐条判断命中是否合理；对真实缺口补失败测试、修复并重新执行本任务的全部验证。

**步骤 5：检查最终 diff**

```bash
git diff --check
git status --short
git diff --stat
```

预期：无空白错误；只包含本次功能、规范和 changelog 改动；不暂存、不提交。
