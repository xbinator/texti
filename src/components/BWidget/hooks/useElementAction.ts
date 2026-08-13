/**
 * @file useElementAction.ts
 * @description BWidget 元素动作执行 hook。
 */
import type { WidgetMetadata, WidgetShapeElement } from '../types';
import type { MethodAction } from '../utils/widgetMethods';
import type { WidgetRenderContext } from 'types/widget';
import type { Ref } from 'vue';
import type { BSmartValue } from '@/components/BSmart/types';
import { resolveWidgetSmartValue } from '../utils/widgetBindings';
import { useElementValue } from './useElementValue';
import { useRenderContext } from './useRenderContext';
import { useWidgetRuntime, type WidgetRuntimeController } from './useWidgetRuntime';

/**
 * 元素动作执行器。
 */
export type ElementActionRunner = () => void;

/**
 * 解析方法动作参数。
 * @param argument - 结构化方法参数
 * @param renderContext - Widget 渲染上下文
 * @returns 解析后的参数值
 */
function resolveElementActionArgument(argument: BSmartValue<string>, renderContext: WidgetRenderContext | undefined): unknown {
  return resolveWidgetSmartValue(argument, {
    renderContext,
    renderOptions: { mode: 'runtime' }
  });
}

/**
 * 解析方法动作参数列表。
 * @param action - 方法动作配置
 * @param renderContext - Widget 渲染上下文
 * @returns 解析后的参数列表
 */
function resolveElementActionArgs(action: MethodAction, renderContext: WidgetRenderContext | undefined): unknown[] {
  return action.args.map((argument: BSmartValue<string>): unknown => resolveElementActionArgument(argument, renderContext));
}

/**
 * 运行单个元素方法动作。
 * @param action - 方法动作配置
 * @param renderContext - Widget 渲染上下文
 * @param runtime - Widget 运行态控制器
 */
function runElementAction(action: MethodAction, renderContext: WidgetRenderContext | undefined, runtime: WidgetRuntimeController | undefined): void {
  runtime?.run(action.method, ...resolveElementActionArgs(action, renderContext));
}

/**
 * 创建元素动作执行器。
 * @param element - 当前元素
 * @param fieldName - 元数据动作字段名称
 * @returns 元素动作执行器
 */
export function useElementAction<TMetadata extends WidgetMetadata, TField extends keyof TMetadata & string>(
  element: Readonly<Ref<WidgetShapeElement<TMetadata> | undefined>>,
  fieldName: TField
): ElementActionRunner {
  const actions = useElementValue(element, fieldName, { transform: 'method' });
  const renderState = useRenderContext();
  const runtime = useWidgetRuntime();

  return (): void => {
    actions.value.forEach((action: MethodAction): void => runElementAction(action, renderState.renderContext.value, runtime.value));
  };
}
