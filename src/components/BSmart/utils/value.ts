/**
 * @file value.ts
 * @description BSmart 结构化值构造与类型守卫。
 */
import type { BSmartLiteralValue, BSmartValue, BSmartVariableValue } from '../types';

/**
 * 判断未知值是否为普通记录。
 * @param value - 待判断值
 * @returns 是否为普通记录
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 创建静态 Smart 值。
 * @param value - 实际静态值
 * @returns 静态 Smart 值
 */
export function createLiteralValue<T>(value: T): BSmartLiteralValue<T> {
  return {
    type: 'literal',
    value
  };
}

/**
 * 创建 Smart 变量引用。
 * @param path - 不带双花括号的变量路径
 * @returns Smart 变量引用
 */
export function createVariableValue(path: string): BSmartVariableValue {
  return {
    type: 'variable',
    value: path
  };
}

/**
 * 判断未知值是否为静态 Smart 值。
 * @param value - 待判断值
 * @returns 是否为静态 Smart 值
 */
export function isLiteralValue(value: unknown): value is BSmartLiteralValue<unknown> {
  return isRecord(value) && value.type === 'literal' && Object.prototype.hasOwnProperty.call(value, 'value');
}

/**
 * 判断未知值是否为 Smart 变量引用。
 * @param value - 待判断值
 * @returns 是否为 Smart 变量引用
 */
export function isVariableValue(value: unknown): value is BSmartVariableValue {
  return isRecord(value) && value.type === 'variable' && typeof value.value === 'string';
}

/**
 * 判断未知值是否为合法 Smart 值。
 * @param value - 待判断值
 * @returns 是否为合法 Smart 值
 */
export function isSmartValue(value: unknown): value is BSmartValue<unknown> {
  return isLiteralValue(value) || isVariableValue(value);
}
