# `src/ai/tools` 新工具开发指南

日期：2026-04-24

本文档面向仓库开发者，说明如何在 `src/ai/tools` 中新增一个 AI 工具，并把它安全地接入聊天工具链。

目标是让新增工具保持和现有内置工具一致的结构：

- 工具定义清晰，参数和返回值可序列化。
- 风险等级明确，写操作走统一权限流程。
- 是否依赖当前编辑器上下文有明确边界。
- 能被 `stream.ts` 正常执行并回注到模型消息历史。
- 默认是否暴露给聊天侧由 `catalog.ts` 统一控制。

## 目录职责

`src/ai/tools` 当前可以按下面理解：

- `builtin/`
  负责内置工具实现与默认暴露清单。
- `results.ts`
  负责统一创建工具执行结果。
- `permission.ts`
  负责写工具权限、确认、自动放行与授权记忆。
- `confirmation.ts`
  定义确认请求和确认适配器接口。
- `stream.ts`
  负责把工具定义转成 transport tools，并执行模型发出的 tool call。
- `editor-context.ts`
  提供当前活动编辑器上下文。
- `policy.ts`
  负责 provider/model 是否支持工具调用，以及默认聊天工具集。

如果是“新增一个内置工具”，通常会同时改到：

- `src/ai/tools/builtin/*.ts`
- `src/ai/tools/builtin/catalog.ts`
- `src/ai/tools/builtin/index.ts`
- `test/ai/tools/*`

## 先判断工具类型

新增工具前，先确认它属于哪一类。

### 1. 只读工具

适合读取信息，不修改状态，例如：

- 读取当前文档
- 搜索当前文档
- 获取应用设置
- 获取系统时间

这类工具通常：

- `riskLevel` 为 `read`
- 可以直接返回 `createToolSuccessResult`
- 不需要走 `executeWithPermission`

补充说明：

- 只读工具不等于永远不需要用户确认。
- 如果工具允许读取工作区外的绝对路径资源，例如本地文件或本地目录，仍然应该在无工作区约束时要求用户确认。
- `read_file` 和 `read_directory` 都属于这种“只读但有边界风险”的工具。

### 2. 写工具

适合修改编辑器内容或应用状态，例如：

- 插入文本
- 替换选区
- 修改设置

这类工具通常：

- `riskLevel` 为 `write`
- 低风险且可自动授权的工具，可设置 `safeAutoApprove: true`
- 通过 `executeWithPermission` 或明确确认流程执行

### 3. 危险工具

适合大范围覆盖、不可逆或高误伤风险的操作，例如：

- 替换整篇文档

这类工具通常：

- `riskLevel` 为 `dangerous`
- 不允许记住授权
- 不应放入默认低风险可写工具清单

## 新工具文件放在哪里

如果是内置工具，优先放在 `src/ai/tools/builtin/`。

建议按能力归类，而不是“一个文件一个项目需求”：

- 文档读取相关：并入 `read.ts`
- 文件读取相关：并入 `read-file.ts`
- 编辑器写入相关：并入 `write.ts`
- 设置相关：并入 `settings.ts`
- 环境类信息：并入 `environment.ts`

只有当新能力和现有文件职责明显不匹配时，再新建一个 `builtin/*.ts` 文件。

## 工具定义的最小结构

每个工具都要实现 `AIToolExecutor`：

```ts
export interface AIToolExecutor<TInput = unknown, TResult = unknown> {
  definition: AIToolDefinition;
  execute(input: TInput, context?: AIToolContext): Promise<AIToolExecutionResult<TResult>>;
}
```

核心定义在 `types/ai.d.ts`：

- `name`
- `description`
- `source`
- `riskLevel`
- `parameters`
- `requiresActiveDocument`
- `permissionCategory`
- `safeAutoApprove`

推荐做法：

1. 先定义输入和输出类型。
2. 再导出共享工具名常量。
3. 再实现 `definition` 和 `execute`。

示例结构：

```ts
/**
 * 工具名称常量。
 */
export const EXAMPLE_TOOL_NAME = 'example_tool';

/**
 * 工具输入。
 */
export interface ExampleToolInput {
  /** 查询关键字。 */
  query: string;
}

/**
 * 工具输出。
 */
export interface ExampleToolResult {
  /** 原始查询。 */
  query: string;
}
```

这里的共享工具名常量很重要。`catalog.ts`、测试、错误结果和定义中的 `name` 都应该引用同一个常量，避免字符串散落。

## 什么时候需要 `requiresActiveDocument`

默认情况下，工具会被视为依赖当前编辑器上下文。

因为 `stream.ts` 里有这段保护逻辑：

- 如果 `executor.definition.requiresActiveDocument !== false`
- 且当前没有 editor context
- 则直接返回 `NO_ACTIVE_DOCUMENT`

因此：

- 依赖 `context.document` 或 `context.editor` 的工具，不用额外声明
- 不依赖当前文档的全局工具，要显式写 `requiresActiveDocument: false`

典型例子：

- `get_current_time` 是全局工具，应设为 `false`
- `get_settings` 是全局工具，应设为 `false`
- `read_current_document` 依赖活动文档，不需要设为 `false`

## 什么时候走 `results.ts`

所有工具结果都应该通过统一结果结构返回。

优先使用：

- `createToolSuccessResult`
- `createToolFailureResult`
- `createToolCancelledResult`
- `createAwaitingUserInputResult`

不要直接手写各种形状不一致的对象，除非已有模块为了兼容历史代码而保留了极少数直接返回对象的写法。新增代码建议统一走 `results.ts`。

常见错误码建议：

- 输入不合法：`INVALID_INPUT`
- 无活动文档：`NO_ACTIVE_DOCUMENT`
- 当前没有选区：`NO_SELECTION`
- 权限不允许：`PERMISSION_DENIED`
- 用户拒绝：`USER_CANCELLED`
- 平台不支持：`UNSUPPORTED_PROVIDER`
- 运行期异常：`EXECUTION_FAILED`

如果是“只读但需要确认”的工具，也应该在用户拒绝时返回 `createToolCancelledResult`，而不是把这类场景混成普通失败。

## 什么时候走 `permission.ts`

结论很简单：

- 只读工具通常不走 `executeWithPermission`
- 写工具优先走 `executeWithPermission`
- 危险写工具至少要有确认流程

`executeWithPermission` 适合这类场景：

- 工具有明确的 `definition`
- 需要根据 `toolPermissionMode` 判断是否允许执行
- 需要利用 session / always grant
- 需要支持 `safeAutoApprove`

例如 `update_settings` 就是标准用法：

1. 先校验输入
2. 构造确认请求
3. 通过 `executeWithPermission` 包装真实操作
4. 在 `operation` 中执行实际修改

如果工具不是简单的“写入后返回”，而是像 `replace_selection` 这样要先确认、再重新检查上下文是否过期，也可以像 `write.ts` 一样保留定制执行流程。

## 参数和结果的约束

工具参数和结果最终会进入模型工具调用链，因此必须遵守几个约束：

### 1. 参数 schema 要和输入类型一致

`definition.parameters` 里的 JSON Schema 需要和 `TInput` 对齐。

如果类型上要求必填，schema 里也要放进 `required`。

### 2. 结果必须可 JSON 序列化

`stream.ts` 会通过 `JSON.stringify -> JSON.parse` 把结果转成 JSON 值。

所以不要返回：

- 函数
- `Map`
- `Set`
- `Date` 实例本身
- DOM 对象
- class 实例

建议只返回普通对象、数组、字符串、数字、布尔值和 `null`。

### 3. 描述文案要写给模型看

`definition.description` 不是写给开发者看的注释，而是给模型决定“何时调用此工具”的提示。

因此要写清楚：

- 它做什么
- 输入什么
- 返回什么
- 是否有边界条件

## 新增内置工具的接入步骤

### 1. 在工具实现文件中新增工具

先在对应 `builtin/*.ts` 文件中：

- 定义工具名常量
- 定义输入输出类型
- 定义 `definition`
- 实现 `execute`

### 2. 暴露到对应工具集合

例如：

- `BuiltinReadTools`
- `BuiltinWriteTools`
- `BuiltinSettingsTools`

这样 `createBuiltinTools` 才能拿到它。

### 3. 在 `builtin/index.ts` 组装

把工具加入：

- `allReadonlyTools`
- 或 `allDefaultWritableTools`

如果是非默认开放工具，也可以只在特定开关下暴露。

这里有一个很容易漏掉的点：

- 如果工具实现支持确认流程，例如绝对路径读取确认
- 那么在 `createBuiltinTools` 里组装它时，要把 `confirm: options.confirm` 一并传进去

不要只传 `getWorkspaceRoot`，否则工具内部虽然写了确认逻辑，但聊天侧真正创建出来的实例拿不到确认适配器，最终只会返回“需要用户确认”，却不会弹出确认卡片。

`read_directory` 就踩过这个坑，修复方式就是在 `builtin/index.ts` 中改成：

```ts
createBuiltinReadDirectoryTool({
  confirm: options.confirm,
  getWorkspaceRoot: options.getWorkspaceRoot
})
```

### 4. 在 `builtin/catalog.ts` 决定是否默认开放

这里不要写裸字符串，要引用共享常量，例如：

```ts
export const DEFAULT_BUILTIN_READONLY_TOOL_NAMES = [
  READ_CURRENT_DOCUMENT_TOOL_NAME,
  GET_SETTINGS_TOOL_NAME
] as const;
```

如果工具只是“存在但默认不开放”，那就不要加进默认清单。

### 5. 如有 provider 层限制，确认 `policy.ts`

目前 `policy.ts` 主要负责：

- 模型是否支持工具调用
- 默认聊天工具名集合

一般新增默认工具后，不需要单独修改逻辑，只要默认清单正确即可。

## 只读工具的绝对路径确认模式

当工具既是只读工具，又可能访问工作区外的本地资源时，推荐沿用 `read_file` / `read_directory` 这套模式：

1. 有 `workspaceRoot` 时：
   只允许读取工作区内路径，由底层平台层做安全校验。
2. 没有 `workspaceRoot` 时：
   相对路径直接拒绝。
3. 没有 `workspaceRoot` 且传入绝对路径时：
   先通过 `AIToolConfirmationAdapter` 请求用户确认，再继续执行。
4. 如果当前工具实例没有拿到 `confirm`：
   返回 `PERMISSION_DENIED`，明确说明“需要用户确认”。

这样做的好处是：

- 默认仍然安全
- 不会静默读取任意本地路径
- 在用户显式授权时，又能支持跨工作区读取

这类确认一般不走 `executeWithPermission`，因为它不是“写操作授权记忆”问题，而是“对当前一次绝对路径读取做单次确认”。

## 新建一个 `builtin/*.ts` 文件时的建议模板

```ts
/**
 * @file example.ts
 * @description 示例工具实现。
 */
import type { AIToolExecutor } from 'types/ai';
import { createToolFailureResult, createToolSuccessResult } from '../results';

/** 示例工具名称。 */
export const EXAMPLE_TOOL_NAME = 'example_tool';

/**
 * 示例工具输入。
 */
export interface ExampleToolInput {
  /** 示例文本。 */
  text: string;
}

/**
 * 示例工具输出。
 */
export interface ExampleToolResult {
  /** 处理后的文本。 */
  normalizedText: string;
}

/**
 * 示例工具集合。
 */
export interface ExampleTools {
  /** 示例工具。 */
  exampleTool: AIToolExecutor<ExampleToolInput, ExampleToolResult>;
}

/**
 * 创建示例工具。
 * @returns 示例工具集合
 */
export function createExampleTools(): ExampleTools {
  return {
    exampleTool: {
      definition: {
        name: EXAMPLE_TOOL_NAME,
        description: '对输入文本做示例处理并返回结果。',
        source: 'builtin',
        riskLevel: 'read',
        requiresActiveDocument: false,
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '要处理的文本。' }
          },
          required: ['text'],
          additionalProperties: false
        }
      },
      async execute(input: ExampleToolInput) {
        if (!input.text.trim()) {
          return createToolFailureResult(EXAMPLE_TOOL_NAME, 'INVALID_INPUT', 'text 不能为空');
        }

        return createToolSuccessResult(EXAMPLE_TOOL_NAME, {
          normalizedText: input.text.trim()
        });
      }
    }
  };
}
```

## 测试建议

新增工具后，至少覆盖下面几类测试。

### 1. 工具自身行为测试

通常新增到 `test/ai/tools/`：

- 成功路径
- 输入校验失败
- 权限拒绝或用户取消
- 特殊上下文分支
- 无工作区时的绝对路径确认分支

例如：

- `test/ai/tools/builtin-settings.test.ts`
- `test/ai/tools/builtin-read-file.test.ts`

### 2. `builtin/index.ts` 暴露测试

如果工具接进了 `createBuiltinTools`，要更新：

- `test/ai/tools/builtin-index.test.ts`

确认默认工具集合是否符合预期。

如果工具依赖 `confirm` 或 `getWorkspaceRoot`，这里还应该补一条“宿主参数是否真的传进工具实例”的回归测试。否则工具本身测试可能是绿的，但聊天侧实际接线仍然可能失效。

### 3. `catalog.ts` 默认清单测试

如果工具加入了默认清单，要更新：

- `test/ai/tools/builtin-catalog.test.ts`

并优先断言共享工具名常量，而不是手写字符串。

### 4. 集成链路测试

如果工具改变了聊天侧工具循环、确认卡片、消息回注或平台调用链，还要补对应测试。

常见位置包括：

- `test/components/BChat/*`
- `test/components/BChatSidebar/*`
- `test/electron/*`

## 开发检查清单

提 PR 或交付前，至少自查下面这些点。

- 是否导出了共享工具名常量
- 是否为输入、输出、工具集合补了类型
- 是否写了文件头注释和 JSDoc 注释
- 是否避免了 `any`
- 是否明确了 `riskLevel`
- 是否明确了 `requiresActiveDocument`
- 是否使用统一结果工厂
- 写工具是否接入权限或确认流程
- 只读绝对路径工具是否接入单次确认流程
- 是否更新了 `catalog.ts`
- 是否更新了 `builtin/index.ts`
- `builtin/index.ts` 是否把 `confirm` / `getWorkspaceRoot` 等依赖真实传入
- 是否补了相关测试
- 是否把改动记录进当日 changelog

## 相关文件

- `types/ai.d.ts`
- `src/ai/tools/results.ts`
- `src/ai/tools/permission.ts`
- `src/ai/tools/confirmation.ts`
- `src/ai/tools/stream.ts`
- `src/ai/tools/editor-context.ts`
- `src/ai/tools/policy.ts`
- `src/ai/tools/builtin/index.ts`
- `src/ai/tools/builtin/catalog.ts`

## 推荐阅读顺序

如果第一次接触这块代码，推荐按这个顺序读：

1. `types/ai.d.ts`
2. `src/ai/tools/results.ts`
3. `src/ai/tools/stream.ts`
4. `src/ai/tools/builtin/catalog.ts`
5. `src/ai/tools/builtin/index.ts`
6. 目标工具所在的 `builtin/*.ts`

这样会比较容易建立“工具定义 -> 工具执行 -> tool result 回注 -> 默认暴露策略”的完整心智模型。
