/**
 * @file design-token-derive.test.ts
 * @description 验证主题设计 Token 可派生到 Ant Design 与运行时校验。
 */
import { describe, expect, it, vi } from 'vitest';
import type { ThemeTokens } from '@/theme';
import { getResolvedTokens, toAntdToken, toCssVars, validateTokens } from '@/theme';

/**
 * Ant Design 设计 Token 探针。
 */
interface AntdDesignTokenProbe {
  /** 全局 token */
  token: {
    /** 基础圆角 */
    borderRadius: number;
    /** 大圆角 */
    borderRadiusLG: number;
    /** 小圆角 */
    borderRadiusSM: number;
    /** 控件边框宽度 */
    lineWidth: number;
    /** 字体栈 */
    fontFamily: string;
  };
  /** 组件级 token */
  components: {
    /** Button 组件 token */
    Button: { borderRadius: number; lineWidth: number; fontFamily: string };
    /** Input 组件 token */
    Input: {
      borderRadius: number;
      lineWidth: number;
      paddingInline: number;
      colorTextPlaceholder: string;
      activeShadow: string;
      fontFamily: string;
    } & Record<string, unknown>;
    /** Select 组件 token */
    Select: { borderRadius: number; lineWidth: number };
    /** Modal 组件 token */
    Modal: { borderRadiusLG: number };
    /** Drawer 组件 token */
    Drawer: { borderRadiusLG: number };
    /** Dropdown 组件 token */
    Dropdown: { borderRadiusLG: number; lineWidth: number };
    /** Segmented 组件 token */
    Segmented: { borderRadius: number };
    /** Tooltip 组件 token */
    Tooltip: { borderRadius: number };
  };
}

/**
 * 构造带设计 Token 的主题，用于驱动 validateTokens 支持非颜色字段。
 * @returns 带设计 Token 的主题对象
 */
function createDesignTokenProbe(): ThemeTokens {
  return {
    ...getResolvedTokens('default', 'light'),
    radius: {
      none: '0',
      xs: '2px',
      sm: '6px',
      md: '8px',
      lg: '12px',
      xl: '16px',
      full: '999px'
    },
    borderWidth: {
      hairline: '1px',
      thin: '1px',
      strong: '2px'
    },
    font: {
      sans: 'Inter, system-ui, sans-serif',
      mono: 'ui-monospace, monospace'
    },
    motion: {
      durationFast: '90ms',
      durationBase: '200ms',
      durationSlow: '320ms',
      easingStandard: 'ease',
      easingPress: 'cubic-bezier(0.2, 0, 0, 1)'
    },
    control: {
      radius: '0px',
      borderWidth: '2px',
      focusRingWidth: '3px'
    },
    surface: {
      radius: '0px',
      borderWidth: '2px'
    },
    overlay: {
      radius: '0px',
      borderWidth: '2px'
    },
    interaction: {
      pressOffset: '2px',
      raisedShadow: '2px 2px 0 0 #161310',
      pressedShadow: 'none'
    },
    button: {
      border: '#161310',
      borderWidth: '2px',
      shadow: '2px 2px 0 0 #161310',
      activeShadow: '2px 2px 0 0 #2e5dd6',
      pressedShadow: 'none'
    },
    input: {
      ...getResolvedTokens('default', 'light').input,
      radius: '0px',
      borderWidth: '2px',
      paddingInline: '12px',
      paddingBlock: '0px',
      gap: '10px',
      placeholderColor: 'rgb(58 51 42 / 70%)',
      iconColor: '#161310',
      shadow: '2px 2px 0 0 #161310',
      activeShadow: '2px 2px 0 0 #2e5dd6',
      keycapSize: '28px',
      keycapRadius: '0px',
      keycapBorderWidth: '2px',
      keycapBg: '#f2ead6',
      keycapColor: '#161310',
      keycapShadow: 'none'
    }
  } as unknown as ThemeTokens;
}

/**
 * 构造使用相对单位的主题，验证自定义主题尺寸不会只在 CSS 变量端生效。
 * @returns 使用 rem/em 尺寸 token 的主题对象
 */
function createRelativeUnitProbe(): ThemeTokens {
  const tokens = createDesignTokenProbe();

  return {
    ...tokens,
    radius: {
      ...tokens.radius,
      xs: '0.25rem'
    },
    control: {
      ...tokens.control,
      radius: '0.5rem',
      borderWidth: '0.125rem'
    },
    surface: {
      ...tokens.surface,
      radius: '1em'
    },
    overlay: {
      ...tokens.overlay,
      radius: '1.25rem',
      borderWidth: '0.125em'
    },
    input: {
      ...tokens.input,
      radius: '0.25rem',
      borderWidth: '0.1875rem',
      paddingInline: '1.5em'
    }
  };
}

describe('theme design token derivation', (): void => {
  it('maps design tokens to Ant Design theme fields', (): void => {
    const tokens = getResolvedTokens('overworld', 'light');
    const antd = toAntdToken(tokens) as unknown as AntdDesignTokenProbe;

    expect(antd.token.borderRadius).toBe(0);
    expect(antd.token.borderRadiusLG).toBe(0);
    expect(antd.token.borderRadiusSM).toBe(0);
    expect(antd.token.lineWidth).toBe(2);
    expect(antd.token.fontFamily).toContain('Pixelify Sans');
    expect(antd.components.Button.borderRadius).toBe(0);
    expect(antd.components.Button.lineWidth).toBe(2);
    expect(antd.components.Button.fontFamily).toContain('Pixelify Sans');
    expect(antd.components.Input.borderRadius).toBe(0);
    expect(antd.components.Input.lineWidth).toBe(2);
    expect(antd.components.Input.controlHeight).toBe(32);
    expect(antd.components.Input.paddingInline).toBe(12);
    expect(antd.components.Input.colorTextPlaceholder).toBe('rgb(58 51 42 / 70%)');
    expect(antd.components.Input.activeShadow).toBe('2px 2px 0 0 #2e5dd6');
    expect(antd.components.Input.fontFamily).toContain('Pixelify Sans');
    expect(antd.components.Select.lineWidth).toBe(2);
    expect(antd.components.Modal.borderRadiusLG).toBe(0);
    expect(antd.components.Dropdown.lineWidth).toBe(2);
    expect(antd.components.Segmented.borderRadius).toBe(0);
  });

  it('accepts non-color design token formats during validation', (): void => {
    const warn = vi.spyOn(console, 'warn').mockImplementation((): void => undefined);

    validateTokens(createDesignTokenProbe(), 'design-token-probe');
    validateTokens(createRelativeUnitProbe(), 'relative-unit-probe');
    validateTokens(getResolvedTokens('default', 'light'), 'default-light');

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('maps relative dimension tokens to numeric Ant Design values', (): void => {
    const antd = toAntdToken(createRelativeUnitProbe()) as unknown as AntdDesignTokenProbe;

    expect(antd.token.borderRadius).toBe(8);
    expect(antd.token.borderRadiusLG).toBe(16);
    expect(antd.token.borderRadiusSM).toBe(4);
    expect(antd.token.lineWidth).toBe(2);
    expect(antd.components.Input.borderRadius).toBe(4);
    expect(antd.components.Input.lineWidth).toBe(3);
    expect(antd.components.Input.paddingInline).toBe(24);
    expect(antd.components.Select.borderRadius).toBe(8);
    expect(antd.components.Dropdown.borderRadiusLG).toBe(20);
    expect(antd.components.Dropdown.lineWidth).toBe(2);
  });

  it('emits scalable rem values for runtime CSS dimension tokens', (): void => {
    const vars = toCssVars(createDesignTokenProbe());

    expect(vars['--input-padding-inline']).toBe('0.8571rem');
    expect(vars['--input-gap']).toBe('0.7143rem');
    expect(vars['--control-border-width']).toBe('0.1429rem');
    expect(vars['--input-keycap-border-width']).toBe('0.1429rem');
    expect(vars['--border-width-hairline']).toBe('1px');
    expect(vars['--button-shadow']).toBe('0.1429rem 0.1429rem 0 0 #161310');
    expect(vars['--input-active-shadow']).toBe('0.1429rem 0.1429rem 0 0 #2e5dd6');
  });

  it('emits only sans and mono font CSS variables', (): void => {
    const vars = toCssVars(createDesignTokenProbe());

    expect(vars['--font-sans']).toBe('Inter, system-ui, sans-serif');
    expect(vars['--font-mono']).toBe('ui-monospace, monospace');
    expect(vars).not.toHaveProperty('--font-display');
    expect(vars).not.toHaveProperty('--input-font-family');
  });
});
