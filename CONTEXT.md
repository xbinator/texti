## 项目简介

Tibis 是一款基于 Electron + Vue 3 + TypeScript 的桌面端 Markdown 编辑器，将 AI 对话侧边栏与编辑器深度集成，面向"本地优先"的写作与编辑工作流。

**核心能力**：
- 双视图 Markdown 编辑器（富文本 TipTap + 源码 CodeMirror），支持 AI 行内补全
- AI 聊天侧边栏（流式对话、主进程 ChatRuntime、工具调用、文件/图片 part 输入、上下文压缩与用量指示、语音输入）
- 默认关闭的单层只读 Child Agent 委派（Main-owned Actor/Runtime、Capability 收缩、最多三个并行纯读 Runtime、Primary 挂起与单次续接）
- 多 AI 服务商支持（OpenAI / Anthropic / Google / DeepSeek / 阿里 / 智谱 / 月之暗面 / 火山引擎 / 小米 / MiniMax）
- 文件系统操作（读写、工作区监听、未保存草稿管理）
- MCP（Model Context Protocol）工具集成
- 提示词编辑器（斜杠命令 `/`、文件引用 `@`、变量插入）
- 上下文压缩与记忆系统（基于关键词相关性的按需筛选注入）
- Widget 小组件系统（可交互画布、元素系统、JS 执行脚本、运行时沙箱、AI 工具集成）
- WebView Agent 自动化（读取网页快照、DOM 操作、表单填充、截图）
- 统一命令面板（最近记录搜索、跳转语法、模型选择入口）
- 主题系统（12 套预设主题，支持自定义色彩令牌）
- 本地 SQLite 持久化 + 加密存储

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 41.6 |
| 前端框架 | Vue 3.5 + Composition API |
| 构建工具 | Vite 8（Rolldown） |
| 语言 | TypeScript 5.9（strict） |
| 包管理 | pnpm 10.33 |
| 状态管理 | Pinia 3（6 个领域、20 个 store） |
| 路由 | Vue Router 5（Hash + KeepAlive） |
| 富文本编辑器 | TipTap 3（ProseMirror） |
| 源码编辑器 | CodeMirror 6 |
| JSON/代码编辑 | Monaco Editor 0.55 |
| UI 组件库 | Ant Design Vue 4 + B 系列自研组件（32 个） |
| 原子化 CSS | UnoCSS（presetWind3 + presetAttributify） |
| 样式预处理 | Less |
| 拖拽排序 | @atlaskit/pragmatic-drag-and-drop |
| 画布交互 | moveable + selecto + vue3-moveable + vue3-infinite-viewer |
| 流程图 | @vue-flow/core（BJsonViewer 图形视图） |
| AI SDK | Vercel AI SDK v7（`ai` + @ai-sdk/*，Node.js ≥ 22，ESM-only） |
| MCP 协议 | @modelcontextprotocol/sdk |
| 数据库 | better-sqlite3（主进程本地数据库） |
| 安全存储 | electron-store（API Key 加密存储） |
| 图标 | Iconify（@iconify/vue） |
| 文件监听 | Chokidar 5 |
| 图片处理 | sharp |
| Markdown 渲染 | marked + KaTeX（数学公式）+ Mermaid（图表） |
| 离线存储 | localforage |
| Schema 校验 | zod |
| 压缩/解压 | jszip（Widget 包导入导出） |

> **依赖变更**：已移除 `@tavily/ai-sdk`（Tavily 搜索改为直接 HTTP API 调用）和 `js-tiktoken`（token 估算改用 AI SDK 内置能力）。

---

## 目录结构

```
tibis/
├── src/                              # 渲染进程（Vue 前端）
│   ├── main.ts                       # 应用入口（Pinia + Router + UnoCSS）
│   ├── App.vue                       # 根组件（zhCN + 明暗主题 + RouterView）
│   │
│   ├── views/                        # 页面视图
│   │   ├── editor/                   # 编辑器页面（核心：自动保存、文件监听、会话管理）
│   │   │   ├── index.vue
│   │   │   ├── types.ts
│   │   │   ├── hooks/                # useBindings / useFileSelection / useSession（文件控制器适配层）
│   │   │   └── utils/                # filePath / reconcileFileContent
│   │   ├── widget/                   # Widget 小组件编辑器页面（原 drawing，已重构）
│   │   │   ├── index.vue / types.ts
│   │   │   ├── hooks/                # useBindings / useDragger
│   │   │   ├── utils/                # layerOrder
│   │   │   ├── constants/            # methodScriptTypes / pageSetter
│   │   │   └── components/          # 14 个面板/侧栏/设置组件（AdvancedSetter / BatchSetter / CodeEditor / DesignSetter+ControlPanel / PageSetter+ActionHelp+SchemaHelp+SchemaTreeEditor / PanelSettings / PanelSidebar / SidebarAction / SidebarLayer / SidebarState / SidebarTools / _SidebarPanel）
│   │   ├── settings/
│   │   │   ├── index.vue             # 设置页布局
│   │   │   ├── _components/          # 设置页私有组件（替代原 BSettingsPage / BSettingsSection）
│   │   │   ├── basic/                # 基础设置
│   │   │   ├── provider/             # AI 服务商管理（列表 + 详情 + 子组件）
│   │   │   ├── service-model/        # 服务模型配置（Chat / Edit / Summary 等能力分配）
│   │   │   ├── speech/               # 语音设置（运行时管理、语音识别配置）
│   │   │   ├── tools/                # 工具设置
│   │   │   │   ├── mcp/              # MCP 服务器管理（ServerCard + ServerEditor + OAuth）
│   │   │   │   ├── memory/           # 记忆管理（MemoryContent + MemoryInput + useMemory）
│   │   │   │   ├── search/           # Tavily 搜索配置
│   │   │   │   ├── skill/            # 技能管理（注册、安装、预览、创建）
│   │   │   │   └── widget/           # Widget 小组件管理（WidgetCreator + WidgetItemRow）
│   │   │   └── logger/               # 运行日志查看（LogFilterBar + LogTimeline）
│   │   ├── webview/                  # 内嵌浏览器（native + web/DOM 双实现 + shared 共享层）
│   │   ├── welcome/                  # 欢迎页
│   │   └── error/                    # 404 页面
│   │
│   ├── components/                   # B 系列组件（unplugin-vue-components 全局自动注册，32 个）
│   │   ├── BEditor/                  # Markdown 统一编辑器
│   │   │   ├── index.vue             # 入口（双视图路由）
│   │   │   ├── Markdown.vue          # 纯渲染组件
│   │   │   ├── Monaco.vue            # Monaco 嵌入编辑
│   │   │   ├── types.ts / constants/resolver.ts
│   │   │   ├── adapters/             # 15 个适配器（选区、导航、搜索、行映射、布局主题、行内补全等）
│   │   │   ├── components/           # 10 个 UI 组件（AnchorContent、CodeBlock、CurrentBlockMenu、FrontMatterCard、HoverIndicator、ImageBlock、LinkPopover、MathBlock、Sidebar、TableView）
│   │   │   ├── extensions/           # 10 个 CodeMirror/TipTap 扩展（AI 高亮、装饰、搜索、表格控件、行内补全等）
│   │   │   ├── hooks/                # 12 个编辑器 hooks（useAnchors、useContent、useRichEditor、useEditorController、useEditorResolver、useInlineCompletion 等）
│   │   │   ├── panes/                # PaneRichEditor / PaneSourceEditor
│   │   │   ├── shared/               # 7 个共享组件（FindBar、SelectionToolbar、SelectionAIInput、SelectionCommentInput、CommentCard 等）
│   │   │   └── utils/                # 9 个工具（editorMarkdown、exportToPdf、mermaidRenderId、richCodeBlockLowlight、richMarkdownParser、inlineCompletionContext、selectionAIPrompt 等）
│   │   ├── BChat/                    # AI 聊天侧边栏
│   │   │   ├── index.vue / types.ts
│   │   │   ├── components/           # 14 个组件（ConversationView、MessageBubble、SessionHistory、InputToolbar、QuestionCard、ConfirmationSheet、UsagePanel、TodoPanel、FileRefChip、ImagePreview、InteractionContainer 等）
│   │   │   │   ├── InputToolbar/     # ContextUsage / ModelSelector / VoiceInput / VoiceWaveform
│   │   │   │   ├── MessageBubble/    # 8 个子组件（BubblePart、BubblePartStatus、BubblePartText、BubblePartThinking、BubblePartTool、BubblePartToolCode、BubblePartUserInput、BubblePartWidget）
│   │   │   │   └── InteractionContainer/ # ToastItem 交互反馈
│   │   │   ├── hooks/                # 27 个 hooks（useChatRuntime、useAutoName、useRuntimeCompactContext、useVoiceInput、useVoiceSession、useSkillInit、useSlashCommands、useChatHistory、useRollback、useContextUsage、useWidgetInit 等）
│   │   │   └── utils/                # 15 个工具 + compression/ 子目录（tokenEstimator、chipResolver、filePartParser、messageHelper、runtimeBridge、toolResultSummary 等）
│   │   ├── BWidget/                  # Widget 小组件编辑器（原 BDrawing，已重构为可执行小组件系统）
│   │   │   ├── index.vue / Runtime.vue / types.ts
│   │   │   ├── components/           # 6 个子组件（InfiniteViewport、Minimap、MoveableLayer、SelectoLayer、Toolbar、ContextMenu）
│   │   │   ├── constants/            # 6 组常量（board / interaction / minimap / style / text / viewport）
│   │   │   ├── hooks/                # 14 个 hooks（useWidgetBoard、useWidgetInteraction、useWidgetViewport、useWidgetContext、useWidgetRuntime、useElementAction、useElementMethods、useElementTemplate、useElementValue、useElementVariables、useModelSync、useRenderContext、useRuntimeLayout、useViewportSize）
│   │   │   ├── renderers/            # 2 个渲染器（WidgetCanvas、WidgetNode）
│   │   │   ├── elements/             # 14 个元素定义（Button/Image/Rect/Text/group，每个含 index.vue + Setter.vue + schema.ts）
│   │   │   └── utils/                # 17 个工具 + widgetRuntime/ 子目录（boardTransforms、widgetBindings、widgetData、widgetDataSchema、widgetExecuteMethod、widgetGeometry、widgetLoop、widgetMethods、widgetSchema、widgetStyle、widgetTextMetrics、widgetTree、widgetPreviewContext + widgetRuntime/index/layout/logger/patch）
│   │   ├── BSmart/                    # 提示词编辑器（原 BPromptEditor/BText，重构为基于 CodeMirror 6）
│   │   │   └── Editor.vue / Input.vue / Method.vue / Select.vue + extensions + hooks + utils
│   │   ├── BCommandPanel/            # 统一命令面板（整合最近记录搜索、跳转语法、模型选择入口，全局单例）
│   │   ├── BDraggable/               # 公共列表拖拽排序组件（插槽渲染 + 排序事件）
│   │   ├── BDrawer/                  # 抽屉组件（基于 ant-design-vue Drawer）
│   │   ├── BInputNumber/             # 数字输入组件（封装 AInputNumber，小数精度归一化）
│   │   ├── BPagination/              # 通用分页组件
│   │   ├── BSection/                 # 区块组件（Block + Item + context，支持折叠/展开，替代原 BSettingsPage/BSettingsSection）
│   │   ├── BSegmented/               # 分段控制组件（选项切换、自定义标签、内容插槽）
│   │   ├── BMonaco/                  # Monaco Editor 封装
│   │   ├── BPanelSplitter/           # 可拖拽面板分割器（closeThreshold 拖拽关闭）
│   │   ├── BRecent/                  # 最近文件搜索弹窗（原 BSearchRecent，重命名）
│   │   ├── BModel/                   # AI 模型图标组件（原 BModelIcon，合并，含亮/暗色主题 icons）
│   │   ├── BSelect/                  # 通用选择器（原 BModelSelect，现为通用选择器）
│   │   ├── BToolbar/                 # 工具栏菜单
│   │   ├── BBubble/                  # 气泡消息（头像 + 折叠 + Loading）
│   │   ├── BColorPicker/             # 颜色选择器（预设色 + 自定义 + align 布局）
│   │   ├── BDropdown/                # 下拉菜单
│   │   ├── BScrollbar/               # 自定义滚动条
│   │   ├── BTruncateText/            # 文本截断
│   │   ├── BImageViewer/             # 图片查看器（缩放/旋转/拖拽/Carousel 走马灯）
│   │   ├── BJsonViewer/              # JSON 数据查看器（树形 + Vue Flow 图形视图）
│   │   ├── BSuspense/                # 异步组件 Suspense 包装器
│   │   ├── BUpload/                  # 文件上传组件
│   │   ├── BCollapseTransition/      # 折叠过渡动画
│   │   ├── BIcon/                    # 图标组件
│   │   ├── BMessage/                 # 全局消息提示组件
│   │   ├── BButton / BModal          # 通用 UI 组件
│   │   └── BSidebarPanel/            # 侧栏面板私有组件（占位）
│   │
│   ├── layouts/default/              # 默认布局（标题栏 + Tab 栏 + RouterView/KeepAlive + 聊天侧边栏）
│   │   ├── index.vue / types.ts
│   │   ├── components/               # HeaderTabs / HeaderEditorActions / HeaderUpdateNotice / ShortcutsHelp / ChatSider
│   │   ├── hooks/                    # useKeepAlive / useTabDragger / useChatSession / useFileActive / useEditActive / useViewActive / useHelpActive
│   │   └── utils/                    # headerTabsScroll
│   │
│   ├── router/                       # 路由配置
│   │   ├── index.ts                  # createWebHashHistory + import.meta.glob 聚合模块
│   │   ├── cache.ts / type.ts
│   │   └── routes/
│   │       ├── index.ts              # 聚合入口（import.meta.glob('./modules/**.ts')）
│   │       └── modules/              # editor.ts / settings.ts / webview.ts / welcome.ts / widget.ts
│   │
│   ├── stores/                       # Pinia 状态管理（6 领域、20 个 store）
│   │   ├── ai/                       # provider / serviceModel / skill / toolSettings / memory / widget
│   │   ├── chat/                     # session / todo / toolPermission
│   │   ├── editor/                   # fileSelectionIntent / fileWatch / preferences
│   │   ├── ui/                       # setting / headerToolbar / commandPanel
│   │   ├── workspace/                # files / tabs / recent
│   │   └── helpers/                  # events（事件总线）/ persist（持久化中间件）/ types
│   │
│   ├── ai/                           # AI 子系统
│   │   ├── tools/                    # 工具系统
│   │   │   ├── builtin/              # 6 个保留在渲染进程执行的内置工具
│   │   │   │   ├── MemoryTool/       # 记忆管理
│   │   │   │   ├── QuestionTool/     # 向用户提问（多选/单选）
│   │   │   │   ├── ShellTool/        # Shell 命令执行
│   │   │   │   ├── SkillTool/        # 技能注册与调用
│   │   │   │   ├── TodoWriteTool/    # 待办列表管理
│   │   │   │   ├── WidgetTool/       # Widget 小组件（widget 读取契约 / open_widget 打开聊天小组件）
│   │   │   │   └── index.ts          # 内置工具清单、暴露策略、schema-only 工厂聚合
│   │   │   ├── catalog/              # runtimeTools.ts（ChatRuntime 主进程工具的 renderer 侧 schema-only 工厂，含 glob/grep/operate_webpage 等）
│   │   │   ├── context/              # 工具上下文（editor.ts / webview.ts）
│   │   │   ├── shared/               # fileErrors / fileTool / types
│   │   │   ├── confirmation.ts       # 用户确认适配器接口
│   │   │   ├── permission.ts         # 权限执行引擎（readonly/ask/autoSafe）
│   │   │   ├── policy.ts             # 模型工具支持策略
│   │   │   ├── results.ts            # 工具结果工厂函数
│   │   │   └── stream.ts             # 工具流式执行适配
│   │   ├── memory/                   # 记忆系统（types / parser / injector / selector）
│   │   ├── skill/                    # 技能系统（types / parser / scanner / installer.worker / package）
│   │   └── widget/                   # Widget 子系统（types / parser / scanner / importer / index）
│   │
│   ├── theme/                        # 主题系统
│   │   ├── index.ts                  # 主题入口
│   │   ├── core/                     # 核心（apply / derive / factory / registry）
│   │   ├── presets/                  # 12 套预设主题（ayu / catppuccin / default / everforest / gruvbox / kanagawa / matrix / nord / one-dark / shonen / tokyonight）
│   │   └── types/                    # 令牌类型（tokens.ts）
│   │
│   ├── shared/                       # 跨组件共享层
│   │   ├── platform/                 # Electron/Web 平台抽象（native/ 双实现）
│   │   ├── storage/                  # 持久化存储适配
│   │   │   ├── base/                 # 通用 KV（BaseStorage、manipulator、TTL、合并策略）
│   │   │   ├── files/                # 最近文件列表
│   │   │   ├── providers/            # AI 提供商与模型
│   │   │   ├── service-models/       # 服务模型配置
│   │   │   ├── settings/             # 应用设置持久化
│   │   │   ├── tool-settings/        # MCP/搜索工具配置
│   │   │   ├── utils/                # 数据库连接 + 序列化
│   │   │   └── index.ts
│   │   ├── chat/                     # 文件引用事件桥接
│   │   ├── logger/                   # 日志类型与工具
│   │   ├── utils/                    # hash 工具
│   │   ├── workspace/                # 路径工具
│   │   └── widget/                   # Widget 协议（protocol.ts）
│   │
│   ├── hooks/                        # 全局组合式函数与共享类型
│   │   ├── file-controller/          # 草稿、写盘与文件监听子控制器
│   │   ├── useAntdTheme.ts           # Ant Design 明暗主题
│   │   ├── useAutoCollapse.ts        # ResizeObserver 自动折叠
│   │   ├── useChat.ts                # AI 流式聊天（invoke/stream/abort）
│   │   ├── useClipboard.ts           # 剪贴板操作
│   │   ├── useFileController.ts      # 公共文件生命周期控制器
│   │   ├── useFileDrop.ts            # 文件拖拽处理
│   │   ├── useImagePreview.ts        # 图片预览（跨平台：Electron 原生 / Web）
│   │   ├── useMenuAction.ts          # 系统菜单动作注册
│   │   ├── useNavigate/              # 统一导航（链接、文档、引用定位、草稿、Skill）
│   │   ├── useRecentRecord/          # 最近记录统一打开与删除
│   │   ├── useScroller.ts            # DOM 滚动包装
│   │   ├── useShortcuts.ts           # 键盘快捷键（@vueuse/core useMagicKeys）
│   │   ├── useSystem.ts              # 系统信息查询
│   │   ├── useWorkspaceRoot.ts       # 工作区根目录
│   │   └── types.ts                  # Hook 共享文件状态类型
│   │
│   ├── utils/                        # 工具函数（16 个）
│   │   ├── asyncTo.ts / css.ts / emitter.ts / env.ts / image.ts / is.ts / json.ts
│   │   ├── logger.ts / modal.tsx / namespace.ts / scroll.ts / shortcut.ts
│   │   └── file/                     # icons / reference / title / unsaved
│   │
│   ├── plugins/                      # Vue 插件（index / message / error-handler）
│   ├── directives/                   # 指令（focus）
│   ├── constants/                    # extensions / shortcuts
│   └── assets/styles/                # 全局样式（global / normalize / reset / markdown / scrollbar）
│
├── shared/                           # 主进程与渲染进程共享代码
│   └── ai/
│       └── tools/
│           ├── index.ts              # 跨进程纯元数据 registry（含 internal delegate_task）
│           └── types.ts              # Registry 归属/暴露/executionClass/工具 effect 类型
│
├── electron/                         # Electron 主进程 + preload
│   ├── main/
│   │   ├── index.mts                 # 主进程入口（初始化流程：日志→存储→数据库→IPC→菜单→窗口）
│   │   ├── lifecycle.mts             # 生命周期管理
│   │   ├── window.mts                # 窗口管理（无边框、macOS 红绿灯、preload 注入）
│   │   ├── env.mts / types.ts
│   │   └── modules/                  # IPC 模块（17 个）
│   │       ├── index.mts             # 统一注册入口
│   │       ├── ai/                   # AI 流式/非流式调用（10 个 Provider：openai/anthropic/google/deepseek/alibaba/glm/mimo/minimax/moonshot/volcengine + errors/ + helper/）
│   │       ├── chat/                 # 聊天会话持久化 + ChatRuntime 主进程服务
│   │       │   ├── agents/           # 委派契约、不可变事实 Store、结果校验、Checkpoint 协调服务与窄 IPC
│   │       │   ├── runtime/          # ChatRuntime 核心
│   │       │   │   ├── compaction/   # 上下文压缩（executor / service / structured-summary-generator）
│   │       │   │   ├── context/      # 上下文预算/估算/模型消息/溢出降级/工具输出裁剪（budget / estimator / model-message / overflow / tool-output-prune / usage）
│   │       │   │   ├── controllers/  # renderer bridge / 确认请求 / renderer 工具请求（bridge / confirmation / renderer-tool）
│   │       │   │   ├── messages/     # 消息工厂/续接/文件 part 物化/最终化/用户选择（continuation / factory / file-parts / finalizer / user-choice）
│   │       │   │   ├── model/        # 模型解析/自动命名（resolver / auto-name）
│   │       │   │   ├── runners/      # runtime 工厂（factory）
│   │       │   │   ├── stream/       # 流式执行器（chunks / index / message-parts / request / tools / types）
│   │       │   │   ├── tools/        # 主进程工具执行器（ReadTool / FileTool / SettingsTool / ResourceTool / WebviewTool + file-search + subprocess-runner）
│   │       │   │   ├── infrastructure/ # 锁（locks）
│   │       │   │   ├── errors.mts / ipc.mts / service.mts / types.mts
│   │       │   ├── ipc.mts / service.mts
│   │       ├── database/             # SQLite 操作（execute / select / transaction）
│   │       ├── dialog/               # 原生文件对话框
│   │       ├── export/               # PDF 导出（pdf-renderer）
│   │       ├── file/                 # 文件读写 + 工作区监听（Chokidar）
│   │       ├── image/                # 图片压缩/格式转换（sharp）
│   │       ├── logger/               # 日志系统（文件 + 控制台 + 维护定时器）
│   │       ├── mcp/                  # MCP 运行时（session / tools / status / client / transport / discovery + oauth/ 回调服务器）
│   │       ├── request/              # 平台托管 HTTP 请求代理（core/：body / constants / queue / response / url）
│   │       ├── shell/                # 系统 Shell（pipe/PTY runner、Screen Snapshot、自动默认交互、安全策略）
│   │       ├── speech/               # 语音服务（installer / runtime / 录音、whisper.cpp 转写）
│   │       ├── store/                # 安全加密存储（electron-store）
│   │       ├── ui/                   # 窗口控制 + 系统菜单（menu）+ 快捷入口（shortcuts）+ 图片预览（image-preview）+ model
│   │       ├── updater/              # 应用自动更新
│   │       ├── webview/              # 内嵌 WebView（capture 截图 + 安全策略隔离、Partition 隔离）
│   │       └── workspace/            # 工作区文件监听（watch / read / root）
│   └── preload/
│       ├── index.mts                 # contextBridge 安全暴露 electronAPI（约 118 个方法/属性，20+ 功能分组）
│       ├── error-collector.mts       # 全局错误收集 preload
│       ├── webview.mts               # WebView 页面 preload
│       └── webview-tag.mts          # WebView 标签 preload
│
├── types/                            # 全局 TypeScript 类型声明
│   ├── ai.d.ts / chat.d.ts / chat-runtime.d.ts / chat-agent.d.ts / compression.d.ts / electron-api.d.ts
│   ├── global.d.ts / model.d.ts / webview.d.ts / vite-env.d.ts
│   └── components.d.ts              # 自动生成的组件类型
│
├── test/                             # 测试套件（按 src/electron/shared 结构镜像组织）
│   ├── ai/                           # 工具系统测试（builtin / tool-registry / drawing-context）
│   ├── components/                   # BChat、BColorPicker、BEditor、BMessage、BMonaco、BWidget
│   ├── electron/                     # 主进程测试（ai/errors、chat/runtime、lifecycle、mcp/transport、ui、updater）
│   ├── hooks/                        # useFileController / useClipboard / useImagePreview / useNavigate / useRecentRecord / useSystem
│   ├── layouts/                      # ChatSider、HeaderTabs、useHelpActive 等
│   ├── router/                       # widget 路由
│   ├── shared/storage/               # files、providers、settings、tool-settings、database
│   ├── stores/                       # ai/memory-loading / service-model、chat/session+todo、ui/header-toolbar
│   ├── utils/                        # file/reference、image
│   ├── views/                        # editor、widget、settings（provider+service-model+mcp+memory）、webview、welcome
│   └── theme/                        # 主题测试
│
├── docs/                             # 项目文档
│   ├── code-wiki/                    # 代码百科（概述/架构/前端/编辑器/Electron/存储/AI/开发指南/依赖地图，10 篇）
│   ├── ai-tools/                     # AI 工具系统分析 + 任务文档 + 记忆系统设计（2026-07-08-memory-system-design）
│   ├── web-view/                     # WebView 设计文档
│   ├── speech/                       # 语音功能说明
│   ├── development/                  # 开发问题与注意事项 + widget-runtime-lifecycle
│   ├── markdown-symbol-highlight/    # Markdown 符号高亮方案
│   └── superpowers/                  # 技术文档（128 plans + 131 specs + 7 reviews）
│
├── changelog/                        # 变更日志（按日期 .md，覆盖 2026-03-26 至今，101 篇）
├── scripts/                          # 构建与工具脚本
│   ├── clean-dist-electron.mjs       # 清理 dist-electron
│   └── speech/                       # 语音运行时脚本（dev-runtime / manifest-tool）
├── resources/                        # 应用图标 + 语音清单
└── 配置文件                           # vite.config.ts / tsconfig.json / electron-builder.yml / uno.config.ts / .eslintrc.cjs / .stylelintrc.cjs / prettier.config.cjs 等
```

---

## 核心架构

### 进程模型

```
┌─────────────────────────────────────────────────────────────────┐
│                      渲染进程 (Vue 3)                            │
│                                                                  │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────┐   │
│  │  BEditor  │  │    BChat     │  │ BWidget  │  │ Settings │   │
│  │ (Markdown)│  │  (AI 聊天)   │  │ (小组件) │  │(服务商配置)│   │
│  └─────┬─────┘  └──────┬───────┘  └────┬─────┘  └────┬─────┘   │
│        │               │               │              │          │
│        └───────────────┼───────────────┼──────────────┘          │
│                        │               │                         │
│             window.electronAPI                                    │
│          (contextBridge 暴露 ~118 个方法)                         │
└────────────────────────┼────────────────────────────────────────┘
                         │  IPC (invoke / on / send)
┌────────────────────────┼────────────────────────────────────────┐
│                    主进程 (Electron)                              │
│                         │                                        │
│   ┌─────────┐  ┌───────┴──────┐  ┌──────────┐  ┌──────────┐   │
│   │ AI 服务  │  │  ChatRuntime │  │  数据库   │  │   MCP    │   │
│   │(10 Provider)│ │(模型调用/主进程 │  │ (SQLite) │  │(stdio+   │   │
│   │          │  │  工具/压缩)   │  │          │  │ OAuth)   │   │
│   └─────────┘  └──────────────┘  └──────────┘  └──────────┘   │
│   ┌─────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────┐   │
│   │ 文件操作 │  │    语音服务   │  │   日志    │  │  Request │   │
│   │(读写/监听)│ │ (whisper.cpp)│  │          │  │ (HTTP代理)│   │
│   └─────────┘  └──────────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 关键数据流

1. **编辑文件**：渲染进程 → `electronAPI.readFile/writeFile` → IPC → 主进程 file 模块 → 本地文件系统
2. **AI 流式聊天**：渲染进程 `useChatRuntime` → `chat:runtime:start` IPC → 主进程 ChatRuntime → 模型解析 → Vercel AI SDK → 外部 API → 流式回传 → 主进程更新消息 → 渲染进程同步
3. **主进程工具执行**：AI 流中识别 tool-call → ChatRuntime 判断归属 → 主进程工具（file/read/settings/webview/resource）直接在主进程执行；renderer 工具通过 `chat:runtime:tool-requested` bridge 到渲染进程执行
4. **数据持久化**：渲染进程 → `electronAPI.dbExecute/dbSelect` → IPC → 主进程 better-sqlite3
5. **文件监听**：主进程 Chokidar 监听工作区 → 变更事件 → IPC push → 渲染进程 fileWatch store → 编辑器自动重载
6. **MCP 工具**：由 Vercel AI SDK 直接调用（`mcp_*`）
7. **Tavily 搜索**：渲染进程直接 HTTP API 调用（已移除 `@tavily/ai-sdk` 依赖）
8. **Widget 操作**：渲染进程 BWidget → moveable/selecto 本地交互 → v-model 双向绑定 → 文档内容同步；AI 通过 `widget` 工具读取契约、`open_widget` 打开聊天小组件
9. **平台 HTTP 请求**：渲染进程 → `electronAPI.request` → IPC → 主进程 request 模块 → 外部 API（统一代理 + 队列管理）
10. **WebView Agent**：AI 通过 `read_current_webpage` 获取页面快照（含 snapshotId、可交互元素、视口摘要），通过 `operate_webpage` 执行点击/输入/选择/滚动/按键等操作

### 安全边界

- `contextIsolation: true`，`nodeIntegration: false`
- 所有系统能力通过 preload 的 `contextBridge.exposeInMainWorld` 暴露
- preload 暴露约 118 个 API 方法/属性，覆盖 20+ 功能分组（文件系统、窗口控制、数据库、聊天会话、AI 服务、Chat runtime、MCP runtime、语音、日志、菜单、WebView、图片、PDF 等）
- 渲染侧通过 `src/shared/platform/electron-api.ts` 类型安全封装读取

---

## 应用启动流程

### 主进程启动（electron/main/index.mts）

1. 获取启动快捷入口动作（Dock/Taskbar 最近文件）
2. 初始化日志（控制台）
3. 清理过期日志 → 启动日志维护定时器
4. 初始化 electron-store（加密存储）→ 初始化 SQLite 数据库
5. 中断无法跨主进程恢复的活动 Agent Checkpoint（不自动重放模型）→ 注册全部 IPC handler（各模块统一在 `modules/index.mts` 注册）
6. 设置系统菜单 → 刷新平台快捷入口
7. 创建窗口 → 处理启动时的快捷动作（open-file / second-instance）
8. 生命周期管理（lifecycle.mts 管理应用退出/重启流程）

### 窗口创建（electron/main/window.mts）

- 无边框窗口（`frame: false`），macOS 使用 `titleBarStyle: 'hidden'` + 自定义红绿灯位置
- 预加载脚本注入，开发环境加载 Vite dev server（127.0.0.1:1420），生产环境加载打包 HTML

### 渲染进程入口（src/main.ts）

- 创建 Vue 应用 → Pinia → setupPlugins（Ant Design message） → setupErrorHandler → Router → 挂载到 `#app`
- 全局引入 UnoCSS 虚拟模块、Ant Design ConfigProvider zhCN、Less 全局样式

---

## 路由与导航

### 路由表

| 路径 | 页面 | 说明 |
|------|------|------|
| `/welcome` | 欢迎页 | 入口页面（hideTab） |
| `/editor/:id` | 编辑器 | 核心 Markdown 编辑页面 |
| `/widget/:id?` | Widget 小组件 | 可交互画布、元素系统、JS 执行脚本、运行时沙箱（nanoid 自动生成 ID） |
| `/settings/provider` | AI 服务商列表 | 管理 AI Provider |
| `/settings/provider/:provider` | 服务商详情 | 配置模型列表 |
| `/settings/service-model` | 服务模型 | 管理 AI 能力（Chat/Edit/Summary） |
| `/settings/basic` | 基础设置 | 应用基础配置 |
| `/settings/speech` | 语音设置 | 运行时管理和识别配置 |
| `/settings/tools/mcp` | MCP 工具 | MCP 服务器管理 |
| `/settings/tools/memory` | 记忆管理 | AI 记忆配置 |
| `/settings/tools/search` | 搜索工具 | Tavily 搜索配置 |
| `/settings/tools/skill` | 技能设置 | 技能注册与管理 |
| `/settings/tools/widget` | Widget 管理 | Widget 小组件管理（创建、列表） |
| `/settings/logger` | 运行日志 | 系统运行日志查看 |
| `/webview/native` | 网页浏览（Native） | `<webview>` 标签实现 |
| `/webview/web` | 网页浏览（DOM） | DOM iframe 实现 |

路由使用 `createWebHashHistory`（适配 Electron `file://` 加载），通过 `import.meta.glob` 聚合 `routes/modules/*.ts` 子路由。

### Tab 管理

- `router.afterEach` 根据 route meta 自动同步 Tab（hideTab 标记的页面不显示）
- Tab 支持右键菜单（关闭/关闭其他/关闭右侧/关闭已保存/关闭全部）
- 拖拽排序基于 @atlaskit/pragmatic-drag-and-drop
- KeepAlive 页面缓存由 `useKeepAlive` hook 管理

### 统一命令面板

- `BCommandPanel` 组件全局单例挂载，整合最近记录搜索、跳转语法（`>` 跳转模型选择）、全局入口
- `useCommandPanelStore` 管理命令面板状态
- 替代了原 `BModelSelect` 和 `BSearchRecent` 的独立弹窗实现

---

## B 系列组件体系

项目采用 `unplugin-vue-components` 实现 B 系列组件全局自动注册，命名规范为 `B` + 功能名，无需手动 import。当前共 32 个组件（含 1 个占位空目录 BSidebarPanel）。

### 近期重构变化

- **BDrawing → BWidget**：绘图白板重构为可执行小组件系统
- **BPromptEditor → BText → BSmart**：提示词编辑器重构为基于 CodeMirror 6；2026-07-20 由 BText 更名为 BSmart（"Text" 语义过弱，与 BWidget Text 元素混淆，BSmart 体现斜杠命令/变量芯片/@提及等富编辑能力）
- **BSearchRecent → BRecent**：最近文件搜索重命名
- **BModelIcon → BModel**：模型图标组件合并
- **BModelSelect → BSelect**：合并为通用选择器（模型选择能力由 BCommandPanel 接管）
- **BSettingsPage / BSettingsSection → BSection**：设置布局组件统一为 BSection（Block + Item）
- **新增 10 个组件**：BCommandPanel / BDraggable / BDrawer / BInputNumber / BPagination / BSection / BSegmented / BSidebarPanel / BSmart（原 BText）/ BWidget

### 组件清单

| 组件 | 说明 |
|------|------|
| **BEditor** | Markdown 双视图编辑器（TipTap 富文本 + CodeMirror 源码），含 15 个适配器、12 个 hooks、10 个扩展、10 个 UI 组件，支持 AI 行内补全 |
| **BChat** | AI 聊天侧边栏，流式对话、工具调用、会话历史、文件引用、语音输入、上下文压缩与用量指示、Widget 初始化，含 27 个 hooks |
| **BWidget** | Widget 小组件编辑器（原 BDrawing），可交互画布、元素系统（Button/Image/Rect/Text/group）、JS 执行脚本、运行时沙箱、Input/Output Schema 契约、循环数据展开、变量绑定，含 6 个子组件、14 个 hooks、2 个渲染器、17 个 utils、14 个元素定义 |
| **BSmart** | 提示词编辑器（原 BPromptEditor/BText），基于 CodeMirror 6，含 Editor/Input/Method/Select 四种形态 + 斜杠命令、@mention 文件引用、变量插入 |
| **BCommandPanel** | 统一命令面板（整合最近记录搜索、跳转语法、模型选择入口，全局单例） |
| **BDraggable** | 公共列表拖拽排序组件（插槽渲染 + 排序事件） |
| **BDrawer** | 抽屉组件（基于 ant-design-vue Drawer） |
| **BInputNumber** | 数字输入组件（封装 AInputNumber，小数精度归一化） |
| **BPagination** | 通用分页组件 |
| **BSection** | 区块组件（Block + Item + context，支持折叠/展开） |
| **BSegmented** | 分段控制组件（选项切换、自定义标签、内容插槽） |
| **BMonaco** | Monaco Editor 封装（JSON/代码编辑） |
| **BPanelSplitter** | 可拖拽面板分割器（支持 closeThreshold 拖拽关闭） |
| **BRecent** | 最近文件搜索弹窗（原 BSearchRecent） |
| **BModel** | AI 模型图标组件（原 BModelIcon，含亮/暗色主题 icons） |
| **BSelect** | 通用选择器（原 BModelSelect） |
| **BToolbar** | 工具栏菜单（文件/编辑/视图/帮助） |
| **BBubble** | 气泡消息（Avatar + Loading + 折叠） |
| **BColorPicker** | 颜色选择器（预设色 + 自定义 + align 布局） |
| **BTruncateText** | 文本截断 |
| **BScrollbar** | 自定义滚动条 |
| **BImageViewer** | 图片查看器（缩放/旋转/拖拽/Carousel） |
| **BJsonViewer** | JSON 数据查看器（树形 + Vue Flow 图形视图） |
| **BSuspense** | 异步组件 Suspense 包装器 |
| **BUpload** | 文件上传 |
| **BCollapseTransition** | 折叠过渡动画 |
| **BIcon** | 图标组件 |
| **BMessage** | 全局消息提示组件 |
| **BButton / BModal** | 通用 UI 组件 |
| **BDropdown** | 下拉菜单 |
| **BSidebarPanel** | 侧栏面板私有组件（占位） |

---

## 状态管理

Pinia stores 按业务领域分为 6 个目录，20 个 store 文件：

### ai/ — AI 配置

| Store | 职责 |
|-------|------|
| `provider` | AI 服务商配置（API Key、Base URL、模型列表） |
| `serviceModel` | 服务模型绑定（Chat / Edit / Summary 等能力分配模型） |
| `skill` | 技能注册与发现（斜杠命令 /skill 路由） |
| `toolSettings` | 工具设置（MCP 服务器、Tavily 搜索） |
| `memory` | AI 记忆状态管理 |
| `widget` | Widget 小组件状态管理（配合 BWidget 系统） |

### chat/ — 聊天

| Store | 职责 |
|-------|------|
| `session` | 聊天会话管理（消息流、会话历史、上下文压缩） |
| `todo` | 聊天待办事项管理 |
| `toolPermission` | AI 工具权限（readonly / ask / autoSafe 模式） |

### editor/ — 编辑器

| Store | 职责 |
|-------|------|
| `fileSelectionIntent` | 文件选区意图（行范围导航跳转） |
| `fileWatch` | 编辑器文件监听（路径 ↔ 文件 ID 映射） |
| `preferences` | 编辑器偏好（视图模式 / 大纲 / 页宽 / 保存策略） |

### ui/ — UI

| Store | 职责 |
|-------|------|
| `setting` | 应用设置（主题、语言、快捷键、侧边栏可见性等） |
| `headerToolbar` | 标题栏工具栏状态 |
| `commandPanel` | 命令面板状态管理（配合 BCommandPanel 组件） |

### workspace/ — 工作区

| Store | 职责 |
|-------|------|
| `files` | 文件状态管理 |
| `tabs` | 标签页管理（增删改查、排序、缓存） |
| `recent` | 最近打开文件列表 |

### helpers/ — 基础设施

| 模块 | 职责 |
|------|------|
| `events` | 事件总线（mitt，解耦 store 间依赖） |
| `persist` | 持久化中间件（loadPersistedState / persistState，存储路径 `pinia.<storeId>`） |
| `types` | 共享类型（PersistConfig、MigrationStep） |

---

## AI 工具系统

### 工具执行架构

当前工具系统以 ChatRuntime 主进程执行为核心，渲染进程负责需要 UI/编辑器上下文的工具，Vercel AI SDK 直接托管 MCP 工具。

```
src/ai/tools/
├── builtin/              # 6 个保留在渲染进程执行的内置工具
│   ├── MemoryTool/       # 记忆读写
│   ├── QuestionTool/     # 向用户提问
│   ├── ShellTool/        # Shell 命令执行
│   ├── SkillTool/        # 技能注册与调用
│   ├── TodoWriteTool/    # 待办列表管理
│   ├── WidgetTool/       # Widget 小组件（widget 读取契约 / open_widget 打开聊天小组件）
│   └── index.ts          # 内置工具清单、暴露策略、默认暴露与条件暴露列表
├── catalog/
│   └── runtimeTools.ts   # ChatRuntime 主进程工具的 renderer 侧 schema-only 工厂（含 glob/grep/operate_webpage 等）
├── context/              # 工具上下文（editor.ts / webview.ts）
├── shared/               # fileErrors / fileTool / types
├── confirmation.ts       # 用户确认适配器接口
├── permission.ts         # 权限执行引擎（readonly / ask / autoSafe）
├── policy.ts             # 模型工具支持策略
├── results.ts            # 工具结果工厂函数
└── stream.ts             # 工具流式执行适配

electron/main/modules/chat/runtime/tools/
├── ReadTool/             # 只读工具（read_file / read_directory / glob / grep）
├── FileTool/             # 文件操作（write_file / edit_file）
├── SettingsTool/         # 设置读写（get_settings / update_settings / get_mcp_settings / add_mcp_server / update_mcp_server / remove_mcp_server / refresh_mcp_discovery）
├── ResourceTool/         # 资源打开（open_resource）
├── WebviewTool/           # 网页操作（read_current_webpage / operate_webpage）
├── file-search.mts       # 文件搜索实现（glob/grep，23806 字节）
├── subprocess-runner.mts # 子进程运行器
├── settings-file.mts     # 设置文件读写
├── constants.mts         # 工具名称集合（从 shared registry 按 group 动态派生）
├── guards.mts / paths.mts / results.mts / types.mts
└── index.mts             # 主进程工具执行入口（MainToolExecutor）
```

### 工具运行时归属

| 归属 | 说明 | 示例 |
|------|------|------|
| `main` | ChatRuntime 主进程直接执行 | `read_file`、`read_directory`、`glob`、`grep`、`write_file`、`edit_file`、`get_settings`、`update_settings`、`read_current_webpage`、`operate_webpage`、`open_resource`、MCP 工具 |
| `renderer` | 通过 IPC bridge 到渲染进程执行 | `question_user`、`skill_*`、`memory`、`todo_write`、`shell_command`、`widget`、`open_widget` |
| `sdk` | Vercel AI SDK 直接调用 | `mcp_*` |
| `coordinator` | 主进程延迟协调协议；默认不向用户暴露 | `delegate_task`（已接入 Primary suspend、只读 Child 调度与单次 resume） |

### 跨进程工具注册表

`shared/ai/tools/index.ts` 集中定义已迁移工具的元数据：
- `runtime`：main / renderer / sdk / coordinator
- `group`：read / file / settings / resource / webview / agent
- `exposure`：default-readonly / default-writable / conditional-readonly / conditional-writable / internal
- `executionClass`：direct / deferred-coordination
- `effect`：工具副作用分类、资源范围解析器、可逆性及可选 commit adapter
- `definition`：工具名称、描述、风险等级、参数 schema、权限类别、safeAutoApprove 等

工具按来源目录组织：DocumentTool（read_current_document / create_document）、EnvironmentTool（get_current_time）、FileReadTool（read_file / read_directory / glob / grep）、FileWriteTool（write_file）、FileEditTool（edit_file）、LogsTool（query_logs）、SettingsTool（get_settings / update_settings）、MCPSettingsTool（get_mcp_settings / add_mcp_server / update_mcp_server / remove_mcp_server / refresh_mcp_discovery）、OpenResourceTool（open_resource）、WebviewTool（read_current_webpage / operate_webpage）。

渲染进程 `src/ai/tools/builtin/index.ts` 通过 `getToolNamesByExposure` 动态派生默认/条件暴露的工具白名单，与 `catalog/runtimeTools.ts` 中的 schema-only 工厂组合，向 AI SDK 注册可用工具。

### 权限执行引擎

支持三种模式：
- **readonly**：只读操作自动批准
- **ask**：每次操作请求用户确认
- **autoSafe**：安全操作自动批准，危险操作请求确认

权限在 store 中持久化，支持按工具、按会话级别控制。

---

## 聊天系统

### ChatRuntime 主进程架构

聊天核心为 **ChatRuntime 主进程服务**（`electron/main/modules/chat/runtime/`），渲染进程通过 `useChatRuntime` hook 与主进程协同。

```
electron/main/modules/chat/runtime/
├── service.mts           # ChatRuntime 服务骨架：start / continue / compact / abort / submitConfirmation / submitUserChoice / submitToolResult / submitBridgeResponse / submitMessagePart / autoName
├── stream/               # 模型流式执行器
│   ├── index.mts         # 主循环（text-delta / reasoning-delta / tool-call / tool-result / finish / error）
│   ├── tools.mts         # 工具执行分发、未注册工具兜底、continue/stop 状态累积
│   ├── message-parts.mts # assistant 消息 part 追加与最终化
│   ├── request.mts       # runtime 请求构建
│   └── chunks.mts        # 流 chunk 归一化
├── tools/                # 主进程工具执行器（ReadTool / FileTool / SettingsTool / ResourceTool / WebviewTool + file-search + subprocess-runner）
├── context/              # 上下文预算、估算、模型消息转换、溢出降级、工具输出裁剪
├── compaction/           # 上下文压缩服务与执行器（含 structured-summary-generator 结构化摘要生成）
├── messages/             # 消息工厂、续接、文件 part 物化、最终化、用户选择
├── controllers/          # renderer bridge / 确认请求 / renderer 工具请求
├── model/                # 模型解析与自动命名
├── runners/              # send / continue / compact / user-choice runtime 工厂
└── infrastructure/       # runtime 锁
```

### 流式对话生命周期

1. 用户输入（文本 / 文件引用 / 图片 file part）→ 渲染进程 `useChatRuntime.send`
2. `chat:runtime:start` IPC → 主进程 ChatRuntime 创建 runtime
3. 模型解析（`model/resolver.mts`）→ Vercel AI SDK 调用外部 API
4. 流式事件回传（text / reasoning / tool-call / tool-input / tool-result / finish / error）
5. 工具调用 → ChatRuntime 判断归属：
   - 主进程工具：直接执行并回传结果
   - renderer 工具：通过 `chat:runtime:tool-requested` 请求渲染进程执行并等待结果
   - SDK 工具：由 AI SDK 在流中直接完成
6. 需要继续时自动 continuation（最多 25 轮），完成时返回 usage 并触发自动命名
7. Assistant 草稿持久化 → 硬中断恢复（interruptedDraftRecovery）

### Child Agent 单层只读委派（默认关闭）

`electron/main/modules/chat/agents/` 已提供完整的首阶段只读委派闭环：

- `electron/main/modules/chat/agents/contracts.mts` / `electron/main/modules/chat/agents/result.mts`：校验最小只读 Task Contract、不可变 Continuation/Execution Plan 快照和结构化 Child 结果。
- `electron/main/modules/chat/agents/store.mts`：在 SQLite 中维护 Task、Attempt、Checkpoint、Event 与 Outbox；Task Contract 和 Continuation Snapshot 不可修改，Event 以 aggregate sequence 追加。
- `electron/main/modules/chat/agents/service.mts`：执行原子 prepare、Capability Plan 编译、结果汇合、Checkpoint CAS、Primary Runtime B 单次续接、预算与启动恢复接线。
- `electron/main/modules/chat/agents/coordinator.mts` / `scheduler.mts`：按持久化事实创建 Attempt，以 resource scope 门禁最多三个并行 `pure_read` Child，并处理 deadline 与 cooperative cancellation。
- `electron/main/modules/chat/agents/child-registry.mts` / `executor.mts`：分离稳定 Child Actor 与可替换 Runtime 地址，以冻结模型和最小任务包执行不写普通消息的 Child。
- `electron/main/modules/chat/agents/ipc.mts`：只暴露 `listActive`、`resumePrimary`、`cancelCheckpoint` 的精确 allowlist，不提供 Child transcript 或通用 Child Runtime 入口。
- `types/chat-agent.d.ts`：定义 Task/Attempt/Event/Checkpoint、不可变快照、结构化结果、artifact ownership/visibility 与 usage/cost 公共类型。

完整链路为 Runtime A → 原子 assistant/Task/Checkpoint/Event/Outbox → `waiting_children` → Coordinator 授权与预算预留 → 最多三个无消息 Child Runtime → 乱序结果按原 `toolCallId` 汇合 → `delegation.ready` → CAS → 无工具 `forceFinal` Runtime B。Renderer 重载不影响 Main Registry 中的 Child Actor/Runtime；主进程重启则在开放 IPC 前把无法安全恢复的 Provider 执行收敛为 `interrupted` 并释放 reservation。

`delegate_task` 仍为 `internal`，Primary 委派 feature 默认为关闭；公开 `send()` 先拒绝 Renderer 提供的 deferred 工具和伪 Child lineage，再由 Main 按固定 `pureReadChildEnabled=true`、`maxParallelReadChildren=3` 策略克隆注入可信定义。Child 有效能力满足 `persisted ∩ available ∩ role/policy` 并只能单调收缩，首阶段仅开放 `glob`、`grep`、`read_directory`、`read_file` 中同时被契约、父 Runtime、Registry、权限和资源范围允许的部分。

当前仍不提供 Child transcript、轻量任务卡片、写入 adapter、ConfirmationQueue 或 commit journal。`external_read`、写工具、二层委派和 Renderer 自报模型/权限/计划均 fail closed；这些能力必须进入后续受控写入计划，不能扩展现有只读 Task。

### 上下文压缩（/compact）

- **触发**：`/compact` 斜杠命令手动触发，或发送前根据 token 使用率自动触发
- **策略**：保留最后 2 轮原始消息作锚点，对更早消息生成结构化摘要（通用记忆交接机制，保留关键事实/用户偏好/未完成问题）
- **执行**：`compaction/executor.mts` 调用压缩模型，`structured-summary-generator.mts` 生成摘要
- **持久化**：压缩记录写入 `chat_session_records` 表，支持会话恢复
- **自动压缩**：长任务自动压缩边界修复、工具续轮压缩时机、provider 上下文超限自动压缩重放
- **压缩结果**：自动压缩写入 assistant 消息的 `compaction` part

### 上下文用量指示

- **ContextUsage 组件**：输入工具栏中显示当前 token 用量
- **useContextUsage hook**：追踪上下文窗口使用率
- **contextUsageBudget 工具**：基于当前消息切片估算 token 消耗
- **context/budget.mts**：主进程上下文预算服务

### 文件引用与 file part

聊天输入支持两种文件形式：
- `{{@path}}`、`{{@path#L644}}`、`{{@path#L644-685}}` 文件引用 token：粘贴/拖拽文件自动生成，编辑器选中文本可触发插入（行号格式统一为 `#Lstart-end`）
- `file` part：用户直接粘贴/拖拽图片或文件，作为 message part 发送

FileRefChip 组件统一渲染文件引用，ImagePreview 组件处理图片预览。

### 用户确认与交互

- **ConfirmationSheet**：工具调用确认流程（approve / approve-session / approve-always / cancel）
- **QuestionTool**：向用户提问（产生 pending 状态，影响自动命名触发判断）
- **InteractionContainer**：统一管理 Toast 通知等交互反馈

### ChatSider 职责拆分

- `src/layouts/default/components/ChatSider.vue` 接管侧栏会话壳职责（标题、新会话、历史、放大、关闭、拖拽宽度）
- BChat 调整为根据 `sessionId` 运行的聊天主体组件

### 语音输入

- **前端录音**：PCM → WAV（16kHz 单声道），支持分段录音和静音检测
- **主进程转写**：whisper.cpp 语音识别
- **运行时管理**：按需下载语音运行时，manifest 系统管理版本
- 详见 `docs/speech/`

---

## 编辑器系统

### 双视图架构

BEditor 提供两个视图面板，通过 Tab 切换：

| 视图 | 技术 | 说明 |
|------|------|------|
| 富文本视图 | TipTap 3（ProseMirror） | 所见即所得编辑，支持 28+ 扩展 |
| 源码视图 | CodeMirror 6 | Markdown 源码编辑，语法高亮 |

统一入口 `BEditor/index.vue`，双视图共享适配器层（15 个适配器，统一选区、导航、搜索、行映射、行内补全等行为）。

### 编辑器 Hooks（12 个）

| Hook | 职责 |
|------|------|
| `useAnchors` | 大纲/锚点管理 |
| `useContent` | 文档内容读写 |
| `useRichEditor` | 富文本编辑器控制 |
| `useRichEditorLoad` | 富文本编辑器加载 |
| `useEditorController` | 编辑器生命周期控制 |
| `useEditorResolver` | 编辑器解析器 |
| `useEditorToolContext` | AI 工具上下文提供 |
| `useExtensions` | 扩展管理 |
| `useFrontMatter` | Front Matter 解析 |
| `useCommentActions` | 评论操作 |
| `useSelectionAssistant` | 选区辅助 |
| `useInlineCompletion` | AI 行内补全（Rich 与 Source 双模式共用状态机，单调文档修订号 stale 校验，位置感知取消逻辑） |

### 编辑器扩展（10 个）

- CodeMirror 扩展：AI 高亮、Markdown 装饰、搜索面板、表格控件几何、表格控件命令、绘制选区、标题锚点、源码行内补全（sourceInlineCompletion）
- TipTap 扩展：行内评论、空内容占位、富文本行内补全（richInlineCompletion）、全选命令（richSelectAll）、表格控制命令
- 共享组件：FindBar、SelectionToolbar、SelectionAIInput、SelectionCommentInput、CommentCard

### AI 行内补全

BEditor 新增完整的行内补全子系统：
- `useInlineCompletion` hook 统一编排，Rich 与 Source 双模式共用状态机
- 单调文档修订号 stale 校验，位置感知取消逻辑
- 涉及 hooks（useInlineCompletion）、extensions（richInlineCompletion / sourceInlineCompletion）、utils（inlineCompletionContext / selectionAIPrompt）、adapters（inlineCompletionAdapter）

### 富文本表格控制区

- 焦点态 14px 行列控制条
- 行列选中工具条：删除、加粗/斜体/中划线、列对齐
- 跨列/跨行逻辑列边界修正

### 页面级功能

编辑器页面（`views/editor/`）通过 hooks 提供：
- **useFileSelection**：文件选区/行范围导航
- **useSession**：将编辑器的加载、解析、写盘和对话框事件适配到公共文件控制器
- **useBindings**：编辑器与全局快捷键/命令绑定

全局 `src/hooks/useFileController.ts` 统一管理草稿持久化、保存基线、标签脏状态、磁盘写入策略、文件监听与异步操作隔离；编辑器和 Widget 的 `useSession` 仅通过 `on*` 事件适配文件格式及平台交互。保存状态只区分已保存和未保存，关闭自动保存时只禁止自动写入磁盘，草稿仍会持久化。

---

## Widget 小组件系统

### 概述

BWidget 是原 BDrawing 的重构升级，从纯绘图白板演变为**可执行的小组件系统**。它将画布元素（矩形、文本、图片、按钮、组合）与 JavaScript 执行脚本结合，支持 Input/Output Schema 契约、运行时沙箱、AI 工具集成。

### BWidget 组件架构

| 子组件 | 职责 |
|--------|------|
| InfiniteViewport | 无限画布视口 |
| Minimap | 小地图导航 |
| MoveableLayer | 拖拽/旋转/缩放交互层（moveable 集成） |
| SelectoLayer | 多选交互层（selecto 集成） |
| Toolbar | 绘图工具栏（形状选择、图层排序） |
| ContextMenu | 右键菜单 |

| 渲染器 | 职责 |
|--------|------|
| WidgetCanvas | 画布渲染 |
| WidgetNode | 节点渲染（矩形、文本、图片、按钮、组合） |

### 元素系统（elements/）

| 元素 | 文件 | 说明 |
|------|------|------|
| Button | index.vue + Setter.vue + schema.ts | 按钮元素 |
| Image | index.vue + Setter.vue + schema.ts | 图片元素 |
| Rect | index.vue + schema.ts | 矩形元素 |
| Text | index.vue + Setter.vue + schema.ts | 文本元素 |
| group | Setter.vue | 组合元素 |

每个元素提供 `Setter.vue` 管理样式，替代了原 BDrawing 的独立样式面板组件。

### 关键特性

- **画布编辑器**：矩形、文本、图片、按钮、组合元素，支持拖拽/缩放/多选/锁定/图层排序
- **Input/Output Schema 契约**：树形 Schema 编辑器，JSON Schema 高级编辑弹窗，定义小组件的输入输出数据结构
- **JavaScript 执行脚本**：从 `Widget({ ... })` 对象配置 → `export default class Xxx extends Widget` class 协议
- **运行时沙箱**：Worker 执行，提供 `$input`/`$output`/`$sendMessage`/`$http`/`$logger`/`console` API
- **AI 工具集成**：`widget` 工具（暴露小组件契约）+ `open_widget` 工具（AI 打开聊天小组件）
- **循环数据展开**：元素按数组数据源动态展开渲染
- **变量绑定**：`{{ $input.x }}` / `{{ $output.y }}` 模板插值
- **data patch 机制**：运行态数据双向同步
- **生命周期**：`onExecute` + `onMounted` 两阶段协议

### Widget 管理子系统（src/ai/widget/）

- `types.ts`：Widget 类型定义
- `parser.ts`：Widget JSON 解析
- `scanner.ts`：Widget 目录扫描与发现
- `importer.ts`：Widget 导入（zip 文件，基于 jszip）
- `index.ts`：统一出口

### Widget 设置页

`views/settings/tools/widget/` 提供 Widget 管理 UI：
- `WidgetCreator.vue`：Widget 创建
- `WidgetItemRow.vue`：Widget 列表项
- `index.vue`：管理入口

---

## WebView Agent 自动化

### 能力概述

AI 可通过工具操作内嵌 WebView，实现网页自动化：

- **`read_current_webpage`**：返回页面快照（snapshotId、加载状态、滚动信息、可交互元素列表、视口视觉摘要、Shadow DOM 遍历）
- **`operate_webpage`**：执行点击、输入、选择、滚动、页面导航、等待、按键模拟（Enter/Tab/Esc/方向键）

### 交互体验

- **确认卡支持**："本会话允许"和"始终允许"授权
- **主题色呼吸边框**：读取/操作网页时用户可感知
- **截图优化**：Electron 协议层截取视口外区域，减少滚动拼接跳动
- **DOM 检查看板**：选中元素工具条、元素选择器通信改为 preload `sendToHost`

---

## AI 服务商

### 支持的 Provider（10 个）

| Provider | 说明 | 特性 |
|---------|------|------|
| OpenAI | OpenAI GPT 系列 | 标准 OpenAI 格式 |
| Anthropic | Claude 系列 | 标准 Anthropic 格式 |
| Google | Gemini 系列 | 标准 Google 格式 |
| DeepSeek | DeepSeek 系列 | OpenAI 兼容 |
| Alibaba | 阿里云通义千问 | 独立请求格式（`enable_thinking` 参数） |
| GLM | 智谱 GLM | 独立请求格式 |
| MiMo | 小米 MiMo | 独立请求格式 |
| MiniMax | MiniMax | 独立请求格式 |
| Moonshot | 月之暗面 Kimi | 独立请求格式 |
| Volcengine | 火山引擎豆包 | 独立请求格式（`thinking.type` 参数映射） |

### Provider 实现

每个 Provider 在 `electron/main/modules/ai/providers/` 下有独立文件，`_index.mts` 为注册入口，`helper/openai-compatible.mts` 提供 OpenAI 兼容接口辅助。

---

## 记忆与技能系统

### AI 记忆（src/ai/memory/）

记忆系统存储在 `~/.tibis/MEMORY.md`，System Prompt 预注入，支持 AI action 读写 + 字符串相似度去重。

| 文件 | 职责 |
|------|------|
| `types.ts` | 记忆类型定义（MemoryCategory: Instructions/Preferences/Habits/Facts/Projects/Current Context） |
| `parser.ts` | 记忆解析 |
| `injector.ts` | 记忆注入到对话上下文 |
| `selector.ts` | 记忆相关性选择器（根据当前请求上下文提取关键词，含中文 CJK n-gram 滑窗分词，按分区权重计算相关性分数，筛选需注入的记忆条目） |

**记忆注入模式**：
- 普通回答轮按当前消息和文件引用筛选相关记忆
- 相关模式下不暴露 `edit_memory`，避免数据丢失
- 中文长句召回支持短词滑窗
- 相关模式预算按条目相关性裁剪
- 分区权重：Projects 和 Current Context 权重最高（3），Preferences 和 Facts（2），Habits（1），Instructions 无条件保留
- 无偏好匹配时回退保留前 3 条核心偏好

- `MemoryTool`：AI 工具接口，支持读写记忆
- `stores/ai/memory`：记忆状态管理 store
- 设置页面 `settings/tools/memory/`：记忆管理 UI（MemoryContent + MemoryInput + useMemory）

### 技能系统（src/ai/skill/）

- `types.ts`：技能类型定义
- `parser.ts`：技能文件解析
- `scanner.ts`：技能目录扫描与发现
- `installer.worker.ts`：技能安装（Web Worker 异步执行）
- `package.ts`：技能包管理
- `SkillTool`：技能注册与调用（斜杠命令 `/` 路由）
- 设置页面 `settings/tools/skill/`：技能管理 UI（列表、详情、安装、预览、创建）

---

## 主题系统

### 架构（src/theme/）

```
src/theme/
├── index.ts              # 主题入口
├── core/                 # 核心引擎
│   ├── apply.ts          # 主题应用（CSS 变量注入）
│   ├── derive.ts         # 主题派生（自动生成衍生色）
│   ├── factory.ts        # 主题工厂
│   └── registry.ts       # 主题注册表
├── presets/              # 12 套预设主题
│   ├── ayu / catppuccin / default / everforest / gruvbox
│   ├── kanagawa / matrix / nord / one-dark
│   └── shonen / tokyonight
└── types/                # 令牌类型（tokens.ts）
```

### 预设主题

12 套开箱即用的主题预设：ayu、catppuccin、default、everforest、gruvbox、kanagawa、matrix、nord、one-dark、**shonen**（热血红黑）、tokyonight。

新增主题：
- **Shonen**（热血红黑）：漫画纸张浅色 + 高对比红黑暗色

---

## 存储层

### 主进程数据库

better-sqlite3 在主进程运行，渲染进程通过 `electronAPI.dbExecute/dbSelect` 间接访问。

### 渲染侧存储模块

`src/shared/storage/` 提供按领域的持久化适配：

| 模块 | 职责 |
|------|------|
| `base/` | 通用 KV 存储（BaseStorage 类、manipulator、TTL、合并策略、自毁标记） |
| `files/` | 最近打开文件列表 |
| `providers/` | AI 提供商与模型配置（含默认值） |
| `service-models/` | 服务模型配置 |
| `settings/` | 应用设置持久化 |
| `tool-settings/` | MCP 服务器和搜索工具配置 |
| `utils/` | 数据库连接管理（含初始化竞态重试）、JSON 序列化 |
| `index.ts` | 统一导出 |

### Store 持久化

`helpers/persist.ts` 提供持久化中间件，启动时加载 `pinia.<storeId>`，状态变更时自动写回。

### 安全存储

`electron-store` 用于加密存储 API Key 等敏感信息，与 SQLite 存储分离。

---

## IPC 模块一览

主进程按领域模块拆分，各模块在 `electron/main/modules/index.mts` 统一注册（共 17 个模块）：

| 模块 | 职责 |
|------|------|
| `ai` | AI 流式/非流式调用、Provider 路由（10 个 Provider） |
| `chat` | 聊天会话持久化 + ChatRuntime + 默认关闭的 Agent 委派基础（模型调用、主进程工具、Checkpoint、上下文压缩、自动命名） |
| `database` | SQLite 执行与查询 |
| `dialog` | 原生文件对话框（打开/保存） |
| `export` | PDF 导出（pdf-renderer） |
| `file` | 文件读写、工作区目录读取、文件变更监听 |
| `image` | 图片压缩与格式转换（sharp） |
| `logger` | 日志记录与查询（控制台 + 文件） |
| `mcp` | MCP 运行时管理（session / tools / status / client / transport / discovery + oauth/ 回调服务器） |
| `request` | 平台托管 HTTP 请求代理（core/：body / constants / queue / response / url，提供 `request:send` IPC） |
| `shell` | 系统 Shell（默认 pipe 执行；内部 gated auto-default 使用 PTY 字节静默窗口、Screen Snapshot、checkpoint 状态机、结构化失败和进程树清理） |
| `speech` | 语音运行时管理（installer / runtime / 录音、whisper.cpp 转写） |
| `store` | 安全加密存储（electron-store） |
| `ui` | 窗口控制 + 系统菜单（menu）+ 快捷入口（shortcuts）+ 图片预览（image-preview）+ model |
| `updater` | 应用自动更新 |
| `webview` | 内嵌 WebView 管理（capture 截图 + 安全策略、Partition 隔离） |
| `workspace` | 工作区文件监听（watch / read / root） |

> **变更说明**：原 `memory` IPC 模块已移除（记忆系统改为渲染进程直接管理），新增 `request` 模块提供平台托管 HTTP 请求代理。

---

## 构建配置

### 依赖拆包

Vite 对第三方依赖做细粒度拆包，提升 Electron 内嵌 Web 首屏性能与缓存命中率：

`vue` / `ant-design-icons` / `ant-design-vue` / `prosemirror` / `tiptap-extensions` / `tiptap-core` / `codemirror` / `monaco` / `markdown` / `katex` / `vueuse` / `lodash` / `dayjs` / `mermaid` / `cytoscape` / `ai-sdk` / `tiktoken` / `localforage` / `pragmatic-drag`

### 项目配置

| 文件 | 用途 |
|------|------|
| `vite.config.ts` | Vite 构建（别名、组件自动注册、拆包、Rolldown、Less 全局注入） |
| `tsconfig.json` | TypeScript 根配置（strict、noUnusedLocals、noUnusedParameters、paths `@/*`） |
| `tsconfig.node.json` | Vite 端 TS 配置（composite） |
| `electron/tsconfig.json` | Electron 主进程 TS 配置（target ES2022、.mts） |
| `electron-builder.yml` | Electron 打包配置（macOS/Windows/Linux、asar、file associations） |
| `uno.config.ts` | UnoCSS 原子化 CSS（presetWind3 + presetAttributify、rem→px 后处理） |
| `.eslintrc.cjs` | ESLint（airbnb-base + vue3 + typescript） |
| `.stylelintrc.cjs` | Stylelint（recess-order） |
| `prettier.config.cjs` | Prettier（printWidth 160、singleQuote） |
| `index.html` | HTML 入口（内联主题检测脚本，防闪烁） |

---

## 测试体系

运行 `pnpm test` 执行 Vitest 测试套件，`test/` 目录按源码结构镜像组织，包含以下测试范围：

| 测试范围 | 说明 |
|----------|------|
| `ai/` | 工具系统（builtin-index、builtin-main-process-tool、todo-write、tool-registry） |
| `components/` | BChat、BColorPicker、BEditor、BMessage、BMonaco、BWidget |
| `electron/` | 主进程 ai/errors、chat/runtime（compaction/context/messages/model/stream/tools）、lifecycle、mcp/transport、ui、updater |
| `hooks/` | useFileController、useDraftPersistence、useDiskSave、useFileWatch、useClipboard、useImagePreview、useNavigate、useRecentRecord、useSystem |
| `layouts/` | ChatSider、HeaderTabs（结构 + 滚动）、useHelpActive 等 |
| `router/` | widget 路由 |
| `shared/` | 存储层（files、providers、settings、tool-settings、database） |
| `stores/` | ai/memory-loading + service-model、chat/session + todo、ui/header-toolbar |
| `utils/` | file/reference、image |
| `views/` | editor、widget、settings（provider/service-model/mcp/memory）、webview、welcome |

---

## 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 开发模式（Vite dev server + 主进程 watch + Electron 启动） |
| `pnpm build` | 仅构建前端 |
| `pnpm electron:build-main` | 编译主进程 TypeScript |
| `pnpm electron:build` | 完整打包（前端 + 主进程 + electron-builder） |
| `pnpm test` | 运行 Vitest 测试 |
| `pnpm lint` | ESLint 检查 + 自动修复（覆盖 `.vue`、`.ts`、`.tsx`、`.js`、`.jsx`、`.mts`） |
| `pnpm lint:style` | Stylelint 样式检查 + 修复 |
| `pnpm preview` | 预览构建结果 |
| `pnpm speech:dev:*` | 语音运行时开发环境相关命令 |

---

## 文档体系

| 目录 | 内容 |
|------|------|
| `docs/code-wiki/` | 项目代码百科（概述、架构、前端、编辑器、Electron、存储、AI、开发指南、依赖地图，10 篇） |
| `docs/superpowers/plans/` | 技术实现计划（128 篇，按日期组织） |
| `docs/superpowers/specs/` | 设计规范文档（131 篇） |
| `docs/superpowers/reviews/` | 代码审查记录（7 篇） |
| `docs/ai-tools/` | AI 工具系统分析与开发指南 + 任务文档 + 记忆系统设计（2026-07-08-memory-system-design） |
| `docs/web-view/` | WebView 功能设计文档 |
| `docs/development/` | 开发问题与注意事项 + widget-runtime-lifecycle |
| `docs/speech/` | 语音功能完整说明 |
| `docs/markdown-symbol-highlight/` | Markdown 符号高亮方案 |
| `changelog/` | 变更日志（按日期 .md，覆盖 2026-03-26 至今，101 篇） |
