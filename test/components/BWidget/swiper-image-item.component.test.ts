/**
 * @file swiper-image-item.component.test.ts
 * @description 验证 BWidget 轮播图图片条目组件的折叠、删除和字段编辑交互。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineComponent } from 'vue';
import type { PropType } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { VariableOptionGroup } from '@/components/BSmart/types';
import SwiperImageItem from '@/components/BWidget/elements/Swiper/components/ImageItem.vue';
import type { WidgetSwiperImageItem } from '@/components/BWidget/elements/Swiper/schema';

/** 测试变量候选。 */
const variableOptions: VariableOptionGroup[] = [
  {
    type: 'variable',
    options: [
      {
        label: '图片地址',
        value: '$input.imageUrl'
      }
    ]
  }
];

/**
 * 创建测试图片项。
 * @param overrides - 图片项覆盖字段
 * @returns 测试图片项
 */
function createImageItem(overrides: Partial<WidgetSwiperImageItem> = {}): WidgetSwiperImageItem {
  return {
    alt: '首图',
    src: 'https://example.com/a.png',
    ...overrides
  };
}

/**
 * 挂载轮播图图片条目组件。
 * @param props - 组件属性
 * @returns 组件包装器
 */
function mountImageItem(props: { collapsed?: boolean; image?: WidgetSwiperImageItem; removable?: boolean } = {}): VueWrapper {
  return mount(SwiperImageItem, {
    props: {
      collapsed: props.collapsed ?? false,
      handleClass: 'drag-handle-from-parent',
      image: props.image ?? createImageItem(),
      index: 0,
      removable: props.removable ?? true,
      variableOptions
    },
    global: {
      components: {
        BButton: defineComponent({
          name: 'BButtonStub',
          props: {
            disabled: { type: Boolean, default: false }
          },
          emits: {
            /**
             * 转发按钮点击事件。
             * @returns 是否允许触发事件
             */
            click: (): boolean => true
          },
          template: '<button v-bind="$attrs" type="button" :disabled="disabled" @click="!disabled && $emit(\'click\')"><slot></slot></button>'
        }),
        BIcon: defineComponent({
          name: 'BIconStub',
          props: {
            icon: { type: String, required: true }
          },
          template: '<span class="widget-swiper-image-item-test-icon" :data-icon="icon"></span>'
        }),
        BSectionItem: defineComponent({
          name: 'BSectionItemStub',
          props: {
            label: { type: String, default: undefined }
          },
          template: '<div class="widget-swiper-image-item-test-section-item" :data-label="label"><slot></slot></div>'
        }),
        BSmartInput: defineComponent({
          name: 'BSmartInputStub',
          props: {
            value: { type: String, default: '' },
            options: {
              type: Array as PropType<VariableOptionGroup[]>,
              default: (): VariableOptionGroup[] => []
            }
          },
          emits: {
            /**
             * 更新输入文本。
             * @param value - 新输入值
             * @returns 是否允许触发事件
             */
            'update:value': (value: string): boolean => typeof value === 'string'
          },
          template: '<input v-bind="$attrs" :value="value" @input="$emit(\'update:value\', $event.target.value)" />'
        })
      }
    }
  });
}

/**
 * 读取图片条目组件源代码。
 * @returns 图片条目组件源代码
 */
function readImageItemSource(): string {
  return readFileSync(resolve(process.cwd(), 'src/components/BWidget/elements/Swiper/components/ImageItem.vue'), 'utf8');
}

/**
 * 读取指定 CSS 选择器的规则内容。
 * @param source - 源代码文本
 * @param selector - CSS 选择器
 * @returns CSS 规则内容
 */
function readStyleRule(source: string, selector: string): string {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')} \\{(?<body>[\\s\\S]*?)\\n\\}`, 'u');

  return pattern.exec(source)?.groups?.body ?? '';
}

describe('SwiperImageItem', (): void => {
  it('renders a compact bar with drag handle, collapse toggle, and delete button', (): void => {
    const wrapper = mountImageItem();

    expect(wrapper.find('.widget-swiper-image-item__drag').classes()).toContain('drag-handle-from-parent');
    expect(wrapper.find('.widget-swiper-image-item__collapse').exists()).toBe(true);
    expect(wrapper.find('.widget-swiper-image-item__remove').exists()).toBe(true);
    expect(wrapper.find('.widget-swiper-image-item__summary').text()).toContain('https://example.com/a.png');
    wrapper.unmount();
  });

  it('does not show an empty image address fallback summary', (): void => {
    const wrapper = mountImageItem({ image: createImageItem({ src: '' }) });

    expect(wrapper.text()).not.toContain('未设置图片地址');
    expect(wrapper.find('.widget-swiper-image-item__summary').exists()).toBe(false);
    wrapper.unmount();
  });

  it('supports editing the row title by clicking it', async (): Promise<void> => {
    const wrapper = mountImageItem();

    await wrapper.find('.widget-swiper-image-item__title').trigger('click');
    const titleInput = wrapper.find('.widget-swiper-image-item__title-input');

    expect(titleInput.exists()).toBe(true);

    await titleInput.setValue('首屏 Banner');
    await titleInput.trigger('keydown.enter');

    expect(wrapper.emitted('update')?.[0]?.[0]).toEqual({
      alt: '首图',
      src: 'https://example.com/a.png',
      title: '首屏 Banner'
    });
    wrapper.unmount();
  });

  it('renders delete before collapse and keeps delete hidden until row hover or focus', (): void => {
    const wrapper = mountImageItem();
    const actionButtons = wrapper.find('.widget-swiper-image-item__actions').findAll('button');
    const source = readImageItemSource();
    const bodyRule = readStyleRule(source, '.widget-swiper-image-item__body');
    const removeRule = readStyleRule(source, '.widget-swiper-image-item__remove');

    expect(actionButtons[0].classes()).toContain('widget-swiper-image-item__remove');
    expect(actionButtons[1].classes()).toContain('widget-swiper-image-item__collapse');
    expect(bodyRule).toContain('padding: 0 8px 8px;');
    expect(bodyRule).not.toContain('36px');
    expect(removeRule).toContain('opacity: 0;');
    expect(source).toContain('.widget-swiper-image-item:hover .widget-swiper-image-item__remove');
    expect(source).toContain('.widget-swiper-image-item:focus-within .widget-swiper-image-item__remove');
    wrapper.unmount();
  });

  it('hides input body when collapsed and emits toggle events', async (): Promise<void> => {
    const wrapper = mountImageItem({ collapsed: true });

    expect(wrapper.find('.widget-swiper-image-item__body').exists()).toBe(false);

    await wrapper.find('.widget-swiper-image-item__collapse').trigger('click');

    expect(wrapper.emitted('toggle-collapse')).toHaveLength(1);
    wrapper.unmount();
  });

  it('emits updated image fields and remove events', async (): Promise<void> => {
    const wrapper = mountImageItem();
    const inputs = wrapper.findAll('input');

    await inputs[0].setValue('https://cdn.example.com/b.png');
    await inputs[1].setValue('第二张');
    await wrapper.find('.widget-swiper-image-item__remove').trigger('click');

    expect(wrapper.emitted('update')?.[0]?.[0]).toEqual({
      alt: '首图',
      src: 'https://cdn.example.com/b.png'
    });
    expect(wrapper.emitted('update')?.[1]?.[0]).toEqual({
      alt: '第二张',
      src: 'https://example.com/a.png'
    });
    expect(wrapper.emitted('remove')).toHaveLength(1);
    wrapper.unmount();
  });
});
