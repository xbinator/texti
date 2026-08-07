/**
 * @file core/apply.ts
 * @description 运行时将主题 Token 注入为 CSS 变量（通过 <style> 标签），并提供开发时格式校验。
 */

import type { ThemeTokens } from '../types/tokens';
import { toCssVars } from './derive';

/**
 * 用于标识主题 <style> 标签的属性选择器。
 */
const STYLE_ATTR = 'data-theme-styles';

/**
 * 合法颜色格式正则：#hex、rgb() 函数，或包含 rgb() 的复合值（如 shadow）。
 */
const COLOR_RE = /^(transparent|#([0-9a-f]{3,8})|.*rgb\(\d{1,3}\s+\d{1,3}\s+\d{1,3}.*\))$/i;

/**
 * 合法尺寸格式正则。
 */
const DIMENSION_RE = /^-?(0|\d+(?:\.\d+)?(px|rem|em))$/i;

/**
 * 合法时长格式正则。
 */
const DURATION_RE = /^\d+(?:\.\d+)?(ms|s)$/i;

/**
 * 合法缓动格式正则。
 */
const EASING_RE = /^(linear|ease|ease-in|ease-out|ease-in-out|cubic-bezier\([^)]*\))$/i;

/**
 * 合法阴影格式正则。
 */
const SHADOW_RE = /^(none|.*(#([0-9a-f]{3,8})|rgb\([^)]*\)|color-mix\([^)]*\)).*)$/i;

/**
 * 判断 CSS 变量是否为尺寸类 Token。
 * @param key - CSS 变量名
 * @returns 是否为尺寸类变量
 */
function isDimensionKey(key: string): boolean {
  return (
    key.startsWith('--radius-') ||
    key.startsWith('--border-width-') ||
    key === '--control-radius' ||
    key === '--control-border-width' ||
    key === '--control-focus-ring-width' ||
    key === '--surface-radius' ||
    key === '--surface-border-width' ||
    key === '--overlay-radius' ||
    key === '--overlay-border-width' ||
    key === '--interaction-press-offset' ||
    key === '--button-border-width' ||
    key === '--input-radius' ||
    key === '--input-border-width' ||
    key === '--input-padding-inline' ||
    key === '--input-padding-block' ||
    key === '--input-gap' ||
    key === '--input-keycap-size' ||
    key === '--input-keycap-radius' ||
    key === '--input-keycap-border-width'
  );
}

/**
 * 判断 CSS 变量是否为阴影类 Token。
 * @param key - CSS 变量名
 * @returns 是否为阴影类变量
 */
function isShadowKey(key: string): boolean {
  return (
    key === '--interaction-raised-shadow' ||
    key === '--interaction-pressed-shadow' ||
    key === '--button-shadow' ||
    key === '--button-active-shadow' ||
    key === '--button-pressed-shadow' ||
    key === '--input-shadow' ||
    key === '--input-active-shadow' ||
    key === '--input-keycap-shadow' ||
    key.startsWith('--shadow-')
  );
}

/**
 * 判断 CSS 变量值是否符合对应格式。
 * @param key - CSS 变量名
 * @param value - CSS 变量值
 * @returns 是否为合法 Token 值
 */
function isValidTokenValue(key: string, value: string): boolean {
  if (key.startsWith('--font-')) {
    return value.trim().length > 0;
  }

  if (key.startsWith('--motion-duration-')) {
    return DURATION_RE.test(value);
  }

  if (key.startsWith('--motion-easing-')) {
    return EASING_RE.test(value);
  }

  if (isDimensionKey(key)) {
    return DIMENSION_RE.test(value);
  }

  if (isShadowKey(key)) {
    return SHADOW_RE.test(value);
  }

  return COLOR_RE.test(value);
}

/**
 * 将扁平化的 CSS 变量映射编译为 :root { ... } 规则文本。
 * @param vars - CSS 变量键值对
 * @returns 可直接写入 <style> 标签的 CSS 文本
 */
function buildRootRule(vars: Record<string, string>): string {
  const lines = Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`);
  return `:root {\n${lines.join('\n')}\n}`;
}

/**
 * 在开发环境下校验 Token 值的颜色格式。
 * @param tokens - 主题 Token 对象
 * @param name - 主题名称（用于日志）
 */
export function validateTokens(tokens: ThemeTokens, name: string): void {
  if (!import.meta.env.DEV) {
    return;
  }

  const flat = toCssVars(tokens);
  for (const [key, value] of Object.entries(flat)) {
    if (!isValidTokenValue(key, value)) {
      console.warn(`[theme] Unexpected token format in ${name}: ${key}=${value}`);
    }
  }
}

/**
 * 将主题 Token 以 <style> 标签形式注入为 :root CSS 变量。
 * 若已存在主题 <style> 标签，则替换之，避免标签堆积。
 * @param tokens - 主题 Token 对象
 */
export function applyCssVars(tokens: ThemeTokens): void {
  const vars = toCssVars(tokens);
  const css = buildRootRule(vars);

  const existing = document.querySelector(`style[${STYLE_ATTR}]`);
  if (existing) {
    existing.textContent = css;
    return;
  }

  const style = document.createElement('style');
  style.setAttribute(STYLE_ATTR, '');
  style.textContent = css;
  document.head.appendChild(style);
}
