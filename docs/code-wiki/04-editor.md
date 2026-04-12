# 04-编辑器（BEditor）

## 模块目标

`src/components/BEditor/` 是“编辑器能力”的组件化封装层，目标是把 Markdown 编辑体验收敛为一个可复用、可扩展的组件：

- 富文本（TipTap）与源码编辑双模式
- Markdown ↔ TipTap 文档结构映射
- 目录（heading anchors）、搜索高亮与滚动定位
- front-matter（YAML）编辑与展示
- 选择文本的 AI 交互入口（Selection toolbar / input）

## 主要文件

- 组件入口：`src/components/BEditor/index.vue`
- 视图组件：
  - `components/RichEditorPane.vue`：TipTap 富文本容器
  - `components/SourceEditorPane.vue`：源码编辑容器
  - `Sidebar.vue`：目录/大纲侧栏
- hooks：
  - `hooks/useEditorController.ts`：统一 rich/source 两种编辑器的控制接口
  - `hooks/useContent.ts`：内容同步、粘贴策略、富/源码切换时的状态迁移
  - `hooks/useExtensions.ts`：TipTap extensions 组合（含 markdown parser 扩展、表格、数学公式等）
  - `hooks/useAnchors.ts`：heading anchors 与目录数据生成
  - `hooks/useFrontMatter.ts`：front-matter 的解析与数据流
- TipTap 扩展：
  - `extensions/Search.ts`：搜索命中与滚动定位（向上提供 `onMatchFocus` 回调）
  - `extensions/AISelectionHighlight.ts`：AI 选区高亮

## 关键设计：统一控制器（Controller）

`useEditorController` 输出统一的 `EditorController`：

- 在 rich mode 下直接代理 `RichEditorPane` 的实现
- 在 source mode 下提供一个“降级 controller”（undo/redo 不可用，但 focus 可用）

这样编辑器外层（工具栏、快捷键）不必感知当前模式。

## 关键设计：Extension 组合（Markdown 解析能力）

`useExtensions` 通过 TipTap 的 `Markdown` 扩展实现 Markdown 解析与渲染，并对以下节点做了特殊处理：

- Heading
  - `parseMarkdown` 时为 heading 自动生成稳定的 `id`：`${editorInstanceId}-heading-${index}`
  - `assignHeadingIds(editor)` 在文档变更后对 heading id 做补偿修正，保证目录跳转不漂移
- ListItem
  - 自定义 `parseMarkdown`，把“纯 inline 文本”和“block children”拆分并规整为 paragraph 起始结构，避免 TipTap 对列表解析的边界问题
- Table / Link
  - 为 `marked` 的 token 结构提供可控的 parse 实现，确保表格与链接在富文本/源码切换间可逆
- Mathematics（KaTeX）
  - `throwOnError: false`，保证遇到非法公式时不炸编辑器

## 关键入口（对外接口）

外部通常只需要依赖：

- `BEditor`：内容输入/展示
- `EditorController`：undo/redo、focus 等（通过 `useEditorController` 收口）
- 搜索/目录：通过 `Search` 扩展与 `useAnchors` 对外传递事件/数据

## 常见扩展点

- 增加新节点/mark：在 `useExtensions` 的 `editorExtensions` 中组合，并补充 markdown parse/render（如果需要可逆）
- 增加编辑器 UI：在 `BEditor/components/*` 中实现，然后在 `BEditor/index.vue` 统一编排
