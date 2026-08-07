/**
 * @file default-font-options.test.ts
 * @description 基础设置页默认字体选项的平台过滤测试。
 */
import { describe, expect, it } from 'vitest';
import { getDefaultFontStyleOptions } from '@/views/settings/basic/fontOptions';

/**
 * 提取选项文案。
 * @param platform - 字体选项平台
 * @param activeStyle - 当前已选字体样式
 * @returns 选项文案列表
 */
function getLabels(platform: Parameters<typeof getDefaultFontStyleOptions>[0], activeStyle?: Parameters<typeof getDefaultFontStyleOptions>[1]): string[] {
  return getDefaultFontStyleOptions(platform, activeStyle).map((option) => String(option.label));
}

describe('default font style options', (): void => {
  it('shows macOS native font options on macOS', (): void => {
    const labels = getLabels('mac');

    expect(labels).toContain('苹方');
    expect(labels).toContain('圆体');
    expect(labels).toContain('黑体');
    expect(labels).not.toContain('微软雅黑');
    expect(labels).not.toContain('文泉驿微米黑');
  });

  it('shows Windows native font options on Windows', (): void => {
    const labels = getLabels('windows');

    expect(labels).toContain('微软雅黑');
    expect(labels).toContain('中易宋体');
    expect(labels).toContain('幼圆');
    expect(labels).not.toContain('苹方');
    expect(labels).not.toContain('文泉驿微米黑');
  });

  it('shows Linux common CJK font options on Linux', (): void => {
    const labels = getLabels('linux');

    expect(labels).toContain('Noto Sans CJK');
    expect(labels).toContain('Noto Serif CJK');
    expect(labels).toContain('文泉驿微米黑');
    expect(labels).not.toContain('苹方');
    expect(labels).not.toContain('微软雅黑');
  });

  it('keeps the active cross-platform value visible', (): void => {
    const labels = getLabels('windows', 'pingfang');

    expect(labels).toContain('苹方');
  });

  it('always offers the theme option labeled 默认 as the first choice', (): void => {
    const platforms = ['mac', 'windows', 'linux'] as const;

    for (const platform of platforms) {
      const labels = getLabels(platform);

      expect(labels[0]).toBe('默认');
    }
  });
});
