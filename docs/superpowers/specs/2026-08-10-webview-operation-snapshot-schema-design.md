# WebView 操作快照参数契约设计

## 背景

`operate_current_webpage` 的运行时归一化要求所有非 `navigate` 动作携带 `snapshotId`，但模型可见 JSON Schema 只要求 `step` 和 `action`。模型因此可能生成符合声明 Schema、却在 Renderer 执行前被拒绝的 `scroll` 调用。

## 目标

- 让模型可见 Schema 与运行时的非导航快照约束保持一致。
- 保留 `navigate` 无需先读取页面快照的能力。
- 当模型仍遗漏非导航快照时返回可纠正的明确错误。
- 不修改 WebView 页面动作脚本、元素指纹算法或权限模型。

## 方案比较

### 方案一：必填字符串 `snapshotId`（采用）

在顶层 `required` 中加入 `snapshotId`，并把其 Schema 声明为普通 `string`。非导航动作必须传入 `read_current_webpage` 返回的非空字符串；`navigate` 传空字符串。该方案使用 OpenAI、Anthropic、Google、DeepSeek 与 OpenAI-compatible 工具协议的共同 Schema 子集，不需要依赖联合 `type` 或供应商特有的 nullable 表达。

### 方案二：顶层条件 JSON Schema

使用 `oneOf` 或 `if/then` 区分 `navigate` 与其他动作。表达最精确，但需要扩展 `AIToolParameterSchema`，并增加不同模型供应商对顶层条件 Schema 的兼容风险。

### 方案三：拆分导航工具

把 `navigate` 从 `operate_current_webpage` 移到独立工具。契约最清晰，但会扩大工具 API、权限和提示词变更范围，不适合作为本次缺陷的最小修复。

## 详细设计

模型可见的 `snapshotId` 属性使用 `type: 'string'`，顶层必填字段为 `snapshotId`、`step`、`action`。属性说明明确要求非导航动作传快照字符串，导航动作传空字符串。

运行时继续接受既有的直接 `navigate` 输入，不要求调用方补造快照；模型按 Schema 传入的空字符串也归一化为无快照导航。非导航动作仍拒绝缺失、空白或超长快照 ID。

`step` 的三个字段在运行时同步校验类型和长度，避免依赖 AI SDK 未配置的 JSON Schema 本地验证。校验成功后 `step` 仍只作为历史输入存在，不进入底层 WebView 执行数据结构。

非导航快照在操作脚本执行前原子消费。无论操作成功、失败或与另一操作并发，旧快照都不能再次触发页面副作用；模型必须重新调用 `read_current_webpage`。页面读取与写操作互斥，调用方中断后仍等待底层页面脚本实际完成，避免迟到脚本与新快照重叠。

每次快照失效都会推进内部世代号，读取完成时必须仍属于同一世代，防止导航后迟到的读取结果重新写回。主框架非原地导航通过 `did-start-navigation` 立即使快照失效并进入 loading，同文档原地导航和子框架导航不清除快照。程序化 `navigate` 同样在返回结果前进入 loading，封闭加载事件到达前读取旧文档的窗口。

`useChatContext` 在归一化失败时检查是否属于“合法非导航动作但缺少有效快照”，若是则返回“非 navigate 网页操作缺少 snapshotId，请先调用 read_current_webpage 获取最新快照”；其他非法输入继续返回通用错误。

## 测试

- 注册测试断言 `snapshotId` 是模型可见 Schema 的必填字符串字段。
- 执行测试复现无 `snapshotId` 的 `scroll`，断言返回精确 `INVALID_INPUT` 错误且不弹确认框。
- 输入归一化测试覆盖完整 `step`、畸形 `step` 和 `navigate` 携带空字符串。
- WebView 控制器测试覆盖快照单次消费、读写互斥、调用中断、迟到读取、并发竞争、主框架导航失效与 loading 窗口。
- 运行 WebView Chat Context、输入归一化和 WebView 执行器定向测试，并执行 TypeScript、ESLint 检查。
