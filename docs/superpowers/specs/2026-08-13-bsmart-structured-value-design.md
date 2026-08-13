# BSmart 结构化值重构设计

## 背景

`src/components/BSmart/Input.vue` 和 `src/components/BSmart/Select.vue` 当前直接读写字符串、数字、布尔值、`null` 等基本类型，并通过 `{{ expression }}` 字符串语法判断一个值是否来自变量。这导致值本身与值来源混在同一个字段中，调用方需要重复解析模板字符串，类型也无法区分静态值和变量引用。

本次重构将 Smart 组件的模型统一改为结构化引用类型。历史基本类型和旧 `{{ }}` 数据不迁移、不兼容。

## 目标

- 使用共享泛型 `BSmartValue<T>` 明确区分静态值和变量引用。
- 一个 Smart 值只能是完整静态值或完整变量引用，不再支持混合插值。
- 变量引用只保存稳定路径，不保存 `{{ }}`、标签或描述。
- `BSmartInput` 和 `BSmartSelect` 使用一致的值协议。
- Widget 存储、设置器和渲染链路直接消费结构化值。
- 保留非 Smart 场景现有的混合模板能力，例如 Text 元素内容。

## 非目标

- 不迁移历史 Widget 数据。
- 不兼容 Smart 字段中的旧基本类型或旧 `{{ expression }}` 字符串。
- 不重构 Text 元素及其他仍需要混合文本插值的功能。
- 不把变量标签、描述或完整变量树复制到 Widget metadata。

## 类型模型

共享类型定义在 `src/components/BSmart/types.ts`：

```ts
/** 静态 Smart 值。 */
export interface BSmartLiteralValue<T> {
  /** 值来源类型。 */
  type: 'literal';
  /** 实际静态值。 */
  value: T;
}

/** Smart 变量引用。 */
export interface BSmartVariableValue {
  /** 值来源类型。 */
  type: 'variable';
  /** 不带双花括号的变量路径。 */
  value: string;
}

/** 静态值或变量引用。 */
export type BSmartValue<T> = BSmartLiteralValue<T> | BSmartVariableValue;

/** 单行 Smart 输入值。 */
export type BSmartInputValue = BSmartValue<string>;

/** Smart 选择器支持的静态值。 */
export type BSmartSelectStaticValue = string | number | boolean | null;

/** Smart 选择器模型值。 */
export type BSmartSelectValue<T extends BSmartSelectStaticValue = BSmartSelectStaticValue> = BSmartValue<T> | undefined;
```

`BSmartValue<T>` 中的 `T` 只约束 `literal.value` 的静态类型。变量引用的实际结果在运行时才可获知，由字段消费方继续执行布尔、文本、数组等业务归一化；metadata 不缓存变量的推断类型。

在 `src/components/BSmart/utils/value.ts` 提供以下共享能力：

- `createLiteralValue<T>(value)`：创建静态值。
- `createVariableValue(path)`：创建变量引用。
- `isLiteralValue(value)`：判断静态值。
- `isVariableValue(value)`：判断变量引用。
- `isSmartValue(value)`：判断合法的 Smart 值对象。

这些辅助函数只识别新结构，不把旧基本类型或模板字符串转换为 Smart 值。

## BSmartInput

### 模型契约

`BSmartInput` 的 `value` 改为 `BSmartInputValue`。未传入模型时内部默认值为 `{ type: 'literal', value: '' }`；清空输入框也写回该值。`change` 事件改为发送完整的 `BSmartInputValue`。

### 交互

- `literal` 状态展示并编辑 `value` 字符串。
- `literal` 状态的变量按钮独立位于输入框外部，不占用输入框 `suffix`；点击后只切换到变量输入界面，并将当前文本带入变量草稿，在用户输入或选择前不改写模型，也不自动打开变量列表。
- `variable` 状态展示并允许编辑不带 `{{ }}` 的变量路径。非空路径持续写回 `{ type: 'variable', value: editedPath }`；清空时只保留为未提交草稿，不写入空变量路径。
- `variable` 状态的输入框 `suffix` 仅显示 `lucide:chevron-down`，点击后切换变量列表的打开状态。
- `variable` 状态保留输入框外部的类型按钮，图标为 `lucide:type`；点击后把当前路径直接写为 `{ type: 'literal', value: currentPath }`。
- 从 `literal` 临时切到变量界面后，如果没有提交路径又返回文本界面，原来的 `literal` 模型保持不变；已提交变量清空后返回文本界面时写回静态空字符串。
- 选择变量后直接覆盖完整模型为 `{ type: 'variable', value: path }`。
- 不再监听用户输入的 `{{`，也不再按光标位置插入或替换变量。
- 删除 `useTemplateSyntax`、`replaceEntireValue`、触发范围和光标插值相关逻辑。
- 保留变量树展开、键盘导航、下拉定位和外部点击关闭行为，并在键盘到达首尾后循环选择。

`readonly` 仅控制调用方明确要求只读的输入场景，不再用于 `BSmartSelect` 复用；正常的变量路径始终可编辑。

## 共享变量输入控件

在 `BSmartInput` 与 `BSmartSelect` 内部抽取一个共享变量输入控件，集中负责变量路径输入和变量列表交互。该控件不是 Smart 模型的拥有者，只接收和发送变量路径字符串，由外层组件负责包装成 `BSmartValue<T>`。

共享控件承担以下职责：

- 展示和编辑变量路径。
- 在输入框 `suffix` 中展示 `lucide:chevron-down` 并控制列表开关。
- 管理变量树展开、活动项、键盘事件、浮层定位和外部点击关闭。
- `ArrowDown` 在最后一个可见变量后回到第一个，`ArrowUp` 在第一个变量前回到最后一个。
- 列表打开时根据当前路径找到已选变量，展开其所有父节点，把活动项设置到该变量，并请求列表滚动到可视区域。
- 变量列表只有一个键盘或鼠标活动态，不再为模型值维护独立的视觉选中态。打开列表时模型路径只负责初始化活动项；导航到其他变量后，原模型变量不继续高亮。

如果当前路径不在候选变量中，键盘活动项从第一个可见变量开始。候选为空时变量入口保持禁用。

## BSmartSelect

### 模型契约

`BSmartSelect` 使用 Vue 泛型参数 `T extends BSmartSelectStaticValue`，其 `value` 改为 `BSmartSelectValue<T>`，选项改为 `BSmartSelectOption<T>[]`。`BSmartSelectOption.value` 继续保存基本类型，因为它描述的是静态候选项，而不是已选择模型。泛型由调用方的选项和模型推断，使布尔 Select 只能写回 `BSmartValue<boolean>`，数字或字符串 Select 同理。

### 交互

- 选择静态选项后写回 `{ type: 'literal', value: option.value }`。
- 选择变量后写回 `{ type: 'variable', value: path }`。
- `undefined` 表示尚未选择，继续显示占位符。
- 外部模型为 `variable` 时显示变量模式；为 `literal` 或 `undefined` 时显示静态选择模式。
- 普通模式切换本身不修改模型，只有实际选择静态选项或非空变量路径时才写回；已提交变量被清空后返回静态界面时写回 `undefined`。
- `BSmartSelect` 不再渲染或依赖 `BSmartInput`。变量模式直接复用共享变量输入控件，并把用户编辑的非空路径包装为 `{ type: 'variable', value: editedPath }`；空路径仅作为未提交草稿保留。
- 静态模式的变量按钮独立于选择器；点击后只显示变量输入界面，在用户输入或选择前不改写模型，也不自动打开变量列表。
- 变量模式的外部静态类型按钮返回静态选择界面；普通返回不改写模型，已清空变量草稿时写回 `undefined`，选中静态选项后写回 `literal`。

静态选项的内部 key 继续只承担 UI 映射职责，不写入模型。

## VariableSelect 活动项定位

变量输入控件打开 `VariableSelect` 时：

1. 根据完整路径匹配当前变量。
2. 展开该变量的所有祖先节点，确保它出现在可见变量列表中。
3. 初始化键盘活动索引到该变量。
4. 通过下拉容器现有的滚动请求把活动项滚动到可视区域。

`VariableSelect` 只渲染活动项的整行背景，不接收或渲染独立的模型选中态。鼠标或键盘导航改变活动项后，界面始终只有一个高亮，避免同一变量出现内外两层背景。

## Widget 存储迁移

所有直接使用 `BSmartInput` 或 `BSmartSelect` 的字段同步改为结构化值：

- Button
  - `text: BSmartValue<string>`
  - `disabled: BSmartValue<boolean>`
  - `loading: BSmartValue<boolean>`
- Image
  - `src: BSmartValue<string>`
  - `alt: BSmartValue<string>`，空值使用静态空字符串，不再省略
- Swiper
  - 图片项 `src`、`alt` 改为 `BSmartValue<string>`
  - `vertical`、`autoplay`、`loop`、`showIndicator` 改为 `BSmartValue<boolean>`
- Method
  - `MethodAction.args` 改为 `BSmartValue<string>[]`
- Loop
  - `WidgetLoopConfig.source` 改为 `BSmartValue<string>`

相关 schema 默认值全部使用 `createLiteralValue` 创建。Setter 不再通过 `useElementTemplate` 把结构化值转换回模板字符串；能直接绑定的字段直接绑定，嵌套数组项继续使用不可变对象更新。

Loop 数据源只有在变量引用运行时解析为数组后才产生迭代项。静态字符串不是表达式，不会被当成变量路径执行。

## 运行时解析

Widget 绑定工具增加统一的 Smart 值解析入口：

```ts
resolveWidgetSmartValue<T>(
  value: BSmartValue<T> | undefined,
  options?: WidgetRenderEvaluationOptions
): unknown
```

解析规则：

1. `literal` 在设计态和运行态均直接返回其 `value`。
2. `variable` 在运行态将保存的路径交给现有安全表达式求值器。
3. `variable` 在设计态返回 `undefined`。
4. 缺少运行上下文、路径为空、表达式不合法或读取失败时返回 `undefined`。
5. 不将变量路径或带双花括号的文本作为失败回退值。

文本和布尔字段继续通过现有展示转换逻辑把解析结果规整为安全值，例如文本为 `''`、布尔值为 `false`。Swiper 中目前直接读取布尔 metadata 的逻辑改为先解析 Smart 值，再归一化。

现有字符串模板解析函数继续服务 Text 等非 Smart 场景。迁移后的 Smart 字段不会再调用模板字符串兼容路径。

## 数据流

```text
用户输入或选择
  -> BSmartInput / BSmartSelect 创建 BSmartValue<T>
  -> Setter 写入 Widget metadata
  -> Widget schema 持久化结构化对象
  -> 渲染组件调用 resolveWidgetSmartValue
  -> literal 直接取值 / variable 从运行上下文求值
  -> 文本、布尔或业务转换
  -> 最终界面或方法参数
```

## 异常与边界

- 运行时收到结构异常的 Smart 值时安全返回 `undefined`，不抛出渲染异常。
- 变量路径解析继续使用现有受限表达式宿主，保留原型链与全局对象访问防护。
- 变量候选为空时禁用变量入口。
- Select 当前静态值不在选项列表中时显示未选中状态，但不主动改写模型。
- Input 的静态空字符串是合法值；Select 的未选择状态由 `undefined` 表示。
- 不提供旧数据转换器、模板识别器或兼容分支。

## Developing Widget 同步

`skills/developing-widget/references` 中所有 Smart 字段示例和说明同步使用 `{ type, value }`：

- Button 的 `text`、`disabled`、`loading` 与方法参数。
- Image 和 Swiper 图片项的 `src`、`alt`。
- Swiper 的布尔配置。
- Loop 的 `source`。

变量引用只写路径，例如 `{ "type": "variable", "value": "items" }`，不得在 `value` 中写 `{{ items }}`。Text 元素内容仍保留混合模板语法，文档需要明确区分 Text 模板和 Smart 字段，避免把本次协议错误扩展到非 Smart 内容。

同步修改 `skills/developing-widget/scripts/validate-widget.js` 及其测试，使校验器接受上述结构化 Smart 值，并拒绝对应字段的旧基本类型和 `{{ }}` 变量字符串。资源收集逻辑只从 `literal` 图片地址提取本地资源；`variable` 图片地址不作为静态资源路径处理。

## 测试策略

### BSmartInput

- 静态值正确展示并写回结构化值。
- 清空输入写回静态空字符串。
- 选择变量只保存路径，不保存 `{{ }}`。
- 编辑变量路径持续写回变量值。
- 清空变量路径后不会保存空变量引用，返回文本/静态界面时写入对应空值。
- 点击外部类型按钮把当前变量路径转换为静态值。
- literal 状态的变量按钮位于输入框外部，variable 状态的下拉按钮位于输入框 `suffix`。
- 手动输入 `{{` 不打开变量下拉。
- 上下方向键在变量列表首尾循环。
- 变量树、键盘导航、单一活动态和下拉定位行为继续通过测试。

### BSmartSelect

- 静态字符串、数字、布尔值和 `null` 均包装为 `literal`。
- 变量选择写回 `variable`。
- 模式切换在选择完成前不修改模型，也不自动打开变量列表。
- `undefined`、外部 `literal` 和外部 `variable` 更新正确同步显示。
- 不渲染或依赖 `BSmartInput`。
- 变量路径可编辑，编辑结果仍为 `variable`。
- 变量输入和选择行为与 `BSmartInput` 一致。

### VariableSelect

- 打开列表时展开当前变量的祖先节点。
- 键盘活动项初始化为当前变量并滚动到可视区域。
- 列表只展示一个活动项背景，不渲染独立模型选中背景。
- 鼠标或键盘切换活动项后，原模型变量不继续高亮。
- 当前路径不存在时安全回退到首个可见变量。

### Developing Widget

- 引用文档中的 Smart 示例全部使用结构化值。
- 校验器接受合法 `BSmartValue<T>` 并拒绝旧基本类型。
- 校验器按字段约束 `literal.value` 的字符串或布尔类型。
- 静态图片资源继续被收集，变量图片路径不会被误判为静态资源。

### Widget 解析与集成

- 各静态基本类型原样解析。
- 变量在运行态正确求值。
- 变量在设计态、缺少上下文或解析失败时返回 `undefined`。
- Button、Image、Swiper 的默认 schema 使用结构化静态值。
- Button 状态、Image 地址、Swiper 图片和布尔开关正确消费解析结果。
- Method 参数按顺序解析为实际调用参数。
- Loop 只接受解析结果为数组的数据源。
- 旧基本类型和旧模板字符串不作为迁移后字段的有效输入。

## 验收标准

- Smart 组件和直接调用方不再把基本类型作为模型值。
- Smart 字段中不再通过 `{{ }}` 判断变量来源。
- `useTemplateSyntax` 和 `replaceEntireValue` 从 `BSmartInput` API 中移除。
- `BSmartSelect` 不再通过 `BSmartInput` 实现变量模式。
- 变量路径可编辑，键盘导航循环，打开列表时以单一活动态定位当前变量。
- Input 和 Select 切换到变量模式时不自动打开列表，只能通过 suffix chevron 展开。
- 所有受影响 schema 默认值、Setter、渲染器和测试完成同步更新。
- Developing Widget 引用文档、校验器和测试与结构化协议一致。
- 相关 Vitest 测试通过。
- ESLint、Stylelint 和 TypeScript 类型检查通过。
