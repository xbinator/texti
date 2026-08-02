# 聊天手动工作区文件提及设计

## 背景

`BChat` 输入框已经支持通过 `@` 选择文件并插入 `{{@path}}` 文件引用 token。当前候选由 `useChatComposer` 从 `recentStore.recentFiles` 读取，并且只保留 Markdown 文件。独立聊天页也已经支持在草稿会话中手动选择会话工作区，首轮创建会话时会把该目录持久化到会话 metadata，后续 Runtime 通过当前 `workspaceRoot` 解析相对文件引用。

本次目标是在用户手动选择会话工作区后，让 `@` 能选择该工作区内的项目文件，而默认工作区和未手动选择目录的聊天继续保持现有最近文件候选行为。

## 关键问题

最大的边界不是递归列文件本身，而是文件候选来源、插入路径和 Runtime 解析目录必须一致。若候选来自某个手动工作区，但插入的 token 只是普通相对路径，后续清除或切换工作区时，旧 token 可能被解析到另一个目录。因此第一版必须把能力限定在手动会话工作区内，并保持会话级工作区持久化与 token 解析一致。

## 范围与不变量

- 只有 `workspaceOverride !== undefined` 时启用工作区全量文件候选。
- 默认 Tibis 工作区、未手动选择工作区的草稿和普通持久化会话继续使用现有最近 Markdown 文件候选。
- 工作区候选只产生相对当前手动工作区的路径，插入后仍使用现有 `{{@path}}` token 格式。
- Runtime 继续由 `filePartParser` 使用当前会话 `workspaceRoot` 解析相对路径，不引入第二套文件引用格式。
- 切换或清除手动工作区后，新候选必须立刻跟随新状态；旧输入中的相对 token 不自动改写。
- 候选扫描必须有默认忽略目录和数量上限，避免大型仓库或依赖目录拖慢输入体验。
- `BSmartEditor` 保持展示、过滤和选择职责，不读取工作区、不关心候选来源。

## 方案选择

### 采用：BChat 层维护工作区文件候选

新增一个 renderer 侧工作区文件候选 hook，由 `BChat` 或 `useChatComposer` 根据 `workspaceOverride` 决定候选来源。手动工作区启用时扫描当前工作区文件并转成 `FileMentionOption[]`；未启用时继续使用 `recentStore.recentFiles`。

优点是边界清晰，`BSmartEditor` 不需要知道业务工作区，现有 `@` 菜单、打分、键盘选择和 token 插入逻辑可以复用。代价是 renderer 侧需要递归调用现有 `native.readWorkspaceDirectory`，第一版需要用上限保护性能。

### 不采用：放宽最近文件过滤

只把最近文件从 Markdown 扩展到全部扩展改动最小，但无法满足“当前工作区全部文件”。它仍然依赖最近记录，用户刚选择的工作区内未打开文件不会出现。

### 不采用：新增主进程全量索引 IPC

主进程索引能提供更强的取消、缓存、忽略规则和 symlink 控制，但需要新增 IPC、类型和主进程测试，超过第一版交互闭环的必要范围。后续如果要支持超大仓库、增量 watch 或 `.gitignore` 解析，可以把本设计中的扫描 hook 替换为主进程索引服务。

## 详细设计

### 候选来源切换

`src/components/BChat/index.vue` 已经通过 `useSessionWorkspace` 暴露 `workspaceRoot` 和 `workspaceOverride`。把这两个值传给 `useChatComposer`，由 composer 生成最终传给 `BSmartEditor` 的 `fileMentionOptions`：

- `workspaceOverride.value === undefined`：沿用 `recentStore.recentFiles`，并继续只保留 `.md`。
- `workspaceOverride.value !== undefined`：使用工作区扫描结果，不再混入最近文件候选。

这样用户手动选择工作区后，`@` 菜单语义会变成“这个会话工作区中的文件”；清除工作区后立即回到现有最近 Markdown 文件语义。

### 工作区扫描 hook

新增 `useWorkspaceFileMentions`，输入为当前 `workspaceRoot` 和 `enabled`，输出：

- `fileMentions: ComputedRef<FileMentionOption[]>`
- `loading: Readonly<Ref<boolean>>`
- `error: Readonly<Ref<Error | null>>`
- `refresh(): Promise<void>`

扫描使用 `native.readWorkspaceDirectory({ directoryPath: '.', workspaceRoot })` 作为根入口，并递归读取子目录。候选只收集 `type === 'file'` 的条目，转成：

- `id`：工作区相对路径
- `name`：文件名
- `path`：工作区相对路径，统一使用 `/`
- `ext`：文件名最后一个 `.` 后的扩展名，无扩展名时为空字符串

扫描状态使用递增 sequence 防止旧请求覆盖新工作区。工作区为空、未启用或发生切换时立即清空旧候选。

### 忽略规则与上限

第一版使用内置忽略目录：

- `.git`
- `node_modules`
- `dist`
- `build`
- `.next`
- `.nuxt`
- `coverage`

默认最多收集 `2000` 个文件。达到上限后停止继续递归并保留已收集结果。候选菜单不额外展示截断提示；这是输入辅助，不是完整文件浏览器。若用户需要完整查找，Runtime 侧仍有 `glob` 和 `grep` 工具。

### 路径与 token

工作区候选插入仍走 `useFileMention` 的现有逻辑：`buildFileReferenceToken(file.path)`。由于 `path` 是相对路径，`parseUserInput(content, workspaceRoot)` 会在 Runtime 输入 parts 中保留原始相对 `path`，并生成基于当前 `workspaceRoot` 的 file URL。

这保持了历史消息渲染、chip resolver、消息气泡点击和 Runtime 文件 part 读取的现有通路。

### 工作区变更行为

用户在草稿中选择手动工作区后，候选开始扫描该目录。首轮发送时，现有 `ensureActiveSession` 会把 `workspaceOverride` 一并传给会话创建，保证持久化会话继续使用该工作区。

用户在持久化会话中修改或清除工作区时：

- 新的 `@` 候选按最新 `workspaceOverride` 更新。
- 已输入但未发送的旧相对 token 不自动迁移或清除。
- Runtime 发送时始终按当前会话 `workspaceRoot` 解析这些 token。

第一版不引入 token 级工作区身份，也不自动改写历史消息。这个约束需要在代码测试中体现，避免后续误以为 token 自身携带工作区。

## 错误处理

- 未启用手动工作区：composer 回退到最近 Markdown 文件。
- 已启用手动工作区但 `workspaceRoot` 暂不可用：返回空工作区候选，不混入最近文件。
- 目录读取失败：清空工作区候选并记录 error，不阻塞输入框和普通提交。
- 单个子目录读取失败：跳过该子树，继续保留其他已读候选。
- 扫描过程中工作区切换：旧扫描结果通过 sequence 丢弃。
- 达到文件上限：停止扫描并保留当前候选。

所有异步路径继续使用 `asyncTo`，不新增异步 `try/catch`。

## 测试策略

- `useWorkspaceFileMentions` 覆盖手动启用时递归读取文件、忽略噪声目录、生成相对 POSIX 路径、达到上限停止、读取失败不抛出到调用方、工作区切换丢弃旧结果。
- `useChatComposer` 覆盖 `workspaceOverride === undefined` 时保留最近 Markdown 候选，`workspaceOverride !== undefined` 时切换为工作区候选且不混入最近文件。
- `useFileMention` 既有测试继续验证 `@` 上下文、键盘选择和 token 插入，不需要让编辑器读取工作区。
- `filePartParser` 既有工作区相对路径测试应继续通过，必要时补一例手动工作区候选插入的相对路径被解析为当前 `workspaceRoot` 下的 file URL。
- 最终执行相关 Vitest、ESLint、TypeScript 和 `git diff --check`。

## 非目标

- 不实现 `.gitignore` 解析。
- 不实现主进程文件索引 IPC。
- 不为 `{{@path}}` token 增加 workspace id 或根目录字段。
- 不支持清除或切换工作区时自动改写已输入 token。
- 不把 `@` 菜单变成完整文件浏览器，也不展示目录树。
