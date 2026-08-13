/**
 * @file useElementValue.ts
 * @description BWidget 元素元数据字段值 hook。
 */
import type { WidgetMetadata, WidgetShapeElement } from '../types';
import type { ComputedRef, Ref } from 'vue';
import { computed } from 'vue';
import type { BSmartValue } from '@/components/BSmart/types';
import { formatWidgetDisplayTextValue, resolveWidgetDisplayValue, resolveWidgetSmartValue } from '../utils/widgetBindings';
import { normalizeMethodActions, type MethodAction } from '../utils/widgetMethods';
import { useRenderContext } from './useRenderContext';

/**
 * Smart 字段解析后的底层值类型。
 */
type ResolvedMetadataValue<TValue> = NonNullable<TValue> extends BSmartValue<infer TLiteral> ? TLiteral | undefined : TValue | undefined;

/**
 * 元素元数据字段解析后的值类型。
 */
export type WidgetElementValue<TMetadata extends WidgetMetadata, TField extends keyof TMetadata> = ResolvedMetadataValue<TMetadata[TField]>;

/**
 * 元素元数据字段值转换方式。
 */
export type UseElementValueTransformName = 'boolean' | 'method' | 'text';

/**
 * 元素元数据字段值转换函数。
 */
export type UseElementValueTransformFunction<TValue, TResult = unknown> = (value: TValue) => TResult;

/**
 * 元素元数据字段值转换配置。
 */
export type UseElementValueTransform<TValue = unknown> = UseElementValueTransformName | UseElementValueTransformFunction<TValue>;

/**
 * 元素元数据字段值 hook 选项。
 */
export interface UseElementValueOptions<TValue, TTransform extends UseElementValueTransform<TValue> | undefined = undefined> {
  /** 是否只接受结构化 Smart 值，避免迁移字段进入旧模板解析路径 */
  smart?: boolean;
  /** 解析后的值转换方式 */
  transform?: TTransform;
}

/**
 * 元素元数据字段最终计算值类型。
 */
export type UseElementValueResult<
  TMetadata extends WidgetMetadata,
  TField extends keyof TMetadata,
  TTransform extends UseElementValueTransform<WidgetElementValue<TMetadata, TField>> | undefined = undefined
> = TTransform extends 'text'
  ? string
  : TTransform extends 'boolean'
  ? boolean
  : TTransform extends 'method'
  ? MethodAction[]
  : TTransform extends UseElementValueTransformFunction<WidgetElementValue<TMetadata, TField>, infer TResult>
  ? TResult
  : WidgetElementValue<TMetadata, TField>;

/**
 * 将未知值规整为布尔控制值。
 * @param value - 解析后的字段值
 * @returns 布尔控制值
 */
function normalizeWidgetBooleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return false;
}

/**
 * 按选项规整元素字段最终输出值。
 * @param fieldValue - 解析后的字段值
 * @param options - 元素值解析选项
 * @returns 字段最终输出值
 */
function normalizeElementValueResult<
  TMetadata extends WidgetMetadata,
  TField extends keyof TMetadata,
  TTransform extends UseElementValueTransform<WidgetElementValue<TMetadata, TField>> | undefined = undefined
>(
  fieldValue: WidgetElementValue<TMetadata, TField>,
  options: UseElementValueOptions<WidgetElementValue<TMetadata, TField>, TTransform> = {}
): UseElementValueResult<TMetadata, TField, TTransform> {
  if (options.transform === 'text') {
    return formatWidgetDisplayTextValue(fieldValue) as UseElementValueResult<TMetadata, TField, TTransform>;
  }

  if (options.transform === 'boolean') {
    return normalizeWidgetBooleanValue(fieldValue) as UseElementValueResult<TMetadata, TField, TTransform>;
  }

  if (options.transform === 'method') {
    return normalizeMethodActions(fieldValue) as UseElementValueResult<TMetadata, TField, TTransform>;
  }

  if (typeof options.transform === 'function') {
    return options.transform(fieldValue) as UseElementValueResult<TMetadata, TField, TTransform>;
  }

  return fieldValue as UseElementValueResult<TMetadata, TField, TTransform>;
}

/**
 * 创建元素元数据字段值计算值。
 * @param element - 当前元素
 * @param fieldName - 元数据字段名称
 * @param options - 元素值解析选项
 * @returns 元素字段值
 */
export function useElementValue<
  TMetadata extends WidgetMetadata,
  TField extends keyof TMetadata & string,
  TTransform extends UseElementValueTransform<WidgetElementValue<TMetadata, TField>> | undefined = undefined
>(
  element: Readonly<Ref<WidgetShapeElement<TMetadata> | undefined>>,
  fieldName: TField,
  options: UseElementValueOptions<WidgetElementValue<TMetadata, TField>, TTransform> = {}
): ComputedRef<UseElementValueResult<TMetadata, TField, TTransform>> {
  const renderState = useRenderContext();

  return computed<UseElementValueResult<TMetadata, TField, TTransform>>((): UseElementValueResult<TMetadata, TField, TTransform> => {
    const currentElement = element.value;

    if (!currentElement) {
      return normalizeElementValueResult<TMetadata, TField, TTransform>(undefined as WidgetElementValue<TMetadata, TField>, options);
    }

    const fieldValue = currentElement.metadata[fieldName];
    const resolveOptions = {
      renderContext: renderState.renderContext.value,
      renderOptions: renderState.options.value
    };
    const resolvedValue = options.smart
      ? resolveWidgetSmartValue(fieldValue as BSmartValue<unknown> | undefined, resolveOptions)
      : resolveWidgetDisplayValue(fieldValue, resolveOptions);

    return normalizeElementValueResult<TMetadata, TField, TTransform>(resolvedValue as WidgetElementValue<TMetadata, TField>, options);
  });
}
