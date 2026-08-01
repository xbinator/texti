/**
 * @file preset-list.test.ts
 * @description 验证主题预设注册表包含新增主题并能解析对应 Token。
 */
import { describe, expect, it } from 'vitest';
import { getPresetList, getResolvedTokens, toCssVars } from '@/theme';

/**
 * 设计主题 Token 探针。
 * 用于在实现前以行为测试驱动新增字段，避免测试阶段直接依赖尚未存在的 ThemeTokens 字段。
 */
interface DesignTokenProbe {
  /** 圆角 Token */
  radius: {
    /** 全圆角语义 */
    full: string;
  };
  /** 控件语义 Token */
  control: {
    /** 控件圆角 */
    radius: string;
    /** 控件边框宽度 */
    borderWidth: string;
  };
  /** 字体 Token */
  font: {
    /** 展示字体栈 */
    display: string;
  };
  /** 交互 Token */
  interaction: {
    /** 按压偏移 */
    pressOffset: string;
    /** 抬起状态硬阴影 */
    raisedShadow: string;
    /** 按下状态硬阴影 */
    pressedShadow: string;
  };
  /** 按钮语义 Token */
  button: {
    /** 按钮边框色 */
    border: string;
    /** 按钮边框宽度 */
    borderWidth: string;
    /** 按钮默认阴影 */
    shadow: string;
    /** 按钮激活阴影 */
    activeShadow: string;
    /** 按钮按下阴影 */
    pressedShadow: string;
  };
  /** 输入框语义 Token */
  input: {
    /** 输入框圆角 */
    radius: string;
    /** 输入框边框宽度 */
    borderWidth: string;
    /** 输入框横向内边距 */
    paddingInline: string;
    /** 输入框纵向内边距 */
    paddingBlock: string;
    /** 输入框图标与内容间距 */
    gap: string;
    /** 输入框字体 */
    fontFamily: string;
    /** 占位符颜色 */
    placeholderColor: string;
    /** 前后缀图标颜色 */
    iconColor: string;
    /** 输入框默认阴影 */
    shadow: string;
    /** 输入框聚焦阴影 */
    activeShadow: string;
    /** 快捷键提示尺寸 */
    keycapSize: string;
    /** 快捷键提示圆角 */
    keycapRadius: string;
    /** 快捷键提示边框宽度 */
    keycapBorderWidth: string;
    /** 快捷键提示背景 */
    keycapBg: string;
    /** 快捷键提示文字色 */
    keycapColor: string;
    /** 快捷键提示阴影 */
    keycapShadow: string;
  };
}

/**
 * 已从主题选择器移除的主题预设。
 */
interface RemovedThemePreset {
  /** 主题预设 ID */
  id: string;
  /** 主题预设显示名称 */
  label: string;
}

/**
 * 用户不再需要展示的主题色名称集合。
 */
const REMOVED_THEME_PRESETS: RemovedThemePreset[] = [
  { id: 'velora', label: '晴空蓝「Velora」' },
  { id: 'everforest', label: '柔绿色「Everforest」' },
  { id: 'tokyonight', label: '紫蓝色「Tokyonight」' },
  { id: 'ayu', label: '暖黄色「Ayu」' },
  { id: 'catppuccin', label: '奶咖色「Catppuccin」' },
  { id: 'catppuccin-macchiato', label: '深咖色「Catppuccin」' },
  { id: 'gruvbox', label: '棕黄色「Gruvbox」' },
  { id: 'kanagawa', label: '靛蓝色「Kanagawa」' },
  { id: 'nord', label: '冰蓝色「Nord」' },
  { id: 'one-dark', label: '深灰色「One Dark」' }
];

describe('theme preset registry', (): void => {
  it('omits removed color theme presets from the public preset list', (): void => {
    const presets = getPresetList();

    for (const preset of REMOVED_THEME_PRESETS) {
      expect(presets).not.toContainEqual(preset);
    }
  });

  it('registers the soft monochrome Graphite theme preset', (): void => {
    const presets = getPresetList();

    expect(presets).toContainEqual({ id: 'graphite', label: '柔和黑白「Graphite」' });
  });

  it('resolves Graphite tokens for soft gray product shell modes', (): void => {
    const lightTokens = getResolvedTokens('graphite', 'light');
    const darkTokens = getResolvedTokens('graphite', 'dark');
    const lightCssVars = toCssVars(lightTokens);

    expect(lightTokens.bg.primary).toBe('#ffffff');
    expect(lightTokens.bg.secondary).toBe('#f4f4f4');
    expect(lightTokens.bg.tertiary).toBe('#eeeeee');
    expect(lightTokens.color.primary).toBe('#1f1f1f');
    expect(lightTokens.border.primary).toBe('#e5e5e5');
    expect(lightCssVars['--button-border-width']).toBe('0px');
    expect(lightCssVars['--button-border']).toBe('transparent');
    expect(darkTokens.bg.primary).toBe('#121212');
    expect(darkTokens.bg.secondary).toBe('#1a1a1a');
    expect(darkTokens.color.primary).toBe('#f5f5f5');
    expect(lightCssVars['--color-primary']).toBe('#1f1f1f');
  });

  it('registers the high-contrast Shonen theme preset', (): void => {
    const presets = getPresetList();

    expect(presets).toContainEqual({ id: 'shonen', label: '热血红黑「Shonen」' });
  });

  it('resolves Shonen light and dark tokens for manga paper and red-black modes', (): void => {
    const lightTokens = getResolvedTokens('shonen', 'light');
    const darkTokens = getResolvedTokens('shonen', 'dark');
    const darkCssVars = toCssVars(darkTokens);

    expect(lightTokens.bg.primary).toBe('#fff8e7');
    expect(lightTokens.text.primary).toBe('#111111');
    expect(lightTokens.color.primary).toBe('#e60012');
    expect(darkTokens.bg.primary).toBe('#07070a');
    expect(darkTokens.text.primary).toBe('#fff3e0');
    expect(darkTokens.color.primary).toBe('#ff1f3d');
    expect(darkCssVars['--color-primary']).toBe('#ff1f3d');
  });

  it('registers the monochrome Manga Ink theme preset', (): void => {
    const presets = getPresetList();

    expect(presets).toContainEqual({ id: 'manga-ink', label: '黑白线稿「Manga Ink」' });
  });

  it('resolves Manga Ink light and dark tokens for ink paper and inverse ink modes', (): void => {
    const lightTokens = getResolvedTokens('manga-ink', 'light');
    const darkTokens = getResolvedTokens('manga-ink', 'dark');
    const lightCssVars = toCssVars(lightTokens);

    expect(lightTokens.bg.primary).toBe('#fffdf5');
    expect(lightTokens.text.primary).toBe('#050505');
    expect(lightTokens.color.primary).toBe('#050505');
    expect(darkTokens.bg.primary).toBe('#050505');
    expect(darkTokens.text.primary).toBe('#f8f8f2');
    expect(darkTokens.color.primary).toBe('#f8f8f2');
    expect(lightCssVars['--border-primary']).toBe('#050505');
  });

  it('registers the retro adventure Overworld theme preset', (): void => {
    const presets = getPresetList();

    expect(presets).toContainEqual({ id: 'overworld', label: '复古冒险「Overworld」' });
  });

  it('resolves Overworld as a design-token theme with pixel adventure semantics', (): void => {
    const lightTokens = getResolvedTokens('overworld', 'light');
    const probe = lightTokens as unknown as DesignTokenProbe;
    const lightCssVars = toCssVars(lightTokens);

    expect(lightTokens.color.primary).toBe('#2e5dd6');
    expect(lightTokens.text.primary).toBe('#161310');
    expect(lightTokens.border.primary).toBe('#161310');
    expect(probe.radius.full).toBe('0px');
    expect(probe.control.radius).toBe('0px');
    expect(probe.control.borderWidth).toBe('2px');
    expect(probe.interaction.pressOffset).toBe('2px');
    expect(probe.interaction.raisedShadow).toBe('2px 2px 0 0 #161310');
    expect(probe.interaction.pressedShadow).toBe('none');
    expect(probe.button.border).toBe('#161310');
    expect(probe.button.borderWidth).toBe('2px');
    expect(probe.button.shadow).toBe('2px 2px 0 0 #161310');
    expect(probe.button.activeShadow).toBe('2px 2px 0 0 #2e5dd6');
    expect(probe.button.pressedShadow).toBe('none');
    expect(probe.input.radius).toBe('0px');
    expect(probe.input.borderWidth).toBe('2px');
    expect(probe.input.paddingInline).toBe('12px');
    expect(probe.input.paddingBlock).toBe('0px');
    expect(probe.input.gap).toBe('10px');
    expect(probe.input.fontFamily).toContain('Pixelify Sans');
    expect(probe.input.placeholderColor).toBe('rgb(58 51 42 / 70%)');
    expect(probe.input.iconColor).toBe('#161310');
    expect(probe.input.shadow).toBe('2px 2px 0 0 #161310');
    expect(probe.input.activeShadow).toBe('2px 2px 0 0 #2e5dd6');
    expect(probe.input.keycapSize).toBe('28px');
    expect(probe.input.keycapRadius).toBe('0px');
    expect(probe.input.keycapBorderWidth).toBe('2px');
    expect(probe.input.keycapBg).toBe('#f2ead6');
    expect(probe.input.keycapColor).toBe('#161310');
    expect(probe.input.keycapShadow).toBe('none');
    expect(lightCssVars['--control-radius']).toBe('0px');
    expect(lightCssVars['--radius-full']).toBe('0px');
    expect(lightCssVars['--font-display']).toContain('Pixelify Sans');
    expect(lightCssVars['--interaction-press-offset']).toBe('2px');
    expect(lightCssVars['--interaction-raised-shadow']).toBe('2px 2px 0 0 #161310');
    expect(lightCssVars['--interaction-pressed-shadow']).toBe('none');
    expect(lightCssVars['--button-border']).toBe('#161310');
    expect(lightCssVars['--button-border-width']).toBe('2px');
    expect(lightCssVars['--button-shadow']).toBe('2px 2px 0 0 #161310');
    expect(lightCssVars['--button-active-shadow']).toBe('2px 2px 0 0 #2e5dd6');
    expect(lightCssVars['--button-pressed-shadow']).toBe('none');
    expect(lightCssVars['--input-radius']).toBe('0px');
    expect(lightCssVars['--input-border-width']).toBe('2px');
    expect(lightCssVars['--input-keycap-size']).toBe('28px');
    expect(lightCssVars['--input-keycap-border-width']).toBe('2px');
    expect(lightCssVars).not.toHaveProperty('--input-height');
  });
});
