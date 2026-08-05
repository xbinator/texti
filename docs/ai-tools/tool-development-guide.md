# AI 工具开发指南

日期：2026-06-25

更新：2026-07-27

本文档说明如何在当前工具架构下新增或修改 AI 工具。现在工具定义和执行拆成两层：

- `shared/ai/tools/index.ts` 是已迁移 ChatRuntime 工具的统一聚合入口，导出工具名、`TOOL_REGISTRY` 和 registry 查询函数。
- `shared/ai/tools/<PascalCaseTool>/index.ts` 是单个工具领域的元数据文件，维护该领域的工具名、schema、风险等级、运行时归属、分组和暴露策略。
- `shared/ai/tools/types.ts` 只放 registry 共享类型，例如 `SharedToolDefinition`、`ToolRegistryEntry`、`ToolRuntimeGroup`、`ToolExposure`、`ToolExecutionClass` 和 `AgentToolEffectMetadata`。
- `electron/main/modules/chat/runtime/tools/**/index.mts` 是已迁移工具的主进程执行入口。
- `src/ai/tools/catalog/runtimeTools.ts` 只为 renderer 暴露 schema-only 工具，执行时会提示该工具已迁移到主进程。
- `src/ai/tools/builtin/**/index.ts` 只保留仍需 renderer 本地状态或本地交互的工具。

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

### Renderer-local 工具

仅当工具必须依赖 renderer 本地状态时使用。当前包括：

- `QuestionTool`
- `TodoWriteTool`
- `MemoryTool`
- `ShellTool`
- `SkillTool`

代码落点：

- `src/ai/tools/builtin/<ToolName>/index.ts`
- `src/ai/tools/builtin/index.ts`

不要把已经能在主进程完成的工具继续放进 renderer-local 目录。

### SDK-managed 工具

由 AI SDK 或 provider 集成处理，例如 Tavily 和 MCP provider 工具。通常不需要放入本地 builtin 执行器。

## 共享元数据目录

共享工具元数据按 PascalCase Tool 目录组织。每个目录收拢一个工具领域的工具名和 registry entry：

```text
shared/ai/tools/
  index.ts
  types.ts
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
  WebviewTool/index.ts
```

目录职责：

- `DocumentTool`：当前文档读取、文档草稿创建等文档级工具。
- `DelegateTaskTool`：Main Coordinator 拥有的内部延迟委派契约；不进入普通 main/renderer 工具执行器。
- `EnvironmentTool`：当前时间等环境信息工具。
- `FileReadTool`：文件、目录读取工具。
- `FileWriteTool`：文件创建或覆盖工具。
- `FileEditTool`：精确替换类文件编辑工具。
- `LogsTool`：应用日志查询工具。
- `MCPSettingsTool`：MCP 配置读取、增删改和 discovery 刷新工具。
- `SettingsTool`：应用设置读取和修改工具。
- `OpenResourceTool`：打开文件、网页或外部资源工具。
- `WebviewTool`：当前 WebView 读取和操作工具。

如果新增工具能归入现有领域，就追加到对应目录。只有当工具有新的清晰领域时，才新增 `<PascalCaseTool>/index.ts` 目录。

## 主进程工具新增步骤

### 1. 选定共享元数据目录

先选择或创建 `shared/ai/tools/<PascalCaseTool>/index.ts`。目录名使用 PascalCase，并以 `Tool` 结尾，例如：

- `FileReadTool`
- `FileWriteTool`
- `SettingsTool`
- `WebviewTool`

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

- `ReadTool`：只读环境、当前文档、日志等只读工具。
- `FileTool`：文件和目录读取、创建、写入、编辑。
- `SettingsTool`：应用设置和 MCP server 配置写入。
- `ResourceTool`：打开文件、网页或其他资源。
- `WebviewTool`：当前 WebView 页面读取和操作。

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

- 当前编辑器内容
- 未保存草稿内容
- 当前 WebView 页面快照
- 让 renderer 打开资源或创建草稿

bridge 不是第二套工具运行时，只是主进程向 renderer 请求 UI 状态或 UI 动作的受控 RPC。

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

## Renderer-local 工具新增步骤

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

registry 的 `exposure` 决定聊天侧默认是否暴露：

- `default-readonly`：默认只读工具。
- `default-writable`：默认写工具。
- `conditional-readonly`：条件启用的只读工具。
- `conditional-writable`：条件启用的写工具。

不要在其他地方再维护重复默认清单。

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

- 工具是否真的需要 renderer-local？能主进程化就主进程化。
- 工具名是否只在 `shared/ai/tools/<PascalCaseTool>/index.ts` 定义一次？
- 是否已从 `shared/ai/tools/index.ts` 导出工具名并加入 `TOOL_REGISTRY`？
- registry 的 `runtime`、`group`、`exposure`、`riskLevel` 是否正确？
- `executionClass` 与 runtime owner 是否有真实执行/协调协议支撑，而不是依赖 pending Promise？
- schema 是否和输入归一化一致？
- 主进程执行结果是否使用 `electron/main/modules/chat/runtime/tools/results.mts` helper？
- 写操作、工作区外路径、危险读取是否有确认？
- 真实文件写工具是否只在磁盘持久化完成后返回成功？
- 真实文件写工具是否在确认后重新验证版本，并按真实目的地复核符号链接边界？
- `unsaved://` 是否作为草稿例外通过 bridge 处理？
- bridge 失败是否返回稳定错误，而不是抛出到 runtime 外层？
- 结果是否可结构化克隆？
- 是否补测试？
- 是否更新 `docs/development/chat-runtime-architecture-map.md` 或相关 README？
- 是否记录到当天 changelog？

## 推荐阅读顺序

第一次接触这块代码，建议按顺序读：

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

这样能先建立“Tool 目录定义 -> `shared/ai/tools/index.ts` 聚合 -> renderer schema-only 暴露 -> 主进程执行 -> 必要时 bridge 到 renderer”的完整链路。
