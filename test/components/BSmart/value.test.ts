/**
 * @file value.test.ts
 * @description 验证 BSmart 结构化值构造与类型守卫。
 */
import { describe, expect, it } from 'vitest';
import { createLiteralValue, createVariableValue, isLiteralValue, isSmartValue, isVariableValue } from '@/components/BSmart/utils/value';

describe('BSmart value helpers', (): void => {
  it('creates literal and variable values without template syntax', (): void => {
    expect(createLiteralValue(false)).toEqual({ type: 'literal', value: false });
    expect(createVariableValue('$input.disabled')).toEqual({ type: 'variable', value: '$input.disabled' });
  });

  it('accepts only complete structured values', (): void => {
    expect(isLiteralValue({ type: 'literal', value: '' })).toBe(true);
    expect(isVariableValue({ type: 'variable', value: '$input.name' })).toBe(true);
    expect(isSmartValue({ type: 'literal' })).toBe(false);
    expect(isSmartValue('{{ $input.name }}')).toBe(false);
    expect(isSmartValue(false)).toBe(false);
  });
});
