# Chat 页面工具自注册设计

## 背景

第一阶段已经用 `useChatContextProvider` 统一了 Editor、WebView、Widget 的页面 binding、生命周期和 Bridge 路由，BChat 不再直接读取三个页面专用 Context Registry。

但页面工具协议曾经分散在多处：

- 页面 `useChatContext` 只注册 schema-only executor 和 Bridge handler。
- `shared/ai/tools` 曾集中声明页面工具名称、Schema 与策略元数据。
- Electron 主进程曾按具体页面工具名执行或投影页面工具。
- BChat 曾需要知道 Editor、WebView、Widget 的当前上下文来源。
- WebView 历史裁剪曾由主进程的页面专用 projector 完成。

2026-08-06 的后续调整进一步收窄页面工具：Editor 和 Widget 不再注册 `read_current_*` 读取工具，只向 Runtime 注入轻量 `current_environment_context`；WebView 保留网页读取与操作工具，操作工具命名为 `operate_current_webpage`。

因此，新增第四种带有新工具的页面仍要同时修改页面、shared Registry、Electron 执行分支和 BChat 展示配置。这与“页面存在即注册，页面消失即注销，Chat 和主进程不关心页面类型”的最终目标冲突。

## 最终目标

- 页面模块一次性注册工具定义、真实 executor、确认信息、展示信息、历史策略与轻量环境上下文。
- BChat 只消费通用页面工具注册能力，不识别页面类型或页面工具名称。
- Electron 主进程只区分应用级主进程工具与本轮已授权的 Renderer 工具，不识别页面类型或页面工具名称。
- 新增第四种页面及其新工具时，只修改该页面模块和对应测试。
- 页面工具在 Runtime 启动时冻结 binding 与 allowlist；运行期间切页不改变已有 Runtime。
- 页面关闭后，原 binding fail-closed，不回退当前页面或其他同类资源。
- 写操作继续经过统一权限与确认流程。
- Runtime 恢复、取消、Watchdog 和结果身份校验继续有效。

## 非目标

- 不把磁盘、设置、MCP、日志等应用级工具迁移到 Renderer。
- 不允许页面注册任意主进程函数或任意 IPC handler。
- 不允许 WebView 页面内容、预加载脚本或第三方脚本直接注册工具。
- 不把所有页面工具合并成 `read_current_page` 或 `operate_current_page` 等宽泛工具。
- 不让运行中的 Runtime 随用户切页漂移。
- 不要求每个页面工具提供定制展示或定制历史策略；未提供时使用安全的通用默认行为。

## 架构边界

### 应用级主进程工具

应用级工具继续由 `shared/ai/tools` 声明并由 Electron 主进程执行，例如：

- 文件与目录读写。
- `create_document`。
- 设置读取与修改。
- MCP 配置。
- 日志查询。
- 应用级资源打开。

这些工具依赖主进程权限、文件系统或持久化能力，不属于页面自注册范围。

### 页面 Renderer 工具

页面绑定工具由页面模块声明并在 Renderer 执行：

- Editor：注册 `current_file` 环境 section，不注册当前文档读取工具。
- WebView：注册 `current_page` 环境 section、`read_current_webpage` 与 `operate_current_webpage`。
- Widget：注册 `current_file` 环境 section，不注册当前 Widget 读取工具。
- 后续任意页面提供的新工具。

页面工具只能通过应用已有的受控 Renderer 能力工作。注册项不能携带主进程函数，也不能扩大 Renderer 原有权限。

BChat 在 Runtime 请求准备阶段自动补充环境元信息：操作系统、IANA 时区、当前本地日期、当前本地具体时间和主工作目录路径。页面模块只注册自身拥有的自描述 `sections`，例如 `current_page` 或 `current_file`，不再实现时间、时区或系统信息工具；新增页面只修改自己的 hook，不要求 Chat 或主进程认识页面类型。

### 通用注册层

```text
src/hooks/useChat/
├── tool/
│   ├── registry.ts
│   └── types.ts
└── useContextRegistry.ts
```

- `useContextRegistry.ts`：通过 `useChatContextProvider` 管理页面注册生命周期，并通过 `useActiveChatContext` 为 BChat 提供通用消费入口。
- `tool/registry.ts`：维护资源、激活状态、工具声明、展示元数据和精确 binding 查询。
- `tool/types.ts`：声明注册项、Runtime 服务、确认、展示、历史和 Bridge 类型。

页面领域类型、输入校验和结果规整保留在页面模块内。通用注册层不建立 Editor、WebView、Widget 的联合类型。

## 核心语义

“当前页面”只用于新 Runtime 的能力发现和 binding 捕获。Runtime 启动后，页面工具始终按启动时冻结的 binding 执行。

例如：

1. Runtime A 在 WebView A 激活时启动，冻结 WebView A 与当时暴露的页面工具。
2. 用户切换到 Widget B。
3. Runtime A 后续仍调用 WebView A 的 executor。
4. 用户发送下一条消息并启动 Runtime B，Runtime B 冻结 Widget B。
5. WebView A 关闭后，Runtime A 返回 `EDITOR_UNAVAILABLE`，不得访问 Widget B 或其他 WebView。

全局激活项只参与新 Runtime 的发现，不参与已启动 Runtime 的工具查找。

## 页面工具注册接口

### Runtime binding

`ChatToolBinding` 继续由 `types/chat-runtime.d.ts` 权威声明：

```ts
/** ChatRuntime 绑定的页面工具资源身份。 */
export interface ChatToolBinding {
  /** 页面工具提供方的稳定命名空间。 */
  readonly providerId: string;
  /** 提供方内部的稳定资源标识。 */
  readonly resourceId: string;
}
```

`providerId` 保持开放的 `string`，不建立页面类型联合。Registry 使用无碰撞的 provider/resource 两级索引。

### 工具确认内容

```ts
/** 页面写工具提供的确认展示内容。 */
export interface ToolContextConfirmation {
  /** 确认标题。 */
  readonly title: string;
  /** 本次操作说明。 */
  readonly description: string;
  /** 可选的操作前文本。 */
  readonly beforeText?: string;
  /** 可选的操作后文本。 */
  readonly afterText?: string;
  /** 是否允许记住授权。 */
  readonly allowRemember?: boolean;
}
```

风险等级始终取自工具 `definition.riskLevel`，页面不能在确认内容中降低风险等级。未提供 `createConfirmation` 的写工具使用通用标题、工具描述和输入摘要。

### Renderer 展示信息

```ts
/** 页面工具的 Renderer 展示扩展。 */
export interface ToolContextPresentation {
  /** 工具可见名称。 */
  readonly label: string;
  /** 将工具结果转换为短摘要。 */
  readonly summarize?: (result: AIToolExecutionResult) => string;
}
```

`presentation` 只保留在 Renderer，不进入 IPC。页面模块未加载或注册项已注销时，BChat 使用工具名和通用 JSON 摘要。

### 历史策略

```ts
/** 可由主进程通用执行的页面工具历史策略。 */
export interface ChatRendererToolHistoryPolicy {
  /** 完整保留，或只保留该工具最新一次完整结果。 */
  readonly mode: 'keep' | 'latest-only';
  /** 旧结果被裁剪后的稳定说明。 */
  readonly placeholder?: string;
  /** 旧调用输入中需要移除的 JSON 路径。 */
  readonly redactInputPaths?: readonly string[];
}
```

`ChatRendererToolHistoryPolicy` 由 `types/chat-runtime.d.ts` 权威声明，`src/hooks/useChat/context/types.ts` 只导入并重新导出，避免共享 Runtime 类型反向依赖 Renderer Hook。

该策略必须 JSON 可克隆。`placeholder` 最长 500 字符；`redactInputPaths` 最多 32 项，每项最长 256 字符，只允许以 `.` 分隔的普通自有属性路径，不允许通配符、数组脚本或 `__proto__`、`prototype`、`constructor` 段。主进程验证并冻结策略，只解释通用字段，不调用页面函数，也不根据工具名称选择 projector。

### 完整页面工具

```ts
/** 页面工具使用的可克隆模型定义。 */
export interface ToolContextDefinition extends Omit<AIToolDefinition, 'description'> {
  /** 页面工具描述必须是可克隆字符串。 */
  readonly description: string;
}

/** 页面一次性注册的完整 Renderer 工具。 */
export interface ToolContextTool {
  /** 模型定义、参数 Schema 和风险等级。 */
  readonly definition: ToolContextDefinition;
  /** 在冻结 binding 对应资源上执行工具。 */
  execute(
    input: unknown,
    context?: AIToolContext,
    metadata?: AIToolExecutionMetadata
  ): Promise<AIToolExecutionResult> | AIToolExecutionResult;
  /** 可选的写操作确认内容生成器。 */
  readonly createConfirmation?: (input: unknown) => ToolContextConfirmation;
  /** 可选的 Renderer 展示能力。 */
  readonly presentation?: ToolContextPresentation;
  /** 可选的主进程通用历史策略。 */
  readonly history?: ChatRendererToolHistoryPolicy;
}
```

工具定义与 executor 在同一个页面模块声明，不再分别维护页面 schema-only executor、shared Registry entry 和主进程执行器。

### 页面注册选项

```ts
/** 页面工具上下文注册选项。 */
export interface ChatContextProviderOptions {
  /** 页面提供方命名空间。 */
  readonly providerId: string;
  /** 当前资源稳定标识。 */
  readonly resourceId: Readonly<Ref<string>>;
  /** 当前资源是否可以提供能力。 */
  readonly available: Readonly<Ref<boolean>>;
  /** 当前页面是否激活。 */
  readonly active: Readonly<Ref<boolean>>;
  /** 读取当前资源的完整页面工具；执行函数可读最新状态，可克隆元数据必须稳定。 */
  readonly getTools: () => ToolContextTool[];
  /** 需要从应用级候选集中隐藏的工具名称。 */
  readonly hiddenToolNames?: readonly string[];
  /** 应用级 Bridge 可以交给该页面处理的 handlers。 */
  readonly appBridgeHandlers?: Readonly<Record<string, ChatBridgeHandler>>;
}
```

Editor、WebView、Widget 各自在本模块暴露 `useChatContext`，并在内部调用 `useChatContextProvider`。

### BChat 通用消费接口

```ts
/** BChat 消费的通用页面工具能力。 */
export interface ActiveChatContext {
  /** 注册、激活、失活或注销时递增。 */
  readonly revision: Readonly<Ref<number>>;
  /** 获取新 Runtime 应绑定的当前页面。 */
  getActiveBinding(): ChatToolBinding | undefined;
  /** 按冻结 binding 和 Runtime 服务创建可执行工具。 */
  getBoundTools(binding: ChatToolBinding, services: ToolContextRuntimeServices): AIToolExecutor[];
  /** 读取绑定页面隐藏的应用级工具名称。 */
  getHiddenToolNames(binding: ChatToolBinding): readonly string[];
  /** 读取绑定页面工具的 Renderer 展示能力。 */
  getPresentation(binding: ChatToolBinding, toolName: string): ToolContextPresentation | undefined;
  /** 仅在所有已注册页面的同名工具展示一致时返回展示能力。 */
  getPresentationByTool(toolName: string): ToolContextPresentation | undefined;
  /** 读取要冻结到 Runtime descriptor 的工具历史策略。 */
  getRendererTools(binding: ChatToolBinding): readonly ChatRendererToolDescriptor[];
  /** 让应用级 Bridge 尝试交给绑定页面处理。 */
  dispatchAppBridge(binding: ChatToolBinding, event: ChatRuntimeBridgeRequestEvent): Promise<ChatBridgeDispatchResult>;
}
```

BChat 只通过该接口工作，不导入页面 Context、页面工具或页面 provider。

## Registry 不变量

Registry 继续维护所有已挂载资源与唯一激活资源，并满足以下约束：

1. 同一时刻最多一个激活 binding。
2. 激活 binding 必须仍然注册。
3. 资源失活只清除激活状态，不注销资源。
4. `resourceId` 变化时先注销旧身份，再注册新身份。
5. owner token 防止旧组件 cleanup 删除同 binding 的新实例。
6. 工具、隐藏工具名、展示和 Bridge 都只按精确 binding 查询。
7. binding 不存在时不回退当前激活项。
8. 单个注册项和最终合并工具集中的工具名称必须唯一。
9. 捕获的 executor 每次执行前重新解析原 binding 与原工具名。
10. 同 binding 更换 owner 后，旧 executor 只允许转发给新 owner 的同名工具，不能调用旧闭包。
11. 页面工具不能覆盖应用级主进程工具；发生名称冲突时请求准备失败。
12. 对外返回的 binding、隐藏工具名、工具定义和可克隆 history 均与页面原对象解耦。
13. 页面工具的 definition、presentation 形状和 history 在单次注册内必须稳定；如需改变必须重新注册。
14. 注册、激活、失活和注销会推进 `revision`。

## Vue 生命周期

- `available` 为 `true` 且 `resourceId` 非空时注册资源。
- `active` 为 `true` 且组件处于 activated 状态时设置当前 binding。
- `active` 变为 `false` 或 `onDeactivated` 时只清除当前 binding。
- 页面失活后保留注册项，后台 Runtime 仍可按原 binding 执行。
- `onActivated` 后重新参与新 Runtime 的当前页面发现。
- `onScopeDispose` 时彻底注销资源。
- 页面关闭后，已捕获 executor 返回 `EDITOR_UNAVAILABLE`。

Context 未就绪时页面保持 `available: false`，不注册半有效工具。

## Runtime 服务与权限

BChat 为具体 Runtime 创建工具时，向通用注册层提供当前 Runtime 的确认适配器。页面不导入 BChat，也不读取会话全局状态。

```ts
/** 页面工具执行所需的通用 Runtime 服务。 */
export interface ToolContextRuntimeServices {
  /** 当前 Runtime 的统一确认适配器。 */
  readonly confirmation: AIToolConfirmationAdapter;
}
```

通用执行包装器按以下顺序工作：

1. 重新按冻结 binding 查找资源。
2. 在执行前检查 Runtime abort signal，已中断时返回 `RUNTIME_INTERRUPTED`。
3. 重新按冻结工具名查找最新 ToolContextTool。
4. 校验资源仍可用，且可克隆元数据没有绕过重新注册发生漂移。
5. `read` 工具直接执行。
6. `write` 与 `dangerous` 工具进入现有权限模式、授权记忆和确认流程。
7. 页面提供 `createConfirmation` 时使用其展示内容，否则生成通用确认。
8. 批准后再次检查 abort signal，然后调用页面 executor；拒绝时返回 `USER_CANCELLED`。
9. 通过独立执行元数据转发 Runtime ID、abort signal 和 activity reporter，不依赖 Editor context 是否存在。
10. 保留页面返回的稳定结果；普通异常归一化为 `EXECUTION_FAILED`。

页面提供的确认内容不能修改 `toolName` 和 `riskLevel`。`dangerous` 工具继续禁止记住授权。

## 工具发现与执行数据流

### 请求准备

1. `useChatRuntimeLauncher` 捕获当前页面 binding。
2. `useRuntimeTools` 从通用 Registry 读取该 binding 的页面工具。
3. 从应用级工具中移除 `hiddenToolNames`。
4. 合并应用级工具与页面工具，并校验全局名称唯一。
5. 现有工具策略与 allowlist 继续过滤最终列表。
6. Runtime descriptor 冻结实际暴露的 Renderer 工具名称、history 策略和页面 binding。

### 主进程路由

主进程保留现有两类路由：

- 工具名属于 `MAIN_PROCESS_TOOL_NAMES`：进入应用级主进程执行器。
- 工具名不属于主进程集合，但存在于本轮冻结 tools：进入已有 Renderer-managed tool 通道。

主进程不再通过页面工具名决定执行模块。未在本轮 tools 中冻结的名称返回 `TOOL_NOT_FOUND`。

### Renderer 执行

1. 主进程发出通用 renderer tool request。
2. Renderer 按 Runtime ID 读取启动时捕获的 executor 列表。
3. executor 包装器按原 binding 和工具名重新解析注册项。
4. 通用权限层完成确认。
5. 页面 executor 直接读取或操作页面强类型 Context。
6. 结果通过现有 renderer tool result 通道返回。

页面工具不再为正常执行额外发送 `document-snapshot`、`webview-snapshot`、`webview-operate` 或 `widget-snapshot` Bridge 请求。

## Runtime descriptor 与恢复

`ChatRuntimeCapabilityDescriptor` 使用通用 Renderer 工具描述替代仅有名称的列表：

```ts
/** Runtime 冻结的 Renderer 工具能力。 */
export interface ChatRendererToolDescriptor {
  /** 冻结的工具名称。 */
  readonly name: string;
  /** 可选的通用历史策略。 */
  readonly history?: ChatRendererToolHistoryPolicy;
}

/** 主进程保留的 Renderer capability 身份。 */
export interface ChatRuntimeCapabilityDescriptor {
  /** Runtime 启动时实际暴露的 Renderer 工具。 */
  readonly rendererTools: readonly ChatRendererToolDescriptor[];
  /** 启动时冻结的工作区。 */
  workspaceRoot?: string;
  /** 启动时冻结的页面 binding。 */
  toolContext?: ChatToolBinding;
}
```

恢复规则：

- 原页面已经注册：按 descriptor 名称和原 binding 重建 executor。
- 原页面尚未注册：保持 Runtime 路由，但页面 executor 暂时为空。
- 匹配资源稍后注册：Registry `revision` 推进，launcher 重新按原 descriptor 升级 capability。
- 当前激活的是其他页面：不得用于恢复原 Runtime。
- 原工具名已从页面注册项移除：该工具保持不可用，不用新工具替代。

Child Runtime 和恢复 Runtime 同样不能回退当前页面。

## 应用 Bridge

页面工具执行迁移到 Renderer-managed tool 后，删除以下页面工具专用 Bridge handler：

- `document-snapshot`
- `webview-snapshot`
- `webview-operate`
- `widget-snapshot`

应用 Bridge 继续处理设置、资源打开、草稿创建和未保存文件存储等应用级请求。

如果应用级工具确实需要绑定页面参与，可以通过 `appBridgeHandlers` 精确分发。例如 Editor 可继续拦截与自身未保存文档匹配的 `write-file-content`。handler 返回未处理时，应用 Bridge 才进入既有存储回退。

应用 Bridge 不读取当前激活页面，也不回退其他 binding。

## 工具展示

BChat 的页面工具展示改为通用查询：

1. 精确 binding 查询只供 Runtime 绑定场景使用，不回退当前页面。
2. 历史消息没有持久化 binding 时，只有所有已注册同名工具的 label 与摘要能力形状一致，BChat 才复用 presentation。
3. 同名展示存在歧义、模块未加载、presentation 不存在或摘要函数抛错时，label 使用工具名，结果回退安全的通用展示。

Editor、WebView、Widget 现有页面工具 label 与 summary 从 BChat 专用映射迁移到各自页面模块。BChat 不新增后续页面工具名称。

## 通用历史策略

页面工具的 cloneable history 策略随 Runtime descriptor 冻结。主进程在记录 tool-call 时把策略快照写入通用工具消息元数据，使 Runtime 结束后仍可裁剪历史。

通用 projector 只执行声明式操作：

- `keep`：完整保留。
- `latest-only`：同工具只保留最新完整结果，旧结果替换为稳定 placeholder。
- `redactInputPaths`：旧调用中按声明路径移除已失效句柄。

WebView 读取快照使用 `latest-only`；网页操作结果保留，但声明移除 `snapshotId`、`step`、输入文本和导航 URL 等过期或敏感输入路径。WebView 结果在页面 executor 返回前完成领域校验和清洗。Electron 不再导入 WebView 输入/结果 sanitizer，也不再维护 WebView 专用 projector。

未提供 history 时按 `keep` 处理；非法 history 会在 Renderer 注册或主进程 Runtime 描述符入口 fail-closed，不执行不可信策略。

## 现有页面迁移

### Editor

- Editor 不再注册当前文档读取工具。
- Editor 通过页面环境上下文注册当前文件定位信息：文件路径、选中行号和选中行内容。
- `shared/ai/tools/DocumentTool` 只保留应用级 `create_document`。
- Electron `ReadTool` 不包含当前文档读取分支。
- Editor 仅为未保存文件写入保留应用 Bridge handler。

### WebView

- `read_current_webpage` 与 `operate_current_webpage` 的定义和真实 executor 移到 WebView 模块。
- 输入 Schema、常量、动作校验和结果清洗移动到 WebView 页面目录。
- `operate_current_webpage` 使用 `riskLevel: 'write'` 和页面确认内容生成器。
- WebView 读取工具注册 `latest-only`，操作工具注册 `keep` 与失效、敏感输入路径。
- WebView 通过页面环境上下文注册当前页面地址、标题和选中文本。
- 删除 `shared/ai/tools/WebviewTool`。
- 删除 Electron WebView 主进程执行器、输入/结果 sanitizer 和专用历史 projector。
- WebView 不再注册页面工具 Bridge handler。

### Widget

- Widget 不再注册当前 Widget 读取工具。
- Widget 通过页面环境上下文注册当前 Widget 文件路径。
- 删除 `shared/ai/tools/WidgetTool`。
- Electron `ReadTool` 不包含当前 Widget 读取分支。
- Widget 不再注册页面工具 Bridge handler。

## 新页面接入

新增页面只需要：

1. 在页面模块定义强类型 Context。
2. 在页面模块定义一个或多个 `ToolContextTool`。
3. 在页面 `useChatContext` 中调用 `useChatContextProvider`。
4. 添加该页面工具和生命周期测试。

页面自注册工具必须设置 `requiresActiveDocument: false`：该工具通过冻结页面 binding 解析强类型 Context，不依赖旧的外部 Editor context 注入。

不需要修改：

- `shared/ai/tools/index.ts`
- `src/ai/tools/catalog/runtimeTools.ts`
- `src/ai/tools/builtin/index.ts`
- `src/components/BChat/index.vue`
- `src/components/BChat/hooks/useRuntimeTools.ts` 的页面分支
- `src/components/BChat/hooks/useChatRuntimeLauncher.ts` 的页面分支
- `src/components/BChat/utils/toolLabels.ts`
- `src/components/BChat/utils/toolResultSummary.ts`
- Electron 主进程工具 Registry、常量、执行分支或 projector
- `ChatRuntimeCapabilityDescriptor` 的页面专用字段

新增应用级主进程工具仍需要修改 shared Registry 与 Electron 执行协议；这不属于页面自注册。

## 错误处理

| 场景 | 行为 |
|---|---|
| 新 Runtime 启动时没有当前页面 | 不暴露页面工具，不创建 `toolContext` |
| binding 对应资源已关闭或未注册 | 返回 `EDITOR_UNAVAILABLE` |
| 原 binding 存在但工具名已移除 | 返回 `ACTION_NOT_SUPPORTED` |
| 页面输入无效 | 返回 `INVALID_INPUT` |
| 写操作被拒绝 | 返回 `USER_CANCELLED`，不执行页面闭包 |
| 页面 executor 返回稳定失败结果 | 原样保留错误码与消息 |
| 页面 executor 抛出普通异常 | 归一化为 `EXECUTION_FAILED` |
| Renderer 未确认开始或执行超时 | 由现有 Watchdog 返回稳定超时错误 |
| 用户取消 Runtime | abort signal 传入页面 executor，并终结 pending 请求 |
| 用户切换当前页面 | 不影响已启动 Runtime |
| Runtime 恢复时原资源不存在 | 保持原路由，页面工具暂不可执行 |
| presentation 不存在 | 使用通用 label 和结果摘要 |
| history 策略无效 | 注册或 Runtime 启动失败，不执行不可信策略 |

## 测试设计

### Registry 与生命周期

- 注册完整页面工具后可按 binding 读取定义并执行。
- 多个 provider 使用相同 resourceId 不冲突。
- owner token 防止旧 cleanup 影响新实例。
- 页面失活保留资源，卸载彻底注销。
- KeepAlive activate/deactivate 只改变当前 binding。
- resourceId 变化正确迁移。
- 重复工具名和应用工具名冲突被拒绝；跨资源同名展示不一致时安全回退。
- 工具定义不可结构化克隆时拒绝注册；单次注册内元数据漂移时 fail-closed。
- 捕获 executor 在资源注销后 fail-closed。
- 同 binding 更换 owner 后只执行新 owner 的同名工具。

### Renderer 工具执行

- 虚构第四页面注册一个 shared/Electron 完全未知的新工具，模型可发现并通过 Renderer 通道执行。
- 主进程只允许本轮冻结 tools 中的 Renderer 工具。
- 伪造 toolName、runtimeId 或 toolCallId 的结果被拒绝。
- read 工具不弹确认。
- write/dangerous 工具进入通用权限流程。
- 拒绝确认时 executor 不执行。
- abort、活动上报、启动超时与 Watchdog 继续生效。
- 普通异常与稳定失败结果正确归一化。

### Runtime 隔离与恢复

- Runtime A 绑定页面 A，切换 B 后仍执行 A。
- 新 Runtime B 使用切页后的页面 B。
- A 关闭后 Runtime A 不访问 B。
- 两个后台 Runtime 分别绑定不同资源时互不串线。
- Runtime 恢复按原 binding 与 rendererTools 重建能力。
- Runtime 先恢复、原页面后注册时，通过 revision 升级原 capability。
- 页面工具不能绕过冻结 allowlist。

### 展示与历史

- 页面 presentation 提供 label 与摘要。
- 页面模块不存在时使用通用 fallback。
- `keep` 完整保留结果。
- `latest-only` 只保留最新完整结果。
- `redactInputPaths` 删除旧调用中的失效句柄。
- WebView 历史不再依赖工具名专用 projector。

### 现有页面回归

- Editor 环境上下文只包含文件路径、选中行号和选中行内容。
- `read_current_webpage` 保持 BrowserState 与 snapshotId 语义。
- `operate_current_webpage` 保持操作、确认、结果清洗和重新观察约束。
- Widget 环境上下文只包含 Widget 文件路径。
- 未保存文件写入回退保持现有行为。
- 应用级文件、设置、MCP、Skill、Confirmation 与资源工具不受影响。

## 验收标准

- 页面工具由页面模块注册完整定义与真实 executor。
- BChat 源码不存在 Editor、WebView、Widget 或页面工具名的发现、执行、展示分支。
- `shared/ai/tools` 不再声明页面绑定工具。
- Electron 主进程不再声明或按名称执行页面绑定工具。
- Electron 历史裁剪不再识别 WebView 或其他页面工具名。
- 页面工具正常执行不再依赖页面 snapshot/operate Bridge。
- 新增虚构第四页面工具时只修改页面模块和测试即可执行。
- 后台 Runtime、资源关闭、KeepAlive 和恢复语义全部通过测试。
- 写页面工具全部经过统一权限与确认流程。
- Registry、Renderer 通道、展示与 history 测试全部通过。
- 页面专用旧名称与中央配置静态扫描无意外命中。
- ESLint、TypeScript、相关 Stylelint、生产构建和全量 Vitest 通过。

## 实施状态（2026-08-05）

本设计已完成实施：

- Editor、WebView、Widget 均通过各自页面目录中的同名 `useChatContext` 注册完整工具契约。
- 通用 Hook 入口为 `src/hooks/useChat/useContextRegistry.ts`，页面使用 `useChatContextProvider`，BChat 使用 `useActiveChatContext`。
- `shared/ai/tools/WebviewTool`、`shared/ai/tools/WidgetTool` 以及 Electron WebView 专用执行与历史投影已删除；`shared/ai/tools/DocumentTool` 仅保留应用级 `create_document`。
- 页面工具执行、恢复、中断、活动上报、展示和历史投影均通过通用协议处理。
- `test/integration/chat-page-tool-self-registration.test.ts` 以生产代码未知的第四页面工具验证零中心配置接入。
