/**
 * @file chatToolInput.ts
 * @description WebView 页面 Chat 工具操作输入的严格归一化。
 */
import type { WebviewOperateAction, WebviewOperateInput, WebviewPressKey } from '../types';

/** WebView 支持模拟的按键。 */
export const SUPPORTED_WEBPAGE_PRESS_KEYS = [
  'Enter',
  'Tab',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight'
] as const satisfies readonly WebviewPressKey[];

/** WebView 支持的操作动作。 */
export const SUPPORTED_WEBPAGE_ACTION_TYPES = [
  'click',
  'input',
  'select',
  'press',
  'scroll',
  'navigate',
  'wait'
] as const satisfies readonly WebviewOperateAction['type'][];

/** WebView 支持的滚动方向。 */
export const SUPPORTED_WEBPAGE_SCROLL_DIRECTIONS = ['up', 'down', 'left', 'right'] as const;

/** 网页操作可变长度字段上限。 */
export const WEBPAGE_OPERATION_LIMITS = {
  /** 元素句柄最大安全整数。 */
  elementIndex: Number.MAX_SAFE_INTEGER,
  /** 快照 ID 最大长度。 */
  snapshotId: 256,
  /** 输入动作文本最大长度。 */
  inputText: 4_000,
  /** 下拉选项文本最大长度。 */
  optionText: 500,
  /** 导航地址最大长度。 */
  url: 2_048
} as const;

/** 网页操作步骤记忆字段上限。 */
export const WEBPAGE_STEP_LIMITS = {
  /** 上一步评估最大长度。 */
  evaluation: 500,
  /** 跨步骤记忆最大长度。 */
  memory: 1_200,
  /** 本次目标最大长度。 */
  nextGoal: 300
} as const;

/**
 * 判断值是否为对象记录。
 * @param value - 待判断值
 * @returns 是否为对象记录
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 判断值是否为有限数字。
 * @param value - 待判断值
 * @returns 是否为有限数字
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 判断值是否为非负整数元素句柄。
 * @param value - 待判断值
 * @returns 是否为有效元素句柄
 */
function isElementIndex(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isSafeInteger(value) && value >= 0 && value <= WEBPAGE_OPERATION_LIMITS.elementIndex;
}

/**
 * 判断数字是否位于闭区间内。
 * @param value - 待判断值
 * @param minimum - 最小值
 * @param maximum - 最大值
 * @returns 是否为范围内有限数字
 */
function isNumberInRange(value: unknown, minimum: number, maximum: number): value is number {
  return isFiniteNumber(value) && value >= minimum && value <= maximum;
}

/**
 * 判断值是否为网页滚动方向。
 * @param value - 待判断值
 * @returns 是否为支持的滚动方向
 */
function isScrollDirection(value: unknown): value is (typeof SUPPORTED_WEBPAGE_SCROLL_DIRECTIONS)[number] {
  return typeof value === 'string' && SUPPORTED_WEBPAGE_SCROLL_DIRECTIONS.includes(value as (typeof SUPPORTED_WEBPAGE_SCROLL_DIRECTIONS)[number]);
}

/**
 * 判断值是否为网页按键。
 * @param value - 待判断值
 * @returns 是否为支持的网页按键
 */
function isPressKey(value: unknown): value is WebviewPressKey {
  return typeof value === 'string' && SUPPORTED_WEBPAGE_PRESS_KEYS.includes(value as WebviewPressKey);
}

/**
 * 按公开协议白名单清理网页操作动作。
 * @param value - 原始网页操作动作
 * @returns 不包含未知或越界字段的动作
 */
export function sanitizeWebpageAction(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined;
  if (value.type === 'click') return { type: value.type, ...(isElementIndex(value.index) ? { index: value.index } : {}) };
  if (value.type === 'input') {
    return {
      type: value.type,
      ...(isElementIndex(value.index) ? { index: value.index } : {}),
      ...(typeof value.text === 'string' ? { text: value.text.slice(0, WEBPAGE_OPERATION_LIMITS.inputText) } : {}),
      ...(typeof value.clear === 'boolean' ? { clear: value.clear } : {})
    };
  }
  if (value.type === 'select') {
    return {
      type: value.type,
      ...(isElementIndex(value.index) ? { index: value.index } : {}),
      ...(typeof value.optionText === 'string' ? { optionText: value.optionText.slice(0, WEBPAGE_OPERATION_LIMITS.optionText) } : {})
    };
  }
  if (value.type === 'press') {
    return {
      type: value.type,
      ...(isElementIndex(value.index) ? { index: value.index } : {}),
      ...(isPressKey(value.key) ? { key: value.key } : {})
    };
  }
  if (value.type === 'scroll') {
    return {
      type: value.type,
      ...(isElementIndex(value.index) ? { index: value.index } : {}),
      ...(isScrollDirection(value.direction) ? { direction: value.direction } : {}),
      ...(isNumberInRange(value.pixels, 1, 5_000) ? { pixels: value.pixels } : {})
    };
  }
  if (value.type === 'navigate') {
    return { type: value.type, ...(typeof value.url === 'string' ? { url: value.url.slice(0, WEBPAGE_OPERATION_LIMITS.url) } : {}) };
  }
  if (value.type === 'wait') {
    return { type: value.type, ...(isNumberInRange(value.seconds, 0.1, 5) ? { seconds: value.seconds } : {}) };
  }
  return undefined;
}

/**
 * 严格归一化当前要执行的网页动作。
 * @param value - 原始网页动作
 * @returns 完整合法动作，无效时返回 undefined
 */
export function normalizeWebpageAction(value: unknown): WebviewOperateAction | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined;
  if (value.type === 'input' && typeof value.text === 'string' && value.text.length > WEBPAGE_OPERATION_LIMITS.inputText) return undefined;
  if (value.type === 'input' && value.clear !== undefined && typeof value.clear !== 'boolean') return undefined;
  if (value.type === 'select' && typeof value.optionText === 'string' && value.optionText.length > WEBPAGE_OPERATION_LIMITS.optionText) return undefined;
  if (value.type === 'navigate' && typeof value.url === 'string' && value.url.length > WEBPAGE_OPERATION_LIMITS.url) return undefined;
  if (value.type === 'scroll' && value.index !== undefined && !isElementIndex(value.index)) return undefined;
  if (value.type === 'scroll' && value.pixels !== undefined && !isNumberInRange(value.pixels, 1, 5_000)) return undefined;
  if (value.type === 'wait' && value.seconds !== undefined && !isNumberInRange(value.seconds, 0.1, 5)) return undefined;
  const action = sanitizeWebpageAction(value);
  if (!action) return undefined;

  if (action.type === 'click' && isElementIndex(action.index)) return action as WebviewOperateAction;
  if (action.type === 'input' && isElementIndex(action.index) && typeof action.text === 'string') return action as WebviewOperateAction;
  if (action.type === 'select' && isElementIndex(action.index) && typeof action.optionText === 'string') return action as WebviewOperateAction;
  if (action.type === 'press' && isElementIndex(action.index) && isPressKey(action.key)) return action as WebviewOperateAction;
  if (action.type === 'scroll' && isScrollDirection(action.direction)) return action as WebviewOperateAction;
  if (action.type === 'navigate' && typeof action.url === 'string' && action.url.trim()) return action as WebviewOperateAction;
  if (action.type === 'wait') return action as WebviewOperateAction;
  return undefined;
}

/**
 * 严格归一化当前要执行的网页操作输入。
 * @param value - 原始工具输入
 * @returns 页面可消费的输入，无效时返回 undefined
 */
export function normalizeWebpageInput(value: unknown): WebviewOperateInput | undefined {
  if (!isRecord(value)) return undefined;
  const action = normalizeWebpageAction(value.action);
  if (!action) return undefined;
  const snapshotId = typeof value.snapshotId === 'string' ? value.snapshotId : undefined;
  if (snapshotId !== undefined && (snapshotId.length > WEBPAGE_OPERATION_LIMITS.snapshotId || !snapshotId.trim())) return undefined;
  if (action.type !== 'navigate' && !snapshotId) return undefined;
  return { ...(snapshotId ? { snapshotId } : {}), action };
}
