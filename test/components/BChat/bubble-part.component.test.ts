/**
 * @file bubble-part.component.test.ts
 * @description BChat 气泡片段共享容器组件测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file -- 测试需要内联折叠动画与图标桩组件。 */
import { readFileSync } from 'node:fs';
import { defineComponent } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import BubblePart from '@/components/BChat/components/MessageBubble/BubblePart/index.vue';

/** 思考片段组件源码。 */
const THINKING_SOURCE = readFileSync('src/components/BChat/components/MessageBubble/BubblePartThinking/index.vue', 'utf8');
/** 工具片段组件源码。 */
const TOOL_SOURCE = readFileSync('src/components/BChat/components/MessageBubble/BubblePartTool/index.vue', 'utf8');
/** 气泡片段共享容器源码。 */
const BUBBLE_PART_SOURCE = readFileSync('src/components/BChat/components/MessageBubble/BubblePart/index.vue', 'utf8');

/** 折叠动画组件测试替身，用于确认内容通过动画容器渲染。 */
const CollapseTransitionStub = defineComponent({
  name: 'BCollapseTransition',
  template: '<div data-test="collapse-transition"><slot /></div>'
});

/** 图标测试替身，用于暴露当前图标名称。 */
const IconStub = defineComponent({
  name: 'BIcon',
  props: {
    icon: {
      required: true,
      type: String
    }
  },
  template: '<span data-test="bubble-icon" :data-icon="icon" :class="$attrs.class"></span>'
});

/**
 * 挂载气泡片段共享容器。
 * @returns 已挂载的组件包装器
 */
function mountBubblePart(props: Record<string, unknown> = {}): VueWrapper {
  return mount(BubblePart, {
    props: {
      defaultCollapsed: false,
      hasContent: true,
      type: 'tool',
      ...props
    },
    slots: {
      default: '<span data-test="bubble-content">工具内容</span>',
      title: '<span>工具标题</span>'
    },
    global: {
      stubs: {
        BCollapseTransition: CollapseTransitionStub,
        BIcon: IconStub
      }
    }
  });
}

/**
 * 获取当前标题图标名称。
 * @param wrapper - 气泡片段组件包装器
 * @returns 当前图标名称
 */
function getIconName(wrapper: VueWrapper): string | undefined {
  return wrapper.get('[data-test="bubble-icon"]').attributes('data-icon');
}

describe('BubblePart', (): void => {
  it('renders collapsible content inside collapse transition', (): void => {
    const wrapper = mountBubblePart();

    expect(wrapper.find('[data-test="collapse-transition"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="collapse-transition"] [data-test="bubble-content"]').text()).toBe('工具内容');
  });

  it('uses a spacing-free wrapper as the animated collapse root', (): void => {
    const wrapper = mountBubblePart();

    expect(wrapper.find('[data-test="collapse-transition"] > .message-bubble-part__content-wrap').exists()).toBe(true);
    expect(wrapper.find('.message-bubble-part__content-wrap > .message-bubble-part__content').exists()).toBe(true);
  });

  it('renders the default icon for the part type', (): void => {
    const wrapper = mountBubblePart({
      hasContent: false,
      type: 'thinking'
    });

    expect(getIconName(wrapper)).toBe('lucide:sparkles');
  });

  it('renders an overridden spinning title icon', (): void => {
    const wrapper = mountBubblePart({
      hasContent: false,
      icon: 'lucide:loader-circle',
      iconSpin: true,
      type: 'tool'
    });
    const icon = wrapper.get('[data-test="bubble-icon"]');

    expect(icon.attributes('data-icon')).toBe('lucide:loader-circle');
    expect(icon.classes()).toContain('message-bubble-part__icon--spin');
  });

  it('replaces the title icon with the collapse icon while hovering the title', async (): Promise<void> => {
    const wrapper = mountBubblePart({
      icon: 'lucide:hammer'
    });
    const title = wrapper.get('.message-bubble-part__title');

    expect(wrapper.findAllComponents({ name: 'BIcon' })).toHaveLength(1);
    expect(getIconName(wrapper)).toBe('lucide:hammer');

    await title.trigger('mouseover');
    await wrapper.vm.$nextTick();

    expect(wrapper.findAllComponents({ name: 'BIcon' })).toHaveLength(1);
    expect(getIconName(wrapper)).toBe('lucide:chevron-up');

    await title.trigger('mouseleave');
    await wrapper.vm.$nextTick();

    expect(getIconName(wrapper)).toBe('lucide:hammer');

    await title.trigger('click');
    await title.trigger('mouseover');
    await wrapper.vm.$nextTick();

    expect(getIconName(wrapper)).toBe('lucide:chevron-down');
  });

  it('keeps title icons centralized in BubblePart consumers', (): void => {
    expect(THINKING_SOURCE).not.toContain('<BIcon icon="lucide:sparkles"');
    expect(TOOL_SOURCE).not.toContain('<BIcon :icon="icon"');
  });

  it('keeps collapsible spacing inside the animated height box', (): void => {
    expect(BUBBLE_PART_SOURCE).toContain(':class="bem(\'content-wrap\')"');
    expect(BUBBLE_PART_SOURCE).toContain('padding: 0 12px 10px;');
    expect(BUBBLE_PART_SOURCE).not.toContain('margin: 0 12px 10px;');
  });

  it('does not render a separate trailing collapse icon', (): void => {
    expect(BUBBLE_PART_SOURCE).not.toContain('v-if="hasContent" :icon="collapsed ?');
  });
});
