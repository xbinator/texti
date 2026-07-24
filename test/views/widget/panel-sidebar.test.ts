/**
 * @file panel-sidebar.test.ts
 * @description 验证Widget 页面左侧侧栏 tab 默认展示与 splitter 折叠交互。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { readFileSync } from 'node:fs';
import { defineComponent, nextTick } from 'vue';
import { mount, VueWrapper } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { WidgetData, WidgetElement } from '@/components/BWidget/types';
import { createDefaultWidgetData } from '@/components/BWidget/utils/widgetData';
import PanelSidebar from '@/views/widget/components/PanelSidebar.vue';

const panelSidebarSource = readFileSync('src/views/widget/components/PanelSidebar.vue', 'utf8');
const sidebarActionSource = readFileSync('src/views/widget/components/SidebarAction.vue', 'utf8');

/**
 * 读取指定 Less 选择器的首个规则体。
 * @param source - Vue 单文件组件源码
 * @param selector - 需要匹配的样式选择器
 * @returns 样式规则体，未找到时返回空字符串
 */
function readStyleRuleBody(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{(?<body>[\\s\\S]*?)\\n\\}`, 'u').exec(source);

  return match?.groups?.body ?? '';
}

/**
 * BPanelSplitter 测试替身。
 */
const BPanelSplitterStub = defineComponent({
  name: 'BPanelSplitter',
  props: {
    closable: {
      type: Boolean,
      default: true
    },
    disabled: {
      type: Boolean,
      default: false
    },
    maxWidth: {
      type: [Number, String],
      default: 600
    },
    minWidth: {
      type: [Number, String],
      default: 200
    },
    position: {
      type: String,
      default: 'left'
    },
    size: {
      type: Number,
      required: true
    }
  },
  emits: ['update:size'],
  template: `
    <section
      class="panel-splitter-stub"
      :data-closable="String(closable)"
      :data-disabled="String(disabled)"
      :data-max-width="String(maxWidth)"
      :data-min-width="String(minWidth)"
      :data-position="position"
      :data-size="String(size)"
    >
      <slot />
    </section>
  `
});

/**
 * BButton 测试替身。
 */
const BButtonStub = defineComponent({
  name: 'BButton',
  props: {
    icon: {
      type: String,
      default: ''
    },
    type: {
      type: String,
      default: 'primary'
    }
  },
  emits: ['click'],
  template: '<button class="button-stub" :data-icon="icon" :data-type="type" @click="$emit(\'click\')"><slot /></button>'
});

/**
 * SidebarTools 测试替身。
 */
const SidebarToolsStub = defineComponent({
  name: 'SidebarTools',
  emits: ['drag-start'],
  template: '<button class="sidebar-tools-stub" type="button" @click="$emit(\'drag-start\')">组件</button>'
});

/**
 * SidebarLayer 测试替身。
 */
const SidebarLayerStub = defineComponent({
  name: 'SidebarLayer',
  template: '<div class="sidebar-layer-stub">图层</div>'
});

/**
 * SidebarState 测试替身。
 */
const SidebarStateStub = defineComponent({
  name: 'SidebarState',
  props: {
    value: {
      type: Object,
      required: true
    }
  },
  template: '<div class="sidebar-state-stub">数据源</div>'
});

/**
 * SidebarAction 测试替身。
 */
const SidebarActionStub = defineComponent({
  name: 'SidebarAction',
  props: {
    active: {
      type: Boolean,
      default: false
    },
    value: {
      type: Object,
      required: true
    }
  },
  emits: ['collapse', 'expand', 'save', 'update:value'],
  template: `
    <div class="sidebar-action-stub" :data-active="String(active)">
      <button class="action-expand-stub" @click="$emit('expand')">展开</button>
      <button class="action-collapse-stub" @click="$emit('collapse')">收起</button>
      <button class="action-save-stub" @click="$emit('save')">保存</button>
    </div>
  `
});

/**
 * 挂载左侧侧栏。
 * @param value - 当前 Widget 数据
 * @returns 左侧侧栏包装器
 */
function mountPanelSidebar(value: WidgetData = createDefaultWidgetData()): VueWrapper {
  return mount(PanelSidebar, {
    props: {
      elements: [] as WidgetElement[],
      value
    },
    global: {
      stubs: {
        BButton: BButtonStub,
        BPanelSplitter: BPanelSplitterStub,
        SidebarAction: SidebarActionStub,
        SidebarLayer: SidebarLayerStub,
        SidebarState: SidebarStateStub,
        SidebarTools: SidebarToolsStub
      }
    }
  });
}

describe('PanelSidebar', (): void => {
  it('marks the sidebar as an overlay so it does not reserve canvas width', (): void => {
    const wrapper = mountPanelSidebar();

    expect(wrapper.find('.widget-sidebar').classes()).toContain('widget-sidebar--overlay');

    wrapper.unmount();
  });

  it('shows the tools tab by default instead of an empty expanded panel', (): void => {
    const wrapper = mountPanelSidebar();
    const splitter = wrapper.find('.panel-splitter-stub');

    expect(wrapper.find('.sidebar-tools-stub').exists()).toBe(true);
    expect(splitter.attributes('data-size')).toBe('320');
    expect(splitter.attributes('data-min-width')).toBe('280');
    expect(splitter.attributes('data-max-width')).toBe('440');
    expect(splitter.attributes('data-disabled')).toBe('false');
    expect(wrapper.find('[data-icon="lucide:box"]').attributes('data-type')).toBe('secondary');

    wrapper.unmount();
  });

  it('exposes the current splitter size as a layout variable', async (): Promise<void> => {
    const wrapper = mountPanelSidebar();
    const splitter = wrapper.findComponent(BPanelSplitterStub);
    const sidebar = wrapper.find<HTMLElement>('.widget-sidebar');

    expect(sidebar.attributes('style')).toContain('--widget-sidebar-content-width: 320px;');

    splitter.vm.$emit('update:size', 400);
    await nextTick();

    expect(sidebar.attributes('style')).toContain('--widget-sidebar-content-width: 400px;');

    wrapper.unmount();
  });

  it('only enables expand and collapse motion after action panel button clicks', async (): Promise<void> => {
    vi.useFakeTimers();
    const wrapper = mountPanelSidebar();

    try {
      const sidebar = wrapper.find<HTMLElement>('.widget-sidebar');

      expect(sidebar.classes()).not.toContain('widget-sidebar--expand-motion');

      await wrapper.find('[data-icon="lucide:file-code-corner"]').trigger('click');
      expect(sidebar.classes()).not.toContain('widget-sidebar--expand-motion');

      await wrapper.find('.action-expand-stub').trigger('click');
      expect(sidebar.classes()).toContain('widget-sidebar--expand-motion');

      vi.advanceTimersByTime(360);
      await nextTick();
      expect(sidebar.classes()).not.toContain('widget-sidebar--expand-motion');

      await wrapper.find('.action-collapse-stub').trigger('click');
      expect(sidebar.classes()).toContain('widget-sidebar--expand-motion');

      vi.advanceTimersByTime(360);
      await nextTick();
      expect(sidebar.classes()).not.toContain('widget-sidebar--expand-motion');
    } finally {
      wrapper.unmount();
      vi.useRealTimers();
    }
  });

  it('keeps the splitter mounted while visually hiding it during dragging', async (): Promise<void> => {
    const wrapper = mountPanelSidebar();

    expect(wrapper.find('.panel-splitter-stub').exists()).toBe(true);

    await wrapper.find('.sidebar-tools-stub').trigger('click');
    await nextTick();

    const draggingSplitter = wrapper.find('.panel-splitter-stub');
    expect(draggingSplitter.exists()).toBe(true);
    expect(draggingSplitter.classes()).toContain('widget-sidebar__splitter--dragging');

    window.dispatchEvent(new PointerEvent('pointerup'));
    await nextTick();

    const splitter = wrapper.find('.panel-splitter-stub');
    expect(splitter.exists()).toBe(true);
    expect(splitter.classes()).not.toContain('widget-sidebar__splitter--dragging');
    expect(splitter.attributes('data-size')).toBe('320');

    wrapper.unmount();
  });

  it('expands the action tab with a ChatSider-style splitter state', async (): Promise<void> => {
    const wrapper = mountPanelSidebar();

    await wrapper.find('[data-icon="lucide:file-code-corner"]').trigger('click');
    await wrapper.find('.action-expand-stub').trigger('click');

    const splitter = wrapper.find('.panel-splitter-stub');
    expect(wrapper.find('.sidebar-action-stub').attributes('data-active')).toBe('true');
    expect(wrapper.find('.widget-sidebar').classes()).toContain('widget-sidebar--expanded');
    expect(splitter.classes()).toContain('widget-sidebar__splitter--expanded');
    expect(splitter.attributes('data-disabled')).toBe('true');
    expect(splitter.attributes('data-size')).toBe('320');

    wrapper.unmount();
  });

  it('keeps the current splitter size when collapsing an expanded action tab', async (): Promise<void> => {
    const wrapper = mountPanelSidebar();
    const splitter = wrapper.findComponent(BPanelSplitterStub);

    splitter.vm.$emit('update:size', 400);
    await nextTick();
    await wrapper.find('[data-icon="lucide:file-code-corner"]').trigger('click');
    await wrapper.find('.action-expand-stub').trigger('click');
    await wrapper.find('.action-collapse-stub').trigger('click');

    expect(wrapper.find('.widget-sidebar').classes()).not.toContain('widget-sidebar--expanded');
    expect(wrapper.find('.panel-splitter-stub').attributes('data-disabled')).toBe('false');
    expect(wrapper.find('.panel-splitter-stub').attributes('data-size')).toBe('400');

    wrapper.unmount();
  });

  it('leaves expanded action mode when switching to another tab', async (): Promise<void> => {
    const wrapper = mountPanelSidebar();

    await wrapper.find('[data-icon="lucide:file-code-corner"]').trigger('click');
    await wrapper.find('.action-expand-stub').trigger('click');
    await wrapper.find('[data-icon="lucide:layers"]').trigger('click');

    expect(wrapper.find('.sidebar-layer-stub').exists()).toBe(true);
    expect(wrapper.find('.widget-sidebar').classes()).not.toContain('widget-sidebar--expanded');
    expect(wrapper.find('.widget-sidebar').classes()).not.toContain('widget-sidebar--expand-motion');
    expect(wrapper.find('[data-icon="lucide:layers"]').attributes('data-type')).toBe('secondary');

    wrapper.unmount();
  });

  it('forwards save requests from the action tab', async (): Promise<void> => {
    const wrapper = mountPanelSidebar();

    await wrapper.find('[data-icon="lucide:file-code-corner"]').trigger('click');
    await wrapper.find('.action-save-stub').trigger('click');

    expect(wrapper.emitted('save')).toHaveLength(1);

    wrapper.unmount();
  });

  it('keeps sidebar root and splitter unclipped while only transitioning during explicit action motion', (): void => {
    const sidebarRuleBody = readStyleRuleBody(panelSidebarSource, '.widget-sidebar');
    const splitterRuleBody = readStyleRuleBody(panelSidebarSource, '.widget-sidebar__splitter');
    const expandMotionRuleBody = readStyleRuleBody(panelSidebarSource, '.widget-sidebar--expand-motion');
    const expandMotionSplitterRuleBody = readStyleRuleBody(panelSidebarSource, '.widget-sidebar--expand-motion .widget-sidebar__splitter');

    expect(sidebarRuleBody).not.toContain('overflow: hidden;');
    expect(splitterRuleBody).not.toContain('overflow: hidden;');
    expect(splitterRuleBody).not.toContain('transition:');
    expect(expandMotionRuleBody).toContain('transition: width 0.36s ease, right 0.36s ease, opacity 0.36s ease;');
    expect(expandMotionRuleBody).toContain('will-change: width, right;');
    expect(expandMotionSplitterRuleBody).toContain('transition: width 0.36s ease, opacity 0.36s ease;');
    expect(panelSidebarSource).toContain('@media (prefers-reduced-motion: reduce)');
    expect(panelSidebarSource).not.toContain('action-motion');
    expect(sidebarActionSource).toContain(":icon=\"isExpanded ? 'lucide:minimize-2' : 'lucide:maximize-2'\"");
    expect(sidebarActionSource).not.toContain('action-expand-button');
    expect(sidebarActionSource).not.toContain('action-expand-icon');
    expect(sidebarActionSource).not.toContain(':tooltip=');
  });
});
