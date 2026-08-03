/**
 * @file input.mts
 * @description WebView 页面操作输入的共享清理与严格归一化。
 */
import type { RuntimeWebpageOperateAction, RuntimeWebpageOperateInput } from '../types.mjs';
import { SUPPORTED_WEBPAGE_PRESS_KEYS, SUPPORTED_WEBPAGE_SCROLL_DIRECTIONS, WEBPAGE_OPERATION_LIMITS } from '../constants.mjs';

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
function isPressKey(value: unknown): value is (typeof SUPPORTED_WEBPAGE_PRESS_KEYS)[number] {
  return typeof value === 'string' && SUPPORTED_WEBPAGE_PRESS_KEYS.includes(value as (typeof SUPPORTED_WEBPAGE_PRESS_KEYS)[number]);
}

/**
 * 按公开协议白名单清理网页操作动作。
 * @param value - 原始网页操作动作
 * @returns 不包含未知或越界字段的动作
 */
export function sanitizeWebpageAction(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined;

  if (value.type === 'click') {
    return { type: value.type, ...(isElementIndex(value.index) ? { index: value.index } : {}) };
  }
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
export function normalizeWebpageAction(value: unknown): RuntimeWebpageOperateAction | undefined {
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

  if (action.type === 'click' && isElementIndex(action.index)) return action as RuntimeWebpageOperateAction;
  if (action.type === 'input' && isElementIndex(action.index) && typeof action.text === 'string') return action as RuntimeWebpageOperateAction;
  if (action.type === 'select' && isElementIndex(action.index) && typeof action.optionText === 'string') return action as RuntimeWebpageOperateAction;
  if (action.type === 'press' && isElementIndex(action.index) && isPressKey(action.key)) return action as RuntimeWebpageOperateAction;
  if (action.type === 'scroll' && isScrollDirection(action.direction)) return action as RuntimeWebpageOperateAction;
  if (action.type === 'navigate' && typeof action.url === 'string' && action.url.trim()) return action as RuntimeWebpageOperateAction;
  if (action.type === 'wait') return action as RuntimeWebpageOperateAction;

  return undefined;
}

/**
 * 严格归一化当前要执行的网页操作输入。
 * @param value - 原始工具输入
 * @returns Renderer 可消费的输入，无效时返回 undefined
 */
export function normalizeWebpageInput(value: unknown): RuntimeWebpageOperateInput | undefined {
  if (!isRecord(value)) return undefined;
  const action = normalizeWebpageAction(value.action);
  if (!action) return undefined;
  const snapshotId = typeof value.snapshotId === 'string' ? value.snapshotId : undefined;
  if (snapshotId !== undefined && (snapshotId.length > WEBPAGE_OPERATION_LIMITS.snapshotId || !snapshotId.trim())) return undefined;
  if (action.type !== 'navigate' && !snapshotId) return undefined;

  return {
    ...(snapshotId ? { snapshotId } : {}),
    action
  };
}
