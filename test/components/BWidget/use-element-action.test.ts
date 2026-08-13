/**
 * @file use-element-action.test.ts
 * @description 验证 BWidget 元素动作 hook 解析动作参数并调用运行态方法。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { readFileSync } from 'node:fs';
import type { VueWrapper } from '@vue/test-utils';
import type { WidgetRenderContext } from 'types/widget';
import type { Component, VNode } from 'vue';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createLiteralValue, createVariableValue } from '@/components/BSmart/utils/value';
import { useElementAction } from '@/components/BWidget/hooks/useElementAction';
import { provideRenderContext } from '@/components/BWidget/hooks/useRenderContext';
import { provideWidgetRuntime, type WidgetRuntimeController } from '@/components/BWidget/hooks/useWidgetRuntime';
import type { WidgetMetadata, WidgetShapeElement } from '@/components/BWidget/types';
import { createDefaultWidgetElementLoopConfig } from '@/components/BWidget/utils/widgetLoop';

/** 元素动作 hook 源码。 */
const USE_ELEMENT_ACTION_SOURCE = readFileSync('src/components/BWidget/hooks/useElementAction.ts', 'utf-8');

/**
 * 测试用动作元素元数据。
 */
interface ActionElementMetadata extends WidgetMetadata {
  /** 方法动作列表 */
  actions?: unknown;
}

/**
 * 创建动作测试元素。
 * @returns 动作测试元素
 */
function createActionElement(): WidgetShapeElement<ActionElementMetadata> {
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
      actions: []
    }
  };
}

/**
 * 挂载动作执行测试组件。
 * @param element - 元素数据
 * @param renderContext - Widget 渲染上下文
 * @param runtime - Widget 运行态控制器
 * @returns 组件包装器
 */
function mountElementAction(
  element: WidgetShapeElement<ActionElementMetadata>,
  renderContext: WidgetRenderContext | undefined,
  runtime: WidgetRuntimeController | undefined
): VueWrapper {
  const elementRef = ref<WidgetShapeElement<ActionElementMetadata> | undefined>(element);
  const contextRef = ref<WidgetRenderContext | undefined>(renderContext);
  const runtimeRef = ref<WidgetRuntimeController | undefined>(runtime);
  const Consumer: Component = {
    name: 'ElementActionConsumer',
    setup(): () => VNode {
      const runActions = useElementAction(elementRef, 'actions');

      return (): VNode => h('button', { onClick: runActions }, '运行');
    }
  };
  const Provider = defineComponent({
    name: 'ElementActionProvider',
    setup(): () => VNode {
      provideRenderContext(contextRef);
      provideWidgetRuntime(runtimeRef);

      return (): VNode => h(Consumer);
    }
  });

  return mount(Provider);
}

describe('useElementAction', (): void => {
  it('keeps action execution separate from element value parsing', (): void => {
    expect(USE_ELEMENT_ACTION_SOURCE).toContain('useElementValue');
    expect(USE_ELEMENT_ACTION_SOURCE).toContain('useWidgetRuntime');
    expect(USE_ELEMENT_ACTION_SOURCE).toContain('useRenderContext');
  });

  it('runs configured method actions with resolved arguments', async (): Promise<void> => {
    const element = createActionElement();
    const runtime: WidgetRuntimeController = {
      run: vi.fn(),
      runInteraction: vi.fn()
    };

    element.metadata.actions = [
      {
        args: [createVariableValue('$input.orderId'), createVariableValue('$input.city'), 1],
        method: ' submitOrder '
      },
      {
        args: [],
        method: 'refreshList'
      },
      {
        args: [],
        method: ''
      },
      null
    ];

    const wrapper = mountElementAction(
      element,
      {
        input: {
          city: '上海',
          orderId: 'A-1024'
        },
        output: undefined,
        data: {}
      },
      runtime
    );

    await wrapper.find('button').trigger('click');

    expect(runtime.run).toHaveBeenNthCalledWith(1, 'submitOrder', 'A-1024', '上海');
    expect(runtime.run).toHaveBeenNthCalledWith(2, 'refreshList');
    expect(runtime.runInteraction).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('does nothing when no runtime controller is provided', async (): Promise<void> => {
    const element = createActionElement();

    element.metadata.actions = [
      {
        args: [createLiteralValue('fixed')],
        method: 'submitOrder'
      }
    ];

    const wrapper = mountElementAction(
      element,
      {
        input: {
          orderId: 'A-1024'
        },
        output: undefined,
        data: {}
      },
      undefined
    );

    await wrapper.find('button').trigger('click');

    expect(wrapper.text()).toBe('运行');
    wrapper.unmount();
  });
});
