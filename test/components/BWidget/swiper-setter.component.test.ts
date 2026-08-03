/**
 * @file swiper-setter.component.test.ts
 * @description 验证 BWidget 轮播图元素 Setter 编辑图片列表、播放参数与指示器配置。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { defineComponent, ref } from 'vue';
import type { PropType, Ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { BDraggableMoveEvent } from '@/components/BDraggable/types';
import type { Variable, VariableOptionGroup } from '@/components/BSmart/types';
import type { WidgetSwiperElementMetadata } from '@/components/BWidget/elements/Swiper/schema';
import SwiperSetter from '@/components/BWidget/elements/Swiper/Setter.vue';
import { provideWidgetContext } from '@/components/BWidget/hooks/useWidgetContext';
import type { WidgetData, WidgetElement } from '@/components/BWidget/types';
import { createDefaultWidgetElementLoopConfig } from '@/components/BWidget/utils/widgetLoop';

/**
 * 测试用变量树节点。
 */
interface VariableTreeNode extends Variable {
  /** 子级变量节点 */
  children?: VariableTreeNode[];
}

/**
 * 测试中的轮播图图片拖拽项。
 */
interface SwiperImageEntry {
  /** 拖拽项唯一标识 */
  key: string;
  /** 当前图片下标 */
  index: number;
  /** 图片项 */
  image: WidgetSwiperElementMetadata['images'][number];
}

/**
 * 创建测试轮播图元素。
 * @returns 测试轮播图元素
 */
function createSwiperElement(): WidgetElement<WidgetSwiperElementMetadata> {
  return {
    id: 'swiper-1',
    name: 'swiper',
    label: '轮播图',
    icon: 'lucide:gallery-horizontal-end',
    title: '轮播图名称',
    position: { x: 0, y: 0 },
    size: { width: 240, height: 160 },
    rotation: 0,
    style: {},
    loop: createDefaultWidgetElementLoopConfig(),
    metadata: {
      autoplay: false,
      autoplayInterval: 3000,
      animationDuration: 300,
      fit: 'cover',
      images: [
        {
          alt: '首图',
          src: 'https://example.com/a.png'
        }
      ],
      indicatorColor: '#ffffff',
      indicatorShape: 'dot',
      initialIndex: 0,
      loop: true,
      showIndicator: true,
      vertical: false
    }
  };
}

/**
 * 创建包含两张图片的测试轮播图元素。
 * @returns 测试轮播图元素
 */
function createMultiImageElement(): WidgetElement<WidgetSwiperElementMetadata> {
  const element = createSwiperElement();

  element.metadata.images = [
    {
      alt: '第一张',
      src: 'https://example.com/a.png'
    },
    {
      alt: '第二张',
      src: 'https://example.com/b.png'
    }
  ];

  return element;
}

/**
 * 创建测试 Widget 数据。
 * @param element - 当前轮播图元素
 * @returns 测试 Widget 数据
 */
function createWidgetData(element: WidgetElement): WidgetData {
  return {
    name: 'swiper-widget',
    description: '轮播图 Widget',
    inputSchema: {
      type: 'object',
      properties: {
        altText: {
          type: 'string',
          description: '替代文本'
        },
        imageUrl: {
          type: 'string',
          description: '图片地址'
        }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {},
      required: []
    },
    dataSchema: {
      type: 'object',
      properties: {}
    },
    execute: {
      code: ''
    },
    metadata: {
      previewContext: {
        input: {
          altText: '示意图',
          imageUrl: 'https://example.com/input.png'
        },
        output: undefined,
        data: {}
      }
    },
    elements: [element]
  };
}

/**
 * 挂载轮播图 Setter。
 * @param element - 轮播图元素
 * @returns 组件包装器
 */
function mountSwiperSetter(element: WidgetElement<WidgetSwiperElementMetadata>): VueWrapper {
  const Host = defineComponent({
    name: 'SwiperSetterHost',
    components: {
      SwiperSetter
    },
    setup(): { elementModel: Ref<WidgetElement<WidgetSwiperElementMetadata>> } {
      const elementModel = ref<WidgetElement<WidgetSwiperElementMetadata>>(element);
      const widgetDataRef = ref<WidgetData | undefined>(createWidgetData(element));
      const selectedElementIds = ref<string[]>([element.id]);

      provideWidgetContext({
        widgetData: widgetDataRef,
        selectedElementIds
      });

      return { elementModel };
    },
    template: '<SwiperSetter v-model:element="elementModel" />'
  });

  return mount(Host, {
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
        BDraggable: defineComponent({
          name: 'BDraggable',
          props: {
            handleClass: { type: String, default: '' },
            list: {
              type: Array as PropType<SwiperImageEntry[]>,
              required: true
            }
          },
          emits: {
            /**
             * 发出拖拽排序事件。
             * @param event - 拖拽排序事件
             * @returns 是否允许触发事件
             */
            move: (event: BDraggableMoveEvent<SwiperImageEntry>): boolean => Array.isArray(event.nextList)
          },
          template: `
            <div v-bind="$attrs" class="widget-swiper-setter-test-draggable">
              <div v-for="(item, index) in list" :key="item.key" class="widget-swiper-setter-test-draggable-item">
                <slot
                  :item="item"
                  :index="index"
                  :item-key="item.key"
                  :handle-class="handleClass"
                  :dragging="false"
                  :dragging-key="null"
                  :drop-position="null"
                />
              </div>
            </div>
          `
        }),
        BColorPicker: defineComponent({
          name: 'BColorPickerStub',
          props: {
            value: { type: String, default: '' }
          },
          emits: {
            /**
             * 更新颜色值。
             * @param value - 新颜色值
             * @returns 是否允许触发事件
             */
            'update:value': (value: string): boolean => typeof value === 'string'
          },
          template: '<input class="widget-swiper-setter-stub-color" :value="value" @input="$emit(\'update:value\', $event.target.value)" />'
        }),
        BInputNumber: defineComponent({
          name: 'BInputNumberStub',
          props: {
            value: { type: Number, default: undefined },
            min: { type: Number, default: undefined },
            precision: { type: Number, default: undefined }
          },
          emits: {
            /**
             * 更新数字值。
             * @param value - 新数字值
             * @returns 是否允许触发事件
             */
            'update:value': (value: number): boolean => typeof value === 'number'
          },
          template: '<input type="number" :value="value" @input="$emit(\'update:value\', Number($event.target.value))" />'
        }),
        BSectionBlock: defineComponent({
          name: 'BSectionBlockStub',
          props: {
            title: { type: String, required: true }
          },
          template: `
            <section class="widget-swiper-setter-stub-block" :data-title="title">
              <header class="widget-swiper-setter-stub-block-extra"><slot name="extra"></slot></header>
              <slot></slot>
            </section>
          `
        }),
        BSectionItem: defineComponent({
          name: 'BSectionItemStub',
          props: {
            label: { type: String, default: undefined }
          },
          template: '<div class="widget-swiper-setter-stub-item" :data-label="label"><slot></slot></div>'
        }),
        BIcon: defineComponent({
          name: 'BIconStub',
          props: {
            icon: { type: String, required: true }
          },
          template: '<span class="widget-swiper-setter-test-icon" :data-icon="icon"></span>'
        }),
        BSelect: defineComponent({
          name: 'BSelectStub',
          props: {
            value: { type: [String, Number], default: undefined },
            options: {
              type: Array as PropType<Array<{ label: string; value: string | number }>>,
              default: (): Array<{ label: string; value: string | number }> => []
            }
          },
          emits: {
            /**
             * 更新选择值。
             * @param value - 新选择值
             * @returns 是否允许触发事件
             */
            'update:value': (value: string | number): boolean => typeof value === 'string' || typeof value === 'number'
          },
          template: `
            <select :value="value" @change="$emit('update:value', $event.target.value)">
              <option v-for="opt in options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          `
        }),
        BSmartInput: defineComponent({
          name: 'BSmartInputStub',
          props: {
            value: { type: String, default: '' },
            options: {
              type: Array as PropType<VariableOptionGroup[]>,
              default: (): VariableOptionGroup[] => []
            },
            placeholder: { type: String, default: undefined }
          },
          emits: {
            /**
             * 更新输入文本。
             * @param value - 新输入值
             * @returns 是否允许触发事件
             */
            'update:value': (value: string): boolean => typeof value === 'string'
          },
          template: '<input :value="value" @input="$emit(\'update:value\', $event.target.value)" />'
        }),
        BSmartSelect: defineComponent({
          name: 'BSmartSelectStub',
          props: {
            value: { type: [String, Number, Boolean, null], default: undefined },
            options: {
              type: Array as PropType<Array<{ label: string; value: string | number | boolean | null }>>,
              default: (): Array<{ label: string; value: string | number | boolean | null }> => []
            }
          },
          emits: {
            /**
             * 更新智能选择值。
             * @param value - 新选择值
             * @returns 是否允许触发事件
             */
            'update:value': (value: string | number | boolean | null): boolean => ['string', 'number', 'boolean'].includes(typeof value) || value === null
          },
          methods: {
            /**
             * 根据选项下标触发真实静态值。
             * @param event - 选择事件
             */
            handleChange(event: Event): void {
              const target = event.target as HTMLSelectElement;
              const option = this.options[Number(target.value)] as { value: string | number | boolean | null } | undefined;
              if (option) {
                this.$emit('update:value', option.value);
              }
            }
          },
          template: `
            <select :value="options.findIndex((opt) => opt.value === value)" @change="handleChange">
              <option v-for="(opt, index) in options" :key="index" :value="index">{{ opt.label }}</option>
            </select>
          `
        })
      }
    }
  });
}

/**
 * 扁平化变量树。
 * @param variables - 变量树节点列表
 * @returns 扁平变量列表
 */
function flattenVariableTree(variables: VariableTreeNode[]): VariableTreeNode[] {
  return variables.flatMap((item: VariableTreeNode): VariableTreeNode[] => [item, ...flattenVariableTree(item.children ?? [])]);
}

/**
 * 读取变量分组中的全部变量。
 * @param options - 变量分组选项
 * @returns 扁平变量列表
 */
function readVariables(options: VariableOptionGroup[]): VariableTreeNode[] {
  return options.flatMap((group: VariableOptionGroup): VariableTreeNode[] => flattenVariableTree(group.options as VariableTreeNode[]));
}

describe('Swiper Setter', (): void => {
  it('writes image src and alt to metadata when inputs change', async (): Promise<void> => {
    const element = createSwiperElement();
    const wrapper = mountSwiperSetter(element);

    await wrapper.find('.widget-swiper-setter__src-input').setValue('https://cdn.example.com/b.png');
    await wrapper.find('.widget-swiper-setter__alt-input').setValue('第二张');

    expect(element.metadata.images[0]).toEqual({
      alt: '第二张',
      src: 'https://cdn.example.com/b.png'
    });
    wrapper.unmount();
  });

  it('provides widget variables to image src and alt inputs', (): void => {
    const wrapper = mountSwiperSetter(createSwiperElement());
    const inputs = wrapper.findAllComponents({ name: 'BSmartInputStub' });
    const srcVariables = readVariables(inputs[0].props('options') as VariableOptionGroup[]).map((item: VariableTreeNode): string => item.value);
    const altVariables = readVariables(inputs[1].props('options') as VariableOptionGroup[]).map((item: VariableTreeNode): string => item.value);

    expect(srcVariables).toContain('$input.imageUrl');
    expect(altVariables).toContain('$input.altText');
    wrapper.unmount();
  });

  it('adds and removes image rows while keeping one row', async (): Promise<void> => {
    const element = createSwiperElement();
    const wrapper = mountSwiperSetter(element);
    const imageBlock = wrapper.find('.widget-swiper-setter-stub-block[data-title="图片"]');

    await imageBlock.find('.widget-swiper-setter-stub-block-extra button').trigger('click');
    expect(element.metadata.images).toHaveLength(2);

    await wrapper.findAll('.widget-swiper-setter__remove')[0].trigger('click');
    expect(element.metadata.images).toHaveLength(1);

    await wrapper.find('.widget-swiper-setter__remove').trigger('click');
    expect(element.metadata.images).toHaveLength(1);
    wrapper.unmount();
  });

  it('renders the add button in the image block extra slot', async (): Promise<void> => {
    const element = createSwiperElement();
    const wrapper = mountSwiperSetter(element);
    const imageBlock = wrapper.find('.widget-swiper-setter-stub-block[data-title="图片"]');
    const addButton = imageBlock.find('.widget-swiper-setter-stub-block-extra button');

    expect(addButton.classes()).not.toContain('widget-swiper-setter__add');
    expect(addButton.attributes('tooltip')).toBeUndefined();

    await addButton.trigger('click');

    expect(element.metadata.images).toHaveLength(2);
    wrapper.unmount();
  });

  it('renders image items through BDraggable and reorders metadata images on move', (): void => {
    const element = createMultiImageElement();
    const wrapper = mountSwiperSetter(element);
    const draggable = wrapper.findComponent({ name: 'BDraggable' });
    const list = draggable.props('list') as SwiperImageEntry[];
    const nextList = [list[1], list[0]];

    draggable.vm.$emit('move', {
      nextList,
      position: 'after',
      sourceIndex: 0,
      sourceItem: list[0],
      sourceKey: list[0].key,
      targetIndex: 1,
      targetItem: list[1],
      targetKey: list[1].key
    } satisfies BDraggableMoveEvent<SwiperImageEntry>);

    expect(element.metadata.images.map((image: WidgetSwiperElementMetadata['images'][number]): string => image.src)).toEqual([
      'https://example.com/b.png',
      'https://example.com/a.png'
    ]);
    wrapper.unmount();
  });

  it('keeps image row collapsed state outside metadata', async (): Promise<void> => {
    const element = createSwiperElement();
    const wrapper = mountSwiperSetter(element);

    expect(wrapper.find('.widget-swiper-image-item__body').exists()).toBe(true);

    await wrapper.find('.widget-swiper-image-item__collapse').trigger('click');

    expect(wrapper.find('.widget-swiper-image-item__body').exists()).toBe(false);
    expect(element.metadata.images[0]).toEqual({
      alt: '首图',
      src: 'https://example.com/a.png'
    });
    expect('collapsed' in element.metadata.images[0]).toBe(false);
    wrapper.unmount();
  });

  it('updates fit and playback metadata fields', async (): Promise<void> => {
    const element = createSwiperElement();
    const wrapper = mountSwiperSetter(element);

    await wrapper.find('.widget-swiper-setter__fit-select').setValue('contain');
    await wrapper.find('.widget-swiper-setter__autoplay-select').setValue('1');
    await wrapper.find('.widget-swiper-setter__interval-input').setValue('1200');
    await wrapper.find('.widget-swiper-setter__duration-input').setValue('450');
    await wrapper.find('.widget-swiper-setter__initial-index-input').setValue('2');
    await wrapper.find('.widget-swiper-setter__loop-select').setValue('0');
    await wrapper.find('.widget-swiper-setter__vertical-select').setValue('1');

    expect(element.metadata.fit).toBe('contain');
    expect(element.metadata.autoplay).toBe(true);
    expect(element.metadata.autoplayInterval).toBe(1200);
    expect(element.metadata.animationDuration).toBe(450);
    expect(element.metadata.initialIndex).toBe(2);
    expect(element.metadata.loop).toBe(false);
    expect(element.metadata.vertical).toBe(true);
    wrapper.unmount();
  });

  it('updates indicator visibility, color, and shape', async (): Promise<void> => {
    const element = createSwiperElement();
    const wrapper = mountSwiperSetter(element);
    const shapeSelect = wrapper.find('.widget-swiper-setter__indicator-shape-select');

    await wrapper.find('.widget-swiper-setter__indicator-visible-select').setValue('0');
    await wrapper.find('.widget-swiper-setter__indicator-color').setValue('#ff3366');
    await shapeSelect.setValue('active-line');

    expect(shapeSelect.text()).toContain('激活短线');
    expect(shapeSelect.text()).not.toContain('胶囊');
    expect(element.metadata.showIndicator).toBe(false);
    expect(element.metadata.indicatorColor).toBe('#ff3366');
    expect(element.metadata.indicatorShape).toBe('active-line');
    wrapper.unmount();
  });
});
