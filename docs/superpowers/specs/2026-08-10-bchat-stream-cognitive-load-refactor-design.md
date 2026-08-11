# BChat 流式代码心智负担重构设计

## 背景

流式卡顿修复已经通过完整回归，但 `electron/main/modules/chat/runtime/stream/index.mts` 的执行器同时承担 Provider 流消费、资源预算、工具协议分类、工具执行、投影与终态收口，单函数约 363 行、圈复杂度 104。`src/components/BChat/hooks/useChatHistory.ts` 也同时处理历史加载和实时增量应用。

这些问题不改变当前正确性，但会放大后续修改的理解成本和回归风险。

## 目标

- 让 `stream/index.mts` 只负责模型解析、依赖组装、顺序编排和最终错误投影。
- 把 Provider chunk 消费与资源计数收敛到独立、可单测的流观察模块。
- 把延迟工具协议分类与直接工具执行收敛到工具步骤模块。
- 把 Renderer mutation 验证与应用提取为无 Vue 依赖的纯函数。
- 降低资源 JSON 计量函数的分支深度，但不放松循环、访问器、非普通对象与字节上限检查。

## 非目标

- 不改变 IPC、Runtime 事件、数据库消息结构或 Renderer 展示。
- 不改变工具授权顺序、Provider 结果优先级、停止语义、延迟委派协议或资源上限。
- 不引入新的状态管理库、类层次或通用框架。
- 不拆分已经职责单一的 Markdown Worker、Shell 合并器和文件目标组件。
- 不执行 Git 暂存或提交。

## 模块边界

### Provider 流观察

`stream/observer.mts` 消费唯一的 Provider `AsyncIterable`，执行事件数、文本字节、工具输入字节与强制最终文本过滤，并将 chunk 投影到工作 Assistant。它只返回后处理必需的 `RuntimeStreamObservation`：usage、finish reason、工具定义事实和 Provider 停止位置。

### 工具步骤

`stream/tool-step.mts` 不读取 Provider 流。它先对完整工具定义事实做无副作用分类，再按既有优先级执行 guard、Provider 结果、Main 工具或 Renderer 工具。返回统一的 `RuntimeToolStepResult`，由编排层决定续轮、等待用户、暂停委派或完成。

### Renderer 实时投影

`hooks/liveMessageProjection.ts` 提供 `validateMutations` 和 `applyMutations`。输入是普通 `Message` 和 mutation 数组，不访问 Ref、Store 或 IPC。`useChatHistory` 只管理 revision Map、Vue 列表与历史 I/O。

### 资源计量

`resource-budget.mts` 保持迭代扫描，将基本类型计量、数组展开和对象展开拆成小函数。任何不安全输入仍统一返回 `limit + 1`。

## 错误与顺序不变式

- 资源超限仍同时中止 AI Service request 和 Runtime `AbortController`。
- Provider 权威停止结果之后只审计工具定义，不再投影晚到文本与终止噪声。
- Guard 总是在读取 Provider 结果或启动本地执行器前完成。
- 延迟工具协议必须完成整步分类后才能产生副作用。
- 任意错误仍保留最新安全内存投影，`finally` 仍等待投影器取消。

## 测试策略

- 先为新模块 API 写导入失败的单元测试，确认 RED 后再移动实现。
- 工具观察覆盖重复 ID、名称冲突、混合执行类、未暴露延迟工具、Provider 非法结果和合法委派。
- 实时投影覆盖整批预验证、新 Part 创建、工具输入追加和不部分应用。
- 资源计量沿用现有循环、访问器、Unicode、深层对象和提前超限测试。
- 最后重跑所有 Stream、BChat、BMessage 测试，以及完整 `pnpm test`、TypeScript、ESLint、Stylelint 和两端构建。
