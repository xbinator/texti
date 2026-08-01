# 设计主题 Token Contract 设计

## 背景

当前 `src/theme` 已经把颜色主题集中到 `ThemeTokens`，并能派生 CSS 变量、Ant Design Token 和 Monaco 颜色。但主题仍主要等同于“配色表”。圆角、边框宽度、字体、按压动效、部分阴影和组件外观仍分散在组件样式里，例如 `BButton`、`BDropdown`、`BModal`、`BDrawer`、`BSelect` 以及设置页、聊天输入框等页面组件。

Overworld 参考不是单一主题色，而是一种复古 RPG 的主题人格：米色纸面、钴蓝主色、黑色像素边、零圆角或极小圆角、硬阴影、短促按压动效、像素字体气质。如果只新增颜色，界面会变成现代圆角 UI 套上 Overworld 色值，视觉不完整，也不利于未来主题自定义。

## 目标

- 将主题系统从颜色 token 扩展为受约束的设计 token contract。
- 支持 Overworld 作为第一套强风格主题，而不是单个按钮或单个页面的专属样式。
- 为未来用户自定义主题预留结构：颜色、圆角、边框、字体、动效和效果参数可以被保存、补全、校验和迁移。
- 保持现有主题消费路径不变：设置页选择 preset 后，CSS 变量、Ant Design、Monaco 和基础组件都从同一份 token 派生。
- 第一阶段只迁移基础控件和主题基础设施，避免一次性改完整个应用造成视觉回归。

## 非目标

- 不在第一阶段全量替换所有页面里的硬编码圆角和 transition。
- 不把 `button.md` 中的 `.ow-press-btn` 直接做成一次性专属组件样式。
- 不在第一阶段引入远程字体加载或强依赖 Pixelify Sans、VT323 等外部字体。
- 不把布局尺寸、间距体系、响应式断点纳入本次主题 contract。

## 设计原则

主题应表达“人格”，组件应消费“语义”。因此 token 分两层：

- primitive token：主题作者能理解和填写的基础值，例如 `radius.none`、`borderWidth.strong`、`font.display`。
- semantic token：组件实际消费的语义值，例如 `control.radius`、`surface.radius`、`overlay.radius`、`interaction.pressOffset`。

第一阶段以 semantic token 为主，减少组件猜测。primitive 可以作为工厂内部和未来自定义 UI 的输入结构，但组件不直接依赖主题作者的命名习惯。

## ThemeTokens 扩展

在现有颜色分组之外，新增以下非颜色分组：

```typescript
interface ThemeTokens {
  // 现有 bg/text/border/color/code/richEditor/sourceEditor/monaco 等颜色分组保持不变。

  radius: {
    none: string;
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
    full: string;
  };

  borderWidth: {
    hairline: string;
    thin: string;
    strong: string;
  };

  font: {
    sans: string;
    mono: string;
    display: string;
  };

  motion: {
    durationFast: string;
    durationBase: string;
    durationSlow: string;
    easingStandard: string;
    easingPress: string;
  };

  control: {
    radius: string;
    borderWidth: string;
    focusRingWidth: string;
  };

  surface: {
    radius: string;
    borderWidth: string;
  };

  overlay: {
    radius: string;
    borderWidth: string;
  };

  interaction: {
    pressOffset: string;
  };
}
```

### CSS 变量命名

`toCssVars` 继续使用分组扁平化规则：

- `radius.md` -> `--radius-md`
- `borderWidth.strong` -> `--border-width-strong`
- `font.display` -> `--font-display`
- `motion.durationFast` -> `--motion-duration-fast`
- `control.radius` -> `--control-radius`
- `interaction.pressOffset` -> `--interaction-press-offset`

`richEditor` 和 `usagePanel` 继续保留现有兼容前缀：`--editor-*` 和 `--usage-*`。

## 工厂和覆盖能力

`createThemeTokens` 增加可选 overrides 参数：

```typescript
type ThemeTokenOverrides = PartialDeep<ThemeTokens>;

function createThemeTokens(
  palette: BasePalette,
  mode: 'light' | 'dark',
  overrides?: ThemeTokenOverrides
): ThemeTokens;
```

默认工厂生成现代 UI 风格的非颜色 token：

- `control.radius = radius.sm`
- `surface.radius = radius.lg`
- `overlay.radius = radius.md`
- `control.borderWidth = borderWidth.thin`
- `interaction.pressOffset = 0px`
- `font.display = font.sans`
- `motion.durationBase = 200ms`

强风格主题通过 overrides 覆盖少量值，不需要手写完整 `ThemeTokens`。

## Overworld Preset

新增 `src/theme/presets/overworld.ts`，使用 `BasePalette + overrides` 定义亮暗两套。

### 亮色方向

- 背景：parchment / bone，接近参考图中的纸面。
- 主色：sky cobalt `#2e5dd6`，映射到 `color.primary`。
- 文本与边框：ink `#161310`，确保像素边和正文可读。
- 成功：moss green，映射到 `color.success`。
- 警示/奖励：sunset vermillion `#e2522e`，映射到 `color.warning`、部分强调色。
- 圆角：控件、表面、弹层优先使用 `0px` 或极小值。
- 边框：控件和表面使用更强的 `2px` 边框 token。
- 动效：按压相关时长更短，`interaction.pressOffset = 6px` 作为未来组件变体的统一参数。

### 暗色方向

暗色不做纯反相，而保留 Overworld 的高对比游戏界面感：

- 背景使用深墨黑和深蓝层级。
- 主色保持较亮钴蓝，避免在深色中失去识别。
- 文本使用 warm bone。
- 边框使用 warm bone 或低透明度浅色边。
- 成功和奖励色保留复古高饱和感，但使用透明背景 token 控制视觉重量。

## Ant Design 映射

`toAntdToken` 除现有颜色外，增加非颜色映射：

- `borderRadius: parseDimension(tokens.control.radius)`
- `borderRadiusLG: parseDimension(tokens.surface.radius)`
- `borderRadiusSM: parseDimension(tokens.radius.xs)`
- `lineWidth: parseDimension(tokens.control.borderWidth)`
- `fontFamily: tokens.font.sans`

如果 Ant Design 只接受 number，则通过安全的 `parseDimension` 将 `0`、`px`、`rem`、`em` 归一为 px 数值；相对单位使用 16px 基准，解析失败时回退默认值并在开发环境告警。

## 基础组件第一阶段迁移

第一阶段只迁移高复用基础控件，降低风险：

- `BButton`
  - 默认圆角改为 `var(--control-radius)`
  - 方形按钮圆角同样使用 `--control-radius`
  - transition 使用 `--motion-duration-base` 和 `--motion-easing-standard`
  - rounded 仍保留 `--radius-full`
- `BDropdown` / `BDropdown.Menu`
  - 弹层圆角使用 `--overlay-radius`
  - 阴影继续使用现有 `--shadow-dropdown`
- `BModal`
  - 默认圆角使用 `--overlay-radius`
  - 显式 `borderRadius` prop 优先级保持高于主题 token
- `BDrawer`
  - 内部控件圆角使用 `--control-radius`
  - 抽屉容器保持布局语义，不强行做像素外框
- `BSelect`
  - 自定义 tips 圆角和 AntD selector 圆角跟随 AntD token / `--control-radius`

页面级组件、聊天气泡、编辑器表格、Widget 元素等暂不全量迁移。后续按组件风险逐步替换硬编码值。

继续迁移时，优先处理聊天输入区、消息附件、确认底板、会话历史、模型选择器和问题卡片。这些是用户高频可见的 chrome，使用 `surface`、`control`、`overlay`、`radius.full` 和 motion token，可以显著减少强风格主题中的现代圆角残留，同时不触碰编辑器正文和 Widget 自定义画布的专有视觉。

边框宽度应与圆角一起迁移。Overworld 的像素感主要依赖墨线边框，如果组件仍写死 `1px`，即使主题提供 `control.borderWidth = 2px`、`surface.borderWidth = 2px` 和 `overlay.borderWidth = 2px`，最终视觉也会退回现代轻边框。第一阶段只替换已经被识别为 control、surface、overlay chrome 的边框；普通按钮 chrome 使用 `button.borderWidth` 与 `button.border`，默认主题为 `0px/transparent`，Overworld 才显示像素边框；`outline` 这类显式语义按钮保留可见描边。loading ring、分隔线和图形内部描边保留局部样式。

## 自定义主题预留

未来用户自定义主题时，持久化结构应包含版本号：

```typescript
interface CustomThemeConfig {
  schemaVersion: 1;
  id: string;
  label: string;
  light: ThemeTokenOverrides;
  dark: ThemeTokenOverrides;
}
```

加载时流程：

1. 根据 `schemaVersion` 执行迁移。
2. 与默认主题 token 深度合并补齐缺失字段。
3. 校验颜色、尺寸、时长、字体字符串格式。
4. 注册成普通 `ThemePreset`，消费方不区分内置主题和自定义主题。

本次不实现自定义主题 UI，但新增 token contract 时避免破坏这条路径。

## 校验

`validateTokens` 从“所有值都是颜色”改为按分组或字段校验：

- 颜色字段允许 `#hex`、`rgb()`、`color-mix()`、阴影中的 `rgb()`。
- 圆角、边框宽度、位移允许 `px`、`rem`、`em`、`0`。
- 时长允许 `ms`、`s`。
- easing 允许常见关键字和 `cubic-bezier()`。
- font 允许普通字体栈字符串。

开发环境发现异常格式时输出 warning，不阻断运行。

## 测试策略

- `test/theme/preset-list.test.ts`
  - 验证 `overworld` 出现在公开主题列表中。
  - 验证亮色关键 token：`color.primary`、`text.primary`、`border.primary`、`control.radius`、`interaction.pressOffset`。
  - 验证 `toCssVars` 能输出 `--control-radius`、`--font-display`、`--interaction-press-offset`。
- 新增或扩展派生测试
  - 验证 `toAntdToken` 输出 `borderRadius`、`lineWidth`、`fontFamily`。
  - 验证 `validateTokens` 不会把非颜色 token 当作错误颜色。
- 组件样式测试
  - 验证 `BButton` 样式包含 `var(--control-radius)` 和 motion token。
  - 验证弹层类组件使用 `--overlay-radius`。

## 分阶段实施

### Phase 1：Contract 和 Overworld

- 扩展 `ThemeTokens`。
- 扩展 `createThemeTokens` overrides。
- 扩展 `toCssVars`、`toAntdToken`、`validateTokens`。
- 新增 `overworld` preset 并注册。
- 迁移第一批基础组件。
- 补充测试。

### Phase 2：硬编码样式收敛

- 用搜索结果逐步替换高复用组件中的 `border-radius`、`transition`、`font-family`。
- 每次迁移一个组件族，配套测试。
- 页面级特殊视觉可保留硬编码，但需要明确是局部设计而非主题基础 token。

### Phase 3：自定义主题

- 增加自定义主题配置类型、schemaVersion 和迁移函数。
- 增加导入、编辑、预览、恢复默认能力。
- 将自定义主题注册到现有 registry。

## 风险和应对

- 风险：强风格主题改变边框宽度后影响布局。
  - 应对：第一阶段只让基础控件读 token，不让主题直接改变全局布局间距；`borderWidth.strong` 主要作为语义输入，不强制所有组件立即使用。
- 风险：像素字体不可用导致效果变弱。
  - 应对：`font.display` 使用安全 fallback，第一阶段不依赖远程字体。后续如需内置字体，单独设计资源加载策略。
- 风险：Ant Design 与自研组件视觉不同步。
  - 应对：同一阶段同时映射 AntD 的 radius/lineWidth 和迁移基础自研组件。
- 风险：token 自由度过高导致自定义主题破坏可用性。
  - 应对：通过 semantic token、格式校验和默认值补全限制可变范围。

## 成功标准

- 用户能在主题风格中选择 Overworld。
- Overworld 的颜色、基础控件圆角、边框宽度、动效时长和字体栈都来自统一 token。
- 现有 default、graphite、shonen、manga-ink 在未覆盖非颜色 token 时保持现代 UI 默认外观。
- 新增主题不需要修改消费方，只需提供 palette 和少量 overrides。
- 测试覆盖主题注册、CSS 变量派生、Ant Design 非颜色 token 映射和基础组件 token 消费。
