# Source 编辑器自定义 Selection 绘制 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 ViewPlugin + Decoration.mark() 替代 CodeMirror 原生 selection 的视觉渲染，统一普通选区与 AI 高亮到同一装饰层体系。

**Architecture:** 新增 `sourceEditorDrawSelection.ts` 扩展文件，包含 ViewPlugin、suppression StateEffect、EditorView.theme。修改 `sourceSelectionAssistant.ts` 的 `clearNativeSelection()` 和 `clearSelectionHighlight()` 以接入 suppression 机制。修改 `PaneSourceEditor.vue` 引入新扩展并清理冲突的 CSS 规则。

**Tech Stack:** CodeMirror 6 (ViewPlugin, Decoration, StateEffect, EditorView.theme), TypeScript

---

### Task 1: 新建 sourceEditorDrawSelection.ts

**Files:**
- Create: `src/components/BEditor/adapters/sourceEditorDrawSelection.ts`

- [ ] **Step 1: 创建扩展文件，包含完整实现**

```typescript
/**
 * @file sourceEditorDrawSelection.ts
 * @description Source 模式自定义 selection 绘制扩展。
 * 用 ViewPlugin + Decoration.mark() 替代 CodeMirror 原生 selection 的视觉渲染，
 * 与 AI 选区高亮统一到同一装饰层体系，并提供 suppression 机制用于 AI 面板打开时临时隐藏普通选区。
 */
import { StateEffect, type EditorState } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

/**
 * 自定义 selection decoration 的 CSS class。
 */
const SELECTION_CLASS = 'cm-custom-selection';

/**
 * 控制"普通 selection 绘制是否被抑制"的 StateEffect。
 * true → 隐藏普通 selection 装饰；false → 恢复绘制。
 */
const setSelectionDrawSuppressedEffect = StateEffect.define<boolean>();

/**
 * 判断当前 state 是否存在非空选区。
 * @param state - CodeMirror EditorState 实例
 * @returns 存在非空选区时返回 true
 */
function hasNonEmptySelection(state: EditorState): boolean {
  return state.selection.ranges.some((range) => !range.empty);
}

/**
 * 根据当前 view 的 selection 状态计算 decoration set。
 * 遍历所有 selection ranges，为非空 range 生成 mark decoration。
 * @param view - CodeMirror EditorView 实例
 * @returns 包含所有非空选区 decoration 的 DecorationSet
 */
function computeSelectionDecorations(view: EditorView): DecorationSet {
  const decorations = [...view.state.selection.ranges]
    .filter((range) => !range.empty)
    .sort((left, right) => left.from - right.from)
    .map((range) => Decoration.mark({ class: SELECTION_CLASS }).range(range.from, range.to));

  if (decorations.length === 0) {
    return Decoration.none;
  }
  return Decoration.set(decorations);
}

/**
 * 抑制普通 selection 的自定义绘制（视觉层隐藏，保留真实选区和复制能力）。
 * @param view - CodeMirror EditorView 实例
 */
export function suppressSourceEditorSelectionDraw(view: EditorView): void {
  view.dispatch({
    effects: setSelectionDrawSuppressedEffect.of(true)
  });
}

/**
 * 恢复普通 selection 的自定义绘制。
 * @param view - CodeMirror EditorView 实例
 */
export function restoreSourceEditorSelectionDraw(view: EditorView): void {
  view.dispatch({
    effects: setSelectionDrawSuppressedEffect.of(false)
  });
}

/**
 * 自定义 selection 绘制 ViewPlugin。
 * 监听 selection 变化与 suppression effect，动态计算 decoration set。
 */
const customSelectionPlugin = ViewPlugin.fromClass(
  class {
    /** 当前 decoration set */
    decorations: DecorationSet;
    /** 是否处于抑制状态（隐藏普通 selection 装饰） */
    suppressed: boolean;

    constructor(view: EditorView) {
      this.suppressed = false;
      this.decorations = computeSelectionDecorations(view);
    }

    update(update: ViewUpdate): void {
      let suppressionChanged = false;

      for (const transaction of update.transactions) {
        for (const effect of transaction.effects) {
          if (effect.is(setSelectionDrawSuppressedEffect)) {
            // 仅在值实际变化时标记变更，避免重复 suppress 触发无意义重算
            if (this.suppressed !== effect.value) {
              this.suppressed = effect.value;
              suppressionChanged = true;
            }
          }
        }
      }

      // 自动复位：用户产生新的真实非空选区时，退出 suppression
      // 注意：suppression effect 不应与 selection 变化在同一 transaction 中 dispatch，
      // 否则会出现"suppress → 立即被自动复位"的竞争。当前代码路径中
      // clearNativeSelection 和 showSelectionHighlight 是分开 dispatch 的，不会同帧合并。
      if (update.selectionSet && hasNonEmptySelection(update.state)) {
        this.suppressed = false;
      }

      if (suppressionChanged || update.selectionSet || update.docChanged) {
        this.decorations = this.suppressed ? Decoration.none : computeSelectionDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations
  }
);

/**
 * 自定义 selection 主题。
 * 隐藏 CodeMirror 原生 selection 视觉，让 decoration 成为唯一可见的 selection 表示。
 */
const customSelectionTheme = EditorView.theme({
  // 隐藏 CodeMirror 原生 selection 背景
  '& .cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'transparent !important',
    color: 'inherit !important'
  },
  // 隐藏 ::selection 伪元素（Firefox 需使用 backgroundColor 长写）
  '& .cm-content ::selection, & .cm-line::selection, & .cm-line *::selection': {
    backgroundColor: 'transparent !important',
    color: 'inherit !important'
  },
  // 自定义 selection decoration 样式，与 AI 高亮保持一致的 box-shadow 方案
  '& .cm-custom-selection': {
    background: 'var(--selection-bg)',
    boxShadow: '0 0.2em 0 0 var(--selection-bg), 0 -0.2em 0 0 var(--selection-bg)',
    WebkitBoxDecorationBreak: 'clone',
    boxDecorationBreak: 'clone'
  }
});

/**
 * 创建 Source 模式自定义 selection 绘制扩展。
 * 包含 ViewPlugin、suppression effect 处理和主题覆盖。
 * @returns CodeMirror Extension 数组
 */
export function createSourceEditorDrawSelectionExtension() {
  return [customSelectionPlugin, customSelectionTheme];
}
```

- [ ] **Step 2: 验证文件无 TypeScript 错误**

Run: `pnpm exec tsc --noEmit --pretty 2>&1 | head -30`
Expected: 无与 `sourceEditorDrawSelection.ts` 相关的错误

---

### Task 2: 修改 sourceSelectionAssistant.ts

**Files:**
- Modify: `src/components/BEditor/adapters/sourceSelectionAssistant.ts`

- [ ] **Step 1: 添加 import 语句**

在文件顶部 import 区域添加：

```typescript
import { suppressSourceEditorSelectionDraw, restoreSourceEditorSelectionDraw } from './sourceEditorDrawSelection';
```

- [ ] **Step 2: 修改 clearNativeSelection() 实现**

将 `clearNativeSelection()` 从空操作改为调用 `suppressSourceEditorSelectionDraw`：

```typescript
clearNativeSelection(): void {
  suppressSourceEditorSelectionDraw(view);
},
```

- [ ] **Step 3: 修改 clearSelectionHighlight() 实现**

在清除 AI 高亮 effect 之后，追加恢复普通 selection 绘制：

```typescript
clearSelectionHighlight(): void {
  view.dispatch({
    effects: highlightRangeEffect.of(null)
  });
  restoreSourceEditorSelectionDraw(view);
},
```

---

### Task 3: 修改 PaneSourceEditor.vue

**Files:**
- Modify: `src/components/BEditor/components/PaneSourceEditor.vue`

- [ ] **Step 1: 添加 import 语句**

在 script setup 的 import 区域添加：

```typescript
import { createSourceEditorDrawSelectionExtension } from '../adapters/sourceEditorDrawSelection';
```

- [ ] **Step 2: 在 createEditorExtensions() 中插入新扩展**

在 `EditorView.updateListener.of(...)` 之后、`createSourceSelectionHighlightExtension()` 之前插入：

```typescript
createSourceEditorDrawSelectionExtension(),
```

- [ ] **Step 3: 清理冲突的 CSS 规则**

删除 `.source-editor-codemirror` 内的以下 CSS 块（因为样式已由 `EditorView.theme()` 接管）：

```less
.cm-selectionBackground,
.cm-focused .cm-selectionBackground,
.cm-content ::selection,
.cm-line::selection,
.cm-line *::selection {
  color: var(--selection-color);
  background: var(--selection-bg);
}
```

---

### Task 4: 验证与收尾

- [ ] **Step 1: 运行 ESLint 检查**

Run: `pnpm lint`
Expected: 无错误

- [ ] **Step 2: 运行 TypeScript 类型检查**

Run: `pnpm exec tsc --noEmit --pretty`
Expected: 无类型错误

- [ ] **Step 3: 记录 changelog**

在 `changelog/2026-05-06.md` 中添加变更记录。
