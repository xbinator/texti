# AI Tools Tasks

日期：2026-04-19

这个目录把 `2026-04-18-implementation-plan.md` 进一步压缩成可直接开工的独立任务。

设计原则：

- 每个 Task 只负责一个清晰目标。
- 每个 Task 都有明确产出、修改范围和验收标准。
- Task 文档尽量自洽，减少来回翻大计划文档的成本。
- Task 可以独立排期、独立认领、独立验收。

## Tasks 列表

### Task 01：工具协议与传输类型

状态：已完成

文件：`01-tool-contracts-and-transport.md`

要做的东西：

- 定义 AI Tools 核心类型、错误码、结果结构。
- 明确 `toolCallId`、tool result、transport schema。
- 打通 Electron 主进程到 renderer 的 tool-call 事件透传。

产出：

- 可复用的工具协议类型。
- renderer 能收到结构化 tool call 事件。

### Task 02：编辑器上下文与只读工具

状态：已完成

文件：`02-editor-context-and-read-tools.md`

要做的东西：

- 建立 active editor context registry。
- 实现 `read_current_document`、`get_current_selection`、`search_current_document`。
- 提供内置只读工具注册表。

产出：

- AI 可以安全读取当前文档、当前选区和文档搜索结果。

### Task 03：编辑器公共读写 API

状态：已完成

文件：`03-editor-public-api.md`

要做的东西：

- 扩展 `BEditorPublicInstance`。
- 给富文本编辑器和源码编辑器补齐统一的选区读取、插入、替换能力。
- 在编辑器页面挂载和注销 active context。

产出：

- 上层 AI 工具不直接依赖具体编辑器实现。

### Task 04：写工具与确认流程

状态：已完成

文件：`04-write-tools-and-confirmation.md`

要做的东西：

- 实现 `insert_at_cursor`、`replace_selection`、`replace_document`。
- 设计并接入确认弹窗适配层。
- 处理 `NO_SELECTION`、`NO_CURSOR`、`STALE_CONTEXT`、`USER_CANCELLED` 等分支。

产出：

- 写工具在确认后才会执行。
- 危险操作具备更强提醒与预览。

### Task 05：聊天侧工具循环与状态机

状态：进行中

文件：`05-chat-tool-loop.md`

要做的东西：

- 在 `useChat` 暴露 tool-call 事件。
- 在 `BChat` / `BChatSidebar` 接入工具执行与 tool result 回注。
- 增加最小状态机、重复 `toolCallId` 防护、abort 处理、provider capability gating。

产出：

- 聊天能完成“模型发起工具调用 -> 工具执行/确认 -> tool result 回注 -> 模型继续回复”的完整链路。

当前进展：

- 已完成 `useChat` 的 `onToolCall` 接入。
- 已完成 renderer 侧 `src/ai/tools/stream.ts` helper。
- 已完成 `BChat` / `BChatSidebar` 的主链路接线和第二轮续流。
- 后续主要补强 provider gating、集成验证和 Electron 手工联调。

### Task 06：集成验证与渐进开放

状态：未开始

文件：`06-integration-verification-and-rollout.md`

要做的东西：

- 补齐 focused tests、集成验证和手工验收清单。
- 确认默认开放的工具集。
- 先只开放低风险工具，再决定是否开放 `replace_document`。

产出：

- 第一版具备可验证、可回归、可渐进发布的落地路径。

## 建议执行顺序

1. Task 01
2. Task 02
3. Task 03
4. Task 04
5. Task 05
6. Task 06

虽然这些 Task 文档彼此独立，但推荐按上面顺序推进，这样协议、上下文、写操作和聊天循环会更稳地闭环。

## 进度文档

更详细的当前落地情况见：

- `docs/ai-tools/2026-04-19-progress.md`
- `docs/ai-tools/2026-04-22-chat-message-parts.md`

## 2026-04-19 更新

- Task 05 现在可以视为已完成的主链路任务

## 2026-04-22 更新

- Task 05 的聊天消息结构已补充 `parts` 设计，工具调用和工具结果会随 assistant message 持久化。
- 已加入 provider capability gating，只有首批验证过的 provider 会进入 AI Tools 流程
- 聊天侧默认开放的内置工具已收敛为：
  - `read_current_document`
  - `get_current_selection`
  - `search_current_document`
  - `insert_at_cursor`
- `replace_selection` 和 `replace_document` 暂不作为聊天侧默认工具开放
- Task 06 已进入验证与收口阶段，已完成 focused tests、build 和 Electron main build
