# Markdown 大纲侧栏切换按钮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Markdown 编辑器增加一对状态互斥的大纲打开/关闭按钮，并仅在点击这两个按钮时播放侧栏显隐动画。

**Architecture:** 继续使用各自 Store 中的布尔值作为唯一显隐状态源。通用 `useIntentMotion<State>` 控制器记录显式动作的目标状态并管理 360ms 生命周期；`Markdown.vue` 与默认布局用布尔状态复用该控制器，`BPanelSplitter` 的 `resize-start` 仅作为调用方取消动画的业务信号。`Sidebar.vue` 常驻挂载并通过 `visible`、`motionEnabled` 组合即时显隐与临时动画，不把动画状态写入 Store。

**Tech Stack:** Vue 3 `<script setup>`、TypeScript、Pinia、Vue Test Utils、Vitest、Less

## Global Constraints

- 禁止使用 `any`，所有新增函数、接口和复杂逻辑必须有准确注释。
- B 开头组件使用全局自动引入，不新增手动 import。
- 打开按钮图标固定为 `lucide:list-indent-increase`。
- 关闭按钮图标固定为 `lucide:list-indent-decrease`。
- 两个新增按钮都不添加 `title` 或 `aria-label`。
- 仅按钮点击路径启用动画；拖拽关闭、宽度调整和程序化显隐保持即时。
- 动画使用宽度/横移 360ms、透明度 240ms，并支持 `prefers-reduced-motion`。
- 不新增持久化显隐状态或通用外观组件；仅抽取动画生命周期 composable。
- 按用户要求，本轮不执行 `git commit`。

---

### Task 1: Markdown 大纲切换交互

**Files:**
- Create: `test/components/BEditor/markdown-outline-toggle.test.ts`
- Modify: `src/components/BEditor/Markdown.vue:20-110, 719-735`
- Modify: `src/components/BEditor/components/Sidebar.vue:5-18, 65-88`
- Modify: `changelog/2026-07-30.md`

**Interfaces:**
- Consumes: `showOutline: WritableComputedRef<boolean>` 的既有语义，以及 `Sidebar` 的既有 `close` 事件。
- Produces: `.b-markdown-main__outline-toggle` 按钮、`.sidebar__toggle` 按钮；不新增公开 TypeScript 接口。

- [x] **Step 1: 编写失败的组件测试**

创建 `test/components/BEditor/markdown-outline-toggle.test.ts`，使用 Pinia 挂载 `Markdown`，并单独挂载 `Sidebar`：

```ts
/**
 * @file markdown-outline-toggle.test.ts
 * @description Markdown 大纲侧栏打开与关闭按钮交互测试。
 * @vitest-environment jsdom
 */
import { defineComponent } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Markdown from '@/components/BEditor/Markdown.vue';
import Sidebar from '@/components/BEditor/components/Sidebar.vue';
import type { EditorState } from '@/components/BEditor/types';
import { useEditorPreferencesStore } from '@/stores/editor/preferences';

vi.mock('@/shared/platform', () => ({
  native: {
    exportPdf: vi.fn(),
    updateMenuItem: vi.fn()
  }
}));

vi.mock('@/utils/modal', () => ({
  Modal: {
    confirm: vi.fn(),
    delete: vi.fn(),
    input: vi.fn()
  }
}));

const BButtonStub = defineComponent({
  name: 'BButton',
  inheritAttrs: false,
  props: {
    icon: {
      type: String,
      default: ''
    }
  },
  emits: ['click'],
  template: '<button v-bind="$attrs" type="button" :data-icon="icon" @click="$emit(\'click\', $event)"><slot /></button>'
});

/**
 * 创建测试用 Markdown 编辑器状态。
 * @returns Markdown 编辑器状态
 */
function createEditorState(): EditorState {
  return {
    id: 'outline-toggle-file',
    name: 'outline.md',
    path: '/workspace/outline.md',
    ext: 'md',
    content: '# Title'
  };
}

/**
 * 挂载 Markdown 编辑器并隔离无关子组件。
 * @returns Markdown 组件包装器
 */
function mountMarkdown(): VueWrapper {
  return mount(Markdown, {
    props: {
      content: '# Title',
      outlineContent: '# Title',
      editorState: createEditorState(),
      editable: true
    },
    global: {
      stubs: {
        BButton: BButtonStub,
        BScrollbar: { template: '<div><slot /></div>' },
        Sidebar: true,
        PaneRichEditor: true,
        PaneSourceEditor: true,
        SelectionToolbarRich: true,
        SelectionToolbarSource: true,
        SelectionAIInput: true,
        SelectionCommentInput: true,
        CommentCard: true,
        FindBar: true
      }
    }
  });
}

describe('Markdown outline toggle', (): void => {
  beforeEach((): void => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it('opens the outline from the main area and hides the open button', async (): Promise<void> => {
    const store = useEditorPreferencesStore();
    store.setShowOutline(false);
    const wrapper = mountMarkdown();
    const openButton = wrapper.find('button.b-markdown-main__outline-toggle');

    expect(openButton.attributes('data-icon')).toBe('lucide:list-indent-increase');
    expect(openButton.attributes('title')).toBeUndefined();
    expect(openButton.attributes('aria-label')).toBeUndefined();

    await openButton.trigger('click');

    expect(store.showOutline).toBe(true);
    expect(wrapper.find('button.b-markdown-main__outline-toggle').exists()).toBe(false);
  });

  it('emits button-close from the decrease-indent button even without a title', async (): Promise<void> => {
    const wrapper = mount(Sidebar, {
      global: {
        stubs: {
          BButton: BButtonStub,
          BPanelSplitter: { template: '<div><slot /></div>' },
          AnchorContent: true
        }
      }
    });
    const closeButton = wrapper.find('button.sidebar__toggle');

    expect(closeButton.attributes('data-icon')).toBe('lucide:list-indent-decrease');
    expect(closeButton.attributes('title')).toBeUndefined();
    expect(closeButton.attributes('aria-label')).toBeUndefined();

    await closeButton.trigger('click');

    expect(wrapper.emitted('button-close')).toHaveLength(1);
  });
});
```

- [x] **Step 2: 运行测试并确认 RED**

Run:

```bash
pnpm exec vitest run test/components/BEditor/markdown-outline-toggle.test.ts
```

Expected: 两个用例因找不到 `.b-markdown-main__outline-toggle` 和 `.sidebar__toggle` 按钮而失败。

- [x] **Step 3: 实现主内容区打开按钮**

在 `src/components/BEditor/Markdown.vue` 的 `.b-markdown-main` 内、`BScrollbar` 前添加：

```vue
<BButton
  v-if="!showOutline"
  class="b-markdown-main__outline-toggle"
  type="ghost"
  size="small"
  square
  icon="lucide:list-indent-increase"
  @click="showOutline = true"
/>
```

将 `.b-markdown-main` 设为定位上下文，并添加按钮定位样式：

```less
.b-markdown-main {
  position: relative;
  // 保留现有规则
}

.b-markdown-main__outline-toggle {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 3;
}
```

- [x] **Step 4: 实现 Sidebar 关闭按钮**

在 `src/components/BEditor/components/Sidebar.vue` 中让 header 始终存在、标题区按 `title` 条件显示，并在右侧添加：

```vue
<div class="sidebar__header">
  <div v-if="title" class="sidebar__main" @click="handleTitleClick">
    <span class="sidebar__title">{{ title }}</span>
  </div>
  <BButton
    class="sidebar__toggle"
    type="ghost"
    size="small"
    square
    icon="lucide:list-indent-decrease"
    @click="emit('button-close')"
  />
</div>
```

补充右对齐样式，确保没有标题时按钮仍位于右上角：

```css
.sidebar__toggle {
  margin-left: auto;
}
```

关闭按钮使用独立的 `button-close` 事件，`close` 保留给 `BPanelSplitter` 拖拽关闭。

- [x] **Step 5: 运行测试并确认 GREEN**

Run:

```bash
pnpm exec vitest run test/components/BEditor/markdown-outline-toggle.test.ts
```

Expected: 2 tests passed。

- [x] **Step 6: 记录 changelog**

在 `changelog/2026-07-30.md` 中记录：

```md
# 2026-07-30

## Added

- Markdown 编辑器增加大纲侧栏打开与关闭按钮。
```

- [x] **Step 7: 运行完整验证**

Run:

```bash
pnpm exec eslint src/components/BEditor/Markdown.vue src/components/BEditor/components/Sidebar.vue test/components/BEditor/markdown-outline-toggle.test.ts
pnpm exec stylelint 'src/components/BEditor/{Markdown.vue,components/Sidebar.vue}'
pnpm exec tsc --noEmit
pnpm exec vitest run test/components/BEditor/markdown-outline-toggle.test.ts test/components/BEditor/markdown-scroll-position.test.ts
git diff --check
```

Expected: 所有命令退出码均为 0，无错误或失败测试。

---

### Task 2: 仅按钮触发的大纲侧栏动画

**Files:**
- Modify: `test/components/BEditor/markdown-outline-toggle.test.ts`
- Modify: `src/components/BEditor/Markdown.vue`
- Modify: `src/components/BEditor/components/Sidebar.vue`
- Modify: `changelog/2026-07-30.md`

**Interfaces:**
- Consumes: `showOutline: WritableComputedRef<boolean>`、`Sidebar` 的 `close` 事件。
- Produces: `Sidebar` 属性 `visible?: boolean`、`motionEnabled?: boolean`，以及独立事件 `'button-close': []`。

- [x] **Step 1: 编写动画事件分流失败测试**

在 `test/components/BEditor/markdown-outline-toggle.test.ts` 中扩展 Sidebar stub，使其接收动画属性：

```ts
const SidebarStub = defineComponent({
  name: 'Sidebar',
  props: {
    visible: Boolean,
    motionEnabled: Boolean
  },
  emits: ['change', 'close', 'button-close'],
  template: '<div class="sidebar-stub"></div>'
});
```

在 Markdown 挂载配置中用 `Sidebar: SidebarStub` 替换布尔 stub，并增加以下用例：

```ts
it('only enables motion for the open button and clears it after 360ms', async (): Promise<void> => {
  vi.useFakeTimers();
  const store = useEditorPreferencesStore();
  store.setShowOutline(false);
  const wrapper = mountMarkdown();
  const sidebar = wrapper.findComponent(SidebarStub);

  await wrapper.find('.b-markdown-main__outline-toggle').trigger('click');

  expect(store.showOutline).toBe(true);
  expect(sidebar.props('visible')).toBe(true);
  expect(sidebar.props('motionEnabled')).toBe(true);

  await vi.advanceTimersByTimeAsync(360);

  expect(sidebar.props('motionEnabled')).toBe(false);
});

it('enables motion for button-close but not splitter close or programmatic visibility', async (): Promise<void> => {
  vi.useFakeTimers();
  const store = useEditorPreferencesStore();
  store.setShowOutline(true);
  const wrapper = mountMarkdown();
  const sidebar = wrapper.findComponent(SidebarStub);

  sidebar.vm.$emit('button-close');
  await nextTick();
  expect(store.showOutline).toBe(false);
  expect(sidebar.props('motionEnabled')).toBe(true);

  await vi.advanceTimersByTimeAsync(360);
  store.setShowOutline(true);
  await nextTick();
  expect(sidebar.props('motionEnabled')).toBe(false);

  sidebar.vm.$emit('close');
  await nextTick();
  expect(store.showOutline).toBe(false);
  expect(sidebar.props('motionEnabled')).toBe(false);
});
```

为测试文件增加 `afterEach` 和 `nextTick` 导入，并在 `afterEach` 中恢复真实定时器。

- [x] **Step 2: 运行测试并确认动画 RED**

Run:

```bash
pnpm exec vitest run test/components/BEditor/markdown-outline-toggle.test.ts
```

Expected: FAIL，Sidebar 尚未接收 `visible` / `motionEnabled`，按钮关闭也尚未发出 `button-close`。

- [x] **Step 3: 在 Markdown 中实现局部动画状态和事件分流**

在 `src/components/BEditor/Markdown.vue` 中引入 `onBeforeUnmount`，并添加：

```ts
/** 大纲侧栏按钮动画时长，需与 Sidebar 过渡保持一致。 */
const OUTLINE_MOTION_DURATION = 360;
/** 是否临时启用大纲侧栏按钮动画。 */
const outlineMotionEnabled = ref(false);
/** 大纲侧栏动画清理定时器。 */
let outlineMotionTimer: number | null = null;

/**
 * 清理大纲侧栏动画状态。
 */
function clearOutlineMotion(): void {
  if (outlineMotionTimer !== null) {
    window.clearTimeout(outlineMotionTimer);
    outlineMotionTimer = null;
  }
  outlineMotionEnabled.value = false;
}

/**
 * 临时启用大纲侧栏按钮动画。
 */
function enableOutlineMotion(): void {
  clearOutlineMotion();
  outlineMotionEnabled.value = true;
  outlineMotionTimer = window.setTimeout((): void => {
    outlineMotionEnabled.value = false;
    outlineMotionTimer = null;
  }, OUTLINE_MOTION_DURATION);
}

/**
 * 通过主内容区按钮打开大纲。
 */
function openOutlineByButton(): void {
  enableOutlineMotion();
  showOutline.value = true;
}

/**
 * 通过 Sidebar 按钮关闭大纲。
 */
function closeOutlineByButton(): void {
  enableOutlineMotion();
  showOutline.value = false;
}

/**
 * 处理分隔器拖拽关闭，不启用动画。
 */
function closeOutlineByDrag(): void {
  clearOutlineMotion();
  showOutline.value = false;
}

onBeforeUnmount((): void => {
  clearOutlineMotion();
});
```

将 Sidebar 和打开按钮模板改为：

```vue
<Sidebar
  :visible="showOutline"
  :motion-enabled="outlineMotionEnabled"
  :title="editorState.name"
  :content="outlineContent"
  :anchor-id-prefix="editorState.id"
  :active-id="activeAnchorId"
  @change="handleEditorAnchorChange"
  @close="closeOutlineByDrag"
  @button-close="closeOutlineByButton"
/>

<BButton
  v-if="!showOutline"
  class="b-markdown-main__outline-toggle"
  type="ghost"
  size="small"
  square
  icon="lucide:list-indent-increase"
  @click="openOutlineByButton"
/>
```

- [x] **Step 4: 在 Sidebar 中实现常驻显隐与动画类**

在 `src/components/BEditor/components/Sidebar.vue` 中扩展 Props 和 emit：

```ts
interface Props {
  title?: string;
  content?: string;
  anchorIdPrefix?: string;
  activeId?: string;
  /** 是否显示大纲侧栏 */
  visible?: boolean;
  /** 是否临时启用按钮显隐动画 */
  motionEnabled?: boolean;
}

const emit = defineEmits<{
  change: [item: AnchorItem];
  close: [];
  'button-close': [];
}>();
```

将默认属性补充为 `visible: false`、`motionEnabled: false`，将根节点和关闭按钮改为：

```vue
<BPanelSplitter
  v-model:size="sidebarWidth"
  class="b-markdown-sidebar-panel"
  :class="{
    'b-markdown-sidebar-panel--motion': props.motionEnabled,
    'b-markdown-sidebar-panel--visible': props.visible
  }"
  :style="sidebarStyle"
  :inert="!props.visible || undefined"
  :disabled="!props.visible"
  position="right"
  :min-width="180"
  :max-width="400"
  @close="emit('close')"
>
```

```vue
<BButton class="sidebar__toggle" type="ghost" size="small" square icon="lucide:list-indent-decrease" @click="emit('button-close')" />
```

引入 `CSSProperties` 和 `watch`，增加宽度同步：

```ts
/** 大纲侧栏默认宽度。 */
const DEFAULT_SIDEBAR_WIDTH = 260;

/**
 * 大纲侧栏根节点样式。
 */
type SidebarStyle = CSSProperties & {
  /** 当前侧栏宽度 */
  '--markdown-sidebar-width': string;
};

const sidebarWidth = ref(DEFAULT_SIDEBAR_WIDTH);
const sidebarStyle = computed<SidebarStyle>(
  (): SidebarStyle => ({
    '--markdown-sidebar-width': `${sidebarWidth.value}px`
  })
);

watch(
  (): boolean => props.visible,
  (visible: boolean): void => {
    if (visible && sidebarWidth.value === 0) {
      sidebarWidth.value = DEFAULT_SIDEBAR_WIDTH;
    }
  }
);
```

在 Sidebar scoped style 中增加：

```css
.b-markdown-sidebar-panel {
  flex-shrink: 0;
  width: 0;
  min-width: 0;
  pointer-events: none;
  opacity: 0;
  transform: translateX(-12px);
}

.b-markdown-sidebar-panel--motion {
  transition: width 0.36s ease, opacity 0.24s ease, transform 0.36s ease;
  will-change: width, opacity, transform;
}

.b-markdown-sidebar-panel--visible {
  width: var(--markdown-sidebar-width);
  pointer-events: auto;
  opacity: 1;
  transform: translateX(0);
}

@media (prefers-reduced-motion: reduce) {
  .b-markdown-sidebar-panel--motion {
    transition: none;
  }
}
```

Sidebar 动画属性与 `src/layouts/default/components/ChatSider.vue` 保持一致，仅将横移方向镜像为左侧的 `-12px`。`src/components/BEditor/Markdown.vue` 的 `.b-markdown-layout` 继续使用原有 `gap: 6px`。

- [x] **Step 5: 运行测试并确认动画 GREEN**

Run:

```bash
pnpm exec vitest run test/components/BEditor/markdown-outline-toggle.test.ts test/components/BEditor/markdown-scroll-position.test.ts
```

Expected: 所有测试通过。

- [x] **Step 6: 更新 changelog**

将 `changelog/2026-07-30.md` 的条目更新为：

```md
- Markdown 编辑器增加大纲侧栏打开与关闭按钮，并为按钮触发的显隐增加过渡动画。
```

- [x] **Step 7: 运行完整验证**

Run:

```bash
pnpm exec eslint src/components/BEditor/Markdown.vue src/components/BEditor/components/Sidebar.vue test/components/BEditor/markdown-outline-toggle.test.ts
pnpm exec stylelint 'src/components/BEditor/{Markdown.vue,components/Sidebar.vue}'
pnpm exec tsc --noEmit
pnpm exec vitest run test/components/BEditor/markdown-outline-toggle.test.ts test/components/BEditor/markdown-scroll-position.test.ts
git diff --check
```

Expected: 所有命令退出码均为 0，无错误、警告或失败测试。

---

### Task 3: 通用动画控制器与动作因果边界

**Files:**
- Create: `src/hooks/usePanelMotion/index.ts`
- Create: `test/hooks/usePanelMotion.test.ts`
- Modify: `src/components/BPanelSplitter/index.vue`
- Modify: `test/components/BPanelSplitter/index.test.ts`
- Modify: `src/components/BEditor/Markdown.vue`
- Modify: `src/components/BEditor/components/Sidebar.vue`
- Modify: `test/components/BEditor/markdown-outline-toggle.test.ts`
- Modify: `src/layouts/default/index.vue`
- Modify: `src/layouts/default/components/ChatSider.vue`
- Modify: `test/layouts/default/settings-button.test.ts`
- Modify: `changelog/2026-07-30.md`

**Interfaces:**
- Produces: `usePanelMotion(options?: { duration?: number }): UsePanelMotionReturn`。
- Produces: `startMotion(targetVisible: boolean): void`、`syncVisibility(visible: boolean): void`、`cancelMotion(): void`。
- Produces: `BPanelSplitter` 的 `'resize-start': []` 事件。
- Consumes: Markdown 的 `showOutline` 与默认布局的 `settingStore.sidebarVisible`。

- [x] **Step 1: 编写通用控制器失败测试**

在 `test/hooks/usePanelMotion.test.ts` 中用 Vue `effectScope` 和 Vitest fake timers 验证：

```ts
const motion = scope.run(() => usePanelMotion({ duration: 360 }));
motion?.startMotion(true);
expect(motion?.phase.value).toBe('opening');
expect(motion?.motionEnabled.value).toBe(true);

motion?.syncVisibility(true);
expect(motion?.motionEnabled.value).toBe(true);

motion?.syncVisibility(false);
expect(motion?.phase.value).toBe('idle');
expect(motion?.motionEnabled.value).toBe(false);
```

- [x] **Step 2: 运行控制器测试并确认 RED**

Run:

```bash
pnpm exec vitest run test/hooks/usePanelMotion.test.ts
```

Expected: 因 `@/hooks/usePanelMotion` 尚不存在而失败。

- [x] **Step 3: 实现最小控制器**

在 `src/hooks/usePanelMotion/index.ts` 中实现：

```ts
export type PanelMotionPhase = 'idle' | 'opening' | 'closing';

export interface UsePanelMotionOptions {
  duration?: number;
}

export interface UsePanelMotionReturn {
  phase: ComputedRef<PanelMotionPhase>;
  motionEnabled: ComputedRef<boolean>;
  startMotion: (targetVisible: boolean) => void;
  syncVisibility: (visible: boolean) => void;
  cancelMotion: () => void;
}
```

控制器保存当前目标状态和唯一清理定时器；`syncVisibility` 只在目标冲突时取消，`onScopeDispose` 统一清理。

- [x] **Step 4: 验证控制器 GREEN**

Run:

```bash
pnpm exec vitest run test/hooks/usePanelMotion.test.ts
```

Expected: 控制器目标同步、冲突取消、360ms 清理和 scope dispose 测试全部通过。

- [x] **Step 5: 编写拖拽与重叠动作失败测试**

补充以下行为测试：

```ts
expect(wrapper.emitted('resize-start')).toHaveLength(1);

sidebar.vm.$emit('resize-start');
await nextTick();
expect(sidebar.props('motionEnabled')).toBe(false);

store.setShowOutline(false);
await nextTick();
expect(sidebar.props('motionEnabled')).toBe(false);
```

默认布局测试替身同步增加 `resize-start`，验证 ChatSider 拖拽开始和反向程序化显隐都会立即取消动画。

- [x] **Step 6: 运行集成测试并确认 RED**

Run:

```bash
pnpm exec vitest run test/components/BPanelSplitter/index.test.ts test/components/BEditor/markdown-outline-toggle.test.ts test/layouts/default/settings-button.test.ts
```

Expected: 因缺少 `resize-start` 事件和重叠动作取消逻辑而失败。

- [x] **Step 7: 接入两个侧栏**

- `BPanelSplitter.handleMouseDown` 在开始拖拽前发出 `resize-start`。
- Markdown Sidebar 与 ChatSider 向父组件转发 `resize-start`。
- Markdown 与默认布局删除各自的 timer/ref，改用 `usePanelMotion`。
- 两个父组件 watch 各自显隐状态并调用 `syncVisibility`。
- 两个父组件收到 `resize-start` 或拖拽关闭时调用 `cancelMotion`。

- [x] **Step 8: 运行集成测试并确认 GREEN**

Run:

```bash
pnpm exec vitest run test/hooks/usePanelMotion.test.ts test/components/BPanelSplitter/index.test.ts test/components/BEditor/markdown-outline-toggle.test.ts test/components/BEditor/markdown-scroll-position.test.ts test/layouts/default/settings-button.test.ts
```

Expected: 所有目标测试通过。

- [x] **Step 9: 完整验证且不提交**

Run:

```bash
pnpm exec eslint src/hooks/usePanelMotion/index.ts src/components/BPanelSplitter/index.vue src/components/BEditor/Markdown.vue src/components/BEditor/components/Sidebar.vue src/layouts/default/index.vue src/layouts/default/components/ChatSider.vue test/hooks/usePanelMotion.test.ts test/components/BPanelSplitter/index.test.ts test/components/BEditor/markdown-outline-toggle.test.ts test/layouts/default/settings-button.test.ts
pnpm exec stylelint 'src/components/BPanelSplitter/index.vue' 'src/components/BEditor/{Markdown.vue,components/Sidebar.vue}' 'src/layouts/default/components/ChatSider.vue'
pnpm exec tsc --noEmit
git diff --check
```

Expected: 所有命令退出码均为 0；按用户要求不执行 `git add` 或 `git commit`。

---

### Task 4: 泛化显式动作动画控制器

**Files:**
- Create: `src/hooks/useIntentMotion/index.ts`
- Create: `test/hooks/useIntentMotion.test.ts`
- Delete: `src/hooks/usePanelMotion/index.ts`
- Delete: `test/hooks/usePanelMotion.test.ts`
- Modify: `src/components/BEditor/Markdown.vue`
- Modify: `src/layouts/default/index.vue`
- Modify: `docs/superpowers/specs/2026-07-30-markdown-outline-toggle-design.md`
- Modify: `changelog/2026-07-30.md`

**Interfaces:**
- Produces: `useIntentMotion<State>(options?: UseIntentMotionOptions): UseIntentMotionReturn<State>`。
- Produces: `motionEnabled`、`startMotion(targetState)`、`syncState(currentState)`、`cancelMotion()`。
- Removes: 面板专用 `phase`、`syncVisibility` 与 `usePanelMotion` 命名。
- Keeps: Markdown、ChatSider 的视觉过渡、360ms 生命周期和拖拽取消行为。

- [x] **Step 1: 编写泛型接口失败测试**

在 `test/hooks/useIntentMotion.test.ts` 中验证布尔值和字符串枚举状态：

```ts
const booleanMotion = createMotion<boolean>();
booleanMotion.motion.startMotion(true);
booleanMotion.motion.syncState(true);
expect(booleanMotion.motion.motionEnabled.value).toBe(true);

const enumMotion = createMotion<'collapsed' | 'expanded'>();
enumMotion.motion.startMotion('expanded');
enumMotion.motion.syncState('collapsed');
expect(enumMotion.motion.motionEnabled.value).toBe(false);
```

- [x] **Step 2: 运行测试并确认 RED**

Run:

```bash
pnpm exec vitest run test/hooks/useIntentMotion.test.ts
```

Expected: 因 `@/hooks/useIntentMotion` 尚不存在而失败。

- [x] **Step 3: 实现通用控制器并迁移调用方**

实现以下接口：

```ts
export interface UseIntentMotionOptions {
  duration?: number;
}

export interface UseIntentMotionReturn<State> {
  motionEnabled: ComputedRef<boolean>;
  startMotion: (targetState: State) => void;
  syncState: (currentState: State) => void;
  cancelMotion: () => void;
}

export function useIntentMotion<State>(options: UseIntentMotionOptions = {}): UseIntentMotionReturn<State>;
```

控制器使用 `Object.is` 比较实际状态和动作目标，以对象包装目标值来兼容 `null`、`undefined` 等合法泛型状态。Markdown 与默认布局改用 `useIntentMotion<boolean>()` 和 `syncState`。

- [x] **Step 4: 运行目标测试并确认 GREEN**

Run:

```bash
pnpm exec vitest run test/hooks/useIntentMotion.test.ts test/components/BEditor/markdown-outline-toggle.test.ts test/layouts/default/settings-button.test.ts
```

Expected: 泛型控制器与两个既有调用方测试全部通过。

- [x] **Step 5: 删除旧控制器并更新记录**

删除 `src/hooks/usePanelMotion/index.ts` 与 `test/hooks/usePanelMotion.test.ts`，并将 changelog 更新为通用“显式动作动画控制器”描述。全仓搜索不得再出现 `usePanelMotion` 生产代码引用。

- [x] **Step 6: 完整验证且不提交**

Run:

```bash
pnpm exec eslint src/hooks/useIntentMotion/index.ts src/components/BEditor/Markdown.vue src/layouts/default/index.vue test/hooks/useIntentMotion.test.ts test/components/BEditor/markdown-outline-toggle.test.ts test/layouts/default/settings-button.test.ts
pnpm exec tsc --noEmit
pnpm exec vitest run test/hooks/useIntentMotion.test.ts test/components/BPanelSplitter/index.test.ts test/components/BEditor/markdown-outline-toggle.test.ts test/components/BEditor/markdown-scroll-position.test.ts test/layouts/default/settings-button.test.ts
git diff --check
```

Expected: 所有命令退出码均为 0；按用户要求不执行 `git add` 或 `git commit`。
