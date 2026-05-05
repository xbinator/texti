# BEditor 选区工具栏适配器设计

## 背景

当前 `SelectionToolbar.vue`、`SelectionAIInput.vue`、`RichEditorContent.vue` 组成的整套选区工具交互，只服务于富文本模式：

- `SelectionToolbar.vue` 直接依赖 Tiptap `BubbleMenu` 与 `Editor`
- `SelectionAIInput.vue` 直接依赖 Tiptap 选区恢复、定位与内容替换能力
- `RichEditorContent.vue` 负责选区缓存、失焦高亮维持、AI 面板显隐编排

这套实现已经沉淀出明确的交互契约：

1. 选中文本后显示选区工具入口
2. 点击 `AI 助手` 后，输入面板接管交互，但原选区仍保留可感知高亮
3. 点击 `插入对话` 后，不强制恢复真实选区，但要保留一段时间的视觉高亮
4. 选区高亮在失焦后不会立刻消失，而是保持粘性状态；只有编辑器内部重新获取焦点并触发新的选区同步时，才会按当前真实选区收敛或清除
5. 点击编辑器面板内其他区域时，需要按既有规则清理高亮与浮层
6. 富文本模式支持格式按钮；源码模式本次只需要支持 `AI 助手` 与 `插入对话`

现在需要让这套能力同时支持：

- `src/components/BEditor/components/PaneRichEditor.vue`
- `src/components/BEditor/components/PaneSourceEditor.vue`

并尽量避免复制两套几乎相同但实现细节分叉的逻辑。

## 目标

1. 为 rich/source 两种编辑模式提供统一的选区工具工作流
2. 保留现有富文本交互体验，不回退已修复的失焦、高亮、行号映射逻辑
3. 让源码模式支持：
   - `AI 助手`
   - `插入对话`
4. 在源码模式隐藏加粗、斜体、下划线、删除线、行内代码等格式按钮
5. 将编辑器内核差异收敛在适配器层，而不是散落在工具栏 UI 组件中

## 非目标

1. 本次不为源码模式实现格式按钮
2. 本次不统一 `CurrentBlockMenu`，它仍然只属于富文本模式
3. 本次不重写 rich 模式全部内部实现，只抽离和选区工具工作流直接相关的边界

## 现状问题

### 问题 1：UI 组件直接绑定 Tiptap

`SelectionToolbar.vue` 使用 `BubbleMenu` 驱动显示与定位，天然无法复用到 CodeMirror。

`SelectionAIInput.vue` 也直接使用：

- `editor.view.coordsAtPos()`
- `TextSelection.create()`
- `insertContentAt()`

这些都属于 Tiptap / ProseMirror 特有能力。

### 问题 2：状态编排混在 `RichEditorContent.vue`

`RichEditorContent.vue` 既是渲染容器，又负责：

- 缓存选区
- 同步 AI 高亮
- 响应工具栏事件
- 绑定焦点 / 失焦事件

这使得源码模式要复用交互时，只能复制一份相似逻辑，长期会产生分叉。

### 问题 3：rich/source 对“选区工具”关心的是同一套工作流，不是同一套内核 API

两种模式真正共通的是：

1. 读选区
2. 计算浮层位置
3. 显示或清理高亮
4. 应用 AI 生成内容
5. 插入聊天文件引用

它们不需要共享底层实现，只需要共享统一协议。

### 问题 4：当前存在“粘性高亮”语义，不能只复刻工具栏显隐

现有 rich 模式中，选区高亮不是简单跟随浏览器原生选区，而是由 `RichEditorContent.vue` 的 `syncSelectionHighlight()` 和 `AISelectionHighlight` 装饰共同维护。

关键语义是：

1. blur 后只要真实选区仍在，视觉高亮会继续保留
2. 点击“插入对话”后，高亮不会因为失焦立即清空
3. 高亮清理依赖后续一次编辑器内部 focus / selection 同步，而不是单纯依赖 blur

因此这次适配不能只迁移：

1. 工具栏显隐
2. 面板定位
3. 内容替换

还必须把“粘性高亮生命周期”作为协议与状态机的一部分显式保留。

## 设计结论

采用“选区工具工作流适配器”方案：

1. 将 `SelectionToolbar.vue`、`SelectionAIInput.vue` 改成模式无关的 UI 组件
2. 新增 `SelectionAssistantAdapter` 协议，屏蔽 Tiptap / CodeMirror 差异
3. 新增一层选区工具编排器，统一处理可见性、选区缓存、高亮同步与动作分发
4. rich/source 各自实现自己的 adapter

不推荐单独再做一套 `SourceSelectionToolbar.vue` / `SourceSelectionAIInput.vue`，否则后续修一处交互问题需要维护两套分支。

## 方案概览

### 结构拆分

建议形成以下分层：

1. `SelectionToolbar.vue`
   - 纯 UI
   - 根据能力决定显示哪些按钮
   - 不直接依赖 Tiptap / CodeMirror

2. `SelectionAIInput.vue`
   - 纯交互面板
   - 不直接持有 Tiptap `Editor`
   - 通过 adapter 执行定位、恢复选区、应用内容

3. `useSelectionAssistant`
   - 统一状态编排层
   - 负责选区缓存、浮层显隐、高亮同步、事件收口

4. `richSelectionAssistantAdapter`
   - 负责 Tiptap 相关实现

5. `sourceSelectionAssistantAdapter`
   - 负责 CodeMirror 相关实现

### 工具栏定位策略

工具栏定位不能继续只依赖 rich 模式的 `BubbleMenu`。第一阶段需要明确区分两种宿主模式：

1. rich 模式
   - 继续使用 `BubbleMenu` 负责锚定到选区
   - 但业务层显隐状态由 `useSelectionAssistant` 决定
   - `BubbleMenu` 只作为 rich adapter 的定位实现细节

2. source 模式
   - 不使用 `BubbleMenu`
   - 由源码模式宿主提供一个 `position: relative` 的浮层容器
   - `SelectionToolbar.vue` 以普通绝对定位浮层渲染到该容器内
   - 浮层位置由 source adapter 返回，坐标参考系与 AI 输入面板保持一致

这意味着 `SelectionToolbar.vue` 第一阶段不会再是“永远由 `BubbleMenu` 包裹的组件”，而是会拆成：

1. 纯内容壳层
2. rich 模式专用定位宿主
3. source 模式专用绝对定位宿主

这样可以避免让 source 模式去伪造一套 `BubbleMenu` 行为。

### 工具栏拆分选型

第一阶段明确采用“组件分离”方案，而不是在单组件内混合两套定位分支。

拆分如下：

1. `SelectionToolbarContent.vue`
   - 只负责按钮内容与事件发出
   - 不关心定位实现

2. `RichSelectionToolbarHost.vue`
   - 使用 `BubbleMenu` 承载 `SelectionToolbarContent`
   - 处理 rich 模式的定位与恢复接入

3. `SourceSelectionToolbarHost.vue`
   - 使用绝对定位浮层承载 `SelectionToolbarContent`
   - 处理 source 模式的定位与显隐接入

这样可以把 rich/source 的定位差异限制在 host 层，避免 `SelectionToolbar.vue` 内部出现大量 `positioningMode` 分支。

## 适配器接口

建议新增 `src/components/BEditor/adapters/selectionAssistant.ts`，定义统一协议。

```ts
/**
 * 选区范围信息。
 */
export interface SelectionAssistantRange {
  from: number;
  to: number;
  text: string;
  /** 选区快照生成时的文档版本，用于校验范围是否仍然可信 */
  docVersion?: number;
  /** 可选的快照标识，用于跨阶段追踪同一轮 AI / 引用流程 */
  snapshotId?: string;
}

/**
 * 矩形区域信息。
 */
export interface SelectionAssistantRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * 浮层定位信息。
 */
export interface SelectionAssistantPosition {
  /** 相对当前编辑器浮层容器的锚点矩形，默认基于当前选区末行 */
  anchorRect: SelectionAssistantRect;
  /** 当前选区末行的视觉高度，用于面板与工具栏的纵向间距计算 */
  lineHeight: number;
  /** 可选的容器矩形，供宿主做 viewport clamp 或溢出处理 */
  containerRect?: SelectionAssistantRect;
}

/**
 * 聊天引用上下文。
 */
export interface SelectionReferencePayload {
  id: string;
  ext: string;
  filePath: string;
  fileName: string;
  startLine: number;
  endLine: number;
  renderStartLine: number;
  renderEndLine: number;
}

/**
 * 选区工具能力声明。
 */
export interface SelectionAssistantCapabilities {
  actions: Partial<Record<SelectionToolbarAction, boolean>>;
}

export type SelectionToolbarAction =
  | 'ai'
  | 'reference'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'code';

/**
 * 适配器构建所需的编辑器上下文。
 */
export interface SelectionAssistantContext {
  /** BEditor 自定义文件上下文，类型来自 `src/components/BEditor/types.ts` */
  editorState: EditorState;
  /** 宿主注入的浮层根容器；adapter 返回的所有定位信息都必须相对该容器 */
  overlayRoot: HTMLElement;
}

/**
 * 选区工具适配器协议。
 */
export interface SelectionAssistantAdapter {
  dispose?(): void;
  getCapabilities(): SelectionAssistantCapabilities;
  isEditable(): boolean;
  getSelection(): SelectionAssistantRange | null;
  /** 在 AI 内容应用前恢复缓存选区，不等同于任意时刻覆写当前选区 */
  restoreSelection(range: SelectionAssistantRange): void;
  /** 判断缓存选区是否仍然有效；失效时编排层需阻止应用并提示重新选择 */
  isRangeStillValid?(range: SelectionAssistantRange): boolean;
  /**
   * 清理原生选中态，让视觉层退回到 adapter 的高亮实现。
   * 若未实现，编排层默认不主动清理原生选区，只依赖宿主自身行为。
   */
  clearNativeSelection?(): void;
  /** 供 AI 输入面板使用，锚点默认基于当前选区末行 */
  getPanelPosition(range: SelectionAssistantRange): SelectionAssistantPosition | null;
  /** 供选区工具栏使用，锚点默认基于当前选区首行 */
  getToolbarPosition(range: SelectionAssistantRange): SelectionAssistantPosition | null;
  showSelectionHighlight(range: SelectionAssistantRange): void;
  clearSelectionHighlight(): void;
  /**
   * 允许抛出异常；由编排层统一捕获并决定 UI 反馈。
   * 建议至少区分“可重试”和“不可重试”两类失败。
   */
  applyGeneratedContent(range: SelectionAssistantRange, content: string): Promise<void>;
  buildSelectionReference(range: SelectionAssistantRange): SelectionReferencePayload | null;
  bindSelectionEvents(handlers: {
    onSelectionChange: () => void;
    onFocus: () => void;
    /** 仅供编排层同步高亮与显隐，不承载 rich 模式的 BubbleMenu 恢复策略 */
    onBlur: (event?: FocusEvent) => void;
    onPointerDownInsideEditor?: (event: PointerEvent) => void;
    onPointerDownOutsideEditor?: (event: PointerEvent) => void;
    onEscape?: () => void;
  }): () => void;
}
```

其中：

1. `SelectionAssistantContext.editorState` 由宿主在创建 adapter 时注入，解决文件元数据来源问题
2. `SelectionAssistantContext.overlayRoot` 也由宿主在创建 adapter 时注入
3. `SelectionAssistantPosition.anchorRect` 的坐标参考系固定为 `overlayRoot`
   - `getPanelPosition()` 默认基于当前选区末行计算锚点矩形
   - `getToolbarPosition()` 默认基于当前选区首行计算锚点矩形
4. `dispose()` 用于清理 adapter 内部注册的 CodeMirror 扩展、事件监听或临时高亮资源
5. `actions.ai` 只表达“模式是否支持 AI 工具”，不表达模型服务当前是否可用
6. `bindSelectionEvents()` 返回的解绑函数由编排层持有并调用；实现应保证多次调用解绑也不会出错
7. `applyGeneratedContent()` 允许抛出异常，由编排层统一捕获并反馈给用户
8. `isRangeStillValid()` 命中 `false` 时，编排层必须阻止应用内容并提示用户重新选择
9. 若 adapter 未实现 `isRangeStillValid()`，编排层默认按“仍然有效”处理，但不再保证替换位置绝对安全
10. `SelectionAssistantCapabilities.actions` 中未声明的 action 统一按 `false` 处理

### 定位接口分工

`getPanelPosition()` 与 `getToolbarPosition()` 必须分开定义，不共用一个接口派生。

原因是：

1. Toolbar 默认显示在选区上方，更贴近首行锚点
2. AI 输入面板默认显示在选区下方，更贴近末行锚点
3. rich/source 都需要统一表达这两类不同的定位语义

第一阶段约定如下：

1. `getToolbarPosition()` 供 `RichSelectionToolbarHost.vue` / `SourceSelectionToolbarHost.vue` 使用
2. `getPanelPosition()` 供 `SelectionAIInput.vue` 使用
3. 两者都返回相对 `overlayRoot` 的坐标

### 模型可用性分层

模型可用性不属于 adapter 静态能力，而属于编排层的动态 UI 状态。

建议由 `useSelectionAssistant` 统一管理：

1. 监听 `SERVICE_MODEL_UPDATED_EVENT`
2. 调用 `serviceModelStore.isServiceAvailable('polish')`
3. 暴露 `isModelAvailable`

最终 UI 是否显示 `AI 助手` 按以下规则判断：

1. `adapter.getCapabilities().actions.ai === true`
2. `isModelAvailable === true`

这样可以避免把服务模型状态监听散落到 rich/source 两个 adapter 中。

## 状态编排层

建议新增 `useSelectionAssistant`，集中管理选区工具工作流。

### 状态组织

核心状态必须使用单一状态机，不应只依赖多个布尔值组合。

建议：

```ts
type SelectionAssistantStatus =
  | 'idle'
  | 'toolbar-visible'
  | 'ai-input-visible'
  | 'ai-streaming'
  | 'reference-highlight';
```

其他 UI 字段从状态机派生，例如：

```ts
const toolbarVisible = computed(() => state.value.status === 'toolbar-visible');

const aiInputVisible = computed(() =>
  state.value.status === 'ai-input-visible' ||
  state.value.status === 'ai-streaming'
);
```

这样可以避免出现“工具栏和 AI 面板同时显示”或“没有选区却仍在 streaming”之类的非法组合状态。

### 负责状态

- `status`
- `cachedSelectionRange`
- `toolbarPosition`
- `isModelAvailable`
- `stickyHighlightRange`
- `pendingError`

### 负责行为

1. 监听编辑器选区变化
2. 决定何时显示 / 隐藏工具栏
3. 点击 `AI 助手` 后缓存选区并切换到 AI 面板
4. 点击 `插入对话` 后构造文件引用并发送到聊天
5. 在 AI 面板显示期间持续保留视觉高亮
6. 在“插入对话”后维持粘性高亮，直到编辑器内部重新聚焦并触发新的选区同步
7. 在 AI 流式生成期间锁定按钮状态并保留高亮
8. 在缓存选区失效时阻止替换并提示重新选择
9. 在滚动、窗口尺寸变化、面板展开收起时重新计算 toolbar / panel 位置
10. 在流程结束时统一清理高亮

### 统一状态机

建议按以下状态流转：

1. `idle`
   - 无有效选区
   - 工具栏隐藏
   - AI 面板隐藏

2. `toolbar-visible`
   - 有有效选区
   - 工具栏显示
   - AI 面板隐藏

3. `ai-input-visible`
   - 已缓存选区
   - 工具栏隐藏
   - AI 面板显示
   - 选区通过 adapter 高亮维持

4. `ai-streaming`
   - 已发送 AI 请求
   - AI 面板显示为 loading / 预览态
   - 维持缓存选区与高亮
   - 禁止重复提交与高亮清理

5. `reference-highlight`
   - 已执行“插入对话”
   - 工具栏隐藏或等待下一次交互
   - 不恢复真实选区，只保留视觉高亮
   - 在编辑器内部重新 focus 并触发新的选区同步前，不主动清理高亮

`ai-applied` 不作为持久状态保留，而是一次状态迁移副作用：

1. AI 内容应用成功
2. 立即关闭 AI 面板
3. 触发宿主重新同步当前真实选区
4. 然后直接迁移到 `idle` 或 `toolbar-visible`

最终跳向哪个状态，由同步后的真实选区结果决定。

### AI 取消与错误迁移

1. `ai-streaming` + 用户主动停止
   - 迁移回 `ai-input-visible`
   - 保留当前预览与高亮

2. `ai-streaming` + 请求报错
   - 迁移回 `ai-input-visible`
   - 保留缓存选区与高亮
   - 将错误写入 `pendingError`

3. `ai-streaming` + 内容应用成功
   - 不进入独立持久状态
   - 直接执行 “ai-applied 副作用” 并收敛到 `idle` / `toolbar-visible`

### 粘性高亮约束

这是本次适配必须保留的历史交互，不允许遗漏。

当前 rich 模式的实际链路如下：

1. `SelectionToolbar.vue`
   - 在 blur 后决定工具栏是否重显
   - 在点击编辑器面板内其他非编辑区域时触发 `selection-reference-clear`

2. `RichEditorContent.vue`
   - 在 `selectionUpdate` / `focus` / `blur` 时执行 `syncSelectionHighlight()`
   - 当存在真实选区时，持续把真实选区映射成 `AISelectionHighlight`
   - 只有在 `aiInputVisible === false` 且当前不存在真实选区时，才真正清理高亮

3. `AISelectionHighlight`
   - 作为独立 decoration 层维持视觉高亮
   - 与原生选中态解耦

因此“选中高亮文字后是一直高亮，直到编辑器内重新获取焦点才隐藏”这件事，本质上是：

1. 高亮清理不是由 blur 直接触发
2. `reference-highlight` 必须被视为稳定状态，而不是瞬时动作
3. 重新回到编辑器内部后，要以当前真实选区为准重新收敛高亮

source 模式接入时也需要复刻这套语义：

1. 选区引用插入后，继续保留高亮
2. 点击编辑器外部不立刻清空
3. 重新回到编辑器内部，以当前真实选区为准收敛高亮

### 粘性高亮强制清理条件

除“重新回到编辑器内部并重新同步选区”外，以下情况必须强制清理高亮：

1. 用户按下 `Escape`
2. 当前文件切换
3. 编辑器实例销毁
4. 文档内容变化后 `isRangeStillValid()` 返回 `false`
5. 用户重新选择了新的文本
6. AI 应用成功后且当前不存在真实选区
7. 点击编辑器内部空白区域并产生空选区

## Rich 模式职责

`RichEditorContent.vue` 不再独占整套工作流，而是作为 rich 宿主接入统一编排层。

### Rich adapter 负责

1. 从 Tiptap `Editor` 读取选区
2. 使用 `AISelectionHighlight` 维护视觉高亮
3. 保留现有 `BubbleMenu` 失焦补枪逻辑，并继续作为 rich adapter 内部实现细节维护
4. 使用现有 `sourceLineMapping` 生成源码行号
5. 使用 Tiptap `insertContentAt` 应用 AI 结果

### Rich 模式特别要求

1. 继续支持既有真实源码行号与渲染行号双轨引用
2. 继续保留“点击编辑器面板内其他 UI 时不错误恢复工具栏”的规则
3. 继续隐藏原生选中态，以 `AISelectionHighlight` 作为统一视觉层
4. 继续保留“插入对话后高亮保持粘性，直到编辑器内部重新聚焦后才按真实选区收敛”的行为

### Rich 模式 blur 恢复边界

当前 rich 模式中这部分逻辑非常具体，包含：

1. `suppressRestore` 区分主动隐藏与意外失焦
2. `lastMousedownTarget` 兜底 `relatedTarget === null`
3. 通过编辑器面板 DOM 边界判断是否应恢复
4. 通过 `PluginKey` meta 驱动 `BubbleMenu` 的 `show/hide`

这部分不适合被压平为 adapter 协议中的通用 `onBlur(event)`。

第一阶段明确保留策略如下：

1. `bindSelectionEvents().onBlur` 只用于编排层做高亮同步
2. rich 模式工具栏恢复策略继续保留在 rich adapter / rich 宿主内部
3. rich adapter 不允许绕过编排层直接决定最终 UI 状态；若需要重显工具栏或清理高亮，必须通过编排层提供的回调触发状态迁移
4. 等 source 模式接入后，再评估是否有必要抽出更高阶的 “toolbar restore policy”

## Source 模式职责

`PaneSourceEditor.vue` 作为源码模式宿主，接入同一编排层，但只暴露受支持能力。

### Source adapter 负责

1. 从 CodeMirror `EditorView.state.selection.main` 读取选区
2. 用 CodeMirror `StateField + Decoration.mark()` 实现选区高亮维持
3. 用 `coordsAtPos()` 或等效坐标能力计算 AI 面板位置
4. 通过 `dispatch({ changes })` 应用 AI 结果
5. 基于源码字符串直接计算 `startLine/endLine`

### Pointer 事件用途

`onPointerDownInsideEditor` / `onPointerDownOutsideEditor` 的主要用途是统一以下场景：

1. 判断点击是否发生在编辑器内部但编辑器 DOM 外部的宿主 UI
2. 在 source 模式中复刻 rich 模式“编辑器面板内其他区域”语义
3. 为粘性高亮清理、工具栏收起和定位重算提供补充信号

### Source 模式能力声明

```ts
{
  actions: {
    ai: true,
    reference: true,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    code: false
  }
}
```

因此 `SelectionToolbar.vue` 在源码模式只显示：

- `AI 助手`
- `插入对话`

不显示格式按钮。

## 关于工具栏显示机制

这是这次设计中的关键点。

### 现有 rich 模式问题

rich 模式当前依赖 `BubbleMenu` 自动完成：

- 选区变化后的显示
- 基于选区的定位
- blur 后的隐藏

而 source 模式没有对应内置机制。

### 设计建议

不要让 source 模式去“适配 BubbleMenu”，而要把“何时显示工具栏”的决定权上提到统一编排层。

建议分两步走：

1. 第一阶段保留 rich 的 `BubbleMenu` 定位能力，但由统一编排层控制业务状态
2. 第二阶段若 rich/source 行为仍存在过多差异，再考虑把 rich 工具栏完全脱离 `BubbleMenu`

这样可以降低首轮改造风险。

## 滚动与定位规则

1. adapter 返回的位置必须始终相对 `overlayRoot`
2. `overlayRoot` 由 rich/source 宿主在构造 adapter 时共同注入，且必须是 `position: relative` 容器
3. `recomputePosition` 由编排层负责调度，不由 adapter 隐式自发完成
4. adapter 只负责“给定当前 range，返回最新位置”
5. 宿主需要在以下时机通知编排层重算位置：
   - 编辑器滚动
   - 选区变化
   - 面板展开收起
   - 窗口尺寸变化
6. source 模式选择到最后一行或多行选区时，panel 定位仍以末行锚点为准；toolbar 定位以首行锚点为准

## 文件引用策略

### Rich 模式

继续沿用当前逻辑：

- 优先使用 `getSelectionSourceLineRangeFromMarkdown()`
- 回退到 `getSelectionSourceLineRange()`
- 同时带出 `renderStartLine` / `renderEndLine`
- 行号基准包含 front matter 在内的完整文件物理行号

### Source 模式

源码模式不需要经过渲染态映射，直接基于源码文本计算：

- `startLine`
- `endLine`
- `renderStartLine`
- `renderEndLine`

在 source 模式中，这两组值可以一致。

### Front Matter 行号约定

source 模式的行号计算以完整文件内容为准，不跳过 front matter。

也就是说：

1. `startLine/endLine` 以文件物理行号计数
2. 若文件首部存在 front matter，则 front matter 本身占用行号
3. `renderStartLine/renderEndLine` 在 source 模式下与上述值保持一致

这样可以与文件引用协议的“面向原文件定位”语义保持一致，也与 rich 模式中的真实源码行号基准保持对齐。

## 迁移步骤

### 第 1 步：抽类型

新增：

- `src/components/BEditor/adapters/selectionAssistant.ts`

定义：

- 选区范围
- 工具能力
- 引用载荷
- adapter 协议

### 第 2 步：抽编排层

新增：

- `src/components/BEditor/hooks/useSelectionAssistant.ts`

把当前散落在 `RichEditorContent.vue` 中的：

- 单一状态机
- 选区缓存
- AI 显隐
- 高亮同步
- 事件分发
- 模型可用性监听
- range 有效性校验

统一抽到 hook。

### 第 3 步：改造 UI 组件

改造：

- `src/components/BEditor/components/SelectionToolbar.vue`
- `src/components/BEditor/components/SelectionAIInput.vue`

要求它们只消费：

- adapter
- 编排状态
- 能力声明

不直接依赖 Tiptap API。

其中 `SelectionToolbar.vue` 需要拆成“内容层 + 定位宿主层”：

1. `SelectionToolbarContent.vue`
2. `RichSelectionToolbarHost.vue`
3. `SourceSelectionToolbarHost.vue`

### 第 4 步：接入 rich adapter

在 rich 模式中先完成“包一层旧能力”的无行为回归改造，尽量少动现有宿主逻辑，确保：

- AI 流程不变
- 插入对话不变
- 行号逻辑不变
- 高亮逻辑不变
- blur 恢复与编排层状态不打架

### 第 5 步：接入 source adapter

在 `PaneSourceEditor.vue` 中补齐：

- 选区监听
- 高亮
- AI 面板定位
- 工具栏绝对定位
- 文件引用插入

### 第 6 步：回归验证

至少验证以下场景：

1. rich/source 选中文本后都能显示选区工具
2. rich/source 点击 `AI 助手` 后都能看到原选区高亮
3. rich/source 应用 AI 内容后都能正确替换原选区
4. rich/source 点击 `插入对话` 后都能插入正确文件引用
5. source 模式不显示格式按钮
6. rich 模式既有失焦恢复逻辑不回退
7. rich/source 都保留“插入对话后高亮粘住，直到编辑器内部重新聚焦才收敛”的行为
8. rich 模式 AI 流式生成期间，按钮禁用与高亮保持行为不回退
9. AI 面板打开后滚动编辑器，面板位置仍正确
10. AI 面板打开后修改文档，过期 range 会阻止应用并提示重新选择
11. source 模式多行选区与最后一行选区定位正确
12. rich/source 切换模式或切换文件后旧高亮被清理
13. 只读状态下工具入口按能力隐藏或禁用
14. 模型不可用时 AI 动作隐藏或禁用
15. 编辑器销毁后事件监听与 decoration 均被清理
16. 窗口缩放后 toolbar 与 AI 面板重新定位仍正确

## 风险与取舍

### 风险 1：rich 模式仍然部分依赖 `BubbleMenu`

短期内这不是问题，因为它能降低迁移成本。  
但需要明确，`BubbleMenu` 只是 rich adapter 的实现细节，不应继续泄漏到公共 UI 组件层。

### 风险 2：source 模式高亮实现与 rich 模式视觉不完全一致

这是可接受的阶段性差异。目标是交互语义一致，而不是底层实现强行统一。

但“粘性高亮持续到编辑器内部重新聚焦再收敛”的语义不是可放弃差异，必须保持一致。

### 风险 3：AI 面板定位在不同编辑器中的滚动容器行为不同

因此 `getPanelPosition()` 必须成为 adapter 职责，不能再放在公共组件里自行猜测。

### 风险 4：模型状态动态变化时的 AI 面板处置

当 `isModelAvailable` 从 `true` 变为 `false` 时：

1. 不强制关闭已打开的 AI 面板
2. 但禁止新的提交动作，并向用户显示当前模型不可用
3. 已在进行中的流式请求按既有链路完成或失败

## 最终决策

采用统一的 `SelectionAssistantAdapter + useSelectionAssistant` 方案。第一阶段保留 rich 模式现有 `BubbleMenu` 与高亮实现，通过 rich adapter 包装旧能力；source 模式通过 CodeMirror adapter 接入统一工作流。公共 UI 只消费能力声明与编排状态，不直接依赖 Tiptap / CodeMirror。粘性高亮、range 有效性、浮层定位、模型可用性和事件解绑必须作为一等约束处理。

具体原则如下：

1. UI 层只关心“显示什么”和“触发什么动作”
2. 编排层只关心“当前选区工具处于什么状态”
3. adapter 层负责“如何从具体编辑器内核完成这些动作”
4. rich 模式保留现有完整能力
5. source 模式本次只开放 `AI 助手` 与 `插入对话`

该方案可以在保留历史交互契约的前提下，把选区工具能力从富文本专属实现演进为 BEditor 的跨模式基础设施。
