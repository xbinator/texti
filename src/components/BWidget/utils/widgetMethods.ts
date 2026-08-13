/**
 * @file widgetMethods.ts
 * @description BWidget 方法配置规整工具。
 */
import type { BSmartMethodAction, BSmartValue } from '@/components/BSmart/types';
import { createLiteralValue, createVariableValue, isLiteralValue, isVariableValue } from '@/components/BSmart/utils/value';

/** 方法动作配置。 */
export type MethodAction = BSmartMethodAction;

/**
 * 判断值是否为普通对象。
 * @param value - 待判断值
 * @returns 是否为普通对象
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 规整单个方法参数。
 * @param value - 原始方法参数
 * @returns 合法的结构化参数，非法值返回 null
 */
function normalizeMethodArgument(value: unknown): BSmartValue<string> | null {
  if (isVariableValue(value)) {
    return createVariableValue(value.value);
  }

  if (isLiteralValue(value) && typeof value.value === 'string') {
    return createLiteralValue(value.value);
  }

  return null;
}

/**
 * 规整方法动作。
 * @param value - 原始方法动作
 * @returns 可执行的方法动作
 */
export function normalizeMethodAction(value: unknown): MethodAction | null {
  if (!isRecord(value)) {
    return null;
  }

  const method = typeof value.method === 'string' ? value.method.trim() : '';

  if (!method) {
    return null;
  }

  return {
    args: Array.isArray(value.args)
      ? value.args.flatMap((item: unknown): BSmartValue<string>[] => {
          const normalizedArgument = normalizeMethodArgument(item);

          return normalizedArgument ? [normalizedArgument] : [];
        })
      : [],
    method
  };
}

/**
 * 规整方法动作列表。
 * @param value - 原始方法动作列表
 * @returns 可执行的方法动作列表
 */
export function normalizeMethodActions(value: unknown): MethodAction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((action: unknown): MethodAction[] => {
    const normalizedAction = normalizeMethodAction(action);

    return normalizedAction ? [normalizedAction] : [];
  });
}
