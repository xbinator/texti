# BPromptEditor → CodeMirror 6 迁移设计

## 背景

BPromptEditor 当前基于原生 `contenteditable` 实现，光标路径追踪、DOM 同步、undo/redo 历史栈、Chip 渲染等逻辑均为手写，维护成本高，且在复杂场景下容易出现光标错位、选区丢失等问题。

CodeMirror 6 提供了成熟的状态管理、选区追踪、Decoration 渲染体系，可以显著降低这些高风险逻辑的维护成本。

## 目标

- 用 CodeMirror 6 替换 `contenteditable`，保留现有 Props/Emits API 不变
- 删除手写光标追踪、历史栈、DOM 同步等高风险代码
- 逐步恢复变量 chip、文件引用 chip、变量触发器、粘贴/拖拽等功能

## Props / Emits API（不变）

```ts
// Props
placeholder?: string;         // default: '请输入内容...'
options?: VariableOptionGroup[];
disabled?: boolean;
maxHeight?: number | string;
submitOnEnter?: boolean;       // Enter 提交，Shift+Enter 换行

// Emits
'update:value': [value: string];  // v-model 双向绑定必需
change: [value: string];
submit: [];
```

```ts
const emit = defineEmits<{
  'update:value': [value: string]
  change: [value: string]
  submit: []
}>()
```

`v-model:value` 必须 emit `'update:value'`，否则 Vue 双向绑定无法工作。

## 文件结构

```
src/components/BPromptEditor/
├── index.vue                    # 主组件（重写）
├── components/
│   └── VariableSelect.vue       # 保留，现有下拉菜单
├── extensions/                  # 新建
│   ├── base.ts                 # 基础 extension 组装（history、keymap、updateListener）
│   ├── variableChip.ts         # {{variable}} 和 {{file-ref:...}} 的 Decoration.mark 渲染
│   ├── triggerState.ts         # 变量菜单 StateField（只存文档状态 from/to/query/visible/activeIndex）
│   ├── triggerPlugin.ts        # 触发器 ViewPlugin（coordsAtPos 计算菜单位置，同步到 Vue ref）
│   ├── pasteHandler.ts         # 粘贴/拖拽拦截
│   └── placeholder.ts         # 占位符 extension
├── hooks/
│   └── useVariableEncoder.ts   # 保留，编码/解码逻辑
└── types.ts
```

## Extension 设计

### 1. variableChip（Phase 2）

职责：将文档中的 `{{...}}` 渲染为 styled mark。

文档中存储原始格式，Decoration 只负责视觉展示，不改变文档内容。

```ts
const variableChipField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state.doc)
  },

  update(deco, tr) {
    if (tr.docChanged) {
      return buildDecorations(tr.newDoc)
    }
    return deco.map(tr.changes)
  },

  provide: field => EditorView.decorations.from(field)
})
```

**单次扫描避免重复标记和 range 顺序问题**。只匹配完整闭合 token（`}}` 未闭合时不渲染），避免干扰正在输入的 trigger：

```ts
function buildDecorations(doc: Text): DecorationSet {
  const builder: Range<Decoration>[] = []
  const text = doc.toString()

  // 统一扫描 {{...}}，在循环内区分类型
  for (const match of text.matchAll(/\{\{([^{}\n]+)\}\}/g)) {
    const body = match[1]
    const from = match.index!
    const to = from + match[0].length

    if (body.startsWith('file-ref:')) {
      // file-ref:path|name 格式校验
      const fileMatch = body.match(/^file-ref:([^|\n{}]+)\|([^{}\n]+)$/)
      if (!fileMatch) continue

      builder.push(
        Decoration.mark({ class: 'b-prompt-chip b-prompt-chip--file' }).range(from, to)
      )
    } else {
      builder.push(
        Decoration.mark({ class: 'b-prompt-chip' }).range(from, to)
      )
    }
  }

  // 传入 true 表示 ranges 已按位置排序（单次扫描天然有序）
  return Decoration.set(builder, true)
}
```

### 2. triggerState（Phase 3）

职责：管理变量菜单的文档层状态，不涉及 DOM。

```ts
interface TriggerState {
  visible: boolean;
  from: number;      // 触发器 {{ 的起始位置
  to: number;        // 当前光标位置
  query: string;     // {{ 后的原始查询字符串（不做 trim）
  activeIndex: number;
}

// StateEffect：供外部更新 activeIndex、关闭菜单
const setTriggerActiveIndex = StateEffect.define<number>()
const closeTrigger = StateEffect.define<void>()

const triggerStateField = StateField.define<TriggerState | null>({
  create() { return null },

  update(state, tr) {
    // 处理外部 Effect
    for (const effect of tr.effects) {
      if (effect.is(setTriggerActiveIndex) && state) {
        return { ...state, activeIndex: effect.value }
      }
      if (effect.is(closeTrigger)) {
        return null
      }
    }

    if (!tr.selectionSet && !tr.docChanged) return state

    const selection = tr.newState.selection.main
    // 非空选区不弹出菜单
    if (!selection.empty) return null

    const pos = selection.head
    const context = getTriggerContext(tr.newState, pos)

    if (!context) return null

    return {
      visible: true,
      from: context.from,
      to: context.to,
      query: context.query,
      activeIndex: 0
    }
  }
})
```

触发检测逻辑（每次 selection/doc 变化时执行）：

```ts
function getTriggerContext(
  state: EditorState,
  pos: number
): { from: number; to: number; query: string } | null {
  const from = Math.max(0, pos - 100)
  const text = state.doc.sliceString(from, pos)

  const open = text.lastIndexOf('{{')
  if (open === -1) return null

  const afterOpen = text.slice(open + 2)

  // 已闭合、嵌套 {{、包含换行或 } → 非触发器
  if (afterOpen.includes('}}')) return null
  if (afterOpen.includes('{{')) return null
  if (/[{}\n]/.test(afterOpen)) return null

  return {
    from: from + open,
    to: pos,
    query: afterOpen  // 不 trim，原始输入
  }
}
```

**query 过滤在组件层做**：`watch(triggerQuery, ...)` 时自行 `.trim()` 后再做变量过滤。

### 3. triggerPlugin（Phase 3）

职责：从 `triggerState` 读取文档位置，用 `coordsAtPos` 计算 DOM 菜单位置，同步到 Vue ref 驱动 `VariableSelect` 显示。

```ts
const triggerPlugin = ViewPlugin.define(view => ({
  update(update) {
    const triggerState = update.state.field(triggerStateField, false)

    if (!triggerState) {
      triggerVisible.value = false
      return
    }

    // 计算菜单位置（DOM 视图层，只能在 ViewPlugin 里拿到 view）
    const coords = update.view.coordsAtPos(triggerState.to)
    triggerPosition.value = coords
      ? { top: coords.bottom, left: coords.left }
      : { top: 0, left: 0 }
    triggerVisible.value = true
    triggerActiveIndex.value = triggerState.activeIndex
    triggerQuery.value = triggerState.query
  }
}))
```

注意：`StateField` 只存文档坐标（from/to），DOM 坐标在 ViewPlugin 里通过 `coordsAtPos` 计算后同步给 Vue。

### 4. pasteHandler（Phase 4）

```ts
EditorView.domEventHandlers({
  paste(event, view) {
    const files = event.clipboardData?.files

    if (files?.length) {
      event.preventDefault()
      const insert = Array.from(files)
        .map(f => `{{file-ref:${encodeURIComponent(f.name)}|${encodeURIComponent(f.name)}}}`)
        .join('')

      const range = view.state.selection.main
      view.dispatch({
        changes: { from: range.from, to: range.to, insert },
        selection: { anchor: range.from + insert.length },
        scrollIntoView: true
      })
      return true
    }

    // 普通文本不拦截，交给 CodeMirror 默认处理
    return false
  },

  drop(event, view) {
    const files = event.dataTransfer?.files
    if (!files?.length) return false

    event.preventDefault()

    // 用释放位置插入，而不是当前光标
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos == null) return true

    const insert = Array.from(files)
      .map(f => `{{file-ref:${encodeURIComponent(f.name)}|${encodeURIComponent(f.name)}}}`)
      .join('')

    view.dispatch({
      changes: { from: pos, insert },
      selection: { anchor: pos + insert.length },
      scrollIntoView: true
    })

    return true
  }
})
```

### 5. base.ts

组装基础 extension：

```ts
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { insertNewline } from '@codemirror/commands'

const editableCompartment = new Compartment()
const readOnlyCompartment = new Compartment()
const themeCompartment = new Compartment()

function createBaseExtensions() {
  return [
    history(),
    editableCompartment.of(EditorView.editable.of(!props.disabled)),
    readOnlyCompartment.of(EditorState.readOnly.of(props.disabled)),
    themeCompartment.of(EditorView.theme({
      '&': { maxHeight: resolvedMaxHeight.value },
      '.cm-scroller': {
        maxHeight: resolvedMaxHeight.value,
        overflow: 'auto'
      }
    })),
    placeholderExtension,
    keymap.of([
      indentWithTab,
      // 自定义 Enter 规则放在 defaultKeymap 前面，确保优先匹配
      {
        key: 'Shift-Enter',
        run: insertNewline
      },
      {
        key: 'Enter',
        run(view) {
          if (submitOnEnter.value) {
            emit('submit')
            return true
          }
          return false
        }
      },
      ...defaultKeymap,
      ...historyKeymap
    ]),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      // 同步外部 modelValue（见"外部 modelValue 同步"章节）
    }),
    EditorView.contentAttributes.of({ spellcheck: 'false' }),
    variableChipField,
    triggerStateField,
    triggerPlugin
  ]
}
```

**disabled 使用双 Compartment 动态更新**：

```ts
watch(() => props.disabled, (disabled) => {
  view.value?.dispatch({
    effects: [
      editableCompartment.reconfigure(EditorView.editable.of(!disabled)),
      readOnlyCompartment.reconfigure(EditorState.readOnly.of(disabled))
    ]
  })
})
```

**maxHeight 响应式变化**：

```ts
watch(resolvedMaxHeight, (maxHeight) => {
  view.value?.dispatch({
    effects: themeCompartment.reconfigure(
      EditorView.theme({
        '&': { maxHeight },
        '.cm-scroller': { maxHeight, overflow: 'auto' }
      })
    )
  })
})
```

### 6. StateEffect 用于变量选择

变量选择时替换 `triggerState.from → triggerState.to` 的内容，并关闭菜单：

```ts
function selectVariable(variable: Variable) {
  const state = view.state.field(triggerStateField, false)
  if (!state) return

  const insert = `{{${variable.value}}}`

  view.dispatch({
    changes: { from: state.from, to: state.to, insert },
    selection: { anchor: state.from + insert.length },
    effects: closeTrigger.of()
  })

  view.focus()
}
```

## 外部 modelValue 同步（关键）

避免循环 emit：用 Annotation 标记外部来源，比外部 flag 更稳。

```ts
import { Annotation } from '@codemirror/state'

const externalUpdate = Annotation.define<boolean>()

watch(
  () => props.value,
  (value) => {
    if (!view.value) return
    const current = view.value.state.doc.toString()
    if (value === current) return

    view.value.dispatch({
      changes: {
        from: 0,
        to: view.value.state.doc.length,
        insert: value
      },
      annotations: externalUpdate.of(true)
    })
  }
)

EditorView.updateListener.of((update) => {
  if (!update.docChanged) return
  if (update.transactions.some(tr => tr.annotation(externalUpdate))) return

  const newValue = update.state.doc.toString()
  editorContent.value = newValue
  emit('update:value', newValue)
  emit('change', newValue)
})
```

## 暴露的方法实现

```ts
let lastSelection: EditorSelection | null = null

function captureCursorPosition() {
  if (!view.value) return
  lastSelection = view.value.state.selection
}

function insertFileReference(reference: FileReferenceChip) {
  if (!view.value) return

  const insert = encodeFileRef(reference.path, reference.name)
  const selection = lastSelection ?? view.value.state.selection
  const range = selection.main

  view.value.dispatch({
    changes: {
      from: range.from,
      to: range.to,
      insert
    },
    selection: {
      anchor: range.from + insert.length
    },
    scrollIntoView: true
  })

  view.value.focus()
}

function focus() {
  view.value?.focus()
}
```

## 文件引用编码

文件 path 和 name 中可能包含 `|`、`{`、`}`、`\n` 等破坏 token 的字符，生成时必须编码：

```ts
function encodeFileRef(path: string, name: string): string {
  return `{{file-ref:${encodeURIComponent(path)}|${encodeURIComponent(name)}}}`
}
```

`useVariableEncoder` 中的 `encodeVariables` / `decodeVariables` 需同步更新。

## 变量过滤

```ts
const flattenedOptions = computed(() =>
  (props.options ?? []).flatMap(group => group.options)
)

const filteredVariables = computed(() => {
  const keyword = triggerQuery.value.trim().toLowerCase()
  if (!keyword) return flattenedOptions.value

  return flattenedOptions.value.filter(item =>
    item.label.toLowerCase().includes(keyword) ||
    item.value.toLowerCase().includes(keyword)
  )
})
```

`triggerQuery` 或 `props.options` 任一变化都会自动重算。

## 动态配置（Compartment）

| 动态配置项 | Compartment | 更新方式 |
|-----------|-------------|---------|
| `disabled` | `editableCompartment` + `readOnlyCompartment` | 双 compartment reconfigure |
| `maxHeight` | `themeCompartment` | reconfigure EditorView.theme |
| `submitOnEnter` | — | 直接读取 `.value`，无需 reconfigure |

## 销毁逻辑

```ts
onBeforeUnmount(() => {
  view.value?.destroy()
  view.value = null
})
```

## 实施顺序

### Phase 1：纯文本编辑器替换
- 创建 EditorView
- v-model 双向同步（Annotation 防循环 emit）
- disabled 模式（`EditorView.editable` + `EditorState.readOnly` + 双 Compartment）
- placeholder（独立 extension）
- maxHeight（`EditorView.theme` + Compartment）
- submitOnEnter（自定义 Enter keymap 在 `defaultKeymap` 之前）
- focus() / captureCursorPosition() / insertFileReference()
- `onBeforeUnmount(() => view.value?.destroy())`

### Phase 2：Decoration 渲染
- `{{variable}}` 渲染为 `Decoration.mark`
- `{{file-ref:path|name}}` 渲染为 `Decoration.mark`（暂不做 widget）
- 单次扫描区分类型，避免重复 mark
- 文件引用 path/name 使用 `encodeURIComponent` 编码

### Phase 3：变量菜单
- `triggerState` StateField（检测 `{{`、存储 from/to/query，query 不 trim）
- 非空选区不弹出菜单
- `setTriggerActiveIndex` / `closeTrigger` StateEffect
- `triggerPlugin` ViewPlugin（coordsAtPos 计算菜单位置，同步 Vue）
- `VariableSelect` 组件继续使用，Vue ref 驱动
- 键盘上下选择：dispatch `setTriggerActiveIndex` Effect
- 变量选择：替换 `from → to` 范围，dispatch `closeTrigger` Effect

### Phase 4：粘贴与拖拽
- 文件粘贴优先于普通文本（ClipboardData.files）
- 拖拽用 `posAtCoords` 定位到释放位置
- 普通文本不拦截，交给 CodeMirror 默认处理

### Phase 5：可选增强
- FileRefWidget（真正的 chip widget 渲染）
- 增量扫描优化
- chip hover / 删除按钮
- 复制原始 token

## 可删除的代码

| 文件 | 删除原因 |
|------|---------|
| `hooks/useEditorCore.ts` | 光标路径追踪废弃，`EditorSelection` 自动维护 |
| `hooks/useEditorSelection.ts` | `cache/restoreRange` 废弃 |
| `hooks/useEditorTrigger.ts` | 重写为 `triggerState` + `triggerPlugin` |
| `hooks/useEditorKeyboard.ts` | `submitOnEnter` 改用 keymap |
| `hooks/useEditorPaste.ts` | 改用 `pasteHandler` |
| `hooks/index.ts` | 清理 export，只保留 `useVariableEncoder` |

## 与 BEditor 的关系

完全独立，不共享 extension。后续如需可迁移复用，但初期按独立组件开发。
