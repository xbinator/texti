/**
 * @file markdown-outline-toggle.test.ts
 * @description Markdown 大纲侧栏按钮、动画触发边界与显隐交互测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file -- 测试需要内联按钮、侧栏和分隔器桩组件。 */
import { readFileSync } from 'node:fs';
import { defineComponent, nextTick, type ComponentPublicInstance } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Sidebar from '@/components/BEditor/components/Sidebar.vue';
import Markdown from '@/components/BEditor/Markdown.vue';
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

const SidebarStub = defineComponent({
  name: 'Sidebar',
  props: {
    visible: Boolean,
    motionEnabled: Boolean
  },
  emits: ['change', 'close', 'resize-start', 'button-close'],
  template: '<div class="sidebar-stub"></div>'
});

const BPanelSplitterStub = defineComponent({
  name: 'BPanelSplitter',
  props: {
    size: {
      type: Number,
      default: 260
    }
  },
  emits: ['update:size', 'close', 'resize-start'],
  template: '<div class="splitter-stub"><slot /></div>'
});

const sidebarSource = readFileSync('src/components/BEditor/components/Sidebar.vue', 'utf8');
const markdownSource = readFileSync('src/components/BEditor/Markdown.vue', 'utf8');

/**
 * Sidebar 测试挂载属性。
 */
interface SidebarMountProps {
  /** 是否显示侧栏 */
  visible?: boolean;
  /** 是否启用动画 */
  motionEnabled?: boolean;
}

type SidebarTestInstance = ComponentPublicInstance<SidebarMountProps>;

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
        Sidebar: SidebarStub,
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

/**
 * 挂载真实 Sidebar，并隔离按钮、分隔器和锚点列表。
 * @param props - Sidebar 测试属性
 * @returns Sidebar 组件包装器
 */
function mountSidebar(props: SidebarMountProps = {}): VueWrapper<SidebarTestInstance> {
  return mount(Sidebar, {
    props,
    global: {
      stubs: {
        BButton: BButtonStub,
        BPanelSplitter: BPanelSplitterStub,
        AnchorContent: true
      }
    }
  }) as unknown as VueWrapper<SidebarTestInstance>;
}

describe('Markdown outline toggle', (): void => {
  afterEach((): void => {
    vi.useRealTimers();
  });

  beforeEach((): void => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it('opens the outline from the main area without title attributes', async (): Promise<void> => {
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
    await nextTick();

    expect(sidebar.props('motionEnabled')).toBe(false);
  });

  it('enables motion only for the Sidebar close button', async (): Promise<void> => {
    vi.useFakeTimers();
    const store = useEditorPreferencesStore();
    store.setShowOutline(true);
    const wrapper = mountMarkdown();
    const sidebar = wrapper.findComponent(SidebarStub);

    sidebar.vm.$emit('button-close');
    await nextTick();

    expect(store.showOutline).toBe(false);
    expect(sidebar.props('visible')).toBe(false);
    expect(sidebar.props('motionEnabled')).toBe(true);

    await vi.advanceTimersByTimeAsync(360);
    await nextTick();

    expect(sidebar.props('motionEnabled')).toBe(false);
  });

  it('cancels active button motion when splitter resizing starts', async (): Promise<void> => {
    vi.useFakeTimers();
    const store = useEditorPreferencesStore();
    store.setShowOutline(false);
    const wrapper = mountMarkdown();
    const sidebar = wrapper.findComponent(SidebarStub);

    await wrapper.find('.b-markdown-main__outline-toggle').trigger('click');
    expect(sidebar.props('motionEnabled')).toBe(true);

    sidebar.vm.$emit('resize-start');
    await nextTick();

    expect(sidebar.props('motionEnabled')).toBe(false);
  });

  it('cancels active button motion for a conflicting programmatic update', async (): Promise<void> => {
    vi.useFakeTimers();
    const store = useEditorPreferencesStore();
    store.setShowOutline(false);
    const wrapper = mountMarkdown();
    const sidebar = wrapper.findComponent(SidebarStub);

    await wrapper.find('.b-markdown-main__outline-toggle').trigger('click');
    expect(sidebar.props('motionEnabled')).toBe(true);

    store.setShowOutline(false);
    await nextTick();

    expect(sidebar.props('motionEnabled')).toBe(false);
  });

  it('does not enable motion for splitter close or programmatic visibility', async (): Promise<void> => {
    const store = useEditorPreferencesStore();
    store.setShowOutline(false);
    const wrapper = mountMarkdown();
    const sidebar = wrapper.findComponent(SidebarStub);

    store.setShowOutline(true);
    await nextTick();

    expect(sidebar.props('visible')).toBe(true);
    expect(sidebar.props('motionEnabled')).toBe(false);

    sidebar.vm.$emit('close');
    await nextTick();

    expect(store.showOutline).toBe(false);
    expect(sidebar.props('visible')).toBe(false);
    expect(sidebar.props('motionEnabled')).toBe(false);
  });

  it('emits button-close from the decrease-indent button even without a title', async (): Promise<void> => {
    const wrapper = mountSidebar({ visible: true });
    const closeButton = wrapper.find('button.sidebar__toggle');

    expect(closeButton.attributes('data-icon')).toBe('lucide:list-indent-decrease');
    expect(closeButton.attributes('title')).toBeUndefined();
    expect(closeButton.attributes('aria-label')).toBeUndefined();

    await closeButton.trigger('click');

    expect(wrapper.emitted('button-close')).toHaveLength(1);
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('forwards splitter resize-start separately from close', async (): Promise<void> => {
    const wrapper = mountSidebar({ visible: true });
    const splitter = wrapper.findComponent(BPanelSplitterStub);

    splitter.vm.$emit('resize-start');
    await nextTick();

    expect(wrapper.emitted('resize-start')).toHaveLength(1);
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('adds visibility and motion classes only from explicit props', async (): Promise<void> => {
    const wrapper = mountSidebar({ visible: false, motionEnabled: false });

    expect(wrapper.find('.b-markdown-sidebar-panel').exists()).toBe(true);
    expect(wrapper.find('.b-markdown-sidebar-panel--visible').exists()).toBe(false);
    expect(wrapper.find('.b-markdown-sidebar-panel--motion').exists()).toBe(false);
    expect(wrapper.findComponent(BPanelSplitterStub).attributes('inert')).toBeDefined();

    await wrapper.setProps({ visible: true, motionEnabled: true });

    expect(wrapper.find('.b-markdown-sidebar-panel--visible').exists()).toBe(true);
    expect(wrapper.find('.b-markdown-sidebar-panel--motion').exists()).toBe(true);
    expect(wrapper.findComponent(BPanelSplitterStub).attributes('inert')).toBeUndefined();
  });

  it('restores the default width after the splitter closes at zero width', async (): Promise<void> => {
    const wrapper = mountSidebar({ visible: true });
    const splitter = wrapper.findComponent(BPanelSplitterStub);

    splitter.vm.$emit('update:size', 0);
    await nextTick();
    await wrapper.setProps({ visible: false });
    await wrapper.setProps({ visible: true });

    expect(splitter.props('size')).toBe(260);
    expect(splitter.attributes('style')).toContain('--markdown-sidebar-width: 260px;');
  });

  it('scopes width and fade transitions to the motion class', (): void => {
    expect(sidebarSource).toContain('.b-markdown-sidebar-panel--motion {');
    expect(sidebarSource).toContain('transition: width 0.36s ease, opacity 0.24s ease, transform 0.36s ease;');
    expect(sidebarSource).not.toContain('margin-right 0.36s ease');
    expect(sidebarSource).toContain('@media (prefers-reduced-motion: reduce)');
    expect(markdownSource).toContain('gap: 6px;');
  });
});
