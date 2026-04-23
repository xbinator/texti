# 2026-04-24 File Reference Context Design

## 背景

当前聊天输入框已经支持插入 `file-ref` inline chip，但现有实现会在发送前把占位符直接展开为纯文本描述。这会带来两个问题：

- 输入框里看到的是 chip，聊天气泡里却被改写成普通文本，显示层不一致。
- 模型上下文依赖路径和即时展开逻辑，未保存文件、重名临时文件和历史重放都不够稳定。

本次设计要把“可见消息”和“模型上下文”拆开：聊天消息始终保留用户看到的 chip 形态，模型使用单独构建的引用上下文；同时把 `file-ref` 的定位主键从路径切换为文档 `id`，避免未保存文件路径缺失或重复的问题。

## 目标

- 输入框中的 `file-ref` chip 在聊天气泡中保持同样的展示语义，不因发送而改写正文。
- `file-ref` 使用稳定的 `documentId` 关联文档，未保存文件也能唯一定位。
- 聊天消息持久化时保存内联引用与发送时文档快照，历史重放不依赖当前活动编辑器是否仍然存在。
- 为长文档建立固定三档上下文注入策略，避免每次都把整篇全文塞给模型。
- 为未来升级为“动态摘要”预留独立数据层，而不是推翻现有消息结构。

## 非目标

- 本阶段不支持跨会话共享摘要缓存。
- 本阶段不让 `excerpt` 参与模型上下文构建。
- 本阶段不引入可配置阈值面板，三档阈值先写死在实现里。
- 本阶段不设计引用外部网页、数据库记录或非文档型上下文资产，只覆盖编辑器文档引用。
- 本阶段不实现孤儿 `snapshot` 与 `summary` 的自动清理；会话删除后数据暂时保留，后续再单独设计清理策略。

## 核心设计

### 显示层与模型层分离

用户消息正文继续保存 `file-ref` token，用于输入框和聊天气泡的可见渲染。模型侧不直接消费这些 token，而是在消息转换为 `ModelMessage` 时，读取引用元数据和快照，额外构建引用上下文。

这意味着：

- `content` 和 `parts` 负责“用户看到了什么”。
- `references` 负责“正文中的 token 对应哪一个内联引用”。
- `snapshot` 和 `summary` 负责“发送当时给模型使用的事实材料”。

### 引用数据与附件数据分离

`file-reference` 不挂在 `files` 中，而是单独使用 `references` 字段。

原因：

- `files` 当前语义是上传附件，带有上传、预览、发送等流程。
- `references` 是正文中的内联引用，语义和生命周期都不同。
- 后续若扩展标题引用、块引用、外链引用，`references` 更适合承载统一的“上下文资产”。

## 数据模型

### ChatMessage

```ts
interface ChatMessage {
  id: string
  role: ChatMessageRole
  content: string
  parts: ChatMessagePart[]
  references?: ChatMessageFileReference[]
}
```

### ChatMessageFileReference

```ts
interface ChatMessageFileReference {
  id: string
  token: string
  documentId: string
  fileName: string
  line: string
  path?: string | null
  snapshotId: string
  excerpt?: string
}
```

字段约束如下：

- `id`：这条引用对象自身的唯一标识。
- `token`：正文里的稳定占位符，用于从消息正文反查引用对象，例如 `{{file-ref:ref_xxx}}`。
- `documentId`：编辑器文档 ID，是文档定位的主键，不再依赖路径。
- `fileName`：显示名称，用于 chip 文案和聊天气泡渲染。
- `line`：行号或行号范围，例如 `12`、`12-18`。
- `path`：可选展示信息，不参与唯一性判断。
- `snapshotId`：指向发送时文档快照。
- `excerpt`：只用于 UI 预览，例如 hover、历史列表提示，不参与模型上下文构建。

### line 解析契约

`line` 虽然使用 `string` 存储，但语义只允许两种格式：

- 单行：`"12"`
- 闭区间范围：`"12-18"`

实现中的 `parseLineRange` 需要遵守下面的固定规则：

- 输入单行时，返回 `start = end = 12`。
- 输入闭区间时，返回 `start = 12`、`end = 18`。
- 行号使用 1-based，与编辑器界面显示的行号保持一致。
- 只接受正整数行号，不接受 `0`、负数、小数和空字符串。
- 范围必须满足 `start <= end`。
- 解析失败时不抛异常，调用方仍按文档总行数走三档策略，但跳过局部片段裁剪：
  - 小文档继续注入全文。
  - 中文档和超长文档只注入概览层，不注入局部片段层。

### ChatReferenceSnapshot

```ts
interface ChatReferenceSnapshot {
  id: string
  documentId: string
  title: string
  content: string
  createdAt: string
}
```

`snapshot` 保存发送时的原始文档事实，是模型上下文的唯一事实源。历史重放时只依赖它，不依赖当前活动编辑器是否还开着、文件路径是否变化、文件内容是否已被用户改写。

### snapshot 复用策略

同一 `documentId` 在同一次发送中只生成一份 `snapshot`，多个 `reference` 可以共享同一个 `snapshotId`。跨消息不复用 `snapshot`，每次发送都生成独立快照，保证历史语义互不干扰。

### ChatReferenceSummary

```ts
interface ChatReferenceSummary {
  id: string
  snapshotId: string
  kind: 'document-overview'
  strategy: 'rule' | 'model'
  text: string
  createdAt: string
}
```

`summary` 是派生数据，不是事实源。它的职责是给超长文档提供概览层，允许后续从规则概览平滑升级为动态摘要，而不需要调整消息与快照结构。

## Token 设计

正文使用稳定 token 保存 `file-ref`，推荐格式：

```text
{{file-ref:ref_xxx}}
```

设计约束如下：

- token 只用于消息正文和 `references[]` 之间建立稳定映射。
- token 不承载路径、行号或 JSON 负载，避免正文过重和解析脆弱。
- 聊天气泡渲染时根据 `token -> reference` 映射恢复 chip。
- 手动粘贴 token 到输入框时，只允许在当前消息草稿的 `references` 集合里查找对应 `reference`；找不到则按普通文本保留，不做跨消息或全局查找。

## 发送与持久化流程

### 插入阶段

当用户从编辑器工具栏插入引用时：

1. 生成一条新的 `ChatMessageFileReference`。
2. 为该引用生成稳定 `token`。
3. 在 `BPromptEditor` 中插入不可编辑 chip。
4. `content` 中保存 token，而不是路径或 JSON 负载。
5. 草稿态在输入组件内部同步维护 `references` 集合。

### 发送阶段

当用户点击发送时：

1. 正文 `content` 原样进入用户消息，保持 token 不变。
2. 从当前活动编辑器上下文按 `documentId` 读取文档内容。
3. 同一 `documentId` 在本次发送内只创建一份 `snapshot`，多个引用共享该 `snapshotId`。
4. 将 `references` 与 `snapshotId` 一起写入消息记录。
5. 模型上下文构建器读取 `references + snapshot`，按固定策略生成引用上下文。

正文永远不在发送阶段被改写，从而保证输入框和聊天气泡的显示一致。

### 历史重放阶段

当历史消息重新载入时：

- 聊天气泡只依赖 `content + references` 还原 chip。
- 模型重放只依赖消息上的 `references` 和存储中的 `snapshot`。
- 即便文档已关闭、重命名或另存为，历史语义仍然使用发送时的那份快照。

## 上下文注入策略

三档阈值先写死，后续再参数化：

- 小文档：总行数 `<= 200` 行，直接注入全文。
- 中文档：总行数 `201 - 800` 行，注入命中范围前后各 `120` 行的局部片段。
- 超长文档：总行数 `> 800` 行，注入“文档概览 + 命中范围前后各 120 行片段”。

### 超长文档的上下文顺序

超长文档统一按下面顺序构建：

1. 文件信息：文件名、文档标题、命中行号、总行数。
2. 概览层：优先动态摘要，其次规则概览。
3. 局部层：引用范围前后各 `120` 行片段。

### 规则概览

在尚未接入动态摘要时，规则概览先使用轻量规则生成，例如：

- 文档标题
- 总行数
- 首个非空段落
- 首级标题列表的截断摘要

规则概览的目标不是替代全文，而是在超长文档时给模型提供低成本的全局方向感。

## excerpt 的职责

`excerpt` 的职责必须固定：

- 仅用于 UI 预览，例如 chip hover、历史列表提示、引用卡片提示。

`excerpt` 不用于：

- 模型上下文构建
- 发送时 fallback
- 历史消息语义恢复

模型上下文只能从 `snapshot` 读取，再按阈值策略生成，避免 UI 预览字段意外成为事实源。

## 动态摘要的演进路线

### 当前阶段

当前先实现“规则概览”：

- 小文档用全文。
- 中文档用附近片段。
- 超长文档用规则概览 + 附近片段。

### 升级阶段

后续升级到动态摘要时，不修改 `references` 和 `snapshot` 结构，只新增 `summary` 层：

1. 当超长文档引用首次发送且不存在 `summary` 时，尝试生成 `strategy: 'model'` 的摘要。
2. 生成成功后缓存到 `ChatReferenceSummary`。
3. 同一个 `snapshotId` 再次被引用时，直接复用已有摘要。
4. 如果动态摘要失败或超时，则回退到 `strategy: 'rule'` 的概览。

### 升级收益

这种演进方式的好处是：

- 不需要修改消息结构。
- 不需要修改 chip 渲染逻辑。
- 不需要重写历史消息持久化。
- 只需要调整“上下文构建器”的摘要来源优先级。

## Fallback 规则

发送流程不能因为摘要生成失败而阻塞消息发送，因此 fallback 顺序固定为：

1. 优先使用动态摘要。
2. 动态摘要失败时回退规则概览。
3. 规则概览不可用时至少保留局部片段。
4. 如果局部片段也无法生成，则至少发送用户可见正文，不中断聊天流程。

## 实现边界

建议按以下顺序分阶段落地：

### 阶段一：消息结构与显示一致性

- 将 `file-ref` token 改为 `{{file-ref:ref_xxx}}`。
- 新增 `references` 字段。
- 聊天气泡支持按 `token -> reference` 渲染 chip。
- 输入框和聊天气泡的显示统一基于 `content + references`。
- 阶段一暂时保留现有发送逻辑不变，仅完成显示层统一；正文停止改写在阶段二随 `snapshot` 一起落地。

### 阶段二：快照与固定三档策略

- 发送时生成 `snapshot`。
- 发送阶段停止改写用户正文，改由 `snapshot` 构建模型引用上下文。
- 模型上下文改为从 `snapshot` 构建。
- 落地固定三档阈值与规则概览。

### 阶段三：动态摘要

- 新增 `summary` 存储与读取。
- 上下文构建器在超长文档场景优先使用动态摘要。
- 保留规则概览作为稳定 fallback。

## 测试建议

- 插入 `file-ref` 后，输入框和聊天气泡显示一致。
- 用户消息发送后，`content` 仍保存 token，不被展开为路径文本。
- 未保存文件使用 `documentId` 仍能唯一引用，不受路径为空影响。
- 同一次发送中相同 `documentId` 的多个引用共享同一个 `snapshotId`，跨消息不复用 `snapshot`。
- 历史重放时，即便当前编辑器关闭，仍可用 `snapshot` 生成模型上下文。
- `parseLineRange` 对单行、范围和非法输入的行为符合约定，非法输入不会阻塞发送。
- 小文档命中全文策略，中文档命中局部片段策略，超长文档命中概览加片段策略。
- `excerpt` 仅影响 UI 预览，不影响模型上下文。
- 手动粘贴 token 只在当前草稿的 `references` 范围内尝试还原，不会跨消息串联引用。
- 动态摘要失败时，会回退到规则概览，不阻塞发送。
