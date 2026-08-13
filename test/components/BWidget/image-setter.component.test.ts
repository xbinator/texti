/**
 * @file image-setter.component.test.ts
 * @description 验证 BWidget 图片元素 Setter 的地址、填充模式与替代文本编辑。
 * @vitest-environment jsdom
 */
import { defineComponent, ref } from 'vue';
import type { PropType, Ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { BSmartInputValue, Variable, VariableOptionGroup } from '@/components/BSmart/types';
import { createLiteralValue, isSmartValue } from '@/components/BSmart/utils/value';
import ImageSetter from '@/components/BWidget/elements/Image/Setter.vue';
import { imageElementSchema } from '@/components/BWidget/elements/Image/schema';
import { provideWidgetContext } from '@/components/BWidget/hooks/useWidgetContext';
import type { WidgetData, WidgetElement } from '@/components/BWidget/types';
import { createDefaultWidgetElementLoopConfig } from '@/components/BWidget/utils/widgetLoop';

/**
 * 创建测试图片元素。
 * @returns 测试图片元素
 */
function createImageElement(): WidgetElement {
  return {
    id: 'image-1',
    name: 'image',
    label: '图片',
    icon: 'lucide:image',
    title: '图片名称',
    position: { x: 0, y: 0 },
    size: { width: 120, height: 80 },
    rotation: 0,
    style: {},
    loop: createDefaultWidgetElementLoopConfig(),
    metadata: {
      alt: createLiteralValue(''),
      src: createLiteralValue('https://example.com/a.png'),
      fit: 'cover'
    }
  };
}

/**
 * 测试用变量树节点。
 */
interface VariableTreeNode extends Variable {
  /** 子级变量节点 */
  children?: VariableTreeNode[];
}

/**
 * 创建测试 Widget 数据。
 * @param element - 当前图片元素
 * @returns 测试 Widget 数据
 */
function createWidgetData(element: WidgetElement): WidgetData {
  return {
    name: 'image-widget',
    description: '图片 Widget',
    inputSchema: {
      type: 'object',
      properties: {
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
 * 挂载图片 Setter。
 * @param element - 图片元素
 * @returns 组件包装器
 */
function mountImageSetter(element: WidgetElement): VueWrapper {
  const Host = defineComponent({
    name: 'ImageSetterHost',
    components: {
      ImageSetter
    },
    setup(): { elementModel: Ref<WidgetElement> } {
      const elementModel = ref<WidgetElement>(element);
      const widgetDataRef = ref<WidgetData | undefined>(createWidgetData(element));
      const selectedElementIds = ref<string[]>([element.id]);

      provideWidgetContext({
        widgetData: widgetDataRef,
        selectedElementIds
      });

      return { elementModel };
    },
    template: '<ImageSetter v-model:element="elementModel" />'
  });

  return mount(Host, {
    global: {
      components: {
        BSectionBlock: defineComponent({
          name: 'BSectionBlockStub',
          props: {
            title: { type: String, required: true }
          },
          template: '<section class="widget-image-setter-stub" :data-title="title"><slot></slot></section>'
        }),
        BSectionItem: defineComponent({
          name: 'BSectionItemStub',
          props: {
            label: { type: String, default: undefined },
            direction: { type: String, default: undefined }
          },
          template: '<div class="widget-image-setter-stub-item" :data-label="label"><slot></slot></div>'
        }),
        BSmartInput: defineComponent({
          name: 'BSmartInputStub',
          props: {
            value: { type: Object as PropType<BSmartInputValue>, required: true },
            options: {
              type: Array as PropType<VariableOptionGroup[]>,
              default: (): VariableOptionGroup[] => []
            },
            placeholder: { type: String, default: undefined },
            allowClear: { type: Boolean, default: false }
          },
          emits: {
            /**
             * 更新输入文本。
             * @param value - 新结构化输入值
             * @returns 是否允许触发事件
             */
            'update:value': (value: BSmartInputValue): boolean => isSmartValue(value)
          },
          template:
            '<input class="widget-image-setter-stub-smart-input" :value="value.value" @input="$emit(\'update:value\', { type: \'literal\', value: $event.target.value })" />'
        }),
        BSelect: defineComponent({
          name: 'BSelectStub',
          props: {
            value: { type: [String, Number], default: undefined },
            options: { type: Array, default: (): unknown[] => [] }
          },
          emits: {
            'update:value': (value: string | number): boolean => typeof value === 'string' || typeof value === 'number'
          },
          template: `
            <select class="widget-image-setter-stub-select" :value="value" @change="$emit('update:value', $event.target.value)">
              <option v-for="opt in options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
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

describe('Image Setter', (): void => {
  it('defines structured Smart defaults in the image schema', (): void => {
    expect(imageElementSchema.metadata?.src).toEqual(createLiteralValue(''));
    expect(imageElementSchema.metadata?.alt).toEqual(createLiteralValue(''));
  });

  it('writes src to metadata when the address input changes', async (): Promise<void> => {
    const element = createImageElement();
    const wrapper = mountImageSetter(element);
    const input = wrapper.find('.widget-image-setter-stub-item[data-label="地址"] .widget-image-setter-stub-smart-input');

    await input.setValue('https://cdn.example.com/b.png');

    expect(element.metadata.src).toEqual(createLiteralValue('https://cdn.example.com/b.png'));
    wrapper.unmount();
  });

  it('provides widget variables to the src input', (): void => {
    const wrapper = mountImageSetter(createImageElement());
    const input = wrapper.findComponent({ name: 'BSmartInputStub' });
    const options = input.props('options') as VariableOptionGroup[];
    const variables = readVariables(options).map((item: VariableTreeNode): string => item.value);

    expect(input.props('placeholder')).toBe('图片地址');
    expect(variables).toContain('$input.imageUrl');
    wrapper.unmount();
  });

  it('writes alt to metadata when the alt input changes', async (): Promise<void> => {
    const element = createImageElement();
    const wrapper = mountImageSetter(element);
    const input = wrapper.find('.widget-image-setter-stub-item[data-label="替代文本"] .widget-image-setter-stub-smart-input');

    await input.setValue('一张示意图');

    expect(element.metadata.alt).toEqual(createLiteralValue('一张示意图'));
    wrapper.unmount();
  });

  it('writes fit to metadata when the select changes', async (): Promise<void> => {
    const element = createImageElement();
    const wrapper = mountImageSetter(element);
    const select = wrapper.find('.widget-image-setter-stub-select');

    await select.setValue('contain');

    expect(element.metadata.fit).toBe('contain');
    wrapper.unmount();
  });

  it('initializes inputs with existing metadata values', (): void => {
    const element = createImageElement();
    element.metadata.src = createLiteralValue('https://example.com/init.png');
    element.metadata.fit = 'contain';
    element.metadata.alt = createLiteralValue('初始替代文本');
    const wrapper = mountImageSetter(element);
    const srcInput = wrapper.find('.widget-image-setter-stub-smart-input');
    const altInput = wrapper.find('.widget-image-setter-stub-item[data-label="替代文本"] .widget-image-setter-stub-smart-input');
    const select = wrapper.find('.widget-image-setter-stub-select');

    expect((srcInput.element as HTMLInputElement).value).toBe('https://example.com/init.png');
    expect((select.element as HTMLSelectElement).value).toBe('contain');
    expect((altInput.element as HTMLInputElement).value).toBe('初始替代文本');
    wrapper.unmount();
  });

  it('leaves the select empty when metadata fit is invalid', async (): Promise<void> => {
    const element = createImageElement();
    element.metadata.fit = 'invalid-fit' as unknown as undefined;
    const wrapper = mountImageSetter(element);
    const select = wrapper.find('.widget-image-setter-stub-select');

    expect((select.element as HTMLSelectElement).value).toBe('');
    wrapper.unmount();
  });

  it('preserves unrelated metadata when updating src', async (): Promise<void> => {
    const element = createImageElement();
    element.metadata.helperText = '辅助信息';
    const wrapper = mountImageSetter(element);
    const input = wrapper.find('.widget-image-setter-stub-item[data-label="地址"] .widget-image-setter-stub-smart-input');

    await input.setValue('https://example.com/new.png');

    expect(element.metadata.src).toEqual(createLiteralValue('https://example.com/new.png'));
    expect(element.metadata.fit).toBe('cover');
    expect(element.metadata.helperText).toBe('辅助信息');
    wrapper.unmount();
  });
});
