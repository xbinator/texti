# BChat Stream Cognitive Load Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变 BChat 已验证流式语义的前提下，降低主进程流执行器、Renderer 实时投影和资源计量的单点复杂度。

**Architecture:** `stream/index.mts` 只保留编排，Provider chunk 消费进入 `observer.mts`，工具协议分类与执行进入 `tool-step.mts`。Renderer mutation 转换为纯函数，JSON 字节计量保持迭代安全扫描但拆分分支。

**Tech Stack:** TypeScript strict、Electron、Vue 3、Vitest、lodash-es。

## Global Constraints

- 不改变 IPC、消息结构、资源上限、工具顺序、停止语义或 UI。
- 禁止 `any`；所有新函数、类型和复杂逻辑必须含明确注释和返回类型。
- 每个新生产模块必须先有失败测试，然后才实现。
- 用户自行提交；不执行 `git add` 或 `git commit`。

---

### Task 1: Provider Stream Observer

**Files:**

- Create: `electron/main/modules/chat/runtime/stream/observer.mts`
- Create: `test/electron/main/modules/chat/runtime/stream/observer.test.ts`
- Modify: `electron/main/modules/chat/runtime/stream/index.mts`

**Interfaces:**

```typescript
export interface RuntimeStreamObservation {
  stepUsage?: AIUsage;
  totalUsage?: AIUsage;
  finishReason?: AIStreamFinishReason;
  observedTools: Map<string, ObservedToolDefinition>;
  stoppedToolCallId?: string;
}

export function observeRuntimeStream(options: RuntimeStreamObserverOptions): Promise<RuntimeStreamObservation>;
```

- [x] 新增测试导入 `observeRuntimeStream`，用文本、工具输入和停止结果流断言返回事实；运行并确认因模块不存在而失败。
- [x] 将事件计数、字节计数、final filter、chunk 投影与工具事实观察移入新模块。
- [x] 运行 `pnpm exec vitest run test/electron/main/modules/chat/runtime/stream/observer.test.ts test/electron/main/modules/chat/runtime/stream/executor.test.ts --reporter=dot`，预期全部通过。

### Task 2: Tool Step Classification and Execution

**Files:**

- Create: `electron/main/modules/chat/runtime/stream/tool-step.mts`
- Create: `test/electron/main/modules/chat/runtime/stream/tool-step.test.ts`
- Modify: `electron/main/modules/chat/runtime/stream/index.mts`

**Interfaces:**

```typescript
export function classifyToolStep(input: ToolStepClassificationInput): ToolStepClassification;
export function executeToolStep(input: ToolStepExecutionInput): Promise<RuntimeToolStepResult>;
```

- [x] 先测试重复 ID、名称冲突、混合类、非法 Provider 结果与合法延迟调用；确认模块不存在时 RED。
- [x] 实现纯分类函数，再将 guard、Provider/Main/Renderer 执行优先级和结果统计移入异步执行函数。
- [x] 让 `index.mts` 只根据分类结果处理协议错误、委派暂停、续轮或完成。
- [x] 运行 `pnpm exec vitest run test/electron/main/modules/chat/runtime/stream/tool-step.test.ts test/electron/main/modules/chat/runtime/stream/executor.test.ts --reporter=dot`，预期全部通过。

### Task 3: Renderer Live Message Projection

**Files:**

- Create: `src/components/BChat/hooks/liveMessageProjection.ts`
- Create: `test/components/BChat/live-message-projection.test.ts`
- Modify: `src/components/BChat/hooks/useChatHistory.ts`

**Interfaces:**

```typescript
export function validateMutations(message: Message, mutations: ChatRuntimeMessageMutation[]): boolean;
export function applyMutations(message: Message, mutations: ChatRuntimeMessageMutation[]): void;
```

- [x] 先为整批预验证、文本/思考 Part 创建、工具输入追加和无效批次写失败测试。
- [x] 确认测试因新模块不存在而失败，再移动现有纯逻辑。
- [x] 让 `useChatHistory` 仅保留 revision 连续性、Vue 列表更新和历史读取。
- [x] 运行 `pnpm exec vitest run test/components/BChat/live-message-projection.test.ts test/components/BChat/use-chat-history.test.ts --reporter=dot`，预期全部通过。

### Task 4: Resource Budget Branch Reduction

**Files:**

- Modify: `electron/main/modules/chat/runtime/stream/resource-budget.mts`
- Modify: `test/electron/main/modules/chat/runtime/stream/resource-budget.test.ts`

- [x] 先新增数组空槽、非枚举 getter、数组 getter 与 null prototype 对象用例，确认至少一个安全要求在重构前失败。
- [x] 用显式 `MeasureFrame` 和数组/对象展开函数降低 `measureJsonBytes` 分支和嵌套。
- [x] 运行资源单测与 complexity/max-depth 审计，确认主函数圈复杂度不高于 12、嵌套不高于 4。

### Task 5: Verification

**Files:**

- Modify: `changelog/2026-08-10.md`

- [x] 运行更改文件 ESLint 与辅助 complexity/max-lines/max-depth 规则，确认 `createRuntimeStreamExecutor` 不再超过 100 行且圈复杂度不高于 12。
- [x] 运行 Stream、BChat、BMessage 专项测试。
- [x] 运行 `pnpm test`、`pnpm exec tsc --noEmit`、Stylelint、`pnpm build` 和 `pnpm electron:build-main`。
- [x] 运行 `git diff --check` 并确认 `git diff --cached --name-only` 为空。
