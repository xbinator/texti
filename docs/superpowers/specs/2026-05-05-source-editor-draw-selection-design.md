# Source 编辑器自定义 Selection 绘制设计

## 背景

`PaneSourceEditor.vue` 使用 CodeMirror 6 渲染 Markdown 源码。当前 selection（用户选中文本的蓝色高亮）完全由 CodeMirror 内置机制 + 浏览器原生 `::selection` 伪元素 + `.cm-selectionBackground` CSS 类完成。

这套默认机制存在几个问题：

1. **视觉与系统 selection 强绑定**：浏览器原生 selection 绘制在 CodeMirror DOM 结构上，样式控制粒度有限
2. **无法统一管理视觉层**：现有的 AI 选区高亮（`sourceSelectionHighlightExtension`）走独立 decoration 路径，与系统 selection 是两套互不相知的视觉栈
3. **`clearNativeSelection` 能力受限**：`sourceSelectionAssistant.ts:123` 中 `clearNativeSelection()` 目前是空操作，因为无法在不影响系统复制能力的前提下清理原生 selection 视觉

自定义 selection 绘制是为了让 **用户的普通选区** 也走 decoration 渲染路径，与 AI 选区高亮统一到同一视觉层面，从而获得一致的样式控制能力和更灵活的交互语义。

## 目标

1. 用 `ViewPlugin` + `Decoration.mark()` 替代 CodeMirror 原生 selection 的**视觉渲染**
2. 保留浏览器原生 selection 的复制能力（`document.getSelection()` 不受影响）
3. 自定义 selection 样式与现有 `.cm-selectionBackground` / `::selection` 视觉保持一致
4. 与 AI 选区高亮（`.source-ai-selection-highlight`）统一到同一装饰层体系
5. 为 `clearNativeSelection()` 提供可立即生效的**视觉关闭路径**，允许在保留真实选区的前提下临时隐藏普通 selection 装饰

## 非目标

1. 不改动 CodeMirror 光标（`.cm-cursor`）渲染
2. 不改动搜索高亮（`.search-match` / `.search-match-current`）
3. 不改动 AI 选区高亮扩展本身
4. 不修改 `SelectionAssistantAdapter` 协议
5. 不影响 rich（富文本）模式的任何行为

## 现状分析

### 当前 Extension 链（`PaneSourceEditor.vue:115-141`）

```
history → markdown → markdownHighlight → codeBlockHighlight → search →
keymap → layoutTheme → headingAnchor → placeholder → lineWrapping →
contentAttributes → editable → updateListener → selectionHighlight
```

其中 `selectionHighlight` 即 `createSourceSelectionHighlightExtension()`（`sourceSelectionAssistant.ts:294`），用于 AI 选区高亮，由 `StateField` + `highlightRangeEffect` + `Decoration.mark()` 实现。

### 当前 Selection 渲染路径

| 组件 | 作用 | 渲染方式 |
|------|------|---------|
| 系统 selection | 用户普通选中文本 | 浏览器 `::selection` + `.cm-selectionBackground` CSS |
| AI 高亮 | AI 工具栏/面板打开期间的选区高亮 | `StateField` + `Decoration.mark(.source-ai-selection-highlight)` |
| 搜索匹配 | 查找匹配项 | 搜索扩展的 decoration set |

### 核心代码路径

- **`sourceSelectionAssistant.ts:27-41`** — `highlightRangeField`（AI 高亮状态字段）和 `highlightRangeEffect`（高亮状态变更）
- **`sourceSelectionAssistant.ts:294-308`** — `createSourceSelectionHighlightExtension`，绑定 `StateField` 和 `decorations.compute`
- **`PaneSourceEditor.vue:550-556`** — `.source-ai-selection-highlight` CSS
- **`PaneSourceEditor.vue:524-531`** — `.cm-selectionBackground` 和 `::selection` CSS（当前系统 selection 样式）

## 方案设计

### 总体思路

新增一个 `ViewPlugin`，在每次 selection 变化时同步计算 decoration set，用 `Decoration.mark()` 渲染选中范围。同时把 selection 相关样式收口到 `EditorView.theme()`，在扩展内部覆盖 CodeMirror 原生 `.cm-selectionBackground` 和编辑器内部 `::selection` 的视觉，让 decoration 成为唯一可见的 selection 表示。

### 架构位置

```
history → markdown → markdownHighlight → codeBlockHighlight → search →
keymap → layoutTheme → headingAnchor → placeholder → lineWrapping →
contentAttributes → editable → updateListener →
★★ drawSelectionExtension ★★ → selectionHighlight
```

自定义 selection 放在 `updateListener` 之后、`selectionHighlight`（AI 高亮）之前。

### 技术选型：ViewPlugin vs StateField

| 方案 | 优点 | 缺点 |
|------|------|------|
| `StateField` + `decorations.compute` | 与 AI 高亮模式一致，状态可序列化 | 需要引入额外字段保存“当前普通选区装饰集合”，与真实 selection 形成两套状态 |
| `ViewPlugin.fromClass` | 直接基于 `ViewUpdate.selectionSet` / `docChanged` 重算装饰，逻辑贴近“视图派生状态” | 需要单独处理“临时隐藏普通 selection”这类额外视觉状态 |

**选择 `ViewPlugin.fromClass`**：

1. CodeMirror 的 selection 本身存在于 `EditorState`，`StateField` 和 `ViewPlugin` 都能实现该需求，因此选型依据应是**复杂度**而不是能力缺失
2. 普通 selection 装饰本质上是 `view.state.selection` 的派生视觉状态，`ViewPlugin` 更贴近这种“随 view update 重算”的模型
3. `ViewUpdate.selectionSet` 与 `docChanged` 已覆盖本方案所需的两个核心触发条件：选区变化和文档变更后的坐标刷新
4. AI 高亮已经使用 `StateField` 保存“业务态高亮范围”，普通 selection 若继续放入 `StateField`，会引入第二套非业务持久状态；`ViewPlugin` 更轻量

### `clearNativeSelection()` / 恢复链路的补充设计

仅用“selection -> decoration”一对一映射，仍然无法在保留真实选区的同时关闭普通 selection 视觉，因此这里补一个**显式 suppression 开关**：

```typescript
import { StateEffect } from '@codemirror/state'

const setSelectionDrawSuppressedEffect = StateEffect.define<boolean>()
```

建议同时导出两个辅助函数，供 source adapter 直接调用：

```typescript
function suppressSourceEditorSelectionDraw(view: EditorView): void {
  view.dispatch({
    effects: setSelectionDrawSuppressedEffect.of(true)
  })
}

function restoreSourceEditorSelectionDraw(view: EditorView): void {
  view.dispatch({
    effects: setSelectionDrawSuppressedEffect.of(false)
  })
}
```

`ViewPlugin` 内部维护 `suppressed` 布尔值：

1. 默认 `false`
2. 收到 `setSelectionDrawSuppressedEffect.of(true)` 时，立即隐藏 `.cm-custom-selection`
3. 收到 `setSelectionDrawSuppressedEffect.of(false)` 时，恢复按当前 selection 绘制
4. 当用户产生下一次真实 selection 变化（`update.selectionSet === true`）且存在非空 range 时，自动复位为 `false`

这样 `clearNativeSelection()` 就不再是空操作，而是：

- 保留 `view.state.selection` 和浏览器复制能力
- 只关闭“普通 selection 的自定义视觉层”
- 让 AI 高亮成为面板打开期间唯一可见的选区视觉
- 让 AI 面板关闭、取消或清理时有明确的普通 selection 恢复入口

### ViewPlugin 设计

```typescript
import { StateEffect, type EditorState } from '@codemirror/state'
import { ViewPlugin, ViewUpdate, Decoration, DecorationSet, EditorView } from '@codemirror/view'

const SELECTION_CLASS = 'cm-custom-selection'
const setSelectionDrawSuppressedEffect = StateEffect.define<boolean>()

/**
 * 判断当前 state 是否存在非空选区。
 */
function hasNonEmptySelection(state: EditorState): boolean {
  return state.selection.ranges.some((range) => !range.empty)
}

/**
 * 根据当前 view 的 selection 状态计算 decoration set。
 */
function computeSelectionDecorations(view: EditorView): DecorationSet {
  const decorations = [...view.state.selection.ranges]
    .filter((range) => !range.empty)
    .sort((left, right) => left.from - right.from)
    .map((range) => Decoration.mark({ class: SELECTION_CLASS }).range(range.from, range.to))

  if (decorations.length === 0) {
    return Decoration.none
  }
  return Decoration.set(decorations)
}

const customSelectionPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    suppressed: boolean

    constructor(view: EditorView) {
      this.suppressed = false
      this.decorations = computeSelectionDecorations(view)
    }

    update(update: ViewUpdate): void {
      let suppressionChanged = false

      for (const transaction of update.transactions) {
        for (const effect of transaction.effects) {
          if (effect.is(setSelectionDrawSuppressedEffect)) {
            // 仅在值实际变化时标记变更，避免重复 suppress 触发无意义重算
            if (this.suppressed !== effect.value) {
              this.suppressed = effect.value
              suppressionChanged = true
            }
          }
        }
      }

      // 自动复位：用户产生新的真实非空选区时，退出 suppression
      // 注意：suppression effect 不应与 selection 变化在同一 transaction 中 dispatch，
      // 否则会出现"suppress → 立即被自动复位"的竞争。当前代码路径中
      // clearNativeSelection 和 showSelectionHighlight 是分开 dispatch 的，不会同帧合并。
      if (update.selectionSet && hasNonEmptySelection(update.state)) {
        this.suppressed = false
      }

      if (suppressionChanged || update.selectionSet || update.docChanged) {
        this.decorations = this.suppressed ? Decoration.none : computeSelectionDecorations(update.view)
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations
  }
)
```

### 与 AI 高亮的叠加逻辑

CodeMirror 中多个 decoration set 按顺序叠加到同一 DOM 节点上：

1. **自定义 selection**（`cm-custom-selection`）先渲染
2. **AI 高亮**（`source-ai-selection-highlight`）后渲染

当 AI 面板打开时，普通 selection decoration 会先被 suppression 关闭，因此用户仍然保留真实选区，但视觉上只显示 AI 高亮。当 AI 面板关闭后，应先 `clearSelectionHighlight()` 清除 AI 高亮，再显式调用 `restoreSourceEditorSelectionDraw(view)` 恢复普通 selection 绘制；如果真实选区已不存在，则恢复后仍然不会显示普通 selection。这是**期望行为**。

### Theme 方案

建议把样式直接收口到 `sourceEditorDrawSelection.ts` 内的 `EditorView.theme()`，避免后续受 Vue 样式作用域、宿主层级或组件重构影响：

```typescript
const customSelectionTheme = EditorView.theme({
  '& .cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'transparent !important',
    color: 'inherit !important'
  },
  // ::selection 伪元素在部分浏览器（尤其 Firefox）中对 background 简写属性支持有限，
  // 必须使用 backgroundColor 长写才能可靠覆盖
  '& .cm-content ::selection, & .cm-line::selection, & .cm-line *::selection': {
    backgroundColor: 'transparent !important',
    color: 'inherit !important'
  },

  '& .cm-custom-selection': {
    background: 'var(--selection-bg)',
    boxShadow: '0 0.2em 0 0 var(--selection-bg), 0 -0.2em 0 0 var(--selection-bg)',
    WebkitBoxDecorationBreak: 'clone',
    boxDecorationBreak: 'clone'
  }
})
```

**关键点**：
- 需要同时覆盖 `.cm-selectionBackground` 和 source 编辑器内部的 `::selection`，否则会出现"原生 selection + decoration 双层高亮"
- `::selection` 规则在部分浏览器（尤其 Firefox）中对 `background` 简写属性支持不可靠，必须使用 `backgroundColor` 长写，且 Chrome/Firefox 均需实测验证原生 selection 视觉是否被完全隐藏
- 样式跟随扩展一起注册，避免散落在 `PaneSourceEditor.vue` 中
- 使用 `backgroundColor: transparent !important` 隐藏原生 selection 视觉
- 使用 `color: inherit !important` 防止原生 selection 改变文字颜色
- 默认只强制背景，不强制覆盖文本颜色；这样可保留 Markdown 语法高亮文字色
- 如果产品最终要求"完全模拟系统蓝底白字"，再单独补 `& .cm-custom-selection, & .cm-custom-selection * { color: var(--selection-color) !important }`
- 自定义 selection 复用与 AI 高亮一致的 `box-shadow` / `box-decoration-break`，保证跨行与软换行场景的视觉连续性

### 多选区的处理

CodeMirror 通过 `Ctrl/Cmd + 点击` 或 `Ctrl/Cmd + 拖拽` 支持多选区（`EditorSelection.ranges`）。自定义 selection 需要覆盖所有 range：

```typescript
function computeSelectionDecorations(view: EditorView): DecorationSet {
  const ranges = [...view.state.selection.ranges].sort((left, right) => left.from - right.from)
  const decorations = ranges
    .filter((r) => !r.empty)
    .map((r) => Decoration.mark({ class: SELECTION_CLASS }).range(r.from, r.to))

  if (decorations.length === 0) {
    return Decoration.none
  }
  return Decoration.set(decorations)
}
```

需要注意两点：

1. `Decoration.set()` 依赖 range 按 `from` 升序排列，因此示例中必须显式排序
2. 本方案只保证**普通 selection 的视觉层**支持多选区；当前 source adapter 的 AI、高亮定位、引用构造、内容替换等业务链路仍以 `selection.main` 为准

## 文件改动清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/components/BEditor/adapters/sourceEditorDrawSelection.ts` | **新增** | 自定义 selection 绘制扩展、suppression effect、theme |
| `src/components/BEditor/adapters/sourceSelectionAssistant.ts` | **修改** | `clearNativeSelection()` 改为 suppress draw，`clearSelectionHighlight()` 在 source 模式下同时恢复普通 selection 绘制 |
| `src/components/BEditor/components/PaneSourceEditor.vue` | **修改** | 在 `createEditorExtensions()` 中引入新扩展 |

### PaneSourceEditor.vue 改动点

#### JS 侧

```typescript
// 新增 import
import { createSourceEditorDrawSelectionExtension } from '../adapters/sourceEditorDrawSelection'

// 在 createEditorExtensions() 中，updateListener 之后、selectionHighlight 之前插入
function createEditorExtensions(): Extension[] {
  return [
    history(),
    markdown(),
    createSourceEditorMarkdownHighlightExtension(),
    createSourceCodeBlockHighlightExtension(),
    createSourceEditorSearchExtension(),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
    createSourceEditorLayoutTheme(),
    headingAnchorCompartment.of(createSourceHeadingAnchorExtension(props.editorId)),
    placeholder('请输入内容'),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ spellcheck: 'false' }),
    editableCompartment.of(createEditableExtension(props.editable)),
    EditorView.updateListener.of((update: ViewUpdate): void => {
      if (!update.docChanged) {
        return
      }
      const nextContent = update.state.doc.toString()
      if (nextContent !== editorContent.value) {
        editorContent.value = nextContent
      }
    }),
    createSourceEditorDrawSelectionExtension(),   // ★ 新增
    createSourceSelectionHighlightExtension()
  ]
}
```

#### `sourceSelectionAssistant.ts` 侧

```typescript
import {
  restoreSourceEditorSelectionDraw,
  suppressSourceEditorSelectionDraw
} from './sourceEditorDrawSelection'

clearNativeSelection(): void {
  suppressSourceEditorSelectionDraw(view)
}

clearSelectionHighlight(): void {
  view.dispatch({
    effects: highlightRangeEffect.of(null)
  })
  restoreSourceEditorSelectionDraw(view)
}
```

#### `useSelectionAssistant` 协调侧

```typescript
function openAIInput(): void {
  adapter.clearNativeSelection?.()
  adapter.showSelectionHighlight(range)
}

function closeAIInput(): void {
  adapter.clearSelectionHighlight()
}
```

当前设计保持 **不修改 `SelectionAssistantAdapter` 协议** 这个非目标，因此恢复路径收口到 source adapter 的 `clearSelectionHighlight()` 内部实现。代价是“AI 高亮清理”和“普通 selection 恢复”在 source 模式下发生轻度耦合，但它能避免协议扩散，并与现有 `useSelectionAssistant` 调用链兼容。

**重要说明**：`clearSelectionHighlight()` 在 source adapter 中额外触发了普通 selection 绘制恢复，这属于 **source adapter 的局部实现行为**，不属于 adapter 协议语义。其他 adapter 实现（如未来的 rich adapter 重构版）无需在 `clearSelectionHighlight()` 中附加 selection 恢复逻辑；若有需要，应由各自 adapter 内部自行决定。
#### Theme 侧

## 与现有功能的交互验证

### 1. 与系统复制（Ctrl+C）的兼容性

- 自定义 selection 会同时中和 CodeMirror 内部 `.cm-selectionBackground` 与 source 编辑器局部 `::selection` 的视觉层
- `::selection` 覆盖严格限制在 source 编辑器作用域内，不影响编辑器外文本
- `document.getSelection()` 不受影响，复制行为正常

### 2. 与 AI 选区高亮的共存

| 场景 | 自定义 selection | AI 高亮 | 视觉结果 |
|------|:--:|:--:|------|
| 普通选中 | ✅ 显示 | ❌ 隐藏 | 自定义 selection 可见 |
| AI 面板打开 | 真实选区仍保留，但普通 decoration 被 suppression 关闭 | ✅ 显示 | 仅 AI 高亮可见 |
| AI 面板关闭 | 由 `restoreSourceEditorSelectionDraw(view)` 恢复；若真实选区仍存在则显示 | ❌ 隐藏 | 回到自定义 selection |
| 引用后粘性高亮 | 跟随真实选区 | ✅ 显示 | 粘性高亮可见 |

### 3. 与搜索高亮的共存

搜索高亮（`.search-match`）是另一个独立的 decoration set，不受影响。当搜索匹配与 selection 重叠时，两个 decoration class 会同时作用在 DOM 元素上，视觉为叠加效果（搜索高亮背景色 + selection 文字色）。

### 4. 与光标（cursor）的关系

光标（`.cm-cursor`）由 CodeMirror 核心独立渲染，不经过 decoration 层，不受此改动影响。

### 5. 与 `clearNativeSelection()` 的关系

`sourceSelectionAssistant.ts:123` 的 `clearNativeSelection()` 当前是空操作。实现自定义 selection 后：

- `clearNativeSelection()` 应改为 dispatch `setSelectionDrawSuppressedEffect.of(true)`，仅关闭普通 selection 的 decoration 视觉
- `showSelectionHighlight()` 继续负责显示 `.source-ai-selection-highlight`
- `closeAIInput()` / `clearAll()` / AI 取消时需要显式 dispatch `setSelectionDrawSuppressedEffect.of(false)`，恢复普通 selection 绘制
- 当用户产生下一次真实非空选区时，`ViewPlugin` 自动把 suppression 复位为 `false`
- 因此该方法不再依赖“把真实选区改成光标态”来实现视觉清理

### 6. 与只读模式（`editable: false`）的关系

只读模式下 CodeMirror 仍然允许 selection（用于复制文本），自定义 selection 继续正常工作。

## 风险与边界

### 风险 1：原生 selection 样式泄漏

- `.cm-selectionBackground` 与 `::selection` 规则应收口在 `EditorView.theme()` 中，跟随该扩展实例生效，不影响其他 CodeMirror 实例
- 如果只隐藏 `.cm-selectionBackground` 而不处理中和后的 `::selection`，会留下原生高亮，形成双层视觉

### 风险 2：移动端选择行为差异

- 移动端浏览器对 selection 的渲染与桌面端不同
- 自定义 decoration 方案在移动端同样有效（decoration 是 DOM class 叠加，不依赖平台特性）
- 但移动端长按选词的视觉反馈可能略有差异，需要实际测试

### 风险 3：RTL（从右到左）文本

- `Decoration.mark()` 基于文档 offset 而非视觉方向，RTL 文本不受影响
- 但 `cm-custom-selection` 的 CSS 不需要特殊处理 RTL，CodeMirror 会自行处理 DOM 方向

### 风险 4：性能

- 每次 selection 变化或文档变化时，`computeSelectionDecorations()` 会被调用
- 操作复杂度：O(n) 其中 n 是 selection ranges 数量（通常 1-5 个）
- ViewPlugin 的 decoration set 仅当实际变化时才触发 DOM 更新
- 性能影响可忽略不计

### 边界情况

1. **跨行 / 软换行 selection**：`Decoration.mark()` 支持跨行；配合 `box-shadow` 和 `box-decoration-break: clone` 后，视觉连续性与现有 AI 高亮保持一致
2. **空行与行尾空白**：`Decoration.mark()` 只包裹真实文本内容，不保证像系统 selection 或矩形层那样填满空行、换行符和行尾空白区域；这属于第一版方案的已知视觉边界
3. **零宽度选区（光标）**：`selection.empty === true`，返回 `Decoration.none`，无视觉影响
4. **undo/redo 后的 selection**：`ViewUpdate.selectionSet` 会正确触发
5. **程序化修改文档时的 selection**：`update.docChanged` 会触发刷新；若此时处于 `suppressed = true`，仍保持 `Decoration.none`，这是刻意行为而非遗漏
6. **编辑器销毁时**：ViewPlugin 随 EditorView 一起销毁，无需手动清理

## 与 AI 选区工具栏的协调

当前 AI 选区工具工作流（`useSelectionAssistant`）中有以下关键时机涉及 selection：

| 时机 | 操作 | 对自定义 selection 的影响 |
|------|------|--------------------------|
| `handleSelectionChange` | 读选区、存缓存 | 自定义 selection 正常跟随 |
| `openAIInput` | 调用 `clearNativeSelection?.()` 然后 `showSelectionHighlight` | 普通 selection decoration 被 suppression 关闭，仅保留 AI 高亮 |
| `closeAIInput` | 清理 AI 高亮并恢复普通 selection 绘制 | 若真实选区仍存在，自定义 selection 立即恢复 |
| `applyAIResult` | 替换内容后 `clearSelectionHighlight` + 恢复普通 selection 绘制 | AI 高亮消失；若替换后仍保留非空真实选区，则自定义 selection 恢复，否则回到光标态 |
| `insertReference` | 保留高亮，进粘性状态 | 此时 suppression 仍为 `true`（由 `openAIInput` 设置），普通 selection decoration 不可见；仅 `.source-ai-selection-highlight`（粘性高亮）可见 |
| `clearAll` | 清除所有状态和高亮，并恢复普通 selection 绘制 | AI 高亮消失；若真实选区仍存在，自定义 selection 可再次显示 |

## 测试计划

### 手动测试场景

| # | 场景 | 操作步骤 | 预期结果 |
|---|------|---------|---------|
| 1 | 普通文本选择 | 鼠标拖拽选中连续文本 | `.cm-custom-selection` 装饰覆盖选中区域，视觉与原 selection 一致；原生 `.cm-selectionBackground` 不可见 |
| 2 | 跨行选择 | 鼠标拖拽，从某行中间跨越到下一行末尾 | `.cm-custom-selection` 正确覆盖两行之间的所有文本 |
| 3 | 多选区 | `Ctrl/Cmd + 鼠标拖拽` 选中多处不连续文本 | 每处选中的文本都独立被 `.cm-custom-selection` 覆盖 |
| 4 | 与 AI 高亮切换 | 选中文本 → 点击 `AI 助手` → 观察选区视觉 | AI 面板打开后，普通 selection decoration 被关闭，仅 `.source-ai-selection-highlight` 可见，不出现双层高亮 |
| 5 | AI 面板关闭后恢复 | AI 面板打开期间 → 关闭面板 | `.source-ai-selection-highlight` 消失；若真实选区仍存在，则 `.cm-custom-selection` 恢复可见 |
| 6 | 搜索高亮共存 | 选中一段文本 → 执行搜索（如 `Ctrl+F` 搜索选中词） | `.search-match` 高亮与 `.cm-custom-selection` 同时可见，重叠区域为叠加效果 |
| 7 | 复制行为 | 选中文本 → `Ctrl+C` → 粘贴到其他位置 | 复制内容完整正确，不受隐藏原生 selection 视觉的影响 |
| 8 | 撤销后的 selection | 选中文本 → 输入内容覆盖 → `Ctrl+Z` 撤销 | 撤销后光标位置正确，如恢复出 selection 则 `.cm-custom-selection` 正常渲染 |
| 9 | 重做后的 selection | `Ctrl+Z` 撤销后 → `Ctrl+Shift+Z` 重做 | 重做后光标/selection 位置正确 |
| 10 | 零宽度选区（光标） | 单击编辑器任意位置 | 无 selection 装饰，光标正常闪烁 |
| 11 | 全选 | `Ctrl+A` | 全文被 `.cm-custom-selection` 覆盖 |
| 12 | 只读模式选择 | `editable: false` 时鼠标拖选 | 仍可选中文本（用于复制），`.cm-custom-selection` 正常渲染 |
| 13 | 窗口缩放 | 选中文本后缩放浏览器窗口 | selection 视觉保持选中状态 |
| 14 | 编辑器滚动 | 选中文本后滚动编辑器 | selection 视觉跟随文档内容，不偏移 |
| 21 | effect 单独触发 | 选中文本后只 dispatch suppression effect | `.cm-custom-selection` 立即消失，不需要额外 selection / doc 变化 |
| 22 | AI 关闭后恢复 | 选中 → 打开 AI → 关闭 AI | AI 高亮消失，普通 selection 恢复 |
| 23 | 包含空行 selection | 选中包含空行的多行文本 | 明确空行与行尾空白不要求被完全填满，只保证文本内容范围高亮 |
| 24 | 语法高亮文字颜色 | 选中标题、链接、代码片段 | 默认保留 token 原有文字颜色，仅背景统一；若产品改为蓝底白字，再单独调整 theme |

### 交互验证场景（需结合 AI 选区工具栏）

| # | 场景 | 操作步骤 | 预期结果 |
|---|------|---------|---------|
| 15 | 选中 → AI 助手 → 输入 → 应用 | 选中文本 → 点 AI 助手 → 等待生成 → 点应用 | 应用后内容替换正确；若最终为光标态则无普通 selection，若仍保留非空选区则 `.cm-custom-selection` 按真实选区恢复 |
| 16 | 选中 → 插入对话 → 失焦 → 重新聚焦 | 选中文本 → 点插入对话 → 点击编辑器外部 → 重新点击编辑器 | 粘性高亮保留到下次真实选区同步，自定义 selection 跟随新选区 |

### 回归验证

| # | 场景 | 预期结果 |
|---|------|---------|
| 17 | rich 模式选区和 AI 工具栏 | 不受影响，行为与改动前一致 |
| 18 | Markdown 语法高亮 | 不受影响 |
| 19 | 代码块高亮 | 不受影响 |
| 20 | 标题锚点导航 | 不受影响 |

## 最终决策

采用 **ViewPlugin + Decoration.mark + suppression effect** 方案，新增 `createSourceEditorDrawSelectionExtension()`，在 `PaneSourceEditor.vue` 中接入。样式收口到 `EditorView.theme()`（而非散落在 Vue 组件 CSS 中），在扩展内部覆盖原生 `.cm-selectionBackground` 和 source 编辑器局部 `::selection` 的视觉，用 `backgroundColor: transparent !important` 替代 `background` 简写以保证跨浏览器兼容性。

该方案：
- 不改动任何现有协议或接口
- 不改变 AI 选区工具的行为
- 保留系统复制能力
- 支持多选区
- 为 `clearNativeSelection()` 提供真实可用的视觉关闭路径
- 对现有代码的侵入性仍然较低（新增一个扩展文件，并修改 source adapter + `PaneSourceEditor.vue`）
