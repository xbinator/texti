# AI 工具开发指南

日期：2026-06-25

更新：2026-08-05

本文档说明如何在当前工具架构下新增或修改 AI 工具。应用级工具的定义和执行拆成两层，页面绑定工具则由页面完整自注册：

- `shared/ai/tools/index.ts` 是已迁移 ChatRuntime 工具的统一聚合入口，导出工具名、`TOOL_REGISTRY` 和 registry 查询函数。
- `shared/ai/tools/<PascalCaseTool>/index.ts` 是单个工具领域的元数据文件，维护该领域的工具名、schema、风险等级、运行时归属、分组和暴露策略。
- `shared/ai/tools/types.ts` 只放 registry 共享类型，例如 `SharedToolDefinition`、`ToolRegistryEntry`、`ToolRuntimeGroup`、`ToolExposure`、`ToolExecutionClass` 和 `AgentToolEffectMetadata`。
- `electron/main/modules/chat/runtime/tools/**/index.mts` 是已迁移工具的主进程执行入口。
- `src/ai/tools/catalog/runtimeTools.ts` 只为 renderer 暴露 schema-only 工具，执行时会提示该工具已迁移到主进程。
- `src/ai/tools/builtin/**/index.ts` 只保留仍需 renderer 本地状态或本地交互的工具。
- `src/hooks/useChat/useContextRegistry.ts` 是页面绑定工具的通用注册与消费入口；工具定义、真实 executor、确认、展示和历史策略归属各页面的 `useChatContext`。

新增工具前，先判断工具属于哪一类，再决定写在哪里。

## 工具类型

### 主进程工具

优先选择这一类。适合：

- 文件、目录、日志、设置、MCP、资源打开等系统或应用级能力。
- 需要统一确认、路径校验、工作区边界、主进程文件系统访问的能力。
- 不应该依赖 Vue store、DOM、当前组件实例的能力。

代码落点：

- 元数据：`shared/ai/tools/<PascalCaseTool>/index.ts`
- 聚合入口：`shared/ai/tools/index.ts`
- 执行逻辑：`electron/main/modules/chat/runtime/tools/<GroupTool>/index.mts`
- 分发入口：`electron/main/modules/chat/runtime/tools/index.mts`
- 共享工具 helper：`electron/main/modules/chat/runtime/tools/*.mts`
- renderer schema-only wrapper：通常由 `src/ai/tools/catalog/runtimeTools.ts` 从 registry 自动派生，不要重复写 schema 字面量。

### 应用级 Renderer-local 工具

仅当工具必须依赖 renderer 本地状态时使用。当前包括：

- `QuestionTool`
- `TodoWriteTool`
- `MemoryTool`
- `ShellTool`
- `SkillTool`
- `WidgetTool`，负责聊天级 Widget 发现与打开，不是 Widget 编辑页的 `read_current_widget`。

代码落点：

- `src/ai/tools/builtin/<ToolName>/index.ts`
- `src/ai/tools/builtin/index.ts`

不要把已经能在主进程完成的工具继续放进 renderer-local 目录。

### 页面绑定 Renderer 工具

工具必须读取或操作某个具体页面实例，且 Runtime 启动后仍必须绑定该实例时，使用页面自注册。当前包括：

- Editor 的 `read_current_document`。
- WebView 的 `read_current_webpage` 和 `operate_webpage`。
- Widget 编辑页的 `read_current_widget`。

代码落点：

- Editor：`src/components/BEditor/hooks/useChatContext.ts`
- WebView：`src/views/webview/web/hooks/useChatContext.ts`
- Widget：`src/views/widget/hooks/useChatContext.ts`
- 新页面：该页面模块自己的 `hooks/useChatContext.ts`
- 通用注册 Hook：`src/hooks/useChat/useContextRegistry.ts`
- 页面领域输入、结果校验：与页面 `useChatContext` 相邻放置
- 测试：页面测试目录及 `test/integration/chat-page-tool-self-registration.test.ts`

页面工具不进入 `shared/ai/tools`、`src/ai/tools/catalog/runtimeTools.ts` 或 Electron 主进程工具分支。BChat 只捕获当前页面 binding 和通用 Renderer 工具描述符，不引用页面类型或工具名。

### SDK-managed 工具

由 AI SDK 或 provider 集成处理，例如 Tavily 和 MCP provider 工具。通常不需要放入本地 builtin 执行器。

## 共享元数据目录

共享工具元数据按 PascalCase Tool 目录组织。每个目录收拢一个工具领域的工具名和 registry entry：

```text
shared/ai/tools/
  index.ts
  types.ts
  AgentStagedFileTool/index.ts
  DelegateTaskTool/index.ts
  DocumentTool/index.ts
  EnvironmentTool/index.ts
  FileEditTool/index.ts
  FileReadTool/index.ts
  FileWriteTool/index.ts
  LogsTool/index.ts
  MCPSettingsTool/index.ts
  OpenResourceTool/index.ts
  SettingsTool/index.ts
```

目录职责：

- `AgentStagedFileTool`：Child Task 私有 overlay 的内部暂存文件写入与编辑工具。
- `DocumentTool`：应用级文档草稿创建工具；当前 Editor 文档读取归属 Editor 页面 `useChatContext`。
- `DelegateTaskTool`：Main Coordinator 拥有的内部延迟委派契约；不进入普通 main/renderer 工具执行器。
- `EnvironmentTool`：当前时间等环境信息工具。
- `FileReadTool`：文件、目录读取工具。
- `FileWriteTool`：文件创建或覆盖工具。
- `FileEditTool`：精确替换类文件编辑工具。
- `LogsTool`：应用日志查询工具。
- `MCPSettingsTool`：MCP 配置读取、增删改和 discovery 刷新工具。
- `SettingsTool`：应用设置读取和修改工具。
- `OpenResourceTool`：打开文件、网页或外部资源工具。

如果新增工具能归入现有领域，就追加到对应目录。只有当工具有新的清晰领域时，才新增 `<PascalCaseTool>/index.ts` 目录。

## 主进程工具新增步骤

### 1. 选定共享元数据目录

先选择或创建 `shared/ai/tools/<PascalCaseTool>/index.ts`。目录名使用 PascalCase，并以 `Tool` 结尾，例如：

- `FileReadTool`
- `FileWriteTool`
- `SettingsTool`

每个目录至少导出：

- 工具名常量，例如 `READ_FILE_TOOL_NAME`
- 工具 registry entry，例如 `readFileToolRegistryEntry`

不要把新工具定义直接写进 `shared/ai/tools/index.ts`。`index.ts` 只负责聚合和导出。

### 2. 增加工具定义

在对应 Tool 目录中新增工具名和 entry。

示例：

```ts
/**
 * @file index.ts
 * @description 示例相关 ChatRuntime 工具定义。
 */
import type { ToolRegistryEntry } from '../types.js';

/** 示例工具名称。 */
export const EXAMPLE_TOOL_NAME = 'example_tool';

/** 示例工具 registry 条目。 */
export const exampleToolRegistryEntry = {
  runtime: 'main',
  group: 'read',
  exposure: 'default-readonly',
  executionClass: 'direct',
  effect: {
    effect: 'pure_read',
    resourceScopeResolver: 'example-query',
    reversible: true
  },
  definition: {
    name: EXAMPLE_TOOL_NAME,
    description: '读取示例信息并返回结构化结果。',
    source: 'builtin',
    riskLevel: 'read',
    requiresActiveDocument: false,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '查询关键字。' }
      },
      required: ['query'],
      additionalProperties: false
    }
  }
} satisfies ToolRegistryEntry;
```

不要在 renderer 和 main 各写一份 schema。共享 Tool 目录是唯一 schema 来源。

每个 registry entry 必须声明：

- `executionClass`：普通工具使用 `direct`；只有拥有专用协调协议、原子 Checkpoint 持久化和恢复语义的内部工具才能使用 `deferred-coordination`。
- `effect.effect`：在 `pure_read`、`external_read`、`staged_file_write`、`transactional_write`、`immediate_side_effect`、`unknown` 中选择事实分类。
- `effect.resourceScopeResolver`：主进程注册的资源范围解析器名称，不能由 Renderer 自报。
- `effect.commitAdapter`：仅事务写域需要，指向未来 commit boundary adapter。
- `effect.reversible`：动作完成后是否存在定义明确的反向操作。

`executionClass` 是调度与安全事实，不是 UI 标签。普通 `direct` 工具返回一个长期 pending 的 Promise，只会让当前 Runtime 继续持锁等待；延长 renderer-tool timeout 或把工具标为 `internal`，也不会获得持久化挂起能力。当前只有 `shared/ai/tools/DelegateTaskTool/index.ts` 定义的 `delegate_task` 通过 Runtime deferred stream 边界和 `electron/main/modules/chat/agents/service.mts` Coordinator 原子 prepare 接入 suspend/resume；它仍为 `internal`，普通 Renderer Runtime 输入会在写消息前被拒绝。

### Coordinator-owned 工具

`runtime: 'coordinator'` 表示工具由 Main Coordinator 拥有，不由普通 main executor、renderer bridge 或 AI SDK 直接执行。此类工具必须同时具备专用契约解析、原子持久化、Checkpoint/Outbox、恢复与续接协议；仅增加 registry entry 不会自动获得这些能力。当前唯一实例是 `shared/ai/tools/DelegateTaskTool/index.ts`。

`delegate_task` 的首阶段执行边界固定为：

- feature flag 默认关闭，只允许 Main 在公开 `send()` 完成 Renderer 输入校验后克隆注入 registry 定义。
- 仅 Primary 可以委派；Child 的 capability 集合始终移除 `delegate_task`，不允许二层 Child。
- Candidate Plan 依次与持久化契约、父 Runtime 工具、当前可用 Main 工具、权限、资源 scope 和只读策略求交集；恢复只能继续收缩。
- Child 只允许 `glob`、`grep`、`read_directory`、`read_file` 中交集后的 `pure_read` 工具，`external_read`、写工具、Renderer bridge 与 provider-supplied 本地工具结果均 fail closed。
- Coordinator 最多并行三个共享只读 lease；Child 使用冻结的 Primary 模型与最小任务包，不写 `chat_messages`。
- 写入 Child、changeset、ConfirmationQueue 与 commit journal 尚未开放，不能通过新增 registry 元数据绕过。

### 3. 接入聚合入口

更新 `shared/ai/tools/index.ts`：

- import 新增的 `exampleToolRegistryEntry`
- export 新增的 `EXAMPLE_TOOL_NAME`
- 将 entry 加入 `TOOL_REGISTRY`

示例：

```ts
import { EXAMPLE_TOOL_NAME, exampleToolRegistryEntry } from './ExampleTool/index.js';

export { EXAMPLE_TOOL_NAME } from './ExampleTool/index.js';

export const TOOL_REGISTRY = [
  // ...existing entries
  exampleToolRegistryEntry
] as const satisfies ToolRegistryEntry[];
```

### 4. 选定主进程执行分组

主进程执行逻辑按目录分组：

- `ReadTool`：主进程环境等只读工具。
- `FileTool`：文件和目录读取、创建、写入、编辑。
- `SettingsTool`：应用设置和 MCP server 配置写入。
- `ResourceTool`：打开文件、网页或其他资源。

共享元数据目录和主进程执行目录不必一一对应。例如：

- `shared/ai/tools/FileReadTool/index.ts` 和 `shared/ai/tools/FileWriteTool/index.ts` 的工具都可以由 `electron/main/modules/chat/runtime/tools/FileTool/index.mts` 执行。
- `shared/ai/tools/MCPSettingsTool/index.ts` 的写操作可以由 `electron/main/modules/chat/runtime/tools/SettingsTool/index.mts` 执行。

如果新工具不属于这些执行分组，先判断是否真的需要新分组。新分组需要同步：

- `shared/ai/tools/types.ts` 的 `ToolRuntimeGroup`
- `electron/main/modules/chat/runtime/tools/constants.mts`
- `electron/main/modules/chat/runtime/tools/index.mts`
- 对应测试

### 5. 实现主进程执行逻辑

在对应 `electron/main/modules/chat/runtime/tools/<GroupTool>/index.mts` 中实现：

- `is<Group>Tool(toolName: string): boolean`
- 输入归一化函数
- 具体执行函数
- 分组入口 `execute<Group>Tool`

结果统一使用：

- `createMainToolSuccessResult`
- `createMainToolFailureResult`
- `createMainToolCancelledResult`
- `createBridgeFailureResult`

这些 helper 在 `electron/main/modules/chat/runtime/tools/results.mts`。

### 6. 处理确认和 bridge

主进程工具依赖来自 `MainToolsDependencies`：

- `requestConfirmation`
- `requestBridge`
- `now`

需要用户确认时，通过 `requestConfirmation`。用户拒绝时返回 cancelled，不要伪装成普通 failure。

主进程无法直接读取 renderer 状态时，通过 `requestBridge`，例如：

- 未保存草稿内容的读写。
- 让 renderer 打开资源或创建草稿

bridge 不是第二套工具运行时，只是主进程向 renderer 请求 UI 状态或 UI 动作的受控 RPC。

页面绑定工具的正常执行不使用 bridge。只有应用级工具确实需要已绑定页面参与时，页面才在 `appBridgeHandlers` 中提供受控拦截，例如 Editor 处理匹配自身的 `write-file-content`。

#### 文件内容读写边界

文件工具必须先区分真实文件路径与 `unsaved://` 草稿路径：

- `read_file`、`write_file` 和 `edit_file` 对真实文件只在主进程读写磁盘，不通过 bridge 查询或修改编辑器内容；bridge 仅服务 `unsaved://` 草稿。
- 真实文件写操作只有在磁盘持久化完成后才能返回成功。
- `write_file` 使用 `atomically.writeFile()` 创建缺失的父目录并原子写入完整内容。
- `edit_file` 从磁盘读取已有文件，完成精确替换后使用同一原子写入能力写回；目标不存在时失败。
- 用户确认后必须重新验证真实文件的存在状态和内容；确认期间发生变化时返回 `STALE_CONTEXT`，不能覆盖新版本或重新创建被删除的编辑目标。
- 同一真实路径的“重新验证 + 原子写入”阶段必须串行执行，避免并发工具调用互相覆盖。
- 写入前解析目标或最近存在父目录的 `realpath`，保留原始词法路径，并在确认后重新解析该路径以验证真实目的地未变化；符号链接把目的地导向工作区外时，按工作区外真实路径展示并使用 `dangerous` 风险确认。
- `unsaved://` 没有磁盘文件，继续通过 `file-content-snapshot` 和 `write-file-content` bridge 更新草稿。

文件是否已在编辑器打开不影响真实路径工具的执行分支。编辑器对外部磁盘变化的响应属于文件监听与冲突协调职责，不能作为文件工具宣称磁盘写入成功的前提。

### 7. 更新分发入口

如果使用已有执行分组，通常只需要在该分组的 `is<Group>Tool` 和 `execute<Group>Tool` 中接入。

如果新增执行分组，需要更新：

- `electron/main/modules/chat/runtime/tools/index.mts`
- `electron/main/modules/chat/runtime/tools/constants.mts`
- `shared/ai/tools/types.ts`

### 8. 补测试

主进程工具测试通常放在：

- `test/electron/main/modules/chat/runtime/main-tools.test.ts`
- 或新增更聚焦的工具测试文件

至少覆盖：

- 成功路径
- 输入非法
- 用户取消确认
- bridge 失败
- 工作区路径边界
- 结果结构是否可序列化

如果修改共享 registry，还要覆盖：

- `test/ai/tools/tool-registry.test.ts`
- `test/ai/tools/builtin-index.test.ts`
- `test/ai/tools/builtin-main-process-tool.test.ts`
- registry / constants 对齐相关测试

## 页面绑定工具新增步骤

只有工具必须跟随具体页面实例时才走这条路径。页面存在且可用时注册，失活时仅退出“当前页面”发现，卸载后注销。已启动 Runtime 始终使用启动时冻结的 `providerId + resourceId`，切页不会漂移到新页面。

### 1. 在页面目录创建 `useChatContext`

页面 Hook 统一命名为 `useChatContext`，不按 Editor、WebView 或 Widget 派生不同 Hook 名。页面在本模块内定义工具名、Schema、真实 handler、确认、展示和历史策略。

页面入口必须在 Vue `setup` 顶层同步调用本页面的 `useChatContext`，不要放进条件分支。是否注册交给响应式的 `available` 和非空 `resourceId`，是否成为当前页面交给 `active`；`resourceId` 变化会注销旧 binding 并注册新 binding。

最小模板：

```ts
/**
 * @file useChatContext.ts
 * @description 将示例页面能力注册为 ChatRuntime 页面工具。
 */
import type { AIToolContext, AIToolExecutionMetadata, AIToolExecutionResult } from 'types/ai';
import type { Ref } from 'vue';
import { createToolFailureResult, createToolSuccessResult } from '@/ai/tools/results';
import { useChatContextProvider, type ToolContextTool } from '@/hooks/useChat/useContextRegistry';
import { asyncTo } from '@/utils/asyncTo';

/** 示例页面工具上下文。 */
interface ExamplePageContext {
  /** 读取当前页面快照。 */
  readSnapshot(signal?: AbortSignal): Promise<{ title: string; content: string }>;
}

/** 示例页面 Chat Context 选项。 */
interface UseChatContextOptions {
  /** 页面稳定资源标识。 */
  resourceId: Readonly<Ref<string>>;
  /** 页面能力是否就绪。 */
  available: Readonly<Ref<boolean>>;
  /** 页面是否为当前激活页面。 */
  active: Readonly<Ref<boolean>>;
  /** 页面强类型 Context。 */
  context: ExamplePageContext;
}

/** 示例页面读取工具名称。 */
const INSPECT_EXAMPLE_PAGE_TOOL_NAME = 'inspect_example_page';

/**
 * 注册示例页面 Chat Context。
 * @param options - 页面注册选项
 */
export function useChatContext(options: UseChatContextOptions): void {
  /**
   * 创建完整页面工具契约。
   * @returns 示例页面读取工具
   */
  function createInspectTool(): ToolContextTool {
    return {
      definition: {
        name: INSPECT_EXAMPLE_PAGE_TOOL_NAME,
        description: '读取当前示例页面的标题和内容。',
        source: 'builtin',
        riskLevel: 'read',
        // 页面工具从冻结 binding 解析 Context，不依赖旧 Editor context 注入。
        requiresActiveDocument: false,
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      },
      execute: async (
        _input: unknown,
        _context?: AIToolContext,
        metadata?: AIToolExecutionMetadata
      ): Promise<AIToolExecutionResult> => {
        metadata?.activity?.progress({ phase: 'reading', completed: 0, total: 1, message: '正在读取示例页面' });
        const [error, snapshot] = await asyncTo(options.context.readSnapshot(metadata?.abortSignal));
        if (metadata?.abortSignal?.aborted) {
          return createToolFailureResult(INSPECT_EXAMPLE_PAGE_TOOL_NAME, 'RUNTIME_INTERRUPTED', '页面工具执行已中断');
        }
        if (error) return createToolFailureResult(INSPECT_EXAMPLE_PAGE_TOOL_NAME, 'EXECUTION_FAILED', error.message);
        return createToolSuccessResult(INSPECT_EXAMPLE_PAGE_TOOL_NAME, snapshot);
      },
      presentation: {
        label: '读取示例页面',
        summarize: (): string => '已读取示例页面'
      },
      history: {
        mode: 'latest-only',
        placeholder: '历史页面快照已裁剪，请重新读取。'
      }
    };
  }

  useChatContextProvider({
    providerId: 'example-page',
    resourceId: options.resourceId,
    available: options.available,
    active: options.active,
    getTools: (): ToolContextTool[] => [createInspectTool()],
    hiddenToolNames: [],
    appBridgeHandlers: {}
  });
}
```

### 2. 保持注册元数据稳定

`getTools` 可返回新的工具对象，但同一次注册内的以下元数据必须语义稳定：

- `definition`，包括工具名、描述、Schema、风险和权限字段。
- `presentation.label` 以及是否提供 `summarize`。
- `history`。

Registry 会结构化克隆工具定义；函数、DOM、Vue Proxy 或其他不可克隆值会导致注册被拒绝。若元数据需要改变，通过页面生命周期重新注册，不要在同一 registration owner 内静默漂移。

executor 可以读取页面的最新内存状态，但必须始终只访问注册 binding 对应的资源，不回退当前页面或其他同类资源。

### 3. 处理权限和确认

- `read` 工具默认直接执行。
- `write` 和 `dangerous` 工具统一经过页面工具权限包装器。
- 写工具通过 `createConfirmation(input)` 生成准确的标题、描述和 before/after 预览。该函数也是弹窗前的最后输入校验边界。
- `safeAutoApprove: true` 只用于确实可安全自动执行的写工具。
- 只允许用户记住手动授权、但不允许自动安全执行时，使用 `allowPermissionRemember: true` 和 `safeAutoApprove: false`。
- `dangerous` 工具始终不允许记住授权。

页面不得在确认内容中降低 `definition.riskLevel`，也不得绕过通用确认适配器直接执行写操作。

### 4. 处理中断和活动上报

Registry 会在确认前和确认后检查 `metadata.abortSignal`，已中断时不进入页面 handler。对于已经启动的异步读取、导航、DOM 操作或长任务，handler 仍必须把 signal 传入底层操作并尽快结算 pending Promise。

`metadata.activity` 只用于受限的 `heartbeat`、`progress`、`waitUser`、`waitExternal` 和 `resume` 上报。不要把 activity reporter 放进工具结果、历史或其他可枚举对象。

### 5. 声明展示和历史策略

`presentation` 只留在 Renderer，BChat 通过通用 Registry 读取，不需要在 `toolLabels.ts` 或 `toolResultSummary.ts` 添加工具名。`summarize` 应返回短文本，不抛出异常；模块未加载、同名展示存在歧义或摘要抛错时，BChat 会安全回退。

`history` 只能使用声明式可克隆字段：

- `mode: 'keep'`：保留工具结果。
- `mode: 'latest-only'`：只保留该工具最新一次完整结果，历史结果替换为 `placeholder`。
- `redactInputPaths`：模型历史投影时移除过期句柄、用户输入或其他不应回放的自有属性路径。

不要把 sanitizer、projector 函数或页面类型传入主进程。Electron 只解释通用 history 字段，非法策略 fail-closed。

### 6. 限制 `hiddenToolNames` 和 `appBridgeHandlers`

`hiddenToolNames` 只用于当前页面不应暴露的应用级候选工具。页面不能先隐藏应用工具，再用同名页面工具覆盖；最终合并会拒绝名称冲突。

`appBridgeHandlers` 不是页面工具 executor 配置。绝大多数页面应传空对象；只有应用级工具必须让冻结页面参与时才按 bridge kind 注册受控 handler。

### 7. 测试与零中心配置检查

至少覆盖：

- 页面可用时注册，失活后保留后台 Runtime 能力，卸载后旧 executor 返回 `EDITOR_UNAVAILABLE`。
- 真实 handler 的成功、稳定失败、输入无效、确认拒绝和 abort。
- presentation 与 history descriptor。
- 同 binding owner 替换、工具消失和恢复 Runtime。

新增第四页面时，生产代码只应修改该页面 `useChatContext` 及相邻领域模块。不应修改：

- `shared/ai/tools/index.ts`
- `src/ai/tools/catalog/runtimeTools.ts`
- `src/ai/tools/builtin/index.ts`
- `src/components/BChat` 的工具名、页面类型或展示分支
- Electron 主进程工具 registry、执行分支或历史 projector

通用协议回归门禁见 `test/integration/chat-page-tool-self-registration.test.ts`，完整设计见 `docs/superpowers/specs/2026-08-05-chat-tool-context-design.md`。

## 应用级 Renderer-local 工具新增步骤

只有工具必须依赖 renderer 本地执行时才走这条路径。

### 1. 创建工具目录

使用目录结构：

```text
src/ai/tools/builtin/<ToolName>/index.ts
```

每个工具文件需要：

- 文件头说明
- 明确输入/输出类型
- JSDoc 注释
- 禁止 `any`
- 统一结果工厂

### 2. 在 builtin index 注册

更新：

- `src/ai/tools/builtin/index.ts`

renderer-local 工具不要写入 `shared/ai/tools/<PascalCaseTool>/index.ts`，除非它未来要迁移到主进程。

### 3. 测试

测试放在：

- `test/ai/tools/*`

覆盖成功、失败、上下文缺失和权限分支。

## 风险等级和暴露策略

### riskLevel

- `read`：读取信息，不修改状态。
- `write`：修改文件、设置或应用状态。
- `dangerous`：可能大范围覆盖、删除、逃逸工作区或造成高误伤风险。

只读不等于永远不确认。读取工作区外绝对路径、敏感设置或本地资源时，仍应走确认。

### exposure

`shared/ai/tools` registry 的 `exposure` 只决定应用级工具在聊天侧是否默认暴露：

- `default-readonly`：默认只读工具。
- `default-writable`：默认写工具。
- `conditional-readonly`：条件启用的只读工具。
- `conditional-writable`：条件启用的写工具。

页面绑定工具不声明 `exposure`，也不加入应用级默认清单。页面激活时，BChat 从当前 binding 读取工具定义；Runtime 启动时再冻结该 binding、Renderer 工具 allowlist 和 history descriptor。页面失活或切换不会把已运行任务迁移到另一页面，资源卸载后旧 executor 会失败关闭。

不要在其他地方维护重复默认清单，也不要为了暴露页面工具而修改 `TOOL_REGISTRY`。

## 参数和结果约束

### schema 和输入类型一致

`definition.parameters` 必须和输入归一化逻辑一致。类型必填的字段，要放进 `required`。

### 结果必须可结构化克隆和 JSON 序列化

不要返回：

- 函数
- `Map`
- `Set`
- `Date` 实例
- DOM 对象
- class 实例
- `AbortSignal`
- Vue Proxy

返回普通对象、数组、字符串、数字、布尔值和 `null`。

### 描述写给模型看

`definition.description` 是模型选择工具的依据。要说明：

- 工具做什么
- 什么时候用
- 需要什么输入
- 返回什么信息
- 不适合什么场景

## 主进程工具模板

```ts
/**
 * @file index.mts
 * @description ChatRuntime 主进程示例工具。
 */
import type { AIToolExecutionResult } from 'types/ai';
import type { ChatRuntimeMainToolExecutionInput } from '../../types.mjs';
import type { MainToolsDependencies } from '../types.mjs';
import { EXAMPLE_TOOL_NAME } from '../constants.mjs';
import { createMainToolFailureResult, createMainToolSuccessResult } from '../results.mjs';

/**
 * 判断是否为示例工具。
 * @param toolName - 工具名称
 * @returns 是否为示例工具
 */
export function isExampleTool(toolName: string): boolean {
  return toolName === EXAMPLE_TOOL_NAME;
}

/**
 * 执行示例工具。
 * @param input - 工具执行输入
 * @param deps - 主进程工具依赖
 * @returns 工具执行结果
 */
export async function executeExampleTool(input: ChatRuntimeMainToolExecutionInput, deps: MainToolsDependencies): Promise<AIToolExecutionResult> {
  void deps;
  if (typeof input.input !== 'object' || input.input === null) {
    return createMainToolFailureResult(input.toolName, 'INVALID_INPUT', '工具输入必须是对象');
  }

  return createMainToolSuccessResult(EXAMPLE_TOOL_NAME, { ok: true });
}
```

## 开发检查清单

先确认归属：

- 纯系统、文件、设置或外部资源能力：主进程工具。
- 必须绑定某个具体页面实例：页面绑定工具。
- 必须依赖应用级 Renderer 状态或交互，但不归属某个页面：应用级 Renderer-local 工具。
- 由 AI SDK 或 provider 托管：SDK-managed 工具。

主进程工具检查：

- 工具名是否只在 `shared/ai/tools/<PascalCaseTool>/index.ts` 定义一次？
- 是否已从 `shared/ai/tools/index.ts` 导出工具名并加入 `TOOL_REGISTRY`？
- registry 的 `runtime`、`group`、`exposure`、`riskLevel` 是否正确？
- `executionClass` 与 runtime owner 是否有真实执行或协调协议支撑，而不是依赖 pending Promise？
- 执行结果是否使用 `electron/main/modules/chat/runtime/tools/results.mts` helper？
- 真实文件写工具是否只在磁盘持久化完成后返回成功？
- 真实文件写工具是否在确认后重新验证版本，并按真实目的地复核符号链接边界？
- `unsaved://` 是否作为草稿例外通过 bridge 处理？
- bridge 失败是否返回稳定错误，而不是抛出到 Runtime 外层？

页面绑定工具检查：

- 工具名、Schema、真实 handler、确认、展示和 history 是否只归属页面 `useChatContext`？
- `requiresActiveDocument` 是否显式设为 `false`，避免依赖旧 Editor context 注入？
- `providerId + resourceId` 是否稳定、唯一，executor 是否只访问该 binding 对应资源？
- `definition`、presentation 元数据和 history 是否可克隆且不会在同一 owner 内漂移？
- 异步 handler 是否使用 `asyncTo`，并继续向底层传递 `metadata.abortSignal`？
- 写工具是否使用准确的 `riskLevel`、`createConfirmation`、`safeAutoApprove` 和 `allowPermissionRemember`？
- 页面工具是否没有被加入 `shared/ai/tools`、builtin 中央列表、BChat 页面分支或 Electron 工具分支？
- `hiddenToolNames` 和 `appBridgeHandlers` 是否只用于明确的应用级工具协作，而不是页面工具执行？
- 页面卸载后，已捕获 executor 是否返回稳定失败，且不会回退到其他页面？

所有工具共同检查：

- Schema 是否和输入归一化一致？
- 写操作、工作区外路径和危险读取是否有确认？
- 结果是否可结构化克隆并可 JSON 序列化？
- 是否覆盖成功、失败、无效输入、权限拒绝和中断测试？
- 是否更新 `docs/development/chat-runtime-architecture-map.md` 或相关 README？
- 是否记录到当天 changelog？

## 推荐阅读顺序

第一次接触应用级主进程工具，建议按顺序读：

1. `shared/ai/tools/index.ts`
2. `shared/ai/tools/types.ts`
3. 目标工具元数据目录，例如 `shared/ai/tools/FileReadTool/index.ts`
4. `src/ai/tools/catalog/runtimeTools.ts`
5. `src/ai/tools/builtin/index.ts`
6. `docs/development/chat-runtime-architecture-map.md`
7. `electron/main/modules/chat/runtime/tools/index.mts`
8. `electron/main/modules/chat/runtime/tools/constants.mts`
9. `electron/main/modules/chat/runtime/tools/types.mts`
10. 目标主进程执行分组，例如 `electron/main/modules/chat/runtime/tools/FileTool/index.mts`
11. Coordinator 工具额外阅读 `shared/ai/tools/DelegateTaskTool/index.ts`、`electron/main/modules/chat/agents/service.mts`、`coordinator.mts`、`plan-compiler.mts`、`executor.mts` 与 `read-tools.mts`
12. `src/components/BChat/utils/runtimeBridge.ts`

这条路径是“Tool 目录定义 -> `shared/ai/tools/index.ts` 聚合 -> Renderer schema-only 暴露 -> 主进程执行 -> 必要时 bridge 到 Renderer”。

第一次接触页面绑定工具，建议按顺序读：

1. `src/hooks/useChat/useContextRegistry.ts`
2. `src/hooks/useChat/tool/types.ts`
3. `src/hooks/useChat/tool/registry.ts`
4. 一个页面实例，例如 `src/components/BEditor/hooks/useChatContext.ts`
5. 页面调用入口，例如 `src/components/BEditor/index.vue`
6. `src/components/BChat/hooks/useRuntimeTools.ts`
7. `test/integration/chat-page-tool-self-registration.test.ts`
8. `docs/superpowers/specs/2026-08-05-chat-tool-context-design.md`

这条路径是“页面 `useChatContext` 完整声明 -> 通用 Registry 注册 -> BChat 捕获当前 binding -> Runtime 冻结 Renderer allowlist 与 history -> 精确调用原页面 executor”。新增页面不需要在这条路径之外增加页面名或工具名配置。
