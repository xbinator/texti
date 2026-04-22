/**
 * @file builtin-catalog.test.ts
 * @description 内置工具清单测试。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BUILTIN_READONLY_TOOL_NAMES,
  DEFAULT_BUILTIN_WRITABLE_TOOL_NAMES,
  getDefaultBuiltinChatToolNames,
  isDefaultBuiltinReadonlyToolName,
  isDefaultBuiltinWritableToolName
} from '@/ai/tools/builtin/catalog';

describe('built-in tool catalog', () => {
  it('exposes the default readonly tool names', () => {
    expect([...DEFAULT_BUILTIN_READONLY_TOOL_NAMES]).toEqual(['read_current_document', 'get_current_selection', 'get_current_time', 'search_current_document']);
  });

  it('exposes the default low-risk writable tool names', () => {
    expect([...DEFAULT_BUILTIN_WRITABLE_TOOL_NAMES]).toEqual(['insert_at_cursor']);
  });

  it('combines readonly and writable tools for chat defaults', () => {
    expect(getDefaultBuiltinChatToolNames()).toEqual([
      'read_current_document',
      'get_current_selection',
      'get_current_time',
      'search_current_document',
      'insert_at_cursor'
    ]);
  });

  it('checks readonly tool membership from the shared catalog', () => {
    expect(isDefaultBuiltinReadonlyToolName('get_current_time')).toBe(true);
    expect(isDefaultBuiltinReadonlyToolName('insert_at_cursor')).toBe(false);
  });

  it('checks writable tool membership from the shared catalog', () => {
    expect(isDefaultBuiltinWritableToolName('insert_at_cursor')).toBe(true);
    expect(isDefaultBuiltinWritableToolName('replace_selection')).toBe(false);
  });
});
