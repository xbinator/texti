/**
 * @file runtime.test.ts
 * @description 验证运行时主题色 CSS 变量读取工具。
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { light, resolveRuntimeThemeColors } from '@/theme';

describe('resolveRuntimeThemeColors', (): void => {
  afterEach((): void => {
    document.documentElement.removeAttribute('style');
  });

  it('reads primary runtime colors from theme css variables', (): void => {
    document.documentElement.style.setProperty('--color-primary', '#123456');
    document.documentElement.style.setProperty('--color-primary-bg', '#eaf2ff');
    document.documentElement.style.setProperty('--color-primary-border', '#789abc');
    document.documentElement.style.setProperty('--color-primary-hover', '#0f2f55');
    document.documentElement.style.setProperty('--bg-elevated', '#ffffff');

    expect(resolveRuntimeThemeColors()).toEqual({
      primary: '#123456',
      primaryBg: '#eaf2ff',
      primarySolidBg: '#eaf2ff',
      primaryBorder: '#789abc',
      primaryHover: '#0f2f55'
    });
  });

  it('derives an opaque primary background when primaryBg is transparent', (): void => {
    document.documentElement.style.setProperty('--color-primary', '#8a6f5a');
    document.documentElement.style.setProperty('--color-primary-bg', 'rgb(138 111 90 / 10%)');
    document.documentElement.style.setProperty('--color-primary-border', 'rgb(138 111 90 / 24%)');
    document.documentElement.style.setProperty('--color-primary-hover', '#755d4b');
    document.documentElement.style.setProperty('--bg-elevated', '#fffdf8');

    const colors = resolveRuntimeThemeColors();

    expect(colors.primaryBg).toBe('rgb(138 111 90 / 10%)');
    expect(colors.primarySolidBg).toBe('#f3efe8');
  });

  it('uses the runtime primaryBg alpha when deriving the opaque background', (): void => {
    document.documentElement.style.setProperty('--color-primary', '#123456');
    document.documentElement.style.setProperty('--color-primary-bg', 'rgb(18 52 86 / 20%)');
    document.documentElement.style.setProperty('--color-primary-border', '#789abc');
    document.documentElement.style.setProperty('--color-primary-hover', '#0f2f55');
    document.documentElement.style.setProperty('--bg-elevated', '#ffffff');

    expect(resolveRuntimeThemeColors().primarySolidBg).toBe('#d0d6dd');
  });

  it('falls back to stable default colors when css variables are missing', (): void => {
    expect(resolveRuntimeThemeColors()).toEqual({
      primary: light.color.primary,
      primaryBg: light.color.primaryBg,
      primarySolidBg: '#ededed',
      primaryBorder: light.color.primaryBorder,
      primaryHover: light.color.primaryHover
    });
  });
});
