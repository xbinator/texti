# Markdown Initial Undo Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Markdown 编辑器以首次文件加载结果作为不可撤销的初始基线，避免 `Ctrl+Z` 把已打开文档撤销为空白。

**Architecture:** 编辑器页面在 `isLoading` 为 `true` 时不挂载 `BEditor`，待文件控制器应用最终 `fileState` 并结束加载后再创建编辑器。Rich 与 Source 编辑器因此直接以加载结果初始化，无需修改各自的历史插件；普通文件监听更新仍沿用现有可撤销行为。

**Tech Stack:** Vue 3、TypeScript、Vitest、Vue Test Utils、pnpm

## Global Constraints

- 不执行 `git add`、`git commit` 或其他提交操作，由用户自行提交。
- 禁止使用 `any`；函数参数与返回值保持明确类型。
- 新增或修改的函数、类型和复杂逻辑必须保留准确注释。
- 不修改 Rich、Source 编辑器内部历史实现，也不改变粘贴、AI 全文替换和选区替换语义。
- 项目文件路径在文档和代码中使用仓库相对路径。
- 代码改动记录到 `changelog/2026-08-05.md`。

---

## File Structure

- Modify: `test/views/editor/index-scroll-position.test.ts` — 覆盖编辑器页面加载门控、KeepAlive 滚动和空白文档聚焦生命周期。
- Modify: `src/views/editor/index.vue` — 在页面加载完成后才挂载 `BEditor`。
- Modify: `changelog/2026-08-05.md` — 记录 Markdown 初始撤销基线修复。

### Task 1: 建立初始加载撤销基线

**Files:**

- Modify: `test/views/editor/index-scroll-position.test.ts`
- Modify: `src/views/editor/index.vue:3-14`
- Modify: `changelog/2026-08-05.md`

**Interfaces:**

- Consumes: `useSession(fileId)` 返回的 `fileState: Ref<EditorFile>` 与 `isLoading: Ref<boolean>`。
- Produces: 页面级挂载约束——`isLoading === true` 时不存在 `BEditor` 实例，`isLoading === false` 时以当前 `fileState` 创建实例。

- [x] **Step 1: 写入失败的页面加载门控测试**

在 `test/views/editor/index-scroll-position.test.ts` 中把文件说明调整为页面生命周期测试，并扩充 hoisted 测试状态：

```typescript
/**
 * @file index-scroll-position.test.ts
 * @description 编辑器页面加载、KeepAlive 滚动与空白文档聚焦生命周期测试。
 * @vitest-environment jsdom
 */

const bEditorMethods = vi.hoisted(() => ({
  focusEditorAtStart: vi.fn(),
  rememberScrollPosition: vi.fn(),
  restoreScrollPosition: vi.fn(),
  mountContents: [] as string[]
}));

/** 编辑器页面会话测试运行时引用。 */
const sessionRuntime = vi.hoisted(() => ({
  isLoading: null as { value: boolean } | null
}));

/** useSession 返回的加载状态测试数据。 */
const sessionLoadingState = vi.hoisted(() => ({ value: false }));
```

让 `BEditor` stub 在 `setup` 阶段记录首次收到的文档内容：

```typescript
setup(props, { expose }) {
  const editorValue = props.value as { content?: unknown };
  bEditorMethods.mountContents.push(typeof editorValue.content === 'string' ? editorValue.content : '');

  expose({
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: (): boolean => false,
    canRedo: (): boolean => false,
    focusEditor: vi.fn(),
    focusEditorAtStart: bEditorMethods.focusEditorAtStart,
    setSearchTerm: vi.fn(),
    findNext: vi.fn(),
    findPrevious: vi.fn(),
    clearSearch: vi.fn(),
    getSelection: (): null => null,
    insertAtCursor: vi.fn(),
    replaceSelection: vi.fn(),
    replaceDocument: vi.fn(),
    selectLineRange: vi.fn(),
    getSearchState: () => ({ currentIndex: 0, matchCount: 0, term: '' }),
    scrollToAnchor: vi.fn(),
    getActiveAnchorId: (): string => '',
    rememberScrollPosition: bEditorMethods.rememberScrollPosition,
    restoreScrollPosition: bEditorMethods.restoreScrollPosition
  });

  return (): ReturnType<typeof h> => h('div', { class: 'b-editor-stub' });
}
```

让 `useSession` mock 暴露实际的响应式加载引用：

```typescript
useSession: () => {
  const isLoading = vueRef(sessionLoadingState.value);
  sessionRuntime.isLoading = isLoading;

  return {
    fileState: vueRef({ ...sessionFileState.value }),
    isLoading,
    actions: {
      onEditorBlur: vi.fn(),
      onRename: vi.fn(),
      onSave: vi.fn(),
      onSaveAs: vi.fn(),
      onCopyPath: vi.fn(),
      onShowInFolder: vi.fn()
    }
  };
}
```

在 `beforeEach` 中复位新增状态：

```typescript
bEditorMethods.mountContents.length = 0;
sessionRuntime.isLoading = null;
sessionLoadingState.value = false;
```

新增回归用例：

```typescript
it('waits for initial file loading before mounting BEditor', async (): Promise<void> => {
  sessionLoadingState.value = true;
  sessionFileState.value = {
    id: 'loaded-file',
    name: 'loaded.md',
    path: '/workspace/loaded.md',
    ext: 'md',
    content: '# Loaded'
  };

  const wrapper = mount(EditorPage);
  await nextTick();

  expect(wrapper.find('.b-editor-stub').exists()).toBe(false);
  expect(bEditorMethods.mountContents).toEqual([]);

  const loadingState = sessionRuntime.isLoading;
  if (!loadingState) {
    throw new Error('Editor session loading ref was not initialized');
  }

  loadingState.value = false;
  await nextTick();

  expect(wrapper.find('.b-editor-stub').exists()).toBe(true);
  expect(bEditorMethods.mountContents).toEqual(['# Loaded']);
});
```

- [x] **Step 2: 运行测试并确认它因编辑器提前挂载而失败**

Run:

```bash
pnpm exec vitest run test/views/editor/index-scroll-position.test.ts
```

Expected: FAIL；`wrapper.find('.b-editor-stub').exists()` 当前得到 `true`，证明加载期间仍挂载了编辑器。

- [x] **Step 3: 实现最小加载门控**

在 `src/views/editor/index.vue` 的 `BEditor` 上增加条件指令：

```vue
<BEditor
  v-if="!isLoading"
  ref="editorRef"
  :key="fileState.id"
  v-model:value="fileState"
  :active="isActive"
  @editor-blur="actions.onEditorBlur"
  @rename-file="actions.onRename"
  @save="actions.onSave"
  @save-as="actions.onSaveAs"
  @copy-path="actions.onCopyPath"
  @show-in-folder="actions.onShowInFolder"
/>
```

不修改 `BEditor`、`PaneRichEditor`、`PaneSourceEditor` 或历史插件代码。

- [x] **Step 4: 运行目标测试并确认加载、滚动与聚焦用例全部通过**

Run:

```bash
pnpm exec vitest run test/views/editor/index-scroll-position.test.ts
```

Expected: PASS；该文件全部测试通过，且无 Vue warning 或未处理异常。

- [x] **Step 5: 记录 changelog**

在 `changelog/2026-08-05.md` 的 `## Changed` 下追加：

```markdown
- Markdown 编辑器改为在初始文件加载完成后挂载，避免磁盘内容进入撤销栈并被 `Ctrl+Z` 撤销为空白。
```

- [x] **Step 6: 运行完整静态检查与相关测试**

Run:

```bash
pnpm exec vitest run test/views/editor/index-scroll-position.test.ts
pnpm exec eslint src --ext .vue,.ts,.tsx,.js,.jsx
pnpm exec stylelint 'src/**/*.{vue,less,css}'
pnpm exec tsc --noEmit
git diff --check
```

Expected: 所有命令退出码均为 `0`；Vitest 无失败，ESLint/Stylelint/TypeScript 无错误，Git diff 无空白问题。

Execution result: 编辑器页面相关测试 13/13、ESLint、Stylelint 与 `git diff --check` 均通过。项目级 TypeScript 检查被当前 `HEAD` 中 `test/components/BChat/session-id-runtime.test.ts` 的 3 个无关类型错误阻塞；该文件不在本次 diff 中，因此保持不变。

- [x] **Step 7: 检查最终工作区且不提交**

Run:

```bash
git status --short
git diff -- src/views/editor/index.vue test/views/editor/index-scroll-position.test.ts changelog/2026-08-05.md docs/superpowers/plans/2026-08-05-markdown-initial-undo-baseline.md
```

Expected: 仅显示本计划、回归测试、页面门控和 changelog 的预期未提交改动；不运行 `git add` 或 `git commit`。
