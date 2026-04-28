# SelectionToolbar 失焦不关闭 & 位置跟随方案

## 目标

1. SelectionToolbar 出现后，编辑器失焦（点击外部）**不关闭菜单**
2. 重新选取文字时，菜单位置**跟随到新选区**（或选区消失时关闭）
3. 不再依赖 BubbleMenu 内置的焦点判定，但保留其定位能力

## BubbleMenu 核心机制（源码分析）

### 显示/隐藏由两条路径控制

| 路径 | 触发条件 | 行为 |
|------|----------|------|
| `update()` → `updateHandler()` | ProseMirror 每次 state 变更都会调用 | 调用 `shouldShow`，返回 false 则 `hide()`，返回 true 则 `show()` + `updatePosition()` |
| `blurHandler()` | 编辑器 blur 事件 | 直接调 `hide()`，**不受 `shouldShow` 控制** |

### blurHandler 的防护逻辑

```ts
blurHandler = ({ event }: { event: FocusEvent }) => {
  if (this.editor.isDestroyed) { this.destroy(); return }
  // 防护1: 菜单内部 mousedown 会设置 preventHide=true，跳过隐藏
  if (this.preventHide) { this.preventHide = false; return }
  // 防护2: focus 转移到菜单同级节点，不隐藏
  if (event?.relatedTarget && this.element.parentNode?.contains(event.relatedTarget as Node)) return
  // 防护3: focus 回到编辑器自身，不隐藏
  if (event?.relatedTarget === this.editor.view.dom) return
  this.hide()
}
```

### 事务 meta 机制

BubbleMenu 支持通过 `tr.setMeta(pluginKey, action)` 控制：

```ts
transactionHandler = ({ transaction: tr }) => {
  const meta = tr.getMeta(this.pluginKey)
  if (meta === 'updatePosition') { this.updatePosition() }
  else if (meta === 'hide') { this.hide() }
  else if (meta === 'show') { this.updatePosition(); this.show() }
}
```

其中 `show` 调用 `updatePosition() + show()`，**不检查 `shouldShow`**。

### `show()` / `hide()` 实现

```ts
show() {
  if (this.isVisible) return
  this.element.style.visibility = 'visible'
  this.element.style.opacity = '1'
  appendToElement?.appendChild(this.element)  // 重新挂载到 DOM
  this.isVisible = true
}

hide() {
  if (!this.isVisible) return
  this.element.style.visibility = 'hidden'
  this.element.style.opacity = '0'
  this.element.remove()  // 从 DOM 移除
  this.isVisible = false
}
```

## 方案设计

### 思路

不改 Fork、不重写，纯利用现有 API：

1. **`shouldShow` 覆盖** — 去掉 `hasEditorFocus` 条件，选区非空即返回 true
2. **blur 事件补枪** — blur → 内置 handler 调 `hide()` → 我们随后 dispatch `meta:'show'` → 菜单重显。全程同步无闪烁

### 无闪烁原理

```
blur 事件触发
  ├─ 内置 blurHandler → hide() → 元素 remove(), isVisible=false
  └─ 我们的 blurHandler → dispatch(tr.setMeta('bubbleMenu', 'show'))
      └─ 内置 transactionHandler → updatePosition() → show() → 元素 appendChild, isVisible=true
浏览器 repaint ← 此时元素已在 DOM 中，完全可见
```

关键：JavaScript 事件回调同步执行，`hide()` → `show()` → 浏览器渲染，中间无 paint。用户无感知。

### 选区为空的处理

- blur 时选区为空（from === to）：不 dispatch `show`，内置 handler 的 hide 生效，菜单正常关闭
- 编辑器中点击放置光标（无选区）：state 变更 → `update()` → `shouldShow` 返回 false → 菜单正常关闭

## 实现

### 1. 修改 `bubbleMenuOptions`

```ts
const bubbleMenuOptions = computed(() => ({
  placement: 'top-start' as const,
  shouldShow: ({ state }: { state: EditorState }): boolean => {
    const { from, to } = state.selection
    // 无选区则隐藏
    if (from === to) return false
    // 选区无文本内容（如选到节点边界）则隐藏
    if (!state.doc.textBetween(from, to)) return false
    // 编辑器只读则隐藏
    if (!props.editor?.isEditable) return false
    // 不检查 hasEditorFocus — 失焦时仍保持显示
    return true
  },
  onShow: () => {
    checkModelAvailability()
    emit('ai-input-toggle', false)
  },
  onHide: () => {
    emit('ai-input-toggle', false)
    emit('selection-reference-clear')
  }
}))
```

### 2. 注册 blur 补枪逻辑

```ts
onMounted(() => {
  const editor = props.editor
  if (!editor) return

  editor.on('blur', handleBlurRestore)

  onUnmounted(() => {
    editor.off('blur', handleBlurRestore)
  })
})

function handleBlurRestore(): void {
  const { state } = props.editor!
  const { from, to } = state.selection
  if (from !== to) {
    props.editor!.view.dispatch(
      state.tr.setMeta('bubbleMenu', 'show')
    )
  }
}
```

### 3. 移除旧的 options 中冗余逻辑

原来 `onShow`/`onHide` 只做状态通知，不需要在 `options` 层做显隐控制（由 `shouldShow` 接管）。保持现有逻辑不动即可。

## 行为矩阵

| 场景 | 旧行为 | 新行为 |
|------|--------|--------|
| 选中文字 | 菜单出现 | 同旧 |
| 点击外部（失焦） | 菜单消失 | **菜单保持** |
| 失焦后点击空白处（无选区） | 不出现 | **消失**（`shouldShow` 返回 false） |
| 失焦后重新选文 | 先 focus 再出现 | **位置跟随新选区** |
| 在编辑器内点击取消选区 | 菜单消失 | 同旧 |
| 菜单内点击按钮 | 菜单保持 | 同旧 |
| 拖拽选区 | 菜单消失 | 同旧（`dragstartHandler` 不受影响） |

## 风险点

- **`shouldShow` 参数签名差异**：Vue 声明为 `(props: { editor, element, view, state, oldState?, from, to }) => boolean`。我只用了 `state`，其他参数传不进来也无影响。
- **pluginKey 默认值**：源码默认值为 `'bubbleMenu'`（字符串），Vue 组件默认为 `BubbleMenuPluginKey`（PluginKey 实例）。需要确认，若不一致会导致 meta 查找失败。检查后统一即可。
- **onHide 不会被错误触发**：`onHide` 只在 `hide()` 被调用时触发。我们的 blur 补枪会让 `hide()` 先执行一次（触发 onHide），然后 `show()` 再执行。但 `onShow`/`onHide` 目前只做 AI 输入状态通知，多一次 onHide→onShow 不影响功能正确性。
