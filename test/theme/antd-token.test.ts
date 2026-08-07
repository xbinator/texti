/**
 * @file antd-token.test.ts
 * @description Ant Design token derivation tests.
 */
import { describe, expect, it } from 'vitest';
import { getResolvedTokens, toAntdToken } from '@/theme';

describe('antd token derivation', (): void => {
  it('scales Ant Design default metrics from the 14px design baseline', (): void => {
    const tokens = getResolvedTokens('default', 'light');
    const compactTheme = toAntdToken(tokens, 12);
    const largeTheme = toAntdToken(tokens, 16);

    expect(compactTheme.token.fontSize).toBeCloseTo(12, 4);
    expect(compactTheme.token.controlHeight).toBeCloseTo(32 * (12 / 14), 4);
    expect(largeTheme.token.fontSize).toBeCloseTo(16, 4);
    expect(largeTheme.token.controlHeight).toBeCloseTo(32 * (16 / 14), 4);
    expect(largeTheme.token.controlHeightSM).toBeCloseTo(26 * (16 / 14), 4);
    expect(largeTheme.token.controlHeightLG).toBeCloseTo(38 * (16 / 14), 4);
    expect(largeTheme.components.Button.controlHeight).toBeCloseTo(32 * (16 / 14), 4);
    expect(largeTheme.components.Input.controlHeight).toBeCloseTo(32 * (16 / 14), 4);
    expect(largeTheme.token.borderRadius).toBeCloseTo(6 * (16 / 14), 4);
    expect(largeTheme.components.Input.paddingInline).toBeCloseTo(12 * (16 / 14), 4);
    expect(largeTheme.token.lineWidth).toBe(1);
  });

  it('scales thicker Ant Design borders while keeping one-pixel lines', (): void => {
    const tokens = getResolvedTokens('overworld', 'light');
    const theme = toAntdToken(tokens, 16);

    expect(theme.token.lineWidth).toBeCloseTo(2 * (16 / 14), 4);
    expect(theme.components.Dropdown.lineWidth).toBeCloseTo(2 * (16 / 14), 4);
    expect(theme.components.Input.lineWidth).toBeCloseTo(2 * (16 / 14), 4);
  });
});
