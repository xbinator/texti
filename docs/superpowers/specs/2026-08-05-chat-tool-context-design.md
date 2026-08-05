# Chat Tool Context 注册抽象设计

## 背景

Editor、WebView 与 Widget 已分别维护工具上下文注册表，但 ChatRuntime 仍直接了解三种页面类型：

- `src/components/BChat/hooks/useChatRuntimeLauncher.ts` 分别捕获 `documentId`、`webviewId` 与 `widgetId`。
- `src/components/BChat/hooks/useRuntimeTools.ts` 分别读取三个 Registry，并按页面类型过滤工具。
- `src/components/BChat/hooks/useRuntimeBridgeHandler.ts` 分别注入 `getEditorContext`、`getWebviewContext` 与 `getWidgetContext`。
- `types/chat-runtime.d.ts` 在 `ChatRuntimeCapabilityDescriptor` 中逐项保存三种页面资源 ID。

因此，每增加一种可以向 ChatRuntime 提供工具的页面，都需要继续修改 BChat 的工具发现、Runtime 绑定与 Bridge 组装逻辑。

现有资源 ID 冻结同时承担安全边界：后台 Runtime 必须继续访问启动时绑定的资源，不能在用户切页后漂移到新的当前页面。该约束必须保留，但绑定格式不应继续暴露具体页面类型。

## 目标

- 在 `src/hooks/useChatToolContext/` 提供统一的页面工具上下文注册 Hook。
- 页面自行注册工具、Bridge handlers、稳定资源身份和激活状态。
- BChat 只消费通用工具上下文，不再区分 Editor、WebView、Widget 或后续页面类型。
- 将三种页面资源 ID 收敛为一个可序列化的通用 Runtime binding。
- 每个 Runtime 在启动时绑定当时的当前页面；运行期间切页不改变已有绑定。
- 下一轮 Runtime 自动使用用户届时激活的页面。
- 支持后台 Runtime、KeepAlive 页面和 Runtime 恢复，不在资源失效后回退到其他当前页面。

## 非目标

- 不把所有页面工具合并成 `read_current_page` 或 `operate_current_page` 等宽泛工具。
- 不允许运行中的 Runtime 实时漂移到用户新切换的页面。
- 不把工作区、模型、Skill、MCP、Confirmation 等非页面能力纳入该 Registry。
- 不消除新增工具所需的共享 schema、主进程执行协议、工具目录、结果展示和测试工作。
- 不让页面注册任意主进程代码；注册内容仅为 Renderer 内的工具描述与 Bridge handler。

## 核心语义

“当前页面”只用于新 Runtime 的能力发现和绑定。Runtime 一旦启动，所有页面工具与 Bridge 请求都按其冻结的通用 binding 查找资源。

例如：

1. Runtime A 在 WebView A 激活时启动，绑定 WebView A。
2. 用户切换到 Widget B。
3. Runtime A 后续仍访问 WebView A。
4. 用户发送下一条消息并启动 Runtime B，Runtime B 绑定 Widget B。
5. 如果 WebView A 已关闭，Runtime A 返回资源不可用，不得改为访问 Widget B 或其他 WebView。

该语义兼顾页面扩展性与后台 Runtime 的资源隔离。

## 文件结构

```text
src/hooks/useChatToolContext/
├── index.ts
├── registry.ts
└── types.ts
```

- `index.ts`：提供页面注册 Hook 和 Chat 消费 Hook，接管 Vue 生命周期。
- `registry.ts`：维护已注册资源、当前激活资源与按 binding 查找能力。
- `types.ts`：复用共享 Runtime binding，并声明 Renderer 注册项、Bridge handler 与公开返回类型。

页面领域类型继续保留在原目录，例如 Editor 的 `AIToolContext`、WebView 的 `WebviewToolContext` 与 Widget 的 `WidgetToolContext`。通用 Registry 不建立三者的联合类型。

## 公共接口

### Runtime binding

`ChatToolBinding` 的权威声明放在 `types/chat-runtime.d.ts`，确保 Renderer、preload 与主进程可以共同引用，避免共享类型层反向依赖 `src/hooks`。`src/hooks/useChatToolContext/types.ts` 只导入并重新导出该类型。

```ts
/**
 * ChatRuntime 绑定的页面工具资源身份。
 */
export interface ChatToolBinding {
  /** 页面工具提供方的稳定命名空间。 */
  readonly providerId: string;
  /** 提供方内部的稳定资源标识。 */
  readonly resourceId: string;
}
```

`providerId` 使用可扩展的 `string`，不建立 Editor、WebView、Widget 的封闭联合类型。Registry 使用嵌套 Map 或等价的无碰撞组合键按 `providerId` 和 `resourceId` 查找，不要求不同提供方共享 ID 空间。

### Bridge handler

```ts
/**
 * 页面 Bridge handler 的处理结果。
 */
export type ChatBridgeDispatchResult =
  | { readonly handled: true; readonly data: unknown }
  | { readonly handled: false };

/**
 * 页面 Bridge 请求处理器。
 */
export type ChatBridgeHandler =
  (event: ChatRuntimeBridgeRequestEvent) => Promise<ChatBridgeDispatchResult> | ChatBridgeDispatchResult;
```

注册项按 `event.kind` 提供 handler。Handler 显式返回是否处理请求；没有对应 handler 时 Registry 返回 `handled: false`，供应用级 Bridge 决定是否继续处理或返回稳定错误。显式结果可以让 `write-file-content` 在目标不属于绑定页面时安全进入应用级存储回退。

### 页面注册选项

```ts
/**
 * 页面工具上下文注册选项。
 */
export interface UseChatToolContextOptions {
  /** 页面工具提供方命名空间。 */
  readonly providerId: string;
  /** 当前资源稳定标识。 */
  readonly resourceId: Readonly<Ref<string>>;
  /** 当前资源上下文是否已经可以提供工具。 */
  readonly available: Readonly<Ref<boolean>>;
  /** 当前页面是否激活。 */
  readonly active: Readonly<Ref<boolean>>;
  /** 创建当前资源提供的工具执行器。 */
  readonly getTools: () => AIToolExecutor[];
  /** 当前资源需要从应用级候选集中隐藏的工具名称。 */
  readonly hiddenToolNames?: readonly string[];
  /** 当前资源支持的 Bridge handlers。 */
  readonly bridgeHandlers: Readonly<Record<string, ChatBridgeHandler>>;
}
```

页面通过闭包保留自身强类型上下文。Registry 只调用 `getTools` 和对应 handler，不读取页面领域对象，也不使用 `any`。

### 页面侧 Hook

```ts
/**
 * 注册页面提供给 ChatRuntime 的工具上下文。
 * @param options - 页面工具上下文选项
 */
export function useChatToolContext(options: UseChatToolContextOptions): void;
```

该 Hook 统一处理注册、资源 ID 变化、激活、失活和卸载，页面不再直接操作全局 Registry。

### Chat 消费 Hook

```ts
/**
 * ChatRuntime 使用的页面工具能力。
 */
export interface ActiveChatTools {
  /** Registry 发生注册、激活或注销变化时递增的只读修订号。 */
  readonly revision: Readonly<Ref<number>>;
  /** 获取当前激活页面的 binding。 */
  getActiveBinding(): ChatToolBinding | undefined;
  /** 按 binding 获取对应资源的工具。 */
  getBoundTools(binding: ChatToolBinding): AIToolExecutor[];
  /** 按 binding 获取页面要求隐藏的应用级工具名称。 */
  getHiddenToolNames(binding: ChatToolBinding): readonly string[];
  /** 按 binding 分发页面 Bridge 请求。 */
  dispatchBridge(binding: ChatToolBinding, event: ChatRuntimeBridgeRequestEvent): Promise<ChatBridgeDispatchResult>;
}

/**
 * 获取 ChatRuntime 的页面工具消费能力。
 * @returns 通用页面工具能力
 */
export function useActiveChatTools(): ActiveChatTools;
```

BChat 只能通过该接口发现和访问页面能力，不导入页面 Registry 或页面上下文类型。

## Registry 设计

Registry 维护两类状态：

- `registrations`：所有仍然挂载、可供已绑定 Runtime 使用的资源。
- `activeKey`：当前页面对应的唯一激活资源。

每次注册生成内部 owner token。注销、资源 ID 变化和生命周期 cleanup 必须携带该 token；只有 token 与当前记录一致时才能删除记录或清除激活标识。这样可以避免旧组件稍晚执行 cleanup 时误删同 ID 的新组件实例。

Registry 应满足以下不变量：

1. 同一时刻最多一个 `activeKey`。
2. 激活资源必须存在于 `registrations`。
3. `getActiveBinding()` 只返回当前激活资源，不猜测最近注册资源。
4. `getBoundTools(binding)` 与 `dispatchBridge(binding, event)` 只按精确 binding 查找。
5. binding 不存在时不得回退 `activeKey`。
6. 对外返回的 binding 使用不可变对象，避免调用方修改 Registry 身份。
7. 单个注册项内工具名称必须唯一；注册时和每次读取动态工具集合时都校验重复名称。
8. `hiddenToolNames` 返回去重后的不可变数组，不能修改应用级工具定义。
9. 注册、激活、失活、注销和清空发生有效状态变化时发布变更通知。
10. Runtime 捕获的页面 executor 在执行时必须重新按原 binding 解析；资源已注销时返回 `EDITOR_UNAVAILABLE`，不得继续调用失效页面闭包。

`getBoundTools(binding)` 和 `getHiddenToolNames(binding)` 在资源不存在时返回空数组，使工具恢复阶段无法重建失效页面能力；`dispatchBridge(binding, event)` 在资源不存在时抛出带 `EDITOR_UNAVAILABLE` 稳定错误码的错误。

Registry 核心通过 `subscribe(listener)` 发布状态变化，不直接依赖 Vue。`useActiveChatTools()` 将通知投影为只读 `revision` ref；Runtime launcher 监听该修订号，使恢复 Runtime 可以在原页面晚于恢复流程重新注册时再次升级 capability。

## Vue 生命周期

页面注册和激活是两个不同概念：

- `available` 为 `true` 且 `resourceId` 非空时注册资源。
- `active` 变为 `true`、组件 `onActivated` 时设置为当前资源。
- `active` 变为 `false`、组件 `onDeactivated` 时只清除当前标识。
- 页面失活后仍保留注册项，确保后台 Runtime 可以继续按 binding 访问原资源。
- `resourceId` 变化时先清理旧注册，再注册新资源。
- `onBeforeUnmount` 时彻底注销资源。
- 页面关闭导致注册项消失后，已绑定 Runtime 后续请求失败并保持 fail-closed。

如果页面 Context 尚未就绪，页面将 `available` 保持为 `false`，Hook 不创建半有效注册项。Context 就绪后由 `available` 变化触发注册。

## 工具发现与执行

`src/components/BChat/hooks/useRuntimeTools.ts` 继续负责应用级工具、工作区工具、Skill、MCP、Widget 定义资源和确认能力。页面相关工具改由 `useActiveChatTools()` 提供。

请求准备阶段：

1. `useChatRuntimeLauncher` 调用 `getActiveBinding()` 捕获当前页面 binding。
2. `useRuntimeTools` 使用该 binding 调用 `getBoundTools(binding)` 与 `getHiddenToolNames(binding)`。
3. 先从应用级工具中移除页面声明隐藏的工具，再合并页面工具并进入现有工具策略和 allowlist。
4. Runtime descriptor 保存实际暴露的 `rendererToolNames` 与通用 binding。

执行阶段：

1. Actor system 仍按 Runtime ID 保存冻结的工具 allowlist。
2. 页面工具执行与 Bridge 请求使用该 Runtime 的通用 binding；Renderer executor 每次执行时重新确认该 binding 仍注册并仍提供同名工具。
3. Registry 按 binding 找到原页面注册项。
4. 当前页面切换不参与已有 Runtime 的查找。

模型工具列表在一次 Runtime 开始时已经确定。切页不会给运行中的 Runtime 动态增加新页面工具；新页面工具从下一轮 Runtime 开始暴露。

恢复 Runtime 仍使用 descriptor 中的原 binding。若恢复发生时资源尚未注册，页面工具暂时为空；匹配资源稍后注册会推进 Registry `revision`，launcher 随即按原 allowlist 和原 binding 重建 capability，不会绑定当前其他页面。

## Runtime descriptor

`ChatRuntimeCapabilityDescriptor` 将页面相关字段收敛为：

```ts
/**
 * Cloneable renderer capability identity retained by the main-process runtime.
 */
export interface ChatRuntimeCapabilityDescriptor {
  /** Renderer tool names exposed when the runtime started. */
  readonly rendererToolNames: readonly string[];
  /** Workspace root captured when renderer tools were registered. */
  workspaceRoot?: string;
  /** Page tool resource captured when the runtime started. */
  toolContext?: ChatToolBinding;
}
```

移除 `documentId`、`webviewId` 与 `widgetId`。工作区继续独立冻结，因为它属于会话运行配置，不属于相邻页面注册能力。

`RuntimeToolResourceBinding` 和 `RuntimeToolBinding` 同样改为携带 `toolContext?: ChatToolBinding`。BChat 的 launcher、工具创建与恢复逻辑只复制该通用字段。

## Bridge 路由

Bridge 分为两类：

- 页面 Bridge：依赖具体页面实例，例如 `document-snapshot`、`webview-snapshot`、`webview-operate`、`widget-snapshot`。
- 应用 Bridge：不依赖页面类型，例如设置读取、设置修改、打开资源与未保存文件存储访问。

`src/components/BChat/utils/runtimeBridge.ts` 保留应用 Bridge 处理，并通过注入的通用 dispatcher 处理页面 Bridge。它不再接收 `getEditorContext`、`getWebviewContext` 或 `getWidgetContext`。

分发规则如下：

1. 已明确属于应用级的 kind 由应用 Bridge 直接处理；`write-file-content` 是唯一允许绑定页面先行拦截的应用级 kind。
2. 其余 kind 交给 `dispatchBridge(binding, event)`。
3. binding 对应资源不存在时返回 `EDITOR_UNAVAILABLE`。
4. 资源存在但未注册该 kind 时返回 `ACTION_NOT_SUPPORTED`。
5. 不支持的 kind 不回退其他页面，也不读取当前激活页面。

`write-file-content` 保留现有未保存文件存储回退。若绑定页面注册了该 kind，则先允许页面处理与自身资源匹配的写入；页面返回未处理时，再走应用级未保存文件存储逻辑。真实文件仍由主进程直接读写，不改变现有边界。

## 页面迁移

### Editor

Editor 注册：

- `providerId: 'editor'`
- `resourceId: documentId`
- `read_current_document` 等编辑器页面工具
- `document-snapshot` handler
- 与当前文档匹配时的 `write-file-content` handler

Editor 的工具上下文继续使用 `AIToolContext`，但只存在于 Editor 注册闭包中。

### WebView

WebView 注册：

- `providerId: 'webview'`
- `resourceId: routeFullPath` 或现有稳定 WebView 标签 ID
- `read_current_webpage` 与 `operate_webpage`
- 隐藏应用级 `open_resource`，保持 WebView 激活时由网页工具承担导航的现有策略
- `webview-snapshot` 与 `webview-operate` handlers

WebView 失活时保留注册项，关闭标签时注销。

### Widget

Widget 注册：

- `providerId: 'widget'`
- `resourceId: fileId`
- `read_current_widget`
- `widget-snapshot` handler

Widget 的 `WidgetToolContext` 继续由 Widget 页面创建并通过闭包读取最新数据。

迁移完成后删除或收敛以下页面专用 Registry：

- `src/ai/tools/context/editor.ts`
- `src/ai/tools/context/webview.ts` 中的 Registry 部分
- `src/ai/tools/context/widget.ts` 中的 Registry 部分

页面领域上下文类型与创建逻辑继续保留，不因删除 Registry 而合并类型。

## 新页面接入

新增页面需要：

1. 定义页面自身强类型 Context。
2. 定义或复用共享工具 schema。
3. 在主进程或 Renderer 提供对应执行协议。
4. 在页面中调用 `useChatToolContext` 注册工具和 Bridge handlers。
5. 补充工具标签、结果摘要和测试。

不需要修改：

- `src/components/BChat/index.vue`
- `src/components/BChat/hooks/useChatRuntimeLauncher.ts` 的页面类型分支
- `src/components/BChat/hooks/useRuntimeTools.ts` 的页面类型分支
- `src/components/BChat/hooks/useRuntimeBridgeHandler.ts` 的页面 getter 列表
- `ChatRuntimeCapabilityDescriptor` 的页面专用字段

新增全新工具仍需要修改共享工具与主进程协议，这是工具系统扩展，不属于 BChat 页面耦合。

## 错误处理

| 场景 | 行为 |
|---|---|
| 新 Runtime 启动时没有当前页面 | 不暴露页面工具，不创建 `toolContext` |
| binding 对应资源已关闭或未注册 | 返回 `EDITOR_UNAVAILABLE` |
| 资源存在但不支持请求的 Bridge kind | 返回 `ACTION_NOT_SUPPORTED` |
| 页面 handler 返回稳定工具错误 | 原样透传错误码与消息 |
| 页面 handler 抛出普通错误 | 归一化为现有 Bridge 执行失败结果 |
| 已捕获的 Renderer 页面 executor 执行时资源已注销 | 返回 `EDITOR_UNAVAILABLE`，不调用旧闭包 |
| 用户切换当前页面 | 不影响已启动 Runtime |
| Runtime 恢复时原资源仍注册 | 按通用 binding 恢复 |
| Runtime 恢复时原资源不存在 | 保持 Runtime 路由，但页面请求 fail-closed |

## 并发与安全边界

- 多个 Runtime 可以同时绑定不同页面资源。
- 全局 `activeKey` 只服务新 Runtime 的发现，不能用于已启动 Runtime 的执行。
- 后台 Runtime、恢复 Runtime 和 Child Runtime 均不得回退当前页面。
- 工具 allowlist 仍按 Runtime 冻结，注册中心不能绕过主进程已批准的工具名称。
- 页面关闭后，资源在未注册期间不可访问；重新打开其他资源不会继承旧 binding。
- 使用相同 `providerId` 与 `resourceId` 重新打开同一逻辑资源时，可以恢复按该稳定身份查找；内部 owner token 只用于防止旧 cleanup 破坏新注册，不写入 Runtime descriptor。

## 测试设计

### Registry 单元测试

- 注册资源后可以按 binding 获取工具并分发 Bridge。
- 多个提供方使用相同 `resourceId` 时不会冲突。
- 设置当前资源后 `getActiveBinding()` 返回不可变 binding。
- 清除当前资源不会删除已注册资源。
- 注销资源后按旧 binding 查找失败。
- 旧 owner token 的 cleanup 不影响同 key 的新注册。
- 单个注册项包含重复工具名称时拒绝注册。
- 动态工具集合在每次读取时重新校验重名。
- `hiddenToolNames` 去重并保持只读，不能改写应用级工具集合。
- 资源存在但没有目标 handler 时返回未处理。
- Runtime 捕获的页面 executor 在资源注销后 fail-closed，同 binding 更换 owner 后只调用新 owner。

### Hook 生命周期测试

- `available` 为 `false` 时不注册。
- `active` 变为 `true` 时设置当前资源。
- `active` 变为 `false` 或 `onDeactivated` 时仅清除当前标识。
- `onActivated` 后重新成为当前资源。
- `resourceId` 变化时正确迁移注册。
- `onBeforeUnmount` 时彻底注销。

### BChat 集成测试

- BChat 页面工具发现只依赖通用 Hook。
- Editor、WebView、Widget 分别注册时暴露各自工具。
- Runtime A 绑定页面 A，切到页面 B 后仍读取 A。
- 新 Runtime B 在切页后绑定 B。
- A 被关闭后 Runtime A 返回 `EDITOR_UNAVAILABLE`，不访问 B。
- 两个后台 Runtime 分别绑定不同资源时互不串线。
- 绑定页面不支持 Runtime 请求时返回 `ACTION_NOT_SUPPORTED`，不回退当前页面。
- Runtime 恢复按 `toolContext` 重建能力。
- Runtime 先恢复、原页面后注册时，通过 Registry `revision` 重新升级原 binding capability。
- 页面工具不能绕过 Runtime 的 `rendererToolNames` allowlist。

### 回归检查

- `read_current_document` 保持现有读取结果。
- `read_current_webpage` 与 `operate_webpage` 保持快照和操作语义。
- `read_current_widget` 保持 WidgetData JSON 结果。
- 未保存文件读取与写入保持现有行为。
- 工作区工具、Skill、MCP、Confirmation 与应用 Bridge 不受影响。

## 验收标准

- BChat 源码中不再导入 Editor、WebView 或 Widget 的工具 Context Registry。
- BChat Runtime binding 不再声明页面专用 ID 字段。
- 三种现有页面全部通过 `useChatToolContext` 注册能力。
- 后台 Runtime 在用户切页后仍访问启动时绑定的资源。
- 已绑定资源关闭后请求失败且不回退当前页面。
- 新增第四种页面时无需为其修改 BChat 页面类型分支。
- Registry、Hook 生命周期、Runtime 隔离与恢复测试全部通过。
- ESLint、Stylelint（涉及样式时）和 TypeScript 类型检查通过。
