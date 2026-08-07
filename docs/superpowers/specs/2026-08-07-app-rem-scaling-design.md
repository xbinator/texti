# 应用 UI Rem 缩放设计

## 背景

基础设置页需要新增字体大小设置，并让整个应用 UI 通过 `rem` 跟随根字号变化。当前应用已通过 `useSettingStore` 管理主题、主题预设、侧栏状态等应用级设置，并在启动时通过 `settingStore.init()` 应用主题到 `document.documentElement`。

现有样式中仍大量使用 `px`。源码层继续保留这些设计稿像素值，构建期通过本地插件将应用 UI chrome 的 `px` 转为 `rem`。直接手写 `rem` 或新增大量尺寸变量会降低源码可读性，也更容易让组件脱离设计稿语义。

## 目标

- 在基础设置页提供应用 UI 显示大小设置。
- 源码继续书写设计稿 `px`，构建输出将应用 chrome 转为基于根字号的 `rem`。
- 让主布局、设置页、聊天侧栏、菜单、弹窗、表单、编辑器工具栏和浮层跟随显示大小变化。
- 保持主题、Ant Design token、B 系列基础组件在同一套 `14px` 设计基准下工作。
- 给后续页面迁移留下统一换算规则、排除规则和验证方法。

## 非目标

- 不把 Markdown 正文内容字号纳入本次应用 UI 缩放。
- 不把 Monaco、CodeMirror 的真实编辑字号强制绑定到根字号。
- 不改变 Widget 画布元素的坐标、尺寸、文本字号和测量逻辑。
- 不改变 PDF 导出、截图遮罩、自动化页面快照等面向外部内容或固定像素测量的逻辑。
- 不新增 `--app-font-size-*`、`--app-space-*` 等全局尺寸变量。

## 缩放模型

本功能命名应偏向“界面大小”或“显示大小”，而不是只叫“字体大小”。根字号变化会同时影响文本、控件高度、间距、弹层尺寸和部分布局密度。如果 UI 文案只说“字体大小”，用户会预期只有文字变大，实际体验会不一致。

应用以 `14px` 作为默认根字号，现有设计稿尺寸换算规则为：

```text
rem = px / 14
实际像素 = 原始设计像素 * 当前根字号 / 14
```

示例：

- `14px` -> `1rem`
- `12px` -> `0.8571rem`
- `16px` -> `1.1429rem`
- `28px` -> `2rem`
- `56px` -> `4rem`

用户设置的是根字号，不是把所有组件字号直接改成该数值。比如 `src/components/BBubble/components/Avatar.vue` 源码仍写原始 `12px`，构建期转为 `0.8571rem`：根字号为 `12px` 时实际约 `10.29px`，根字号为 `16px` 时实际约 `13.71px`。原始 `14px` 的正文级 UI 才会在根字号为 `12px` 时实际等于 `12px`。

推荐根字号输入范围：

- 最小：`12px`
- 默认：`14px`
- 最大：`18px`
- 步进：`1px`

持久化值存储为 number，运行时归一化到安全范围 `12` 到 `18`。如果未来需要更细粒度，可在不改数据结构的情况下调整输入步长或允许小数。

## 设置 Store

在 `src/stores/ui/setting.ts` 扩展应用级设置：

- `PersistedSettingState.rootFontSize: number`
- `DEFAULT_SETTINGS.rootFontSize = 14`
- `normalizeRootFontSize(value)` 将未知值归一化到允许范围。
- `applyRootFontSize(size)` 写入根元素的 inline `font-size`，值格式为 `${size}px`。
- `setRootFontSize(size)` 更新状态、持久化并立即应用。
- `init()` 在 `initTheme()` 后调用根字号应用逻辑，确保启动恢复。

根字号属于应用级 UI 设置，不放入 `editorPreferences`。编辑器内容字号如果后续需要独立控制，应新增编辑器偏好项。

## 设置页入口

在 `src/views/settings/basic/index.vue` 新增“界面”设置区域，放置显示大小数字输入框：

- 标签：`界面大小`
- 控件：复用 `BInputNumber`
- 范围：`12` 到 `18`
- 步进：`1`
- 后缀：`px`

保持基础设置页现有 item 样式，样式源码继续书写 `px`，由构建期插件统一转换。

## 构建期转换范围

第一阶段转换应用 chrome 和基础 UI：

- 全局样式：`normalize.less`、`reset.less` 和滚动条样式按职责维护，源码保留 `px`。
- 主布局：`src/layouts/default` 下标题栏、tab、聊天侧栏、拖拽分隔条、更新提示。
- 设置页：`src/views/settings` 下页面、分区、基础设置和高频设置列表。
- B 基础组件：`BButton`、`BSelect`、`BInputNumber`、`BDropdown`、`BModal`、`BDrawer`、`BSegmented`、`BSection`、`BScrollbar`、`BMessage`。
- 聊天 UI：输入工具栏、消息气泡 chrome、工具结果卡片、确认底板、会话历史、模型选择器、待办面板。
- 编辑器外壳：工具栏、查找栏、浮层、注释卡、当前块菜单、代码块操作 chrome、侧栏大纲。

第二阶段再处理低频页面：

- WebView 地址栏、Inspector、设备工具栏。
- Provider、Service Model、Tools 子设置页。
- Skill 页面和技能预览 chrome。
- Widget 编辑器侧栏和属性面板 chrome。

## 排除清单

以下位置保留 `px` 或独立数值语义：

- `src/components/BEditor/utils/exportToPdf.ts` 的导出 HTML 和 PDF 相关尺寸。
- Widget 元素模型、schema、画布坐标、元素尺寸、文本测量和导出 CSS，例如 `fontSize: 14`、`formatPixel()`、`widgetTextMetrics.ts`。
- Monaco / CodeMirror 配置中的编辑器真实字号，除非后续新增独立“编辑器字号”设置。
- 截图、WebView 自动化、DOM 快照、遮罩定位中依赖浏览器像素的测量。
- `1px` 分隔线、边框、outline、滚动条最小命中区域等需要像素精度的局部样式，插件通过 `minPixelValue = 1` 保持不变。
- 媒体查询断点和容器查询断点，除非明确要随 UI 缩放改变响应式阈值。
- 图片、预览缩略图、画布、拖拽手柄等固定视觉或交互命中尺寸，先按组件逐个判断。

## Ant Design 映射

Ant Design 主题 token 多数接受 number 并生成 `px`，不会天然跟随 `rem`。本次策略：

- 应用根字号负责自研 CSS 的 `rem` 缩放。
- Ant Design 继续通过 `toAntdToken()` 接收主题 token，必要时增加 `fontSize`、`controlHeight`、`controlHeightSM`、`controlHeightLG` 等数字 token，并按 `原始设计像素 * rootFontSize / 14` 派生，使 AntD 控件与当前 `rootFontSize` 对齐。
- `useAntdTheme` 需要依赖 `settingStore.rootFontSize`，在字号变化时重新计算 AntD token。

AntD 数字 token 仍以 px 传入，但由根字号设置派生，而不是硬编码常量。

## 插件策略

新增本地构建插件 `build/pxToRem.ts`，以 PostCSS 插件形式接入 `vite.config.ts`：

- 默认 `rootValue = 14`。
- 默认 `precision = 4`。
- 默认 `minPixelValue = 1`，保留 `1px` 精度线。
- 只处理 `src` 下样式来源。
- 排除 `markdown.less`、`BEditor`、`BMonaco`、`BSmart`、`BWidget` 和 `views/widget`。
- 跳过引号和 `url(...)` 内的文本。

Vue/TS 中的 inline style 字符串不会被 PostCSS 转换；如果属于应用 UI，需要改为 CSS class，并在 `<style>` 中继续写 `px`。

## 实施顺序

1. 扩展 `useSettingStore`，完成持久化、归一化、初始化和 `setRootFontSize()`。
2. 在基础设置页增加“界面大小”数字输入框。
3. 新增 `pxToRem` 构建插件，并在 Vite CSS PostCSS 配置中启用。
4. 将已手写的 `rem` 和 `--app-*` 尺寸变量还原为源码 `px`。
5. 将 Ant Design token 与 `rootFontSize` 联动。
6. 按排除清单跳过内容、画布、导出和像素测量逻辑。

## 验证

- `pnpm lint`
- `pnpm lint:style`
- `pnpm exec tsc --noEmit`
- 手动切换 `12px / 14px / 16px / 18px`，检查设置页、主布局、聊天侧栏、编辑器页、弹窗和下拉菜单。
- 重点观察按钮文字是否溢出、tab 是否挤压、聊天输入区是否过高、弹层是否错位、编辑器正文是否被意外改变。

## 风险

- 如果插件转换范围过大，容易影响编辑器正文、Widget 画布或测量逻辑。应通过排除清单和测试保护。
- 如果某些 UI 使用 JS inline style 字符串，PostCSS 插件无法转换，需要改为 CSS class。
- 如果 AntD token 不联动，第三方控件和自研组件会出现密度不一致。
- 如果误改 Widget 或编辑器内容尺寸，会改变用户文档和画布语义。
