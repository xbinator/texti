# WebView 历史观察裁剪与步骤记忆设计

## 背景

Tibis 通过 `read_current_webpage` 把当前 WebView 的 BrowserState 返回给模型。结果同时包含 `summary`、简化 DOM、正文、标题、链接、可交互元素、视口和选中元素等信息。ChatRuntime 会把工具调用与工具结果持久化，并在后续模型请求中重新投影这些 Part。

现有通用工具结果剪枝只处理最近两个用户轮次之前、序列化长度超过 4 KB 的成功结果，或在上下文高压时裁剪当前轮较早的大型结果。因此，最近轮次和普通工具续轮仍会反复发送已经过期的网页 DOM。旧 `[N]` 元素句柄与 `snapshotId` 已经失效，不仅浪费 Token，也可能诱导模型操作错误页面状态。

Page Agent 的 LLM 契约采用另一种边界：最新 BrowserState 是当前观察，历史只保留反思、记忆、目标、动作和结果，不携带旧 DOM。Tibis 继续保留通用 ChatRuntime 工具循环，但采用相同的“当前观察与历史步骤分离”原则。

直接删除历史 DOM 仍不完整。Tibis 当前没有等价于 Page Agent `evaluation_previous_goal`、`memory` 和 `next_goal` 的步骤记忆；旧网页结果同时承担了观察与临时记忆职责。如果只保留 URL、标题和动作结果，跨页面比较、滚动收集和状态恢复任务会丢失已发现的业务事实。因此，本设计同时引入 WebView 步骤记忆。

## 目标

- 正常模型请求中最多只携带一个当前有效的完整网页观察。
- 历史 `read_current_webpage` 不发送简化 DOM、正文、元素数组、视口或旧句柄。
- `operate_webpage` 保存任务相关的步骤记忆，使模型在移除旧 DOM 后仍能继续多步骤任务。
- 每个 WebView 操作后要求模型重新读取页面，形成稳定的“读取 → 操作 → 读取”节奏。
- 正常模型请求与自动/手动压缩的摘要请求均不发送历史 DOM。
- 完整工具结果继续保存在数据库并供聊天 UI 展示，裁剪只影响模型投影。
- 保持现有 checkpoint、fingerprint、Part 拓扑和工具确认语义。

## 非目标

- 不删除、覆盖或迁移数据库中的历史网页快照。
- 不改变 Renderer 的 DOM 抓取、元素编号或实际页面操作逻辑。
- 不把 WebView 自动化改造成独立的第二套 Agent 循环。
- 不自动在每个模型请求前读取 WebView；模型仍显式调用 `read_current_webpage`。
- 不在本次改动中优化当前快照自身的重复字段。
- 不重写功能上线前已经生成的 checkpoint 摘要；其中缺少可用于区分网页原文与业务事实的来源标记。
- 不把 WebView 页面生命周期变化自动同步为 ChatRuntime 观察版本；操作前仍由 Renderer 的 snapshot 与元素指纹校验阻止过期动作。
- 不保证从模型生成的步骤记忆中识别所有可能的页面原文改写；通过字段约束、长度上限和投影清理控制风险。

## 核心原则

模型上下文中的 WebView 信息分为两类：

- **当前观察**：最新用户轮次中，最后一个已完成 WebView 步骤是成功的 `read_current_webpage`。只有这一个读取结果可以保留完整 BrowserState。
- **历史步骤**：所有其他网页读取、网页操作和更早用户轮次中的 WebView Part。历史步骤只保留步骤记忆、动作和执行结果。

元素 `[N]` 和 `snapshotId` 只属于当前观察，不能作为跨步骤记忆。

## `operate_webpage` 步骤记忆协议

### 数据结构

`operate_webpage` 的模型输入新增必填 `step`：

```ts
interface WebviewStepMemory {
  /** 根据最新观察判断上一步是否达到目标。 */
  evaluation: string
  /** 后续步骤仍需保留的业务事实。 */
  memory: string
  /** 本次动作希望达到的单一目标。 */
  nextGoal: string
}

interface WebviewOperateToolInput {
  snapshotId?: string
  step: WebviewStepMemory
  action: WebviewOperateAction
}
```

字段限制：

- `evaluation` 最大 500 字符。
- `memory` 最大 1,200 字符。
- `nextGoal` 最大 300 字符。
- 三个字段在公开工具 Schema 中必填，但允许空字符串。
- `memory` 只记录跨步骤仍成立的业务事实，例如价格、名称、筛选条件和完成状态。
- `step` 不得记录 `[N]`、`snapshotId`、CSS selector、HTML/简化 DOM 行或大段页面原文。
- `nextGoal` 描述本次动作的单一目标，不编排多个后续动作。

示例：

```json
{
  "snapshotId": "webview-snapshot-123",
  "step": {
    "evaluation": "搜索结果已经加载，当前展示三家供应商。",
    "memory": "目前最低价格为 ¥820，供应商为 A。",
    "nextGoal": "打开下一页并继续比较价格。"
  },
  "action": {
    "type": "click",
    "index": 12
  }
}
```

### 职责边界

`step` 是 ChatRuntime 的模型历史元数据，不参与真实 DOM 操作：

1. Provider 生成完整 `WebviewOperateToolInput`。
2. 主进程使用 `action` 生成确认文案；确认界面不展示 `step`。
3. 主进程持久化的原始工具调用保留 `step`。
4. 主进程请求 Renderer bridge 时只转发 `snapshotId` 与 `action`。
5. Renderer 继续执行现有 `WebviewOperateInput`，不依赖步骤记忆。

这样可以避免把模型生成的解释混入页面控制协议，也不要求 Renderer 为纯历史元数据增加职责。

### 兼容策略

- 新公开工具 JSON Schema 要求 `step`。
- 主进程执行边界允许旧调用缺少 `step`，但只严格归一化并转发 `snapshotId` 与 `action`，不会把历史元数据补入 Renderer 协议。
- 非对象输入、缺少动作必填字段、越界数字、超长文本与无效枚举在确认前返回 `INVALID_INPUT`；未知字段只在发送侧丢弃。
- 已持久化旧工具调用不会被重新执行，无需数据库迁移。
- 历史旧调用没有步骤记忆时仍执行 DOM 裁剪，模型投影中的三个步骤字段补为空字符串。

## WebView 模型投影

### 当前观察状态机

投影函数从最新用户消息之后按 Part 顺序扫描已完成的 WebView 工具：

1. 成功 `read_current_webpage`：把该 Part 标记为当前观察。
2. 失败 `read_current_webpage`：清除当前观察；失败结果本身保持原样。
3. 任意终态 `operate_webpage`：消费并清除当前观察，不区分成功、拒绝、取消或失败；`awaiting_user_input` 不是终态，不消费当前观察。
4. 非 WebView 工具：不改变当前观察。
5. 后续成功读取：替换为新的唯一当前观察。

典型序列：

```text
read₁（完整）
→ operate（read₁ 变为历史）
→ read₂（仅 read₂ 完整）
→ 其他工具（read₂ 继续完整）
→ 新用户消息（read₂ 变为历史）
```

任何完成的操作都消费观察，是一项有意的保守策略。即使操作被拒绝或失败，模型也需要重新读取后再尝试，以免复用已经变化或无法证明仍有效的句柄。

### 历史读取投影

历史成功读取结果替换为：

```ts
interface HistoricalWebviewSnapshotStub {
  url?: string
  title?: string
  capturedAt?: number
  pruned: true
  pruneReason: 'historical_webview_snapshot'
  summary: string
}
```

固定 `summary`：

```text
Historical webpage snapshot omitted. Its snapshotId and [N] handles are invalid. Call read_current_webpage to observe the current page.
```

只在原值类型正确时复制 `url`、`title`、`capturedAt`。不透传任何未知字段。明确移除：

- `snapshotId`
- 原始 `summary`
- `header`、`content`、`footer`
- `text`、`selectedText`
- `headings`、`links`
- `elements`、`viewport`、`selectedElement`
- `scroll`、`truncated`

失败或取消读取保留稳定错误码与清理后的错误消息，丢弃任意 `error.details`、DOM、句柄与快照令牌，以便模型恢复且不允许错误旁路携带页面原文。

### 历史操作投影

历史 `operate_webpage` 工具调用保留：

- 经过长度限制和句柄清理的 `step`。
- 按公开协议白名单与范围约束清理后的 `action`，用于说明做过什么。
- 按稳定字段白名单清理后的操作结果，用于说明是否成功、操作目标和页面是否变化。

历史操作输入移除 `snapshotId`。投影层还会：

- 移除形如 `webview-snapshot-*` 的快照令牌。
- 移除形如 `[12]` 或 `*[12]` 的元素句柄。
- 删除形如 `[12]<button ... />` 的简化 DOM 行。
- 对旧数据重新执行字段长度限制。
- 删除 `inputText`、`providerMetadata`、`shellOutput` 与 `shellRunState` 等不进入正常模型消息、但会被 compaction 序列化的瞬时字段。
- 成功结果只保留 `ok`、动作、目标摘要、消息、滚动摘要与页面变化标记；失败或取消结果丢弃 `error.details` 并清理消息中的 DOM、句柄和快照令牌。

持久化工具调用保持原样，以上处理只发生在模型投影 clone 中。

## 投影接入顺序

正常模型请求采用：

```text
完整持久化消息
→ checkpoint/raw tail 投影
→ Skill 内容失效投影
→ WebView 历史语义投影
→ 通用大型工具结果剪枝
→ 当前轮高压剪枝
→ Token 估算
→ ModelMessage 转换
```

WebView 语义投影必须早于 Token 估算，确保预算反映实际发送内容；也必须早于通用工具结果剪枝，避免由 4 KB 阈值决定网页快照是否安全。

实现应使用独立纯函数，例如：

```ts
projectWebviewToolOutputs(messages): ChatMessageRecord[]
```

函数要求：

- 不修改输入。
- 对未知或异常结果采用发送侧保守裁剪。
- 不改变工具 Part ID、toolCallId、toolName、状态和结果配对。
- 无需投影时允许复用原 clone，但不能回写持久化对象。

## Compaction 处理

摘要请求中的所有 `read_current_webpage` 都已经属于历史，因此不得保留任何完整网页观察。

Compaction Planner 构造摘要源时复用同一历史读取存根和操作输入清理逻辑：

- `sourceSnapshot` 中的所有成功网页读取都替换为存根。
- WebView 操作输入移除旧 `snapshotId` 并清理步骤记忆。
- 动作和操作结果继续参与摘要，让 checkpoint 可以保留已完成工作和业务事实。
- `fingerprintSources` 继续使用原始不可变 Part clone，不参与语义裁剪。
- source fingerprint、boundary 和提交前一致性检查保持不变。

这样正常对话模型和 compaction 摘要模型都不会收到历史 DOM，同时数据库原文和完整性证明仍然存在。

## 异常与安全策略

- 历史成功读取的数据即使格式异常，也只复制已知且类型正确的轻量字段。
- 主进程接收当前读取时使用 WebView snapshot guard；模型投影再次复用同一 guard，结构不完整、快照 ID 空白或超长的旧数据不会成为当前观察。
- 投影函数不得因单个异常工具结果阻止整个聊天请求。
- 当前读取失败后不恢复更早的完整观察。
- 操作被拒绝、取消或失败后不保留旧完整观察。
- `done` 但结果缺失的读取或操作按未知终态处理并清除旧观察，避免崩溃恢复时复用可能过期的 DOM。
- 历史存根不包含旧 `snapshotId`，避免模型误用。
- 步骤记忆是模型生成文本，不视为页面事实来源；后续页面读取和工具执行仍是唯一状态依据。
- 字段长度上限既在公开 Schema 中声明，也在历史投影时重新执行，覆盖旧数据和非标准 Provider 输入。

## 用户界面与持久化

- 聊天气泡继续读取持久化的完整 `read_current_webpage` 结果，展示行为不变。
- 工具确认卡片继续只展示 action 摘要，不展示 `evaluation`、`memory` 或 `nextGoal`。
- 数据库继续保存完整网页快照和原始步骤记忆。
- 回滚、分支、重新生成和历史加载继续操作原始 Part，不操作模型投影。
- 本设计优化的是“发送给模型的内容”，不是本地数据保留策略。

## 文件改动范围

- `shared/ai/tools/WebviewTool/index.ts`
  - 新增 `step` JSON Schema、字段说明和长度限制。
  - 更新工具描述，要求步骤记忆不得包含句柄或 DOM。
- `electron/main/modules/chat/runtime/tools/WebviewTool/index.mts`
  - 在确认前严格归一化当前执行输入。
  - 确认文案继续只读取 action。
  - Renderer bridge payload 移除 `step`。
- `electron/main/modules/chat/runtime/tools/WebviewTool/input.mts`
  - 共享历史动作白名单与当前执行输入严格归一化。
- `electron/main/modules/chat/runtime/tools/WebviewTool/result.mts`
  - 共享成功结果和错误结果发送侧白名单清理。
- `electron/main/modules/chat/runtime/tools/{constants,guards,types}.mts`
  - 复用公开字段上限、快照 guard 与归一化后的 Runtime 类型。
- `electron/main/modules/chat/runtime/context/`
  - 新增 WebView 历史语义投影纯函数。
  - 清理历史读取结果和历史操作输入。
- `electron/main/modules/chat/runtime/compaction/projector.mts`
  - 在通用工具结果剪枝前接入 WebView 投影。
- `electron/main/modules/chat/runtime/compaction/planner.mts`
  - 摘要源对所有 WebView 读取执行历史裁剪。
  - fingerprint 原始源保持不变。
- `src/ai/tools/context/webview.ts`
  - 保持 Renderer 页面操作输入不包含 `step`，必要时明确区分工具输入与页面操作输入。
- `src/components/BChat/utils/runtimeBridge.ts`
  - 继续只校验和转发 Renderer 实际需要的 `snapshotId` 与 `action`。
- 相关单元测试与 ChatRuntime 集成测试。

## 测试设计

### 工具协议

- `operate_webpage` 公开 Schema 要求 `step`。
- 三个步骤字段的最大长度正确。
- 缺少必填步骤字段的 Provider 输入被工具 Schema 拒绝。
- 主进程兼容旧调用缺少步骤记忆，但严格拒绝非法页面操作参数。
- 确认描述不包含步骤记忆。
- Renderer bridge payload 不包含 `step`。
- 历史 WebView Part 不携带 `inputText`、`providerMetadata` 或错误 `details`。
- 同一轮第二次模型请求已经使用 WebView 投影，而不是持久化原文。
- 结构不完整、快照 ID 为空或超长的读取不能成为当前观察。

### 当前观察状态机

- 单次成功读取保持完整。
- `read₁ → operate` 后 `read₁` 被裁剪。
- `read₁ → operate → read₂` 只有 `read₂` 完整。
- `read → 非 WebView 工具` 保持当前读取完整。
- `read → 新用户消息` 后旧读取被裁剪。
- `read → operate` 被拒绝、取消或失败后旧读取仍被裁剪。
- 新读取失败时错误保留，但更早读取不会恢复。
- 未完成 WebView 工具 Part 不破坏工具结果配对。

### 历史数据清理

- 历史读取不包含 `snapshotId`、`content`、`elements`、`viewport` 或 `selectedElement`。
- 历史操作输入保留 `step` 和 `action`，但移除 `snapshotId`。
- 步骤记忆中的 `[N]`、快照令牌和简化 DOM 行被移除。
- 超长旧步骤记忆在模型投影中被截断。
- 异常成功结果不会透传未知字段。
- 投影前后的持久化消息深度相等，证明没有原地修改。

### 正常请求与压缩

- 使用唯一 `DOM_SENTINEL` 放入历史快照，断言正常模型请求 JSON 不包含该值。
- 当前有效读取仍包含 `DOM_SENTINEL`，证明没有误删当前观察。
- 使用唯一 `SNAPSHOT_SENTINEL`，断言历史操作输入不包含旧令牌。
- 自动和手动 compaction 摘要源均不包含 `DOM_SENTINEL`。
- Compaction `fingerprintSources` 仍包含原始 Part，且 fingerprint 与裁剪前规则一致。
- Token 估算基于裁剪后消息。
- 最新有效读取仍能驱动下一次 `operate_webpage`。

### 回归

- 非 WebView 工具结果继续使用原有通用剪枝规则。
- `skill`、用户选择和 Widget 工具投影行为不变。
- WebView 工具 UI 摘要继续从持久化完整结果生成。
- 旧会话、分支、回滚和重新生成不需要数据迁移。

## 验收标准

- 任意模型请求中，最多存在一个属于最新用户轮次、尚未被 WebView 操作消费的完整网页快照。
- 任意 compaction 摘要请求中不存在完整网页快照。
- 历史网页 Part 仍保持合法的 assistant tool-call / tool-result 配对。
- 历史步骤保留经过约束的 `evaluation`、`memory`、`nextGoal`、action 与 result。
- 当前网页操作的确认、执行、错误和 UI 展示行为不变。
- 原始消息、checkpoint fingerprint 和数据库内容不被投影过程修改。
