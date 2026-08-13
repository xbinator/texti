/**
 * @file use-element-value.test.ts
 * @description 验证 BWidget 元素值 hook 按 metadata 字段推导类型并解析渲染上下文。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import type { VueWrapper } from '@vue/test-utils';
import type { WidgetRenderContext } from 'types/widget';
import type { Component, ComputedRef, VNode } from 'vue';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { BSmartValue } from '@/components/BSmart/types';
import { createLiteralValue, createVariableValue } from '@/components/BSmart/utils/value';
import type { WidgetButtonElementMetadata } from '@/components/BWidget/elements/Button/schema';
import type { WidgetImageElementMetadata } from '@/components/BWidget/elements/Image/schema';
import type { WidgetTextElementMetadata } from '@/components/BWidget/elements/Text/schema';
import { useElementValue } from '@/components/BWidget/hooks/useElementValue';
import type { UseElementValueTransform, WidgetElementValue } from '@/components/BWidget/hooks/useElementValue';
import { provideRenderContext, type WidgetRenderContextOptions } from '@/components/BWidget/hooks/useRenderContext';
import type { WidgetMetadata, WidgetShapeElement } from '@/components/BWidget/types';
import { createDefaultWidgetElementLoopConfig } from '@/components/BWidget/utils/widgetLoop';
import type { MethodAction } from '@/components/BWidget/utils/widgetMethods';

/**
 * 测试用展示元素元数据。
 */
interface DisplayElementMetadata extends WidgetMetadata {
  /** 文本正文内容 */
  content?: string;
  /** 最大显示行数 */
  maxLines?: number;
  /** 方法动作列表 */
  actions?: unknown;
  /** 副标题内容 */
  subtitle: string;
  /** Smart 布尔值 */
  smartBoolean: BSmartValue<boolean>;
  /** Smart 文本值 */
  smartText: BSmartValue<string>;
}

/**
 * useElementValue 返回类型提取工具。
 */
type UseElementValueReturn<
  TMetadata extends WidgetMetadata,
  TField extends keyof TMetadata & string,
  TTransform extends UseElementValueTransform<WidgetElementValue<TMetadata, TField>> | undefined = undefined
> = ReturnType<typeof useElementValue<TMetadata, TField, TTransform>>;

/**
 * 测试用元素值选项。
 */
interface DisplayValueOptions {
  /** 是否严格按 Smart 值协议解析字段 */
  smart?: boolean;
  /** 值转换方式 */
  transform?: 'boolean' | 'method' | 'text' | ((value: DisplayElementMetadata[keyof DisplayElementMetadata] | undefined) => unknown);
}

/**
 * 展示值测试组件挂载选项。
 */
interface DisplayValueMountOptions {
  /** Widget 渲染上下文 */
  renderContext?: WidgetRenderContext;
  /** 元素值解析选项 */
  valueOptions?: DisplayValueOptions;
  /** Widget 渲染选项 */
  renderOptions?: WidgetRenderContextOptions;
}

/**
 * 创建文本展示测试元素。
 * @param content - 元素内容模板
 * @returns 文本元素
 */
function createDisplayElement(content?: string): WidgetShapeElement<DisplayElementMetadata> {
  return {
    id: 'text-1',
    name: 'text',
    label: '文本',
    icon: 'lucide:type',
    title: '图层名称',
    position: { x: 0, y: 0 },
    size: { width: 120, height: 32 },
    rotation: 0,
    style: {},
    loop: createDefaultWidgetElementLoopConfig(),
    metadata: {
      content,
      smartBoolean: createLiteralValue(true),
      smartText: createVariableValue('$input.city'),
      subtitle: '副标题：{{ $input.city }}'
    }
  };
}

/**
 * 挂载展示值测试组件。
 * @param element - 元素数据
 * @param fieldName - 元数据字段名称
 * @param options - 展示值测试组件挂载选项
 * @returns 组件包装器
 */
function mountDisplayValue<TField extends keyof DisplayElementMetadata & string>(
  element: WidgetShapeElement<DisplayElementMetadata>,
  fieldName: TField,
  options: DisplayValueMountOptions = {}
): VueWrapper {
  const { renderContext, renderOptions, valueOptions } = options;
  const elementRef = ref<WidgetShapeElement<DisplayElementMetadata> | undefined>(element);
  const contextRef = ref<WidgetRenderContext | undefined>(renderContext);
  const Consumer: Component = {
    name: 'ElementValueConsumer',
    setup(): () => VNode {
      const value = useElementValue(elementRef, fieldName, valueOptions);

      return (): VNode => h('span', typeof value.value === 'object' ? JSON.stringify(value.value) : String(value.value ?? ''));
    }
  };
  const Provider = defineComponent({
    name: 'ElementValueProvider',
    setup(): () => VNode {
      provideRenderContext(contextRef, renderOptions);

      return (): VNode => h(Consumer);
    }
  });

  return mount(Provider);
}

describe('useElementValue', (): void => {
  it('unwraps structured Smart values before applying transforms', (): void => {
    const context: WidgetRenderContext = {
      input: { city: '上海' },
      output: undefined,
      data: {}
    };
    const textWrapper = mountDisplayValue(createDisplayElement(), 'smartText', {
      renderContext: context,
      renderOptions: { mode: 'runtime' },
      valueOptions: { smart: true, transform: 'text' }
    });
    const booleanWrapper = mountDisplayValue(createDisplayElement(), 'smartBoolean', {
      valueOptions: { smart: true, transform: 'boolean' }
    });

    expect(textWrapper.text()).toBe('上海');
    expect(booleanWrapper.text()).toBe('true');
    textWrapper.unmount();
    booleanWrapper.unmount();
  });

  it('rejects primitive and template values when strict Smart parsing is enabled', (): void => {
    const element = createDisplayElement();

    element.metadata.smartBoolean = true as unknown as BSmartValue<boolean>;
    element.metadata.smartText = '{{ $input.city }}' as unknown as BSmartValue<string>;
    const booleanWrapper = mountDisplayValue(element, 'smartBoolean', {
      valueOptions: { smart: true, transform: 'boolean' }
    });
    const textWrapper = mountDisplayValue(element, 'smartText', {
      renderContext: {
        input: { city: '上海' },
        output: undefined,
        data: {}
      },
      renderOptions: { mode: 'runtime' },
      valueOptions: { smart: true, transform: 'text' }
    });

    expect(booleanWrapper.text()).toBe('false');
    expect(textWrapper.text()).toBe('');
    booleanWrapper.unmount();
    textWrapper.unmount();
  });

  it('infers value type from metadata field name', (): void => {
    expectTypeOf<UseElementValueReturn<WidgetTextElementMetadata, 'content'>>().toEqualTypeOf<ComputedRef<string | undefined>>();
    expectTypeOf<UseElementValueReturn<WidgetTextElementMetadata, 'content', 'text'>>().toEqualTypeOf<ComputedRef<string>>();
    expectTypeOf<UseElementValueReturn<WidgetTextElementMetadata, 'content', 'boolean'>>().toEqualTypeOf<ComputedRef<boolean>>();
    expectTypeOf<UseElementValueReturn<WidgetButtonElementMetadata, 'actions', 'method'>>().toEqualTypeOf<ComputedRef<MethodAction[]>>();
    expectTypeOf<UseElementValueReturn<WidgetTextElementMetadata, 'content', (value: string | undefined) => number>>().toEqualTypeOf<ComputedRef<number>>();
    expectTypeOf<UseElementValueReturn<WidgetTextElementMetadata, 'maxLines'>>().toEqualTypeOf<ComputedRef<number | undefined>>();
    expectTypeOf<UseElementValueReturn<WidgetImageElementMetadata, 'src'>>().toEqualTypeOf<ComputedRef<string | undefined>>();
    expectTypeOf<UseElementValueReturn<WidgetImageElementMetadata, 'fit'>>().toEqualTypeOf<ComputedRef<WidgetImageElementMetadata['fit'] | undefined>>();
  });

  it('hides template variables in design mode even when a render context exists', (): void => {
    const wrapper = mountDisplayValue(createDisplayElement('{{ $input.city }} 天气'), 'content', {
      renderContext: {
        input: {
          city: '上海'
        },
        output: undefined,
        data: {}
      }
    });

    expect(wrapper.text()).toBe('天气');
    wrapper.unmount();
  });

  it('reads a template field and resolves it from the widget render context in runtime mode', (): void => {
    const wrapper = mountDisplayValue(createDisplayElement('{{ $input.city }} 天气'), 'content', {
      renderContext: {
        input: {
          city: '上海'
        },
        output: undefined,
        data: {}
      },
      renderOptions: { mode: 'runtime' }
    });

    expect(wrapper.text()).toBe('上海 天气');
    wrapper.unmount();
  });

  it('returns a complex whole-binding value without stringifying it in the hook', (): void => {
    const wrapper = mountDisplayValue(createDisplayElement('{{ weather }}'), 'content', {
      renderContext: {
        input: {},
        output: undefined,
        data: {
          weather: {
            condition: '晴',
            temperature: 28
          }
        }
      },
      renderOptions: { mode: 'runtime' }
    });

    expect(wrapper.text()).toBe('{"condition":"晴","temperature":28}');
    expect(wrapper.text()).not.toBe('[object Object]');
    wrapper.unmount();
  });

  it('transforms to text only when requested by options', (): void => {
    const wrapper = mountDisplayValue(createDisplayElement('{{ weather }}'), 'content', {
      renderContext: {
        input: {},
        output: undefined,
        data: {
          weather: {
            condition: '晴',
            temperature: 28
          }
        }
      },
      valueOptions: { transform: 'text' },
      renderOptions: { mode: 'runtime' }
    });

    expect(wrapper.text()).toBe('{\n  "condition": "晴",\n  "temperature": 28\n}');
    wrapper.unmount();
  });

  it('transforms to boolean only when requested by options', (): void => {
    const wrapper = mountDisplayValue(createDisplayElement('unexpected'), 'content', {
      valueOptions: { transform: 'boolean' }
    });

    expect(wrapper.text()).toBe('false');
    wrapper.unmount();
  });

  it('supports a custom transform function', (): void => {
    const wrapper = mountDisplayValue(createDisplayElement('提交'), 'content', {
      valueOptions: {
        transform: (value: DisplayElementMetadata[keyof DisplayElementMetadata] | undefined): number => (typeof value === 'string' ? value.length : 0)
      }
    });

    expect(wrapper.text()).toBe('2');
    wrapper.unmount();
  });

  it('transforms to method actions only when requested by options', (): void => {
    const element = createDisplayElement();

    element.metadata.actions = [
      {
        args: [createVariableValue('$input.orderId'), createLiteralValue('城市'), 1],
        method: ' submitOrder '
      },
      {
        args: [],
        method: ''
      },
      null
    ];

    const wrapper = mountDisplayValue(element, 'actions', {
      valueOptions: { transform: 'method' }
    });

    expect(wrapper.text()).toBe('[{"args":[{"type":"variable","value":"$input.orderId"},{"type":"literal","value":"城市"}],"method":"submitOrder"}]');
    wrapper.unmount();
  });

  it('returns an empty rendered value when the metadata field is missing', (): void => {
    const wrapper = mountDisplayValue(createDisplayElement(), 'content');

    expect(wrapper.text()).toBe('');
    wrapper.unmount();
  });

  it('supports an explicit field name for secondary template content', (): void => {
    const wrapper = mountDisplayValue(createDisplayElement('正文'), 'subtitle', {
      renderContext: {
        input: {
          city: '上海'
        },
        output: undefined,
        data: {}
      },
      renderOptions: { mode: 'runtime' }
    });

    expect(wrapper.text()).toBe('副标题：上海');
    wrapper.unmount();
  });
});
