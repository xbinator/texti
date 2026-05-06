<!--
  @file 2026-05-06-chat-context-compression-design.md
  @description AI 聊天长会话上下文压缩方案设计文档。
-->

# 2026-05-06 Chat Context Compression Design

## 背景

`src/components/BChatSidebar` 当前会把会话消息持续累积到聊天上下文中。虽然界面层通过分页历史降低了渲染压力，但模型调用侧仍然会随着会话变长持续膨胀，尤其在以下场景中更明显：

- 多轮长对话持续累积用户和助手消息
- 文件引用会把选中文本上下文展开到消息内容中
- 工具调用结果、确认卡片和用户选择题会占据额外上下文
- 可见思考片段和重复错误内容会放大上下文体积

结果是会话越长，推理成本越高，命中上下文窗口上限的概率越大，响应延迟也更不稳定。

## 目标

- 为 `BChatSidebar` 提供混合模式上下文压缩能力
- 支持自动压缩和手动压缩两个入口
- 自动压缩采用双阈值触发：消息轮数和上下文体积任一超限即触发
- 压缩后默认保留最近几轮消息和未完成交互消息的原文；历史文件引用消息优先保留路径、范围、用户意图和关键摘录摘要
- 通过规则裁剪加 AI 摘要生成结构化摘要，减少无效历史对后续模型调用的占用
- 让压缩失败时不阻塞用户继续聊天

## 非目标

- 第一版不实现按主题检索历史摘要
- 第一版不支持用户直接编辑摘要正文
- 第一版不实现多摘要联合召回
- 第一版不追求精准 token 计数，先用字符级体积估算作为触发依据
- 第一版不要求实时监听所有历史文件引用对应文件的内容变化

## 用户体验

### 自动压缩

- 当用户发送新消息前，系统先检查当前会话是否超出压缩阈值
- 如果超限，系统优先尝试刷新会话摘要，然后再发起本轮聊天请求
- 自动压缩对用户保持低打扰，不弹阻断式确认
- 若自动压缩失败，系统继续使用原始上下文完成本轮聊天，并给出一次轻量提示（toast，不阻断操作），例如"上下文压缩失败，已继续使用原始上下文"

### 手动压缩

- 在聊天侧边栏头部或更多菜单中提供“压缩上下文”入口
- 当会话已有摘要时，额外提供“查看摘要”和“重新压缩”
- 手动重新压缩优先基于原始历史消息重算，而不是在旧摘要上继续递归压缩

### 摘要可见性

- 用户可以查看当前会话的最新摘要内容
- 第一版摘要作为只读系统产物展示，不支持编辑
- 若后续需要提升可解释性，可以在此基础上演进为显式记忆卡片

## 触发策略

### 双阈值规则

- 消息轮数阈值：按用户消息和助手消息的有效轮数估算
- 上下文体积阈值：按待传给模型的消息总字符数估算
- 任一阈值超限即可触发自动压缩

### 建议默认值与常量命名

所有阈值集中定义在 `src/components/BChatSidebar/utils/compression/constant.ts`：

```ts
/** 最近保留消息轮数 */
export const RECENT_ROUND_PRESERVE = 6;

/** 自动压缩触发——消息轮数阈值 */
export const COMPRESSION_ROUND_THRESHOLD = 30;

/** 自动压缩触发——上下文体积阈值（字符数） */
export const COMPRESSION_CHAR_THRESHOLD = 24_000;

/** 规则裁剪输入体积硬上限（字符数） */
export const COMPRESSION_INPUT_CHAR_LIMIT = 32_000;

/** 摘要 summaryText 硬上限（字符数），超出截断 */
export const COMPRESSION_SUMMARY_TEXT_MAX = 4_000;
```

后续可以演进为设置项，但本设计不要求首版暴露到用户设置页面。

### 字符体积估算

字符体积估算必须基于模型转换后的结构，不能直接对 UI 消息列表做字符串长度统计：

```ts
// compression 模块内统一入口
function estimateContextSize(modelMessages: ModelMessage[]): number;
```

估算走 `messageHelper.toModelMessages()` 转换后再执行，原因：

- 文件引用在模型消息中可能展开为完整文件内容
- 工具结果在模型消息中可能被裁剪
- 确认卡片和用户选择题在模型消息中会转换为文本
- 不同 provider 可能追加工具 schema 或额外的 system prompt
- 摘要 system message 自身也计入体积

估算函数收敛在压缩模块内，UI、store、stream 层不各自实现体积计算逻辑。第一版用字符数近似，不依赖 tiktoken 等精确 tokenizer。

## 保留与压缩策略

压缩时并不是简单地把最早消息全部折叠，而是先把会话消息划分成“必须保留原文”“保留轻量文件语义”和“允许摘要”的三类。

### 必须保留原文的消息

- 最近几轮用户和助手消息
- 含未完成工具调用的助手消息
- 含未完成确认卡片的消息
- 含等待用户回答的 `ask_user_choice` 交互消息

### 保留轻量文件语义的历史消息

- 历史文件引用消息默认不永久保留完整展开内容
- 最近保留窗口内的文件引用消息保留完整原文
- 历史文件引用消息转为“文件路径 + 行号范围 + 用户意图 + 关键摘录摘要”
- 若后续仍强依赖原始文件内容，允许在后续轮次按需重新加载原文

### 优先进入摘要的消息

- 早期已完成的普通问答
- 已完成的工具调用和工具结果
- 冗长的可见思考片段
- 重复错误消息和无业务价值的占位消息

## 摘要构建模式

第一版区分自动增量摘要和手动全量重算。

### 自动压缩：`incremental`

自动压缩默认使用增量模式：以上一条 `valid` 摘要作为历史基础，合并 `coveredUntilMessageId` 之后的新可压缩消息，生成新的摘要记录。

增量模式下 `summarizer` 的输入为：

- 上一条 `valid` 摘要的 `summaryText` + `structuredSummary`
- `coveredUntilMessageId` 之后、最近保留窗口之前的可压缩消息（经规则裁剪后）

而非全量扫描整个会话历史。这保证了自动压缩的摘要模型调用成本与新增消息量成正比，不随会话总长度线性膨胀。

新摘要记录通过 `derivedFromSummaryId` 关联上一条摘要，便于排查摘要漂移问题。

增量深度限制：第一版不设硬性强制 `full_rebuild` 的层数上限（即不会在 N 次增量后自动触发全量重算）。但建议实现时在 `ConversationSummaryRecord` 中保留链长信息，方便后续通过 `derivedFromSummaryId` 追溯链长，评估是否需要引入强制刷新策略。

### 手动压缩：`full_rebuild` 优先

手动重新压缩默认使用全量重算模式：优先基于原始历史消息重新生成摘要。若原始历史本身已超过摘要模型可处理范围（例如可压缩消息总字符数超出摘要模型上下文窗口），则降级为 `incremental` 模式，并保留降级原因记录。

### 模式对比

| 维度 | `incremental` | `full_rebuild` |
|---|---|---|
| 触发入口 | 自动压缩 | 手动重新压缩 |
| 输入 | 上一条摘要 + 新增可压缩消息 | 全量原始历史消息 |
| 成本 | 与增量成正比 | 与会话总长成正比 |
| 摘要质量 | 依赖上一条摘要质量，存在漂移风险 | 理论上最优 |
| 超限降级 | / | 降级为 `incremental` |

## 当前消息排除规则

当前用户消息只参与本轮上下文体积估算和最终上下文组装，不允许进入本轮 `compressibleMessages`，也不允许被本轮摘要覆盖。

如果发送流程中已经先把当前用户消息插入消息列表，则 `planner` 必须通过 `excludeMessageIds` 显式排除当前消息。`prepareMessagesBeforeSend` 调用时传入：

```ts
{
  sessionId,
  messages,
  currentUserMessage,
  excludeMessageIds: [currentUserMessage.id]
}
```

## 历史保留消息穿透规则

位于摘要覆盖边界之前的消息，如果属于未完成工具调用、未完成确认卡片、等待用户选择等必须原文保留的消息，应记录到 `preservedMessageIds`。

上下文组装时不能简单丢弃 `coveredUntilMessageId` 之前的全部消息，而应组装为：

1. 系统提示词
2. 会话历史摘要
3. `preservedMessageIds` 对应的历史穿透原文消息
4. `coveredUntilMessageId` 之后的普通消息
5. 当前用户消息

`preservedMessageIds` 与 `sourceMessageIds` 互斥，同一消息不会同时出现在两个列表中。

## 摘要体积约束

摘要本身若不加体积约束，在 `fileContext` 条目过多或 `summaryText` 过长时，摘要注入后的上下文可能比压缩前还大，使双阈值检测形同虚设。

规则裁剪阶段的输出有硬上限：传入摘要模型前的消息总字符数不超过 `COMPRESSION_INPUT_CHAR_LIMIT`（建议 `32000`）。超出部分按以下优先级截断：

1. 优先保留最近的可压缩消息
2. 同一条消息内优先保留用户意图和关键结论
3. 丢弃冗长推理过程、重复错误和空占位消息

摘要模型产出的 `structuredSummary` 不作硬截断，但 `summaryText` 超过 `COMPRESSION_SUMMARY_TEXT_MAX` 时写入 `summaryText` 前进行尾部截断并追加省略标记。

## 摘要生成策略

摘要采用”两段式”生成，先规则裁剪，再调用 AI 生成结构化摘要。

### 阶段一：规则裁剪

规则裁剪负责把原始消息整理成更短、更稳定的摘要输入。建议处理包括：

- 移除空 assistant 占位消息
- 去重连续重复错误消息
- 工具调用只保留工具名、关键输入和关键结果摘要
- 可见思考内容仅保留结论性文本，不保留冗长推理展开
- 将长文件引用消息压缩为“文件路径 + 关注范围 + 用户意图”

若系统中存在模型隐藏推理或 `reasoning_content` 字段，第一版默认丢弃，不参与摘要生成和后续上下文注入。

### 阶段二：AI 结构化摘要

规则裁剪结果再送入摘要模型，输出统一结构的摘要对象。结构化摘要应具备稳定 schema，而不是松散字符串字段。

### `StructuredConversationSummary`

- `goal: string`
- `recentTopic: string`
- `userPreferences: string[]`
- `constraints: string[]`
- `decisions: string[]`
- `importantFacts: string[]`
- `fileContext: FileContextSummary[]`
- `openQuestions: string[]`
- `pendingActions: string[]`

同时保留一份可读性更强的 `summaryText`，用于查看摘要和提示信息展示。

### `FileContextSummary`

- `filePath: string`
- `startLine?: number`
- `endLine?: number`
- `userIntent: string`
- `keySnippetSummary: string`
- `shouldReloadOnDemand: boolean`

## 模块拆分

为了减少对 `src/components/BChatSidebar/index.vue` 和 `src/components/BChatSidebar/hooks/useChatStream.ts` 的侵入，建议新增五个职责明确的模块，并增加一个协调层承接状态机与兜底逻辑。

### `policy`

职责：

- 读取当前消息和摘要状态
- 基于摘要覆盖边界计算有效上下文
- 计算轮数和体积
- 判断是否触发自动压缩
- 返回触发原因和候选压缩区间

### `planner`

职责：

- 根据保留规则切分消息
- 输出"保留原文层""轻量文件语义层"和"可摘要层"
- 避免把未完成交互纳入摘要

### `summarizer`

职责：

- 执行规则裁剪
- 调用摘要模型生成结构化摘要
- 产出可持久化的摘要记录

模型选择优先级：

1. 用户通过 `serviceModelsStorage` 为 `'summarize'` 服务配置的模型
2. 若 `summarize` 未配置，降级使用 `'chat'` 服务的当前模型
3. 若两者都不可用，AI 摘要阶段失败，触发兜底

### `assembler`

职责：

- 在真正调用聊天模型前组装最终上下文
- 按固定顺序组装：系统提示词 → 会话摘要 → `preservedMessageIds` 穿透原文 → `coveredUntilMessageId` 之后普通消息 → 当前用户消息
- 固化摘要注入格式与消息优先级规则

### `coordinator`

职责：

- 串联 `policy`、`planner`、`summarizer` 和 `assembler`
- 持有会话级压缩互斥锁
- 决定本轮使用新摘要、旧摘要或原始上下文
- 统一处理失败兜底和状态切换

建议目录结构：

```txt
src/components/BChatSidebar/utils/compression/
  constant.ts
  types.ts
  policy.ts
  planner.ts
  summarizer.ts
  assembler.ts
  coordinator.ts
```

`index.vue` 只调用：

```ts
const assembledMessages = await coordinator.prepareMessagesBeforeSend({
  sessionId,
  messages,
  currentUserMessage
})
```

## 数据结构

摘要不应伪装成普通聊天消息混入消息表，而应作为会话附属记录单独持久化。

### `SummaryBuildMode`

```ts
type SummaryBuildMode = 'incremental' | 'full_rebuild';
```

### `ConversationSummaryRecord`

- `id`: 摘要记录 ID
- `sessionId`: 所属会话 ID
- `buildMode`: `SummaryBuildMode`——`incremental` 表示基于上一条摘要增量刷新，`full_rebuild` 表示基于原始历史消息全量重算
- `derivedFromSummaryId?`: 当 `buildMode = 'incremental'` 时，指向所继承的上一条摘要 ID，用于排查摘要漂移
- `coveredStartMessageId`: 本次摘要覆盖区间起点消息 ID
- `coveredEndMessageId`: 本次摘要覆盖区间终点消息 ID
- `coveredUntilMessageId`: 上下文组装时用于截断历史的边界消息 ID
- `sourceMessageIds`: 实际进入摘要的消息 ID 列表（被摘要覆盖且未被保留穿透的消息）
- `preservedMessageIds`: 位于摘要覆盖区间内但必须原文穿透的消息 ID 列表（如未完成工具调用、确认卡片、等待用户选择等）
- `summaryText`: 供用户查看和系统展示的摘要文本
- `structuredSummary`: `StructuredConversationSummary`
- `triggerReason`: 触发原因，例如 `message_count`、`context_size`、`manual`
- `messageCountSnapshot`: 生成摘要时的消息轮数快照
- `charCountSnapshot`: 生成摘要时的字符体积快照
- `schemaVersion`: 摘要 schema 版本
- `status`: `valid` | `superseded` | `invalid`
- `invalidReason?`: 失效原因
- `createdAt`: 创建时间
- `updatedAt`: 更新时间

### 设计说明

- `coveredUntilMessageId` 是上下文组装时的截断边界：ID 在此之后的消息作为原文注入，在此及之前的消息由摘要代表（`preservedMessageIds` 除外）。`coveredEndMessageId` 是摘要实际覆盖的区间终点（摘要针对 `coveredStartMessageId` 到 `coveredEndMessageId` 的消息生成）。关键区别：`coveredEndMessageId` 标记"摘要分析到了哪条消息"，`coveredUntilMessageId` 标记"上下文组装从哪里开始用原文"
- **示例一（不等）**：M1→M45，最近保留窗口 M39→M45。假设可摘要区间为 M1→M38，则 `coveredEndMessageId = M38.id`。但 M36→M38 中含有未完成工具调用，被放入 `preservedMessageIds`，实际进入 `sourceMessageIds` 的是 M1→M35。上下文截断边界取 `coveredUntilMessageId = M35.id`（跳过 preserved 消息的尾部），M36→M38 以穿透形式注入。此时 `coveredEndMessageId`(M38) > `coveredUntilMessageId`(M35)，两者不相等
- **示例二（等）**：若 M1→M38 中不含任何未完成交互，`sourceMessageIds = [M1...M38]`，`preservedMessageIds = []`，则 `coveredUntilMessageId = coveredEndMessageId = M38.id`——这是两者相等的唯一场景
- `sourceMessageIds` 是实际进入摘要的消息 ID 列表，去重判断以此为准；`coveredUntilMessageId` 仅用于上下文截断
- 第一版允许一个会话拥有多条摘要记录，但同一时间只允许一条 `valid` 摘要参与上下文组装
- **状态更新顺序是硬约束**：仅在新摘要写入成功后才将旧摘要标记为 `superseded`，禁止先标记再写入——防止写入失败后丢失旧摘要
- 旧摘要更像缓存，不作为唯一事实源；需要重新压缩时应优先回看原始消息

### 增量模式下的覆盖起点

增量压缩时，新摘要的 `coveredStartMessageId` 取上一条 `valid` 摘要的 `coveredEndMessageId` 的下一条消息 ID。即新摘要覆盖的区间为：上一条摘要终点（不含）→ 本轮可压缩区间终点（含）。

例如：上一条摘要 `coveredEndMessageId = M30.id`，本轮新增可压缩消息为 M31→M38，则新摘要 `coveredStartMessageId = M31.id`，`coveredEndMessageId = M38.id`，`sourceMessageIds = [M31...M38]`。

全量重算时，`coveredStartMessageId` 取自第一条可压缩消息。

### 增量模式下的 `preservedMessageIds` 刷新

增量压缩生成新摘要时，上一条摘要的 `preservedMessageIds` 中的消息**不会被自动继承**。新摘要的 `preservedMessageIds` 仅包含本轮 `sourceMessageIds` 覆盖范围内、根据当前保留规则判定为必须穿透的消息。

对于上一条摘要的 `preservedMessageIds` 中仍处于最新保留窗口内的消息，它们已被 `coveredUntilMessageId` 之后的原文区间覆盖，无需特殊处理。对于已超出保留窗口但仍处于未完成交互状态的消息，由 `planner` 重新判定——若交互已完成，进入 `sourceMessageIds`；若仍未完成，进入本轮新的 `preservedMessageIds`。

## 摘要有效性与过期判断

以下场景应导致摘要失效或被忽略：

- 被摘要覆盖的历史消息被删除
- 被摘要覆盖的历史消息被重新生成
- 被摘要覆盖的助手消息发生编辑
- 摘要结构化 JSON 解析失败
- 摘要 `schemaVersion` 低于当前支持版本
- 用户手动重新压缩后旧摘要被新摘要取代
- 历史文件引用对应的文件语义已显著变化且不能安全复用

实现上不要求第一版同步监听所有文件内容变化，但至少要为 `invalidReason` 和 `schemaVersion` 预留状态表达能力。

### `schemaVersion` 策略

- 第一版 `schemaVersion = 1`
- 版本号采用递增整数，每次 `StructuredConversationSummary` schema 变更时递增
- 读到 `schemaVersion` 低于当前支持版本的旧摘要时，自动标记 `invalid`，`invalidReason` 填写 `unsupported_schema_version`。不做兼容迁移，下一轮自动压缩会基于原始消息生成新版本摘要
- 读到 `schemaVersion` 高于当前支持版本时同样标记 `invalid`，防止向前不兼容

## 存储方案

摘要应沿用当前聊天持久化链路，通过 `chatStore` 和 SQLite 管理，而不是另建分散的本地存储。

### 数据库建议

新增 `chat_session_summaries` 表，至少包含以下列：

- `id`
- `session_id`
- `build_mode`
- `derived_from_summary_id`
- `covered_start_message_id`
- `covered_end_message_id`
- `covered_until_message_id`
- `source_message_ids`
- `preserved_message_ids`
- `summary_text`
- `structured_summary`
- `trigger_reason`
- `message_count_snapshot`
- `char_count_snapshot`
- `schema_version`
- `status`
- `invalid_reason`
- `created_at`
- `updated_at`

### Store 和 Storage 层职责

- `chatStore` 增加会话摘要的查询、创建和更新接口
- 聊天存储层负责摘要表的 CRUD 和序列化处理
- UI 层只消费摘要记录，不直接感知 SQLite 细节
- 第一版不清理 `superseded` 和 `invalid` 记录，保留完整摘要历史便于排查问题。后续可基于时间或数量阈值增加清理策略

## 摘要模型服务配置

`summarizer` 调用摘要模型时，需要独立的模型选择入口，沿用现有 `serviceModelsStorage` 模式。

### 服务类型注册

在 `ModelServiceType` 中新增 `'summarize'`，与 `polish`、`chat`、`autoname` 并列：

```ts
export type ModelServiceType = 'polish' | 'chat' | 'autoname' | 'summarize';
```

在 `src/views/settings/service-model/` 页面新增"会话历史压缩助理"卡片，允许用户独立选择摘要模型。

### 提示词策略

摘要提示词为系统固定模板，**不开放用户编辑**。原因：

- 摘要作为内部基础设施行为，稳定性优先于灵活性
- 与 `chat` 服务（无提示词卡片）类似，`summarize` 的 `showPrompt` 设为 `false`

```ts
<ServiceConfig
  service-type="summarize"
  title="会话历史压缩助理"
  description="指定用于压缩和摘要会话历史的模型"
  :show-prompt="false"
/>
```

### 结构化输出

摘要模型调用时使用 `response_format` 约束输出对齐 `StructuredConversationSummary` schema，不作 prompt 层面的 JSON 格式强制。

- 若所选模型不支持 `response_format`（structured output），降级为 prompt 内嵌 schema 约束
- 无论采用哪种模式，`summarizer` 内部对模型返回进行 JSON 解析校验，解析失败触发兜底

### 固定提示词模板

系统内部使用的固定 prompt 包含以下变量（由 `summarizer` 在调用时注入，不出现在 UI 变量选择器中）：

| 变量 | 来源 | 说明 |
|---|---|---|
| `{{CONVERSATION_CONTENT}}` | 规则裁剪输出 | 经阶段一裁剪后的会话内容 |
| `{{PREVIOUS_SUMMARY}}` | 上一条 `valid` 摘要 | 增量模式下提供，全量重算时为空 |

提示词核心约束：

1. 文件上下文保留文件路径、行号范围和用户操作意图
2. 增量模式下合并上一条摘要，而非简单拼接

### 模型选择

用户可以自由切换摘要模型（例如选择更轻量、更低成本的模型），不影响压缩流程的其他环节。若所选模型不可用，`summarizer` 的 AI 摘要阶段失败，触发兜底逻辑——回退到原始上下文，不阻塞聊天。

## 发送流程调整

### 自动压缩流程

1. 用户提交消息
2. 先把当前用户消息作为 pending message 纳入本轮体积估算
3. 读取最新 `valid` 摘要
4. 基于 `coveredUntilMessageId` 计算摘要覆盖边界之后的有效上下文，而不是重新扫描全量历史作为压缩依据
5. `policy` 判断边界之后的有效上下文是否超出双阈值
6. 若未超限，则直接组装上下文并发送
7. 若超限，则由 `coordinator` 获取会话级压缩锁
8. `planner` 切分保留消息、轻量文件语义和可摘要消息
9. `summarizer` 使用 **增量模式**（上一条 `valid` 摘要 + `coveredUntilMessageId` 之后的新可压缩消息）生成新摘要
10. 新摘要写入成功后，才将旧摘要标记为 `superseded` 或 `invalid`（硬约束：禁止先标记再写入，防止写入失败后丢失旧摘要）
11. `assembler` 组装最终上下文
12. 发起本轮流式对话
13. 若步骤 7–11 中任一环节失败，本轮不设新摘要，压缩锁释放，回到 `idle`，旧摘要保持原状态不被污染，使用原始上下文发送当前用户消息。下一轮重新从步骤 2 开始，体积估算以当前有效摘要的 `coveredUntilMessageId` 为边界（若无有效摘要则从第一条消息算起）

### 手动压缩流程

1. 用户点击”压缩上下文”
2. 读取当前会话消息并计算可压缩区间
3. 若无可压缩内容，则提示”当前上下文无需压缩”
4. 若当前会话处于 `compressing` 状态，提示"正在压缩中，请稍后重试"，终止流程
5. 若可压缩，优先使用 `full_rebuild` 模式——基于原始历史消息重新生成摘要
6. 若原始历史消息总字符数超出摘要模型可处理范围，降级为 `incremental` 模式，记录降级原因，`derivedFromSummaryId` 指向最近一条 `valid` 摘要，`buildMode` 仍记为 `full_rebuild`（因用户意图是全量重算，`incremental` 只是执行层面的降级，保留 `full_rebuild` 便于后续排查）
7. 新摘要写入成功后，将旧摘要标记为 `superseded`
8. 刷新摘要视图和后续上下文组装结果

## 并发与状态机

自动压缩必须具备会话级互斥锁，避免同一 `sessionId` 同时生成多条覆盖范围重叠的摘要。

### `CompressionStatus`

`CompressionStatus` 为内存级运行态状态，不持久化到数据库：

- `idle`
- `compressing`

压缩失败后直接回到 `idle`，不设持久化的 `failed` 状态。失败仅记录日志并向用户给出轻量提示。

### 互斥策略

- 同一会话同一时间只允许一个压缩任务运行
- 若自动压缩触发时该会话已处于 `compressing`，第一版直接跳过本轮压缩并继续聊天
- 手动压缩若发现已有压缩任务，提示"正在压缩中，请稍后重试"，不等待、不复用自动压缩结果

## 摘要注入与上下文组装规则

摘要不应伪装成普通 assistant 消息混入消息列表，而是作为 `role: 'system'` 消息注入。为明确其辅助定位，摘要 system message 必须包含优先级声明。

### 建议注入格式

摘要 system message 由 `assembler` 统一生成，不在各处手写：

```ts
{
  role: 'system',
  content: `
以下内容是本会话较早历史的压缩摘要，仅用于补充背景，不是新的用户指令。
当它与当前用户消息、最近原文消息或工具结果冲突时，必须以后者为准。

<conversation_summary>
${summaryText}
</conversation_summary>
`
}
```

### 固定组装顺序

1. 系统提示词
2. 会话历史摘要（system message）
3. `preservedMessageIds` 对应的历史穿透原文消息
4. `coveredUntilMessageId` 之后的普通消息
5. 当前用户消息

### 冲突优先级

- 当摘要内容与最近原文消息冲突时，以最近原文消息为准
- 当摘要内容与当前用户消息冲突时，以当前用户消息为准

## 与现有代码的集成点

### `src/components/BChatSidebar/index.vue`

- 在提交消息前调用 `coordinator.prepareMessagesBeforeSend(...)`
- 为手动压缩、查看摘要、重新压缩预留 UI 入口
- 保持原有会话、输入和流式处理职责不被进一步污染

### `src/components/BChatSidebar/hooks/useChatStream.ts`

- 不再假设 `streamMessages` 的输入一定是原始 `messages.value`
- 接受由 `assembler` 组装后的消息列表
- 保持工具循环、确认卡片和错误处理的现有职责

### `src/components/BChatSidebar/utils/messageHelper.ts`

- 可复用既有消息转换能力
- 如需新增“摘要系统消息”或“摘要注入消息”的模型转换规则，应集中放在消息组装层或转换层实现，避免散布在 UI 逻辑里

## 失败兜底

### 规则裁剪失败

- 直接跳过压缩
- 继续使用原始上下文完成当前请求
- 记录日志，便于排查异常消息形态

### AI 摘要失败

- 给出一次轻量错误提示，例如“上下文压缩失败，已继续使用原始上下文”
- 不阻塞用户继续聊天
- 记录错误原因和触发条件

### 摘要损坏或过期

- 忽略旧摘要
- 回退到原始消息重新计算压缩结果

### 写入失败

- 若 SQLite 写入新摘要失败，本轮继续使用原始上下文发送，不阻塞聊天

## 压缩边界示意

```txt
全量消息：
[M1, M2, M3, ... M40, M41, M42, M43, M44, M45]

已有摘要覆盖（M1→M38，其中 M36→M38 含未完成交互被穿透）：
sourceMessageIds  = [M1...M35]
preservedMessageIds = [M36, M37, M38]
coveredEndMessageId   = M38.id
coveredUntilMessageId = M35.id

最近保留窗口：
[M39 ... M45]

本轮模型上下文：
[
  System 提示词,
  Summary(M1 ... M35),
  M36, M37, M38 (preservedMessageIds 原文穿透),
  M39 ... M45 (coveredUntilMessageId 之后原文),
  当前用户消息
]
```

## 验证与测试

### 单元测试

- `policy` 的双阈值判断
- `planner` 的保留规则切分
- `summarizer` 的规则裁剪输出
- `assembler` 的上下文组装顺序
- 摘要覆盖边界计算与 `coveredUntilMessageId` 截断逻辑
- 摘要过期与状态切换逻辑

### 集成测试

- 长会话自动压缩后仍能正常继续对话
- 含文件引用的用户消息不会被错误压缩
- 未完成确认卡片和用户选择题不会被摘要吞掉
- 手动重新压缩会生成新摘要并将旧摘要标记为 `superseded`

### 并发测试

- 连续发送两条消息不会生成两个覆盖范围重叠的摘要
- 压缩中切换会话不会污染另一个会话

### 文件引用测试

- 历史文件引用被摘要后仍保留文件路径和行号范围
- 最近文件引用保留原文
- 文件路径变更或文件不存在时摘要不阻塞聊天

### 回滚测试

- 摘要 JSON 损坏时自动忽略
- 摘要模型失败时本轮仍能正常发送
- SQLite 写入失败时不影响聊天请求

### 摘要质量测试

- 注入摘要后模型仍以最近原文为准回答，不会过度依赖摘要历史（集成验证：构造摘要内容与最新消息冲突的场景，断言模型回答倾向于最新消息）
- 增量摘要连续叠加 5 轮后，`summaryText` 仍包含正确的用户目标和关键决策，无明显漂移

### 回归重点

- 会话切换
- 消息重新生成
- 历史分页加载
- 工具调用循环
- 自动命名

## 分阶段实施建议

### 第一阶段

- 新增摘要数据结构和持久化表
- 完成双阈值判断、边界截断和消息切分
- 支持自动压缩与基础手动压缩
- 落地会话级并发锁和摘要状态机

### 第二阶段

- 增加摘要查看入口
- 优化规则裁剪质量和错误提示
- 完善测试覆盖

### 第三阶段

- 评估是否演进为多段摘要或显式记忆卡片
- 评估是否接入更精确的 token 估算

## 决策结论

第一版采用“混合模式 + 双阈值自动触发 + 会话级并发锁 + 结构化摘要记录 + 明确覆盖边界”的方案，以最小侵入方式为 `BChatSidebar` 增加上下文压缩层。实现重点不在于改变聊天 UI，而在于把“是否压缩、压什么、怎么摘要、怎么组装回上下文”从现有发送链路中清晰拆出，形成可演进的会话记忆基础设施。
