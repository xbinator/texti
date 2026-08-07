/**
 * @file path.test.ts
 * @description 路径片段安全校验、跨平台路径常量测试。
 */
import { describe, expect, it } from 'vitest';
import { path, PORTABLE_RESOURCE_ID_PATTERN } from '@/utils/file/path';

describe('path.validatePath', (): void => {
  it('normalizes separators and rejects traversal or Windows reserved segments', (): void => {
    expect(path.validatePath('assets\\icon.png')).toBe('assets/icon.png');
    expect(() => path.validatePath('../outside.txt')).toThrow('路径不安全');
    expect(() => path.validatePath('assets/CON.txt')).toThrow('路径不安全');
  });
});

describe('PORTABLE_RESOURCE_ID_PATTERN', (): void => {
  it('matches typical portable ids and rejects unsafe characters', (): void => {
    expect(PORTABLE_RESOURCE_ID_PATTERN.test('weather-widget')).toBe(true);
    expect(PORTABLE_RESOURCE_ID_PATTERN.test('Weather_Widget')).toBe(true);
    expect(PORTABLE_RESOURCE_ID_PATTERN.test('widget.v1.0')).toBe(true);
    expect(PORTABLE_RESOURCE_ID_PATTERN.test('not/allowed')).toBe(false);
    expect(PORTABLE_RESOURCE_ID_PATTERN.test('has space')).toBe(false);
  });
});
