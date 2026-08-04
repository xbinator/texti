/**
 * @file core/runtime.ts
 * @description 读取运行时已注入到 DOM 的主题 CSS 变量。
 */
import { defaultLight } from '../presets/graphite';

/**
 * 运行时主题色集合。
 */
export interface RuntimeThemeColors {
  /** 主色 */
  primary: string;
  /** 主色浅背景 */
  primaryBg: string;
  /** 不透明主色浅背景 */
  primarySolidBg: string;
  /** 主色边框 */
  primaryBorder: string;
  /** 主色 hover */
  primaryHover: string;
}

/**
 * RGBA 色值。
 */
interface RgbaColor {
  /** 红色通道 */
  red: number;
  /** 绿色通道 */
  green: number;
  /** 蓝色通道 */
  blue: number;
  /** 透明度 */
  alpha: number;
}

/** 工具条浅背景使用与 primaryBg 一致的主色混合比例，但输出不透明色值。 */
const PRIMARY_SOLID_BG_RATIO = 0.1;

/**
 * 读取 CSS 变量值。
 * @param style - 计算样式
 * @param name - CSS 变量名
 * @param fallback - 兜底值
 * @returns CSS 变量值或兜底值
 */
function readCssVariable(style: CSSStyleDeclaration, name: string, fallback: string): string {
  return style.getPropertyValue(name).trim() || fallback;
}

/**
 * 将颜色通道限制在 CSS RGB 范围内。
 * @param value - 原始通道值
 * @returns 0 到 255 之间的整数
 */
function clampColorChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

/**
 * 将透明度限制在 CSS alpha 范围内。
 * @param value - 原始透明度
 * @returns 0 到 1 之间的数字
 */
function clampAlpha(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * 解析 RGB 通道值。
 * @param value - CSS RGB 通道字符串
 * @returns RGB 通道值，解析失败时返回 null
 */
function parseColorChannel(value: string): number | null {
  const trimmed = value.trim();
  const numeric = Number.parseFloat(trimmed);
  if (Number.isNaN(numeric)) {
    return null;
  }

  return trimmed.endsWith('%') ? clampColorChannel((numeric / 100) * 255) : clampColorChannel(numeric);
}

/**
 * 解析 CSS alpha 通道值。
 * @param value - CSS alpha 通道字符串
 * @returns alpha 值，缺省或解析失败时返回 1
 */
function parseAlphaChannel(value?: string): number {
  if (!value) {
    return 1;
  }

  const trimmed = value.trim();
  const numeric = Number.parseFloat(trimmed);
  if (Number.isNaN(numeric)) {
    return 1;
  }

  return trimmed.endsWith('%') ? clampAlpha(numeric / 100) : clampAlpha(numeric);
}

/**
 * 解析十六进制颜色。
 * @param value - CSS 十六进制颜色
 * @returns RGBA 色值，解析失败时返回 null
 */
function parseHexColor(value: string): RgbaColor | null {
  const hex = value.trim().replace(/^#/, '');
  if (![3, 4, 6, 8].includes(hex.length) || !/^[\da-f]+$/i.test(hex)) {
    return null;
  }

  const normalized =
    hex.length <= 4
      ? hex
          .split('')
          .map((channel) => `${channel}${channel}`)
          .join('')
      : hex;
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16),
    alpha: normalized.length === 8 ? Number.parseInt(normalized.slice(6, 8), 16) / 255 : 1
  };
}

/**
 * 解析 rgb / rgba 颜色。
 * @param value - CSS rgb 或 rgba 颜色
 * @returns RGBA 色值，解析失败时返回 null
 */
function parseRgbColor(value: string): RgbaColor | null {
  const match = value.trim().match(/^rgba?\((.+)\)$/i);
  if (!match) {
    return null;
  }

  const body = match[1] ?? '';
  const [rawRgbPart, rawAlphaPart] = body.split('/').map((part) => part.trim());
  const rgbPart = rawRgbPart ?? '';
  const parts = rgbPart.includes(',') ? rgbPart.split(',') : rgbPart.split(/\s+/);
  if (parts.length < 3) {
    return null;
  }

  const channels = parts.slice(0, 3).map((part) => parseColorChannel(part));
  if (channels.some((channel) => channel === null)) {
    return null;
  }
  const commaAlphaPart = rgbPart.includes(',') ? parts[3] : undefined;
  const alpha = parseAlphaChannel(rawAlphaPart || commaAlphaPart);

  return {
    red: channels[0] ?? 0,
    green: channels[1] ?? 0,
    blue: channels[2] ?? 0,
    alpha
  };
}

/**
 * 解析支持的 CSS 颜色。
 * @param value - CSS 色值
 * @returns RGBA 色值，解析失败时返回 null
 */
function parseColor(value: string): RgbaColor | null {
  if (value.trim().startsWith('#')) {
    return parseHexColor(value);
  }

  return parseRgbColor(value);
}

/**
 * 格式化颜色通道为两位十六进制。
 * @param value - RGB 通道值
 * @returns 两位十六进制片段
 */
function formatHexChannel(value: number): string {
  return clampColorChannel(value).toString(16).padStart(2, '0');
}

/**
 * 格式化 RGB 色值为十六进制颜色。
 * @param color - RGB 色值
 * @returns 十六进制颜色
 */
function formatHexColor(color: RgbaColor): string {
  return `#${formatHexChannel(color.red)}${formatHexChannel(color.green)}${formatHexChannel(color.blue)}`;
}

/**
 * 将前景色按透明度混合到基础背景上。
 * @param base - 基础背景色
 * @param foreground - 前景色
 * @param fallbackRatio - 前景色缺省透明度
 * @returns 不透明主色浅背景
 */
function mixSolidBackground(base: RgbaColor, foreground: RgbaColor, fallbackRatio: number): string {
  const foregroundRatio = foreground.alpha < 1 ? foreground.alpha : fallbackRatio;
  const baseRatio = 1 - foregroundRatio;
  return formatHexColor({
    red: base.red * baseRatio + foreground.red * foregroundRatio,
    green: base.green * baseRatio + foreground.green * foregroundRatio,
    blue: base.blue * baseRatio + foreground.blue * foregroundRatio,
    alpha: 1
  });
}

/**
 * 派生不透明主色浅背景。
 * @param primary - 主色
 * @param primaryBg - 主色浅背景
 * @param baseBackground - 基础背景色
 * @returns 不透明主色浅背景
 */
function derivePrimarySolidBackground(primary: string, primaryBg: string, baseBackground: string): string {
  const primaryBgColor = parseColor(primaryBg);
  if (primaryBgColor?.alpha === 1) {
    return formatHexColor(primaryBgColor);
  }

  const primaryColor = parseColor(primary) ?? parseColor(defaultLight.color.primary);
  const baseColor = parseColor(baseBackground) ?? parseColor(defaultLight.bg.elevated);

  if (!primaryColor || !baseColor) {
    return defaultLight.bg.elevated;
  }

  return mixSolidBackground(baseColor, primaryBgColor ?? primaryColor, PRIMARY_SOLID_BG_RATIO);
}

/**
 * 运行时主题色兜底值。
 */
const DEFAULT_RUNTIME_THEME_COLORS: RuntimeThemeColors = {
  primary: defaultLight.color.primary,
  primaryBg: defaultLight.color.primaryBg,
  primarySolidBg: derivePrimarySolidBackground(defaultLight.color.primary, defaultLight.color.primaryBg, defaultLight.bg.elevated),
  primaryBorder: defaultLight.color.primaryBorder,
  primaryHover: defaultLight.color.primaryHover
};

/**
 * 读取当前运行时主题色。
 * @param root - 读取 CSS 变量的根元素，默认使用 document.documentElement
 * @returns 运行时主题色集合
 */
export function resolveRuntimeThemeColors(root: Element = document.documentElement): RuntimeThemeColors {
  const style = getComputedStyle(root);
  const primary = readCssVariable(style, '--color-primary', DEFAULT_RUNTIME_THEME_COLORS.primary);
  const primaryBg = readCssVariable(style, '--color-primary-bg', DEFAULT_RUNTIME_THEME_COLORS.primaryBg);
  const baseBackground = readCssVariable(style, '--bg-elevated', defaultLight.bg.elevated);

  return {
    primary,
    primaryBg,
    primarySolidBg: derivePrimarySolidBackground(primary, primaryBg, baseBackground),
    primaryBorder: readCssVariable(style, '--color-primary-border', DEFAULT_RUNTIME_THEME_COLORS.primaryBorder),
    primaryHover: readCssVariable(style, '--color-primary-hover', DEFAULT_RUNTIME_THEME_COLORS.primaryHover)
  };
}
