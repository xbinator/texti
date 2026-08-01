/**
 * @file custom-theme-config.test.ts
 * @description Verifies custom theme configs are registered through the preset registry.
 */
import { describe, expect, it } from 'vitest';
import { getPresetList, getResolvedTokens, registerCustomTheme } from '@/theme';

describe('custom theme config', (): void => {
  it('registers a schema-versioned custom theme with partial token overrides', (): void => {
    registerCustomTheme({
      schemaVersion: 1,
      id: 'custom-square',
      label: 'Custom Square',
      light: {
        color: { primary: '#123456' },
        control: { radius: '0px', borderWidth: '2px' }
      },
      dark: {
        color: { primary: '#abcdef' },
        control: { radius: '0px', borderWidth: '2px' }
      }
    });

    expect(getPresetList()).toContainEqual({ id: 'custom-square', label: 'Custom Square' });
    expect(getResolvedTokens('custom-square', 'light').color.primary).toBe('#123456');
    expect(getResolvedTokens('custom-square', 'light').control.borderWidth).toBe('2px');
  });
});
