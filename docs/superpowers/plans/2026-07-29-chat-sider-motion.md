# ChatSider Button Motion Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Limit ChatSider open/close animation to the top toggle button and internal close button while restoring immediate splitter resizing and its visible drag handle.

**Architecture:** `src/layouts/default/index.vue` owns a non-persisted 360ms motion flag and passes it to ChatSider. ChatSider separates its internal button-close event from `BPanelSplitter @close`; only the parent-owned button paths enable the motion class, while splitter and programmatic Store updates remain immediate.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript strict mode, Pinia, Less, Vitest, Vue Test Utils.

## Global Constraints

- Do not modify the shared `BPanelSplitter` implementation or persisted Setting Store shape.
- Only the top auxiliary-sidebar toggle button and ChatSider internal close button may enable motion.
- Splitter close and programmatic `sidebarVisible` updates must remain immediate.
- Keep the 360ms duration aligned between TypeScript and Less.
- Do not use `any`; all parameters and return values require explicit types.
- All added interfaces, functions, and non-obvious logic require accurate comments.
- Use repository-relative paths in documentation and changelog entries.
- Update `changelog/2026-07-29.md`.

---

### Task 1: Add button-scoped ChatSider motion

**Files:**
- Modify: `test/layouts/default/chat-sider.test.ts`
- Modify: `test/layouts/default/settings-button.test.ts`
- Modify: `src/layouts/default/components/ChatSider.vue`
- Modify: `src/layouts/default/index.vue`
- Modify: `changelog/2026-07-29.md`

**Interfaces:**
- ChatSider consumes: `motionEnabled?: boolean`.
- ChatSider produces: `'button-close': []`.
- Default layout produces no new shared API; `sidebarMotionEnabled` remains local view state.

- [x] **Step 1: Write failing ChatSider boundary tests**

In `test/layouts/default/chat-sider.test.ts`, let the mount helper accept typed props:

```ts
/**
 * ChatSider 测试挂载属性。
 */
interface ChatSiderMountProps {
  /** 是否启用按钮显隐动画 */
  motionEnabled?: boolean;
}

/**
 * 挂载 ChatSider。
 * @param props - 组件挂载属性
 * @returns 组件包装器
 */
function mountChatSider(props: ChatSiderMountProps = {}): ReturnType<typeof mount> {
  return mount(ChatSider, {
    props,
    global: {
      stubs: {
        AInput: AInputStub,
        BIcon: true,
        BPanelSplitter: BPanelSplitterStub
      }
    }
  });
}
```

Replace the existing permanent-animation source assertion and close-button test with coverage for explicit motion, programmatic visibility, button close, splitter close, and overflow:

```ts
it('only adds the motion class when motion is explicitly enabled', async (): Promise<void> => {
  const settingStore = useSettingStore();
  settingStore.setSidebarVisible(false);
  const wrapper = mountChatSider();
  const sider = wrapper.find('.b-panel-splitter');

  settingStore.setSidebarVisible(true);
  await nextTick();
  expect(sider.classes()).toContain('chat-sider--visible');
  expect(sider.classes()).not.toContain('chat-sider--motion');

  await wrapper.setProps({ motionEnabled: true });
  expect(sider.classes()).toContain('chat-sider--motion');
});

it('requests animated close only from the internal close button', async (): Promise<void> => {
  const settingStore = useSettingStore();
  settingStore.setSidebarVisible(true);
  const wrapper = mountChatSider();
  await flushPromises();

  const closeButton = wrapper
    .findAllComponents({ name: 'BButton' })
    .find((button) => button.findComponent({ name: 'BIcon' }).attributes('icon') === 'lucide:x');
  await closeButton?.trigger('click');

  expect(wrapper.emitted('button-close')).toEqual([[]]);
  expect(settingStore.sidebarVisible).toBe(true);

  wrapper.findComponent({ name: 'BPanelSplitter' }).vm.$emit('close');
  await nextTick();

  expect(settingStore.sidebarVisible).toBe(false);
  expect(wrapper.emitted('button-close')).toEqual([[]]);
});

it('scopes transitions to motion and leaves the splitter handle unclipped', (): void => {
  const rootStyle = chatSiderSource.match(/\.chat-sider \{(?<body>[\s\S]*?)\n\}/u)?.groups?.body ?? '';
  const contentStyle = chatSiderSource.match(/\.chat-sider__content \{(?<body>[\s\S]*?)\n\}/u)?.groups?.body ?? '';

  expect(chatSiderSource).toContain(':class="bem({ motion: props.motionEnabled, visible: settingStore.sidebarVisible })"');
  expect(chatSiderSource).toContain('.chat-sider--motion {');
  expect(rootStyle).not.toContain('overflow: hidden;');
  expect(rootStyle).not.toContain('transition:');
  expect(contentStyle).toContain('overflow: hidden;');
  expect(chatSiderSource).toContain('transition: width 0.36s ease, opacity 0.24s ease, transform 0.36s ease;');
  expect(chatSiderSource).toContain('@media (prefers-reduced-motion: reduce)');
});
```

- [x] **Step 2: Write failing default-layout motion tests**

In `test/layouts/default/settings-button.test.ts`, add `afterEach`, import the Setting Store, and define a ChatSider stub that exposes the new contract:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingStore } from '@/stores/ui/setting';

/**
 * ChatSider 测试替身，暴露动画属性与内部按钮关闭事件。
 */
const ChatSiderStub = defineComponent({
  name: 'ChatSider',
  props: {
    motionEnabled: { type: Boolean, default: false }
  },
  emits: ['button-close'],
  template: '<aside class="chat-sider-stub"></aside>'
});
```

Use `ChatSiderStub` in `mountDefaultLayout`, add `afterEach` to restore timers, and add a helper that finds the slotted sidebar icon:

```ts
/**
 * 读取辅助工具侧边栏切换按钮。
 * @param wrapper - 默认布局 wrapper
 * @returns 侧边栏切换按钮 wrapper
 */
function getSidebarButton(wrapper: VueWrapper): VueWrapper {
  const button = wrapper.findAllComponents(BButtonStub).find((item): boolean => {
    const icon = item.find('.icon-stub');

    return icon.exists() && icon.attributes('data-icon')?.startsWith('tabler:layout-sidebar-right') === true;
  });
  if (!button) throw new Error('Missing sidebar toggle button');

  return button;
}
```

Add tests for both authorized button paths and an unauthorized programmatic path:

```ts
it('enables temporary motion when the top sidebar button toggles visibility', async (): Promise<void> => {
  vi.useFakeTimers();
  const settingStore = useSettingStore();
  settingStore.setSidebarVisible(false);
  const wrapper = mountDefaultLayout();
  const chatSider = wrapper.findComponent(ChatSiderStub);

  await getSidebarButton(wrapper).trigger('click');
  await nextTick();

  expect(settingStore.sidebarVisible).toBe(true);
  expect(chatSider.props('motionEnabled')).toBe(true);

  await vi.advanceTimersByTimeAsync(360);
  expect(chatSider.props('motionEnabled')).toBe(false);
});

it('enables temporary motion when ChatSider requests button close', async (): Promise<void> => {
  vi.useFakeTimers();
  const settingStore = useSettingStore();
  settingStore.setSidebarVisible(true);
  const wrapper = mountDefaultLayout();
  const chatSider = wrapper.findComponent(ChatSiderStub);

  chatSider.vm.$emit('button-close');
  await nextTick();

  expect(settingStore.sidebarVisible).toBe(false);
  expect(chatSider.props('motionEnabled')).toBe(true);

  await vi.advanceTimersByTimeAsync(360);
  expect(chatSider.props('motionEnabled')).toBe(false);
});

it('keeps programmatic sidebar visibility changes free of motion', async (): Promise<void> => {
  const settingStore = useSettingStore();
  const wrapper = mountDefaultLayout();
  const chatSider = wrapper.findComponent(ChatSiderStub);

  settingStore.setSidebarVisible(true);
  await nextTick();

  expect(chatSider.props('motionEnabled')).toBe(false);
});
```

Add this lifecycle cleanup after the test group setup:

```ts
afterEach((): void => {
  vi.useRealTimers();
});
```

- [x] **Step 3: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run test/layouts/default/chat-sider.test.ts test/layouts/default/settings-button.test.ts
```

Expected: FAIL because ChatSider does not declare `motionEnabled` or emit `button-close`, the default layout does not pass transient motion state, and root styles still permanently transition and clip overflow.

- [x] **Step 4: Implement the ChatSider contract and scoped styles**

In `src/layouts/default/components/ChatSider.vue`, change the splitter binding and close handlers:

```vue
<BPanelSplitter
  v-model:size="settingStore.sidebarWidth"
  :class="bem({ motion: props.motionEnabled, visible: settingStore.sidebarVisible })"
  :inert="settingStore.sidebarVisible ? undefined : true"
  :style="siderStyle"
  position="left"
  :min-width="340"
  max-width="40%"
  @close="handleSplitterClose"
>
```

```vue
<BButton square size="small" type="text" @click="requestButtonClose">
  <BIcon icon="lucide:x" :size="16" />
</BButton>
```

Add the typed property and event contract after `ChatSiderStyle`:

```ts
/**
 * ChatSider 组件属性。
 */
interface Props {
  /** 是否临时启用按钮触发的显隐动画 */
  motionEnabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  motionEnabled: false
});

const emit = defineEmits<{
  /** 请求通过内部关闭按钮关闭侧栏 */
  'button-close': [];
}>();
```

Replace `handleClose` with separate paths:

```ts
/**
 * 处理分隔器拖拽关闭，不启用按钮动画。
 */
function handleSplitterClose(): void {
  settingStore.setSidebarVisible(false);
}

/**
 * 请求通过内部关闭按钮关闭侧栏。
 */
function requestButtonClose(): void {
  emit('button-close');
}
```

Move the transition declarations out of `.chat-sider`, remove its `overflow: hidden`, and scope reduced motion to the transient class:

```less
.chat-sider {
  flex-shrink: 0;
  width: 0;
  min-width: 0;
  max-width: 40%;
  pointer-events: none;
  opacity: 0;
  transform: translateX(12px);
}

.chat-sider--motion {
  transition: width 0.36s ease, opacity 0.24s ease, transform 0.36s ease;
  will-change: width, opacity, transform;
}

@media (prefers-reduced-motion: reduce) {
  .chat-sider--motion {
    transition: none;
  }
}
```

- [x] **Step 5: Implement default-layout one-shot motion**

In `src/layouts/default/index.vue`, pass the motion state and handle the child event:

```vue
<ChatSider :motion-enabled="sidebarMotionEnabled" @button-close="handleSidebarClose" />
```

Add local constants and state near the existing route constants:

```ts
/** 侧栏拖拽关闭后重新打开使用的默认宽度。 */
const SIDEBAR_DEFAULT_WIDTH = 340;
/** 按钮触发的侧栏显隐动画时长，需与 ChatSider Less 过渡保持一致。 */
const SIDEBAR_MOTION_DURATION = 360;
/** 是否临时启用侧栏按钮显隐动画。 */
const sidebarMotionEnabled = ref(false);
/** 侧栏动画状态清理定时器。 */
let sidebarMotionTimer: number | null = null;
```

Extend the existing `onUnmounted` callback:

```ts
onUnmounted((): void => {
  tabsStore.unsubscribeFromFileWatchEvents();
  clearSidebarMotion();
});
```

Add the motion helpers and update the button handlers:

```ts
/**
 * 清理侧栏按钮动画定时器。
 */
function clearSidebarMotion(): void {
  if (sidebarMotionTimer === null) {
    return;
  }

  window.clearTimeout(sidebarMotionTimer);
  sidebarMotionTimer = null;
}

/**
 * 临时启用侧栏按钮显隐动画。
 */
function enableSidebarMotion(): void {
  clearSidebarMotion();
  sidebarMotionEnabled.value = true;
  sidebarMotionTimer = window.setTimeout((): void => {
    sidebarMotionEnabled.value = false;
    sidebarMotionTimer = null;
  }, SIDEBAR_MOTION_DURATION);
}

/**
 * 切换右侧辅助栏显示状态。
 * 如果侧边栏宽度为 0（通过拖拽关闭），重新打开时恢复为默认宽度。
 */
function handleToggleSidebar(): void {
  enableSidebarMotion();
  if (!settingStore.sidebarVisible && settingStore.sidebarWidth === 0) {
    settingStore.setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
  }
  settingStore.toggleSidebar();
}

/**
 * 处理 ChatSider 内部关闭按钮请求。
 */
function handleSidebarClose(): void {
  enableSidebarMotion();
  settingStore.setSidebarVisible(false);
}
```

- [x] **Step 6: Update the changelog**

Append to `changelog/2026-07-29.md` under `## Fixed`:

```markdown
- 修复聊天侧栏在拖拽和程序化显隐时错误播放动画、分隔器拖拽手柄被裁剪的问题，仅在顶部切换按钮和侧栏内部关闭按钮操作时启用显隐动画。
```

- [x] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
pnpm exec vitest run test/layouts/default/chat-sider.test.ts test/layouts/default/settings-button.test.ts
```

Expected: both files PASS with no warnings or unhandled errors.

- [x] **Step 8: Run static checks**

Run:

```bash
pnpm exec eslint src/layouts/default/components/ChatSider.vue src/layouts/default/index.vue test/layouts/default/chat-sider.test.ts test/layouts/default/settings-button.test.ts
pnpm exec stylelint 'src/layouts/default/**/*.{vue,less,css}'
pnpm exec tsc --noEmit
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 9: Commit the atomic fix**

Review and stage only the planned files:

```bash
git diff -- src/layouts/default/components/ChatSider.vue src/layouts/default/index.vue test/layouts/default/chat-sider.test.ts test/layouts/default/settings-button.test.ts changelog/2026-07-29.md docs/superpowers/plans/2026-07-29-chat-sider-motion.md
git add src/layouts/default/components/ChatSider.vue src/layouts/default/index.vue test/layouts/default/chat-sider.test.ts test/layouts/default/settings-button.test.ts changelog/2026-07-29.md docs/superpowers/plans/2026-07-29-chat-sider-motion.md
git commit -m "fix(layout): 修复聊天侧栏按钮动画与拖拽"
```

Expected: one commit containing the tests, implementation, changelog, and implementation plan.
