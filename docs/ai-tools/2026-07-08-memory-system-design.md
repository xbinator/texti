# AI 记忆系统设计

日期：2026-07-08

本文档记录当前 AI 记忆系统的设计、数据模型、运行时注入策略、`edit_memory` 安全边界和调试可观测性。这里描述的是现阶段实现，不包含未来 embedding、云同步或多用户记忆图谱等扩展方案。

## 目标

记忆系统用于让 AI 在不同对话轮次中持续持有用户偏好、事实、项目背景和当前工作上下文，同时避免把完整记忆无条件塞进每一轮 system prompt。

当前设计有四个目标：

- 普通回答轮只注入与当前请求相关的记忆，降低上下文占用和无关干扰。
- 涉及记忆编辑的轮次必须基于完整记忆，避免 `edit_memory` 的整分区覆盖语义造成数据丢失。
- 记忆文件格式和磁盘行为保持稳定，降低迁移成本。
- 每轮记忆选择要可观测，方便排查漏召回、误召回和预算裁剪问题。

## 数据模型

记忆以 `MEMORY.md` 存储，由固定分区组成。类型定义在 `src/ai/memory/types.ts`：

```ts
export type MemoryCategory =
  | 'Instructions'
  | 'Preferences'
  | 'Habits'
  | 'Facts'
  | 'Projects'
  | 'Current Context';

export interface MemoryItem {
  content: string;
}

export interface MemorySection {
  category: MemoryCategory;
  items: MemoryItem[];
}

export interface MemoryDoc {
  sections: MemorySection[];
}
```

各分区职责：

- `Instructions`：稳定指令，默认优先保留。
- `Preferences`：用户偏好，例如回答风格、语言、常用工作方式。
- `Habits`：用户习惯，通常用于弱约束。
- `Facts`：关于用户或环境的事实。
- `Projects`：项目长期背景。
- `Current Context`：近期工作上下文，比项目背景更短期。

解析和序列化由 `src/ai/memory/parser.ts` 负责。状态管理由 `src/stores/ai/memory.ts` 负责，包含加载、保存、更新分区和构建 system prompt 记忆上下文。

## 注入模式

当前支持两种注入模式：

```ts
export type MemoryInjectionMode = 'relevant' | 'full';
```

### full

`full` 模式使用完整非空记忆分区，再按预算裁剪。它用于：

- 旧调用方未传 `selection` 的兼容路径。
- 明确需要编辑长期记忆的请求。
- 内部需要基于权威记忆状态执行整分区覆盖的场景。

`buildSystemPromptContext(doc)` 仍等价于旧行为：完整记忆注入，默认 `maxChars = 4000`。

### relevant

`relevant` 模式根据当前请求筛选记忆条目。它用于普通聊天回答轮。

选择上下文定义为：

```ts
export interface MemorySelectionContext {
  userMessage: string;
  references: string[];
  workspaceRoot?: string;
  mode?: MemoryInjectionMode;
}
```

其中：

- `userMessage` 来自当前用户消息文本。
- `references` 合并 `Message.references` 和 runtime file parts 中的 `path`。
- `workspaceRoot` 仅用于提取工作区名作为召回关键词。
- `mode` 不传时，在存在 `selection` 的路径里按 `relevant` 处理。

## 相关性选择

相关性选择器位于 `src/ai/memory/selector.ts`。

它先从当前请求中提取关键词：

- 用户消息文本。
- 文件引用路径和文件名。
- 工作区目录名。

英文、路径和标识符会统一小写，并按空格、路径分隔符、`.`、`_`、`-`、`@` 拆分。中文连续文本会生成 2 到 4 字滑窗关键词，避免长中文句子被当成一个不可命中的 token。

条目匹配使用归一化后的文本包含判断。命中后按分区基础权重加分：

- `Projects`、`Current Context` 权重较高。
- `Preferences`、`Facts` 次之。
- `Habits` 较低。
- `Instructions` 作为核心指令直接候选。

如果没有任何 `Preferences` 命中，会保留最多 3 条核心偏好，避免普通轮次完全丢失基础回答风格。

分区顺序仍按 `MEMORY_CATEGORIES` 输出；同一分区内按相关性分数排序，分数相同时保持原始条目顺序。

## 预算裁剪

注入构建器位于 `src/ai/memory/injector.ts`。

基础格式为：

```xml
<user_memory>
以下是关于该用户的已知信息，请在回应中自然地参考这些信息，不要刻意提及"根据记忆..."。

# Preferences
- 用户喜欢简洁回答
</user_memory>
```

默认预算为 `4000` 字符。

`full` 模式继续使用分区级裁剪，按 `PRUNE_PRIORITY` 保留高优先级分区：

1. `Instructions`
2. `Preferences`
3. `Current Context`
4. `Facts`
5. `Habits`
6. `Projects`

`relevant` 模式使用条目级裁剪：

- 先构建候选条目及相关性分数。
- 按分数、分区优先级、原始顺序排序。
- 每加入一个条目都实际拼装最终文本并检查长度。
- 只有最终文本不超过 `maxChars` 时才保留该条目。

这样可以避免一个高相关 `Projects` 条目被低相关 fallback 偏好挤掉，也避免估算误差让最终文本超过预算。

## `edit_memory` 安全边界

`edit_memory` 工具定义在 `src/ai/tools/builtin/MemoryTool/index.ts`。

它的语义是“按分区完整覆盖”：模型传入某个分区的新条目列表后，该分区会被替换为这个列表。这个设计简单直接，但有一个关键前提：模型必须看到当前完整记忆，否则它可能只基于部分记忆输出分区列表，导致未注入条目被覆盖丢失。

因此当前运行时策略是：

- 普通相关记忆轮次使用 `mode: 'relevant'`，并从工具列表中移除 `edit_memory`。
- 明确记忆编辑请求使用 `mode: 'full'`，并保留 `edit_memory`。
- 明确记忆编辑请求由 `src/components/BChat/index.vue` 中的意图规则判断，例如“记住”“整理记忆”“更新记忆”“忘记”等。

这是一条安全约束，不只是 token 优化。只要本轮可能调用 `edit_memory`，模型就必须基于完整记忆工作。

## 运行时调用链路

普通发送链路：

```text
BChat 输入
  -> buildUserInputParts() 解析文本与文件引用
  -> sendRuntimeUserMessage()
  -> prepareRuntimeRequest(userMessage, parts)
  -> createSelectionContext()
  -> resolveRuntimeMemoryContext(selection)
  -> memoryStore.buildSystemPromptContext({ selection, onSelectionDebug })
  -> buildSystemPromptContext()
  -> 写入 ChatRuntime runtimeContext.memory
  -> ChatRuntime send
```

重新生成链路：

```text
ConversationView 触发 regenerate
  -> startRuntimeRegenerate()
  -> findLastUserMessage(sourceMessages)
  -> resolveChatRuntimeRequestConfig(lastUserMessage)
  -> 使用最后一条源用户消息构建 MemorySelectionContext
  -> ChatRuntime continue
```

用户选择续跑等没有新用户消息的路径仍可调用通用 runtime config。没有 `selection` 时，记忆注入保持旧的 full 行为。

## 可观测性

每次构建记忆上下文时，`buildSystemPromptContext` 可通过 `onSelectionDebug` 返回调试信息：

```ts
export interface MemorySelectionDebugInfo {
  mode: MemoryInjectionMode;
  maxChars: number;
  finalChars: number;
  keywords: string[];
  selectedItems: MemorySelectionDebugItem[];
  droppedItems: MemorySelectionDebugItem[];
}
```

`BChat` 会把该信息合并本轮工具暴露状态，写入渲染进程日志：

```text
[memory-selection] {"mode":"relevant","keywords":["tibis","memory"],"editMemoryExposed":false,...}
```

日志包含：

- 实际注入模式。
- 最大预算和最终字符数。
- 召回关键词。
- 最终注入条目预览。
- 未进入最终注入的条目预览。
- 本轮是否暴露 `edit_memory`。

条目内容只记录最多 120 字的 preview，避免把完整长期记忆复制进日志。这个日志主要用于开发和排障，不作为用户可见 UI。

## 涉及文件

- `src/ai/memory/types.ts`
- `src/ai/memory/parser.ts`
- `src/ai/memory/selector.ts`
- `src/ai/memory/injector.ts`
- `src/stores/ai/memory.ts`
- `src/ai/tools/builtin/MemoryTool/index.ts`
- `src/components/BChat/hooks/useRuntimeConfig.ts`
- `src/components/BChat/index.vue`
- `test/ai/memory/injector.test.ts`
- `test/components/BChat/use-runtime-config.test.ts`
- `test/components/BChat/session-id-runtime.test.ts`

## 验证覆盖

当前测试覆盖：

- relevant 模式只注入相关记忆。
- `Instructions` 默认保留。
- 无偏好命中时最多保留 3 条核心偏好。
- 中文短词和长句召回。
- 文件引用路径召回。
- full 模式兼容旧完整记忆行为。
- 数字 `maxChars` 旧签名兼容。
- relevant 模式按条目裁剪并遵守预算。
- 高相关条目优先于 fallback 偏好。
- 普通发送过滤 `edit_memory`。
- 显式记忆编辑请求切到 full 并保留 `edit_memory`。
- regenerate 使用最后一条源用户消息构建选择上下文。
- 记忆选择调试信息和日志输出。

已运行过的相关验证命令：

```bash
pnpm exec vitest run test/ai/memory/injector.test.ts test/components/BChat/use-runtime-config.test.ts test/components/BChat/session-id-runtime.test.ts
pnpm exec tsc --noEmit
pnpm lint
pnpm lint:style
```

补充说明：全量 `pnpm test` 当前仍受 `test/views/widget/page-setter.test.ts` 中既有 `BMessage` 测试解析问题阻塞，与记忆系统改动无关。

## 当前限制

当前相关性召回是轻量词法匹配，不是语义检索。它适合先把“全部发送”优化为“可解释的相关发送”，但不保证语义同义词命中。

当前没有为记忆条目分配稳定 ID，调试和覆盖判断基于分区与内容。若未来支持条目级编辑、合并、去重和历史审计，应考虑引入稳定 ID。

`edit_memory` 的显式意图识别是启发式规则。它优先保证安全：普通轮次不暴露写记忆工具；真正要写记忆时切 full。未来如果误判较多，可以把“是否进入记忆编辑模式”做成更明确的用户交互。

日志目前只用于本地排障。后续如果做 UI 面板，应避免默认展示过多记忆内容，并继续保留 preview 截断和用户控制开关。
