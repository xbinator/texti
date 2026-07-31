# 聊天后台 Runtime、侧栏操作与删除恢复设计

## 背景

当前聊天相关改动围绕同一条主线展开：聊天 Runtime 不再跟随可见页面生命周期结束，而是以持久化 Session 为身份在后台继续运行，并允许 ChatSider 在运行、等待和加载期间继续操作。

主进程 ChatRuntime、应用级 Chat Actor system 和持久化消息已经具备后台运行与重新订阅能力，组件卸载时的 `workflow.dispose()` 也明确不会中止主进程 Runtime。因此可以把“关闭可见标签”与“终止聊天任务”解耦，并允许侧栏在其他会话运行时继续新建、切换、编辑标题、打开历史和打开独立聊天页。

但文本流能够后台运行不代表 Renderer 工具能够直接脱离页面安全运行。Runtime capability 虽然按 runtimeId 注册，工具 executor 内部仍可能通过闭包读取 BChat 当前的 `activeSessionId`、`messages`、`workspaceRoot` 和组件私有 confirmation controller。解除会话切换禁用之前，必须把这些依赖改为 Runtime 启动时绑定的会话级不可变上下文，否则旧会话的后续工具可能读取或修改新会话状态。

后续实现又把删除语义从“运行中隐藏删除入口”调整为“任何状态都可以发起删除，但必须确认，并由 Main 先终止所有活动执行再删除”。这要求删除入口不再依赖 Renderer 投影作为安全事实源，而必须通过主进程活动 Runtime、Child Checkpoint 和写锁断言收敛。

最后，针对全部未提交改动进行了风险驱动复审，并补强了三个异常路径：删除成功后 fallback 导航失败时的本地收尾、Agent confirmation 终态游标的有界内存、Runtime 恢复重放的有限退避。

## 目标

- 关闭正在运行或等待操作的顶部聊天标签时，不确认、不 abort，Runtime 转到后台继续执行。
- 聊天侧栏的新建、历史入口、会话切换、标题编辑和打开独立页面不再受 Runtime 加载态或会话集合加载态禁用。
- 从侧栏重新选择后台会话时加载最新持久化消息，并继续接收同一 Runtime 的后续事件。
- Runtime 的 Renderer 工具和确认请求始终绑定原始 sessionId、runtimeId、工作区和资源身份，不因 ChatSider 切换会话而漂移。
- 无论会话正在运行、等待交互还是已经停止，删除按钮始终可见且不使用 `disabled`。
- 所有删除操作都必须经过同一个确认弹窗，并按 `running`、`waiting`、其他状态显示三类文案。
- 用户确认删除运行中的会话时，先收敛该会话的所有 Main Runtime 和 Child Checkpoint，再删除持久化数据。
- 会话历史为 `running` 和 `waiting` 提供常驻状态图标；其他状态不显示图标。
- 删除、恢复、确认和工具执行在异常路径下保持单调、有界和可重试，不产生跨会话污染或孤儿消息。
- 完成未提交改动的证据型审查：所有 P0、P1、P2 发现都必须有根因、失败测试、最小修复和验证记录。

## 非目标

- 不重构 ChatRuntime、Session Actor 或主进程消息持久化协议。
- 不把全部 Renderer 工具迁移到主进程；本次只收紧现有 Renderer capability 的绑定与生命周期。
- 不重放页面关闭期间的逐 token UI 事件；重新打开时以持久化的最新消息快照为起点。
- 不改变应用窗口关闭或主进程退出语义。
- 不新增数据库级联关系或修改聊天数据表结构。
- 不把 Agent confirmation 权威状态迁移到新的 Main 持久化结构。
- 不增加全局定时清理器、周期性 Runtime 轮询或常驻后台任务。
- 不修复本次范围外的全仓既有测试或 ESLint 问题。
- 不执行 `git add`、`git commit`、push 或创建 PR；由用户自行提交。

## 方案选择

### 采用：后台 Runtime 记录 + 侧栏解锁 + Main 权威删除

移除 ChatSider 到 `useChatSession`、`useChatRoute` 和 `SessionHistory` 的禁用参数链路，同时在关闭顶部标签时保留活动 Runtime 的会话归属记录。重新打开页面时复用应用级 Actor 和主进程 Runtime。

删除入口始终可见，但删除安全性不交给按钮可见性或 Renderer Runtime Store。Renderer 只负责确认文案、重复点击去重和调用删除事务；真正是否能删由 Main 活动执行列表、abort/cancel 收敛和最终写锁断言决定。

解除禁用、Runtime capability 隔离和终止后删除必须作为一个整体交付，不允许出现可以切换会话但旧 Runtime 仍读取当前 BChat 响应式状态，或可以删除运行会话但 Main Runtime 后续继续写入孤儿消息的中间版本。

### 不采用：只删除模板 `disabled` 属性

内部 hook 仍会静默拒绝操作，按钮虽然可点击但没有结果，交互与实际状态不一致。

### 不采用：运行中隐藏删除入口

这会把 Renderer 投影当成安全事实源。侧栏 BChat、顶部标签、恢复记录和 Main Runtime 之间只要任一投影漏同步，就会出现“真实运行但 UI 当成可删”或“已经空闲但 UI 不给删”的错配。

### 不采用：新增独立的 Session Runtime Store

把运行状态从标签维度整体迁移到会话维度会带来更清晰的长期模型，但涉及状态恢复、标签投影和多入口所有权的广泛重构，超出本次需求。

## 详细设计

### 1. 顶部标签关闭

`useTabCloseGuard` 不再检查活动 Chat Runtime，不再显示“终止并关闭聊天”确认，也不再调用 `abortTabs()`。未保存内容确认、标签身份晋升保护和重复关闭保护保持不变。

关闭计划应用后，聊天运行态 Store 根据状态处理记录：

- `running` 或 `waiting`：移除标签的可见状态和页面控制器，但保留以持久化会话 ID 为归属的后台 Runtime 记录。
- `idle`、`completed` 或 `error`：直接删除标签运行态记录。
- 草稿标签已经创建持久化会话时，关闭后把后台记录归一化为 `chat:<sessionId>`，避免后续错误地回到空白草稿路由。

后台 Runtime 完成或失败时，如果对应顶部标签仍不存在，则清理这条后台记录；如果标签已经重新打开，则继续使用现有完成、错误和未读状态投影。

### 2. 关闭专用终止控制器

顶部标签不再负责终止 Runtime 后，删除只服务于关闭流程的控制器链路：

- Chat 页面不再注册或注销 `ChatTabRuntimeController`。
- BChat 不再向页面宿主暴露 `abortRuntime()`，但保留工具栏直接调用的 `handleAbort`。
- Chat 运行态 Store 不再维护 controller Map 或 `abortTabs()`。
- Runtime recovery 不再为未挂载页面构造关闭专用 abort controller。

这不会影响用户在已打开 BChat 中点击停止按钮。

### 3. ChatSider 操作解锁

ChatSider 删除统一的 `isSessionActionDisabled` 和 `chatLoading` 状态：

- 新建会话按钮不再绑定 `disabled`。
- SessionHistory 不再接收父级 `disabled`。
- 打开独立聊天页按钮不再绑定 `disabled`。
- BChat 不再通过 `loading-change` 控制侧栏操作。
- 标题编辑仅在没有当前会话或标题正在保存时拒绝，不再检查 Runtime 或会话集合加载状态。

`useChatSession` 删除 `isChatLoading` 依赖及其静默拒绝逻辑，允许运行期间切换会话、进入草稿和同步删除后的选择状态。

`useChatRoute` 删除 `isSessionActionDisabled` 依赖，允许运行中的侧栏会话随时打开为独立聊天页。

### 4. 历史记录、状态图标与删除确认

SessionHistory 删除通用 `disabled` prop、下拉禁用状态及切换/删除入口中的通用 disabled guard。

删除按钮始终展示。点击后根据 Renderer Runtime Store 中的当前状态显示三种危险确认文案：

- `running`：确定终止并删除聊天“{标题}”吗？当前聊天仍在运行，删除前会先终止所有任务。删除后无法恢复。
- `waiting`：确定终止并删除聊天“{标题}”吗？当前聊天正在等待你的操作，删除时会取消等待中的交互。删除后无法恢复。
- 其他状态：确定删除聊天“{标题}”吗？删除后无法恢复。

标题在插入文案前调用 `trim()`；缺少会话、标题为空或仅含空白时统一显示“未命名聊天”。Runtime Store 只决定展示文案，删除安全性仍由 Main 权威状态和锁断言保证。

会话标题左侧保留独立状态位：

- `running` 使用 `lucide:loader-2`，持续旋转且悬停会话时也不隐藏。
- `waiting` 使用 `lucide:circle-help`，常驻显示但不旋转。
- `idle`、`completed`、`error` 不显示状态图标。
- 状态图标不占用右侧删除操作区域，删除按钮继续按既有悬停规则显示。

交互结果按以下规则处理：

- 取消确认：不执行任何终止或删除动作；运行中的流继续。
- 确认已停止会话：直接执行最终安全检查和删除。
- 确认运行中会话：先中止主 Runtime，再取消活动 Child Checkpoint，重新读取 Main 权威状态，确认无活动执行后删除。
- 快速重复点击：同一会话只允许一个确认或删除事务；该约束通过本地在途集合实现，不向按钮添加 `disabled`。
- 删除失败：不发送 `delete-session` 事件，不清理 Renderer 会话集合、最近记录、Todo、侧边栏选择或顶部标签。
- 删除成功：沿用既有 `delete-session` 同步链，清理会话集合、最近记录、Todo、侧边栏选择、对应顶部聊天标签和 Runtime Store 记录。

### 5. Renderer 删除事务

`SessionHistory.vue` 负责交互确认和同会话去重，`useChatSessionStore.deleteSession(sessionId)` 负责执行权威终止与持久化删除：

1. 调用 `chatRuntimeListActive()`，筛选同一 `sessionId` 的快照。
2. 对每个快照调用 `chatRuntimeAbort({ runtimeId })`。该命令在返回前完成中断消息持久化并释放 Session 写锁。
3. 调用 `chatAgentListActive()`，筛选同一 `sessionId` 的 Checkpoint。
4. 对每个 Checkpoint 调用 `chatAgentCancelCheckpoint({ checkpointId })`。该命令返回时 Checkpoint 已通过 Main 协调器收敛。
5. 再次读取 Runtime 和 Checkpoint 列表。若目标会话仍存在活动执行，则删除失败并保留会话；不进行无界轮询。
6. 调用 `chatSessionDelete(sessionId)`。只有 IPC 成功返回后才清理 Renderer 内存状态。

终止流程只依赖 Main 的 `list-active` API，不把 `useChatTabStore` 当作删除安全性的事实源。这样即使 Renderer 丢失了运行态投影，也不会直接删除正在执行的会话。

### 6. Main 最终保护

在共享锁模块新增会话删除断言，按顺序检查：

1. continuation fence：沿用 `TURN_WAITING_CHILDREN`。
2. 普通 Runtime 写锁：返回稳定错误码 `SESSION_BUSY`。

`chat:session:delete` 在同步数据库事务前调用该断言。IPC handler 与同步数据库删除运行在同一个 Main 事件循环片段中，因此检查和删除之间不会插入新的 Runtime 写锁获取。

### 7. ChatSider 状态投影

ChatSider 监听 `BChat` 的 `runtime-status-change`：

- 使用稳定拥有者 ID `chat:${sessionId}` 为持久化侧边栏会话创建或更新 Runtime Store 记录。
- 新会话创建后绑定真实 `sessionId`。
- `running`、`waiting`、`idle`、`error` 使用 `setStatus`；`completed` 使用 `markCompleted`。
- 如果同一会话已经由顶部聊天标签持有，则更新已有 owner，避免创建第二个会话 owner。

该投影用于界面状态一致性；删除安全仍以 Main 权威列表和最终锁断言为准。

### 8. 重新连接和页面接管

从 SessionHistory 选择后台会话时，不把“存在后台 Runtime 记录”误判为“已有可见顶部标签”。只有实际存在于 tabs Store 的标签才直接导航；否则先把会话切换到 ChatSider。

BChat 接管流程保持现有机制：

1. 从会话存储读取当前已持久化的消息快照。
2. 通过应用级 Actor system 的 `ensureSession(sessionId)` 复用现有 Session Actor 状态。
3. 订阅该会话之后的消息、完成、错误和确认事件。
4. 使用新 BChat 的 renderer 能力更新 Runtime capability handler。
5. 用户点击“打开聊天页面”后，新页面接管相同会话，侧栏回到草稿态。

页面关闭期间的逐 token 事件不会逐条补播；重新打开时先显示数据库中的最新累计内容，再继续接收后续增量。

### 9. Runtime capability 会话隔离

现有 capability registry 对数组和描述符执行浅冻结，但 executor 内部闭包仍可能读取 BChat 的可变 Ref。实现需要把“选择工具”和“绑定工具执行上下文”拆成两个阶段：

1. 请求准备阶段只确定向模型暴露的工具定义、工具名称和主进程请求配置。
2. 会话创建完成并生成 runtimeId 后，使用不可变 Runtime 地址创建这一轮专属的 Renderer executor。
3. capability registry 只接受已经完成会话绑定的 executor，不直接注册 BChat 初始化时创建的通用 executor。

每个 Runtime execution binding 至少冻结以下字段：

- `sessionId`：Todo、用户选择和消息相关工具只能读写该会话。
- `runtimeId`：工具结果、确认和清理操作必须回到原 Runtime。
- `workspaceRoot`：Shell 和文件工具使用请求启动时已经确认的工作区，不随侧栏当前会话改变。
- `documentId`：文档工具只访问启动时捕获的文档；文档已关闭时明确失败。
- `rendererToolNames`：重新接管时只能恢复原 Runtime 已声明的工具 allowlist。
- 其他 UI 资源身份：WebView、Widget 或后续新增的 Renderer 资源如果存在稳定 ID，也必须按相同原则冻结；没有稳定身份时不得回退到任意当前资源。

绑定后的 executor 禁止直接读取以下 BChat 可变状态：

- 当前 `activeSessionId`。
- 当前可见 `messages` 数组。
- 当前会话计算得到的 `workspaceRoot` Ref。
- 当前 BChat 私有 confirmation resolver。

`todowrite` 等需要 sessionId 的工具直接使用 binding 中的固定值。Question 工具判断待回答问题时，读取 Actor system 或会话级状态，而不是当前 BChat 的消息 Ref。资源不存在、绑定丢失或无法恢复时返回稳定的不可用错误，禁止改用用户此刻打开的其他会话、文档或 WebView。

新 BChat 接管 Runtime capability 时必须同时满足：runtimeId 路由仍存在、binding.sessionId 与新页面 sessionId 完全一致、工具名称属于原 descriptor allowlist。任一条件不满足都不得覆盖原 capability。

### 10. 应用级 Runtime confirmation broker

Renderer 工具使用的临时确认 resolver 不能继续由单个 BChat 私有持有。新增应用级 Runtime confirmation broker，把 resolver 与以下不可变身份一起保存：

- confirmationId。
- sessionId。
- runtimeId。
- toolCallId（请求存在时）。
- 风险级别和展示请求快照。

确认队列的可序列化投影继续放在 Pinia，Promise resolver 放在应用级非序列化 registry。任意重新接管同一会话的 BChat 都通过 confirmationId 调用 broker 决议，不再要求当前组件拥有原 controller ownerId。

BChat 卸载或切换会话时不自动拒绝仍属于活动 Runtime 的确认。确认保持 `waiting`，直到发生以下事件之一：

- 用户在重新打开的会话 UI 中批准或拒绝。
- Runtime 被用户手动中止。
- Runtime 进入完成或错误终态。
- Renderer reload 导致本地工具不可恢复，恢复流程以明确的 `EDITOR_UNAVAILABLE` 失败结果收敛请求。

确认项只在匹配 sessionId 和 runtimeId 的 BChat 中展示。其他会话可以继续使用 ChatSider，但不能替旧 Runtime 作出确认。

### 11. Runtime recovery

Renderer reload 后，主进程返回的活动 Runtime 即使没有对应顶部标签，也要建立持久化会话 ID 对应的后台运行态记录。该记录用于：

- 保护运行中的会话在 UI 上呈现正确状态。
- 让侧栏重新选择后能识别当前 `running` 或 `waiting` 状态。
- 在重新打开顶部页面时恢复标签状态投影。

恢复过程不为后台记录创建关闭专用 controller。恢复 snapshot 中的 capability descriptor 只能重建降级 capability；Renderer 工具必须等匹配会话的 BChat 重新接管后再按原 allowlist 绑定。恢复期间收到无法安全执行的 Renderer 工具请求时应失败关闭，不能借用当前其他页面的工具上下文。

恢复重放保留两次 Main 权威快照：

1. 第一份快照立即尝试重放；失败请求不标记成功，并停止当前 Runtime 的后续请求。
2. 第二份快照重新确认请求仍 pending，再次按原始顺序重放。
3. 第二次尝试仍失败时，对同一请求依次等待 50ms、100ms 后重试。
4. 两次退避后仍失败则抛出最后一次错误，由现有调用方记录恢复失败；Main pending 请求保持不变，未来重新挂载仍可恢复。

每个请求只有成功后才写入 `replayedRequestKeys`。当前请求未成功前，后续 tool、confirmation 或 bridge 请求均不得越过它，保证 Runtime 内请求顺序不变。重试只属于当前 `recoverRuntimes()` 调用，不创建脱离组件生命周期的 timer 或永久任务。

### 12. 删除后的标签与 Runtime 收尾

`useChatRoute.handleDeletedSession()` 继续先删除 recent、同步 ChatSider 状态并计算标签关闭计划。需要导航时仍先尝试进入下一有效标签或欢迎页，但导航结果不再决定是否清理已经删除的会话事实。

无论 Router 返回阻塞型失败还是抛出异常，都执行以下幂等收尾：

1. 应用预先计算的标签关闭计划。
2. 删除目标标签对应的 Chat Runtime 投影。
3. 若 Session 另有 detached Runtime owner，同时删除该 owner 投影。

Router 守卫阻止跳转时，URL 和已挂载页面会暂时保留已删除 Session 路径，但标签与 Runtime 不再宣称该 Session 存在；Main 的 Session 存在性校验也会拒绝该页面迟到的 Runtime 启动。这里不使用强制页面刷新，避免丢失其他页面状态；用户后续的任意有效路由动作会离开这个无标签归属页面。

### 13. Agent confirmation 游标淘汰

`agentCursors` 继续保存全部活动 pending confirmation 游标。终态游标作为防止迟到 pending 快照复活的 tombstone，最多保留 512 个。

淘汰规则如下：

- 新增或更新终态游标时，将其视为最近使用的 tombstone。
- 终态 tombstone 超过 512 个时，从最早进入终态保护集合的游标开始淘汰。
- 活动 pending 游标不参与容量淘汰。
- 权威 recovery 响应缺失且本地 baseline 未变化时，在移除 pending 项的同时把对应游标终态化，再执行相同的容量淘汰。
- 当前队列项和显式选中项的语义保持不变。

这是一项有界安全窗口：最近 512 个终态 confirmation 仍能拒绝任意更高版本的迟到 pending；更早的 tombstone 允许被回收，避免 Renderer 长期运行时无界增长。

## 错误与边界处理

- 标签关闭不依赖 abort 结果，因此不会因为网络或 Provider 取消失败而阻止关闭。
- 页面关闭后发生 Runtime error 时，主进程仍持久化错误消息；重新打开会话可读取结果。
- 页面接管期间完成的 Runtime 以主进程持久化消息为事实源，最终页面不得用较旧的历史加载结果覆盖更新事件。
- 会话 A 在后台运行时，即使 ChatSider 已切换到会话 B，A 的工具、Todo、问题和确认也只能访问 A 的冻结上下文。
- 绑定的文档、WebView 或其他 Renderer 资源已经不存在时，工具明确失败；不得回退到用户当前打开的资源。
- 等待确认或用户选择的会话按 `waiting` 处理，继续保留后台记录和状态图标。
- 删除取消不执行终止；运行中的流继续。
- list-active、abort、cancel 或最终 delete 任一步返回错误，立即结束事务并抛出可展示错误。
- 终止发生部分成功时仍不删除会话；用户可再次点击删除，流程会按最新 Main 状态重试。
- 第二次权威检查仍发现活动执行时，抛出“会话仍在运行，请稍后重试”类错误。
- Main 最终保护是 fail-closed：任何直接 IPC 删除都必须满足无写锁、无 continuation fence。
- 删除成功后的路由错误通过 `asyncTo()` 归一化，但本地标签和 Runtime 投影收尾继续执行。
- Runtime replay 继续使用 `asyncTo()` 捕获 IPC 失败；达到上限后抛出最后一次原始错误，不包装或隐藏错误码。

## 审查方案

未提交改动审查采用“风险驱动 + 文件穷举 + 测试反证”的混合方式。

### 第 0 轮：建立验证基线

在修改生产代码前运行：

- 当前改动覆盖的测试集合，随后运行完整 Vitest 测试。
- ESLint 与 Stylelint 只读检查。
- Renderer TypeScript `pnpm exec tsc --noEmit`。
- Electron Main `pnpm electron:build-main`。
- `git diff --check`。

基线失败时先读取完整错误并确认是否由当前改动引入；不得用修改测试期望掩盖真实回归。

### 第 1 轮：系统不变量审查

按数据流而不是文件顺序检查以下不变量：

1. **会话身份**：草稿标签、持久化 Session、侧边栏 owner 和顶部标签 owner 的迁移不会产生重复 owner、错误绑定或跨会话更新。
2. **Runtime 生命周期**：运行、等待、后台分离、重新连接、用户中止和自然完成具有单一、可追踪的状态转移；关闭视图不会误终止后台 Runtime，也不会遗留 Renderer 订阅。
3. **历史单调性**：慢速历史响应不能覆盖更新的消息；活动 Runtime 草稿不能被恢复逻辑误判为硬中断；恢复、重放与流式增量不会制造重复 part。
4. **确认与工具隔离**：确认请求按 Runtime 与 Session 精确路由；页面卸载、标签关闭和恢复不会错误拒绝仍有效请求，也不会把一个 Runtime 的答复发送给另一个 Runtime。
5. **安全删除**：删除严格执行 Main 权威查询、Runtime abort、Checkpoint cancel、再次复查、锁断言和持久化删除；任一步失败均保留会话及 Renderer 状态。
6. **跨进程契约**：Renderer 类型、preload 暴露、IPC handler、稳定错误码和 Main 实现完全一致；不存在可绕过锁或遗漏错误展开的入口。
7. **界面状态**：运行、等待、完成、错误和空闲的标签、侧边栏、历史图标、删除文案与可操作性一致，且界面投影不被当作安全事实源。

### 第 2 轮：逐文件穷举审查

逐一阅读所有未提交生产、测试、类型和文档差异，并追踪每个新增或修改符号的调用方。重点检查：

- 未等待的 Promise、错误吞噬、部分成功后的不一致状态。
- 过期闭包、异步响应次序、重复监听和卸载遗漏。
- Abort、unsubscribe、finally、Set/Map 清理和锁释放路径。
- 可选值、空集合、重复 ID、缺失 Session、空白标题和 Electron API 不可用分支。
- 测试是否只验证 mock 调用而没有验证真实状态结果，或删除了原有的重要回归约束。
- 文档、类型声明和实现是否互相矛盾。

### 第 3 轮：场景矩阵反证

使用自动化测试覆盖关键交错：

- A→B→A 快速切换、关闭后重开、运行中关闭与后台完成。
- running、waiting、completed、error、idle 下的删除确认与终止失败。
- Runtime 与 Checkpoint 同时存在、只存在其一、复查仍忙、IPC 失败。
- 确认请求在视图卸载、重新挂载、多个会话并行时的路由。
- 历史读取慢于流事件、恢复快照为空或过期、活动草稿存在。
- 首次会话创建期间 Session ID 晋升与状态事件乱序。

已有测试能准确证明场景时复用；存在覆盖缺口时才新增测试。

## 问题处理协议

每个发现独立执行以下流程：

1. 记录症状、影响等级、触发条件和跨组件数据流。
2. 追踪到最早产生错误状态的根因，并与同仓库可工作的相似路径比较。
3. 写最小回归测试并确认它因目标缺陷失败，而非测试设置错误。
4. 只修改根因所需代码，不捆绑无关重构。
5. 运行目标测试确认通过，再运行直接相关测试集合。
6. 重新阅读修复后的调用链，检查新失败分支、资源释放和并发交错。
7. 回到未提交差异起点进行下一轮审查。

同一问题连续三次修复尝试仍不能收敛时停止修改，重新评估架构并向用户说明阻塞，不叠加第四个猜测性补丁。

## 风险等级

- **P0**：可导致任意代码执行、权限绕过、跨会话数据泄露或不可恢复的大范围数据损坏。
- **P1**：稳定触发的数据丢失、错误删除、锁绕过、跨会话污染、运行任务无法终止或永久卡死。
- **P2**：状态错乱、重复消息、错误中断提示、资源泄漏、失败后无法重试或重要功能回归。
- **P3**：不影响正确性的可维护性和风格问题；只记录，不在本轮扩张修改，除非用户明确要求补强。

## 测试策略

### 标签关闭

- 活动聊天标签关闭不显示 Runtime 终止确认，也不调用 abort。
- 未保存内容确认、导航失败回滚和身份晋升保护保持有效。
- 关闭活动草稿标签后，后台记录归一化到持久化会话标签 ID。
- 后台 Runtime 完成或失败后清理无可见标签的记录。

### ChatSider

- Runtime 运行和会话集合加载期间，新建、历史入口和打开页面均不带 `disabled`。
- 新建、切换、打开页面和标题编辑不再被 loading guard 拒绝。
- 打开运行中的侧栏会话能够导航到独立聊天页。
- 侧边栏 BChat 的运行、等待、完成和新建会话状态正确投影到 Runtime Store。

### SessionHistory

- 不再支持通用 disabled prop。
- 运行期间可以切换到其他会话。
- 空闲、运行、等待和晋升状态都显示删除按钮。
- 运行、等待和其他状态分别显示对应确认文案。
- 标题空白时使用“未命名聊天”回退。
- 运行与等待显示各自常驻图标，其他状态不显示。
- 取消不删除；确认后删除；重复点击只产生一次事务；错误不发送成功事件。

### 删除事务

- 空闲会话直接删除。
- 同会话 Runtime 先 abort 后 delete。
- 同会话 Checkpoint 先 cancel 后 delete。
- 非目标会话的 Runtime 或 Checkpoint 不受影响。
- 第二次检查仍忙时不 delete。
- abort、cancel、list-active 或 delete 任一步失败时保留会话。
- Main continuation fence 继续阻止删除；普通 Runtime 写锁也阻止删除；释放锁后允许删除。
- 删除成功后既有侧边栏选择、顶部聊天标签、最近记录和 Todo 清理链保持有效。
- fallback navigation 被阻止时，删除后的标签和 Runtime owner 仍被清理。

### 重新连接与恢复

- 关闭页面后重新在侧栏选择会话，能够读取当前部分消息并继续接收更新。
- 历史加载与 Runtime 更新并发时，较新的消息内容不会被旧快照覆盖。
- Renderer recovery 对无顶部标签的活动 Runtime 建立后台记录，但不创建 controller。
- 第二份权威快照重放失败后按 50ms、100ms 进行两次有界退避。
- 当前请求未重放成功前，后续请求不得越过它。
- 全部重试失败时抛出最后一次原始错误。

### Capability 隔离与确认

- 会话 A 运行时把 ChatSider 切换到会话 B，A 后续执行 `todowrite` 仍只更新 A。
- 会话 A 的 Question 工具不读取 B 的可见消息或待回答问题。
- 会话 A 使用的 Shell 和文件工具继续使用 A 启动时冻结的 workspaceRoot。
- A 绑定的文档或 WebView 消失后返回不可用错误，不访问当前 B 的资源。
- A 页面关闭后产生 Renderer 确认，重新打开 A 可以处理同一个 confirmationId 并恢复工具执行。
- BChat 卸载不会自动拒绝活动 Runtime 的确认；Runtime 终态或中止会清理 broker resolver 和队列投影。
- sessionId 或 descriptor allowlist 不匹配时，新 BChat 无法覆盖已有 capability。
- Agent confirmation 终态 cursor 最多保留最近 512 个，pending cursor 不参与容量淘汰。
- recovery 缺失但 baseline 未变化的 pending 项会终态化，防止迟到 pending 在 tombstone 保留期间复活。

## 完成标准

必须同时满足：

- 所有 P0、P1、P2 证据型发现均有根因说明、回归测试和已验证修复，或明确记录无法在授权范围内解决的阻塞。
- 再次完整审查全部未提交差异后没有新增 P0、P1、P2 发现。
- 聚焦回归和聊天 Runtime 场景矩阵通过。
- Stylelint、Renderer TypeScript、Electron Main 构建和 `git diff --check` 全部以退出码 0 完成。
- 全量 Vitest 和全仓 ESLint 如仍失败，必须与既有基线逐项对比，确认没有由本次改动引入的新失败。
- 最终 `git status --short` 仅显示工作区修改，没有暂存、提交或推送动作。

## 验证

实现后执行相关 Vitest 测试、聊天 Runtime 聚焦矩阵、Stylelint、TypeScript 类型检查、Electron Main 构建、`git diff --check`，并在 `changelog/2026-07-31.md` 或 `changelog/2026-08-01.md` 记录行为变化。按用户要求不创建 Git 提交。
