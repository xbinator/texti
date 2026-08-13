/**
 * @file button-element-view.component.test.ts
 * @description 验证 BWidget 按钮元素视图渲染文本和变量插值。
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import type { VueWrapper } from '@vue/test-utils';
import type { WidgetRenderContext } from 'types/widget';
import type { VNode } from 'vue';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { BSmartValue } from '@/components/BSmart/types';
import { createLiteralValue, createVariableValue } from '@/components/BSmart/utils/value';
import ButtonElementView from '@/components/BWidget/elements/Button/index.vue';
import { provideRenderContext, type WidgetRenderContextOptions } from '@/components/BWidget/hooks/useRenderContext';
import { provideWidgetRuntime, type WidgetRuntimeController } from '@/components/BWidget/hooks/useWidgetRuntime';
import type { WidgetShapeElement } from '@/components/BWidget/types';
import { createDefaultWidgetElementLoopConfig } from '@/components/BWidget/utils/widgetLoop';

/** 按钮元素视图源码。 */
const BUTTON_ELEMENT_VIEW_SOURCE = readFileSync('src/components/BWidget/elements/Button/index.vue', 'utf-8');

/**
 * 按钮元素视图挂载选项。
 */
interface ButtonElementViewMountOptions {
  /** Widget 渲染上下文 */
  renderContext?: WidgetRenderContext;
  /** Widget 运行态控制器 */
  runtime?: WidgetRuntimeController;
  /** Widget 渲染选项 */
  renderOptions?: WidgetRenderContextOptions;
}

/**
 * 创建按钮视图测试元素。
 * @param text - 按钮结构化文本
 * @returns 按钮元素
 */
function createButtonElement(text: BSmartValue<string> = createLiteralValue('确认')): WidgetShapeElement {
  return {
    id: 'button-1',
    name: 'button',
    label: '按钮',
    icon: 'lucide:mouse-pointer-click',
    title: '图层名称',
    position: { x: 0, y: 0 },
    size: { width: 120, height: 40 },
    rotation: 0,
    style: {},
    loop: createDefaultWidgetElementLoopConfig(),
    metadata: {
      actions: [],
      disabled: createLiteralValue(false),
      loading: createLiteralValue(false),
      text
    }
  };
}

/**
 * 挂载按钮元素视图。
 * @param element - 按钮元素
 * @param options - 按钮元素视图挂载选项
 * @returns 组件包装器
 */
function mountButtonElementView(element: WidgetShapeElement, options: ButtonElementViewMountOptions = {}): VueWrapper {
  const { renderContext, renderOptions, runtime } = options;
  const contextRef = ref<WidgetRenderContext | undefined>(renderContext);
  const runtimeRef = ref<WidgetRuntimeController | undefined>(runtime);
  const Provider = defineComponent({
    name: 'ButtonElementViewProvider',
    setup(): () => VNode {
      provideRenderContext(contextRef, renderOptions);
      provideWidgetRuntime(runtimeRef);

      return (): VNode => h(ButtonElementView, { element });
    }
  });

  return mount(Provider);
}

describe('ButtonElementView', (): void => {
  it('keeps boolean and action argument parsing free of fallback plumbing', (): void => {
    expect(BUTTON_ELEMENT_VIEW_SOURCE).not.toContain('fallback');
    expect(BUTTON_ELEMENT_VIEW_SOURCE).not.toContain('normalizeButtonBoolean');
    expect(BUTTON_ELEMENT_VIEW_SOURCE).not.toContain('normalizeButtonActions');
    expect(BUTTON_ELEMENT_VIEW_SOURCE).not.toContain('buttonActionsValue');
    expect(BUTTON_ELEMENT_VIEW_SOURCE).not.toContain('useWidgetRuntime');
    expect(BUTTON_ELEMENT_VIEW_SOURCE).not.toContain('useRenderContext');
    expect(BUTTON_ELEMENT_VIEW_SOURCE).not.toContain('resolveButtonAction');
    expect(BUTTON_ELEMENT_VIEW_SOURCE).not.toContain('runButtonAction');
    expect(BUTTON_ELEMENT_VIEW_SOURCE).not.toContain('executeButtonAction');
  });

  it('renders a native button with text from element metadata', (): void => {
    const wrapper = mountButtonElementView(createButtonElement(createLiteralValue('立即提交')));
    const button = wrapper.find('button');

    expect(button.attributes('type')).toBe('button');
    expect(button.text()).toBe('立即提交');
    wrapper.unmount();
  });

  it('resolves a variable button label from render context', (): void => {
    const wrapper = mountButtonElementView(createButtonElement(createVariableValue('$input.orderId')), {
      renderContext: {
        input: {
          orderId: 'A-1024'
        },
        output: undefined,
        data: {}
      },
      renderOptions: { mode: 'runtime' }
    });

    expect(wrapper.find('button').text()).toBe('A-1024');
    wrapper.unmount();
  });

  it('hides variable placeholders in button text outside runtime mode', (): void => {
    const wrapper = mountButtonElementView(createButtonElement(createVariableValue('$input.orderId')), {
      renderContext: {
        input: {
          orderId: 'A-1024'
        },
        output: undefined,
        data: {}
      }
    });

    expect(wrapper.find('button').text()).toBe('');
    wrapper.unmount();
  });

  it('rejects historical primitive and template values in migrated button fields', (): void => {
    const element = createButtonElement('{{ $input.orderId }}' as unknown as BSmartValue<string>);

    element.metadata.disabled = true as unknown as BSmartValue<boolean>;
    const wrapper = mountButtonElementView(element, {
      renderContext: {
        input: { orderId: 'A-1024' },
        output: undefined,
        data: {}
      },
      renderOptions: { mode: 'runtime' }
    });

    expect(wrapper.find('button').text()).toBe('');
    expect(wrapper.find('button').classes()).not.toContain('disabled');
    wrapper.unmount();
  });

  it('renders an empty label when metadata text is missing', (): void => {
    const element = createButtonElement();
    delete element.metadata.text;
    const wrapper = mountButtonElementView(element);

    expect(wrapper.find('button').text()).toBe('');
    wrapper.unmount();
  });

  it('renders loading metadata without native disabled state', (): void => {
    const element = createButtonElement(createLiteralValue('提交'));

    element.metadata.disabled = createLiteralValue(true);
    element.metadata.loading = createLiteralValue(true);

    const wrapper = mountButtonElementView(element);
    const button = wrapper.find('button');

    expect(button.attributes('disabled')).toBeUndefined();
    expect(button.attributes('aria-busy')).toBe('true');
    expect(wrapper.find('.widget-button-element__loading').exists()).toBe(true);
    expect(wrapper.find('.widget-button-element__loading-spinner').exists()).toBe(true);
    wrapper.unmount();
  });

  it('resolves disabled and loading metadata from binding templates', (): void => {
    const element = createButtonElement(createLiteralValue('提交'));

    element.metadata.disabled = createVariableValue('disabled');
    element.metadata.loading = createVariableValue('loading');

    const wrapper = mountButtonElementView(element, {
      renderContext: {
        input: {},
        output: undefined,
        data: {
          disabled: true,
          loading: true
        }
      },
      renderOptions: { mode: 'runtime' }
    });
    const button = wrapper.find('button');

    expect(button.attributes('disabled')).toBeUndefined();
    expect(button.attributes('aria-busy')).toBe('true');
    expect(wrapper.find('.widget-button-element__loading').exists()).toBe(true);
    expect(wrapper.find('.widget-button-element__loading-spinner').exists()).toBe(true);
    wrapper.unmount();
  });

  it('runs configured action method with resolved arguments when clicked', async (): Promise<void> => {
    const element = createButtonElement(createLiteralValue('提交'));
    const runtime: WidgetRuntimeController = {
      run: vi.fn(),
      runInteraction: vi.fn()
    };

    element.metadata.actions = [
      {
        args: [createVariableValue('$input.coffeeId'), createVariableValue('$input.city')],
        method: 'buttonByClick'
      },
      {
        args: [],
        method: 'refreshList'
      }
    ];

    const wrapper = mountButtonElementView(element, {
      renderContext: {
        input: {
          city: '上海',
          coffeeId: 'latte'
        },
        output: undefined,
        data: {}
      },
      runtime
    });

    await wrapper.find('button').trigger('click');

    expect(runtime.run).toHaveBeenNthCalledWith(1, 'buttonByClick', 'latte', '上海');
    expect(runtime.run).toHaveBeenNthCalledWith(2, 'refreshList');
    expect(runtime.runInteraction).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('does not run action methods while disabled or loading', async (): Promise<void> => {
    const element = createButtonElement(createLiteralValue('提交'));
    const runtime: WidgetRuntimeController = {
      run: vi.fn(),
      runInteraction: vi.fn()
    };

    element.metadata.actions = [
      {
        args: [],
        method: 'buttonByClick'
      }
    ];
    element.metadata.disabled = createLiteralValue(true);
    element.metadata.loading = createLiteralValue(true);

    const wrapper = mountButtonElementView(element, { runtime });

    await wrapper.find('button').trigger('click');

    expect(runtime.run).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
