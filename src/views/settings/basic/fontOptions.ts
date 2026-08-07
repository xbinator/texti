/**
 * @file fontOptions.ts
 * @description 基础设置页默认字体样式选项，按当前系统展示常见中文字体族。
 */
import type { SelectOption } from '@/components/BSelect/types';
import type { DefaultFontStyle } from '@/stores/ui/setting';

/**
 * 字体选项平台。
 */
export type FontOptionPlatform = 'mac' | 'windows' | 'linux' | 'unknown';

/**
 * 默认字体样式选项。
 */
interface DefaultFontStyleOption extends SelectOption {
  /** 默认字体样式值 */
  value: DefaultFontStyle;
  /** 为空表示所有平台都展示 */
  platforms?: FontOptionPlatform[];
}

/**
 * 默认字体样式选项目录。
 */
const DEFAULT_FONT_STYLE_OPTIONS: DefaultFontStyleOption[] = [
  { value: 'theme', label: '默认' },
  { value: 'heiti', label: '黑体' },
  { value: 'songti', label: '宋体' },
  { value: 'kaiti', label: '楷体' },
  { value: 'fangsong', label: '仿宋' },
  { value: 'pingfang', label: '苹方', platforms: ['mac'] },
  { value: 'yuanti', label: '圆体', platforms: ['mac'] },
  { value: 'yahei', label: '微软雅黑', platforms: ['windows'] },
  { value: 'simhei', label: '中易黑体', platforms: ['windows'] },
  { value: 'simsun', label: '中易宋体', platforms: ['windows'] },
  { value: 'youyuan', label: '幼圆', platforms: ['windows'] },
  { value: 'notoSansCjk', label: 'Noto Sans CJK', platforms: ['linux'] },
  { value: 'notoSerifCjk', label: 'Noto Serif CJK', platforms: ['linux'] },
  { value: 'sourceHanSans', label: '思源黑体', platforms: ['linux'] },
  { value: 'sourceHanSerif', label: '思源宋体', platforms: ['linux'] },
  { value: 'wenquanyi', label: '文泉驿微米黑', platforms: ['linux'] }
];

/**
 * 获取当前字体选项平台。
 * @returns 当前字体选项平台
 */
export function getCurrentFontPlatform(): FontOptionPlatform {
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform;
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;

  if (/Mac|iPod|iPhone|iPad/u.test(platform)) return 'mac';
  if (/Win/u.test(platform)) return 'windows';
  if (/Linux|X11/u.test(platform) || /Linux/u.test(userAgent)) return 'linux';

  return 'unknown';
}

/**
 * 判断字体选项是否应该在当前平台展示。
 * @param option - 字体选项
 * @param platform - 当前平台
 * @param activeStyle - 当前已选字体样式
 * @returns 是否展示该选项
 */
function isFontOptionVisible(option: DefaultFontStyleOption, platform: FontOptionPlatform, activeStyle?: DefaultFontStyle): boolean {
  if (option.value === activeStyle) return true;
  if (!option.platforms) return true;

  return option.platforms.includes(platform);
}

/**
 * 转换为 BSelect 需要的选项结构。
 * @param option - 默认字体样式选项
 * @returns BSelect 选项
 */
function toSelectOption(option: DefaultFontStyleOption): SelectOption {
  return {
    value: option.value,
    label: option.label,
    tips: option.tips
  };
}

/**
 * 获取默认字体样式选项。
 * @param platform - 当前平台
 * @param activeStyle - 当前已选字体样式
 * @returns 默认字体样式选项
 */
export function getDefaultFontStyleOptions(platform: FontOptionPlatform, activeStyle?: DefaultFontStyle): SelectOption[] {
  return DEFAULT_FONT_STYLE_OPTIONS.filter((option) => isFontOptionVisible(option, platform, activeStyle)).map(toSelectOption);
}
